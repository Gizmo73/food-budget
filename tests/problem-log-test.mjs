/* The record of things that went wrong: kept outside the database, because
   the failures worth recording are the ones where the database is the problem. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });

console.log("--- the problem log ---");
{
  const empty = await p.evaluate(async () => {
    const log = await import("./lib/log.js");
    log.clearLog();
    return log.entries().length;
  });
  ok(empty === 0, "it starts empty");

  // something the app never catches
  await p.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", { message: "test: a thing broke" }));
  });
  await p.waitForTimeout(200);

  // and a save that cannot be written
  await p.evaluate(async () => {
    const store = await import("./lib/store.js");
    const real = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new Error("test: quota exceeded"); };
    try {
      await store.saveDb(await store.loadDb().catch(() => ({ schema: 9, ingredients: [], meals: [], plan: [] })));
    } catch (err) {
      const log = await import("./lib/log.js");
      log.note("Could not save your changes", err);
    }
    indexedDB.open = real;
  });
  await p.waitForTimeout(200);

  const got = await p.evaluate(async () => (await import("./lib/log.js")).entries());
  console.log("   ", JSON.stringify(got.map((e) => e.what)));
  ok(got.length === 2, `both were recorded (${got.length})`);
  ok(got[0].at >= got[1].at, "newest first");
  ok(got.some((e) => /a thing broke/.test(e.detail || "")), "an unhandled error is kept with its message");
  ok(got.some((e) => /quota/.test(e.detail || "")), "and so is a failed save");

  // it shows up in Settings, folded away
  await p.click('[data-act="openSettings"]');
  await p.click('[data-act="setSettingsGroup"][data-group="about"]');
  await p.waitForTimeout(400);
  const fold = await p.evaluate(() => {
    const head = document.querySelector('.foldhead[data-kind="problems"]');
    return head ? head.textContent.replace(/\s+/g, " ").trim() : "";
  });
  console.log("   fold:", JSON.stringify(fold));
  ok(/Problems/.test(fold), "Settings has a Problems section");
  ok(/2 recorded/.test(fold), `which says how many without being opened (${fold})`);

  await p.click('.foldhead[data-kind="problems"]');
  await p.waitForTimeout(400);
  const rows = await p.$$eval(".logrow", (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  console.log("   rows:", JSON.stringify(rows, null, 1));
  ok(rows.length === 2, `both are listed (${rows.length})`);
  ok(rows.some((t) => /Could not save/.test(t)), "including the failed save");
  await p.screenshot({ path: `${SHOTS}/problem-log.png`, fullPage: true });

  // what a copy would carry
  const text = await p.evaluate(async () => (await import("./lib/log.js")).logText("fortnight-shop-v30"));
  ok(/fortnight-shop-v30/.test(text), "a copy carries the app version");
  ok(/Mozilla|Chrome/.test(text), "and the browser, which is half of any bug report");
  ok(!/Mince|Bolognese/.test(text), "and nothing about what you eat");

  await p.click('[data-act="clearLog"]');
  await p.waitForTimeout(400);
  const after = await p.evaluate(async () => (await import("./lib/log.js")).entries().length);
  ok(after === 0, "and it can be cleared");
}

console.log("\n--- a log survives storage being broken ---");
{
  /* The whole point: the failures worth recording are the ones where the
     database is the problem, so the log must not live in the database. */
  const kept = await p.evaluate(async () => {
    const log = await import("./lib/log.js");
    const real = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new Error("test: database is gone"); };
    log.note("Could not open local storage", new Error("test: database is gone"));
    const got = log.entries();
    indexedDB.open = real;
    return got;
  });
  ok(kept.length === 1 && /database is gone/.test(kept[0].detail),
    "it recorded a failure that IndexedDB itself could not have recorded");
}

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
