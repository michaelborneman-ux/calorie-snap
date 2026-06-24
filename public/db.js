// Thin IndexedDB wrapper. Two stores:
//   - entries:  saved food logs, keyed by id, indexed by `date` (YYYY-MM-DD)
//   - settings: single-key/value store (currently just the daily calorie goal)
// No external libraries.

const DB_NAME = "calorie-snap";
const DB_VERSION = 1;
const ENTRIES_STORE = "entries";
const SETTINGS_STORE = "settings";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        const store = db.createObjectStore(ENTRIES_STORE, { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, run) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const result = run(store);
        transaction.oncomplete = () => resolve(result.value);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

// Wrap an IDBRequest so we can read its result after the transaction completes.
function box(request) {
  const holder = { value: undefined };
  request.onsuccess = () => {
    holder.value = request.result;
  };
  return holder;
}

export function localDate(d = new Date()) {
  // Local-time YYYY-MM-DD (not UTC) so "today" matches the user's day.
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

export async function addEntry(entry) {
  const record = {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: entry.date ?? localDate(),
    createdAt: Date.now(),
    items: entry.items,
    totals: entry.totals,
  };
  await tx(ENTRIES_STORE, "readwrite", (store) => box(store.add(record)));
  return record;
}

export function getEntriesByDate(date) {
  return tx(ENTRIES_STORE, "readonly", (store) =>
    box(store.index("date").getAll(date)),
  ).then((entries) => entries.sort((a, b) => b.createdAt - a.createdAt));
}

export function deleteEntry(id) {
  return tx(ENTRIES_STORE, "readwrite", (store) => box(store.delete(id)));
}

export async function getGoal() {
  const row = await tx(SETTINGS_STORE, "readonly", (store) =>
    box(store.get("goal")),
  );
  return row?.value ?? null;
}

export function setGoal(calories) {
  return tx(SETTINGS_STORE, "readwrite", (store) =>
    box(store.put({ key: "goal", value: calories })),
  );
}

// Daily macro goals (grams): { protein_g, carbs_g, fat_g }. Any field may be
// null/absent if the user hasn't set that one.
export async function getMacroGoals() {
  const row = await tx(SETTINGS_STORE, "readonly", (store) =>
    box(store.get("macroGoals")),
  );
  return row?.value ?? {};
}

export function setMacroGoals(goals) {
  return tx(SETTINGS_STORE, "readwrite", (store) =>
    box(store.put({ key: "macroGoals", value: goals })),
  );
}

// Selected goal profile (e.g. "training" | "loss" | "balanced"), or null when
// the user has manually customized their goals.
export async function getProfile() {
  const row = await tx(SETTINGS_STORE, "readonly", (store) =>
    box(store.get("profile")),
  );
  return row?.value ?? null;
}

export function setProfile(name) {
  return tx(SETTINGS_STORE, "readwrite", (store) =>
    box(store.put({ key: "profile", value: name })),
  );
}

// Anthropic API key — stored only on this device, entered by the user in
// Settings. Never shipped in the code or sent anywhere except Anthropic's API.
export async function getApiKey() {
  const row = await tx(SETTINGS_STORE, "readonly", (store) =>
    box(store.get("apiKey")),
  );
  return row?.value ?? null;
}

export function setApiKey(key) {
  return tx(SETTINGS_STORE, "readwrite", (store) =>
    box(store.put({ key: "apiKey", value: key })),
  );
}

export function clearApiKey() {
  return tx(SETTINGS_STORE, "readwrite", (store) => box(store.delete("apiKey")));
}
