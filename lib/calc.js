/* Shopping maths, ported straight from the spreadsheet.
   Portions needed -> minus what is in stock -> rounded up to whole packs. */

export const STALE_DAYS = 14;

export const money = (n) => (Number.isFinite(n) ? n : 0).toFixed(2);
export const today = () => new Date().toISOString().slice(0, 10);

export function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso + "T00:00:00").getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}

export function portionCost(ing) {
  const pp = Number(ing.portionsPerPack) || 0;
  return pp > 0 ? (Number(ing.pricePerPack) || 0) / pp : 0;
}

export function mealCost(meal, byId) {
  return meal.items.reduce((sum, it) => {
    const ing = byId[it.ingredientId];
    return ing ? sum + portionCost(ing) * (Number(it.portions) || 0) : sum;
  }, 0);
}

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
      // 1e-9 guards float noise so 2.0 portions never rounds up to 3 packs
      const packs = pp > 0 ? Math.ceil(deficit / pp - 1e-9) : 0;
      const cost = packs * (Number(ing.pricePerPack) || 0);
      return {
        ing,
        needed,
        stock,
        deficit,
        packs,
        cost,
        leftover: stock + packs * pp - needed,
        stale: daysSince(ing.priceUpdated) > STALE_DAYS,
      };
    })
    .filter((l) => l.packs > 0);

  const stores = new Map();
  for (const l of lines) {
    const key = l.ing.store || "Unassigned";
    if (!stores.has(key)) stores.set(key, { name: key, lines: [], total: 0 });
    const s = stores.get(key);
    s.lines.push(l);
    s.total += l.cost;
  }

  return {
    need,
    lines,
    dayCost,
    total: lines.reduce((a, l) => a + l.cost, 0),
    stores: [...stores.values()].sort((a, b) => b.total - a.total),
    staleCount: lines.filter((l) => l.stale).length,
    plannedDays: db.plan.filter(Boolean).length,
  };
}
