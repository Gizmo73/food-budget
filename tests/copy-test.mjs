import { browser, BASE, SHOTS } from "./browser.mjs";
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 800 }, deviceScaleFactor: 2, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(400);

/* The "give the other person the same" copy lives in a day's popout now, one
   per slot on the second person's row. Open a day and check it copies. */
await p.click('[data-act="openDay"][data-idx="0"]');
await p.waitForTimeout(300);

const btn = await p.$$eval('[data-act="copyDayCell"]', (els) => ({
  count: els.length, text: els[0].textContent.trim(), title: els[0].title,
  aria: els[0].getAttribute("aria-label"),
  box: (({ width, height }) => ({ w: Math.round(width), h: Math.round(height) }))(els[0].getBoundingClientRect()),
}));
console.log("  ", JSON.stringify(btn));
ok(btn.text === "=", "the glyph is an equals sign");
ok(!/[→←]/.test(btn.text), "no arrow left anywhere on the button");
ok(btn.count === 3, `one per slot on the second person's row (${btn.count})`);
ok(btn.box.h >= 28 && btn.box.w >= 24, `still a tappable size (${btn.box.w}x${btn.box.h})`);
ok(/give/i.test(btn.aria || ""), "it announces what it does to a screen reader");

// give person 1 a dinner, then copy it across to person 2
await p.selectOption('[data-act="setDaySlot"][data-id="0"][data-key="dinner"][data-which="0"]', { index: 1 });
await p.waitForTimeout(300);
const before = await p.$eval('[data-act="setDaySlot"][data-id="0"][data-key="dinner"][data-which="1"]', (e) => e.value);
await p.click('[data-act="copyDayCell"][data-id="0"][data-key="dinner"]');
await p.waitForTimeout(400);
const after = await p.evaluate(() => [
  document.querySelector('[data-act="setDaySlot"][data-id="0"][data-key="dinner"][data-which="0"]').value,
  document.querySelector('[data-act="setDaySlot"][data-id="0"][data-key="dinner"][data-which="1"]').value,
]);
console.log("   person 2 before:", JSON.stringify(before), "after:", JSON.stringify(after));
ok(after[1] === after[0] && after[0] !== "", "pressing it still copies person 1's meal to person 2");

console.log("page errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.screenshot({ path: `${SHOTS}/plan-equals.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
