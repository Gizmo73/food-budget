/* The back button in the installed app. The app is one page with nothing behind
   it, so back used to leave it. Now it closes what is on top, then returns to
   the List, and past that is absorbed; in an ordinary browser tab it is left
   alone, since there it is how you leave. */
import { browser, BASE } from "./browser.mjs";

const b = await browser();
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const errs = [];

/* Playwright cannot switch display-mode, so say so to the page the way a
   browser would. */
const asInstalled = () => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q) => {
    const m = real(q);
    if (/display-mode:\s*standalone/.test(q)) Object.defineProperty(m, "matches", { value: true });
    return m;
  };
};

async function open(installed) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  if (installed) await p.addInitScript(asInstalled);
  await p.goto("about:blank");
  await p.goto(`${BASE}/index.html`);
  await p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
  await p.evaluate(() => { window.__alive = true; });
  return p;
}
const here = (p) => p.evaluate(() => ({
  alive: window.__alive === true,
  url: location.pathname,
  guard: history.state && history.state.fs,
  tab: document.querySelector(".tabs [data-on='1']").dataset.tab,
  sheet: !!document.querySelector(".sheet"),
  camera: !!document.querySelector(".scanner"),
  title: (document.querySelector(".sheet h2") || {}).textContent || "",
}));
const back = async (p) => { await p.goBack(); await p.waitForTimeout(250); return here(p); };

console.log("--- installed ---");
let p = await open(true);
let s = await here(p);
ok(s.guard === "app", "an entry is held in front of the app's own");

await p.click('[data-act="openSettings"]');
await p.waitForTimeout(200);
ok((await here(p)).sheet, "Settings is open");
s = await back(p);
ok(!s.sheet && s.alive && /index\.html$/.test(s.url), "back closes the sheet and stays in the app");
ok(s.guard === "app", "and the entry is put back for the next press");

await p.click('[data-act="openAdd"]');
await p.click('[data-act="openScan"]');
await p.waitForSelector(".scanner");
s = await back(p);
ok(!s.camera && s.alive && s.sheet, "back closes the camera first, leaving the add sheet under it");
s = await back(p);
ok(!s.sheet && s.alive, "and the next press closes the sheet");

await p.click('[data-act="openSettings"]');
await p.click('[data-act="openHelp"]');
await p.waitForTimeout(200);
ok((await here(p)).title === "Sharing the long way", "a sheet opened from Settings is open");
s = await back(p);
ok(s.sheet && s.title === "Settings", `back returns to Settings, not out (${s.title})`);
s = await back(p);
ok(!s.sheet && s.alive, "and the next press closes Settings");

await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(200);
ok((await here(p)).tab === "items", "on the Items tab");

await p.click('[data-act="openItem"]');
await p.click('[data-act="delItem"]');
await p.waitForSelector(".dialog");
s = await back(p);
ok(!(await p.$(".dialog")) && s.alive, "back answers a question with no, and the item is still there");
ok((await p.$$('[data-act="openItem"]')).length > 5, "(nothing was deleted)");
s = await back(p);
ok(s.tab === "items" && !(await p.$(".card.editing")), "the next press closes the open item");

s = await back(p);
ok(s.tab === "list" && s.alive, "back goes to the List");

for (let i = 1; i <= 3; i++) s = await back(p);
ok(s.alive && s.tab === "list" && /index\.html$/.test(s.url) && s.guard === "app",
  "on the List, pressing back again and again leaves the app where it is");

await p.reload();
await p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
const len = await p.evaluate(() => history.length);
await p.reload();
await p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
ok((await p.evaluate(() => history.length)) === len, "reloading does not stack up more entries each time");
await p.context().close();

console.log("\n--- an ordinary browser tab ---");
p = await open(false);
s = await here(p);
ok(s.guard === null || s.guard === undefined, "no entry is added");
await p.click('[data-act="openSettings"]');
await p.goBack();
await p.waitForTimeout(250);
ok(p.url() === "about:blank", `back leaves the page, as it should in a tab (${p.url()})`);
await p.context().close();

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
