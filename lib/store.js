/* Local-first storage.
   Two records in one IndexedDB store:
     "db"       - items, meals, plan, budget. This is what syncs to GitHub.
     "settings" - tokens and API keys. Never synced, never leaves the device. */

const DB_NAME = "fortnight-shop";
const STORE = "kv";

export const SCHEMA_VERSION = 4;

export const SLOTS = [
  { key: "breakfast", label: "Breakfast", short: "B" },
  { key: "lunch", label: "Lunch", short: "L" },
  { key: "dinner", label: "Dinner", short: "D" },
];

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
let seq = 0;
export const uid = () =>
  `x${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* Readable ids that cannot collide: tuna, then tuna-2, then tuna-3.
   Never truncate a uid to build one of these. Two items created in the same
   millisecond used to land on the same id, and the second became uneditable. */
export function uniqueId(name, taken) {
  const root = slug(name);
  const used = new Set(taken);
  if (!used.has(root)) return root;
  let n = 2;
  while (used.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

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

/* ------------------------------ store names ---------------------------- */

/* Receipts shout: ASDA, LIDL, TESCO STORES LTD. Left alone that produces a
   separate group from every spelling variant, so every store name is funnelled
   through here on the way in. */

const KNOWN_STORES = {
  tesco: "Tesco", asda: "Asda", aldi: "Aldi", lidl: "Lidl",
  sainsburys: "Sainsbury's", sainsbury: "Sainsbury's",
  morrisons: "Morrisons", morrison: "Morrisons",
  waitrose: "Waitrose", ocado: "Ocado", iceland: "Iceland",
  coop: "Co-op", cooperative: "Co-op", thecooperative: "Co-op",
  ms: "M&S", marksandspencer: "M&S", marksspencer: "M&S",
  bm: "B&M", homebargains: "Home Bargains", farmfoods: "Farmfoods",
  heronfoods: "Heron Foods", poundland: "Poundland", poundstretcher: "Poundstretcher",
  spar: "Spar", nisa: "Nisa", costco: "Costco", makro: "Makro",
  savers: "Savers", wilko: "Wilko", boots: "Boots", amazon: "Amazon",
};

const storeKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const titleCase = (s) =>
  String(s)
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

/* Resolve a store name to one canonical spelling.
   A name already in use wins, so whatever you typed first is what sticks.
   Then the known-grocer list, then plain title case. */
export function canonicalStore(name, existing = []) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const key = storeKey(raw);
  if (!key) return raw;

  const match = existing.find((e) => storeKey(e) === key);
  if (match) return match;

  if (KNOWN_STORES[key]) return KNOWN_STORES[key];
  return titleCase(raw);
}

export const storeNames = (ingredients) => [
  ...new Set((ingredients || []).map((i) => i.store).filter(Boolean)),
];

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
    stockPortions: 0,
    extraPacks: 0,
    store: "Tesco",
    packLabel: "",
    barcodes: [],
    aliases: [],
    offer: null,
    priceUpdated: "",
    updatedAt: "",
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

  const plan = Array.from({ length: 14 }, () => ({ breakfast: null, lunch: null, dinner: null }));
  plan[0].dinner = "pie-and-mash";
  plan[1].dinner = "spaghetti-bolognese";
  plan[2].dinner = "pie-and-mash";

  return { schema: SCHEMA_VERSION, ingredients, meals, plan, budget: 60, updatedAt: "" };
}

export function newIngredient(store) {
  return {
    // 1 is the safe default: a pack is one use unless you say otherwise, which
    // is right for water, kitchen roll and anything else that is not portioned.
    id: uid(), name: "New item", portionsPerPack: 1, pricePerPack: 0, stockPortions: 0,
    // Blank by default. Guessing a store puts items in the wrong group, and a
    // wrong group is harder to notice than an empty one.
    extraPacks: 0, store: store || "", packLabel: "", barcodes: [], aliases: [],
    offer: null, priceUpdated: "", updatedAt: "",
  };
}

/* Repair ids that already collided. The first keeps its id so meals still
   point at something, later ones are renamed rather than lost. */
function dedupeIds(ingredients) {
  const taken = new Set();
  return ingredients.map((i) => {
    let id = i.id || uniqueId(i.name || "item", [...taken]);
    if (taken.has(id)) id = uniqueId(i.name || id, [...taken]);
    taken.add(id);
    return { ...i, id };
  });
}

/* Offers are user-typed, so a restored snapshot may hold nonsense.
   Keep only the fields the kind actually uses. */
export function cleanOffer(o) {
  if (!o || !o.kind) return null;
  const base = { kind: o.kind, ends: o.ends || "" };
  if (o.kind === "loyalty") return { ...base, price: Number(o.price) || 0 };
  if (o.kind === "multibuy") return { ...base, qty: Number(o.qty) || 0, price: Number(o.price) || 0 };
  if (o.kind === "xfory") return { ...base, qty: Number(o.qty) || 0, pay: Number(o.pay) || 0 };
  return null;
}

/* Stock used to be counted in whole packs, so an older snapshot has
   stockPacks and no stockPortions. Multiply it out once, here, and the rest
   of the app only ever sees portions. Where portions per pack is unset a
   pack is one use, which is the same assumption new items are given. */
function stockOf(i) {
  if (i.stockPortions !== undefined && i.stockPortions !== null) return Number(i.stockPortions) || 0;
  const packs = Number(i.stockPacks) || 0;
  const pp = Number(i.portionsPerPack) || 0;
  return packs * (pp > 0 ? pp : 1);
}

/* Fill in anything an older snapshot is missing, so a restored backup
   from an earlier version does not crash the app. */
export function migrate(db) {
  if (!db || !Array.isArray(db.ingredients)) return seed();
  // A day used to be a single meal id. It is now three slots, and an old
  // single meal becomes that day's dinner.
  const plan = Array.from({ length: 14 }, (_, i) => {
    const was = Array.isArray(db.plan) ? db.plan[i] : null;
    if (was && typeof was === "object") {
      return {
        breakfast: was.breakfast || null,
        lunch: was.lunch || null,
        dinner: was.dinner || null,
      };
    }
    return { breakfast: null, lunch: null, dinner: typeof was === "string" ? was : null };
  });

  // Fold existing spelling variants together. The first spelling of each
  // store wins, so a vault that already says "Tesco" never becomes "TESCO".
  const canon = new Map();
  for (const i of db.ingredients) {
    const key = storeKey(i.store);
    if (key && !canon.has(key)) canon.set(key, canonicalStore(i.store));
  }
  const fixStore = (name) => {
    const key = storeKey(name);
    return key && canon.has(key) ? canon.get(key) : canonicalStore(name);
  };
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
    ingredients: dedupeIds(db.ingredients).map((i) => ({
      id: i.id,
      name: i.name || "Item",
      portionsPerPack: Number(i.portionsPerPack) || 0,
      pricePerPack: Number(i.pricePerPack) || 0,
      stockPortions: stockOf(i),
      extraPacks: Number(i.extraPacks) || 0,
      offer: cleanOffer(i.offer),
      store: fixStore(i.store),
      packLabel: i.packLabel || "",
      barcodes: Array.isArray(i.barcodes) ? i.barcodes : i.barcode ? [i.barcode] : [],
      aliases: Array.isArray(i.aliases) ? i.aliases : [],
      priceUpdated: i.priceUpdated || "",
      // an older snapshot has no record of edits, so the price stamp is the
      // best evidence of when the item was last touched
      updatedAt: i.updatedAt || i.priceUpdated || "",
    })),
  };
}

/* ------------------------------- merging ------------------------------- */

/* Two people sharing one file will edit it at once sooner or later. Blind
   last-write-wins loses whichever of them pushed first, so a pull merges.

   The rules are deliberately boring and explainable:
     prices   per item, whoever priced it most recently wins that item
     items    the union of both sides, nothing is dropped
     stock    the larger of the two, since a pack someone bought is real
              (in portions, both sides having been migrated above)
     meals    the union, local wins a tie
     plan     taken whole from whichever snapshot was saved last */
export function mergeSnapshots(local, remote) {
  const mine = migrate(local);
  const theirs = migrate(remote);
  const notes = { added: 0, updated: 0, kept: 0, planFrom: "local" };

  const byId = new Map(mine.ingredients.map((i) => [i.id, i]));

  for (const t of theirs.ingredients) {
    const m = byId.get(t.id);
    if (!m) {
      byId.set(t.id, t);
      notes.added += 1;
      continue;
    }
    // an empty date means never priced, so any real date beats it
    const theirsNewer = (t.priceUpdated || "") > (m.priceUpdated || "");
    const winner = theirsNewer ? t : m;
    if (theirsNewer) notes.updated += 1;
    else notes.kept += 1;

    byId.set(t.id, {
      ...winner,
      // stock and hand-added packs are physical facts, so keep the higher count
      stockPortions: Math.max(Number(m.stockPortions) || 0, Number(t.stockPortions) || 0),
      extraPacks: Math.max(Number(m.extraPacks) || 0, Number(t.extraPacks) || 0),
      barcodes: [...new Set([...(m.barcodes || []), ...(t.barcodes || [])])],
      aliases: [...new Set([...(m.aliases || []), ...(t.aliases || [])])],
      // the later edit is the truthful answer to "when was this last touched",
      // whichever side won the price
      updatedAt: (m.updatedAt || "") > (t.updatedAt || "") ? m.updatedAt : t.updatedAt,
    });
  }

  const mealIds = new Set(mine.meals.map((m) => m.id));
  const meals = [...mine.meals, ...theirs.meals.filter((m) => !mealIds.has(m.id))];

  const remoteNewer = (theirs.updatedAt || "") > (mine.updatedAt || "");
  if (remoteNewer) notes.planFrom = "remote";

  return {
    db: {
      schema: SCHEMA_VERSION,
      budget: remoteNewer ? theirs.budget : mine.budget,
      updatedAt: new Date().toISOString(),
      plan: remoteNewer ? theirs.plan : mine.plan,
      meals,
      ingredients: [...byId.values()],
    },
    notes,
  };
}

/* ------------------------------- invites -------------------------------- */

/* Everything a second phone needs to join one shared list, packed into one
   string. The point is that the other person needs no GitHub account, no
   token and no invite to the repo: one token belongs to the list, not to a
   person, and who did what is recorded from the name each device sets.

   This does mean the code carries a working token, so it is only ever shown
   on demand and the UI says plainly what handing it over grants. */

const INVITE_PREFIX = "FS1.";

const toB64url = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (b64) => {
  const padded = String(b64).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

export function makeInvite(settings) {
  const missing = ["owner", "repo", "token"].filter((k) => !String(settings[k] || "").trim());
  if (missing.length) {
    throw new Error("Connect a database first, under Database, keys and backup.");
  }
  return (
    INVITE_PREFIX +
    toB64url(
      JSON.stringify({
        v: 1,
        o: settings.owner,
        r: settings.repo,
        p: settings.path || "prices.json",
        b: settings.branch || "main",
        t: settings.token,
        n: (settings.person || "").trim(),
      })
    )
  );
}

/* Tolerant on the way in, because a code arrives via a messaging app as often
   as via the camera, and those add spaces and line breaks. */
export function readInvite(code) {
  const raw = String(code || "").trim().replace(/\s+/g, "");
  if (!raw) throw new Error("Paste the invite code first.");
  if (!raw.startsWith(INVITE_PREFIX)) {
    throw new Error("That does not look like an invite code. They start with FS1.");
  }

  let parsed;
  try {
    parsed = JSON.parse(fromB64url(raw.slice(INVITE_PREFIX.length)));
  } catch (err) {
    throw new Error("That invite code is damaged. Ask for a fresh one.");
  }

  if (!parsed || !parsed.o || !parsed.r || !parsed.t) {
    throw new Error("That invite is missing the database details.");
  }
  return {
    owner: String(parsed.o),
    repo: String(parsed.r),
    path: String(parsed.p || "prices.json"),
    branch: String(parsed.b || "main"),
    token: String(parsed.t),
    from: String(parsed.n || ""),
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
  collapsedItems: [],
  collapsedList: [],
  person: "",
  showRepo: false,
  theme: "system",
  autoMerge: true,
  warnOnLeave: true,
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
