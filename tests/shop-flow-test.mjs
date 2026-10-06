/* The List and the shop. The total sits against the budget in a bar that is
   pinned and never scrolls away, and the budget can be changed from it. Going
   shopping starts with the check of the cupboard (which can be skipped), and in
   the shop the bar becomes the trolley against the budget: ticking a line shrinks
   the list but the trolley and what is still to get always add up to the shop. A
   shop left open from another day is over. A top-up can go straight into stock,
   and something new can be scanned without a price, which the receipt fills in. */
import { browser, BASE, SHOTS, pinClock, answer } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 700 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await pinClock(ctx, "2026-08-02T09:00:00");
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
const settle = () => p.waitForTimeout(450);
const readDb = () => p.evaluate(async () => (await import("./lib/store.js")).loadDb());
const text = (sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
const money = (s) => Number(String(s).replace(/[^0-9.]/g, ""));

async function load({ stale = ["mince"], budget = 60 } = {}) {
  await p.evaluate(async ({ stale, budget }) => {
    const store = await import("./lib/store.js");
    const mk = (id, name, shop, price, extra) => {
      const i = store.newIngredient(shop, name);
      i.id = id;
      i.extraPacks = extra;
      i.products = [store.newProduct(name, shop, {
        id: `${id}-p`, pricePerPack: price, portionsPerPack: 4,
        priceUpdated: stale.includes(id) ? "2026-07-01" : "2026-08-01",
      })];
      return i;
    };
    const plan = Array.from({ length: 14 }, () => ({ breakfast: [null, null], lunch: [null, null], dinner: [null, null] }));
    const db = store.migrate({
      schema: 9,
      ingredients: [mk("mince", "Mince", "Tesco", 3, 2), mk("pasta", "Pasta", "Tesco", 1, 1), mk("milk", "Milk", "Asda", 1.5, 1), mk("eggs", "Eggs", "Asda", 2, 3)],
      meals: [], plan, people: ["Lee", "Sam"], planStart: "", budget,
    });
    await store.saveDb(db, true);
    const s = await store.loadSettings();
    await store.saveSettings({ ...s, shopping: null });
  }, { stale, budget });
  await p.reload();
  await booted();
  await p.waitForTimeout(350);
}

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await load();

console.log("--- the total is pinned against the budget ---");
ok(money(await text(".pinbar .big")) === 14.5, `the total is on the bar (${await text(".pinbar .big")})`);
ok(/£60\.00/.test(await text(".pinbar")), "against the budget");
ok(/£45\.50 left/.test(await text(".pinbar")), `with what is left (${await text(".pinbar .pinstate")})`);
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(150);
const pos = await p.evaluate(() => {
  const bar = document.querySelector(".pinbar").getBoundingClientRect();
  const tabs = document.querySelector(".tabs").getBoundingClientRect();
  return { fixed: getComputedStyle(document.querySelector(".pinbar")).position, barBottom: Math.round(bar.bottom), tabsTop: Math.round(tabs.top), vh: innerHeight };
});
console.log("   ", JSON.stringify(pos));
ok(pos.fixed === "fixed" && pos.barBottom <= pos.tabsTop + 1 && pos.barBottom > pos.vh / 2, "it stays just above the tab bar however far the list is scrolled");
const lastRow = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".ticket")];
  const last = rows[rows.length - 1].getBoundingClientRect();
  return Math.round(last.bottom) <= Math.round(document.querySelector(".pinbar").getBoundingClientRect().top) + 2;
});
ok(lastRow, "and the last line is not hidden under it");

console.log("\n--- changing the budget ---");
await p.click('[data-act="editBudget"]');
await p.waitForSelector(".dialog input");
ok(await p.$eval(".dialog input", (e) => e.type === "number" && e.value === "60"), "the cap opens a number box holding the current figure");
await answer(p, { fill: "12" });
await settle();
ok((await readDb()).budget === 12, "it is saved");
ok(/£2\.50 over/.test(await text(".pinbar .pinstate")) && (await p.$(".pinbar .pinstate.over")) !== null, `and the bar says it is over (${await text(".pinbar .pinstate")})`);
await p.click('[data-act="editBudget"]');
await answer(p, { yes: false });
ok((await readDb()).budget === 12, "cancelling leaves it alone");

console.log("\n--- a red dot only where it is the exception ---");
ok((await p.$$(".ticket .dot")).length === 1, "with one price out of date, that one line has its dot");
await load({ stale: ["mince", "pasta", "milk", "eggs"] });
ok((await p.$$(".ticket .dot")).length === 0, "with every price out of date there are no dots, only the banner");
ok(/prices are over 14 days old/.test(await text(".wrap")), "which still says so");

console.log("\n--- going shopping starts with the check, which can be skipped ---");
await load();
await p.click('[data-act="goShopping"]');
await p.waitForSelector('[data-act="startShopping"]');
await p.click('[data-act="startShopping"]');
await settle();
ok((await p.$(".sheet")) === null && (await p.$('[data-act="doneShopping"]')) !== null, "skipping the check goes straight to the shop");
ok(/0\.00/.test(await text(".pinbar .big")) && /in the trolley/.test(await text(".pinbar")), "the bar now shows the trolley, empty");
const all = money(await text(".pinbar .pinsub").then((t) => t.match(/£([\d.]+) still to get/)[1]));
ok(all === 14.5, `with the whole list still to get (${all})`);

console.log("\n--- ticking lines puts them in the trolley ---");
const firstCost = await p.$eval('[data-act="bought"]', (e) => Number(e.dataset.cost));
await p.click('[data-act="bought"]');
await settle();
let trolley = money(await text(".pinbar .big"));
let toGet = money((await text(".pinbar .pinsub")).match(/£([\d.]+) still to get/)[1]);
console.log("   ", JSON.stringify({ firstCost, trolley, toGet }));
ok(Math.abs(trolley - firstCost) < 0.005, "the line's cost is in the trolley");
ok(Math.abs(trolley + toGet - 14.5) < 0.005, "and the trolley plus what is still to get is still the whole shop");
await p.click('[data-act="bought"]');
await settle();
trolley = money(await text(".pinbar .big"));
toGet = money((await text(".pinbar .pinsub")).match(/£([\d.]+) still to get/)[1]);
ok(Math.abs(trolley + toGet - 14.5) < 0.005, "after a second, it still adds up");
await p.click('[data-act="undoToast"]');
await settle();
const afterUndo = money(await text(".pinbar .big"));
ok(Math.abs(afterUndo - firstCost) < 0.005, `Undo takes the last one back out of the trolley (${afterUndo})`);
ok(await p.$eval(".pinbar .bar", (e) => e.classList.contains("two")), "and the bar shows both lengths");

console.log("\n--- the shop survives a reload ---");
await p.reload();
await booted();
await p.waitForTimeout(300);
ok((await p.$('[data-act="doneShopping"]')) !== null && Math.abs(money(await text(".pinbar .big")) - firstCost) < 0.005, "still shopping, with the same trolley");

console.log("\n--- a shop left open from another day is over ---");
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const s = await store.loadSettings();
  await store.saveSettings({ ...s, shopping: { startedAt: "2026-08-01T10:00:00.000Z", trolley: [{ id: "x", cost: 5 }] } });
});
await p.reload();
await booted();
await p.waitForTimeout(300);
ok((await p.$('[data-act="goShopping"]')) !== null && (await p.$('[data-act="doneShopping"]')) === null, "yesterday's shop is not still going");

console.log("\n--- done shopping offers the receipt ---");
await p.click('[data-act="goShopping"]');
await p.click('[data-act="startShopping"]');
await settle();
await p.click('[data-act="doneShopping"]');
await p.waitForSelector(".dialog");
ok(/Scan the receipt now\?/.test(await text(".dialog h2")), "it asks whether to scan the receipt");
ok(/Not now/.test(await text('[data-act="dialogNo"]')), "and the other answer is Not now, not Cancel");
await answer(p, { yes: false });
ok((await p.$('[data-act="goShopping"]')) !== null, "not now simply ends the shop");
await p.click('[data-act="goShopping"]');
await p.click('[data-act="startShopping"]');
await settle();
await p.click('[data-act="doneShopping"]');
await answer(p);
await p.waitForTimeout(250);
ok(/Read a receipt/.test(await text(".sheet h2")), "yes opens the receipt");
await p.click('[data-act="closeSheet"]');

console.log("\n--- a top-up straight into stock ---");
await load();
await p.click('[data-act="openAdd"]');
await p.fill('[data-act="setAddQuery"]', "milk");
await p.waitForTimeout(150);
const stockOf = async (id) => (await readDb()).ingredients.find((i) => i.id === id).products[0].stockPortions || 0;
const before = await stockOf("milk");
await p.click('#add-live [data-act="boughtFromSheet"]');
await settle();
ok((await stockOf("milk")) === before + 4, `Bought puts a pack straight into stock (${before} -> ${await stockOf("milk")})`);
ok((await readDb()).ingredients.find((i) => i.id === "milk").extraPacks === 1, "without touching what is on the list");
await p.click('[data-act="undoToast"]');
await settle();
ok((await stockOf("milk")) === before, "and Undo takes it back");
await p.click('[data-act="closeSheet"]');

console.log("\n--- scanning something new, with no price ---");
await p.click('[data-act="openAdd"]');
await p.click('[data-act="openScan"]');
await p.waitForSelector('[data-cam="manual"]');
await p.fill('[data-cam="manual"]', "5012345678900");
await p.click('[data-cam="useManual"]');
await p.waitForSelector('[data-act="saveScan"]');
ok(/if you have it/.test(await text(".sheet")), "the sheet says the price is optional");
await p.fill('[data-act="setScanName"]', "Honey");
await p.evaluate(() => document.querySelector('[data-act="setScanName"]').blur());
await p.waitForTimeout(250);
await p.click('[data-act="saveScan"]');
await settle();
const honey = (await readDb()).ingredients.find((i) => i.name === "Honey");
console.log("   ", JSON.stringify(honey && { price: honey.products[0].pricePerPack, at: honey.products[0].priceUpdated, codes: honey.products[0].barcodes }));
ok(honey && honey.products[0].pricePerPack === 0 && honey.products[0].priceUpdated === "", "it is saved with no price and marked never priced");
ok(honey && honey.products[0].barcodes.includes("5012345678900"), "with its barcode, so the receipt can find it");
await p.click('[data-act="closeSheet"]'); // the offer to photograph the label
await p.waitForTimeout(200);

console.log("\n--- an unpriced line says the receipt will price it ---");
await p.click('[data-act="openAdd"]');
await p.fill('[data-act="setAddQuery"]', "honey");
await p.waitForTimeout(150);
await p.click('#add-live [data-act="addFromSheet"]');
await settle();
await p.click(".sheet >> text=Done");
await p.waitForTimeout(250);
const honeyRow = await p.evaluate(() => [...document.querySelectorAll(".ticket")].find((e) => /Honey/.test(e.textContent)).textContent.replace(/\s+/g, " "));
ok(/price to come from the receipt/.test(honeyRow), `(${honeyRow.trim()})`);

console.log("\n--- scanning something already kept, with no price, keeps its price ---");
await p.click('[data-act="openAdd"]');
await p.click('[data-act="openScan"]');
await p.fill('[data-cam="manual"]', "5099999999999");
await p.click('[data-cam="useManual"]');
await p.waitForSelector('[data-act="saveScan"]');
await p.selectOption('[data-act="setScanTarget"]', "mince");
await p.waitForTimeout(250);
const priceBox = await p.$eval('[data-act="setScanPrice"]', (e) => e.value);
ok(priceBox === "3", `the sheet shows the price it has (${priceBox})`);
await p.fill('[data-act="setScanPrice"]', "");
await p.evaluate(() => document.querySelector('[data-act="setScanPrice"]').blur());
await p.waitForTimeout(250);
await p.click('[data-act="saveScan"]');
await settle();
const mince = (await readDb()).ingredients.find((i) => i.id === "mince").products[0];
ok(mince.pricePerPack === 3 && mince.priceUpdated === "2026-07-01", `its price and its date stand (${mince.pricePerPack}, ${mince.priceUpdated})`);
ok(mince.barcodes.includes("5099999999999"), "and the barcode is now on it");

await p.screenshot({ path: `${SHOTS}/shop-flow.png` });
console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
