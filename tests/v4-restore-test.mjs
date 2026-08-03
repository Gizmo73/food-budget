import { migrate, SCHEMA_VERSION } from "../lib/store.js";
import {
  computeShopping, portionsPer, gramsPerPortion, productStock, stockPortions,
  productsOf, chooseProduct, portionCost,
} from "../lib/calc.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

/* A schema 4 backup: everything lived on the item itself. No products, no
   sources, no per-person plan, and portions described a whole household. */
const v4 = {
  schema: 4,
  budget: 60,
  updatedAt: "2026-06-01T10:00:00Z",
  ingredients: [
    { id: "pies", name: "Pies", store: "Tesco", pricePerPack: 2.5, portionsPerPack: 2,
      packLabel: "2 pack", stockPortions: 1, barcode: "5000000000001",
      offer: null, priceUpdated: "2026-05-20", extraPacks: 0, aliases: ["TESCO PIES"] },
    { id: "potatoes", name: "Potatoes", store: "Tesco", pricePerPack: 1.2, portionsPerPack: 8,
      packLabel: "2kg", stockPortions: 4, barcodes: ["5000000000002"],
      offer: { kind: "loyalty", price: 1.0 }, priceUpdated: "2026-05-22", extraPacks: 1 },
    { id: "mince", name: "Mince", store: "Lidl", pricePerPack: 3.75, portionsPerPack: 4,
      packLabel: "500g", stockPacks: 2, priceUpdated: "2026-05-18",
      offer: { kind: "multibuy", qty: 3, price: 8 } },
    { id: "gravy-granules", name: "Gravy granules", store: "Tesco", pricePerPack: 1.1,
      portionsPerPack: 16, packLabel: "300g", stockPortions: 0, priceUpdated: "2026-05-01" },
  ],
  meals: [
    { id: "pie-and-mash", name: "Pie and mash", items: [
      { ingredientId: "pies", portions: 2 },
      { ingredientId: "potatoes", portions: 0.5 },
      { ingredientId: "gravy-granules", portions: 0.25 },
    ] },
    { id: "bol", name: "Bolognese", items: [{ ingredientId: "mince", portions: 1 }] },
  ],
  // v4 plan: one meal id per day
  plan: ["pie-and-mash", null, "bol", null, null, null, null, "bol", null, null, null, null, null, null],
};

console.log("--- it migrates at all ---");
const up = migrate(JSON.parse(JSON.stringify(v4)));
ok(up.schema === SCHEMA_VERSION, `schema 4 goes straight to ${SCHEMA_VERSION} (${up.schema})`);
ok(up.ingredients.length === 4, "every item survives");
ok(up.meals.length === 2, "every meal survives");
ok(up.plan.length === 14, "the plan is fourteen days");

console.log("\n--- each item became an ingredient with one product ---");
for (const i of up.ingredients) {
  const ps = productsOf(i);
  ok(ps.length === 1, `${i.name}: one product`);
}
const pies = up.ingredients.find((i) => i.id === "pies");
const spuds = up.ingredients.find((i) => i.id === "potatoes");
const mince = up.ingredients.find((i) => i.id === "mince");
ok(productsOf(pies)[0].store === "Tesco", "the shop moved onto the product");
ok(productsOf(pies)[0].pricePerPack === 2.5, "and the price");
ok(productsOf(pies)[0].barcodes.includes("5000000000001"), "a single v4 barcode became a list");
ok(productsOf(spuds)[0].barcodes.includes("5000000000002"), "and a v4 barcode list carried over");
ok(productsOf(spuds)[0].offer.kind === "loyalty", "offers carried over");
ok(productsOf(mince)[0].offer.kind === "multibuy", "including multibuys");

console.log("\n--- the new pack size and portion fields ---");
ok(productsOf(spuds)[0].packAmount === 2000 && productsOf(spuds)[0].packUnit === "g",
  `"2kg" parsed to 2000g (${productsOf(spuds)[0].packAmount}${productsOf(spuds)[0].packUnit})`);
ok(productsOf(mince)[0].packAmount === 500, '"500g" parsed to 500g');
ok(productsOf(pies)[0].packAmount === 0 && productsOf(pies)[0].packUnit === "",
  '"2 pack" has no weight, so it says so rather than guessing');
ok(productsOf(spuds)[0].portionBy === "count", "portions stay a count, as they were");
ok(portionsPer(productsOf(spuds)[0]) === 8, "8 portions per pack, unchanged");
ok(gramsPerPortion(productsOf(spuds)[0]) === 250, "and a portion is now known to be 250g");
ok(gramsPerPortion(productsOf(pies)[0]) === 0, "a pie has no portion weight, correctly");

console.log("\n--- nutrition starts empty, not zero-claiming ---");
const anyNutrition = up.ingredients.some((i) => productsOf(i).some((p) => p.kcal100 > 0));
ok(!anyNutrition, "no invented figures");
const c = computeShopping(up);
ok(c.dayKcal === 0, "and the Food tab reads 0 rather than NaN");
ok(c.dayNutrition.length === 14, "with a row per day ready to fill");

console.log("\n--- stock survives ---");
ok(stockPortions(spuds) === 4, `potatoes: 4 portions (${stockPortions(spuds)})`);
ok(stockPortions(pies) === 1, "pies: 1 portion");
// v4 held this one in packs: 2 packs of 4 portions
ok(stockPortions(mince) === 8, `mince: 2 packs of 4 became 8 portions (${stockPortions(mince)})`);

console.log("\n--- the plan and the per-person split ---");
ok(up.plan[0].dinner[0] === "pie-and-mash" && up.plan[0].dinner[1] === "pie-and-mash",
  "a v4 meal fed the household, so it lands in both people's slots");
ok(up.plan[2].dinner[0] === "bol" && up.plan[2].dinner[1] === "bol", "same for day 3");
ok(up.plan[1].dinner[0] === null, "an empty day stays empty");
const pieMeal = up.meals.find((m) => m.id === "pie-and-mash");
ok(near(pieMeal.items.find((it) => it.ingredientId === "pies").portions, 1),
  "portions halved, because they now describe one person");
ok(pieMeal.items.every((it) => it.by === "portions"), "every line starts in portions");
ok(pieMeal.items.every((it) => it.grams === 0), "with no grams set");

console.log("\n--- totals are preserved ---");
/* The real test of a migration: the same fortnight must cost the same. Two
   people eating half a portion each is one portion, as it was in v4. */
const demand = {};
for (const [idx, day] of up.plan.entries()) {
  for (const slot of ["breakfast", "lunch", "dinner"]) {
    for (const mealId of day[slot]) {
      if (!mealId) continue;
      const meal = up.meals.find((m) => m.id === mealId);
      for (const it of meal.items) demand[it.ingredientId] = (demand[it.ingredientId] || 0) + it.portions;
    }
  }
}
const v4demand = {};
for (const mealId of v4.plan) {
  if (!mealId) continue;
  const meal = v4.meals.find((m) => m.id === mealId);
  for (const it of meal.items) v4demand[it.ingredientId] = (v4demand[it.ingredientId] || 0) + it.portions;
}
console.log("   v4 demand:", JSON.stringify(v4demand));
console.log("   v7 demand:", JSON.stringify(demand));
for (const k of Object.keys(v4demand)) {
  ok(near(demand[k], v4demand[k]), `${k}: ${v4demand[k]} portions needed, still ${demand[k]}`);
}

console.log("\n--- the shopping list still works ---");
console.log("   total £" + c.total.toFixed(2), "|", c.lines.length, "lines |", c.stores.length, "shops");
ok(c.lines.length > 0, "it produces a list");
ok(c.total > 0, "with a total");
ok(c.problems.length === 0, `and no items flagged as unbuyable (${c.problems.map((i) => i.name)})`);
ok(c.stores.some((s) => s.name === "Tesco"), "grouped by the shop the items came from");
/* Lidl is absent on purpose: the only Lidl item is mince, and v4 held 2 packs
   of it, which is 8 portions against a demand of 2. Stock suppressing a buy is
   the whole point of the app, so assert that rather than that it appears. */
ok(!c.lines.some((l) => l.ing.id === "mince"), "mince is not bought, because 2 v4 packs became 8 portions of stock");
ok(!c.stores.some((s) => s.name === "Lidl"), "so Lidl has nothing on the list");
ok(c.lines.some((l) => l.ing.id === "pies"), "pies are bought: 1 portion in stock against 2 needed");
ok(near(portionCost(spuds), 1.0 / 8), `the loyalty price still drives portion cost (£${portionCost(spuds).toFixed(3)})`);

console.log("\n--- migrating twice changes nothing ---");
const twice = migrate(JSON.parse(JSON.stringify(up)));
const c2 = computeShopping(twice);
ok(near(c2.total, c.total), `£${c.total.toFixed(2)} either way`);
ok(JSON.stringify(twice) === JSON.stringify(up), "and the whole database is byte-identical");

console.log("\n--- a v4 backup restored on top of v7 data ---");
/* This is the actual recovery path: things go wrong, you restore the old
   backup into the new app. It must land as a working schema 7 database. */
const restored = migrate(JSON.parse(JSON.stringify(v4)));
const rc = computeShopping(restored);
ok(near(rc.total, c.total), `restoring gives the same list (£${rc.total.toFixed(2)})`);
ok(restored.schema === SCHEMA_VERSION, "as schema 7");

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
