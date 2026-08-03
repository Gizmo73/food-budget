import { browser, BASE, SHOTS } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, colorScheme: "dark" });
const p = await ctx.newPage();
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const backup = readFileSync(FIXTURE, "utf8");

await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

console.log("--- put the real list in ---");
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  await s.saveDb(s.migrate(JSON.parse(json)), true);
  location.reload();
}, backup);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);
const n = await p.evaluate(async () => (await (await import("./lib/store.js")).loadDb()).ingredients.length);
ok(n === 37, `37 items stored (${n})`);

console.log("\n--- a read that fails must not look like an empty database ---");
const behaviour = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  /* Fail the open itself, which is what a blocked, locked or evicted store
     does. Pointing at a different empty database would be a database that is
     genuinely empty, which is a different thing and legitimately seeds. */
  const realOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = () => {
    const req = {};
    setTimeout(() => {
      req.error = new DOMException("storage unavailable", "InvalidStateError");
      if (req.onerror) req.onerror();
    }, 0);
    return req;
  };
  let threw = null, got = null;
  try { got = await s.loadDb(); } catch (e) { threw = e.message || String(e); }
  indexedDB.open = realOpen;
  return { threw, seeded: got ? got.ingredients.length : null };
});
console.log("  ", JSON.stringify(behaviour));
ok(behaviour.seeded === null, `no data is handed back at all (${JSON.stringify(behaviour.seeded)})`);
ok(!!behaviour.threw, `the failure is raised so the app can say so (${JSON.stringify(behaviour.threw)})`);
ok(behaviour.seeded !== 11, "and above all it is not the 11 item seed standing in for your list");

console.log("\n--- and nothing may be saved before a successful read ---");
const guard = await p.evaluate(async () => {
  // a fresh module instance has never read anything
  const s = await import(`./lib/store.js?fresh=${Date.now()}`);
  let blocked = null;
  try { await s.saveDb({ schema: 7, ingredients: [], meals: [], plan: [] }); }
  catch (e) { blocked = e.message; }
  let forced = null;
  try { await s.saveDb({ schema: 7, ingredients: [], meals: [], plan: [], marker: "forced" }, true); forced = "went through"; }
  catch (e) { forced = "blocked: " + e.message; }
  return { blocked, forced };
});
console.log("  ", JSON.stringify(guard));
ok(/has not been read/.test(guard.blocked || ""), `an automatic save is refused (${guard.blocked})`);
ok(guard.forced === "went through", `a deliberate restore still works (${guard.forced})`);

console.log("\n--- the real list is still there afterwards ---");
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  await s.saveDb(s.migrate(JSON.parse(json)), true);
}, backup);
await p.reload();
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);
const finalCount = await p.evaluate(() => {
  const t = document.querySelector('[data-act="tab"][data-tab="items"] .cnt');
  return t ? Number(t.textContent.trim()) : null;
});
ok(finalCount === 37, `the Items tab shows 37 (${finalCount})`);

await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
