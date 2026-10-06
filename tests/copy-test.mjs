/* A day is picked for both of you at once, since most days are. Splitting a slot
   gives each person their own picker for the day you differ, and "Same for both"
   gives the second person the first one's choice and folds it back to one. The
   fifth day is used because the starting list plans the first three for one of you. */
import { browser, BASE, SHOTS, pick } from "./browser.mjs";
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 800 }, deviceScaleFactor: 2, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(400);

const dinner = () => p.evaluate(async () => (await (await import("./lib/store.js")).loadDb()).plan[4].dinner);
const settle = () => p.waitForTimeout(450);

console.log("--- one picker per part of the day ---");
await p.click('[data-act="openDay"][data-idx="4"]');
await p.waitForTimeout(300);
ok((await p.$$('[data-act="pickDaySlotBoth"]')).length === 3, "breakfast, lunch and dinner each have one picker");
ok((await p.$$('[data-act="pickDaySlot"]')).length === 0, "and none per person");
const split = await p.$$eval('[data-act="splitSlot"]', (els) => els.map((e) => {
  const r = e.getBoundingClientRect();
  return { text: e.textContent.trim(), h: Math.round(r.height) };
}));
console.log("  ", JSON.stringify(split));
ok(split.length === 3 && split.every((s) => s.text === "Split"), "each can be split");
ok(split.every((s) => s.h >= 36), "at a size a thumb can hit");

console.log("\n--- choosing one gives it to both ---");
await pick(p, '[data-act="pickDaySlotBoth"][data-key="dinner"]', { index: 1 });
await settle();
let d = await dinner();
console.log("  ", JSON.stringify(d));
ok(d[0] && d[0] === d[1], "both people have the dinner");

console.log("\n--- splitting it for the day you differ ---");
await p.click('[data-act="splitSlot"][data-key="dinner"]');
await p.waitForTimeout(250);
ok((await p.$$('[data-act="pickDaySlot"][data-key="dinner"]')).length === 2, "dinner now has a picker for each person");
await pick(p, '[data-act="pickDaySlot"][data-key="dinner"][data-which="1"]', { index: 2 });
await settle();
d = await dinner();
ok(d[0] && d[1] && d[0] !== d[1], `they now differ (${JSON.stringify(d)})`);
ok((await p.$$('[data-act="splitSlot"]')).length === 2, "and it stays split on its own, with no button to split it again");

console.log("\n--- same for both folds it back ---");
await p.click('[data-act="joinSlot"][data-key="dinner"]');
await settle();
d = await dinner();
ok(d[0] === d[1] && d[0] !== null, "the second person has the first one's dinner");
ok((await p.$$('[data-act="pickDaySlot"]')).length === 0, "and it is one picker again");

console.log("page errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.screenshot({ path: `${SHOTS}/plan-day.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
