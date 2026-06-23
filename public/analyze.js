// Client-side food analysis. Calls the Anthropic Messages API directly from the
// browser using the user's own key (entered on-device in Settings, never shipped
// in the code). A direct fetch — rather than the SDK — keeps this a zero-build,
// self-contained static app with no runtime CDN dependency.
//
// Swap MODEL to claude-sonnet-4-6 / claude-haiku-4-5 to trade accuracy for cost.

const MODEL = "claude-opus-4-8";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

const num = { type: "number" };
const ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    portion: { type: "string" },
    calories: num,
    protein_g: num,
    carbs_g: num,
    fat_g: num,
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["name", "portion", "calories", "protein_g", "carbs_g", "fat_g", "confidence"],
  additionalProperties: false,
};

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: ITEM_SCHEMA },
    total_calories: num,
    total_protein_g: num,
    total_carbs_g: num,
    total_fat_g: num,
    notes: { type: "string" },
  },
  required: ["items", "total_calories", "total_protein_g", "total_carbs_g", "total_fat_g", "notes"],
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

export async function analyzeImage({ base64, mediaType, apiKey }) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
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
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "Analyze this food photo and return the calorie and macro estimate." },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new Error("Couldn't reach the analysis service. Check your connection.");
  }

  if (res.status === 401) throw new Error("Invalid API key. Update it in Settings (⚙).");
  if (res.status === 429) throw new Error("Rate limited. Wait a moment and try again.");

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(data?.error?.message || `Analysis failed (HTTP ${res.status}).`);
  }
  if (data.stop_reason === "refusal") {
    throw new Error("The model declined to analyze this image.");
  }

  // output_config.format guarantees the first text block is schema-valid JSON.
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No analysis was returned. Try another photo.");
  return JSON.parse(textBlock.text);
}
