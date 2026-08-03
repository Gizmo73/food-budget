import { copyToShop, findAllByBarcode, findByBarcode, newProduct, migrate } from "../lib/store.js";
import { productsOf, chooseProduct, portionsPer, gramsPerPortion, productNutrition, hasNutrition } from "../lib/calc.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;

const source = newProduct("Heinz Baked Beans", "Tesco", {
  pricePerPack: 1.4, portionsPerPack: 2, packAmount: 415, packUnit: "g",
  portionBy: "weight", portionGrams: 207.5, packLabel: "415g",
  stockPortions: 6, barcodes: ["5000157024671"],
  offer: { kind: "loyalty", ends: "", price: 1.1 },
  priceUpdated: "2026-08-01T10:00:00Z",
  kcal100: 78, protein100: 4.7, carbs100: 12.5, fat100: 0.2,
  nutritionUpdated: "2026-07-30T10:00:00Z",
});

console.log("--- what travels to the new shop ---");
const copy = copyToShop(source, [source.id]);
ok(copy.name === source.name, "the name comes with it");
ok(copy.packAmount === 415 && copy.packUnit === "g", "the pack size comes with it");
ok(copy.portionBy === "weight" && copy.portionGrams === 207.5, "and how a portion is defined");
ok(copy.packLabel === "415g", "and the pack size note");
ok(copy.kcal100 === 78 && copy.protein100 === 4.7, "the nutrition comes with it, unchanged");
ok(copy.nutritionUpdated === source.nutritionUpdated, "keeping its reading date, since it is the same label");
ok(JSON.stringify(copy.barcodes) === JSON.stringify(["5000157024671"]), "the barcode comes with it: same tin");

console.log("\n--- what does not ---");
ok(copy.store === "", "the shop is blank, for you to set");
ok(copy.pricePerPack === 0, "the price is blank, for you to set");
ok(copy.offer === null, "the offer does not travel, since it is one shop's shelf");
ok(copy.stockPortions === 0, "stock does not travel, since it is a different pack");
ok(copy.priceUpdated === "", "and it is not stamped as priced, because it has not been");

console.log("\n--- ids stay distinct ---");
ok(copy.id !== source.id, `the copy gets its own id (${copy.id})`);
const third = copyToShop(source, [source.id, copy.id]);
ok(third.id !== copy.id && third.id !== source.id, `a second copy too (${third.id})`);

console.log("\n--- the copy behaves once you fill it in ---");
const filled = { ...copy, store: "Asda", pricePerPack: 1.2 };
ok(portionsPer(filled) === 2, "portions per pack derives the same way");
ok(gramsPerPortion(filled) === 207.5, "a portion is the same weight");
ok(near(productNutrition(filled).kcal, 78 * 2.075), `a portion is the same ${Math.round(productNutrition(filled).kcal)} kcal`);
ok(hasNutrition(filled), "and its nutrition is filled in without retyping");

const ing = {
  id: "beans", name: "Baked Beans", extraPacks: 0, aliases: [], preferredProductId: "",
  updatedAt: "", products: [source, filled],
};
/* Tesco is £1.40 but carries a £1.10 loyalty price, so it is really £1.10
   against Asda's £1.20. The loyalty price is what the list must compare. */
ok(chooseProduct(ing).store === "Tesco", "the loyalty price decides, so Tesco wins at £1.10 against £1.20");
const cheaper = { ...ing, products: [source, { ...filled, pricePerPack: 1.0 }] };
ok(chooseProduct(cheaper).store === "Asda", "drop Asda to £1.00 and it takes the list");
// and the copy inherited no offer, so nothing flatters it
ok(filled.offer === null, "the copy has no offer of its own to flatter it");

console.log("\n--- a shared barcode is now ambiguous, and says so ---");
const all = findAllByBarcode([ing], "5000157024671");
ok(all.length === 2, `both entries are found (${all.length})`);
ok(all[0].product.id !== all[1].product.id, "as two distinct products");
ok(all.map((m) => m.product.store).sort().join(",") === "Asda,Tesco", "one per shop");
ok(findByBarcode([ing], "5000157024671").product.store === "Tesco",
  "the single-result helper still returns the first, for callers that want one");
ok(findAllByBarcode([ing], "nope").length === 0, "an unknown barcode finds nothing");
ok(findAllByBarcode([ing], "").length === 0, "and a blank one is not a wildcard");

console.log("\n--- across different ingredients too ---");
const other = {
  id: "other", name: "Other", extraPacks: 0, aliases: [], preferredProductId: "", updatedAt: "",
  products: [newProduct("Other", "Lidl", { barcodes: ["5000157024671"], pricePerPack: 1 })],
};
const cross = findAllByBarcode([ing, other], "5000157024671");
ok(cross.length === 3, `a barcode recorded on two ingredients finds all three entries (${cross.length})`);
ok(new Set(cross.map((m) => m.ing.id)).size === 2, "spanning both ingredients");

console.log("\n--- it survives a save and reload ---");
const db = migrate({
  schema: 7, ingredients: [ing], meals: [], plan: [], people: ["A", "B"], planStart: "",
});
const back = productsOf(db.ingredients[0]).find((p) => p.store === "Asda");
ok(!!back, "the copy is still there after migrate");
ok(back.kcal100 === 78, "with its nutrition");
ok(back.packAmount === 415, "and its pack size");
ok(findAllByBarcode(db.ingredients, "5000157024671").length === 2, "and still shares the barcode");

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
