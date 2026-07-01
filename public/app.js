import {
  addEntry,
  getAllEntries,
  getEntriesByDate,
  deleteEntry,
  getGoal,
  setGoal,
  getMacroGoals,
  setMacroGoals,
  getProfile,
  setProfile,
  getApiKey,
  setApiKey,
  clearApiKey,
  localDate,
} from "./db.js";
import { analyzeImage } from "./analyze.js";

// ---- Service worker (offline shell) ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline launch is a progressive enhancement; ignore failures */
    });
  });
}

const $ = (sel) => document.querySelector(sel);
const MACROS = [
  ["calories", 1],
  ["protein_g", 0.5],
  ["carbs_g", 0.5],
  ["fat_g", 0.5],
];

// ---- Tab switching ----
const tabs = document.querySelectorAll(".tab");
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    tabs.forEach((t) => (t.hidden = t.dataset.tab !== target));
    if (target === "log") renderLog();
    if (target === "goal") loadGoalInput();
  });
});

// ---- Settings sheet (API key) ----
const overlay = $("#settings-overlay");

async function openSettings() {
  const key = await getApiKey();
  $("#key-input").value = key || "";
  $("#key-status").textContent = key
    ? "A key is saved on this device."
    : "No key saved yet.";
  overlay.hidden = false;
}
function closeSettings() {
  overlay.hidden = true;
}

$("#settings-btn").addEventListener("click", openSettings);
$("#settings-close").addEventListener("click", closeSettings);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeSettings(); // tap backdrop to dismiss
});
$("#key-save").addEventListener("click", async () => {
  const key = $("#key-input").value.trim();
  if (!key) return;
  await setApiKey(key);
  $("#key-status").textContent = "Saved ✓";
});
$("#key-clear").addEventListener("click", async () => {
  await clearApiKey();
  $("#key-input").value = "";
  $("#key-status").textContent = "Key cleared.";
});

// ---- Data export (for the desktop health dashboard) ----
$("#export-btn").addEventListener("click", async () => {
  const status = $("#export-status");
  status.textContent = "Preparing export…";
  try {
    const [entries, goal, macroGoals, profile] = await Promise.all([
      getAllEntries(),
      getGoal(),
      getMacroGoals(),
      getProfile(),
    ]);
    const payload = {
      app: "calorie-snap",
      schema: 1,
      exportedAt: new Date().toISOString(),
      goal,
      macroGoals,
      profile,
      entries,
    };
    const name = `caloriesnap-export-${localDate()}.json`;
    const file = new File([JSON.stringify(payload, null, 2)], name, {
      type: "application/json",
    });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      status.textContent = "Shared ✓";
    } else {
      // Desktop browsers without the share sheet: download the file instead.
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = "Downloaded ✓";
    }
  } catch (err) {
    // Cancelling the share sheet is not an error worth reporting.
    status.textContent =
      err?.name === "AbortError" ? "" : "Export failed. Try again.";
  }
});

// ---- Image capture + downscale ----
const MAX_EDGE = 1024;
let currentImage = null; // { base64, mediaType }

$("#photo-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  resetResult();
  try {
    currentImage = await downscale(file);
    $("#preview").src = `data:${currentImage.mediaType};base64,${currentImage.base64}`;
    $("#preview-wrap").hidden = false;
  } catch {
    showStatus("Could not read that image. Try another.", true);
  }
});

function downscale(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

// ---- Estimate (call Claude directly with the on-device key) ----
$("#estimate-btn").addEventListener("click", async () => {
  if (!currentImage) return;

  const apiKey = await getApiKey();
  if (!apiKey) {
    showStatus("Add your Anthropic API key in Settings (⚙) to analyze photos.", true);
    openSettings();
    return;
  }
  if (!navigator.onLine) {
    showStatus("You're offline. Analysis needs a connection.", true);
    return;
  }

  showStatus('<span class="spinner"></span>Analyzing photo…');
  $("#estimate-btn").disabled = true;
  try {
    const data = await analyzeImage({
      base64: currentImage.base64,
      mediaType: currentImage.mediaType,
      apiKey,
    });
    hideStatus();
    renderResult(data);
  } catch (err) {
    showStatus(err.message || "Analysis failed. Try again.", true);
  } finally {
    $("#estimate-btn").disabled = false;
  }
});

// ---- Editable result card ----
function renderResult(data) {
  $("#result-notes").textContent = data.notes || "";
  const items = $("#items");
  items.innerHTML = "";
  (data.items || []).forEach((item) => items.appendChild(itemRow(item)));
  recalcTotals();
  $("#result-card").hidden = false;
  $("#result-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function itemRow(item = {}) {
  const wrap = document.createElement("div");
  wrap.className = "item";

  const head = document.createElement("div");
  head.className = "item-row";
  const name = document.createElement("input");
  name.type = "text";
  name.className = "name";
  name.value = item.name ?? "";
  name.placeholder = "Food name";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "item-remove";
  remove.setAttribute("aria-label", "Remove item");
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    wrap.remove();
    recalcTotals();
  });
  head.append(name, remove);
  wrap.appendChild(head);

  const macros = document.createElement("div");
  macros.className = "macros";
  MACROS.forEach(([key, step]) => {
    const label = document.createElement("label");
    label.textContent = labelFor(key);
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.min = "0";
    input.step = String(step);
    input.dataset.macro = key;
    input.value = Number(item[key] ?? 0);
    input.addEventListener("input", recalcTotals);
    label.appendChild(input);
    macros.appendChild(label);
  });
  wrap.appendChild(macros);
  return wrap;
}

function labelFor(key) {
  return {
    calories: "Calories",
    protein_g: "Protein (g)",
    carbs_g: "Carbs (g)",
    fat_g: "Fat (g)",
  }[key];
}

$("#add-item").addEventListener("click", () => {
  $("#items").appendChild(itemRow());
  recalcTotals();
});

function collectItems() {
  return [...document.querySelectorAll("#items .item")].map((row) => {
    const item = { name: row.querySelector(".name").value.trim() };
    row.querySelectorAll("input[data-macro]").forEach((inp) => {
      item[inp.dataset.macro] = Number(inp.value) || 0;
    });
    return item;
  });
}

function recalcTotals() {
  const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  collectItems().forEach((item) => {
    for (const k in totals) totals[k] += item[k] || 0;
  });
  $("#t-cal").textContent = Math.round(totals.calories);
  $("#t-pro").textContent = round1(totals.protein_g);
  $("#t-carb").textContent = round1(totals.carbs_g);
  $("#t-fat").textContent = round1(totals.fat_g);
  return totals;
}

const round1 = (n) => Math.round(n * 10) / 10;

// ---- Save / discard ----
$("#result-card").addEventListener("submit", async (e) => {
  e.preventDefault();
  const items = collectItems().filter((i) => i.name || i.calories);
  if (items.length === 0) {
    showStatus("Add at least one item before saving.", true);
    return;
  }
  const totals = recalcTotals();
  await addEntry({
    items,
    totals: {
      calories: Math.round(totals.calories),
      protein_g: round1(totals.protein_g),
      carbs_g: round1(totals.carbs_g),
      fat_g: round1(totals.fat_g),
    },
  });
  resetScan();
  document.querySelector('.tab-btn[data-target="log"]').click();
});

$("#discard-btn").addEventListener("click", resetScan);

function resetScan() {
  currentImage = null;
  $("#photo-input").value = "";
  $("#preview").src = "";
  $("#preview-wrap").hidden = true;
  resetResult();
}
function resetResult() {
  $("#result-card").hidden = true;
  $("#items").innerHTML = "";
  hideStatus();
}

// ---- Status helpers ----
function showStatus(html, isError = false) {
  const el = $("#status");
  el.innerHTML = html;
  el.classList.toggle("error", isError);
  el.hidden = false;
}
function hideStatus() {
  $("#status").hidden = true;
}

// ---- Log tab ----
async function renderLog() {
  const today = localDate();
  const [entries, goal, macroGoals] = await Promise.all([
    getEntriesByDate(today),
    getGoal(),
    getMacroGoals(),
  ]);

  const consumed = entries.reduce((sum, e) => sum + (e.totals.calories || 0), 0);
  const consumedMacros = entries.reduce(
    (acc, e) => {
      acc.protein_g += e.totals.protein_g || 0;
      acc.carbs_g += e.totals.carbs_g || 0;
      acc.fat_g += e.totals.fat_g || 0;
      return acc;
    },
    { protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  renderGoalBanner(consumed, goal);
  renderMacroSummary(consumedMacros, macroGoals);

  const list = $("#log-list");
  list.innerHTML = "";
  $("#log-empty").hidden = entries.length > 0;
  entries.forEach((entry) => list.appendChild(logEntry(entry)));
}

function renderGoalBanner(consumed, goal) {
  const fill = $("#goal-fill");
  if (!goal) {
    fill.style.width = "0%";
    fill.classList.remove("over");
    $("#goal-summary").textContent =
      `${consumed} cal today · set a daily goal on the Goal tab.`;
    return;
  }
  const pct = Math.min(100, (consumed / goal) * 100);
  fill.style.width = `${pct}%`;
  fill.classList.toggle("over", consumed > goal);
  const remaining = goal - consumed;
  $("#goal-summary").textContent =
    remaining >= 0
      ? `${consumed} / ${goal} cal · ${remaining} remaining`
      : `${consumed} / ${goal} cal · ${Math.abs(remaining)} over`;
}

function renderMacroSummary(consumed, goals) {
  const container = $("#macro-summary");
  container.innerHTML = "";
  const defs = [
    ["protein_g", "Protein"],
    ["carbs_g", "Carbs"],
    ["fat_g", "Fat"],
  ];
  defs.forEach(([key, label]) => {
    const have = round1(consumed[key]);
    const goal = goals?.[key];

    const row = document.createElement("div");
    row.className = "macro-row";

    const head = document.createElement("div");
    head.className = "macro-row-head";
    const name = document.createElement("span");
    name.textContent = label;
    const val = document.createElement("strong");
    val.textContent = goal ? `${have} / ${goal} g` : `${have} g`;
    head.append(name, val);
    row.appendChild(head);

    if (goal) {
      const bar = document.createElement("div");
      bar.className = "macro-bar";
      const fill = document.createElement("div");
      fill.className = "macro-fill";
      fill.style.width = `${Math.min(100, (have / goal) * 100)}%`;
      if (have > goal) fill.classList.add("over");
      bar.appendChild(fill);
      row.appendChild(bar);
    }
    container.appendChild(row);
  });
}

function logEntry(entry) {
  const wrap = document.createElement("div");
  wrap.className = "log-entry";

  const head = document.createElement("div");
  head.className = "log-entry-head";
  const cal = document.createElement("strong");
  cal.textContent = `${entry.totals.calories} cal`;
  const time = document.createElement("span");
  time.className = "log-entry-time";
  time.textContent = new Date(entry.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  head.append(cal, time);
  wrap.appendChild(head);

  const ul = document.createElement("ul");
  entry.items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.name || "Item"} — ${Math.round(item.calories || 0)} cal`;
    ul.appendChild(li);
  });
  wrap.appendChild(ul);

  const macros = document.createElement("div");
  macros.className = "log-entry-macros";
  const t = entry.totals;
  macros.textContent = `P ${t.protein_g}g · C ${t.carbs_g}g · F ${t.fat_g}g`;
  wrap.appendChild(macros);

  const del = document.createElement("button");
  del.className = "log-delete";
  del.textContent = "Delete";
  del.addEventListener("click", async () => {
    await deleteEntry(entry.id);
    renderLog();
  });
  wrap.appendChild(del);

  return wrap;
}

// ---- Goal tab ----
// Preset profiles: each sets a calorie target + macro split (grams). Starting
// points the user can fine-tune; not medical advice.
const PROFILES = {
  training: { calories: 2600, protein_g: 180, carbs_g: 300, fat_g: 75 },
  loss: { calories: 1700, protein_g: 150, carbs_g: 130, fat_g: 60 },
  balanced: { calories: 2000, protein_g: 120, carbs_g: 225, fat_g: 65 },
};

function markActiveProfile(key) {
  document.querySelectorAll(".profile-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.profile === key);
  });
}

async function applyProfile(key) {
  const p = PROFILES[key];
  if (!p) return;
  $("#goal-input").value = p.calories;
  $("#goal-protein").value = p.protein_g;
  $("#goal-carbs").value = p.carbs_g;
  $("#goal-fat").value = p.fat_g;
  await Promise.all([
    setGoal(p.calories),
    setMacroGoals({ protein_g: p.protein_g, carbs_g: p.carbs_g, fat_g: p.fat_g }),
    setProfile(key),
  ]);
  markActiveProfile(key);
  $("#goal-saved").hidden = false;
}

document.querySelectorAll(".profile-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyProfile(btn.dataset.profile));
});

async function loadGoalInput() {
  const [goal, macroGoals, profile] = await Promise.all([
    getGoal(),
    getMacroGoals(),
    getProfile(),
  ]);
  $("#goal-input").value = goal ?? "";
  $("#goal-protein").value = macroGoals?.protein_g ?? "";
  $("#goal-carbs").value = macroGoals?.carbs_g ?? "";
  $("#goal-fat").value = macroGoals?.fat_g ?? "";
  markActiveProfile(profile);
  $("#goal-saved").hidden = true;
}

$("#goal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cal = Number($("#goal-input").value);
  if (Number.isFinite(cal) && cal > 0) await setGoal(Math.round(cal));

  // Save each positive macro goal; blanks/zero are left unset.
  const macros = {};
  for (const [id, key] of [
    ["#goal-protein", "protein_g"],
    ["#goal-carbs", "carbs_g"],
    ["#goal-fat", "fat_g"],
  ]) {
    const v = Number($(id).value);
    if (Number.isFinite(v) && v > 0) macros[key] = Math.round(v);
  }
  await setMacroGoals(macros);

  // Manually saving custom values clears the active profile selection.
  await setProfile(null);
  markActiveProfile(null);

  $("#goal-saved").hidden = false;
});

// Prompt for a key on first run if none is stored yet.
getApiKey().then((key) => {
  if (!key) openSettings();
});
