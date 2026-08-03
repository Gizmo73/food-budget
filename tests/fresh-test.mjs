import { browser, BASE, SHOTS } from "./browser.mjs";
import { readFileSync, writeFileSync } from "fs";
const b = await browser();
const ctx = await b.newContext();
const p = await ctx.newPage();
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

console.log("--- install, then change the app on the server ---");
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.evaluate(() => navigator.serviceWorker.ready);
await p.waitForTimeout(600);
ok(await p.evaluate(() => !!navigator.serviceWorker.controller), "the worker is in charge");

/* Change the file on disk, which is what a deploy is. Intercepting in the
   page does not work here: the service worker's own fetches never pass
   through page routing, so the worker would keep seeing the original. */
const appPath = new URL("../app.js", import.meta.url).pathname;
const original = readFileSync(appPath, "utf8");
writeFileSync(appPath, original.replace("<h1>Fortnight Shop</h1>", "<h1>Fortnight Shop DEPLOYED</h1>"));

let first = "";
try {
  await p.reload();
  await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
  await p.waitForTimeout(400);
  first = await p.evaluate(() => document.querySelector(".masthead h1").textContent.trim());
  console.log("   after one reload:", JSON.stringify(first));
  ok(/DEPLOYED/.test(first), `the new version shows on the FIRST reload (${first})`);
} finally {
  writeFileSync(appPath, original);
}

console.log("\n--- and it still works with no signal ---");
await ctx.setOffline(true);
await p.reload();
const booted = await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 20000 })
  .then(() => true).catch(() => false);
ok(booted, "the app opens offline from the cache");
const offlineTitle = await p.evaluate(() => document.querySelector(".masthead h1").textContent.trim());
console.log("   offline shows:", JSON.stringify(offlineTitle));
ok(offlineTitle.length > 0, "with a working shell");
await ctx.setOffline(false);

console.log("\n--- the version is readable in settings ---");
await p.reload();
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(800);
await p.evaluate(() => document.querySelector('[data-act="openSettings"]').click());
await p.waitForTimeout(500);
await p.evaluate(() => {
  const b = document.querySelector('[data-act="toggleRepoBox"]');
  if (b) b.click();
});
await p.waitForTimeout(600);
const shown = await p.evaluate(() => {
  const sheet = document.querySelector(".sheet");
  return {
    text: sheet.textContent.replace(/\s+/g, " "),
    hasButton: !!sheet.querySelector('[data-act="checkUpdate"]'),
  };
});
ok(/fortnight-shop-v\d+/.test(shown.text), `settings names the running copy (${(shown.text.match(/fortnight-shop-v\d+/) || ["none"])[0]})`);
ok(shown.hasButton, "and offers a check for an update");

await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
