/* Hand-written lines on the shopping list: items with no entry behind them,
   typed straight onto a shop. They must survive a reload, stay one box per
   item, cost nothing, and go away when struck off without touching stock. */
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

const boxes = () => p.$$eval('textarea[data-act="setJotting"]', (n) => n.map((t) => t.value));
const total = () => p.$eval(".till .big", (e) => e.textContent.trim());

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

console.log("--- every shop offers a way to write on it ---");
const shops = await p.$$eval(".group", (gs) =>
  gs.map((g) => ({
    name: g.querySelector(".gname").textContent.trim(),
    add: !!g.querySelector('[data-act="addJotting"]'),
  }))
);
console.log("  ", JSON.stringify(shops));
ok(shops.length > 1, `the list is grouped into ${shops.length} shops`);
ok(shops.every((s) => s.add), "and each one has an Add item button");

const before = await total();
console.log("\n--- one press, one box ---");
await p.click('.group [data-act="addJotting"]');
await p.waitForTimeout(300);
ok((await boxes()).length === 1, "the first press opens one box");
ok(
  await p.evaluate(() => document.activeElement.dataset.act === "setJotting"),
  "and the cursor is already in it, so you can just type"
);

await p.fill('textarea[data-act="setJotting"]', "Bin bags");
/* Blur the box rather than clicking somewhere else to do it: the app commits
   on change, and a stray click lands on whatever the layout put under it. */
await p.evaluate(() => document.activeElement && document.activeElement.blur());
await p.waitForTimeout(300);

console.log("\n--- a second press is a second box, not a longer one ---");
await p.click('.group [data-act="addJotting"]');
await p.waitForTimeout(300);
let now = await boxes();
console.log("  ", JSON.stringify(now));
ok(now.length === 2, "two presses give two boxes");
ok(now.includes("Bin bags"), "and the first still says what was typed in it");

console.log("\n--- writing on the list costs nothing ---");
ok((await total()) === before, `the total is unchanged at ${before}`);

console.log("\n--- it survives a reload ---");
await p.reload();
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);
now = await boxes();
ok(now.includes("Bin bags"), "the written line is still there after a reload");

console.log("\n--- Got it strikes it off and touches no stock ---");
const stockBefore = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const db = await s.loadDb();
  return JSON.stringify(db.ingredients.map((i) => [i.id, i.extraPacks, (i.products || []).map((x) => x.stock)]));
});
const count = (await boxes()).length;
await p.click('[data-act="gotJotting"]');
await p.waitForTimeout(400);
ok((await boxes()).length === count - 1, "the box goes away");
const stockAfter = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const db = await s.loadDb();
  return JSON.stringify(db.ingredients.map((i) => [i.id, i.extraPacks, (i.products || []).map((x) => x.stock)]));
});
ok(stockAfter === stockBefore, "and nothing was put into stock");
ok((await total()) === before, "and the total is still unchanged");

console.log("\n--- a struck-off line does not come back from the other phone ---");
const merged = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const mine = await s.loadDb();
  /* The other phone still holds the line this one just struck off, exactly as
     it would after shopping apart for an hour. */
  const theirs = s.migrate(JSON.parse(JSON.stringify({ ...mine, deleted: {} })));
  theirs.jottings = [...theirs.jottings, { id: "gone", store: "Tesco", text: "Bin bags", at: "2020-01-01T00:00:00.000Z" }];
  const struck = { ...mine, deleted: { ...mine.deleted, "jot:gone": new Date().toISOString() } };
  const out = s.mergeSnapshots(struck, theirs);
  return out.db.jottings.map((j) => j.id);
});
console.log("  ", JSON.stringify(merged));
ok(!merged.includes("gone"), "the headstone keeps it off the list");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.screenshot({ path: `${SHOTS}/jottings-${TH}.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
