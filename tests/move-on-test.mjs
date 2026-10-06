/* Moving on a week. Once the week is over the plan says so and offers to move on,
   repeating the meals or starting empty. The Saturday after the week, where
   Friday's leftovers get eaten, becomes the first day of the new one and keeps
   what was planned on it. One-day edits are left behind; stock is untouched but
   has to be counted again; and a phone left alone for weeks catches up in one tap. */
import { browser, BASE, SHOTS, pinClock } from "./browser.mjs";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, colorScheme: "dark" });
// Saturday 8 August: the week that began on the 1st is over
await pinClock(ctx, "2026-08-08T09:00:00");
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
const settle = () => p.waitForTimeout(500);
const readDb = () => p.evaluate(async () => (await import("./lib/store.js")).loadDb());

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mk = (id, name) => {
    const i = store.newIngredient("Tesco", name);
    i.id = id;
    i.products = [store.newProduct(name, "Tesco", {
      pricePerPack: 3, portionsPerPack: 4, stockPortions: 8,
      stockCheckedAt: "2026-08-04T09:00:00.000Z", priceUpdated: "2026-08-01",
    })];
    return i;
  };
  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].dinner = ["bol", "bol"];
  plan[1].dinner = ["bol", "bol"];
  plan[1].edits = { dinner: [{ name: "Bol", items: [{ ingredientId: "mince", portions: 3 }] }, null] }; // one day only
  plan[3].lunch = ["bol", null];
  plan[5].breakfast = ["fry", "fry"];
  plan[7].lunch = ["soup", "soup"]; // the Saturday after: Friday's leftovers
  plan[7].written = ["Leftover curry"];
  await store.saveDb(store.migrate({
    schema: 9,
    ingredients: [mk("mince", "Mince")],
    meals: [
      { id: "bol", name: "Bolognese", updatedAt: "", items: [{ ingredientId: "mince", portions: 1 }] },
      { id: "fry", name: "Fry Up", updatedAt: "", items: [{ ingredientId: "mince", portions: 1 }] },
      { id: "soup", name: "Soup", updatedAt: "", items: [{ ingredientId: "mince", portions: 1 }] },
    ],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-01",
  }), true);
});
await p.reload();
await booted();
await p.waitForTimeout(400);

const rows = () => p.$$eval(".dayblock", (els) => els.map((e) => e.querySelector(".dname").textContent.replace(/\s+/g, " ").trim()));
const goPlan = async () => { await p.click('[data-act="tab"][data-tab="plan"]'); await p.waitForTimeout(300); };

console.log("--- the week is over ---");
await goPlan();
const banner = await p.$eval(".banner", (e) => e.textContent.replace(/\s+/g, " ").trim());
console.log("   ", banner);
ok(/A new week has started/.test(banner), "the plan says so");
ok((await p.$$('[data-act="moveOn"]')).length === 2, "and offers to move on, two ways");
ok(/Move on, repeat meals/.test(await p.$eval('[data-act="moveOn"][data-keep="1"]', (e) => e.textContent)) &&
   (await p.$eval('[data-act="moveOn"][data-keep="1"]', (e) => e.classList.contains("solid"))), "repeating is the main one");
let r = await rows();
ok(r.length === 1 && /Saturday 8 Aug/.test(r[0]) && /Today/.test(r[0]), `only the Saturday after is left to plan (${JSON.stringify(r)})`);
ok(/Earlier this week \(7\)/.test(await p.$eval(".foldlink", (e) => e.textContent.replace(/\s+/g, " "))), "the week that finished is folded away");

console.log("\n--- moving on, repeating the meals ---");
await p.click('[data-act="moveOn"][data-keep="1"]');
await settle();
let db = await readDb();
const said = await p.$eval(".ok, .err", (e) => e.textContent.replace(/\s+/g, " ").trim());
console.log("   said:", JSON.stringify(said));
ok(db.planStart === "2026-08-08", `the week moved on to the Saturday (${db.planStart})`);
ok(db.plan[0].lunch[0] === "soup" && db.plan[0].lunch[1] === "soup", "the leftovers day kept what was planned on it, now the first day");
ok(JSON.stringify(db.plan[0].written) === '["Leftover curry"]', "and the meal written onto it");
ok(db.plan[0].dinner[0] === "bol" && db.plan[0].dinner[1] === "bol", "last week's dinner is repeated into the empty place beside it");
ok(db.plan[1].dinner[0] === "bol" && db.plan[1].dinner[1] === "bol", "and the next day's, for both of you");
ok(db.plan[3].lunch[0] === "bol" && db.plan[3].lunch[1] === null, "in the same slots, for the same people");
ok(db.plan[5].breakfast[0] === "fry", "all the way through the week");
ok(!db.plan[1].edits, "a one-day edit was left behind, as it belonged to that day");
ok(db.plan[7].lunch.every((m) => m === null), "and the new leftovers day starts empty");
ok(/week of 8 August/.test(said) && /7 meals repeated/.test(said), `it says what it did (${said})`);
ok((await p.$(".banner")) === null, "the banner is gone");
r = await rows();
ok(r.length === 8 && /Today/.test(r[0]) && /leftovers/.test(r[7]), `eight days again, today first (${r.length})`);

console.log("\n--- stock is untouched, but has to be counted again ---");
ok(db.ingredients[0].products[0].stockPortions === 8, "the cupboard did not change because the calendar did");
await p.click('[data-act="tab"][data-tab="list"]');
await p.waitForTimeout(300);
ok(/to count/.test(await p.$eval('[data-act="openStocktake"]', (e) => e.textContent)), "and the stock check asks again");

console.log("\n--- a week later, moving on empty ---");
await p.clock.fastForward(7 * 86400 * 1000);
await p.reload();
await booted();
await goPlan();
ok((await p.$(".banner")) !== null, "the banner is back when the next week is over");
await p.click('[data-act="moveOn"][data-keep="0"]');
await settle();
db = await readDb();
const planned = db.plan.reduce((n, day) => n + ["breakfast", "lunch", "dinner"].reduce((m, s) => m + day[s].filter(Boolean).length, 0), 0);
console.log("   ", JSON.stringify({ start: db.planStart, planned }));
ok(db.planStart === "2026-08-15", `it moved on again (${db.planStart})`);
ok(planned === 0, `and with nothing on the leftovers day the new week is empty (${planned} planned)`);

console.log("\n--- a phone left alone catches up in one tap ---");
await p.clock.fastForward(15 * 86400 * 1000);
await p.reload();
await booted();
await goPlan();
await p.click('[data-act="moveOn"][data-keep="0"]');
await settle();
db = await readDb();
ok(db.planStart === "2026-08-29", `two weeks passed, so it moved two (${db.planStart})`);
ok((await p.$(".banner")) === null, "and today is inside the week again");

console.log("\n--- there is nothing to move on from before the week is dated ---");
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const d = await store.loadDb();
  d.planStart = "";
  await store.saveDb(d, true);
});
await p.reload();
await booted();
await goPlan();
ok((await p.$(".banner")) === null && (await p.$('[data-act="setPlanStart"]')) !== null, "no banner, only a place to say when the week starts");
await p.screenshot({ path: `${SHOTS}/plan-undated.png` });

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
