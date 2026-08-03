import { moveProduct, copyToShop, findAllByBarcode, newProduct, newIngredient, migrate } from "../lib/store.js";
import { productsOf, chooseProduct, computeShopping, stockPortions, productNutrition, gramsPerPortion } from "../lib/calc.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;

/* The real case: Arla Lactofree is its own ingredient with one product, and
   belongs under Milk, which already has a product of its own. */
const build = () => {
  const arla = newIngredient("Tesco", "Arla Lactofree Semi Skimmed Milk");
  arla.id = "arla";
  arla.aliases = ["arla lactofree semi skimmed milk drink 2l"];
  arla.extraPacks = 1;
  arla.products = [newProduct("Arla Lactofree Semi Skimmed Milk", "Tesco", {
    id: "arla-tesco", pricePerPack: 3.15, portionsPerPack: 4, packAmount: 2000, packUnit: "ml",
    stockPortions: 3, barcodes: ["5000000111111"], priceUpdated: "2026-08-01T10:00:00Z",
    kcal100: 42, protein100: 3.4, carbs100: 4.8, fat100: 1.5, nutritionUpdated: "2026-07-30",
  })];
  arla.preferredProductId = "arla-tesco";

  const milk = newIngredient("Tesco", "Milk");
  milk.id = "milk";
  milk.aliases = ["semi skimmed milk"];
  milk.products = [newProduct("Semi Skimmed Milk", "Tesco", {
    id: "milk-tesco", pricePerPack: 1.45, portionsPerPack: 4, packAmount: 2000, packUnit: "ml",
    stockPortions: 2, priceUpdated: "2026-08-01T10:00:00Z",
  })];

  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].breakfast = ["cereal", "cereal"];
  plan[1].breakfast = ["latte", null];

  return migrate({
    schema: 7,
    ingredients: [arla, milk],
    meals: [
      // asks for the ingredient in general
      { id: "cereal", name: "Cereal", items: [{ ingredientId: "arla", productId: "", portions: 0.5 }] },
      // asks for that exact product by name
      { id: "latte", name: "Latte", items: [{ ingredientId: "arla", productId: "arla-tesco", portions: 0.25 }] },
    ],
    plan, people: ["Lee", "Sam"], planStart: "",
  });
};

console.log("--- before ---");
let db = build();
const beforeCost = computeShopping(db).total;
ok(db.ingredients.length === 2, "two ingredients: Arla and Milk");
ok(stockPortions(db.ingredients.find((i) => i.id === "arla")) === 3, "Arla has 3 portions of stock");

console.log("\n--- move it under Milk ---");
db = build();
const done = moveProduct(db, "arla", "arla-tesco", "milk");
console.log("  ", JSON.stringify(done && { to: done.to, from: done.from, removed: done.removedSource }));
ok(!!done, "the move reports success");
ok(done.removedSource === true, "and says the old ingredient was left empty");

const milk = db.ingredients.find((i) => i.id === "milk");
ok(db.ingredients.length === 1, `only Milk is left (${db.ingredients.length})`);
ok(!db.ingredients.some((i) => i.id === "arla"), "Arla is gone as a separate ingredient");
ok(productsOf(milk).length === 2, `Milk now has two products (${productsOf(milk).length})`);

const moved = productsOf(milk).find((p) => /Arla/.test(p.name));
ok(!!moved, "the Arla product is one of them");
ok(moved.pricePerPack === 3.15, "with its price");
ok(moved.stockPortions === 3, "its stock, because that is a physical carton");
ok(moved.kcal100 === 42, "its nutrition");
ok(moved.packAmount === 2000 && moved.packUnit === "ml", "and its pack size");
ok(moved.barcodes.includes("5000000111111"), "and its barcode");

console.log("\n--- what pointed at the old home ---");
ok(milk.aliases.includes("arla lactofree semi skimmed milk drink 2l"),
  "the alias moved, so receipts still recognise it");
ok(milk.aliases.includes("semi skimmed milk"), "and Milk kept its own");
ok(milk.extraPacks === 1, "the hand-added pack came too, since it was never bought");

const cereal = db.meals.find((m) => m.id === "cereal");
const latte = db.meals.find((m) => m.id === "latte");
ok(cereal.items[0].ingredientId === "milk", "a meal asking for Arla in general now asks for Milk");
ok(cereal.items[0].productId === "", "in general, so any milk will do");
ok(latte.items[0].ingredientId === "milk", "a meal naming that carton follows it");
ok(latte.items[0].productId === moved.id, `and still names it (${latte.items[0].productId})`);

console.log("\n--- the plan still works ---");
const c = computeShopping(db);
ok(c.problems.length === 0, `nothing is unbuyable (${c.problems.map((i) => i.name)})`);
ok(!Number.isNaN(c.total), `the list still totals (£${c.total.toFixed(2)})`);
ok(chooseProduct(milk).id === "milk-tesco", "the cheaper milk wins the list, as it should");
ok(near(productNutrition(moved).kcal, 42 * 5), `a portion of the Arla is still ${Math.round(productNutrition(moved).kcal)} kcal`);

console.log("\n--- moving one of several leaves the rest alone ---");
db = build();
// give Arla a second product first
const arla = db.ingredients.find((i) => i.id === "arla");
arla.products.push(newProduct("Arla Lactofree Semi Skimmed Milk", "Asda", {
  id: "arla-asda", pricePerPack: 3.0, portionsPerPack: 4,
}));
const partial = moveProduct(db, "arla", "arla-tesco", "milk");
ok(partial.removedSource === false, "the old ingredient survives, since it still has something to buy");
ok(db.ingredients.length === 2, "both ingredients are still there");
const arlaAfter = db.ingredients.find((i) => i.id === "arla");
ok(productsOf(arlaAfter).length === 1, "with the other product left on it");
ok(arlaAfter.preferredProductId === "", "and the pin cleared, since it named the one that left");
const cereal2 = db.meals.find((m) => m.id === "cereal");
ok(cereal2.items[0].ingredientId === "arla",
  "a meal asking for Arla in general still does, because Arla still means something");
const latte2 = db.meals.find((m) => m.id === "latte");
ok(latte2.items[0].ingredientId === "milk", "but the one naming that carton followed it");

console.log("\n--- does it break copy to a shop ---");
db = build();
moveProduct(db, "arla", "arla-tesco", "milk");
const target = db.ingredients.find((i) => i.id === "milk");
const arlaNow = productsOf(target).find((p) => /Arla/.test(p.name));
const copy = copyToShop(arlaNow, productsOf(target).map((p) => p.id));
target.products.push({ ...copy, store: "Asda", pricePerPack: 2.95 });
ok(productsOf(target).length === 3, "you can still copy it to another shop after moving it");
ok(copy.id !== arlaNow.id && copy.id !== "milk-tesco", `the copy's id is unique inside its new home (${copy.id})`);
ok(copy.kcal100 === 42, "the copy still carries the nutrition");
ok(findAllByBarcode(db.ingredients, "5000000111111").length === 2,
  "and both carry the barcode, so the scan still asks which shop");
const matches = findAllByBarcode(db.ingredients, "5000000111111");
ok(new Set(matches.map((m) => m.ing.id)).size === 1, "both under the same ingredient now");
ok(matches.map((m) => m.product.store).sort().join(",") === "Asda,Tesco", "one per shop");

console.log("\n--- moving a copy is fine too ---");
db = build();
const src = db.ingredients.find((i) => i.id === "arla");
const c2 = copyToShop(src.products[0], src.products.map((p) => p.id));
src.products.push({ ...c2, store: "Asda", pricePerPack: 2.95 });
const m2 = moveProduct(db, "arla", c2.id, "milk");
ok(!!m2 && m2.removedSource === false, "a copied product moves like any other");
ok(productsOf(db.ingredients.find((i) => i.id === "milk")).some((p) => p.id === c2.id || p.store === "Asda"),
  "and lands under Milk");

console.log("\n--- guards ---");
db = build();
ok(moveProduct(db, "arla", "arla-tesco", "arla") === null, "moving somewhere it already is does nothing");
ok(moveProduct(db, "arla", "nope", "milk") === null, "an unknown product does nothing");
ok(moveProduct(db, "arla", "arla-tesco", "nowhere") === null, "an unknown destination does nothing");
ok(db.ingredients.length === 2, "and none of those changed anything");

console.log("\n--- id collision ---");
db = build();
// give Milk a product whose id is already what the mover wants to use
db.ingredients.find((i) => i.id === "milk").products.push(
  newProduct("Clash", "Tesco", { id: "arla-tesco", pricePerPack: 1 })
);
const clashed = moveProduct(db, "arla", "arla-tesco", "milk");
const milk3 = db.ingredients.find((i) => i.id === "milk");
const ids = productsOf(milk3).map((p) => p.id);
ok(new Set(ids).size === ids.length, `ids stay unique after a collision (${ids.join(", ")})`);
ok(clashed.product.id !== "arla-tesco", `the mover took a new id (${clashed.product.id})`);
const latte3 = db.meals.find((m) => m.id === "latte");
ok(latte3.items[0].productId === clashed.product.id, "and the meal naming it followed to the new id");

console.log("\n--- a round trip through save ---");
db = build();
moveProduct(db, "arla", "arla-tesco", "milk");
const saved = migrate(JSON.parse(JSON.stringify(db)));
ok(saved.ingredients.length === 1, "the move survives a save and reload");
ok(productsOf(saved.ingredients[0]).length === 2, "with both products");
ok(computeShopping(saved).problems.length === 0, "and nothing unbuyable");

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
