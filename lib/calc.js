/* Shopping maths, ported from the spreadsheet and extended for offers.

   Two different prices matter and they are deliberately kept apart:
     base price     what one pack costs at the shelf, no card, no deal
     effective      what you actually pay, once a loyalty price applies

   Loyalty prices apply per pack, so they feed portion costs and meal costs.
   Multibuys depend on how many packs you buy, so they only affect the
   shopping list total. A meal is not cheaper because you bought three. */

export const STALE_DAYS = 14;
export const SLOT_KEYS = ["breakfast", "lunch", "dinner"];

export const money = (n) => (Number.isFinite(n) ? n : 0).toFixed(2);
export const today = () => new Date().toISOString().slice(0, 10);

/* Stamps come in two shapes and both are kept on purpose. A receipt knows only
   the day it was printed, while an edit made by hand knows the minute. Both
   are ISO, so the date is always the first ten characters and the two still
   sort against each other correctly. */
export const now = () => new Date().toISOString();
export const dayOf = (stamp) => String(stamp || "").slice(0, 10);

/* True when the first stamp is on an earlier day than the second. Compared by
   day rather than to the minute, so a receipt photographed the same afternoon
   you corrected a price is not treated as older than that correction. */
export function isEarlierDay(a, b) {
  const left = dayOf(a);
  const right = dayOf(b);
  return !!left && !!right && left < right;
}

export function daysSince(iso) {
  if (!iso) return Infinity;
  // tolerant of a full timestamp, which is what a manual edit now records
  const t = new Date(dayOf(iso) + "T00:00:00").getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}

/* ------------------------------- offers -------------------------------- */

/* Returns the offer only if it is usable today, otherwise null.
   An expired offer must never quietly keep discounting the budget. */
export function activeOffer(ing) {
  const o = ing && ing.offer;
  if (!o || !o.kind) return null;
  if (o.ends && o.ends < today()) return null;
  const price = Number(o.price) || 0;
  const qty = Number(o.qty) || 0;
  const pay = Number(o.pay) || 0;
  if (o.kind === "loyalty") return price > 0 ? o : null;
  if (o.kind === "multibuy") return qty > 1 && price > 0 ? o : null;
  if (o.kind === "xfory") return qty > 1 && pay > 0 && pay < qty ? o : null;
  return null;
}

export function offerExpired(ing) {
  const o = ing && ing.offer;
  return !!(o && o.kind && o.ends && o.ends < today());
}

/* What one pack costs, ignoring quantity deals. */
export function unitPrice(ing) {
  const o = activeOffer(ing);
  if (o && o.kind === "loyalty") return Number(o.price) || 0;
  return Number(ing.pricePerPack) || 0;
}

/* What n packs cost, with quantity deals applied to whole groups only. */
export function packCost(ing, packs) {
  const base = Number(ing.pricePerPack) || 0;
  const n = Math.max(0, Math.round(packs));
  const o = activeOffer(ing);
  if (!o) return n * base;
  if (o.kind === "loyalty") return n * (Number(o.price) || 0);

  const qty = Number(o.qty);
  const groups = Math.floor(n / qty);
  const rest = n % qty;
  if (o.kind === "multibuy") return groups * (Number(o.price) || 0) + rest * base;
  if (o.kind === "xfory") return (groups * (Number(o.pay) || 0) + rest) * base;
  return n * base;
}

/* Plain English for what an offer means at the till, because "3 for £8"
   and "£2.67 each" are easy to conflate and cost very different money. */
export function offerMeaning(ing) {
  const o = activeOffer(ing);
  const base = Number(ing.pricePerPack) || 0;
  if (!o) return "";
  if (o.kind === "loyalty")
    return `Every pack costs £${money(o.price)}, however many you buy.`;
  if (o.kind === "multibuy")
    return `One pack still costs £${money(base)}. Only at ${o.qty} does the deal apply, making ${
      o.qty
    } cost £${money(o.price)} instead of £${money(o.qty * base)}.`;
  if (o.kind === "xfory")
    return `One pack still costs £${money(base)}. Only at ${o.qty} does the deal apply, making ${
      o.qty
    } cost £${money(o.pay * base)} instead of £${money(o.qty * base)}.`;
  return "";
}

export function offerLabel(ing) {
  const o = activeOffer(ing);
  if (!o) return "";
  if (o.kind === "loyalty") return `loyalty £${money(o.price)}`;
  if (o.kind === "multibuy") return `${o.qty} for £${money(o.price)}`;
  if (o.kind === "xfory") return `${o.qty} for the price of ${o.pay}`;
  return "";
}

export function portionCost(ing) {
  const pp = Number(ing.portionsPerPack) || 0;
  return pp > 0 ? unitPrice(ing) / pp : 0;
}

/* ------------------------------- stock --------------------------------- */

/* Stock is counted in portions, not packs, because an opened pack is the
   normal case. Four portions per pack with two left is two portions of
   stock, so a meal wanting four still needs a whole pack bought. */
export function stockPortions(ing) {
  return Math.max(0, Number(ing && ing.stockPortions) || 0);
}

/* Portions expressed as packs, for the bits of the app that still speak in
   packs: shelves, receipts and trolleys. Zero portions per pack has no
   answer, so say so rather than dividing by zero. */
export function stockPacks(ing) {
  const pp = Number(ing && ing.portionsPerPack) || 0;
  return pp > 0 ? stockPortions(ing) / pp : 0;
}

/* One pack's worth of portions. Falls back to 1 so a pack always moves the
   count by something, even on an item whose portions are not set yet. */
export function packPortions(ing) {
  const pp = Number(ing && ing.portionsPerPack) || 0;
  return pp > 0 ? pp : 1;
}

export function mealCost(meal, byId) {
  return meal.items.reduce((sum, it) => {
    const ing = byId[it.ingredientId];
    return ing ? sum + portionCost(ing) * (Number(it.portions) || 0) : sum;
  }, 0);
}

/* ---------------------------- shopping list ---------------------------- */

export function computeShopping(db) {
  const byId = Object.fromEntries(db.ingredients.map((i) => [i.id, i]));
  const mealById = Object.fromEntries(db.meals.map((m) => [m.id, m]));
  const need = {};
  const dayCost = Array(db.plan.length).fill(0);

  let plannedMeals = 0;

  db.plan.forEach((day, idx) => {
    SLOT_KEYS.forEach((slot) => {
      const mealId = day && day[slot];
      const meal = mealId ? mealById[mealId] : null;
      if (!meal) return;
      plannedMeals += 1;
      meal.items.forEach(({ ingredientId, portions }) => {
        const ing = byId[ingredientId];
        if (!ing) return;
        const p = Number(portions) || 0;
        need[ingredientId] = (need[ingredientId] || 0) + p;
        dayCost[idx] += portionCost(ing) * p;
      });
    });
  });

  const lines = db.ingredients
    .map((ing) => {
      const pp = Number(ing.portionsPerPack) || 0;
      const needed = need[ing.id] || 0;
      // stock is already in portions, so a part-used pack counts for what is
      // actually left in it rather than for the whole pack
      const stock = stockPortions(ing);
      const deficit = Math.max(0, needed - stock);
      // 1e-9 guards float noise so 2.0 portions never rounds up to an extra pack
      const planned = pp > 0 ? Math.ceil(deficit / pp - 1e-9) : 0;
      const extra = Math.max(0, Number(ing.extraPacks) || 0);
      const packs = planned + extra;

      const cost = packCost(ing, packs);
      const full = packs * (Number(ing.pricePerPack) || 0);

      return {
        ing,
        needed,
        stock,
        deficit,
        planned,
        extra,
        packs,
        cost,
        saving: Math.max(0, full - cost),
        offer: offerLabel(ing),
        expired: offerExpired(ing),
        leftover: stock + planned * pp - needed,
        stale: daysSince(ing.priceUpdated) > STALE_DAYS,
      };
    })
    .filter((l) => l.packs > 0);

  const stores = new Map();
  for (const l of lines) {
    const label = l.ing.store || "Unassigned";
    const key = label.toLowerCase();
    if (!stores.has(key)) stores.set(key, { name: label, lines: [], total: 0, saving: 0 });
    const s = stores.get(key);
    s.lines.push(l);
    s.total += l.cost;
    s.saving += l.saving;
  }

  // An item a meal needs but with no portions per pack can never produce a
  // pack count, so it would drop off the list in silence. Name it instead.
  const problems = db.ingredients.filter(
    (ing) => (need[ing.id] || 0) > 0 && !((Number(ing.portionsPerPack) || 0) > 0)
  );

  return {
    need,
    problems,
    lines,
    dayCost,
    total: lines.reduce((a, l) => a + l.cost, 0),
    saving: lines.reduce((a, l) => a + l.saving, 0),
    stores: [...stores.values()].sort((a, b) => b.total - a.total),
    staleCount: lines.filter((l) => l.stale).length,
    expiredCount: db.ingredients.filter(offerExpired).length,
    plannedDays: db.plan.filter((d) => d && SLOT_KEYS.some((k) => d[k])).length,
    plannedMeals,
    totalSlots: db.plan.length * SLOT_KEYS.length,
  };
}

/* ------------------------------- search -------------------------------- */

/* Subsequence match, so "chkkrm" finds "Chicken Korma" and a typo does not
   send you scrolling. Scores favour matches at the start of a word and
   characters that land next to each other. */
export function fuzzyScore(query, text) {
  const q = String(query || "").toLowerCase().trim();
  const t = String(text || "").toLowerCase();
  if (!q) return 1;
  if (!t) return 0;
  if (t.includes(q)) return t.startsWith(q) ? 1 : 0.9;

  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    let found = -1;
    for (let i = ti; i < t.length; i += 1) {
      if (t[i] === ch) { found = i; break; }
    }
    if (found === -1) return 0;
    const atWordStart = found === 0 || t[found - 1] === " " || t[found - 1] === "-";
    run = found === ti ? run + 1 : 0;
    score += 1 + run * 0.6 + (atWordStart ? 0.8 : 0);
    ti = found + 1;
  }
  // longer haystacks are weaker matches for the same query
  return Math.min(0.85, (score / (q.length * 2.4)) * (q.length / Math.max(q.length, t.length / 3)));
}

/* Search across everything that identifies an item, not just its name, so a
   barcode typed in or a receipt's wording finds it too. */
export function searchItems(query, ingredients) {
  const q = String(query || "").trim();
  if (!q) return ingredients;
  return ingredients
    .map((ing) => {
      const fields = [
        [ing.name, 1],
        [ing.store, 0.5],
        [ing.packLabel, 0.4],
        [(ing.barcodes || []).join(" "), 0.7],
        [(ing.aliases || []).join(" "), 0.6],
      ];
      const best = Math.max(...fields.map(([text, weight]) => fuzzyScore(q, text) * weight));
      return { ing, score: best };
    })
    .filter((r) => r.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.ing);
}

/* ------------------------------- clocks -------------------------------- */

/* Always show UK wall-clock time. Stored stamps are UTC, so through the
   summer a raw slice reads an hour early. */
export function ukTime(iso, withDate = true) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      ...(withDate ? { day: "2-digit", month: "short" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
  } catch (err) {
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

/* "just now", "12 minutes ago", "yesterday". Easier to judge than a stamp. */
export function ago(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/* Items grouped by store for the Items tab, alphabetical within each. */
export function groupByStore(ingredients) {
  const stores = new Map();
  for (const ing of ingredients) {
    const label = ing.store || "Unassigned";
    // group case-insensitively as a backstop, in case a variant slips through
    const key = label.toLowerCase();
    if (!stores.has(key)) stores.set(key, { name: label, items: [] });
    stores.get(key).items.push(ing);
  }
  return [...stores.values()]
    .map((s) => ({ ...s, items: s.items.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => {
      // items with no store go first, so they are noticed and assigned
      if (a.name === "Unassigned") return -1;
      if (b.name === "Unassigned") return 1;
      return a.name.localeCompare(b.name);
    });
}
