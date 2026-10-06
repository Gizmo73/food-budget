/* Settings is three short pages, not one long scroll: what syncs, how it looks,
   and what this copy of the app is. */
import { browser, BASE } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, colorScheme: "dark", isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
await p.click('[data-act="openSettings"]');
const has = (sel) => p.$(`.sheet ${sel}`).then((e) => e !== null);
const tabs = await p.$$eval('[data-act="setSettingsGroup"]', (els) => els.map((e) => ({ text: e.textContent.trim(), on: e.dataset.on === "1" })));
ok(JSON.stringify(tabs.map((t) => t.text)) === JSON.stringify(["Sync", "Appearance", "About"]), `three groups (${tabs.map((t) => t.text)})`);
ok(tabs[0].on, "opening on Sync");

console.log("\n--- Sync ---");
ok(await has('[data-act="pullNow"]') && await has('[data-act="pushNow"]'), "restore and update");
ok(await has('[data-act="openInvite"]') && await has('[data-act="toggleFlag"]'), "sharing and the sync switches");
ok(!(await has(".swatch")) && !(await has('[data-act="checkUpdate"]')), "and neither the colours nor the version");

console.log("\n--- Appearance ---");
await p.click('[data-act="setSettingsGroup"][data-group="look"]');
ok(await has('[data-act="setTheme"]') && await has(".swatch"), "theme and colour");
ok(!(await has('[data-act="pullNow"]')), "and nothing about syncing");

console.log("\n--- About ---");
await p.click('[data-act="setSettingsGroup"][data-group="about"]');
ok(await has('[data-act="checkUpdate"]'), "the version and the check for an update");
ok(await has('.foldhead[data-kind="problems"]'), "and the problem log");
ok(/Install this app/.test(await p.$eval(".sheet", (e) => e.textContent)), "and how to install it");

console.log("\n--- remembered while it is open, and not after ---");
await p.click('[data-act="closeSheet"]');
await p.click('[data-act="openSettings"]');
ok(await p.$eval('[data-act="setSettingsGroup"][data-group="sync"]', (e) => e.dataset.on === "1"), "a fresh visit starts on Sync again");

console.log("page errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
