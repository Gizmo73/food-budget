/* A receipt line for something with no category yet has to ask two questions,
   not one: what kind of thing is this, and what is this particular one called.
   Asking once and reusing the answer is what made every scanned item its own
   category. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text()));
const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

// The receipt reader, answered without a photograph or a key.
await p.route("**generativelanguage.googleapis.com/**", (r) =>
  r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      store: "TESCO STORES LTD", date: "2026-08-03",
      lines: [
        { name: "ARLA LACTOFREE SEMI SKIMMED 1L", unitPrice: 1.85, qty: 1, offerKind: "none" },
        { name: "OATLY BARISTA OAT DRINK 1L", unitPrice: 1.9, qty: 1, offerKind: "none" },
      ],
    }) }] } }] }),
  })
);

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

// One ingredient already kept, so folding has something to fold into.
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const milk = store.newIngredient("Tesco", "Milk");
  milk.id = "milk";
  milk.products = [store.newProduct("Tesco Semi Skimmed 2l", "Tesco", {
    pricePerPack: 1.45, portionsPerPack: 8, packAmount: 2000, packUnit: "ml",
    stockPortions: 3, priceUpdated: "2026-07-20",
  })];
  await store.saveSettings({ ...(await store.loadSettings()), provider: "gemini", geminiKey: "k", warnOnLeave: false });
  await store.saveDb(store.migrate({ schema: 7, ingredients: [milk], meals: [], plan: [], people: ["Lee", "Sam"] }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(300);

console.log("--- reading a receipt ---");
await p.click("[data-act='openReceipt']");
await p.waitForTimeout(300);
const [ch] = await Promise.all([p.waitForEvent("filechooser"), p.click("[data-act='shootReceipt']")]);
await ch.setFiles(new URL("./fixtures/one-pixel.png", import.meta.url).pathname);
await p.waitForSelector(".rline", { timeout: 15000 }).catch(async () => {
  const err = await p.evaluate(() => {
    const el = document.querySelector(".err");
    return { err: el ? el.textContent : "(none)", sheet: document.querySelector(".sheet") ? document.querySelector(".sheet").textContent.replace(/\s+/g, " ").slice(0, 400) : "(no sheet)" };
  });
  console.log("   stuck:", JSON.stringify(err, null, 1));
  throw new Error("no rows");
});

const rows = await p.$$(".rline");
ok(rows.length === 2, `two lines read (${rows.length})`);

console.log("\n--- both names are asked for ---");
const asked = await p.evaluate(() => {
  const line = document.querySelectorAll(".rline")[0];
  const label = (act) => {
    const el = line.querySelector(`[data-act="${act}"]`);
    return el ? { value: el.value, eyebrow: el.closest("label").querySelector(".eyebrow").textContent.trim() } : null;
  };
  return {
    kind: line.querySelector("[data-act='setRowTarget']").value,
    ingredient: label("setRowName"),
    product: label("setRowProductName"),
    why: [...line.querySelectorAll(".why")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
  };
});
console.log("   ", JSON.stringify(asked, null, 1));
ok(asked.kind === "__new__", "an unrecognised line defaults to adding something new");
ok(!!asked.ingredient, "it asks for the ingredient");
ok(!!asked.product, "and separately for the product name");
ok(asked.ingredient && /ingredient/i.test(asked.ingredient.eyebrow), "the ingredient box says what it is for");
ok(
  asked.ingredient && asked.product && asked.ingredient.value === asked.product.value,
  "both start from the receipt wording, so doing nothing behaves as before"
);

console.log("\n--- the list of ingredients you already keep ---");
const list = await p.evaluate(() => {
  const dl = document.getElementById("fb-ingredients");
  const input = document.querySelector("[data-act='setRowName']");
  return { exists: !!dl, options: dl ? [...dl.options].map((o) => o.value) : [], wired: input && input.getAttribute("list") };
});
console.log("   ", JSON.stringify(list));
ok(list.exists, "the suggestions list exists");
ok(list.options.includes("Milk"), "and offers Milk, which is already kept");
ok(list.wired === "fb-ingredients", "and the name box is wired to it");

console.log("\n--- typing a name you already keep ---");
await p.fill(".rline:nth-of-type(1) [data-act='setRowName']", "Milk");
await p.evaluate(() => document.querySelector(".rline [data-act='setRowName']").blur());
await p.waitForTimeout(300);
const folded = await p.evaluate(() => {
  const line = document.querySelectorAll(".rline")[0];
  return {
    why: [...line.querySelectorAll(".why")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
    product: line.querySelector("[data-act='setRowProductName']").value,
  };
});
console.log("   ", JSON.stringify(folded, null, 1));
ok(folded.why.some((w) => /Goes under Milk/i.test(w)), "it says up front that this will join Milk");
ok(folded.why.some((w) => /stock 3 /.test(w)), `and counts stock from the real Milk, not from zero`);
ok(/Arla/i.test(folded.product), `the product name is untouched by renaming the ingredient (${folded.product})`);

// second line: a genuinely new category, named differently from the product
await p.fill(".rline:nth-of-type(2) [data-act='setRowName']", "Oat drink");
await p.evaluate(() => document.querySelectorAll(".rline")[1].querySelector("[data-act='setRowName']").blur());
await p.waitForTimeout(300);
await p.fill(".rline:nth-of-type(2) [data-act='setRowProductName']", "Oatly Barista 1l");
await p.evaluate(() => document.querySelectorAll(".rline")[1].querySelector("[data-act='setRowProductName']").blur());
await p.waitForTimeout(300);

await p.screenshot({ path: `${SHOTS}/receipt-names.png`, fullPage: true });

console.log("\n--- applying it ---");
await p.click("[data-act='applyReceipt']");
await p.waitForTimeout(600);
const flash = await p.evaluate(() => {
  const el = document.querySelector(".flash, .ok, .banner");
  return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
});
console.log("   flash:", JSON.stringify(flash));
ok(flash.length > 8, "it says what it did");

const after = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return db.ingredients.map((i) => ({
    id: i.id, name: i.name,
    products: i.products.map((x) => ({ name: x.name, store: x.store, price: x.pricePerPack, stock: x.stockPortions })),
  }));
});
console.log("   ", JSON.stringify(after, null, 1));

const milks = after.filter((i) => i.name.toLowerCase() === "milk");
ok(milks.length === 1, `there is still exactly one Milk (${milks.length})`);
ok(milks[0] && milks[0].products.length === 2, `and it now holds two things to buy (${milks[0] && milks[0].products.length})`);
ok(
  milks[0] && milks[0].products.some((x) => /Arla/i.test(x.name) && Math.abs(x.price - 1.85) < 0.001),
  "the Arla is one of them, at its receipt price"
);
ok(
  milks[0] && milks[0].products.some((x) => /Tesco Semi/i.test(x.name) && x.stock === 3),
  "and the one that was already there kept its stock"
);

const oat = after.find((i) => /oat drink/i.test(i.name));
ok(!!oat, "a genuinely new kind was added under its own name");
ok(oat && oat.products.length === 1, `with one product, not two (${oat && oat.products.length})`);
ok(oat && /Oatly Barista/i.test(oat.products[0].name), `named separately from the ingredient (${oat && oat.products[0].name})`);
ok(oat && oat.id !== "milk" && !/oatly/i.test(oat.name), `the category is the general name (${oat && oat.name})`);

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
