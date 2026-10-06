/* Writing something down before you know which shop it will come from. The
   add sheet is offered even with nothing planned and nothing kept, so there is
   never a state where something cannot be written down - and once it is, with
   no shop, it can be filed onto an existing shop with a tap, or onto a brand
   new one. */
import { browser, BASE, answer } from "./browser.mjs";

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

ok((await p.$('button[data-act="openAdd"]')) !== null, "the list offers Add to the list with nothing planned or written");
ok((await p.$('button[data-act="toggleStore"]')) === null, "and shows no empty group while there is nothing in it");

/* Through the add sheet, left on its default of no shop. */
async function writeIn(text) {
  await p.click('[data-act="openAdd"]');
  await p.waitForSelector('[data-act="addWritten"]');
  await p.fill('[data-act="setAddText"]', text);
  await p.click('[data-act="addWritten"]');
  await p.waitForTimeout(300);
  await p.click(".sheet >> text=Done");
  await p.waitForTimeout(200);
}

console.log("\n--- writing one with no shop ---");
await writeIn("Stamps");

const stored = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return db.jottings.map((j) => ({ store: j.store, text: j.text }));
});
console.log("   ", JSON.stringify(stored));
ok(stored.length === 1 && stored[0].store === "" && stored[0].text === "Stamps",
  "it is saved with an empty store, not guessed at");
// &#0; is a null character reference, which HTML replaces with U+FFFD per spec
ok((await p.$('button[data-act="toggleStore"][data-store="\ufffdloose"]')) !== null,
  "and a No shop yet group now appears to hold it");

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
await writeIn("Washing powder");
await p.click('button[data-act="fileJottingNew"]');
await answer(p, { fill: "Boots" });
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
