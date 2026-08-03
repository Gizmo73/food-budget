import { browser, BASE, SHOTS } from "./browser.mjs";

const TH = process.env.FS_THEME || "dark";
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, colorScheme: TH });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text()));
const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

await p.addInitScript((t) => localStorage.setItem("fs-theme", t), TH);
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

// Seed a fortnight with nutrition on it, through the app's own store module.
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mk = (name, per100, pp, amount, extra = {}) => {
    const ing = store.newIngredient("Tesco", name);
    ing.products = [store.newProduct(name, "Tesco", {
      pricePerPack: 2, portionsPerPack: pp, packAmount: amount, packUnit: "g", stockPortions: 0,
      kcal100: per100[0], protein100: per100[1], carbs100: per100[2], fat100: per100[3],
      nutritionUpdated: per100[0] ? "2026-07-30T10:00:00Z" : "",
      priceUpdated: "2026-07-30", ...extra,
    })];
    return ing;
  };
  const broth = mk("Broth", [40, 2.5, 4.2, 1.2], 2, 600);
  const bread = mk("Bread", [225, 7.5, 45, 1.5], 8, 800);
  const butter = mk("Butter", [0, 0, 0, 0], 25, 250);   // deliberately blank
  const mince = mk("Mince", [250, 20, 0, 19], 10, 1500,
    { portionBy: "weight", portionGrams: 150 });

  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].lunch = ["soup", null];
  plan[1].dinner = ["soup", "soup"];
  plan[2].lunch = [null, "toast"];
  plan[3].dinner = ["bol", "bol"];

  await store.saveDb(store.migrate({
    schema: 7,
    ingredients: [broth, bread, butter, mince],
    meals: [
      { id: "soup", name: "Soup and bread", items: [
        { ingredientId: broth.id, portions: 1 }, { ingredientId: bread.id, portions: 2 }] },
      { id: "toast", name: "Buttered toast", items: [
        { ingredientId: bread.id, portions: 2 }, { ingredientId: butter.id, portions: 1 }] },
      { id: "bol", name: "Bolognese", items: [
        { ingredientId: mince.id, by: "grams", grams: 400 }] },
    ],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

console.log("--- tabs ---");
const tabs = await p.$$eval('[data-act="tab"]', (els) =>
  els.map((e) => ({ tab: e.dataset.tab, text: e.textContent.replace(/\s+/g, " ").trim() })));
console.log("   ", JSON.stringify(tabs));
ok(tabs.length === 5, "five tabs");
ok(tabs.some((t) => t.tab === "food"), "there is a Food tab");

console.log("\n--- items page ---");
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(300);
const order = await p.evaluate(() => {
  const wrap = document.querySelector(".wrap");
  const add = wrap.querySelector('[data-act="addItem"]');
  const firstCard = wrap.querySelector(".card");
  if (!add || !firstCard) return null;
  return { addTop: add.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
           y: Math.round(add.getBoundingClientRect().top) };
});
ok(order && order.addTop, "Add an item comes before the first item card");
ok(order && order.y < 900, `and is on screen without scrolling (y=${order && order.y})`);
ok((await p.$$('[data-act="addItem"]')).length === 1, "there is only one add button");

console.log("\n--- nutrition editor ---");
// open Broth specifically: 600g over 2 portions, so a 300g portion
await p.evaluate(() => {
  const head = [...document.querySelectorAll('[data-act="openItem"]')]
    .find((e) => /Broth/.test(e.textContent));
  head.click();
});
await p.waitForTimeout(400);
// and the product itself is folded away under the ingredient, so open it
await p.click('.prodtitle[data-open="0"]');
await p.waitForTimeout(350);
// nutrition is folded away by default too, which is the whole point of it
await p.click('.foldhead[data-kind="nutrition"]');
await p.waitForTimeout(400);
const editor = await p.evaluate(() => {
  const fields = [...document.querySelectorAll('[data-act="setProductNumber"]')]
    .map((e) => e.dataset.field);
  const why = [...document.querySelectorAll(".why")].map((e) => e.textContent.replace(/\s+/g, " ").trim());
  return { fields, shoot: !!document.querySelector('[data-act="shootLabel"]'), why };
});
console.log("   fields:", JSON.stringify(editor.fields));
ok(["kcal100", "protein100", "carbs100", "fat100"].every((f) => editor.fields.includes(f)), "all four per-100 boxes render");
ok(editor.fields.includes("packAmount"), "there is a pack size box");
ok(editor.fields.includes("portionsPerPack"), "and a portions per pack box");
ok(editor.shoot, "and a photograph the label button");
ok(editor.why.some((w) => /makes a portion 300g/.test(w)), `it derives the portion weight: ${JSON.stringify(editor.why)}`);
ok(editor.why.some((w) => /120 kcal/.test(w)), "and shows what a portion comes to");

// typing a macro must stamp it, so a merge cannot lose it
await p.fill('[data-act="setProductNumber"][data-field="kcal100"]', "50");
await p.evaluate(() => document.querySelector('[data-act="setProductNumber"][data-field="kcal100"]').blur());
await p.waitForTimeout(400);
const stamped = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  const prod = db.ingredients.find((i) => i.name === "Broth").products[0];
  return { kcal: prod.kcal100, stamp: prod.nutritionUpdated };
});
ok(stamped.kcal === 50, `a typed per-100g figure saves (${stamped.kcal})`);
// must be stamped NOW, not left on the seeded date, or a merge would lose it
ok(stamped.stamp > "2026-07-31", `and is stamped with the edit, not the seed (${stamped.stamp})`);

console.log("\n--- food page ---");
await p.click('[data-act="tab"][data-tab="food"]');
await p.waitForTimeout(400);
const food = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".foodrow")].map((e) => e.textContent.replace(/\s+/g, " ").trim());
  const days = [...document.querySelectorAll(".dayblock .dname")].map((e) => e.textContent.replace(/\s+/g, " ").trim());
  return { rows, days, part: document.querySelectorAll(".part").length,
           body: document.body.textContent.replace(/\s+/g, " ") };
});
console.log("   first rows:", JSON.stringify(food.rows.slice(0, 6), null, 1));
console.log("   days:", JSON.stringify(food.days.slice(0, 4)));
ok(food.days.length === 14, `fourteen days listed (${food.days.length})`);
ok(/Monday 3 Aug/.test(food.days[0]), `dated from the seed date: ${food.days[0]}`);
ok(food.rows.some((r) => /Lee/.test(r)) && food.rows.some((r) => /Sam/.test(r)), "both people appear");
ok(food.rows.filter((r) => /nothing planned/.test(r)).length > 0, "empty days say so");
ok(food.part > 0, "the partly-known day is flagged");
ok(/P\b/.test(food.body) && /C\b/.test(food.body) && /F\b/.test(food.body), "macros are shown");

// the figures on the page must match what calc says
const check = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const calc = await import("./lib/calc.js");
  const c = calc.computeShopping(await store.loadDb());
  return { d0: Math.round(c.dayNutrition[0][0].kcal), d1b: Math.round(c.dayNutrition[1][1].kcal),
           badge: c.dayKcal, complete2: c.dayComplete[2][1] };
});
console.log("   calc says:", JSON.stringify(check));
ok(food.rows[2].includes(String(check.d0)), `day 1 row shows ${check.d0} kcal`);
ok(check.complete2 === false, "day 3 is genuinely partly known");
const badge = await p.$eval('[data-act="tab"][data-tab="food"] .cnt', (e) => e.textContent.trim());
ok(badge === String(check.badge), `tab badge matches calc (${badge})`);

console.log("\n--- other tabs still work ---");
for (const t of ["list", "plan", "meals", "items"]) {
  await p.click(`[data-act="tab"][data-tab="${t}"]`);
  await p.waitForTimeout(250);
  const n = await p.evaluate(() => document.querySelector(".wrap").textContent.trim().length);
  ok(n > 40, `${t} renders (${n} chars)`);
}

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");

await p.click('[data-act="tab"][data-tab="food"]');
await p.waitForTimeout(300);
await p.screenshot({ path: `${SHOTS}/food-${TH}.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
