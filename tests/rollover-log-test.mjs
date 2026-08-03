/* Ending a fortnight and starting the next, and the record of things that
   went wrong while doing it. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
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
  plan[3].lunch = ["bol", null];
  await store.saveDb(store.migrate({
    schema: 9,
    ingredients: [mk("mince", "Mince")],
    meals: [{ id: "bol", name: "Bolognese", updatedAt: "", items: [{ ingredientId: "mince", portions: 1 }] }],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

console.log("--- starting the next fortnight ---");
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(400);
await p.click('[data-act="openRollover"]');
await p.waitForTimeout(400);

const offered = await p.evaluate(() => ({
  date: document.querySelector('[data-act="setRolloverStart"]').value,
  blurb: document.querySelector(".sheet p.muted").textContent.replace(/\s+/g, " ").trim(),
  head: document.querySelector(".sheet h2 + p, .sheet > .sheet p").textContent.replace(/\s+/g, " ").trim(),
  button: document.querySelector('[data-act="doRollover"]').textContent.trim(),
}));
console.log("   ", JSON.stringify(offered, null, 1));
ok(offered.date === "2026-08-17", `it offers the day the last one ended (${offered.date})`);
ok(/17 August to 30 August/.test(offered.head), `and says what it will run (${offered.head})`);
ok(/keeping 3 meals/.test(offered.button), `keeping the planned meals is the default (${offered.button})`);

// what it says it will do, it does
await p.click('[data-act="doRollover"]');
await p.waitForTimeout(600);
let said = await p.$eval(".ok, .err", (e) => e.textContent.replace(/\s+/g, " ").trim());
console.log("   said:", JSON.stringify(said));
let db = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const d = await store.loadDb();
  return { start: d.planStart, day0: d.plan[0].dinner, day3: d.plan[3].lunch };
});
console.log("   ", JSON.stringify(db));
ok(db.start === "2026-08-17", `the fortnight moved on (${db.start})`);
ok(db.day0[0] === "bol" && db.day3[0] === "bol", "and the meals came with it, in the same slots");
ok(/17 August to 30 August/.test(said), "it says what the new fortnight runs");
ok(/Nothing has been counted/.test(said), "and that nothing has been counted for it");

/* This is the difference from correcting the start date, which slides the plan
   so meals keep their old dates. Rolling over deliberately does not. */
/* Read what each day has *selected*, not what its dropdowns offer: every day
   lists every meal, so matching on the day's text would pass whatever happened. */
const chosen = await p.$$eval(".dayblock", (els) =>
  els
    .map((e) => ({
      day: e.querySelector(".dname").textContent.replace(/\s+/g, " ").trim(),
      meals: [...e.querySelectorAll("select")]
        .map((s) => s.options[s.selectedIndex].textContent.trim())
        .filter((t) => t && t !== "\u2014"),
    }))
    .filter((d) => d.meals.length));
console.log("   planned:", JSON.stringify(chosen));
ok(chosen.length === 2, `two days still have meals on them (${chosen.length})`);
ok(/17 Aug/.test(chosen[0].day) && chosen[0].meals.length === 2,
  `the first day of the new fortnight has the meals day one had (${chosen[0].day})`);
ok(!chosen.some((d) => /Aug 0[0-9]|3 Aug|6 Aug/.test(d.day)),
  "and nothing is left on the fortnight that just ended");

console.log("\n--- and the List tab asks to count again ---");
await p.click('[data-act="tab"][data-tab="list"]');
await p.waitForTimeout(400);
const badge = await p.$eval('[data-act="openStocktake"]', (e) => e.textContent.replace(/\s+/g, " ").trim());
console.log("   ", JSON.stringify(badge));
ok(/to count/.test(badge), `a count from the last fortnight does not count for this one (${badge})`);

console.log("\n--- starting empty instead ---");
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(300);
await p.click('[data-act="openRollover"]');
await p.waitForTimeout(400);
await p.click('[data-act="setRolloverKeep"][data-keep="0"]');
await p.waitForTimeout(300);
const emptied = await p.$eval('[data-act="doRollover"]', (e) => e.textContent.trim());
ok(/empty/.test(emptied), `the button changes with the choice (${emptied})`);
await p.click('[data-act="doRollover"]');
await p.waitForTimeout(600);
db = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const d = await store.loadDb();
  return {
    start: d.planStart,
    planned: d.plan.reduce((n, day) =>
      n + ["breakfast", "lunch", "dinner"].reduce((m, s) => m + day[s].filter(Boolean).length, 0), 0),
    stock: d.ingredients[0].products[0].stockPortions,
  };
});
console.log("   ", JSON.stringify(db));
ok(db.start === "2026-08-31", `it moved on again (${db.start})`);
ok(db.planned === 0, `and the plan is empty (${db.planned} planned)`);
ok(db.stock === 8, "stock is untouched, since the cupboard did not change because the calendar did");

console.log("\n--- the problem log ---");
{
  const empty = await p.evaluate(async () => {
    const log = await import("./lib/log.js");
    log.clearLog();
    return log.entries().length;
  });
  ok(empty === 0, "it starts empty");

  // something the app never catches
  await p.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", { message: "test: a thing broke" }));
  });
  await p.waitForTimeout(200);

  // and a save that cannot be written
  await p.evaluate(async () => {
    const store = await import("./lib/store.js");
    const real = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new Error("test: quota exceeded"); };
    try {
      await store.saveDb(await store.loadDb().catch(() => ({ schema: 9, ingredients: [], meals: [], plan: [] })));
    } catch (err) {
      const log = await import("./lib/log.js");
      log.note("Could not save your changes", err);
    }
    indexedDB.open = real;
  });
  await p.waitForTimeout(200);

  const got = await p.evaluate(async () => (await import("./lib/log.js")).entries());
  console.log("   ", JSON.stringify(got.map((e) => e.what)));
  ok(got.length === 2, `both were recorded (${got.length})`);
  ok(got[0].at >= got[1].at, "newest first");
  ok(got.some((e) => /a thing broke/.test(e.detail || "")), "an unhandled error is kept with its message");
  ok(got.some((e) => /quota/.test(e.detail || "")), "and so is a failed save");

  // it shows up in Settings, folded away
  await p.click('[data-act="openSettings"]');
  await p.waitForTimeout(400);
  const fold = await p.evaluate(() => {
    const head = document.querySelector('.foldhead[data-kind="problems"]');
    return head ? head.textContent.replace(/\s+/g, " ").trim() : "";
  });
  console.log("   fold:", JSON.stringify(fold));
  ok(/Problems/.test(fold), "Settings has a Problems section");
  ok(/2 recorded/.test(fold), `which says how many without being opened (${fold})`);

  await p.click('.foldhead[data-kind="problems"]');
  await p.waitForTimeout(400);
  const rows = await p.$$eval(".logrow", (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  console.log("   rows:", JSON.stringify(rows, null, 1));
  ok(rows.length === 2, `both are listed (${rows.length})`);
  ok(rows.some((t) => /Could not save/.test(t)), "including the failed save");
  await p.screenshot({ path: `${SHOTS}/problem-log.png`, fullPage: true });

  // what a copy would carry
  const text = await p.evaluate(async () => (await import("./lib/log.js")).logText("fortnight-shop-v30"));
  ok(/fortnight-shop-v30/.test(text), "a copy carries the app version");
  ok(/Mozilla|Chrome/.test(text), "and the browser, which is half of any bug report");
  ok(!/Mince|Bolognese/.test(text), "and nothing about what you eat");

  await p.click('[data-act="clearLog"]');
  await p.waitForTimeout(400);
  const after = await p.evaluate(async () => (await import("./lib/log.js")).entries().length);
  ok(after === 0, "and it can be cleared");
}

console.log("\n--- a log survives storage being broken ---");
{
  /* The whole point: the failures worth recording are the ones where the
     database is the problem, so the log must not live in the database. */
  const kept = await p.evaluate(async () => {
    const log = await import("./lib/log.js");
    const real = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new Error("test: database is gone"); };
    log.note("Could not open local storage", new Error("test: database is gone"));
    const got = log.entries();
    indexedDB.open = real;
    return got;
  });
  ok(kept.length === 1 && /database is gone/.test(kept[0].detail),
    "it recorded a failure that IndexedDB itself could not have recorded");
}

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
