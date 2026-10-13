/* A busy model should not take a quarter of the app down with it. When the
   provider you chose is overloaded the other one reads the photo instead, if
   it has a key, and a scanned barcode is looked up on Open Food Facts before
   any model is asked at all. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));

const LABEL = { name: "Chunky Cod Fillets", packSize: "600g", basis: "as sold",
  per100: { kcal: 90, protein: 17.2, carbs: 0.4, fat: 1.1 } };

// what each provider says, changed per section below
let gemini = { status: 503 };
let calls = { gemini: 0, anthropic: 0, off: 0 };
await p.route("**generativelanguage.googleapis.com/**", (r) => {
  calls.gemini++;
  return gemini.status === 200
    ? r.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(LABEL) }] } }] }) })
    : r.fulfill({ status: gemini.status, body: "The model is overloaded. Please try again later." });
});
await p.route("**api.anthropic.com/**", (r) => {
  calls.anthropic++;
  return r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(LABEL) }] }) });
});
await p.route("**world.openfoodfacts.org/**", (r) => {
  calls.off++;
  const known = r.request().url().includes("/5000000000011.");
  return known
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        status: 1,
        product: {
          product_name: "Semi Skimmed Milk", brands: "Tesco", quantity: "2 l",
          serving_size: "200 ml",
          nutriments: { "energy-kcal_100g": 49, proteins_100g: 3.6, carbohydrates_100g: 4.8, fat_100g: 1.8 },
        },
      }) })
    : r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ status: 0 }) });
});

const boot = async () => {
  await p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
  await p.waitForTimeout(400);
};

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await boot();

const seed = (settings) =>
  p.evaluate(async (settings) => {
    const store = await import("./lib/store.js");
    const cod = store.newIngredient("Tesco", "Cod");
    cod.id = "cod";
    cod.products = [store.newProduct("Chunky Cod Fillets", "Tesco", {
      pricePerPack: 4.5, portionsPerPack: 4, packAmount: 600, packUnit: "g", priceUpdated: "2026-08-01",
    })];
    const milk = store.newIngredient("Tesco", "Milk");
    milk.id = "milk";
    milk.products = [store.newProduct("Semi skimmed", "Tesco", {
      pricePerPack: 1.45, portionsPerPack: 8, packAmount: 2000, packUnit: "ml",
      priceUpdated: "2026-08-01", barcodes: ["5000000000011"],
    })];
    await store.saveSettings({ ...(await store.loadSettings()), warnOnLeave: false, ...settings });
    await store.saveDb(store.migrate({
      schema: 9, ingredients: [cod, milk], meals: [], plan: [], people: ["Lee", "Sam"], planStart: "",
    }));
  }, settings);

const openNutrition = async (name) => {
  await p.click('[data-act="tab"][data-tab="items"]');
  await p.waitForTimeout(300);
  await p.click(`[data-act="openItem"][data-id="${name}"]`);
  await p.waitForTimeout(400);
  if (await p.$('.prodtitle[data-open="0"]')) await p.click('.prodtitle[data-open="0"]');
  await p.waitForTimeout(300);
  // the fold remembers being open, so only open it when it is shut
  if (!(await p.isVisible('[data-act="shootLabel"]'))) {
    await p.click('.foldhead[data-kind="nutrition"]');
    await p.waitForTimeout(300);
  }
};

const photograph = async () => {
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click('[data-act="shootLabel"]')]);
  await chooser.setFiles(new URL("./fixtures/one-pixel.png", import.meta.url).pathname);
};

const sheetText = () => p.$eval(".sheet", (e) => e.textContent.replace(/\s+/g, " ").trim());

console.log("--- Gemini overloaded, Claude has a key ---");
await seed({ provider: "gemini", geminiKey: "g", anthropicKey: "a" });
await p.reload();
await boot();
await openNutrition("cod");
gemini = { status: 503 };
calls = { gemini: 0, anthropic: 0, off: 0 };
await photograph();
await p.waitForSelector('[data-act="setLabelValue"]', { timeout: 15000 });
ok(calls.gemini === 2, `Gemini is given a second go after a 503 (${calls.gemini})`);
ok(calls.anthropic === 1, `then Claude reads it (${calls.anthropic})`);
ok((await p.inputValue('[data-act="setLabelValue"][data-field="kcal"]')) === "90", "and its reading is in the boxes");
const toast = await p.$eval(".toast", (e) => e.textContent).catch(() => "");
ok(/Gemini could not read it, so Claude did/.test(toast), `a toast says which one did it (${toast.trim()})`);
await p.screenshot({ path: `${SHOTS}/fallback-label.png` });
await p.click('[data-act="closeSheet"]');

console.log("\n--- a bad key moves on without waiting ---");
gemini = { status: 400 };
calls = { gemini: 0, anthropic: 0, off: 0 };
await openNutrition("cod");
await photograph();
await p.waitForSelector('[data-act="setLabelValue"]', { timeout: 15000 });
ok(calls.gemini === 1 && calls.anthropic === 1, `one try at Gemini, then Claude (${JSON.stringify(calls)})`);
await p.click('[data-act="closeSheet"]');

console.log("\n--- Gemini is fine ---");
// the last round's toast is still up for a few seconds
await p.reload();
await boot();
gemini = { status: 200 };
calls = { gemini: 0, anthropic: 0, off: 0 };
await openNutrition("cod");
await photograph();
await p.waitForSelector('[data-act="setLabelValue"]', { timeout: 15000 });
ok(calls.gemini === 1 && calls.anthropic === 0, `Claude is never asked (${JSON.stringify(calls)})`);
ok(!(await p.$(".toast")), "and nothing is said about it");
await p.click('[data-act="closeSheet"]');

console.log("\n--- only one key, and it is busy ---");
await seed({ provider: "gemini", geminiKey: "g", anthropicKey: "" });
await p.reload();
await boot();
gemini = { status: 503 };
calls = { gemini: 0, anthropic: 0, off: 0 };
await openNutrition("cod");
await photograph();
await p.waitForSelector(".sheet .err", { timeout: 15000 });
ok(calls.gemini === 2 && calls.anthropic === 0, `two tries and no Claude call without a key (${JSON.stringify(calls)})`);
ok(/Gemini refused the request \(503\)/.test(await sheetText()), "the error says what happened");
await p.click('[data-act="closeSheet"]');

console.log("\n--- a scanned barcode is looked up first ---");
calls = { gemini: 0, anthropic: 0, off: 0 };
await p.click('[data-act="tab"][data-tab="list"]');
await p.waitForTimeout(250);
await p.click('[data-act="openAdd"]');
await p.click('[data-act="openScan"]');
await p.waitForSelector('[data-cam="manual"]', { timeout: 10000 });
await p.fill('[data-cam="manual"]', "5000000000011");
await p.click('[data-cam="useManual"]');
await p.waitForSelector('[data-act="saveScan"]', { timeout: 10000 });
await p.fill('[data-act="setScanPrice"]', "1.6");
await p.evaluate(() => document.querySelector('[data-act="setScanPrice"]').blur());
await p.waitForTimeout(300);
await p.click('[data-act="saveScan"]');
await p.waitForSelector('[data-act="setLabelValue"]', { timeout: 10000 });
ok(calls.off === 1 && calls.gemini === 0, `Open Food Facts answered and no model was asked (${JSON.stringify(calls)})`);
const filled = await p.evaluate(() =>
  Object.fromEntries([...document.querySelectorAll('[data-act="setLabelValue"]')].map((e) => [e.dataset.field, e.value])));
ok(filled.kcal === "49" && filled.protein === "3.6" && filled.carbs === "4.8" && filled.fat === "1.8",
  `its per 100ml figures are in the boxes (${JSON.stringify(filled)})`);
const text = await sheetText();
ok(/Open Food Facts/.test(text) && /check it against the pack/.test(text), "it says where they came from, and to check them");
ok(!!(await p.$('.sheet [data-act="shootLabel"]')), "with a photo still on offer");
await p.screenshot({ path: `${SHOTS}/barcode-lookup.png` });
await p.click('[data-act="applyLabel"]');
await p.waitForTimeout(400);
const saved = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const prod = (await store.loadDb()).ingredients.find((i) => i.id === "milk").products[0];
  return { kcal: prod.kcal100, fat: prod.fat100 };
});
ok(saved.kcal === 49 && saved.fat === 1.8, `saving stores them (${JSON.stringify(saved)})`);

console.log("\n--- an unknown barcode falls back to the photo ---");
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  db.ingredients.find((i) => i.id === "cod").products[0].barcodes = ["5000000009999"];
  await store.saveDb(db);
});
await p.reload();
await boot();
await openNutrition("cod");
ok(!!(await p.$('[data-act="lookupLabel"]')), "a product with a barcode can be looked up from its nutrition");
await p.click('[data-act="lookupLabel"]');
await p.waitForSelector(".sheet .err", { timeout: 10000 });
ok(/no nutrition for this barcode/.test(await sheetText()), "a miss says so");
ok(!!(await p.$('.sheet [data-act="shootLabel"]')), "and offers the camera");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
