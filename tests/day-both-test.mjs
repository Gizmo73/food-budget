/* Most days are the same for both of you, so a day is read once, as "Both", and
   changed for both at a time. Changing what is in a meal for just that day does
   the same, and only a day where you really differ shows two. Repeat copies the
   first planned day into the empty days of this week from today. */
import { browser, BASE, SHOTS, pinClock, answer } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, colorScheme: "dark" });
await pinClock(ctx, "2026-08-04T09:00:00"); // Tuesday, the fourth day of a week that began on Saturday 1 August
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
const settle = () => p.waitForTimeout(450);
const readDb = () => p.evaluate(async () => (await import("./lib/store.js")).loadDb());

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mk = (id, name) => {
    const i = store.newIngredient("Tesco", name);
    i.id = id;
    i.products = [store.newProduct(name, "Tesco", { pricePerPack: 2, portionsPerPack: 4, priceUpdated: "2026-08-01" })];
    return i;
  };
  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].breakfast = ["toast", "toast"];   // Saturday 1 Aug: already gone
  plan[3].breakfast = ["toast", "toast"];   // Tuesday 4 Aug, today: the first planned day from now
  plan[3].dinner = ["pm", "pm"];            // for both
  plan[4].dinner = ["pm", null];            // Wednesday: only one of you
  await store.saveDb(store.migrate({
    schema: 9,
    ingredients: [mk("beef", "Beef"), mk("potato", "Potato"), mk("newpot", "New Potatoes")],
    meals: [
      { id: "pm", name: "Pie and Mash", updatedAt: "",
        items: [{ ingredientId: "beef", portions: 1 }, { ingredientId: "potato", portions: 1 }] },
      { id: "toast", name: "Toast", updatedAt: "", items: [{ ingredientId: "potato", portions: 1 }] },
    ],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-01",
  }), true);
});
await p.reload();
await booted();
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(300);

const summaries = (idx) => p.$$eval(`.dayblock:has([data-idx="${idx}"]) .daysummary`, (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));

console.log("--- a shared day reads once ---");
let s3 = await summaries(3);
console.log("   Tuesday:", JSON.stringify(s3));
ok(s3.length === 1 && /^Both/.test(s3[0]), "a day the same for both of you has one line, headed Both");
const s4 = await summaries(4);
ok(s4.length === 2 && /^Lee/.test(s4[0]) && /^Sam/.test(s4[1]), `a day where you differ has a line each (${JSON.stringify(s4)})`);

console.log("\n--- changing what is in the meal changes it for both ---");
await p.click('[data-act="openDay"][data-idx="3"]');
await p.waitForTimeout(250);
ok((await p.$$('[data-act="setDaySlot"]')).length === 0, "the day shows one picker for each part, not two");
await p.click('[data-act="toggleDayFold"][data-key="dinner"]');
await p.waitForTimeout(200);
ok((await p.$$('[data-act="setDayIng"][data-key="dinner"]')).length === 2, "and one list of items, for both of you");
await p.selectOption('[data-act="setDayIng"][data-key="dinner"][data-i="1"]', "newpot");
await settle();
let db = await readDb();
const edits = db.plan[3].edits.dinner.map((o) => o && o.items.map((it) => it.ingredientId).join());
console.log("   ", JSON.stringify(edits));
ok(edits[0] === "beef,newpot" && edits[1] === "beef,newpot", "the mash is swapped for new potatoes for both");
ok(db.meals.find((m) => m.id === "pm").items.map((i) => i.ingredientId).join() === "beef,potato", "and the shared meal is untouched");
ok((await p.$$('[data-act="setDaySlot"]')).length === 0, "the day still shows as one choice, since you were changed together");
await p.click('[data-act="closeSheet"]');
await settle();
s3 = await summaries(3);
ok(s3.length === 1 && /✎/.test(s3[0]), `and the plan still reads once, marked as edited (${JSON.stringify(s3)})`);

console.log("\n--- putting it back ---");
await p.click('[data-act="openDay"][data-idx="3"]');
await p.click('[data-act="toggleDayFold"][data-key="dinner"]');
await p.waitForTimeout(200);
await p.click('[data-act="revertCell"][data-key="dinner"]');
await settle();
db = await readDb();
ok(!db.plan[3].edits, "Undo edits clears it for both, and tidies the day");

console.log("\n--- saving the edit as a new meal for both ---");
// the fold stays open across the redraw, so the items are still there to change
await p.selectOption('[data-act="setDayIng"][data-key="dinner"][data-i="1"]', "newpot");
await settle();
await p.click('[data-act="saveDayMeal"][data-key="dinner"]');
await answer(p, { fill: "Pie and New Potatoes" });
await settle();
db = await readDb();
const made = db.meals.find((m) => m.name === "Pie and New Potatoes");
ok(made && db.plan[3].dinner[0] === made.id && db.plan[3].dinner[1] === made.id, "both of you are pointed at the new meal");
ok(!db.plan[3].edits, "and the loose edit is gone");
await p.click('[data-act="closeSheet"]');

console.log("\n--- splitting a slot, then joining it ---");
await p.click('[data-act="openDay"][data-idx="3"]');
await p.click('[data-act="splitSlot"][data-key="breakfast"]');
await p.waitForTimeout(200);
ok((await p.$$('[data-act="setDaySlot"][data-key="breakfast"]')).length === 2, "splitting breakfast gives each of you a picker");
ok((await p.$$('[data-act="setDaySlotBoth"]')).length === 2, "and the other two parts of the day are still one each");
await p.click('[data-act="joinSlot"][data-key="breakfast"]');
await settle();
ok((await p.$$('[data-act="setDaySlot"]')).length === 0, "Same for both folds it back");
await p.click('[data-act="closeSheet"]');

console.log("\n--- repeat, from today, into the empty days ---");
await p.click('[data-act="fillSlot"][data-slot="breakfast"]');
await settle();
db = await readDb();
const brek = db.plan.slice(0, 8).map((d) => d.breakfast.join("/"));
console.log("   ", JSON.stringify(brek));
ok(brek[0] === "toast/toast", "Saturday, already gone, is left as it was");
ok(brek.slice(3, 7).every((x) => x === "toast/toast"), "from today to Friday every empty breakfast is filled");
ok(brek[7] === "/" || brek[7] === "null/null" || db.plan[7].breakfast.every((m) => m === null), "and the leftovers Saturday is not touched");
ok(brek[1] === "/" || db.plan[1].breakfast.every((m) => m === null), "nor the days between that have gone and were empty");

await p.screenshot({ path: `${SHOTS}/plan-both.png` });
console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
