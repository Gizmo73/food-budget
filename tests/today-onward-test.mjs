/* The shopping list is for today and the days after it. A day that has gone
   stays on the plan with its cost and calories, but asks the shops for nothing,
   so last week's meals no longer have to be deleted to keep the list honest. */
import { browser, BASE, pinClock } from "./browser.mjs";

process.env.TZ = "Europe/London";
const { computeShopping, neededPortions, localDay, daysBetween } = await import("../lib/calc.js");
const store = await import("../lib/store.js");

const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const blank = () => Array.from({ length: 14 }, () => ({
  breakfast: [null, null], lunch: [null, null], dinner: [null, null],
}));

/* One ingredient, two portions a pack, and a dinner of one portion on each of
   the first five days: so the pack count says at a glance which days counted. */
function build({ start, days = [0, 1, 2, 3, 4], extras = {}, named = false } = {}) {
  const mince = store.newIngredient("Tesco", "Mince");
  mince.id = "mince";
  mince.products = [store.newProduct("Mince", "Tesco", { id: "mince-p", pricePerPack: 3, portionsPerPack: 2, priceUpdated: "2026-10-01" })];
  const plan = blank();
  for (const d of days) plan[d].dinner = ["bol", null];
  for (const [d, items] of Object.entries(extras)) plan[d].extras = [items, []];
  return store.migrate({
    schema: 8,
    ingredients: [mince],
    meals: [{ id: "bol", name: "Bolognese", updatedAt: "",
      items: [{ ingredientId: "mince", productId: named ? "mince-p" : "", portions: 1 }] }],
    plan, people: ["Lee", "Sam"], planStart: start,
  });
}
const packs = (c) => c.lines.reduce((n, l) => n + l.packs, 0);

console.log("--- days that have gone buy nothing ---");
const db = build({ start: "2026-10-03" });
let c = computeShopping(db, { asOf: "2026-10-03" });
ok(packs(c) === 3 && c.firstDay === 0, `on the first day all five dinners count: 3 packs (${packs(c)})`);
c = computeShopping(db, { asOf: "2026-10-06" });
ok(c.firstDay === 3, `three days in, the list starts at day ${c.firstDay}`);
ok(packs(c) === 1, `and only the two dinners left need one pack (${packs(c)})`);
ok(neededPortions(c, "mince") === 2, `needing two portions (${neededPortions(c, "mince")})`);
ok(c.dayCost[0] > 0 && c.dayCost[0] === c.dayCost[3], "but a day that has gone still has its cost on the plan");
ok(c.plannedMeals === 5 && c.upcomingMeals === 2, `five meals planned, two still to come (${c.plannedMeals}, ${c.upcomingMeals})`);
c = computeShopping(db, { asOf: "2026-10-08" });
ok(c.lines.length === 0 && c.total === 0, "once the last planned day has passed the list is empty");
ok(c.upcomingMeals === 0 && c.plannedMeals === 5, "with nothing to come, though the plan still holds all five");

console.log("\n--- when the plan cannot be dated, nothing is left out ---");
c = computeShopping(build({ start: "" }), { asOf: "2030-01-01" });
ok(c.firstDay === 0 && packs(c) === 3, "no start date means every day counts");
c = computeShopping(build({ start: "2026-10-20" }), { asOf: "2026-10-06" });
ok(c.firstDay === 0 && packs(c) === 3, "a plan that has not started yet counts in full");

console.log("\n--- every kind of demand follows the same rule ---");
const item = (portions) => ({ ingredientId: "mince", productId: "", portions, by: "portions", grams: 0 });
c = computeShopping(build({ start: "2026-10-03", days: [], extras: { 0: [item(4)], 4: [item(2)] } }), { asOf: "2026-10-06" });
ok(neededPortions(c, "mince") === 2, `an extra on a day gone is ignored, one still to come counts (${neededPortions(c, "mince")})`);
c = computeShopping(build({ start: "2026-10-03", named: true }), { asOf: "2026-10-06" });
ok(neededPortions(c, "mince") === 2 && packs(c) === 1, `a meal naming one product is cut the same way (${neededPortions(c, "mince")})`);

console.log("\n--- today is the day on the wall ---");
// 00:30 on 2 July in London is still 1 July in UTC
const late = new Date("2026-07-01T23:30:00Z");
ok(late.toISOString().slice(0, 10) === "2026-07-01", "it is still the 1st in UTC");
ok(localDay(late) === "2026-07-02", `but the day here is the 2nd (${localDay(late)})`);
ok(daysBetween === store.daysBetween, "one daysBetween, shared by the maths and the store");

/* ------------------------------ the screens ------------------------------ */

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, colorScheme: "dark" });
// a Tuesday, three days into a plan that began on Saturday 3 October
await pinClock(ctx, "2026-10-06T09:00:00");
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));

const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
async function load(dbJson) {
  await p.evaluate(async (json) => {
    const s = await import("./lib/store.js");
    await s.saveDb(s.migrate(JSON.parse(json)), true);
  }, JSON.stringify(dbJson));
  await p.reload();
  await booted();
  await p.waitForTimeout(300);
}

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();

console.log("\n--- the list ---");
await load(build({ start: "2026-10-03" }));
const lines = await p.$$eval(".ticket .name", (n) => n.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
console.log("   ", JSON.stringify(lines));
ok(lines.length === 1 && /Mince.*× 1$/.test(lines[0]), `one pack, for the two days left (${lines[0]})`);
const said = await p.$eval(".wrap", (w) => w.textContent.replace(/\s+/g, " "));
ok(/Counting from today\. The 3 earlier days stay on the Plan/.test(said), "and it says the earlier days were left out");
ok(await p.$eval('[data-act="openStocktake"]', (e) => !e.disabled), "the stock check is available, as meals are still to come");

console.log("\n--- the plan ---");
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(300);
const names = () => p.$$eval(".dayblock", (els) => els.map((e) => ({
  name: e.querySelector(".dname").textContent.replace(/\s+/g, " ").trim(),
  past: e.dataset.past === "1",
  cost: e.querySelector(".cost").textContent.trim(),
})));
let rows = await names();
console.log("   ", JSON.stringify(rows.slice(0, 3)));
ok(rows[0].name.startsWith("Tuesday") && /Today/.test(rows[0].name), "the plan opens on today");
ok(rows.length === 5, `the four days left of the week and the Saturday after it (${rows.length})`);
ok(rows.every((r) => !r.past), "with nothing from the days gone in the way");
const fold = await p.$eval(".foldlink", (e) => e.textContent.replace(/\s+/g, " ").trim());
ok(/Earlier this week \(3\)/.test(fold), `the three days gone are folded away (${fold})`);
await p.click(".foldlink");
await p.waitForTimeout(200);
rows = await names();
ok(rows.length === 8 && rows.slice(0, 3).every((r) => r.past), "unfolded they are there, and dimmed");
ok(rows[0].cost !== "" && rows[0].cost === rows[3].cost, `a day gone keeps its cost on the plan (${rows[0].cost})`);
ok(/Sat/.test(rows[7].name) && /leftovers/.test(rows[7].name), `the last row is the Saturday, for leftovers (${rows[7].name})`);

console.log("\n--- once the week is over ---");
await load(build({ start: "2026-09-26", days: [0] }));
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(200);
ok(/A new week has started/.test(await p.$eval(".banner", (e) => e.textContent)), "the plan says a new week has started");
await p.click('[data-act="tab"][data-tab="list"]');
await p.waitForTimeout(200);
ok((await p.$$(".ticket")).length === 0, "and nothing is on the list for a plan that is only history");
ok(await p.$eval('[data-act="openStocktake"]', (e) => e.disabled), "the stock check has nothing to ask about");

console.log("\n--- a plan that has run out ---");
await load(build({ start: "2026-09-12" }));
const over = await p.$eval(".wrap", (w) => w.textContent.replace(/\s+/g, " "));
ok(/The week on the plan has finished/.test(over), "the list says the plan has run out, rather than looking broken");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
