/* Three small refinements:
   1. adding a meal jumps to it and focuses its name, rather than leaving you to
      hunt for "New meal" wherever it falls in the alphabetised list;
   2. a freshly added ingredient defaults to one portion, not half;
   3. a shopping line reads "Name × N · £x each · offer", with no stock to
      reconcile in your head. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mince = store.newIngredient("Tesco", "Mince");
  mince.id = "mince";
  mince.products = [store.newProduct("Beef Mince", "Tesco", {
    id: "mince-p", pricePerPack: 3, portionsPerPack: 4, stockPortions: 0, priceUpdated: "2026-08-01",
    offer: { kind: "multibuy", qty: 3, price: 8, ends: "" },
  })];
  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].dinner = ["bol", null];
  await store.saveDb(store.migrate({
    schema: 8,
    ingredients: [mince],
    meals: [{ id: "bol", name: "Bolognese", updatedAt: "", items: [{ ingredientId: "mince", portions: 1 }] }],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

console.log("--- adding a meal jumps to it ---");
await p.click('[data-act="tab"][data-tab="meals"]');
await p.waitForTimeout(300);
await p.click('[data-act="addMeal"]');
await p.waitForTimeout(400);
const focused = await p.evaluate(() => {
  const a = document.activeElement;
  return { act: a && a.dataset ? a.dataset.act : null, field: a && a.dataset ? a.dataset.field : null, value: a ? a.value : null };
});
console.log("  ", JSON.stringify(focused));
ok(focused.act === "setMealName" && focused.field === "name", "the new meal's name box is focused, so the page jumped to it");
ok(focused.value === "New meal", "with its placeholder name ready to overwrite");

console.log("\n--- a new ingredient defaults to one portion ---");
await p.click('[data-act="addMealIng"]');
await p.waitForTimeout(400);
const portions = await p.$eval('[data-act="setMealPortions"]', (e) => e.value);
console.log("   portions:", portions);
ok(portions === "1", `the added ingredient starts at one portion (${portions})`);

console.log("\n--- the shopping line is compact ---");
await p.click('[data-act="tab"][data-tab="list"]');
await p.waitForTimeout(400);
const ticket = await p.evaluate(() => {
  const t = document.querySelector(".ticket");
  if (!t) return null;
  return {
    name: t.querySelector(".name").textContent.replace(/\s+/g, " ").trim(),
    metas: [...t.querySelectorAll(".meta")].map((m) => m.textContent.replace(/\s+/g, " ").trim()),
    all: t.textContent.replace(/\s+/g, " ").trim(),
  };
});
console.log("  ", JSON.stringify(ticket));
ok(ticket && /Mince ×\s*1/.test(ticket.name), `the name carries the quantity (${ticket && ticket.name})`);
ok(ticket && ticket.metas.some((m) => /£3\.00 each/.test(m)), "the price is per pack, labelled 'each'");
ok(ticket && ticket.metas.some((m) => /3 for £8\.00/.test(m)), "the offer is shown when there is one");
ok(ticket && !/in stock|left over|pack .*@/.test(ticket.all), "and no stock or packs-at wording is left on the line");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.screenshot({ path: `${SHOTS}/tweaks.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
