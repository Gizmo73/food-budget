import { browser, BASE, SHOTS } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;
const TH = process.env.FS_THEME || "dark";
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, colorScheme: TH, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
await p.addInitScript((t) => localStorage.setItem("fs-theme", t), TH);
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

// your real backup, so the list is as long as it is in practice
const backup = readFileSync(FIXTURE, "utf8");
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  await s.saveDb(s.migrate(JSON.parse(json)));
  location.reload();
}, backup);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(500);

console.log("--- a stray tap must not throw a receipt away ---");
await p.click('[data-act="tab"][data-tab="list"]');
await p.waitForTimeout(300);
await p.click('[data-act="openReceipt"]');
await p.waitForTimeout(400);
ok(!!(await p.$(".sheet")), "the receipt sheet is open");
const scrimAct = await p.evaluate(() => document.querySelector(".scrim")?.dataset.act || "");
ok(scrimAct === "", `the backdrop no longer carries closeSheet (${JSON.stringify(scrimAct)})`);

// tap the backdrop, right at the edge where a thumb slips
await p.evaluate(() => {
  const scrim = document.querySelector(".scrim");
  const r = scrim.getBoundingClientRect();
  scrim.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 }));
});
await p.waitForTimeout(300);
ok(!!(await p.$(".sheet")), "tapping beside it leaves the sheet open");
await p.mouse.click(8, 8);
await p.waitForTimeout(300);
ok(!!(await p.$(".sheet")), "a real tap at the top corner does too");

// and Close still works
await p.click('.sheet [data-act="closeSheet"]');
await p.waitForTimeout(300);
ok(!(await p.$(".sheet")), "the Close button still closes it");

console.log("\n--- read-only sheets may still be tapped away ---");
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(200);
await p.evaluate(() => document.querySelector('[data-act="openSettings"]').click());
await p.waitForTimeout(400);
const settingsScrim = await p.evaluate(() => document.querySelector(".scrim")?.dataset.act || "");
ok(settingsScrim === "", "settings holds typed fields, so it is not dismissable either");
await p.click('.sheet [data-act="closeSheet"]');
await p.waitForTimeout(300);

console.log("\n--- changing a shop keeps the card under your thumb ---");
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(300);
// open something filed under Tesco, well down the list
await p.evaluate(() => {
  const head = [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Garden Peas/.test(e.textContent));
  head.scrollIntoView({ block: "center" });
  head.click();
});
await p.waitForTimeout(500);
// products start collapsed under an ingredient, so open the one being edited
await p.evaluate(() => {
  const head = document.querySelector('.prodtitle[data-open="0"]');
  if (head) head.click();
});
await p.waitForTimeout(400);

/* Focus the field first and let the browser finish scrolling it into view,
   or the measurement below straddles a scroll the test itself caused rather
   than one the rebuild caused. */
await p.focus('[data-act="setProductStore"]');
await p.waitForTimeout(300);

const before = await p.evaluate(() => {
  const card = [...document.querySelectorAll("[data-scroll]")].find((c) => c.querySelector('[data-act="setProductStore"]'));
  return { top: Math.round(card.getBoundingClientRect().top), id: card.dataset.scroll, y: Math.round(window.scrollY) };
});
console.log("   before:", JSON.stringify(before));

// move it to a shop that sorts far away, which is the case that used to jump
await p.evaluate(() => {
  const input = document.querySelector('[data-act="setProductStore"]');
  input.value = "Aldi";
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await p.waitForTimeout(500);

const after = await p.evaluate((id) => {
  const card = document.querySelector(`[data-scroll="${id}"]`);
  const r = card && card.getBoundingClientRect();
  return card
    ? { top: Math.round(r.top), y: Math.round(window.scrollY), onScreen: r.top > -200 && r.top < 780 }
    : null;
}, before.id);
console.log("   after: ", JSON.stringify(after));
ok(!!after, "the card is still findable after the regroup");
ok(Math.abs(after.top - before.top) <= 2, `it stayed put on screen (${before.top}px -> ${after.top}px)`);
ok(after.onScreen, "so it is still where you were looking");
ok(after.y !== before.y, `and the page scrolled to follow it (${before.y} -> ${after.y})`);

const moved = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const db = await s.loadDb();
  const ing = db.ingredients.find((i) => i.name === "Garden Peas");
  return ing.products[0].store;
});
ok(moved === "Aldi", `and the shop actually saved (${moved})`);

console.log("\n--- the editor is still open on it ---");
ok(!!(await p.$('[data-act="setProductStore"]')), "the item did not close from under you");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
