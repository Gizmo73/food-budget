import { browser, BASE, SHOTS } from "./browser.mjs";
const TH = process.env.FS_THEME || "dark";
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 1000 }, deviceScaleFactor: 2, colorScheme: TH });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

/* Products start collapsed under an ingredient now, so open one before
   reaching for anything inside its editor. */
const openFirstProduct = async (page) => {
  await page.evaluate(() => {
    const head = document.querySelector('.prodtitle[data-open="0"]');
    if (head) head.click();
  });
  await page.waitForTimeout(350);
};
await p.addInitScript((t) => localStorage.setItem("fs-theme", t), TH);
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const arla = s.newIngredient("Tesco", "Arla Lactofree Semi Skimmed Milk");
  arla.id = "arla";
  arla.aliases = ["arla lactofree semi skimmed milk drink 2l"];
  arla.products = [s.newProduct("Arla Lactofree Semi Skimmed Milk", "Tesco", {
    id: "arla-tesco", pricePerPack: 3.15, portionsPerPack: 4, packAmount: 2000, packUnit: "ml",
    stockPortions: 3, barcodes: ["5000000111111"], priceUpdated: "2026-08-01T10:00:00Z",
    kcal100: 42, protein100: 3.4, carbs100: 4.8, fat100: 1.5, nutritionUpdated: "2026-07-30",
  })];
  const milk = s.newIngredient("Tesco", "Milk");
  milk.id = "milk";
  milk.products = [s.newProduct("Semi Skimmed Milk", "Tesco", {
    id: "milk-tesco", pricePerPack: 1.45, portionsPerPack: 4, packAmount: 2000, packUnit: "ml",
    stockPortions: 2, priceUpdated: "2026-08-01T10:00:00Z",
  })];
  const plan = Array.from({ length: 14 }, () => ({ breakfast: [null, null], lunch: [null, null], dinner: [null, null] }));
  plan[0].breakfast = ["cereal", "cereal"];
  await s.saveDb(s.migrate({
    schema: 7, ingredients: [arla, milk],
    meals: [{ id: "cereal", name: "Cereal", items: [{ ingredientId: "arla", productId: "", portions: 0.5 }] }],
    plan, people: ["Lee", "Sam"], planStart: "",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

console.log("--- the control ---");
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(300);
const countBefore = await p.$$eval('[data-act="openItem"]', (e) => e.length);
ok(countBefore === 2, `two items to start (${countBefore})`);

await p.evaluate(() => [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Arla/.test(e.textContent)).click());
await openFirstProduct(p);
await p.waitForTimeout(400);
const control = await p.evaluate(() => {
  const sel = document.querySelector('[data-act="moveProduct"]');
  return sel ? {
    placeholder: sel.options[0].textContent.trim(),
    options: [...sel.options].slice(1).map((o) => o.textContent.trim()),
    title: sel.title,
  } : null;
});
console.log("  ", JSON.stringify(control));
ok(!!control, "the move control is on the product card");
ok(control.options.includes("Milk"), "offering Milk as a destination");
ok(!control.options.includes("Arla Lactofree Semi Skimmed Milk"), "and not the ingredient it is already under");
/* The warning moved out of the option text and onto its own line: a select's
   widest option decides how much room it takes, and a sentence in there
   crushed the buttons beside it. */
ok(control.placeholder === "Move to\u2026", `the label is short (${control.placeholder})`);
const warned = await p.evaluate(() =>
  [...document.querySelectorAll(".why")].map((e) => e.textContent.replace(/\s+/g, " ").trim()));
ok(warned.some((w) => /only one here, so moving it takes/.test(w)),
  `and the warning is visible beneath instead: ${JSON.stringify(warned.filter((w) => /only one/.test(w)))}`);

console.log("\n--- do the move ---");
await p.selectOption('[data-act="moveProduct"]', "milk");
await p.waitForTimeout(600);
const flash = await p.evaluate(() => document.querySelector(".ok")?.textContent.replace(/\s+/g, " ").trim() || "");
console.log("   flash:", flash);
ok(flash.length > 0, `the banner is not empty (${JSON.stringify(flash)})`);
ok(/filed under Milk/.test(flash), "it says what happened");
ok(/has gone/.test(flash), "including that the old ingredient was removed");

const after = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const c = await import("./lib/calc.js");
  const db = await s.loadDb();
  const milk = db.ingredients.find((i) => i.id === "milk");
  return {
    ingredients: db.ingredients.map((i) => i.name),
    milkProducts: milk.products.map((x) => `${x.name}@${x.store}:${x.pricePerPack}`),
    stock: c.stockPortions(milk),
    aliases: milk.aliases,
    mealPoints: db.meals[0].items[0].ingredientId,
    problems: c.computeShopping(db).problems.length,
  };
});
console.log("  ", JSON.stringify(after, null, 1));
ok(after.ingredients.length === 1 && after.ingredients[0] === "Milk", "only Milk remains as an ingredient");
ok(after.milkProducts.length === 2, "with both cartons under it");
ok(after.stock === 5, `stock pooled to 5 portions, 2 + 3 (${after.stock})`);
ok(after.aliases.includes("arla lactofree semi skimmed milk drink 2l"), "the alias came with it");
ok(after.mealPoints === "milk", "the meal now asks for Milk");
ok(after.problems === 0, "and nothing is unbuyable");

console.log("\n--- copy to a shop still works on the moved product ---");
await p.waitForTimeout(200);
await p.evaluate(() => [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Milk/.test(e.textContent)).click());
await p.waitForTimeout(400);
// only the product you have open shows its actions now, so open the Arla one
ok((await p.$$(".prodtitle")).length === 2, "both products have a header");
await p.evaluate(() => {
  const head = [...document.querySelectorAll(".prodtitle")].find((e) => /Arla/.test(e.textContent));
  if (head && head.dataset.open !== "1") head.click();
});
await p.waitForTimeout(400);
const copies = await p.$$('[data-act="copyProduct"]');
ok(copies.length === 1, `the open product offers Copy to a shop (${copies.length})`);
await p.evaluate(() => {
  document.querySelector('[data-act="copyProduct"]').click();
});
await p.waitForTimeout(600);
const copied = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const db = await s.loadDb();
  const milk = db.ingredients.find((i) => i.id === "milk");
  return {
    n: milk.products.length,
    ids: milk.products.map((x) => x.id),
    newest: milk.products[milk.products.length - 1],
  };
});
ok(copied.n === 3, `a third product was made (${copied.n})`);
ok(new Set(copied.ids).size === 3, "with a unique id inside its new home");
ok(copied.newest.kcal100 === 42, "carrying the nutrition of the one it copied");
ok(copied.newest.store === "" && copied.newest.pricePerPack === 0, "and blank shop and price, as designed");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.screenshot({ path: `${SHOTS}/move-${TH}.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
