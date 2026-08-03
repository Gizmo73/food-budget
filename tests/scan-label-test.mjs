/* Scanning a barcode is the one moment the pack is in your hand, so it is the
   moment to ask for the label. Later means finding the thing again, or reading
   the figures off a website and hoping.

   Driven through the scanner's own "or type the number" field, which is the
   path the app offers when a camera is unavailable, so this exercises the real
   buttons rather than reaching into state. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

// two of one ingredient: one whose label has been read, one whose has not
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const milk = store.newIngredient("Tesco", "Milk");
  milk.id = "milk";
  milk.products = [
    store.newProduct("Semi skimmed", "Tesco", {
      pricePerPack: 1.45, portionsPerPack: 8, packAmount: 2000, packUnit: "ml",
      priceUpdated: "2026-08-01", barcodes: ["5000000000011"],
    }),
    store.newProduct("Whole", "Tesco", {
      pricePerPack: 1.55, portionsPerPack: 8, packAmount: 2000, packUnit: "ml",
      priceUpdated: "2026-08-01", barcodes: ["5000000000028"],
      kcal100: 63, protein100: 3.4, carbs100: 4.7, fat100: 3.6,
      nutritionUpdated: "2026-08-01T10:00:00.000Z",
    }),
  ];
  await store.saveDb(store.migrate({
    schema: 9, ingredients: [milk], meals: [], plan: [],
    people: ["Lee", "Sam"], planStart: "",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

const scan = async (code) => {
  await p.click('[data-act="tab"][data-tab="list"]');
  await p.waitForTimeout(250);
  await p.click('[data-act="openScan"]');
  await p.waitForSelector('[data-cam="manual"]', { timeout: 10000 });
  await p.fill('[data-cam="manual"]', code);
  await p.click('[data-cam="useManual"]');
  await p.waitForSelector('[data-act="saveScan"]', { timeout: 10000 });
};

const priceAndSave = async (price) => {
  await p.fill('[data-act="setScanPrice"]', String(price));
  await p.evaluate(() => document.querySelector('[data-act="setScanPrice"]').blur());
  await p.waitForTimeout(300);
  await p.click('[data-act="saveScan"]');
  await p.waitForTimeout(600);
};

const sheetNow = () =>
  p.evaluate(() => {
    const sheet = document.querySelector(".sheet");
    return sheet
      ? {
          title: sheet.querySelector("h2").textContent.trim(),
          text: sheet.textContent.replace(/\s+/g, " ").trim(),
          shoot: !!sheet.querySelector('[data-act="shootLabel"]'),
        }
      : null;
  });

console.log("--- scanning something with no nutrition ---");
await scan("5000000000011");
ok(true, "the scanner takes a typed number when there is no camera");
await priceAndSave(1.6);

let now = await sheetNow();
console.log("   ", JSON.stringify(now, null, 1));
ok(!!now, "a sheet is waiting after the save");
ok(now && /Photograph the label/.test(now.title), `it asks for the label (${now && now.title})`);
ok(now && /Semi skimmed/.test(now.text), "naming the thing just scanned");
ok(now && now.shoot, "with a button that goes straight to the camera");
ok(now && /in your hand now/.test(now.text), "and says why now rather than later");
ok(now && /2000ml/.test(now.text), "noting the pack size is already known, so it converts");

// the price it was scanned for still saved, prompt or no prompt
const saved = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  const prods = db.ingredients[0].products;
  return {
    semi: prods.find((x) => /Semi/.test(x.name)).pricePerPack,
    codes: prods.find((x) => /Semi/.test(x.name)).barcodes,
  };
});
console.log("   ", JSON.stringify(saved));
ok(saved.semi === 1.6, `the scan itself saved (${saved.semi})`);

await p.screenshot({ path: `${SHOTS}/label-prompt.png` });

console.log("\n--- and it can be waved away ---");
await p.click('[data-act="closeSheet"]');
await p.waitForTimeout(400);
ok(!(await p.$(".sheet")), "Not now closes it");
ok(
  (await p.evaluate(async () => {
    const store = await import("./lib/store.js");
    const db = await store.loadDb();
    return db.ingredients[0].products.find((x) => /Semi/.test(x.name)).kcal100;
  })) === 0,
  "and nothing was invented for the nutrition"
);

console.log("\n--- scanning something already filled in ---");
await scan("5000000000028");
await priceAndSave(1.7);
now = await sheetNow();
console.log("   ", JSON.stringify(now));
ok(now === null, "nothing is asked, because there is nothing to gain");
const other = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return db.ingredients[0].products.find((x) => /Whole/.test(x.name)).pricePerPack;
});
ok(other === 1.7, `and that scan saved too (${other})`);

console.log("\n--- a barcode nothing has seen before ---");
await scan("5000000009999");
await p.fill('[data-act="setScanName"]', "Cheddar");
await p.evaluate(() => document.querySelector('[data-act="setScanName"]').blur());
await p.waitForTimeout(300);
await priceAndSave(3.2);
now = await sheetNow();
console.log("   ", JSON.stringify(now, null, 1));
ok(now && /Photograph the label/.test(now.title), "a brand new item is asked about too");
ok(now && /pack size is not set either/.test(now.text),
  "and told the label can fill in the pack size as well");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
