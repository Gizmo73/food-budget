/* Deleting a meal empties every place on the plan that used it, for either
   person, and leaves every other meal where it was. A slot holds one meal per
   person, and this once compared the whole pair with the id, so nothing ever
   matched and the plan kept pointing at a meal that no longer existed. */
import { browser, BASE } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const booted = () => p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const plan = Array.from({ length: 14 }, () => ({ breakfast: [null, null], lunch: [null, null], dinner: [null, null] }));
  plan[0].dinner = ["bol", "bol"];          // both people
  plan[1].dinner = ["toast", "bol"];        // only one of them
  plan[2].lunch = ["toast", null];          // a different meal, which must stay
  await store.saveDb(store.migrate({
    schema: 8, ingredients: [],
    meals: [
      { id: "bol", name: "Bolognese", updatedAt: "", items: [] },
      { id: "toast", name: "Beans on toast", updatedAt: "", items: [] },
    ],
    plan, people: ["Lee", "Sam"], planStart: "",
  }), true);
  location.reload();
});
await booted();

await p.click('[data-act="tab"][data-tab="meals"]');
await p.waitForTimeout(200);
await p.click('.card [data-act="openMeal"][data-id="bol"]');
await p.waitForTimeout(200);
p.once("dialog", (d) => d.accept());
await p.click('[data-act="delMeal"]');
await p.waitForTimeout(400);

const plan = await p.evaluate(async () => (await (await import("./lib/store.js")).loadDb()).plan.slice(0, 3));
console.log("   ", JSON.stringify(plan.map((d) => [d.breakfast, d.lunch, d.dinner])));
ok(JSON.stringify(plan[0].dinner) === '[null,null]', "a dinner planned for both is empty for both");
ok(JSON.stringify(plan[1].dinner) === '["toast",null]', "one planned for a single person is emptied for them only");
ok(JSON.stringify(plan[2].lunch) === '["toast",null]', "and another meal is untouched");
ok(plan.every((d) => ["breakfast", "lunch", "dinner"].every((k) => Array.isArray(d[k]) && d[k].length === 2)),
  "every slot is still a pair");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
