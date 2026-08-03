import {
  portionsPer, gramsPerPortion, per100Of, nutritionForGrams, productNutrition,
  hasNutrition, nutritionUsable, itemPortions, itemNutrition, itemProduct,
  mealNutrition, mealNutritionKnown, computeShopping, labelToPer100,
} from "../lib/calc.js";
import {
  newProduct, newIngredient, migrate, seed, mergeSnapshots, parsePackSize, SCHEMA_VERSION,
} from "../lib/store.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

console.log("--- parsePackSize ---");
const ps = (t) => { const r = parsePackSize(t); return `${r.amount}${r.unit}`; };
ok(ps("600g") === "600g", "600g");
ok(ps("1.5kg") === "1500g", "1.5kg becomes grams");
ok(ps("500 ml") === "500ml", "500 ml");
ok(ps("1 litre") === "1000ml", "1 litre becomes ml");
ok(ps("2L") === "2000ml", "2L");
ok(ps("6x125g") === "750g", "6x125g multipack");
ok(ps("2 x 1kg") === "2000g", "2 x 1kg multipack");
ok(ps("family size") === "0", "words alone give nothing");
ok(ps("") === "0", "blank gives nothing");

console.log("\n--- a portion defined by count ---");
const byCount = newProduct("Broth", "Tesco", {
  packAmount: 600, packUnit: "g", portionBy: "count", portionsPerPack: 2,
  kcal100: 40, protein100: 2.5, carbs100: 4.2, fat100: 1.2, pricePerPack: 2,
});
ok(portionsPer(byCount) === 2, "2 portions per pack");
ok(gramsPerPortion(byCount) === 300, "so a portion is 300g");
const n1 = productNutrition(byCount);
console.log("   per portion:", JSON.stringify(Object.fromEntries(Object.entries(n1).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
ok(near(n1.kcal, 120, 1), `120 kcal, matching the label's own 119 for half a pot (${n1.kcal})`);
ok(near(n1.protein, 7.5), "7.5g protein");
ok(near(n1.fat, 3.6), "3.6g fat");

console.log("\n--- the same product, portion defined by weight ---");
const byWeight = { ...byCount, portionBy: "weight", portionGrams: 300 };
ok(portionsPer(byWeight) === 2, "2 portions per pack is derived from 600g over 300g");
ok(gramsPerPortion(byWeight) === 300, "and a portion is still 300g");
ok(near(productNutrition(byWeight).kcal, 120, 1), "so the calories are identical either way round");

console.log("\n--- redefining a portion moves the calories ---");
const third = { ...byCount, portionsPerPack: 3 };
ok(near(gramsPerPortion(third), 200), "600g over 3 is a 200g portion");
ok(near(productNutrition(third).kcal, 80, 1), `and 80 kcal (${productNutrition(third).kcal})`);
const whole = { ...byCount, portionsPerPack: 1 };
ok(near(productNutrition(whole).kcal, 240, 1), "eating the whole pot is 240 kcal");
// this is the bug the old model had: the stored figure would have stayed at 120
ok(productNutrition(third).kcal !== productNutrition(byCount).kcal,
  "the figure follows the portion size rather than going stale");

console.log("\n--- 150g portions of a 1.5kg bag ---");
const mince = newProduct("Mince", "Tesco", {
  packAmount: 1500, packUnit: "g", portionBy: "weight", portionGrams: 150,
  kcal100: 250, protein100: 20, carbs100: 0, fat100: 19, pricePerPack: 6,
});
ok(portionsPer(mince) === 10, "1.5kg at 150g a portion is 10 portions");
ok(near(productNutrition(mince).kcal, 375), "a portion is 375 kcal");
ok(near(1 / portionsPer(mince) * 6, 0.6), "and 60p a portion, so cost follows too");

console.log("\n--- unknowns are admitted, not guessed ---");
const noWeight = newProduct("Eggs", "Tesco", {
  packAmount: 0, packUnit: "", portionsPerPack: 6, kcal100: 140, pricePerPack: 2,
});
ok(portionsPer(noWeight) === 6, "a pack with no weight still has a portion count");
ok(gramsPerPortion(noWeight) === 0, "but no portion weight");
ok(productNutrition(noWeight).kcal === 0, "so no calorie figure is invented");
ok(hasNutrition(noWeight), "the label is filled in");
ok(!nutritionUsable(noWeight), "but it is not usable without a weight, and says so");

console.log("\n--- meal lines in grams ---");
const brothIng = newIngredient("Tesco", "Broth");
brothIng.products = [{ ...byCount, id: "broth-tesco" }];
const minceIng = newIngredient("Tesco", "Mince");
minceIng.products = [{ ...mince, id: "mince-tesco" }];
const byId = Object.fromEntries([brothIng, minceIng].map((i) => [i.id, i]));

const recipe = { id: "bol", name: "Bolognese", items: [
  { ingredientId: minceIng.id, productId: "", by: "grams", grams: 400, portions: 0 },
] };
const line = recipe.items[0];
ok(near(itemPortions(minceIng, line), 400 / 150), `400g is ${itemPortions(minceIng, line).toFixed(3)} portions of 150g`);
const rn = itemNutrition(minceIng, line);
ok(near(rn.kcal, 1000), `400g of mince at 250/100g is 1000 kcal (${rn.kcal})`);
ok(near(rn.protein, 80), "and 80g protein");

/* Grams must be exact, not routed through a rounded portion count. Change the
   portion size and the same 400g must still be 1000 kcal. */
const chunky = { ...minceIng, products: [{ ...minceIng.products[0], portionGrams: 137 }] };
ok(near(itemNutrition(chunky, line).kcal, 1000),
  "a line in grams is unaffected by how the portion is defined");
ok(!near(itemPortions(chunky, line), itemPortions(minceIng, line)),
  "though how many packs to buy does change, correctly");

console.log("\n--- portions and grams agree when they describe the same amount ---");
const asPortions = { ingredientId: minceIng.id, productId: "", by: "portions", portions: 400 / 150, grams: 0 };
ok(near(itemNutrition(minceIng, asPortions).kcal, 1000, 0.5), "same food, same calories, either notation");

console.log("\n--- a meal mixing both ---");
const mixed = { id: "m", name: "Mixed", items: [
  { ingredientId: brothIng.id, by: "portions", portions: 1, grams: 0, productId: "" },
  { ingredientId: minceIng.id, by: "grams", grams: 150, portions: 0, productId: "" },
] };
const mn = mealNutrition(mixed, byId);
ok(near(mn.kcal, 120 + 375, 1), `soup portion plus 150g mince is ${Math.round(mn.kcal)} kcal`);
ok(mealNutritionKnown(mixed, byId), "both lines have figures behind them");

const blankIng = newIngredient("Tesco", "Butter");
blankIng.products = [newProduct("Butter", "Tesco", { id: "b", packAmount: 250, packUnit: "g", portionsPerPack: 25, pricePerPack: 2 })];
byId[blankIng.id] = blankIng;
const withBlank = { id: "w", name: "W", items: [
  ...mixed.items, { ingredientId: blankIng.id, by: "grams", grams: 10, portions: 0, productId: "" },
] };
ok(!mealNutritionKnown(withBlank, byId), "a line with no label is flagged");
ok(near(mealNutrition(withBlank, byId).kcal, mn.kcal, 0.01), "and contributes nothing rather than a guess");

console.log("\n--- the plan still drives the page ---");
const plan = Array.from({ length: 14 }, () => ({
  breakfast: [null, null], lunch: [null, null], dinner: [null, null],
}));
plan[0].dinner = ["bol", null];
plan[1].dinner = ["bol", "bol"];

const db = migrate({
  schema: SCHEMA_VERSION, ingredients: [brothIng, minceIng, blankIng],
  meals: [recipe, mixed], plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
});
const c = computeShopping(db);
ok(near(c.dayNutrition[0][0].kcal, 1000, 2), `day 1 person 1 is 400g of mince (${Math.round(c.dayNutrition[0][0].kcal)})`);
ok(c.dayNutrition[0][1].kcal === 0, "person 2 ate nothing");
ok(near(c.dayNutrition[1][1].kcal, 1000, 2), "day 2 both, split kept");
// 400g of a 1500g bag: needs one bag
const mineLine = c.lines.find((l) => l.ing.id === minceIng.id);
ok(!!mineLine, "mince is on the shopping list");
ok(mineLine.packs === 1, `and one bag covers 800g over two days (${mineLine && mineLine.packs})`);
ok(near(c.dayCost[0], 6 * (400 / 1500), 0.01), `day 1 costs a proportion of the bag (£${c.dayCost[0].toFixed(2)})`);

console.log("\n--- migrating v6 per-portion figures to per 100g ---");
const v6 = {
  schema: 6,
  ingredients: [{
    id: "broth", name: "Broth", products: [{
      id: "broth-tesco", name: "Broth", store: "Tesco", pricePerPack: 2,
      portionsPerPack: 2, packLabel: "600g", stockPortions: 0,
      kcal: 120, protein: 7.5, carbs: 12.6, fat: 3.6,
      nutritionUpdated: "2026-07-30T10:00:00Z", priceUpdated: "2026-07-30",
    }],
  }],
  meals: [], plan: [], people: ["A", "B"], planStart: "",
};
const up = migrate(v6);
const p6 = up.ingredients[0].products[0];
console.log("   after migrate:", JSON.stringify({
  packAmount: p6.packAmount, packUnit: p6.packUnit, kcal100: p6.kcal100, portionBy: p6.portionBy,
}));
ok(up.schema === SCHEMA_VERSION, `schema is the current one (${up.schema})`);
ok(p6.packAmount === 600 && p6.packUnit === "g", "the pack size text became a number and a unit");
ok(near(p6.kcal100, 40), `120 kcal a 300g portion is 40 per 100g (${p6.kcal100})`);
ok(near(p6.protein100, 2.5), "protein converted");
ok(near(productNutrition(p6).kcal, 120, 0.5), "and it still reads 120 kcal a portion, unchanged");

console.log("\n--- migrating where the pack size is unknown ---");
const v6b = JSON.parse(JSON.stringify(v6));
v6b.ingredients[0].products[0].packLabel = "";
const upb = migrate(v6b);
const p6b = upb.ingredients[0].products[0];
console.log("   after migrate:", JSON.stringify({
  packAmount: p6b.packAmount, portionBy: p6b.portionBy, portionGrams: p6b.portionGrams, kcal100: p6b.kcal100,
}));
ok(near(productNutrition(p6b).kcal, 120, 0.5),
  `the displayed per-portion figure is preserved exactly (${productNutrition(p6b).kcal})`);
ok(p6b.portionGrams === 100, "by carrying it as a 100g portion, which is visible and correctable");
ok(portionsPer(p6b) === 2, "and the portion count is untouched, so the shopping list is unchanged");

console.log("\n--- a v6 db keeps its totals ---");
const v6full = {
  schema: 6,
  ingredients: [
    { id: "a", name: "A", products: [{ id: "a1", name: "A", store: "Tesco", pricePerPack: 3, portionsPerPack: 4, packLabel: "1kg", stockPortions: 1 }] },
    { id: "b", name: "B", products: [{ id: "b1", name: "B", store: "Lidl", pricePerPack: 2, portionsPerPack: 2, packLabel: "500g", stockPortions: 0 }] },
  ],
  meals: [{ id: "m", name: "M", items: [{ ingredientId: "a", portions: 2 }, { ingredientId: "b", portions: 1 }] }],
  plan: Array.from({ length: 14 }, () => ({ breakfast: [null, null], lunch: [null, null], dinner: ["m", "m"] })),
  people: ["A", "B"], planStart: "",
};
const before = computeShopping(migrate(JSON.parse(JSON.stringify(v6full))));
const after = computeShopping(migrate(migrate(JSON.parse(JSON.stringify(v6full)))));
ok(Math.abs(before.total - after.total) < 0.001, `migrating twice is idempotent (£${before.total.toFixed(2)})`);
ok(before.total > 0, "and the list still costs something");

console.log("\n--- seed and merge ---");
const s7 = migrate(seed());
const sc = computeShopping(s7);
ok(sc.dayNutrition.length === s7.plan.length, "seed boots with a nutrition array");
ok(sc.dayKcal === 0, "and no invented calories");

const mineDb = JSON.parse(JSON.stringify(up));
const theirs = JSON.parse(JSON.stringify(up));
mineDb.ingredients[0].products[0] = {
  ...mineDb.ingredients[0].products[0], kcal100: 0, protein100: 0, carbs100: 0, fat100: 0,
  nutritionUpdated: "", pricePerPack: 2.5, priceUpdated: "2026-08-01T10:00:00Z",
};
const merged = mergeSnapshots(mineDb, theirs);
const mp = merged.db.ingredients[0].products[0];
ok(near(mp.kcal100, 40), `a newer price does not wipe the other phone's label (${mp.kcal100})`);
ok(mp.pricePerPack === 2.5, "and the newer price still wins");

console.log("\n--- reading a label ---");
const panel = {
  per100: { kcal: 40, protein: 2.5, carbs: 4.2, fat: 1.2 },
  perServing: { kcal: 119, protein: 7.5, carbs: 12.6, fat: 3.6 },
  packAmount: 600, packUnit: "g", servingGrams: 300,
};
let r = labelToPer100(panel);
ok(near(r.values.kcal, 40), "a per 100g column is stored as it is, with no conversion");
ok(!r.warn, "and no warning");

r = labelToPer100({ ...panel, per100: null });
ok(near(r.values.kcal, 39.67, 0.02), `a serving-only label divides back down (${r.values.kcal})`);
ok(!r.warn, "which is exact, so no warning");

r = labelToPer100({ ...panel, per100: null, servingGrams: 0 });
ok(r.warn, "a serving column with no weight cannot be converted, and warns");
ok(near(r.values.kcal, 119), "handing back what was printed rather than a guess");

ok(labelToPer100({ per100: null, perServing: null }) === null, "an unreadable panel returns null");
ok(labelToPer100(null) === null, "so does nothing at all");

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
