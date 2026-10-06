/* The app asks its own questions and offers its own undo; the browser's
   dialogs are never used. A question names what it will do and can be
   cancelled. Something routine, like ticking a line off, is simply done and
   offers an undo that puts back exactly what was there. */
import { browser, BASE, pinClock, answer } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await pinClock(ctx);
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

let native = 0;
p.on("dialog", (d) => { native += 1; d.dismiss(); });

const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
const db = () => p.evaluate(async () => (await import("./lib/store.js")).loadDb());
const settle = () => p.waitForTimeout(450);

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  const d = s.migrate(JSON.parse(json));
  d.ingredients.find((i) => i.name === "Eggs").extraPacks = 2; // two put on the list by hand
  d.jottings = [{ id: "bags", store: "Tesco", text: "Bin bags", at: "2026-10-01T10:00:00.000Z" }];
  await s.saveDb(d, true);
}, readFileSync(FIXTURE, "utf8"));
await p.reload();
await booted();
await p.waitForTimeout(300);

console.log("--- a question about something that cannot be taken back ---");
await p.click('[data-act="tab"][data-tab="items"]');
await p.click('[data-act="openItem"][data-id="eggs"]');
await p.waitForTimeout(200);
await p.click('[data-act="delItem"]');
await p.waitForSelector(".dialog");
const asked = await p.$eval(".dialog", (e) => e.textContent.replace(/\s+/g, " "));
console.log("   ", asked);
ok(/Delete Eggs\?/.test(asked), "it names what will go");
ok(/taken out of every meal/.test(asked), "and says what else that does");
ok(native === 0, "and it is the app's own box, not the browser's");

await answer(p, { yes: false });
ok((await db()).ingredients.some((i) => i.name === "Eggs"), "Cancel leaves it where it was");
await p.click('[data-act="delItem"]');
await answer(p);
await settle();
ok(!(await db()).ingredients.some((i) => i.name === "Eggs"), "Delete removes it");
await p.click('[data-act="tab"][data-tab="list"]');

console.log("\n--- a question with a box ---");
await p.click('[data-act="tab"][data-tab="plan"]');
await p.click('[data-act="openDay"][data-idx="1"]');
await p.click('[data-act="writeDay"][data-idx="1"]');
await p.waitForSelector(".dialog input");
ok(await p.evaluate(() => document.activeElement && document.activeElement.matches(".dialog input")),
  "the cursor is already in the box");
await p.keyboard.type("Fish supper");
await p.keyboard.press("Enter");
await p.waitForSelector(".dialog", { state: "detached" });
await settle();
ok(((await db()).plan[1].written || []).includes("Fish supper"), "Enter answers it");

await p.click('[data-act="writeDay"][data-idx="1"]');
await p.keyboard.type("Never written");
await answer(p, { yes: false });
await settle();
ok(!((await db()).plan[1].written || []).includes("Never written"), "Cancel writes nothing");

console.log("\n--- ticking a line off offers an undo ---");
await p.click('[data-act="closeSheet"]');
await p.click('[data-act="tab"][data-tab="list"]');
await p.waitForTimeout(300);
const line = await p.$eval('[data-act="bought"]', (e) => ({ id: e.dataset.id, product: e.dataset.product }));
const state = () => p.evaluate(async ({ id, product }) => {
  const d = await (await import("./lib/store.js")).loadDb();
  const ing = d.ingredients.find((i) => i.id === id);
  const prod = ing.products.find((x) => x.id === product);
  return { stock: prod.stockPortions, own: prod.extraPacks || 0, loose: ing.extraPacks || 0 };
}, line);
const before = await state();
await p.click('[data-act="bought"]');
await settle();
const during = await state();
ok(during.stock > before.stock, `the packs became stock (${before.stock} -> ${during.stock})`);
ok(await p.$(".toast") !== null && /bought/.test(await p.$eval(".toast", (e) => e.textContent)), "and a toast says so");
await p.click('[data-act="undoToast"]');
await settle();
const after = await state();
ok(JSON.stringify(after) === JSON.stringify(before), `Undo puts everything back exactly (${JSON.stringify(after)})`);
ok((await p.$(".toast")) === null, "and the toast goes");

await p.click('[data-act="bought"]');
await settle();
await p.clock.runFor(8000);
await p.waitForTimeout(100);
ok((await p.$(".toast")) === null, "left alone, the toast goes by itself");

console.log("\n--- a hand-added pack ---");
const eggsGone = !(await db()).ingredients.some((i) => i.name === "Eggs");
ok(eggsGone, "(eggs went with the item deleted above, so this uses another)");
await p.click('[data-act="tab"][data-tab="list"]');
await p.click('[data-act="openAdd"]');
await p.fill('[data-act="setAddQuery"]', "rice");
await p.click('[data-act="addFromSheet"][data-id="rice"]');
await p.click('[data-act="addFromSheet"][data-id="rice"]');
await settle();
await p.click('[data-act="closeSheet"]');
await p.waitForTimeout(300);
const rice = () => p.evaluate(async () => ((await (await import("./lib/store.js")).loadDb()).ingredients.find((i) => i.id === "rice") || {}).extraPacks);
ok((await rice()) === 2, "two packs of rice are on the list");
await p.click('[data-act="clearExtra"][data-id="rice"]');
await settle();
ok((await rice()) === 0, "the cross takes them off");
await p.click('[data-act="undoToast"]');
await settle();
ok((await rice()) === 2, "and Undo brings both back");

console.log("\n--- a written line struck off ---");
await p.click('[data-act="gotJotting"][data-id="bags"]');
await settle();
ok(((await db()).jottings || []).length === 0, "the line is gone");
await p.click('[data-act="undoToast"]');
await settle();
const back = await db();
const line2 = back.jottings.find((j) => j.id === "bags");
ok(line2 && line2.text === "Bin bags" && line2.store === "Tesco", "Undo brings it back as it was");
ok(line2 && line2.at > back.deleted["jot:bags"], "stamped later than its own headstone, so the other phone cannot bury it");

console.log(`\nnative dialogs shown: ${native}`);
ok(native === 0, "the browser's dialogs were never used");
console.log("page errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
