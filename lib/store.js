/* Local-first storage.
   Two records in one IndexedDB store:
     "db"       - items, meals, plan, budget. This is what syncs to GitHub.
     "settings" - tokens and API keys. Never synced, never leaves the device. */

const DB_NAME = "fortnight-shop";
const STORE = "kv";

export const SCHEMA_VERSION = 7;

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

/* ------------------------------- products ------------------------------- */

/* Two levels, and the difference is the whole point.

   An ingredient is what a recipe asks for: "Cheddar". A product is a thing you
   can actually put in a trolley: Cathedral City at Tesco, the Asda own brand,
   Tesco Finest. One ingredient holds many products, and two of them can be in
   the same shop, because Cathedral City and Tesco Finest are both cheddar and
   both at Tesco.

   Stock lives on the product, not the ingredient. That is forced rather than
   chosen: a meal is allowed to demand one specific product, and if stock sat
   on the ingredient the app could not tell whether the block in the fridge is
   the one that meal wants. The ingredient's stock is the sum of its products',
   so pooling still works for the usual case of "any cheddar will do". */

/* Ids are derived from the name and shop rather than random, so two devices
   that both add Cathedral City at Tesco agree on one product instead of
   merging into two. */
export const productKey = (name, store) =>
  `${slug(name || "item")}-${storeKey(store) || "unassigned"}`;

export function newProduct(name, store, fields = {}) {
  return {
    id: productKey(name, store),
    name: name || "",
    store: store || "",
    pricePerPack: 0,
    // 1 is the safe default: a pack is one use unless you say otherwise
    portionsPerPack: 1,
    stockPortions: 0,
    packLabel: "",
    /* How much is in a pack, as a number and a unit rather than free text, so
       nothing has to be parsed or guessed. An empty unit means the pack has no
       useful weight: six eggs, a lettuce, a roll of kitchen towel. */
    packAmount: 0,
    packUnit: "",
    /* A portion is defined one of two ways, and whichever you do not give is
       worked out from the pack size. "count" is 4 portions in this pack;
       "weight" is a portion is 125g. Weight is what a recipe actually means. */
    portionBy: "count",
    portionGrams: 0,
    barcodes: [],
    offer: null,
    priceUpdated: "",
    /* Nutrition is stored PER 100g or 100ml, exactly as the label prints it,
       because that is the fact that does not change. Per portion is worked out
       from the portion size whenever it is needed, so changing how big a
       portion is moves the calories with it instead of leaving them stale. */
    kcal100: 0,
    protein100: 0,
    carbs100: 0,
    fat100: 0,
    nutritionUpdated: "",
    ...fields,
  };
}

/* The four macros. NUTRIENTS are the logical names used everywhere a figure is
   handled; PER100 are the fields they are stored under. The "100" suffix is
   deliberate: it makes a per-portion figure impossible to write into a
   per-100g slot by accident. */
export const NUTRIENTS = ["kcal", "protein", "carbs", "fat"];
export const PER100 = NUTRIENTS.map((k) => `${k}100`);

export const cleanNutrition = (src) =>
  Object.fromEntries(PER100.map((k) => [k, Math.max(0, Number(src && src[k]) || 0)]));

/* Read a pack size out of the free text older versions stored, so "1.5kg",
   "500 ml", "1 litre" and "6x125g" all migrate to a number and a unit. Returns
   a zero amount when there is nothing weighable in the text. */
export function parsePackSize(raw) {
  const text = String(raw || "").toLowerCase();
  const none = { amount: 0, unit: "" };
  if (!text) return none;

  const scale = (n, unit) => {
    if (unit === "kg") return { amount: n * 1000, unit: "g" };
    if (unit === "g") return { amount: n, unit: "g" };
    if (unit === "l" || unit === "litre" || unit === "litres") {
      return { amount: n * 1000, unit: "ml" };
    }
    return { amount: n, unit: "ml" };
  };
  const UNIT = "(kg|g|ml|l|litres|litre)";

  // a multipack states the count and the unit size: 6x125g is 750g
  const multi = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\b`));
  if (multi) {
    const each = scale(Number(multi[2]), multi[3]);
    return { amount: each.amount * Number(multi[1]), unit: each.unit };
  }

  const one = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\b`));
  return one ? scale(Number(one[1]), one[2]) : none;
}

/* Add or replace a product on an ingredient, matched by id. */
export function withProduct(ing, product) {
  const others = (ing.products || []).filter((p) => p.id !== product.id);
  return { ...ing, products: [...others, product] };
}

export const findProductByBarcode = (ing, code) =>
  (ing.products || []).find((p) => (p.barcodes || []).includes(code)) || null;

/* Which ingredient and product a barcode belongs to, across the whole list.
   Returns the first match, which is all most callers want. */
export function findByBarcode(ingredients, code) {
  const all = findAllByBarcode(ingredients, code);
  return all.length ? all[0] : null;
}

/* Every product carrying that barcode. The same tin has the same barcode in
   every shop, so once you record it in two places a scan is ambiguous, and
   picking the first silently would write the price onto the wrong shop. */
export function findAllByBarcode(ingredients, code) {
  if (!code) return [];
  const out = [];
  for (const ing of ingredients || []) {
    for (const product of ing.products || []) {
      if ((product.barcodes || []).includes(code)) out.push({ ing, product });
    }
  }
  return out;
}

/* Move one product under a different ingredient, which is how something files
   itself wrong and gets corrected: "Arla Lactofree" was recorded as its own
   kind of thing when it is really one of the milks you can buy.

   Mutates a draft db in place, the way commit() hands one over. Returns what
   happened so the caller can say so, or null if it could not be done.

   The awkward part is not the move itself, it is everything pointing at the
   old home. A meal asking for that ingredient has to be repointed, or it ends
   up asking for something that no longer exists. */
export function moveProduct(db, fromId, productId, toId) {
  if (!db || fromId === toId) return null;
  const from = db.ingredients.find((i) => i.id === fromId);
  const to = db.ingredients.find((i) => i.id === toId);
  if (!from || !to) return null;

  const product = (from.products || []).find((p) => p.id === productId);
  if (!product) return null;

  const stamp = new Date().toISOString();

  // an id only has to be unique within its ingredient, so it may need one here
  const moved = { ...product, id: uniqueId(product.id, (to.products || []).map((p) => p.id)) };
  to.products = [...(to.products || []), moved];
  from.products = (from.products || []).filter((p) => p.id !== productId);

  // a pin naming the product that just left is a pin at nothing
  if (from.preferredProductId === productId) from.preferredProductId = "";

  /* A meal asking for this exact product by name must follow it. One asking
     for the old ingredient in general only follows if the ingredient is being
     emptied out, since otherwise it still means the things left behind. */
  const emptied = from.products.length === 0;
  for (const meal of db.meals || []) {
    for (const it of meal.items || []) {
      if (it.ingredientId !== fromId) continue;
      if (it.productId === productId) {
        it.ingredientId = toId;
        it.productId = moved.id;
      } else if (emptied) {
        it.ingredientId = toId;
        it.productId = "";
      }
    }
  }

  from.updatedAt = stamp;
  to.updatedAt = stamp;

  /* Nothing left to buy means the old ingredient is not a thing any more. Its
     aliases are how receipts recognise this product, so they have to survive,
     and its hand-added packs are a request that has not been met yet. */
  if (emptied) {
    to.aliases = [...new Set([...(to.aliases || []), ...(from.aliases || [])])];
    to.extraPacks = (Number(to.extraPacks) || 0) + (Number(from.extraPacks) || 0);
    db.ingredients = db.ingredients.filter((i) => i.id !== fromId);
  }

  return { product: moved, from: from.name, to: to.name, removedSource: emptied };
}

/* Everything about a product except where you buy it and what it costs there.
   The same jam at a different shop is the same size, the same portions and
   the same label; only the price and the shop differ. */
export function copyToShop(product, taken = []) {
  const made = {
    ...product,
    store: "",
    pricePerPack: 0,
    // an offer belongs to one shop's shelf, so it never travels
    offer: null,
    // stock is physical, and this is a different pack in a different shop
    stockPortions: 0,
    // never priced here, so it must not inherit a stamp that says otherwise
    priceUpdated: "",
  };
  made.id = uniqueId(productKey(made.name, ""), taken);
  return made;
}

/* Receipts and shelves name products, not ingredients: "TESCO FINEST MATURE
   CHEDDAR 320G". Strip the shop and the pack size and what is left is close
   to the product's own name, which is what the app should suggest. */
export function tidyProductName(raw) {
  let name = String(raw || "").trim();
  name = name.replace(
    /^(tesco|asda|aldi|lidl|morrisons|iceland|sainsbury'?s|co-?op|waitrose|m&s|b&m)\b\s*/i,
    ""
  );
  name = name.replace(/\b(\d+(?:\.\d+)?\s*x\s*)?\d+(?:\.\d+)?\s*(kg|g|ml|cl|litres?|ltr|l)\b\.?/gi, " ");
  name = name.replace(/\b\d+\s*(pk|pack)\b/gi, " ");
  name = name.replace(/\s+/g, " ").trim().replace(/\s+\d+$/, "").trim();
  return name || String(raw || "").trim();
}

/* --------------------------- receipt line keys -------------------------- */

const STOP = new Set([
  "the", "and", "of", "with", "in", "g", "kg", "ml", "l", "cl", "pk", "pack", "packet",
  "value", "essential", "finest", "tesco", "asda", "aldi", "lidl", "sainsburys",
  "sainsbury", "morrisons", "waitrose", "coop", "co", "op",
]);

export const norm = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/* Resolve a receipt line to an ingredient, and to a product where the
   evidence allows one.

   Matching is to the ingredient first, never straight to the shop. That is
   what stops a second Cheddar appearing the first time you buy it somewhere
   else: the line finds the cheddar you already have, and the thing you bought
   becomes another product under it. */
export function resolveLine(line, ingredients) {
  const key = norm(line.name);

  if (line.barcode) {
    const hit = findByBarcode(ingredients, line.barcode);
    if (hit) {
      return { id: hit.ing.id, productId: hit.product.id, why: "barcode", confident: true };
    }
  }

  const alias = ingredients.find((i) => (i.aliases || []).includes(key));
  if (alias) {
    return { id: alias.id, productId: "", why: "seen on a previous receipt", confident: true };
  }

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
  if (best && bestScore >= 0.5) {
    return { id: best.id, productId: "", why: "name looks close", confident: false };
  }
  return { id: "", productId: "", why: "no match yet", confident: false };
}

/* Which product of an ingredient a shop's wording most likely means.
   The name it prints is the strongest clue; failing that, if the shop sells
   you only one of these, it is that one. Returns null for "something new". */
export function resolveProduct(ing, store, rawName) {
  const here = (ing.products || []).filter((p) => storeKey(p.store) === storeKey(store));
  if (!here.length) return null;

  /* Both sides get the same treatment before comparing. A product stored as
     "Tesco Finest Mature" and a receipt shouting "TESCO FINEST MATURE 320G"
     are the same thing, and only tidying one of them would miss that. */
  const tidy = (text) => norm(tidyProductName(text));
  const wanted = tidy(rawName);

  const exact = here.find((p) => tidy(p.name) === wanted);
  if (exact) return exact;

  // every word of a product's name turning up in the wording is good enough
  const contained = here.find((p) => {
    const words = tidy(p.name).split(" ").filter(Boolean);
    return words.length > 0 && words.every((w) => wanted.includes(w));
  });
  if (contained) return contained;

  return here.length === 1 ? here[0] : null;
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
   Then the known-grocer list, then plain title case.

   Prefix matching matters more than it used to. Receipts print the legal
   entity: TESCO STORES LTD, ASDA STORES LIMITED, LIDL GREAT BRITAIN. Left
   alone those used to make a second store heading, which was untidy. Now they
   would make a second price entry on the item, which is worse: the whole point
   of sources is that one shop is one price, and "Tesco Stores Ltd" sitting
   beside "Tesco" splits the thing this feature exists to keep together. */
export function canonicalStore(name, existing = []) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const key = storeKey(raw);
  if (!key) return raw;

  const match = existing.find((e) => storeKey(e) === key);
  if (match) return match;

  if (KNOWN_STORES[key]) return KNOWN_STORES[key];

  // a spelling already in your data, extended by boilerplate
  const near = existing.find((e) => {
    const k = storeKey(e);
    return k.length > 2 && (key.startsWith(k) || k.startsWith(key));
  });
  if (near) return near;

  // a known grocer, extended by boilerplate: tescostoresltd -> Tesco
  const known = Object.keys(KNOWN_STORES)
    .filter((k) => k.length > 2 && key.startsWith(k))
    // longest first, so sainsburys beats sainsbury
    .sort((a, b) => b.length - a.length)[0];
  if (known) return KNOWN_STORES[known];

  return titleCase(raw);
}

export const storeNames = (ingredients) => [
  ...new Set((ingredients || []).flatMap((i) => (i.sources || []).map((s) => s.store)).filter(Boolean)),
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
    extraPacks: 0,
    aliases: [],
    preferredProductId: "",
    updatedAt: "",
    products: [newProduct(name, "Tesco", { portionsPerPack, pricePerPack })],
  }));

  const meals = [
    { id: "pie-and-mash", name: "Pie and Mash", items: [
      { ingredientId: "pies", productId: "", portions: 2 },
      { ingredientId: "potatoes", productId: "", portions: 0.25 },
      { ingredientId: "gravy-granules", productId: "", portions: 0.25 },
    ] },
    { id: "spaghetti-bolognese", name: "Spaghetti Bolognese", items: [
      { ingredientId: "mince", productId: "", portions: 0.5 },
      { ingredientId: "pasta", productId: "", portions: 0.5 },
      { ingredientId: "passata", productId: "", portions: 0.5 },
      { ingredientId: "garlic", productId: "", portions: 0.25 },
    ] },
    { id: "chicken-stir-fry", name: "Chicken Stir Fry", items: [
      { ingredientId: "chicken", productId: "", portions: 0.5 },
      { ingredientId: "stir-fry-veg", productId: "", portions: 0.5 },
      { ingredientId: "soy-sauce", productId: "", portions: 0.25 },
      { ingredientId: "noodles", productId: "", portions: 0.5 },
    ] },
  ];

  /* Seed data is handed straight to the app without going through migrate, so
     it has to be written in the current shape: a slot holds one meal per
     person. One person is planned, which keeps the spreadsheet's £12.60. */
  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].dinner = ["pie-and-mash", null];
  plan[1].dinner = ["spaghetti-bolognese", null];
  plan[2].dinner = ["pie-and-mash", null];

  return {
    schema: SCHEMA_VERSION,
    ingredients,
    meals,
    plan,
    people: ["Person 1", "Person 2"],
    planStart: "",
    budget: 60,
    updatedAt: "",
  };
}

export function newIngredient(store, name = "New item") {
  return {
    id: uid(),
    name,
    extraPacks: 0,
    aliases: [],
    preferredProductId: "",
    updatedAt: "",
    // One product from the start, because an ingredient with nothing to buy
    // cannot produce a pack count. Its shop is blank unless we genuinely know
    // it: guessing files things in the wrong place, which is harder to spot
    // than an obviously empty one.
    products: [newProduct(name, store || "")],
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

/* Every shape this data has ever had, folded forward.

   v4 and earlier  price, pack size, offer and barcodes sat on the item, which
                   is to say an item was a product rather than an ingredient
   v5              those moved to a source per shop, one shop one entry
   v6              sources become named products, several allowed per shop,
                   and stock moves down onto the product

   Nothing needs re-entering at any step. A v4 item becomes an ingredient with
   one product; a v5 source becomes a product named after its ingredient. */
/* Nutrition moved from per portion to per 100g at v7. Convert rather than
   discard, and never change what the app shows you.

   Where the pack size and the portion count are both known the conversion is
   exact: a 300g portion at 120kcal was 40kcal per 100g. Where they are not,
   there is nothing to divide by, so the old per-portion figures are carried
   across as if a portion were 100g. Every displayed figure stays identical and
   the product simply says its portion is 100g, which you can correct. Losing
   the numbers, or silently rescaling them by a guess, would both be worse. */
function nutritionFrom(p, size, portionsPerPack) {
  // already per 100: a v7 product, or one that has been round-tripped
  if (PER100.some((k) => Number(p[k]) > 0)) {
    return { ...cleanNutrition(p), portionGrams: Math.max(0, Number(p.portionGrams) || 0) };
  }

  const old = Object.fromEntries(NUTRIENTS.map((k) => [k, Math.max(0, Number(p[k]) || 0)]));
  if (!NUTRIENTS.some((k) => old[k] > 0)) return cleanNutrition({});

  const grams = size.amount > 0 && portionsPerPack > 0 ? size.amount / portionsPerPack : 0;
  if (grams > 0) {
    return Object.fromEntries(
      NUTRIENTS.map((k) => [`${k}100`, Math.round((old[k] * 100) / grams * 100) / 100])
    );
  }
  return {
    ...Object.fromEntries(NUTRIENTS.map((k) => [`${k}100`, old[k]])),
    portionBy: "weight",
    portionGrams: 100,
  };
}

function productsFrom(i, fixStore) {
  const named = (list, fallbackName) =>
    list.map((p) => {
      const store = fixStore(p.store);
      const name = p.name || fallbackName || "Item";
      const portionsPerPack = Number(p.portionsPerPack) || 0;

      /* Pack size was free text until v7. Read it once here so nothing has to
         parse it again, and keep the text as a note since it may say more than
         a number can ("6 x 125g", "family size"). */
      const size =
        Number(p.packAmount) > 0 && p.packUnit
          ? { amount: Number(p.packAmount), unit: p.packUnit }
          : parsePackSize(p.packLabel);

      return {
        id: p.id && p.name ? p.id : productKey(name, store),
        name,
        store,
        pricePerPack: Number(p.pricePerPack) || 0,
        portionsPerPack,
        stockPortions: Math.max(0, Number(p.stockPortions) || 0),
        packLabel: p.packLabel || "",
        packAmount: Math.max(0, size.amount),
        packUnit: ["g", "ml"].includes(size.unit) ? size.unit : "",
        portionBy: p.portionBy === "weight" ? "weight" : "count",
        portionGrams: Math.max(0, Number(p.portionGrams) || 0),
        barcodes: Array.isArray(p.barcodes) ? p.barcodes : [],
        offer: cleanOffer(p.offer),
        priceUpdated: p.priceUpdated || "",
        ...nutritionFrom(p, size, portionsPerPack),
        nutritionUpdated: p.nutritionUpdated || "",
      };
    });

  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  };

  if (Array.isArray(i.products) && i.products.length) {
    return dedupe(named(i.products, i.name));
  }

  /* v5: one source per shop, stock pooled on the ingredient. The stock has to
     land somewhere, so it goes on the product the list would have sent you to,
     which keeps the ingredient's total identical. */
  if (Array.isArray(i.sources) && i.sources.length) {
    const products = dedupe(named(i.sources, i.name));
    const pooled = Math.max(0, Number(i.stockPortions) || 0);
    if (pooled > 0) {
      const pinned = products.find((p) => p.id === i.preferredSourceId);
      const priced = products.filter((p) => p.pricePerPack > 0 && p.portionsPerPack > 0);
      const holder =
        pinned ||
        (priced.length
          ? priced.reduce((best, p) =>
              p.pricePerPack / p.portionsPerPack < best.pricePerPack / best.portionsPerPack ? p : best
            )
          : products[0]);
      holder.stockPortions += pooled;
    }
    return products;
  }

  /* v4 and earlier: everything was on the item. Pass it through the same
     normaliser as every other version rather than building it by hand, or the
     fields added since would quietly never be filled in. */
  return named(
    [
      {
        name: i.name || "Item",
        store: i.store,
        pricePerPack: Number(i.pricePerPack) || 0,
        portionsPerPack: Number(i.portionsPerPack) || 0,
        stockPortions: stockOf(i),
        packLabel: i.packLabel || "",
        barcodes: Array.isArray(i.barcodes) ? i.barcodes : i.barcode ? [i.barcode] : [],
        offer: i.offer,
        priceUpdated: i.priceUpdated || "",
      },
    ],
    i.name
  );
}

/* Fill in anything an older snapshot is missing, so a restored backup
   from an earlier version does not crash the app. */
export function migrate(db) {
  if (!db || !Array.isArray(db.ingredients)) return seed();
  const from = Number(db.schema) || 0;

  /* A day used to be a single meal id, then three slots, and is now three
     slots with a place for each person. Two people eating the same thing is
     the normal case, so an older plan puts its meal in both places rather
     than leaving one of them staring at an empty evening. */
  const pair = (was) => {
    if (Array.isArray(was)) return [was[0] || null, was[1] || null];
    const one = typeof was === "string" ? was : null;
    // before v6 a planned meal fed everybody, so it belongs to both
    return from < 6 ? [one, one] : [one, null];
  };

  const plan = Array.from({ length: 14 }, (_, i) => {
    const was = Array.isArray(db.plan) ? db.plan[i] : null;
    if (was && typeof was === "object" && !Array.isArray(was)) {
      return { breakfast: pair(was.breakfast), lunch: pair(was.lunch), dinner: pair(was.dinner) };
    }
    return { breakfast: pair(null), lunch: pair(null), dinner: pair(typeof was === "string" ? was : null) };
  });

  /* Portions used to describe a whole household. Now that a meal sits in one
     person's slot it describes one serving, so halving keeps every total
     identical while giving the number its new meaning. Done once, on the way
     to v6, and the plan above puts the meal in both slots to match. */
  const perPerson = (portions) => (from < 6 ? (Number(portions) || 0) / 2 : Number(portions) || 0);

  // Fold existing spelling variants together. The first spelling of each
  // store wins, so a vault that already says "Tesco" never becomes "TESCO".
  const canon = new Map();
  const remember = (name) => {
    const key = storeKey(name);
    if (key && !canon.has(key)) canon.set(key, canonicalStore(name));
  };
  for (const i of db.ingredients) {
    remember(i.store);
    for (const p of i.products || i.sources || []) remember(p.store);
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
    people: Array.isArray(db.people)
      ? [String(db.people[0] || "Person 1"), String(db.people[1] || "Person 2")]
      : ["Person 1", "Person 2"],
    // empty until set, rather than guessing which fortnight you meant
    planStart: typeof db.planStart === "string" ? db.planStart : "",
    meals: (db.meals || []).map((m) => ({
      id: m.id || uid(),
      name: m.name || "Meal",
      items: (m.items || [])
        .filter((it) => it && it.ingredientId)
        .map((it) => ({
          ingredientId: it.ingredientId,
          // blank means any product of that ingredient will do
          productId: it.productId || "",
          portions: perPerson(it.portions),
          /* A recipe line can be written either way. "grams" is what a recipe
             actually says, and is converted to portions for the shopping list
             using that product's portion size. Portions stay the default,
             since not everything worth planning has a weight. */
          by: it.by === "grams" ? "grams" : "portions",
          grams: Math.max(0, Number(it.grams) || 0),
        })),
    })),
    ingredients: dedupeIds(db.ingredients).map((i) => {
      const products = productsFrom(i, fixStore);
      const pin = i.preferredProductId || i.preferredSourceId || "";
      return {
        id: i.id,
        name: i.name || "Item",
        extraPacks: Number(i.extraPacks) || 0,
        aliases: Array.isArray(i.aliases) ? i.aliases : [],
        // a pin pointing at something this ingredient no longer has would
        // silently fall back to cheapest, so drop it rather than dangle
        preferredProductId: products.some((p) => p.id === pin) ? pin : "",
        // an older snapshot has no record of edits, so the price stamp is the
        // best evidence of when the item was last touched
        updatedAt: i.updatedAt || i.priceUpdated || "",
        products,
      };
    }),
  };
}

/* ------------------------------- merging ------------------------------- */

/* Two people sharing one file will edit it at once sooner or later. Blind
   last-write-wins loses whichever of them pushed first, so a pull merges.

   The rules are deliberately boring and explainable:
     prices   per product, whoever priced that one most recently wins it
     products the union, since something one of you found is real information
     stock    per product, the higher of the two
     items    the union of both sides, nothing is dropped
     stock    the larger of the two, since a pack someone bought is real
              (in portions, both sides having been migrated above)
     meals    the union, local wins a tie
     plan     taken whole from whichever snapshot was saved last

   Sources merging per shop rather than per item is what makes two people
   shopping in different places work: you price the Aldi cheddar, they price
   the Tesco one, and both survive instead of the later push winning. */
/* One shop's price is one shop's business: the two lists are combined by
   shop, and only where both know a shop does the more recent stamp decide.
   An empty stamp means never priced, so any real date beats it. */
function mergeProducts(mine, theirs) {
  const byId = new Map((mine || []).map((p) => [p.id, p]));
  for (const t of theirs || []) {
    const m = byId.get(t.id);
    if (!m) {
      byId.set(t.id, t);
      continue;
    }
    const winner = (t.priceUpdated || "") > (m.priceUpdated || "") ? t : m;
    /* Nutrition has its own clock. A shop trip updates the price and nothing
       else, so the newer price must not drag a blank label back over one the
       other phone actually read. */
    const fed = PER100.some((k) => Number(m[k]) > 0) ? m : null;
    const theirFed = PER100.some((k) => Number(t[k]) > 0) ? t : null;
    const label =
      fed && theirFed
        ? (t.nutritionUpdated || "") > (m.nutritionUpdated || "")
          ? t
          : m
        : fed || theirFed || m;
    byId.set(t.id, {
      ...winner,
      // a pack someone bought is a physical fact, whoever won the price
      stockPortions: Math.max(Number(m.stockPortions) || 0, Number(t.stockPortions) || 0),
      // a barcode either of you scanned is worth keeping
      barcodes: [...new Set([...(m.barcodes || []), ...(t.barcodes || [])])],
      ...cleanNutrition(label),
      nutritionUpdated: label.nutritionUpdated || "",
    });
  }
  return [...byId.values()];
}

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
    // the later edit to the item as a whole decides its name and pin
    const theirsNewer = (t.updatedAt || "") > (m.updatedAt || "");
    const winner = theirsNewer ? t : m;
    if (theirsNewer) notes.updated += 1;
    else notes.kept += 1;

    byId.set(t.id, {
      ...winner,
      products: mergeProducts(m.products, t.products),
      // stock and hand-added packs are physical facts, so keep the higher count
      extraPacks: Math.max(Number(m.extraPacks) || 0, Number(t.extraPacks) || 0),
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
      people: remoteNewer ? theirs.people : mine.people,
      planStart: remoteNewer ? theirs.planStart : mine.planStart,
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
  // "store" groups the Items tab by shop, "name" is one flat A to Z list
  itemSort: "store",
  // "all" or "stock": whether the Meals tab hides what you cannot cook now
  mealFilter: "all",
  collapsedList: [],
  person: "",
  showRepo: false,
  theme: "system",
  autoMerge: true,
  warnOnLeave: true,
};

/* A read that failed is not an empty database, and nothing else in this file
   matters as much as the difference. Swallowing the failure and returning the
   seed put eleven demo items on screen in place of a real list, and the next
   edit then saved those eleven over the record still sitting there unread. So
   a failure is raised for the caller to show, and no automatic save happens
   until a read has actually succeeded. */
let everRead = false;

export async function loadDb() {
  const stored = await get("db");
  everRead = true;
  return stored ? migrate(stored) : seed();
}

/* force is for the saves you asked for by name, restoring a backup or
   resetting, which must still work when the read failed. Everything else is
   the app saving on your behalf, and that stays quiet until it knows what is
   already there. */
export async function saveDb(db, force = false) {
  if (!everRead && !force) {
    throw new Error("Not saving: the local database has not been read yet.");
  }
  return put("db", db);
}

export async function loadSettings() {
  const stored = await get("settings").catch(() => null);
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

export const saveSettings = (s) => put("settings", s);
