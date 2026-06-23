# CalorieSnap

Snap a photo of your food → get a calorie + macro estimate. Installable PWA,
powered by Claude vision. **No server, no backend, no accounts** — it's a static
site that calls Claude directly from the browser using *your own* API key, which
you enter once on the device and which is stored only there.

The food log and daily calorie goal live on-device too (IndexedDB).

## How it works

```
phone camera → downscale to ~1024px (canvas)
   → call the Anthropic API directly from the browser
     (your on-device key + a structured-output schema)
   → guaranteed-valid JSON → editable estimate card
   → save to IndexedDB → Log totals vs daily goal
```

There's no server because there's no shared secret to hide: each person uses
their **own** key, entered in the app's **Settings (⚙)** and kept in that
device's local storage. The key is never in the code, never in the repo, and
never uploaded anywhere except Anthropic's API.

## Using it

1. Open the app (locally or on the deployed URL).
2. Tap the **⚙** gear (top-right) → paste your Anthropic API key → **Save**.
   - Get a key at https://console.anthropic.com → Settings → API Keys.
   - Tip: set a monthly spend limit on the key under Billing for peace of mind.
3. **Scan** tab → take/choose a food photo → **Estimate** → edit if needed →
   **Save to log**.
4. **Goal** tab sets a daily target; **Log** tab shows entries + progress.

## Run locally

It's a static site — serve the `public/` folder with anything:

```
python -m http.server 8126 --directory public
# then open http://localhost:8126
```

(Regenerate the PWA icons with `npm run icons` if you change the design.)

## Deploy to GitHub Pages (free, all on GitHub)

A GitHub Actions workflow (`.github/workflows/deploy.yml`) publishes the
`public/` folder to Pages on every push to `main`.

1. Push to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow runs and gives you a URL like
   `https://<your-username>.github.io/calorie-snap/`.
4. Open that URL on your phone, tap ⚙ and add your key, then **Add to Home
   Screen** to install it (HTTPS is automatic on Pages — required for the camera
   and install).

> Note: a GitHub Pages site is publicly reachable. That's fine here — there are
> no secrets in the code; your key only ever lives on your own device.

## Cost

Each scan is one image + a small JSON reply — fractions of a cent on
`claude-opus-4-8`. To cut cost, change `MODEL` in `public/analyze.js` to
`claude-sonnet-4-6` or `claude-haiku-4-5` (one line).

## Project layout

```
public/                 the whole app (static, deployed to Pages)
  index.html            app shell + Scan / Log / Goal tabs + Settings sheet
  styles.css            mobile-first styling
  app.js                UI, camera capture, on-device key, calls analyze.js
  analyze.js            calls the Anthropic API directly (vision + JSON schema)
  db.js                 IndexedDB: entries, daily goal, and the API key
  manifest.webmanifest  PWA metadata (relative paths → works on a Pages subpath)
  sw.js                 service worker (offline app shell)
  icons/                generated 192 / 512 / maskable icons
scripts/
  generate-icons.js     dependency-free PNG icon generator
.github/workflows/
  deploy.yml            auto-publishes public/ to GitHub Pages
```
