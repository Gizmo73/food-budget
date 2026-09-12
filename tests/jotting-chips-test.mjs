/* Writing something down before you know which shop it will come from. The
   "No shop yet" group is always offered, even with nothing planned and
   nothing written, so there is never a state where something cannot be
   written down - and once it is, it can be filed onto an existing shop with a
   tap, or onto a brand new one. */
import { browser, BASE } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

console.log("--- an empty list still offers somewhere to write ---");
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  await store.saveDb(store.migrate({ schema: 8, ingredients: [], meals: [], plan: [], jottings: [] }), true);
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(300);

// &#0; is a null character reference, which HTML replaces with U+FFFD per spec
const looseHeadSel = 'button[data-act="toggleStore"][data-store="�loose"]';
ok((await p.$(looseHeadSel)) !== null, "the No shop yet group renders with nothing planned or written");
const addBtn = await p.$('button[data-act="addJotting"][data-store=""]');
ok(addBtn !== null, "and it offers Add something by hand");

console.log("\n--- writing one with no shop ---");
await p.click('button[data-act="addJotting"][data-store=""]');
await p.waitForTimeout(200);
const box = p.locator('textarea[data-act="setJotting"]').last();
await box.fill("Stamps");
await box.blur();
await p.waitForTimeout(300);

const stored = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return db.jottings.map((j) => ({ store: j.store, text: j.text }));
});
console.log("   ", JSON.stringify(stored));
ok(stored.length === 1 && stored[0].store === "" && stored[0].text === "Stamps",
  "it is saved with an empty store, not guessed at");

console.log("\n--- it offers real shops to file it against ---");
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mk = (id, name, shop) => {
    const i = store.newIngredient(shop, name);
    i.id = id;
    i.products = [store.newProduct(name, shop, { pricePerPack: 1, portionsPerPack: 2, priceUpdated: "2026-08-01" })];
    return i;
  };
  const db = await store.loadDb();
  db.ingredients = [mk("bread", "Bread", "Tesco"), mk("milk", "Milk", "Asda")];
  db.meals = [{ id: "brek", name: "Breakfast", updatedAt: "", items: [
    { ingredientId: "bread", portions: 1 }, { ingredientId: "milk", portions: 1 }] }];
  db.plan = Array.from({ length: 14 }, () => ({ breakfast: ["brek", "brek"], lunch: [null, null], dinner: [null, null] }));
  await store.saveDb(db, true);
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(300);

const chips = await p.$$eval('button[data-act="fileJotting"]', (els) => els.map((e) => e.dataset.store));
console.log("   chips:", JSON.stringify(chips));
ok(chips.includes("Tesco") && chips.includes("Asda"), `both real shops are offered as chips (${JSON.stringify(chips)})`);
ok((await p.$('button[data-act="fileJottingNew"]')) !== null, "and a way to file it onto a new shop");

console.log("\n--- filing it onto an existing shop moves it there ---");
await p.click('button[data-act="fileJotting"][data-store="Tesco"]');
await p.waitForTimeout(300);
const filed = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return db.jottings.map((j) => ({ store: j.store, text: j.text }));
});
console.log("   ", JSON.stringify(filed));
ok(filed.length === 1 && filed[0].store === "Tesco" && filed[0].text === "Stamps",
  "the text and the line survive; only the shop changes");
ok((await p.$('button[data-act="fileJotting"]')) === null, "and there is nothing left to file, so no chips remain");

console.log("\n--- filing onto a brand new shop ---");
await p.click('button[data-act="addJotting"][data-store=""]');
await p.waitForTimeout(200);
const box2 = p.locator('textarea[data-act="setJotting"]').last();
await box2.fill("Washing powder");
await box2.blur();
await p.waitForTimeout(300);
p.once("dialog", (d) => d.accept("Boots"));
await p.click('button[data-act="fileJottingNew"]');
await p.waitForTimeout(300);
const withNewShop = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return db.jottings.find((j) => j.text === "Washing powder");
});
console.log("   ", JSON.stringify(withNewShop));
ok(withNewShop && withNewShop.store === "Boots", `the new shop name is saved onto the line (${JSON.stringify(withNewShop)})`);
const boots = await p.$$eval(".group .gname", (els) => els.map((e) => e.textContent.trim()));
ok(boots.includes("Boots"), `and a Boots group now appears on the list (${JSON.stringify(boots)})`);

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
