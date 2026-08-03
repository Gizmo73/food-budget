/* Nothing takes stock out on its own, and nothing sensibly could: meals are
   not the only thing that empties a cupboard and nobody is going to record a
   snack. So the app asks once, at the point it is worth asking, and only about
   what the plan actually needs. */
import { browser, BASE, SHOTS } from "./browser.mjs";
import { migrate, mergeSnapshots, newIngredient, newProduct, SCHEMA_VERSION } from "../lib/store.js";
import { computeShopping, neededPortions } from "../lib/calc.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const at = (d) => `2026-08-${String(d).padStart(2, "0")}T10:00:00.000Z`;

console.log("--- what the plan asks for ---");
{
  const mk = (id, name, portions) => {
    const ing = newIngredient("Tesco", name);
    ing.id = id;
    ing.products = [newProduct(name, "Tesco", {
      pricePerPack: 2, portionsPerPack: portions, stockPortions: 0, priceUpdated: "2026-08-01",
    })];
    return ing;
  };
  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].dinner = ["bol", "bol"];
  const db = migrate({
    schema: SCHEMA_VERSION,
    ingredients: [mk("mince", "Mince", 4), mk("pasta", "Pasta", 5), mk("cake", "Cake", 8)],
    meals: [{ id: "bol", name: "Bolognese", updatedAt: "", items: [
      { ingredientId: "mince", portions: 1 }, { ingredientId: "pasta", portions: 0.5 }] }],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
  });
  const c = computeShopping(db);
  ok(Math.abs(neededPortions(c, "mince") - 2) < 0.001, `Mince is needed twice over (${neededPortions(c, "mince")})`);
  ok(Math.abs(neededPortions(c, "pasta") - 1) < 0.001, "and Pasta once");
  ok(neededPortions(c, "cake") === 0, "Cake is not on the plan, so a stock check never asks about it");
}

console.log("\n--- a count beats arithmetic when two phones disagree ---");
{
  const build = (stock, checkedAt) => {
    const ing = newIngredient("Tesco", "Mince");
    ing.id = "mince";
    ing.updatedAt = at(1);
    ing.products = [newProduct("Mince", "Tesco", {
      pricePerPack: 3, portionsPerPack: 4, stockPortions: stock,
      stockCheckedAt: checkedAt, priceUpdated: "2026-08-01",
    })];
    return migrate({
      schema: SCHEMA_VERSION, ingredients: [ing], meals: [], plan: [],
      people: ["Lee", "Sam"], planStart: "", updatedAt: at(1),
    });
  };

  // Sam's phone added 8 up from receipts; Lee looked in the freezer and found 2
  const merged = mergeSnapshots(build(8, ""), build(2, at(5))).db;
  ok(merged.ingredients[0].products[0].stockPortions === 2,
    `the counted figure wins even though it is lower (${merged.ingredients[0].products[0].stockPortions})`);
  ok(merged.ingredients[0].products[0].stockCheckedAt === at(5), "and the count is stamped");

  // two counts: the later one
  const two = mergeSnapshots(build(2, at(5)), build(6, at(9))).db;
  ok(two.ingredients[0].products[0].stockPortions === 6, "of two counts, the later wins");

  // neither counted: back to the old rule, a bought pack is a physical fact
  const neither = mergeSnapshots(build(2, ""), build(6, "")).db;
  ok(neither.ingredients[0].products[0].stockPortions === 6,
    "with nobody having counted, the higher figure still wins");
}

console.log("\n--- through the app ---");
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
p.on("pageerror", (e) => { console.log("  pageerror: " + e.message); fail.push("pageerror"); });
p.on("console", (m) => m.type() === "error" && fail.push("console: " + m.text()));

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mk = (id, name, per, stock) => {
    const i = store.newIngredient("Tesco", name);
    i.id = id;
    i.products = [store.newProduct(name, "Tesco", {
      pricePerPack: 3, portionsPerPack: per, stockPortions: stock, priceUpdated: "2026-08-01",
    })];
    return i;
  };
  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].dinner = ["bol", "bol"];
  plan[1].dinner = ["bol", "bol"];
  await store.saveDb(store.migrate({
    schema: 9,
    ingredients: [mk("mince", "Mince", 4, 8), mk("pasta", "Pasta", 5, 5), mk("cake", "Cake", 8, 0)],
    meals: [{ id: "bol", name: "Bolognese", updatedAt: "", items: [
      { ingredientId: "mince", portions: 1 }, { ingredientId: "pasta", portions: 0.5 }] }],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

const totalNow = () => p.$eval(".till .big", (e) => e.textContent.trim());
const started = await totalNow();
console.log("   list starts at", started);

const badge = await p.$eval('[data-act="openStocktake"]', (e) => e.textContent.replace(/\s+/g, " ").trim());
console.log("   button:", JSON.stringify(badge));
ok(/Stock check/.test(badge), "the List tab offers a stock check");
ok(/2 to count/.test(badge), `and says how many are uncounted (${badge})`);

await p.click('[data-act="openStocktake"]');
await p.waitForTimeout(400);

const shown = await p.$$eval(".sheet .card", (els) =>
  els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
console.log("   rows:", JSON.stringify(shown, null, 1));
ok(shown.length === 2, `only the two things the plan needs (${shown.length})`);
ok(shown.some((t) => /Mince/.test(t)) && shown.some((t) => /Pasta/.test(t)), "Mince and Pasta");
ok(!shown.some((t) => /Cake/.test(t)), "and not the Cake, which nothing is planned with");
ok(shown.some((t) => /needs 4 portions/.test(t)), "each says what the plan needs of it");
ok(shown.every((t) => /never counted/.test(t)), "and that nobody has counted it");

console.log("\n--- counting ---");
// there is less mince than the app thought
await p.fill('.countrow [data-act="setStockCount"][data-id="mince"]', "2");
await p.evaluate(() =>
  document.querySelector('.countrow [data-act="setStockCount"][data-id="mince"]').blur());
await p.waitForTimeout(500);

const afterMince = await p.evaluate(() => {
  const head = document.querySelector(".sheet .muted");
  return {
    blurb: document.querySelector(".sheet p.muted, .sheet > .sheet p") ? "" : "",
    sub: [...document.querySelectorAll(".sheet p")].map((e) => e.textContent.replace(/\s+/g, " ").trim())[0],
    counted: document.querySelectorAll(".countrow.counted").length,
  };
});
ok(afterMince.counted === 1, `the row goes quiet once counted (${afterMince.counted})`);

// the pasta figure was right, so say so without changing it
await p.click('.countrow [data-act="confirmStock"][data-id="pasta"]');
await p.waitForTimeout(500);
const both = await p.$$eval(".countrow.counted", (e) => e.length);
ok(both === 2, `confirming counts too, without changing the figure (${both})`);

const stored = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  const get = (id) => db.ingredients.find((i) => i.id === id).products[0];
  return {
    mince: get("mince").stockPortions, minceAt: !!get("mince").stockCheckedAt,
    pasta: get("pasta").stockPortions, pastaAt: !!get("pasta").stockCheckedAt,
    cakeAt: !!get("cake").stockCheckedAt,
  };
});
console.log("   stored:", JSON.stringify(stored));
ok(stored.mince === 2, `the corrected figure saved (${stored.mince})`);
ok(stored.pasta === 5, "the confirmed one is unchanged");
ok(stored.minceAt && stored.pastaAt, "both are stamped as counted");
ok(!stored.cakeAt, "and nothing touched what was never asked about");

await p.screenshot({ path: `${SHOTS}/stocktake.png`, fullPage: true });

console.log("\n--- finishing ---");
await p.click('[data-act="finishStocktake"]');
await p.waitForTimeout(600);
const said = await p.evaluate(() => {
  const el = document.querySelector(".ok, .err");
  return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
});
const ended = await totalNow();
console.log("   said:", JSON.stringify(said), "total", started, "->", ended);
ok(!(await p.$(".sheet")), "the sheet closes");
ok(/2 counted/.test(said), `it says how many were counted (${said})`);
ok(/more/.test(said) && /£/.test(said), "and what that did to the shopping total");
ok(ended !== started, `which really did change (${started} -> ${ended})`);

// and the badge now says there is nothing left to count
const after = await p.$eval('[data-act="openStocktake"]', (e) => e.textContent.replace(/\s+/g, " ").trim());
ok(!/to count/.test(after), `the button stops nagging once everything is counted (${after})`);

console.log("\n--- nothing planned ---");
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  db.plan = db.plan.map(() => ({ breakfast: [null, null], lunch: [null, null], dinner: [null, null] }));
  await store.saveDb(db);
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);
const off = await p.$eval('[data-act="openStocktake"]', (e) => e.disabled);
ok(off, "with nothing planned there is nothing to count, and the button says so");

console.log("\npage errors:", fail.filter((f) => /error/.test(f)).length || "none");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
