import { browser, BASE, SHOTS } from "./browser.mjs";
const b = await browser();
const ctx = await b.newContext();
const p = await ctx.newPage();
// read the version out of the worker, so a bump is not a test edit
const CACHE = (await (await fetch(`${BASE}/sw.js`)).text()).match(/CACHE = `\$\{PREFIX\}(\d+)`/)[0].replace(/.*\}/, "").replace("`", "");
const NOW = "fortnight-shop-v" + CACHE;
const PREV = "fortnight-shop-v" + (Number(CACHE) - 1);
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

await p.route(`${BASE}/blank.html`, (r) =>
  r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>blank</title>" }));
await p.goto(`${BASE}/blank.html`);

/* The state a phone is in after the test build was retired: an older live
   cache, and the test build's caches which nothing will ask for again. */
await p.evaluate(async (PREV) => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  (await caches.open(PREV)).put("/styles.css", new Response("stale"));
  (await caches.open("fortnight-shop-next-v13")).put("/next/index.html", new Response("retired"));
  (await caches.open("fortnight-shop-next-v9")).put("/next/app.js", new Response("older still"));
}, PREV);

await p.evaluate(async () => {
  const reg = await navigator.serviceWorker.register("/sw.js");
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (reg.active && reg.active.state === "activated") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 800));
});

const keys = await p.evaluate(() => caches.keys());
console.log("   caches:", JSON.stringify(keys));
ok(keys.includes(NOW), `the current cache is there (${NOW})`);
ok(!keys.includes(PREV), "the previous one was swept");
ok(!keys.some((k) => k.startsWith("fortnight-shop-next-")),
  `and the retired test build's caches are reclaimed (${keys.filter((k) => k.includes("next"))})`);

const shell = await p.evaluate(async (NOW) => {
  const c = await caches.open(NOW);
  return (await c.keys()).map((r) => new URL(r.url).pathname).sort();
}, NOW);
console.log("   shell:", JSON.stringify(shell));
/* Every module app.js imports has to be in the shell, or the app does not
   boot with no signal. Read the imports rather than counting to a number,
   which goes stale the moment a module is added. */
const needed = (await (await fetch(`${BASE}/app.js`)).text())
  .split("\n")
  .map((l) => (l.match(/from "\.(\/lib\/[a-z]+\.js)"/) || [])[1])
  .filter(Boolean);
console.log("   app.js imports:", JSON.stringify(needed));
ok(shell.length >= 11, `the whole shell is cached (${shell.length} files)`);
const missing = needed.filter((f) => !shell.includes(f));
ok(missing.length === 0, `every module app.js imports is cached${missing.length ? ": missing " + missing : ""}`);
ok(!shell.some((x) => x.startsWith("/next/")), "and nothing under the old folder");

// still works with no network
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await ctx.setOffline(true);
await p.reload();
const booted = await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 }).then(() => true).catch(() => false);
ok(booted, "and the app still opens with no signal");
await ctx.setOffline(false);

await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
