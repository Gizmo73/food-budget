/* The day popout: tap a day, swap an ingredient for that day only, log an
   extra, and save a loose edit off as its own meal. Drives the real UI so the
   handlers and the fork-on-edit are exercised end to end. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
// the "save as a new meal" prompt is answered here
p.on("dialog", (d) => d.accept("Pie and New Potatoes"));

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mk = (id, name, price) => {
    const i = store.newIngredient("Tesco", name);
    i.id = id;
    i.products = [store.newProduct(name, "Tesco", { id: `${id}-p`, pricePerPack: price, portionsPerPack: 4, priceUpdated: "2026-08-01" })];
    return i;
  };
  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].dinner = ["pm", null]; // Pie and Mash for the first person
  await store.saveDb(store.migrate({
    schema: 8,
    ingredients: [mk("beef", "Beef", 3), mk("potato", "Potato", 1), mk("newpot", "New Potatoes", 1.6), mk("apple", "Apple", 0.3)],
    meals: [
      { id: "pm", name: "Pie and Mash", updatedAt: "",
        items: [{ ingredientId: "beef", portions: 1 }, { ingredientId: "potato", portions: 1 }] },
    ],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(300);

const readDb = () => p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  const day = db.plan[0];
  return {
    baseItems: db.meals.find((m) => m.id === "pm").items.map((it) => it.ingredientId),
    mealNames: db.meals.map((m) => m.name),
    dinnerP0: day.dinner[0],
    override: day.edits && day.edits.dinner && day.edits.dinner[0]
      ? day.edits.dinner[0].items.map((it) => it.ingredientId) : null,
    extrasP0: (day.extras && day.extras[0] ? day.extras[0] : []).map((it) => it.ingredientId),
  };
});

console.log("--- the grid shows the planned meal ---");
const summary0 = await p.$eval(".dayblock", (e) => e.querySelector(".daysummary").textContent.replace(/\s+/g, " ").trim());
ok(/Pie and Mash/.test(summary0), `the first day names its dinner (${summary0})`);

console.log("\n--- open the day and swap the mash for new potatoes ---");
await p.click('[data-act="openDay"][data-idx="0"]');
await p.waitForTimeout(300);
// the dinner cell shows beef then potato; swap the potato (i=1) for new potatoes
const swapSel = '[data-act="setDayIng"][data-id="0"][data-key="dinner"][data-which="0"][data-i="1"]';
await p.waitForSelector(swapSel, { timeout: 5000 });
await p.selectOption(swapSel, "newpot");
await p.waitForTimeout(400);

let db = await readDb();
console.log("   ", JSON.stringify(db));
ok(JSON.stringify(db.override) === JSON.stringify(["beef", "newpot"]),
  "the day now holds a loose edit with new potatoes");
ok(JSON.stringify(db.baseItems) === JSON.stringify(["beef", "potato"]),
  "and the shared Pie and Mash still has ordinary potato");

console.log("\n--- log an extra for the first person ---");
await p.click('[data-act="addExtra"][data-id="0"][data-which="0"]');
await p.waitForTimeout(400);
await p.selectOption('[data-act="setDayIng"][data-id="0"][data-key="extra"][data-which="0"][data-i="0"]', "apple");
await p.waitForTimeout(400);
db = await readDb();
ok(db.extrasP0.includes("apple"), `an apple is logged as an extra (${JSON.stringify(db.extrasP0)})`);

console.log("\n--- the list reflects the swap ---");
await p.evaluate(() => document.querySelector('[data-act="closeSheet"]')?.click());
await p.waitForTimeout(200);
// the edited day is marked on the grid
const summaryEdited = await p.$eval(".dayblock", (e) => e.querySelector(".daysummary").textContent.replace(/\s+/g, " ").trim());
ok(/✎/.test(summaryEdited), `the grid marks the day as edited (${summaryEdited})`);
await p.click('[data-act="tab"][data-tab="list"]');
await p.waitForTimeout(400);
const listText = await p.$eval("#app", (e) => e.textContent);
ok(/New Potatoes/.test(listText), "New Potatoes are on the shopping list");
ok(/Apple/.test(listText), "and so is the extra apple");

console.log("\n--- save the loose edit off as its own meal ---");
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(300);
await p.click('[data-act="openDay"][data-idx="0"]');
await p.waitForTimeout(300);
await p.click('[data-act="saveDayMeal"][data-id="0"][data-key="dinner"][data-which="0"]');
await p.waitForTimeout(500);
db = await readDb();
console.log("   ", JSON.stringify(db));
ok(db.mealNames.includes("Pie and New Potatoes"), "a new meal was created from the edit");
ok(db.override === null, "the loose edit is gone, now that it is a real meal");
ok(db.dinnerP0 !== "pm" && db.dinnerP0, "and the day points at the new meal");
ok(db.baseItems.join(",") === "beef,potato", "the original Pie and Mash is still untouched");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.screenshot({ path: `${SHOTS}/day-edit.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
