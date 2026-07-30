/* Local-first storage.
   Two records in one IndexedDB store:
     "db"       - items, meals, plan, budget. This is what syncs to GitHub.
     "settings" - tokens and API keys. Never synced, never leaves the device. */

const DB_NAME = "fortnight-shop";
const STORE = "kv";

export const SCHEMA_VERSION = 2;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE)) idb.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get(key) {
  const idb = await open();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function put(key, value) {
  const idb = await open();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ------------------------------ identifiers ---------------------------- */

export const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
export const uid = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* --------------------------- receipt line keys -------------------------- */

const STOP = new Set([
  "the", "and", "of", "with", "in", "g", "kg", "ml", "l", "cl", "pk", "pack", "packet",
  "value", "essential", "finest", "tesco", "asda", "aldi", "lidl", "sainsburys",
  "sainsbury", "morrisons", "waitrose", "coop", "co", "op",
]);

export const norm = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/* Resolve a receipt line to an ingredient.
   Order matters: a barcode is certain, a saved alias is near certain,
   a fuzzy name match is only a suggestion. */
export function resolveLine(line, ingredients) {
  const key = norm(line.name);

  if (line.barcode) {
    const hit = ingredients.find((i) => (i.barcodes || []).includes(line.barcode));
    if (hit) return { id: hit.id, why: "barcode", confident: true };
  }

  const alias = ingredients.find((i) => (i.aliases || []).includes(key));
  if (alias) return { id: alias.id, why: "seen on a previous receipt", confident: true };

  const tokens = key.split(" ").filter((t) => t && !STOP.has(t));
  let best = null;
  let bestScore = 0;
  for (const ing of ingredients) {
    const want = norm(ing.name).split(" ").filter(Boolean);
    if (!want.length) continue;
    let hits = 0;
    for (const w of want) {
      if (tokens.some((t) => t === w || t.startsWith(w) || w.startsWith(t))) hits += 1;
    }
    const score = hits / want.length;
    if (score > bestScore) {
      bestScore = score;
      best = ing;
    }
  }
  if (best && bestScore >= 0.5) return { id: best.id, why: "name looks close", confident: false };
  return { id: "", why: "no match yet", confident: false };
}

/* ------------------------------ seed data ------------------------------ */

export function seed() {
  const raw = [
    ["Pies", 4, 3.5], ["Potatoes", 4, 1.2], ["Gravy Granules", 8, 1.5],
    ["Mince", 2, 4.0], ["Pasta", 4, 1.0], ["Passata", 2, 0.8], ["Garlic", 4, 0.6],
    ["Chicken", 2, 5.0], ["Stir Fry Veg", 2, 1.5], ["Soy Sauce", 8, 1.2], ["Noodles", 4, 1.0],
  ];
  const ingredients = raw.map(([name, portionsPerPack, pricePerPack]) => ({
    id: slug(name),
    name,
    portionsPerPack,
    pricePerPack,
    stockPacks: 0,
    store: "Tesco",
    packLabel: "",
    barcodes: [],
    aliases: [],
    priceUpdated: "",
  }));

  const meals = [
    { id: "pie-and-mash", name: "Pie and Mash", items: [
      { ingredientId: "pies", portions: 2 },
      { ingredientId: "potatoes", portions: 0.25 },
      { ingredientId: "gravy-granules", portions: 0.25 },
    ] },
    { id: "spaghetti-bolognese", name: "Spaghetti Bolognese", items: [
      { ingredientId: "mince", portions: 0.5 },
      { ingredientId: "pasta", portions: 0.5 },
      { ingredientId: "passata", portions: 0.5 },
      { ingredientId: "garlic", portions: 0.25 },
    ] },
    { id: "chicken-stir-fry", name: "Chicken Stir Fry", items: [
      { ingredientId: "chicken", portions: 0.5 },
      { ingredientId: "stir-fry-veg", portions: 0.5 },
      { ingredientId: "soy-sauce", portions: 0.25 },
      { ingredientId: "noodles", portions: 0.5 },
    ] },
  ];

  const plan = Array.from({ length: 14 }, () => null);
  plan[0] = "pie-and-mash";
  plan[1] = "spaghetti-bolognese";
  plan[2] = "pie-and-mash";

  return { schema: SCHEMA_VERSION, ingredients, meals, plan, budget: 60, updatedAt: "" };
}

export function newIngredient(store) {
  return {
    id: uid(), name: "New item", portionsPerPack: 4, pricePerPack: 0, stockPacks: 0,
    store: store || "Tesco", packLabel: "", barcodes: [], aliases: [], priceUpdated: "",
  };
}

/* Fill in anything an older snapshot is missing, so a restored backup
   from an earlier version does not crash the app. */
export function migrate(db) {
  if (!db || !Array.isArray(db.ingredients)) return seed();
  const plan = Array.from({ length: 14 }, (_, i) =>
    Array.isArray(db.plan) && db.plan[i] ? db.plan[i] : null
  );
  return {
    schema: SCHEMA_VERSION,
    budget: Number(db.budget) || 60,
    updatedAt: db.updatedAt || "",
    plan,
    meals: (db.meals || []).map((m) => ({
      id: m.id || uid(),
      name: m.name || "Meal",
      items: (m.items || []).filter((it) => it && it.ingredientId),
    })),
    ingredients: db.ingredients.map((i) => ({
      id: i.id || uid(),
      name: i.name || "Item",
      portionsPerPack: Number(i.portionsPerPack) || 0,
      pricePerPack: Number(i.pricePerPack) || 0,
      stockPacks: Number(i.stockPacks) || 0,
      store: i.store || "",
      packLabel: i.packLabel || "",
      barcodes: Array.isArray(i.barcodes) ? i.barcodes : i.barcode ? [i.barcode] : [],
      aliases: Array.isArray(i.aliases) ? i.aliases : [],
      priceUpdated: i.priceUpdated || "",
    })),
  };
}

/* -------------------------------- public ------------------------------- */

export const DEFAULT_SETTINGS = {
  owner: "",
  repo: "",
  path: "prices.json",
  branch: "main",
  token: "",
  provider: "gemini",
  geminiModel: "gemini-3.1-flash-lite-preview",
  geminiKey: "",
  anthropicModel: "claude-haiku-4-5-20251001",
  anthropicKey: "",
  lastPull: "",
  lastPush: "",
};

export async function loadDb() {
  const stored = await get("db").catch(() => null);
  return stored ? migrate(stored) : seed();
}

export const saveDb = (db) => put("db", db);

export async function loadSettings() {
  const stored = await get("settings").catch(() => null);
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

export const saveSettings = (s) => put("settings", s);
