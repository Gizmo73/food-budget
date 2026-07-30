/* Shopping maths, ported from the spreadsheet and extended for offers.

   Two different prices matter and they are deliberately kept apart:
     base price     what one pack costs at the shelf, no card, no deal
     effective      what you actually pay, once a loyalty price applies

   Loyalty prices apply per pack, so they feed portion costs and meal costs.
   Multibuys depend on how many packs you buy, so they only affect the
   shopping list total. A meal is not cheaper because you bought three. */

export const STALE_DAYS = 14;

export const money = (n) => (Number.isFinite(n) ? n : 0).toFixed(2);
export const today = () => new Date().toISOString().slice(0, 10);

export function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso + "T00:00:00").getTime();
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

  db.plan.forEach((mealId, idx) => {
    const meal = mealId ? mealById[mealId] : null;
    if (!meal) return;
    meal.items.forEach(({ ingredientId, portions }) => {
      const ing = byId[ingredientId];
      if (!ing) return;
      const p = Number(portions) || 0;
      need[ingredientId] = (need[ingredientId] || 0) + p;
      dayCost[idx] += portionCost(ing) * p;
    });
  });

  const lines = db.ingredients
    .map((ing) => {
      const pp = Number(ing.portionsPerPack) || 0;
      const needed = need[ing.id] || 0;
      const stock = (Number(ing.stockPacks) || 0) * pp;
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
    plannedDays: db.plan.filter(Boolean).length,
  };
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
    .sort((a, b) => a.name.localeCompare(b.name));
}
