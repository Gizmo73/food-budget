/* A photograph of a curved foil packet under supermarket lighting is a good
   guess, not a fact. What it read has to be correctable before it is saved,
   and the figure it produces for a plate has to follow the correction. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));

// the label reader, answered without a camera or a key
await p.route("**generativelanguage.googleapis.com/**", (r) =>
  r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      name: "Chunky Cod Fillets",
      packSize: "600g",
      basis: "as sold",
      // a plausible misread: 1230 kcal per 100g is nonsense, and the sort of
      // thing a smudged decimal point produces
      per100: { kcal: 1230, protein: 17.2, carbs: 0.4, fat: 1.1 },
    }) }] } }] }),
  })
);

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const cod = store.newIngredient("Tesco", "Cod");
  cod.id = "cod";
  cod.products = [store.newProduct("Chunky Cod Fillets", "Tesco", {
    pricePerPack: 4.5, portionsPerPack: 4, packAmount: 600, packUnit: "g",
    priceUpdated: "2026-08-01",
  })];
  await store.saveSettings({ ...(await store.loadSettings()), provider: "gemini", geminiKey: "k" });
  await store.saveDb(store.migrate({
    schema: 9, ingredients: [cod], meals: [], plan: [],
    people: ["Lee", "Sam"], planStart: "",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

console.log("--- reading the label ---");
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(300);
await p.click('[data-act="openItem"]');
await p.waitForTimeout(400);
await p.click('.prodtitle[data-open="0"]');
await p.waitForTimeout(400);
await p.click('.foldhead[data-kind="nutrition"]');
await p.waitForTimeout(400);

const [chooser] = await Promise.all([
  p.waitForEvent("filechooser"),
  p.click('[data-act="shootLabel"]'),
]);
await chooser.setFiles(new URL("./fixtures/one-pixel.png", import.meta.url).pathname);
await p.waitForSelector('[data-act="setLabelValue"]', { timeout: 15000 });

const read = await p.evaluate(() => {
  const boxes = {};
  for (const el of document.querySelectorAll('[data-act="setLabelValue"]')) {
    boxes[el.dataset.field] = el.value;
  }
  const sheet = document.querySelector(".sheet");
  return { boxes, text: sheet.textContent.replace(/\s+/g, " ").trim() };
});
console.log("   ", JSON.stringify(read.boxes));
ok(Object.keys(read.boxes).length === 4, `all four figures are boxes you can type in (${Object.keys(read.boxes)})`);
ok(read.boxes.kcal === "1230", `showing what it read (${read.boxes.kcal})`);
ok(read.boxes.protein === "17.2" && read.boxes.carbs === "0.4" && read.boxes.fat === "1.1",
  "and the macros with it");
ok(/correct anything it misread/.test(read.text), "and says they can be corrected");
ok(/From /.test(read.text), "while still saying where the figures came from");

// 600g over 4 portions is 150g, so 1230 kcal per 100g reads as 1845 a portion
ok(/1845 kcal/.test(read.text), `the portion figure follows from the reading (${read.text.match(/A [^.]*\./) || ""})`);

console.log("\n--- correcting a misread digit ---");
await p.fill('[data-act="setLabelValue"][data-field="kcal"]', "123");
await p.evaluate(() =>
  document.querySelector('[data-act="setLabelValue"][data-field="kcal"]').blur());
await p.waitForTimeout(500);

const fixed = await p.evaluate(() => {
  const sheet = document.querySelector(".sheet");
  return {
    kcal: document.querySelector('[data-act="setLabelValue"][data-field="kcal"]').value,
    protein: document.querySelector('[data-act="setLabelValue"][data-field="protein"]').value,
    text: sheet.textContent.replace(/\s+/g, " ").trim(),
  };
});
console.log("   ", JSON.stringify({ kcal: fixed.kcal, protein: fixed.protein }));
ok(fixed.kcal === "123", "the correction sticks in the box");
ok(fixed.protein === "17.2", "and the figures you did not touch are left alone");
ok(/184 kcal|185 kcal/.test(fixed.text),
  `the portion figure follows the correction (${(fixed.text.match(/A [^.]*\./) || [""])[0]})`);
ok(/Changed by hand since/.test(fixed.text), "and it admits the figures are no longer purely what it read");

await p.screenshot({ path: `${SHOTS}/label-edit.png`, fullPage: true });

console.log("\n--- saving ---");
await p.click('[data-act="applyLabel"]');
await p.waitForTimeout(600);
const saved = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  const prod = db.ingredients[0].products[0];
  const flash = document.querySelector(".ok, .err");
  return {
    kcal: prod.kcal100, protein: prod.protein100, carbs: prod.carbs100, fat: prod.fat100,
    stamped: !!prod.nutritionUpdated,
    said: flash ? flash.textContent.replace(/\s+/g, " ").trim() : "",
  };
});
console.log("   ", JSON.stringify(saved));
ok(saved.kcal === 123, `what is saved is the corrected figure, not the misread one (${saved.kcal})`);
ok(saved.protein === 17.2 && saved.carbs === 0.4 && saved.fat === 1.1, "the rest as read");
ok(saved.stamped, "and it is stamped, so a merge cannot lose it to an older label");
ok(/with your corrections/.test(saved.said), `it says the figures were yours (${saved.said})`);

console.log("\n--- a reading left alone ---");
/* Saving replaces the item sheet with the label sheet and then closes it, so
   getting back to the button means opening the item again from the top. */
await p.click('[data-act="openItem"]');
await p.waitForTimeout(400);
await p.click('.prodtitle[data-open="0"]');
await p.waitForTimeout(400);
await p.evaluate(() => {
  const head = document.querySelector('.foldhead[data-kind="nutrition"]');
  if (head && head.getAttribute("aria-expanded") === "false") head.click();
});
await p.waitForTimeout(400);

const [again] = await Promise.all([
  p.waitForEvent("filechooser"),
  p.click('[data-act="shootLabel"]'),
]);
await again.setFiles(new URL("./fixtures/one-pixel.png", import.meta.url).pathname);
await p.waitForSelector('[data-act="setLabelValue"]', { timeout: 15000 });
const untouched = await p.evaluate(() =>
  document.querySelector(".sheet").textContent.replace(/\s+/g, " ").trim());
ok(!/Changed by hand/.test(untouched), "a reading nobody touched does not claim to have been edited");
await p.click('[data-act="applyLabel"]');
await p.waitForTimeout(500);
const plain = await p.evaluate(() => {
  const el = document.querySelector(".ok, .err");
  return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
});
ok(!/with your corrections/.test(plain), `nor does saving it (${plain})`);
// and the misread figure is back, because that is what the label said
const back = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  return (await store.loadDb()).ingredients[0].products[0].kcal100;
});
ok(back === 1230, `saving an untouched reading stores what it read (${back})`);

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
