import { labelSizing, labelToPer100, productNutrition, portionsPer, gramsPerPortion } from "../lib/calc.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const near = (a, b, t = 1) => Math.abs(a - b) <= t;

/* The pork patty label, exactly as it reads:
   "When grilled according to instructions"
   per 100g 285kcal / 21.8 fat / 0.8 carb / 21.2 protein
   one sausage patty (41g) 117kcal / 8.9 fat / 0.3 carb / 8.7 protein
   Pack contains 6 servings
   "when grilled ... 342g typically weighs 248g"                        */
const patties = {
  name: "6 Pork Sausage Patties",
  packSize: "342g", packAmount: 342, packUnit: "g",
  preparedSize: "248g", preparedAmount: 248,
  servingSize: "41g", servingGrams: 41,
  servingsPerPack: 6,
  basis: "as prepared",
  per100: { kcal: 285, protein: 21.2, carbs: 0.8, fat: 21.8 },
  perServing: { kcal: 117, protein: 8.7, carbs: 0.3, fat: 8.9 },
};

console.log("--- the sizing it works out ---");
const s = labelSizing(patties);
console.log("  ", JSON.stringify({ packAmount: s.packAmount, portionGrams: s.portionGrams, portionsPerPack: s.portionsPerPack, why: s.why }, null, 1));
ok(s.packAmount === 246, `pack is 6 x 41g = 246g, not the 342g on the front (${s.packAmount})`);
ok(s.portionGrams === 41, "a portion is one patty at 41g");
ok(s.portionsPerPack === 6, "and there are 6 in a pack, so the list still orders whole packs");
ok(/6 servings of 41g/.test(s.why), "it says where that came from");
ok(/raw against cooked/.test(s.note), "and names the raw against cooked gap");
ok(/342g/.test(s.note) && /248g/.test(s.note), "quoting both weights off the label");

console.log("\n--- which gives the label's own figures back ---");
const per100 = labelToPer100(patties);
const product = {
  packAmount: s.packAmount, packUnit: s.packUnit,
  portionBy: s.portionBy, portionGrams: s.portionGrams, portionsPerPack: s.portionsPerPack,
  kcal100: per100.values.kcal, protein100: per100.values.protein,
  carbs100: per100.values.carbs, fat100: per100.values.fat,
};
const n = productNutrition(product);
console.log("   a portion:", JSON.stringify({ kcal: Math.round(n.kcal), protein: +n.protein.toFixed(1), fat: +n.fat.toFixed(1) }));
ok(near(n.kcal, 117), `117 kcal a patty, as printed (${Math.round(n.kcal)})`);
ok(near(n.protein, 8.7, 0.1), `8.7g protein (${n.protein.toFixed(1)})`);
ok(near(n.fat, 8.9, 0.1), `8.9g fat (${n.fat.toFixed(1)})`);
ok(portionsPer(product) === 6, "6 portions a pack for the shopping list");
ok(gramsPerPortion(product) === 41, "and a 41g portion for the recipes");

console.log("\n--- what the old behaviour would have given ---");
const naive = { ...product, packAmount: 342, portionBy: "count", portionsPerPack: 6, portionGrams: 0 };
const bad = productNutrition(naive);
ok(Math.round(bad.kcal) === 162, `the front-of-pack weight gives ${Math.round(bad.kcal)} kcal, 39% over`);
ok(Math.round(bad.kcal) > Math.round(n.kcal), "so the fix moves it the right way");

console.log("\n--- an ordinary label is unaffected ---");
const soup = {
  packSize: "600g", packAmount: 600, packUnit: "g", preparedSize: "", preparedAmount: 0,
  servingSize: "300g", servingGrams: 300, servingsPerPack: 2, basis: "as sold",
  per100: { kcal: 40, protein: 2.5, carbs: 4.2, fat: 1.2 },
  perServing: { kcal: 119, protein: 7.5, carbs: 12.6, fat: 3.6 },
};
const ss = labelSizing(soup);
console.log("  ", JSON.stringify({ packAmount: ss.packAmount, portionGrams: ss.portionGrams, note: ss.note }));
ok(ss.packAmount === 600, "2 servings of 300g is 600g, matching the pack");
ok(ss.note === "", "so there is nothing to warn about");
ok(ss.portionsPerPack === 2, "2 portions a pack");

console.log("\n--- cooked weight with no serving count ---");
const noCount = { ...patties, servingGrams: 0, servingsPerPack: 0, servingSize: "" };
const cs = labelSizing(noCount);
console.log("  ", JSON.stringify({ packAmount: cs.packAmount, why: cs.why }));
ok(cs.packAmount === 248, `falls back to the stated cooked weight (${cs.packAmount})`);
ok(/cooked/.test(cs.why), "and says so");
ok(/raw weight/.test(cs.note), "warning that the front of pack is the raw one");

console.log("\n--- a cooked table with no cooked weight anywhere ---");
const stuck = { ...patties, servingGrams: 0, servingsPerPack: 0, servingSize: "", preparedAmount: 0, preparedSize: "" };
const st = labelSizing(stuck);
ok(st.packAmount === 342, "all it has is the raw weight, so it uses it");
ok(/Careful/.test(st.note), "but says plainly that a portion will read heavy");

console.log("\n--- nothing usable ---");
ok(labelSizing({ packAmount: 0, servingGrams: 0, servingsPerPack: 0, preparedAmount: 0 }) === null,
  "no sizes at all returns null rather than a guess");
ok(labelSizing(null) === null, "and so does nothing");

console.log("\n--- your pack differs from the one the label was printed for ---");
/* The label is printed for 342g raw and 248g cooked, a shrink to 72.5%.
   Your pack is 346g, so the cooked weight it implies is 346 x 0.725. Taking
   the label's 248g as read would describe someone else's pack. */
const yours = { packAmount: 346, packUnit: "g" };
const scaled = labelSizing(patties, yours);
console.log("  ", JSON.stringify({ packAmount: scaled.packAmount, why: scaled.why }, null, 1));
ok(scaled.packAmount === Math.round(346 * (248 / 342)),
  `346g shrinks to ${scaled.packAmount}g, not the label's 248g`);
ok(scaled.packAmount === 251, `which is 251g (${scaled.packAmount})`);
ok(/your 346g pack/.test(scaled.why), "and it says it used your weight");
ok(/342g/.test(scaled.note) && /346g/.test(scaled.note), "naming both, so the difference is visible");
ok(/Correct the pack size/.test(scaled.note), "and offers the other reading");
ok(scaled.portionsPerPack === 6, "still 6 a pack, so the list is unaffected");
ok(scaled.portionsPerPack === 6, "as a count, which is the exact fact");
ok(scaled.portionBy === "count", "so the pack cannot end up holding 6.005 portions");

console.log("\n--- a pack that matches the label gives the label's own answer ---");
const same = labelSizing(patties, { packAmount: 342, packUnit: "g" });
ok(same.packAmount === 248, `342g shrinks to the label's own 248g (${same.packAmount})`);
ok(!/Correct the pack size/.test(same.note), "with nothing to flag, since the packs agree");
ok(/73% the label says is left/.test(same.note), `just what the shrink is: ${JSON.stringify(same.note)}`);

console.log("\n--- the rule needs no threshold ---");
for (const [w, want] of [[346, 251], [345, 250], [343, 249], [500, 363]]) {
  const r = labelSizing(patties, { packAmount: w, packUnit: "g" });
  ok(r.packAmount === want, `${w}g cooked is ${r.packAmount}g, expected ${want}g`);
}
const flagged = labelSizing(patties, { packAmount: 500, packUnit: "g" });
ok(/Correct the pack size/.test(flagged.note), "and a pack well away from the label is flagged");

console.log("\n--- no pack size entered yet ---");
const blank = labelSizing(patties, { packAmount: 0, packUnit: "" });
ok(blank.packAmount === 246, "nothing of yours to scale, so the label decides");
ok(!blank.note.includes("Change the pack size"), "and no scaling note");

console.log("\n--- calories from the scaled pack ---");
const prod2 = {
  packAmount: scaled.packAmount, packUnit: "g", portionBy: scaled.portionBy,
  portionsPerPack: scaled.portionsPerPack,
  kcal100: 285, protein100: 21.2, carbs100: 0.8, fat100: 21.8,
};
const n2 = productNutrition(prod2);
console.log("   a portion:", Math.round(n2.kcal), "kcal");
ok(near(n2.kcal, 119, 3), `still about the label's 117 (${Math.round(n2.kcal)}), scaled to your bigger pack`);
ok(portionsPer(prod2) === 6, `and exactly 6 portions a pack (${portionsPer(prod2)})`);
ok(Math.abs(gramsPerPortion(prod2) - 251 / 6) < 0.001, `a portion weighs ${gramsPerPortion(prod2).toFixed(2)}g, derived not rounded`);

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
