# CalorieSnap

Snap a photo of your food → get a calorie + macro estimate. Installable PWA,
powered by Claude vision. Food log and a daily calorie goal are stored
on-device (IndexedDB) — no accounts, no server database.

## How it works

```
phone camera → downscale to ~1024px (canvas) → POST /api/analyze
   → serverless fn calls Claude (claude-opus-4-8) with the image + a
     structured-output schema → guaranteed-valid JSON
   → editable estimate card → save to IndexedDB → Log totals vs daily goal
```

The API key lives only in the serverless function (`api/analyze.js`), never in
the browser.

## Local development

1. Install deps:
   ```
   npm install
   ```
2. Add your key — copy `.env.local.example` to `.env.local` and paste a key
   from https://console.anthropic.com/settings/keys :
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Run frontend + function together. Two options:
   ```
   npm run dev          # = vercel dev   (production-faithful; needs a Vercel login)
   npm run dev:local    # zero-account local server on http://localhost:8127
   ```
   `vercel dev` serves `public/` and routes `/api/*` to the function. The
   `dev:local` option (`scripts/dev-server.mjs`) does the same thing with a
   plain Node server and `--env-file=.env.local`, so you can test end-to-end
   without a Vercel account.

Icons are checked in. To regenerate them: `npm run icons`.

## Deploy (Vercel)

```
npx vercel            # first deploy / link the project
npx vercel --prod     # production
```

Set `ANTHROPIC_API_KEY` as a Vercel **Environment Variable** (Project →
Settings → Environment Variables). HTTPS is automatic — required for the camera
and for "Add to Home Screen".

On the phone: open the production URL, take a photo end-to-end, then **Add to
Home Screen** to install. It launches fullscreen (standalone).

## Cost

Each scan is one image + a small JSON response — cheap per call. To cut cost,
change `MODEL` in `api/analyze.js` to `claude-sonnet-4-6` or
`claude-haiku-4-5` (one line).

## Project layout

```
public/                 static PWA (served as-is)
  index.html            app shell + Scan / Log / Goal tabs
  styles.css            mobile-first styling
  app.js                UI, camera capture, downscale, calls /api/analyze
  db.js                 IndexedDB wrapper (entries + settings)
  manifest.webmanifest  PWA metadata
  sw.js                 service worker (offline shell cache)
  icons/                generated 192 / 512 / maskable icons
api/
  analyze.js            Vercel serverless fn: image → Claude → JSON
scripts/
  generate-icons.js     dependency-free PNG icon generator
```
