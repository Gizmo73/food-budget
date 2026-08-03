import { browser, BASE, SHOTS } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;
const TH = process.env.FS_THEME || "dark";
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 2, colorScheme: TH, isMobile: true, hasTouch: true });
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
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  await s.saveDb(s.migrate(JSON.parse(json)), true);
  location.reload();
}, readFileSync(FIXTURE, "utf8"));
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

console.log("--- add a meal is at the top ---");
await p.click('[data-act="tab"][data-tab="meals"]');
await p.waitForTimeout(400);
const order = await p.evaluate(() => {
  const wrap = document.querySelector(".wrap");
  const add = wrap.querySelector('[data-act="addMeal"]');
  const first = wrap.querySelector(".card");
  return { before: !!(add.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING),
           y: Math.round(add.getBoundingClientRect().top) };
});
ok(order.before, "it comes before the first meal");
ok(order.y < 820, `and is on screen without scrolling (y=${order.y})`);

console.log("\n--- the product editor is in folds ---");
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(300);
await p.evaluate(() => [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Steak Pies/.test(e.textContent)).click());
await openFirstProduct(p);
await p.waitForTimeout(500);

const folds = await p.$$eval(".fold", (els) => els.map((e) => ({
  kind: e.querySelector(".foldhead").dataset.kind,
  name: e.querySelector(".foldname").textContent.trim(),
  summary: e.querySelector(".foldsum").textContent.trim(),
  open: e.classList.contains("open"),
  hasBody: !!e.querySelector(".foldbody"),
})));
console.log("  ", JSON.stringify(folds, null, 1));
ok(folds.length === 4, `four sections (${folds.length})`);
ok(folds.map((f) => f.kind).join() === "portion,offer,nutrition,barcodes", "pack, offer, nutrition, barcodes");
ok(folds.every((f) => f.summary.length > 0), "each says what is in it while shut");
ok(folds.find((f) => f.kind === "portion").open, "pack and portion starts open");
ok(!folds.find((f) => f.kind === "nutrition").open, "nutrition starts shut, which was the ask");
ok(folds.filter((f) => !f.open).every((f) => !f.hasBody), "a shut section renders no controls at all");

console.log("\n--- opening one ---");
const before = await p.evaluate(() => document.querySelectorAll('[data-act="setProductNumber"]').length);
await p.click('.foldhead[data-kind="nutrition"]');
await p.waitForTimeout(400);
const after = await p.evaluate(() => ({
  boxes: document.querySelectorAll('[data-act="setProductNumber"]').length,
  open: document.querySelector('.fold:has(.foldhead[data-kind="nutrition"])')?.classList.contains("open"),
  aria: document.querySelector('.foldhead[data-kind="nutrition"]').getAttribute("aria-expanded"),
}));
console.log("   number boxes", before, "->", after.boxes);
ok(after.boxes > before, "the macro boxes appear");
ok(after.aria === "true", "and it says so to a screen reader");

console.log("\n--- it applies to every product, not just this one ---");
await p.evaluate(() => document.querySelector('[data-act="closeSheet"]')?.click());
await p.waitForTimeout(200);
await p.evaluate(() => [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Potatoes/.test(e.textContent)).click());
await openFirstProduct(p);
await p.waitForTimeout(500);
const elsewhere = await p.evaluate(() =>
  document.querySelector('.fold:has(.foldhead[data-kind="nutrition"])')?.classList.contains("open"));
ok(elsewhere === true, "nutrition is open on the next item too, so it is set once");

console.log("\n--- and it survives a reload ---");
await p.reload();
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(300);
await p.evaluate(() => document.querySelector('[data-act="openItem"]').click());
await openFirstProduct(p);
await p.waitForTimeout(500);
const stuck = await p.evaluate(() =>
  document.querySelector('.fold:has(.foldhead[data-kind="nutrition"])')?.classList.contains("open"));
ok(stuck === true, "still open after a reload");

console.log("\n--- contrast ---");
const c = await p.evaluate(() => {
  const cs = (el) => getComputedStyle(el);
  return {
    bg: cs(document.body).backgroundColor,
    card: cs(document.querySelector(".card")).backgroundColor,
    fold: cs(document.querySelector(".fold")).backgroundColor,
    outline: cs(document.querySelector(".fold")).borderTopColor,
  };
});
console.log("  ", JSON.stringify(c));
ok(c.bg !== c.card, "the card is not the same colour as the page");
ok(c.card !== c.fold, "and a section is not the same colour as the card");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.evaluate(() => document.querySelector(".fold").scrollIntoView({ block: "center" }));
await p.waitForTimeout(200);
await p.screenshot({ path: `${SHOTS}/folds-${TH}.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
