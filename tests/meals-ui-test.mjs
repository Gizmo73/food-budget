import { browser, BASE, SHOTS } from "./browser.mjs";
import { readFileSync } from "fs";
import { migrate } from "../lib/store.js";
import { mealStock } from "../lib/calc.js";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;

/* What the sample list should produce, worked out from the sample list itself.
   Written as numbers here once, these went stale the moment the fixture
   changed and the test then failed for no reason anybody could act on. */
const sample = migrate(JSON.parse(readFileSync(FIXTURE, "utf8")));
const byId = Object.fromEntries(sample.ingredients.map((i) => [i.id, i]));
const ALL = sample.meals.length;
const MAKEABLE = sample.meals.filter((m) => mealStock(m, byId).canMake).length;
const EMPTY = sample.meals.filter((m) => !m.items.length).map((m) => m.name);
const SHORT = sample.meals.find((m) => m.items.length && !mealStock(m, byId).canMake).name;
console.log(`sample list: ${ALL} meals, ${MAKEABLE} makeable, ${EMPTY.length} empty, short of one: ${SHORT}`);
const TH = process.env.FS_THEME || "dark";
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, colorScheme: TH, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
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

console.log("--- sorted ---");
await p.click('[data-act="tab"][data-tab="meals"]');
await p.waitForTimeout(400);
const names = await p.$$eval('[data-act="openMeal"] div[style*="700"]', (e) => e.map((x) => x.textContent.trim()));
console.log("  ", JSON.stringify(names));
const sorted = [...names].sort((a, b) => a.localeCompare(b));
ok(JSON.stringify(names) === JSON.stringify(sorted), "meals are in name order");
ok(names.length === ALL, `all ${ALL} shown to start (${names.length})`);

console.log("\n--- each says whether it can be made ---");
const notes = await p.$$eval('[data-act="openMeal"] .muted', (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
console.log("  ", JSON.stringify(notes.slice(0, 5), null, 1));
ok(notes.some((t) => /everything in/.test(t)), "some say everything is in");
ok(notes.some((t) => /short of/.test(t)), "some name what is short");
ok(notes.some((t) => /nothing in it yet/.test(t)), "and the empty ones say so");

console.log("\n--- the filter ---");
const counts = await p.$$eval('[data-act="setMealFilter"]', (e) => e.map((x) => x.textContent.trim()));
console.log("  ", JSON.stringify(counts));
ok(counts[0] === `All ${ALL}`, `it counts them all (${counts[0]})`);
ok(counts[1] === `Can make ${MAKEABLE}`, `and counts what you could cook (${counts[1]})`);

await p.click('[data-act="setMealFilter"][data-filter="stock"]');
await p.waitForTimeout(500);
const filtered = await p.$$eval('[data-act="openMeal"] div[style*="700"]', (e) => e.map((x) => x.textContent.trim()));
console.log("  ", JSON.stringify(filtered));
ok(filtered.length === MAKEABLE, `${MAKEABLE} shown (${filtered.length})`);
ok(!filtered.includes(SHORT), `the one short of an ingredient is hidden (${SHORT})`);
ok(!filtered.some((n) => EMPTY.includes(n)), `and so are the empty ones (${EMPTY.join(", ")})`);
ok(filtered.length > 0 && filtered.every((n) => !EMPTY.includes(n)), "only cookable ones are left");
const stillSorted = [...filtered].sort((a, b) => a.localeCompare(b));
ok(JSON.stringify(filtered) === JSON.stringify(stillSorted), "still in name order");

console.log("\n--- the choice sticks ---");
await p.reload();
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);
await p.click('[data-act="tab"][data-tab="meals"]');
await p.waitForTimeout(400);
const after = await p.$$eval('[data-act="openMeal"] div[style*="700"]', (e) => e.length);
ok(after === MAKEABLE, `still filtered after a reload (${after})`);

console.log("\n--- an open meal is never filtered away ---");
await p.click('[data-act="setMealFilter"][data-filter="all"]');
await p.waitForTimeout(400);
await p.evaluate((short) => {
  [...document.querySelectorAll('[data-act="openMeal"]')].find((e) => e.textContent.includes(short)).click();
}, SHORT);
await p.waitForTimeout(400);
await p.click('[data-act="setMealFilter"][data-filter="stock"]');
await p.waitForTimeout(500);
/* An open meal shows its name in an input, so textContent will not find it.
   Look for the editor itself. */
const openStillThere = await p.evaluate(() => {
  const field = document.querySelector('[data-act="setMealName"]');
  return { open: !!field, name: field ? field.value : null,
           cards: document.querySelectorAll('[data-act="openMeal"] div[style*="700"]').length };
});
console.log("  ", JSON.stringify(openStillThere));
ok(openStillThere.open && (openStillThere.name || "").includes(SHORT),
  `the meal you are editing stays put even though it cannot be made (${openStillThere.name})`);
ok(openStillThere.cards === MAKEABLE, `and the rest are the makeable ones (${openStillThere.cards})`);

console.log("\n--- the plan's dropdowns are sorted too ---");
await p.evaluate(() => document.querySelector('[data-act="closeSheet"]')?.click());
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(400);
const opts = await p.$$eval('[data-act="setSlot"]', (e) =>
  [...e[0].options].slice(1).map((o) => o.textContent.trim()));
console.log("  ", JSON.stringify(opts.slice(0, 4)));
const optSorted = [...opts].sort((a, b) => a.localeCompare(b));
ok(JSON.stringify(opts) === JSON.stringify(optSorted), "the meal picker is in name order");
ok(opts.length === ALL, `with every meal in it, filter or no filter (${opts.length})`);

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.click('[data-act="tab"][data-tab="meals"]');
await p.waitForTimeout(400);
await p.screenshot({ path: `${SHOTS}/meals-${TH}.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
