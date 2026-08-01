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

/* ------------------------------ products -------------------------------- */

/* An ingredient is what a recipe asks for, a product is what you can put in a
   trolley. "Cheddar" is the ingredient; Cathedral City at Tesco, Tesco Finest
   at Tesco and the Asda own brand are three of its products.

   Stock sits on the product, because a meal may demand one specific product
   and the app has to be able to answer "have I got that one". The ingredient's
   stock is simply the sum, so "any cheddar will do" still pools. */

export const productsOf = (ing) => (ing && Array.isArray(ing.products) ? ing.products : []);

export const productById = (ing, id) => productsOf(ing).find((p) => p.id === id) || null;

/* Where the list will send you for this ingredient: the product you pinned,
   otherwise the cheapest by portion. Something with no price cannot win,
   since free is not a price. */
export function chooseProduct(ing) {
  const all = productsOf(ing);
  if (!all.length) return null;

  const pinned = ing.preferredProductId ? all.find((p) => p.id === ing.preferredProductId) : null;
  if (pinned && unitPrice(pinned) > 0) return pinned;

  const priced = all.filter((p) => unitPrice(p) > 0 && (Number(p.portionsPerPack) || 0) > 0);
  if (!priced.length) return all.find((p) => unitPrice(p) > 0) || all[0];

  return priced.reduce((best, p) => (productPortionCost(p) < productPortionCost(best) ? p : best));
}

export const isPinned = (ing, product) =>
  !!(product && ing && ing.preferredProductId === product.id);

/* What one portion costs from a given product. */
export function productPortionCost(product) {
  const pp = Number(product && product.portionsPerPack) || 0;
  return pp > 0 ? unitPrice(product) / pp : 0;
}

/* One pack's worth of portions, 1 where it is not set so a pack always moves
   the count by something. */
export function packPortions(product) {
  const pp = Number(product && product.portionsPerPack) || 0;
  return pp > 0 ? pp : 1;
}

/* How much dearer the alternatives are, for the line on the list. */
export function cheaperThan(ing) {
  const chosen = chooseProduct(ing);
  if (!chosen) return null;
  const others = productsOf(ing).filter(
    (p) => p !== chosen && unitPrice(p) > 0 && (Number(p.portionsPerPack) || 0) > 0
  );
  if (!others.length) return null;
  const dearest = others.reduce((worst, p) =>
    productPortionCost(p) > productPortionCost(worst) ? p : worst
  );
  return {
    count: productsOf(ing).filter((p) => unitPrice(p) > 0).length,
    against: dearest,
    perPortion: productPortionCost(dearest) - productPortionCost(chosen),
  };
}

/* ------------------------------- offers -------------------------------- */

/* Returns the offer only if it is usable today, otherwise null.
   An expired offer must never quietly keep discounting the budget. */
export function activeOffer(src) {
  const o = src && src.offer;
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

export function offerExpired(src) {
  const o = src && src.offer;
  return !!(o && o.kind && o.ends && o.ends < today());
}

/* True when any shop's offer has quietly ended. */
export const anyOfferExpired = (ing) => productsOf(ing).some(offerExpired);

/* What one pack costs, ignoring quantity deals. */
export function unitPrice(src) {
  if (!src) return 0;
  const o = activeOffer(src);
  if (o && o.kind === "loyalty") return Number(o.price) || 0;
  return Number(src.pricePerPack) || 0;
}

/* What n packs cost, with quantity deals applied to whole groups only. */
export function packCost(src, packs) {
  const base = Number(src && src.pricePerPack) || 0;
  const n = Math.max(0, Math.round(packs));
  const o = activeOffer(src);
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
export function offerMeaning(src) {
  const o = activeOffer(src);
  const base = Number(src && src.pricePerPack) || 0;
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

export function offerLabel(src) {
  const o = activeOffer(src);
  if (!o) return "";
  if (o.kind === "loyalty") return `loyalty £${money(o.price)}`;
  if (o.kind === "multibuy") return `${o.qty} for £${money(o.price)}`;
  if (o.kind === "xfory") return `${o.qty} for the price of ${o.pay}`;
  return "";
}

/* What a portion of this ingredient costs, from wherever it would be bought. */
export function portionCost(ing) {
  return productPortionCost(chooseProduct(ing));
}

/* What a meal item costs: the specific product if it names one, otherwise
   whatever the ingredient would be bought as. */
export function itemPortionCost(ing, productId) {
  if (!ing) return 0;
  const specific = productId ? productById(ing, productId) : null;
  return productPortionCost(specific || chooseProduct(ing));
}

/* ------------------------------- stock --------------------------------- */

/* Stock is counted in portions, not packs, because an opened pack is the
   normal case. Four portions per pack with two left is two portions of stock,
   so a meal wanting four still needs a whole pack bought. */
export function productStock(product) {
  return Math.max(0, Number(product && product.stockPortions) || 0);
}

/* Everything of this ingredient in the house, wherever it came from. */
export function stockPortions(ing) {
  return productsOf(ing).reduce((sum, p) => sum + productStock(p), 0);
}

/* Portions expressed as packs, for the bits of the app that speak in packs:
   shelves, receipts and trolleys. */
export function stockPacks(ing, product) {
  const target = product || chooseProduct(ing);
  const pp = Number(target && target.portionsPerPack) || 0;
  return pp > 0 ? productStock(target) / pp : 0;
}

export function mealCost(meal, byId) {
  return meal.items.reduce((sum, it) => {
    const ing = byId[it.ingredientId];
    return ing ? sum + itemPortionCost(ing, it.productId) * (Number(it.portions) || 0) : sum;
  }, 0);
}

/* ---------------------------- shopping list ---------------------------- */

export function computeShopping(db) {
  const byId = Object.fromEntries(db.ingredients.map((i) => [i.id, i]));
  const mealById = Object.fromEntries(db.meals.map((m) => [m.id, m]));
  /* Two kinds of demand, kept apart because they are satisfied differently.
     "Any cheddar" can be met by anything in the house; "that cheddar" can only
     be met by that product's own stock. */
  const need = {};
  const needProduct = {};
  const dayCost = Array(db.plan.length).fill(0);

  let plannedMeals = 0;

  db.plan.forEach((day, idx) => {
    SLOT_KEYS.forEach((slot) => {
      // each slot holds one meal per person
      const forSlot = day && day[slot];
      const chosen = Array.isArray(forSlot) ? forSlot : [forSlot];
      chosen.forEach((mealId) => {
        const meal = mealId ? mealById[mealId] : null;
        if (!meal) return;
        plannedMeals += 1;
        meal.items.forEach(({ ingredientId, productId, portions }) => {
          const ing = byId[ingredientId];
          if (!ing) return;
          const p = Number(portions) || 0;
          if (productId && productById(ing, productId)) {
            const key = `${ingredientId}|${productId}`;
            needProduct[key] = (needProduct[key] || 0) + p;
          } else {
            need[ingredientId] = (need[ingredientId] || 0) + p;
          }
          dayCost[idx] += itemPortionCost(ing, productId) * p;
        });
      });
    });
  });

  const lines = [];
  const problems = [];

  for (const ing of db.ingredients) {
    const products = productsOf(ing);
    const wanted = need[ing.id] || 0;

    /* Named demands come first and eat their own product's stock. What they
       cannot eat is still in the house for "any" to use. */
    let spokenFor = 0;
    const buys = new Map();
    for (const product of products) {
      const asked = needProduct[`${ing.id}|${product.id}`] || 0;
      if (!asked) continue;
      const have = productStock(product);
      spokenFor += Math.min(asked, have);
      const short = Math.max(0, asked - have);
      if (short > 0) buys.set(product.id, { product, needed: asked, stock: have, deficit: short });
    }

    const loose = Math.max(0, stockPortions(ing) - spokenFor);
    const shortfall = Math.max(0, wanted - loose);
    const chosen = chooseProduct(ing);
    if (shortfall > 0 && chosen) {
      const at = buys.get(chosen.id);
      if (at) {
        at.needed += wanted;
        at.deficit += shortfall;
      } else {
        buys.set(chosen.id, {
          product: chosen,
          needed: wanted,
          stock: productStock(chosen),
          deficit: shortfall,
        });
      }
    }

    // hand-added packs ride along on wherever this would be bought
    const extra = Math.max(0, Number(ing.extraPacks) || 0);
    if (extra > 0 && chosen && !buys.has(chosen.id)) {
      buys.set(chosen.id, { product: chosen, needed: 0, stock: productStock(chosen), deficit: 0 });
    }

    /* Named or not, an ingredient a meal needs but with nowhere to buy it, or
       no pack size where it would come from, can never produce a pack count.
       It would drop off the list in silence, so name it instead. */
    if ((wanted > 0 || spokenFor > 0 || Object.keys(needProduct).some((k) => k.startsWith(`${ing.id}|`)))
      && (!chosen || !((Number(chosen.portionsPerPack) || 0) > 0))) {
      problems.push(ing);
    }

    for (const [id, buy] of buys) {
      const pp = Number(buy.product.portionsPerPack) || 0;
      // 1e-9 guards float noise so 2.0 portions never rounds up to an extra pack
      const planned = pp > 0 ? Math.ceil(buy.deficit / pp - 1e-9) : 0;
      const mine = id === (chosen && chosen.id) ? extra : 0;
      const packs = planned + mine;
      if (packs <= 0) continue;

      const cost = packCost(buy.product, packs);
      const full = packs * (Number(buy.product.pricePerPack) || 0);
      lines.push({
        ing,
        product: buy.product,
        // named demands are answered by one product, so say so on the line
        only: id !== (chosen && chosen.id) || buy.needed > wanted,
        needed: buy.needed,
        stock: buy.stock,
        deficit: buy.deficit,
        planned,
        extra: mine,
        packs,
        cost,
        saving: Math.max(0, full - cost),
        offer: offerLabel(buy.product),
        expired: offerExpired(buy.product),
        cheaper: id === (chosen && chosen.id) ? cheaperThan(ing) : null,
        leftover: buy.stock + planned * pp - buy.needed,
        stale: daysSince(buy.product.priceUpdated) > STALE_DAYS,
      });
    }
  }

  const stores = new Map();
  for (const l of lines) {
    const label = (l.product && l.product.store) || "Unassigned";
    const key = label.toLowerCase();
    if (!stores.has(key)) stores.set(key, { name: label, lines: [], total: 0, saving: 0 });
    const s = stores.get(key);
    s.lines.push(l);
    s.total += l.cost;
    s.saving += l.saving;
  }

  return {
    need,
    needProduct,
    problems,
    lines,
    dayCost,
    total: lines.reduce((a, l) => a + l.cost, 0),
    saving: lines.reduce((a, l) => a + l.saving, 0),
    stores: [...stores.values()].sort((a, b) => b.total - a.total),
    staleCount: lines.filter((l) => l.stale).length,
    expiredCount: db.ingredients.filter(anyOfferExpired).length,
    plannedDays: db.plan.filter((d) => d && SLOT_KEYS.some((k) => (d[k] || []).some(Boolean))).length,
    plannedMeals,
    totalSlots: db.plan.length * SLOT_KEYS.length * 2,
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
      const prods = productsOf(ing);
      const fields = [
        [ing.name, 1],
        [prods.map((p) => p.name).join(" "), 0.8],
        [prods.map((p) => p.store).join(" "), 0.5],
        [prods.map((p) => p.packLabel).join(" "), 0.4],
        [prods.flatMap((p) => p.barcodes || []).join(" "), 0.7],
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
/* Grouped by the shop the list would send you to, not by every shop that
   sells it, so an item appears once rather than in three places at once. */
export function groupByStore(ingredients) {
  const stores = new Map();
  for (const ing of ingredients) {
    const chosen = chooseProduct(ing);
    const label = (chosen && chosen.store) || "Unassigned";
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
