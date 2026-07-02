// Auto-sync a small daily summary to a secret GitHub Gist so the desktop
// health dashboard can read it. Requires a GitHub token with only the "gist"
// scope, stored on-device in Settings (same pattern as the Anthropic key).
// The gist holds one file with per-day calorie totals — no meal details.

import {
  getAllEntries,
  getGoal,
  getGithubToken,
  getGistId,
  setGistId,
  localDate,
} from "./db.js";

const GIST_FILE = "caloriesnap-summary.json";
const GIST_API = "https://api.github.com/gists";

function buildSummary(entries, goal) {
  const byDay = {};
  for (const e of entries) {
    byDay[e.date] = (byDay[e.date] || 0) + (e.totals?.calories || 0);
  }
  // Last 14 days gives the dashboard headroom for weekly views.
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDate(d);
    days.push({ date: key, calories: Math.round(byDay[key] || 0) });
  }
  return {
    app: "calorie-snap",
    schema: 1,
    generatedAt: new Date().toISOString(),
    goal,
    days,
  };
}

export async function syncNow() {
  const token = await getGithubToken();
  if (!token) return { skipped: "no token" };
  if (!navigator.onLine) return { skipped: "offline" };

  const [entries, goal] = await Promise.all([getAllEntries(), getGoal()]);
  const content = JSON.stringify(buildSummary(entries, goal), null, 2);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  const body = JSON.stringify({
    description: "CalorieSnap daily summary (auto-synced for the health dashboard)",
    public: false,
    files: { [GIST_FILE]: { content } },
  });

  let resp;
  const gistId = await getGistId();
  if (gistId) {
    resp = await fetch(`${GIST_API}/${gistId}`, { method: "PATCH", headers, body });
    // Gist was deleted out from under us — create a fresh one.
    if (resp.status === 404) resp = await fetch(GIST_API, { method: "POST", headers, body });
  } else {
    resp = await fetch(GIST_API, { method: "POST", headers, body });
  }
  if (!resp.ok) throw new Error(`GitHub sync failed (HTTP ${resp.status})`);

  const json = await resp.json();
  if (json.id && json.id !== gistId) await setGistId(json.id);
  return { id: json.id };
}

// Debounced fire-and-forget wrapper for after-save/delete hooks, so rapid
// edits collapse into one API call and failures never block the UI.
let timer = null;
export function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    syncNow().catch(() => {});
  }, 3000);
}
