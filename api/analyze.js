import Anthropic from "@anthropic-ai/sdk";

// Thin proxy: holds the API key, sends the photo to Claude vision, returns
// guaranteed-valid JSON. Swap `MODEL` to claude-sonnet-4-6 / claude-haiku-4-5
// to trade accuracy for cost — that's the only line to change.
const MODEL = "claude-opus-4-8";

// ~6.5MB of base64 ≈ ~5MB raw image. The client downscales to ~1024px before
// upload, so anything larger is almost certainly a bad request.
const MAX_BASE64_CHARS = 6_500_000;
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Structured-output schema: Claude is constrained to return exactly this shape,
// so the response is always parseable. Every object sets additionalProperties:
// false, as structured outputs require.
const numberField = { type: "number" };
const ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    portion: { type: "string" },
    calories: numberField,
    protein_g: numberField,
    carbs_g: numberField,
    fat_g: numberField,
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: [
    "name",
    "portion",
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "confidence",
  ],
  additionalProperties: false,
};

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: ITEM_SCHEMA },
    total_calories: numberField,
    total_protein_g: numberField,
    total_carbs_g: numberField,
    total_fat_g: numberField,
    notes: { type: "string" },
  },
  required: [
    "items",
    "total_calories",
    "total_protein_g",
    "total_carbs_g",
    "total_fat_g",
    "notes",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a nutrition estimation assistant. Given a photo of food, identify each distinct food item and estimate its portion size, calories, and macronutrients (protein, carbs, fat in grams).

Guidelines:
- Estimate realistic portion sizes from visual cues (plate size, utensils, hand, packaging). If there is no scale reference, assume a typical single serving and say so in notes.
- One entry per distinct food item. Combine identical items into one entry with a portion that reflects the total (e.g. "2 cookies").
- Round calories to the nearest 5 and macros to the nearest 0.5 g.
- total_* fields must equal the sum of the per-item values.
- Set confidence per item: "high" when the food and portion are clear, "low" when the food is ambiguous or hidden.
- notes: one short sentence on assumptions or caveats (e.g. "Assumed medium portion; no scale reference in frame.").
- If the image contains no food, return an empty items array, zero totals, and explain in notes.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res
      .status(500)
      .json({ error: "Server is missing ANTHROPIC_API_KEY." });
  }

  const { imageBase64, mediaType } = req.body || {};

  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    return res
      .status(400)
      .json({ error: "Missing 'imageBase64' (base64 image data, no prefix)." });
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return res
      .status(413)
      .json({ error: "Image too large. Downscale before uploading." });
  }
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return res.status(400).json({
      error: `Unsupported 'mediaType'. Use one of: ${[...ALLOWED_MEDIA_TYPES].join(", ")}.`,
    });
  }

  const client = new Anthropic();

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RESULT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: "Analyze this food photo and return the calorie and macro estimate.",
            },
          ],
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return res
        .status(422)
        .json({ error: "The model declined to analyze this image." });
    }

    // With output_config.format the first text block is guaranteed-valid JSON
    // matching RESULT_SCHEMA.
    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock) {
      return res
        .status(502)
        .json({ error: "No analysis was returned. Try another photo." });
    }

    const result = JSON.parse(textBlock.text);
    return res.status(200).json(result);
  } catch (err) {
    // Typed SDK exceptions → safe client-facing messages. Log the rest server-side.
    if (err instanceof Anthropic.RateLimitError) {
      return res
        .status(429)
        .json({ error: "Rate limited. Wait a moment and try again." });
    }
    if (err instanceof Anthropic.APIStatusError) {
      console.error(`Anthropic API error ${err.status}:`, err.message);
      return res
        .status(502)
        .json({ error: "The analysis service is unavailable. Try again." });
    }
    console.error("analyze failed:", err);
    return res.status(500).json({ error: "Unexpected error during analysis." });
  }
}
