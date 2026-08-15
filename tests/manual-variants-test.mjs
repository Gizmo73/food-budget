/* Two different kinds of one ingredient on the list at once.

   The case: under Bread you sometimes want a specific white loaf and a specific
   seeded loaf on the same trip, not just "a loaf, whichever is cheapest". Each
   product carries its own hand-added count (product.extraPacks) alongside the
   ingredient's loose one (ing.extraPacks), and the shopping list gives each its
   own line. */
import { newProduct, newIngredient, migrate, mergeSnapshots, copyToShop } from "../lib/store.js";
import { computeShopping, chooseProduct } from "../lib/calc.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const emptyPlan = () =>
  Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));

/* Bread with two priced kinds. White is the cheaper per portion, so it is the
   one the list reaches for by default. */
const build = () => {
  const bread = newIngredient("Tesco", "Bread");
  bread.id = "bread";
  bread.products = [
    newProduct("White Loaf", "Tesco", {
      id: "white", pricePerPack: 0.9, portionsPerPack: 8, priceUpdated: "2026-08-01T10:00:00Z",
    }),
    newProduct("Seeded Loaf", "Tesco", {
      id: "seeded", pricePerPack: 1.6, portionsPerPack: 8, priceUpdated: "2026-08-01T10:00:00Z",
    }),
  ];
  return migrate({
    schema: 7,
    ingredients: [bread],
    meals: [],
    plan: emptyPlan(),
    people: ["Lee", "Sam"],
    planStart: "",
  });
};

const lineFor = (c, productId) =>
  c.lines.find((l) => l.product && l.product.id === productId);

console.log("--- nothing on the list to begin with ---");
let db = build();
ok(chooseProduct(db.ingredients[0]).id === "white", "the cheaper white loaf is the default pick");
ok(computeShopping(db).lines.length === 0, "and nothing is on the list yet");

console.log("\n--- one specific kind by hand ---");
db = build();
db.ingredients[0].products.find((p) => p.id === "seeded").extraPacks = 1;
let c = computeShopping(db);
ok(c.lines.length === 1, `one line on the list (${c.lines.length})`);
const seededLine = lineFor(c, "seeded");
ok(!!seededLine, "and it is the seeded loaf, the one asked for by hand");
ok(seededLine.packs === 1 && seededLine.extra === 1, "one pack, marked as hand-added");
ok(seededLine.only === true && seededLine.needed === 0,
  "flagged as this-one-only with no meal behind it, so the list can say 'added by hand'");

console.log("\n--- two different kinds at once ---");
db = build();
db.ingredients[0].products.find((p) => p.id === "white").extraPacks = 1;
db.ingredients[0].products.find((p) => p.id === "seeded").extraPacks = 1;
c = computeShopping(db);
ok(c.lines.length === 2, `both kinds get their own line (${c.lines.length})`);
ok(lineFor(c, "white").packs === 1, "a white loaf");
ok(lineFor(c, "seeded").packs === 1, "and a seeded loaf");
ok(Math.abs(c.total - (0.9 + 1.6)) < 0.001, `and the total is both packs (£${c.total.toFixed(2)})`);

console.log("\n--- the loose 'any of it' still rides the cheapest ---");
db = build();
db.ingredients[0].extraPacks = 2;              // any two loaves, cheapest
db.ingredients[0].products.find((p) => p.id === "seeded").extraPacks = 1; // plus a seeded one
c = computeShopping(db);
ok(c.lines.length === 2, `two lines: the cheapest and the named one (${c.lines.length})`);
ok(lineFor(c, "white").packs === 2, "the loose pair landed on white, the cheapest");
ok(lineFor(c, "seeded").packs === 1, "and the seeded stayed its own line");

console.log("\n--- loose and own stack on the same product ---");
db = build();
db.ingredients[0].extraPacks = 1;                                          // rides the cheapest (white)
db.ingredients[0].products.find((p) => p.id === "white").extraPacks = 2;   // and white's own
c = computeShopping(db);
ok(c.lines.length === 1 && lineFor(c, "white").packs === 3,
  `both fall on white, three packs in all (${lineFor(c, "white") && lineFor(c, "white").packs})`);

console.log("\n--- it survives a save and reload ---");
db = build();
db.ingredients[0].products.find((p) => p.id === "seeded").extraPacks = 2;
const saved = migrate(JSON.parse(JSON.stringify(db)));
ok(saved.ingredients[0].products.find((p) => p.id === "seeded").extraPacks === 2,
  "the hand-added packs are still there after a reload");

console.log("\n--- two phones keep the higher count ---");
const a = build();
a.ingredients[0].products.find((p) => p.id === "seeded").extraPacks = 1;
const b = build();
b.ingredients[0].products.find((p) => p.id === "seeded").extraPacks = 3;
const merged = mergeSnapshots(a, b).db;
ok(merged.ingredients[0].products.find((p) => p.id === "seeded").extraPacks === 3,
  "the phone that wanted more wins, since a hand-added pack is a real request");

console.log("\n--- copying to another shop does not inherit the request ---");
db = build();
const seeded = db.ingredients[0].products.find((p) => p.id === "seeded");
seeded.extraPacks = 2;
const copy = copyToShop(seeded, db.ingredients[0].products.map((p) => p.id));
ok((copy.extraPacks || 0) === 0, "a fresh copy at a new shop starts with nothing on the list");

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
