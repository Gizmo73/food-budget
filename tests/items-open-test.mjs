/* Opening an item. What you come here to change is the shop, the price and the
   stock, so they are there at once; with one product there is nothing to choose
   between, so it is open already. Adding to the shopping list is the List's job,
   so the Items tab has no plus of its own. */
import { browser, BASE, SHOTS, pinClock } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await pinClock(ctx);
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
const readDb = () => p.evaluate(async () => (await import("./lib/store.js")).loadDb());
const settle = () => p.waitForTimeout(400);
const openItem = (name) => p.evaluate((n) =>
  [...document.querySelectorAll('[data-act="openItem"]')].find((e) => e.textContent.includes(n)).click(), name);

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  const db = s.migrate(JSON.parse(json));
  // a second product, so one item has something to choose between
  const cheese = db.ingredients.find((i) => i.name === "Cheese");
  cheese.products.push(s.newProduct("Mild Cheddar", "Aldi", { pricePerPack: 2.2, portionsPerPack: 8 }));
  await s.saveDb(db, true);
}, readFileSync(FIXTURE, "utf8"));
await p.reload();
await booted();

console.log("--- the Items tab has no plus of its own ---");
await p.click('[data-act="tab"][data-tab="items"]');
await settle();
ok(await p.$('[data-act="addToList"]') === null, "no plus on any row");
ok(await p.$('[data-act="addProductToList"]') === null, "and none inside a product");

console.log("\n--- an item with one product ---");
await openItem("Steak Pies");
await settle();
ok(await p.$('[data-act="setProductPrice"]') !== null, "its price is there without a second tap");
const order = await p.evaluate(() => {
  const at = (act) => {
    const el = document.querySelector(`.card.editing [data-act="${act}"]`);
    return el ? el.getBoundingClientRect().top : null;
  };
  const fold = document.querySelector(".card.editing .fold");
  return {
    shop: at("setProductStore"), price: at("setProductPrice"), stock: at("setProductNumber"),
    fold: fold ? fold.getBoundingClientRect().top : null,
  };
});
console.log("   ", JSON.stringify(order));
ok(order.shop !== null && order.price !== null && order.stock !== null, "shop, price and stock are all up front");
ok(order.fold > order.stock, "ahead of the folded detail");
ok(await p.$eval(".card.editing", (e) => !/Any of it, by hand/.test(e.textContent)), "and the by-hand block is gone");

console.log("\n--- changing the three ---");
await p.fill('.card.editing [data-act="setProductPrice"]', "2.75");
await p.evaluate(() => document.querySelector('.card.editing [data-act="setProductPrice"]').blur());
await settle();
await p.click('.card.editing [data-act="moreStockPack"]');
await settle();
const pies = (await readDb()).ingredients.find((i) => i.name === "Steak Pies").products[0];
ok(pies.pricePerPack === 2.75, `the price saved (${pies.pricePerPack})`);
ok(pies.stockPortions > 4, `and a pack went into stock (${pies.stockPortions})`);

console.log("\n--- an item with two products ---");
await openItem("Cheese");
await settle();
const heads = await p.$$eval(".prodtitle", (e) => e.length);
ok(heads === 2, `two headers to choose between (${heads})`);
ok(await p.$('[data-act="setProductPrice"]') === null, "and neither is open until one is chosen");
ok(/Products/.test(await p.$eval(".card.editing", (e) => e.textContent)), "under a heading that says what they are");
await p.screenshot({ path: `${SHOTS}/items-open.png`, fullPage: true });

console.log("page errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
