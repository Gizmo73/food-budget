/* Nothing you have to tap with a thumb is smaller than 44px each way. Walks the
   screens a week actually uses and reports anything that is. Text boxes only
   need the height, since their width is the row. */
import { browser, BASE, pinClock } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await pinClock(ctx);
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  await s.saveDb(s.migrate(JSON.parse(json)), true);
}, readFileSync(FIXTURE, "utf8"));
await p.reload();
await booted();

async function audit(label) {
  await p.waitForTimeout(250);
  const small = await p.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll("button, [data-act], input:not([type=hidden]), select, textarea, a")) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = /^(text|search|number|date|password|email|url|tel)$/.test(e.type || "") || e.tagName === "TEXTAREA";
      if (text ? r.height < 43.5 : r.height < 43.5 || r.width < 43.5)
        out.push(`${e.tagName.toLowerCase()}[${e.dataset.act || e.className}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  ok(small.length === 0, `${label}: nothing under 44px${small.length ? ` (${[...new Set(small)].join(", ")})` : ""}`);
}

ok((await p.$$(".ticket")).length > 0, "(the List has lines on it to measure)");
await audit("the List");
await p.click('[data-act="openAdd"]');
await audit("the add sheet");
await p.click('[data-act="closeSheet"]');
await p.click('[data-act="tab"][data-tab="plan"]');
await audit("the Plan");
await p.click('[data-act="openDay"][data-idx="1"]');
await p.click('[data-act="toggleDayFold"][data-key="dinner"]');
await audit("a day, with its items open");
await p.click('[data-act="closeSheet"]');
await p.click('[data-act="tab"][data-tab="meals"]');
await p.click('[data-act="openMeal"][data-id="pie-and-mash"]');
await audit("a meal being edited");
await p.click('[data-act="tab"][data-tab="items"]');
await p.evaluate(() => [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Steak Pies/.test(e.textContent)).click());
await audit("an item, open");
await p.click('[data-act="openSettings"]');
await audit("Settings, Sync");
await p.click('[data-act="setSettingsGroup"][data-group="look"]');
await audit("Settings, Appearance");
await p.click('[data-act="setSettingsGroup"][data-group="about"]');
await audit("Settings, About");

console.log("page errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
