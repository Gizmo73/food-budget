import { mealStock, computeShopping } from "../lib/calc.js";
import { newProduct, newIngredient, migrate } from "../lib/store.js";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const ing = (id, name, stock, extra = {}) => {
  const i = newIngredient("Tesco", name); i.id = id;
  i.products = [newProduct(name, "Tesco", {
    id: `${id}-tesco`, pricePerPack: 2, portionsPerPack: 4, packAmount: 400, packUnit: "g",
    stockPortions: stock, priceUpdated: "2026-08-01", ...extra,
  })];
  return i;
};
const mince = ing("mince", "Mince", 4);
const pasta = ing("pasta", "Pasta", 0);
const peas = ing("peas", "Peas", 10);
// two shops, so a named line can be told apart from a general one
const cheese = ing("cheese", "Cheese", 0);
cheese.products.push(newProduct("Cheese", "Aldi", { id: "cheese-aldi", pricePerPack: 1.8, portionsPerPack: 4, stockPortions: 6 }));

const byId = Object.fromEntries([mince, pasta, peas, cheese].map((i) => [i.id, i]));

console.log("--- can it be made now ---");
const easy = { id: "a", name: "Mince and peas", items: [
  { ingredientId: "mince", portions: 2, by: "portions", grams: 0, productId: "" },
  { ingredientId: "peas", portions: 1, by: "portions", grams: 0, productId: "" }] };
let r = mealStock(easy, byId);
ok(r.canMake, "everything in stock means yes");
ok(r.short.length === 0, "with nothing short");

const hard = { id: "b", name: "Bolognese", items: [
  { ingredientId: "mince", portions: 2, by: "portions", grams: 0, productId: "" },
  { ingredientId: "pasta", portions: 1, by: "portions", grams: 0, productId: "" }] };
r = mealStock(hard, byId);
ok(!r.canMake, "one empty cupboard means no");
ok(r.short.length === 1 && r.short[0].name === "Pasta", `and it names what is short (${r.short.map((x) => x.name)})`);

console.log("\n--- exactly enough counts as enough ---");
const exact = { id: "c", name: "Exact", items: [
  { ingredientId: "mince", portions: 4, by: "portions", grams: 0, productId: "" }] };
ok(mealStock(exact, byId).canMake, "4 needed against 4 in stock");
const overByAHair = { id: "d", name: "Over", items: [
  { ingredientId: "mince", portions: 4.01, by: "portions", grams: 0, productId: "" }] };
ok(!mealStock(overByAHair, byId).canMake, "and 4.01 is not");

console.log("\n--- a line in grams is measured the same way ---");
// 400g pack over 4 portions is 100g a portion, and 4 portions are in
const inGrams = { id: "e", name: "Grams", items: [
  { ingredientId: "mince", by: "grams", grams: 300, portions: 0, productId: "" }] };
ok(mealStock(inGrams, byId).canMake, "300g of mince against 400g in stock");
const tooMuch = { id: "f", name: "Too much", items: [
  { ingredientId: "mince", by: "grams", grams: 500, portions: 0, productId: "" }] };
ok(!mealStock(tooMuch, byId).canMake, "500g is not");

console.log("\n--- a named product may only use its own stock ---");
const anyCheese = { id: "g", name: "Any cheese", items: [
  { ingredientId: "cheese", portions: 2, by: "portions", grams: 0, productId: "" }] };
ok(mealStock(anyCheese, byId).canMake, "any cheese: the Aldi block covers it");
const thatCheese = { id: "h", name: "That cheese", items: [
  { ingredientId: "cheese", portions: 2, by: "portions", grams: 0, productId: "cheese-tesco" }] };
const named = mealStock(thatCheese, byId);
ok(!named.canMake, "that cheese: the Tesco one is not in, so no");
ok(named.short[0].only === true, "and it is flagged as a named line");

console.log("\n--- meals with nothing in them ---");
ok(!mealStock({ id: "i", name: "New meal", items: [] }, byId).canMake,
  "an empty meal cannot be made, rather than vacuously being makeable");
ok(!mealStock({ id: "j", name: "Zeroes", items: [
  { ingredientId: "mince", portions: 0, by: "portions", grams: 0, productId: "" }] }, byId).canMake,
  "nor one whose only line asks for nothing");

console.log("\n--- judged on its own, not against the fortnight ---");
/* Two meals each needing 3 of the 4 portions of mince. Each is makeable on
   its own; together they are not. That is the right answer for "what can I
   cook tonight", and the shopping list handles the fortnight. */
const three = (id) => ({ id, name: id, items: [
  { ingredientId: "mince", portions: 3, by: "portions", grams: 0, productId: "" }] });
ok(mealStock(three("x"), byId).canMake && mealStock(three("y"), byId).canMake,
  "both read as makeable, which is the question being asked");

console.log("\n--- a missing ingredient does not throw ---");
ok(mealStock({ id: "k", name: "Ghost", items: [
  { ingredientId: "nope", portions: 1, by: "portions", grams: 0, productId: "" }] }, byId).lines === 0,
  "a line pointing at nothing is skipped");
ok(mealStock(null, byId).canMake === false, "and no meal at all is handled");

console.log("\n--- against the real backup ---");
const db = migrate(JSON.parse((await import("fs")).readFileSync(FIXTURE, "utf8")));
const realById = Object.fromEntries(db.ingredients.map((i) => [i.id, i]));
const rows = db.meals.map((m) => ({ name: m.name, ...mealStock(m, realById) }));
for (const x of rows) {
  console.log(`   ${x.canMake ? "YES" : " no"}  ${x.name.padEnd(36)} ${x.lines} lines` +
    (x.short.length ? ` | short of ${x.short.map((s) => s.name).join(", ")}` : ""));
}
ok(rows.some((x) => x.canMake), "some of your meals can be made now");
ok(rows.filter((x) => x.lines === 0).every((x) => !x.canMake), "and the four empty ones are not among them");

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
