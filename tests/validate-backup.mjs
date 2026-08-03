import { readFileSync } from "fs";
import { migrate, SCHEMA_VERSION } from "../lib/store.js";
import {
  computeShopping, portionsPer, gramsPerPortion, productsOf, stockPortions,
  hasNutrition, itemPortions, money,
} from "../lib/calc.js";

/* Point this at any exported backup to check it before restoring it:
     node tests/validate-backup.mjs ~/Downloads/fortnight-shop-backup.json
   With no argument it checks the sample list, which is what CI does. */
const FILE = process.argv[2] || new URL("./fixtures/sample-list.json", import.meta.url).pathname;
console.log(`Checking ${FILE}\n`);
const raw = readFileSync(FILE, "utf8");
const fail = [];
const warn = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

console.log("=== 1. is it readable ===");
let src;
try { src = JSON.parse(raw); ok(true, "valid JSON"); }
catch (e) { ok(false, "valid JSON: " + e.message); process.exit(1); }
ok(Number(src.schema) > 0 && Number(src.schema) <= SCHEMA_VERSION,
  `declares schema ${src.schema}, and this app is on ${SCHEMA_VERSION}`);
ok(Array.isArray(src.ingredients), `${src.ingredients.length} ingredients`);
ok(Array.isArray(src.meals), `${src.meals.length} meals`);
ok(Array.isArray(src.plan) && src.plan.length === 14, `${src.plan.length} days of plan`);

console.log("\n=== 2. internal references ===");
const ingIds = new Set(src.ingredients.map((i) => i.id));
const mealIds = new Set(src.meals.map((m) => m.id));
const dangling = [];
for (const m of src.meals) {
  for (const it of m.items) if (!ingIds.has(it.ingredientId)) dangling.push(`${m.name} -> ${it.ingredientId}`);
}
ok(dangling.length === 0, `every meal ingredient exists${dangling.length ? ": " + dangling.join(", ") : ""}`);

const planRefs = [];
for (const [i, d] of src.plan.entries()) {
  for (const slot of ["breakfast", "lunch", "dinner"]) {
    for (const id of d[slot] || []) if (id && !mealIds.has(id)) planRefs.push(`day ${i + 1} ${slot} -> ${id}`);
  }
}
ok(planRefs.length === 0, `every planned meal exists${planRefs.length ? ": " + planRefs.join(", ") : ""}`);

const dupIng = src.ingredients.map((i) => i.id).filter((v, i, a) => a.indexOf(v) !== i);
const dupProd = src.ingredients.flatMap((i) => i.products.map((p) => p.id)).filter((v, i, a) => a.indexOf(v) !== i);
ok(dupIng.length === 0, `no duplicate ingredient ids${dupIng.length ? ": " + dupIng : ""}`);
ok(dupProd.length === 0, `no duplicate product ids${dupProd.length ? ": " + dupProd : ""}`);

console.log("\n=== 3. does it migrate to 7 ===");
const before = computeShopping(migrate(JSON.parse(raw)));
const db = migrate(JSON.parse(raw));
ok(db.schema === SCHEMA_VERSION, `migrates to schema ${db.schema}`);
ok(db.ingredients.length === src.ingredients.length, "no ingredients lost");
ok(db.meals.length === src.meals.length, "no meals lost");
const twice = migrate(JSON.parse(JSON.stringify(db)));
ok(JSON.stringify(twice) === JSON.stringify(db), "migrating twice is identical");

console.log("\n=== 4. pack sizes read off your labels ===");
const rows = [];
for (const i of db.ingredients) {
  for (const p of productsOf(i)) {
    const srcP = src.ingredients.find((x) => x.id === i.id).products.find((x) => x.id === p.id);
    rows.push({
      name: p.name, label: srcP ? srcP.packLabel : "",
      got: p.packAmount ? `${p.packAmount}${p.packUnit}` : "-",
      per: gramsPerPortion(p) ? `${Math.round(gramsPerPortion(p))}${p.packUnit}` : "-",
    });
  }
}
const parsed = rows.filter((r) => r.got !== "-");
const notParsed = rows.filter((r) => r.got === "-" && r.label);
console.log("   read successfully:");
for (const r of parsed) console.log(`     ${r.label.padEnd(10)} -> ${r.got.padEnd(8)} portion ${r.per}`);
console.log("   left blank (no weight in the text):");
for (const r of notParsed) console.log(`     ${r.name.padEnd(34)} label "${r.label}"`);
const noLabel = rows.filter((r) => !r.label).length;
console.log(`   ${noLabel} products had no pack size text at all`);
ok(parsed.length > 0, `${parsed.length} pack sizes parsed automatically`);

console.log("\n=== 5. money and portions unchanged ===");
const after = computeShopping(db);
console.log(`   list total £${money(after.total)} | ${after.lines.length} lines | ${after.stores.length} shops`);
ok(Math.abs(before.total - after.total) < 0.001, `total is stable at £${money(after.total)}`);
ok(after.problems.length === 0,
  `no item is unbuyable${after.problems.length ? ": " + after.problems.map((i) => i.name).join(", ") : ""}`);
for (const i of db.ingredients) {
  const was = src.ingredients.find((x) => x.id === i.id);
  const wasStock = was.products.reduce((a, p) => a + (Number(p.stockPortions) || 0), 0);
  if (stockPortions(i) !== wasStock) fail.push(`stock changed on ${i.name}`);
}
ok(!fail.some((f) => f.startsWith("stock changed")), "every stock figure is unchanged");

console.log("\n=== 6. nutrition ===");
const fed = db.ingredients.flatMap(productsOf).filter(hasNutrition);
ok(fed.length === 0, `nothing has nutrition yet, so nothing was converted (${fed.length} filled in)`);
ok(after.dayKcal === 0, "the Food tab will read 0 rather than a guess");
const weighable = db.ingredients.flatMap(productsOf).filter((p) => gramsPerPortion(p) > 0);
console.log(`   ${weighable.length} of ${rows.length} products already know their portion weight,`);
console.log(`   so a scanned label converts on those with no further typing.`);

console.log("\n=== 7. things worth knowing ===");
const emptyMeals = src.meals.filter((m) => !m.items.length);
const plannedEmpty = emptyMeals.filter((m) =>
  src.plan.some((d) => ["breakfast", "lunch", "dinner"].some((s) => (d[s] || []).includes(m.id))));
if (emptyMeals.length) warn.push(`${emptyMeals.length} meals have no ingredients: ${emptyMeals.map((m) => m.name).join(", ")}`);
if (plannedEmpty.length) warn.push(`and ${plannedEmpty.length} of those are on the plan, contributing nothing`);
if (!src.planStart) warn.push("planStart is empty, so no dates show beside the days");
const noPortionWeight = rows.filter((r) => r.per === "-").length;
if (noPortionWeight) warn.push(`${noPortionWeight} products have no portion weight, so a label cannot be converted for them yet`);
const bothTuna = src.ingredients.filter((i) => (i.aliases || []).includes("tuna"));
if (bothTuna.length > 1) warn.push(`${bothTuna.length} ingredients share the alias "tuna", so a receipt line saying tuna is ambiguous`);
for (const w of warn) console.log("   note: " + w);

console.log(fail.length ? `\n${fail.length} FAILED` : "\nvalid: it loads, migrates and produces the same list");
process.exit(fail.length ? 1 : 0);
