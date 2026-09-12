/* Swiping between the five pages. A drag has to lock onto an axis before it
   commits to anything: mostly-horizontal moves a tab, mostly-vertical leaves
   the page alone so a long list still scrolls, and a drag starting on the tab
   bar itself never counts as a swipe. There is no page past the first or last
   tab, so a swipe there simply goes nowhere. */
import { browser, BASE } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, colorScheme: "dark", hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

const currentTab = () => p.evaluate(() => document.querySelector('.tabs button[data-on="1"]').dataset.tab);

/* A drag from (x0,y0) to (x0+dx, y0+dy), as raw touch pointer events fired
   straight at whatever is under the finger. installSwipe() only listens for
   pointerdown/move/up, so this exercises exactly what it exercises without
   also risking a real click firing on whatever button happens to sit there -
   the failure mode a Playwright mouse drag has, since a button underneath a
   drag's start point can still receive a synthesized click. */
async function drag(dx, dy, { x0 = 300, y0 = 400, steps = 8 } = {}) {
  await p.evaluate(
    ({ dx, dy, x0, y0, steps }) => {
      const target = document.elementFromPoint(x0, y0) || document.body;
      const fire = (type, x, y) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch",
            clientX: x, clientY: y, button: 0,
          })
        );
      fire("pointerdown", x0, y0);
      for (let i = 1; i <= steps; i++) fire("pointermove", x0 + (dx * i) / steps, y0 + (dy * i) / steps);
      fire("pointerup", x0 + dx, y0 + dy);
    },
    { dx, dy, x0, y0, steps }
  );
  await p.waitForTimeout(300);
}

console.log("--- a decisive horizontal drag moves one page ---");
ok((await currentTab()) === "list", "starts on List");
await drag(-150, 0);
ok((await currentTab()) === "plan", `swiping left goes to Plan (${await currentTab()})`);
await drag(-150, 0);
ok((await currentTab()) === "food", "and again to Food");

console.log("\n--- swiping the other way goes back ---");
await drag(150, 0);
ok((await currentTab()) === "plan", `swiping right returns to Plan (${await currentTab()})`);

console.log("\n--- a short drag is not decisive enough ---");
const before = await currentTab();
await drag(-40, 0);
ok((await currentTab()) === before, `under the threshold, the tab does not change (${await currentTab()})`);

console.log("\n--- a mostly-vertical drag is left for scrolling ---");
const beforeV = await currentTab();
await drag(-30, 200);
ok((await currentTab()) === beforeV, `a vertical drag does not change tabs (${await currentTab()})`);

console.log("\n--- there is nothing past either end ---");
for (let i = 0; i < 6; i++) await drag(-200, 0);
ok((await currentTab()) === "items", `swiping past Items goes nowhere further (${await currentTab()})`);
for (let i = 0; i < 6; i++) await drag(200, 0);
ok((await currentTab()) === "list", `swiping past List goes nowhere further (${await currentTab()})`);

console.log("\n--- a drag starting on the tab bar is not a swipe ---");
const tabsBox = await p.evaluate(() => {
  const r = document.querySelector(".tabs").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await drag(-200, 0, { x0: tabsBox.x, y0: tabsBox.y });
ok((await currentTab()) === "list", `a drag from the tab bar does not swipe (${await currentTab()})`);

console.log("\n--- the tab buttons and the pager agree with the swipe ---");
await p.click('button[data-act="tab"][data-tab="meals"]');
await p.waitForTimeout(200);
const pager = await p.evaluate(() => [...document.querySelectorAll(".pager span")].map((s) => s.dataset.on));
console.log("   ", JSON.stringify(pager));
ok(pager.filter((v) => v === "1").length === 1, "exactly one pager segment is lit");
ok(pager[3] === "1", `and it is the fourth, for Meals (${JSON.stringify(pager)})`);

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
