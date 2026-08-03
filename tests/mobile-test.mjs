import { browser, BASE, SHOTS } from "./browser.mjs";
const TH = process.env.FS_THEME || "dark";
const b = await browser();
// a small phone on purpose: 360px is where a crushed row shows up
const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, colorScheme: TH, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

/* Products start collapsed under an ingredient now, so open one before
   reaching for anything inside its editor. */
const openFirstProduct = async (page) => {
  await page.evaluate(() => {
    const head = document.querySelector('.prodtitle[data-open="0"]');
    if (head) head.click();
  });
  await page.waitForTimeout(350);
};
await p.addInitScript((t) => localStorage.setItem("fs-theme", t), TH);
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

console.log("--- viewport and zoom ---");
const meta = await p.$eval('meta[name="viewport"]', (e) => e.content);
console.log("  ", meta);
ok(/user-scalable=no/.test(meta), "zooming is refused in the viewport tag");
ok(/maximum-scale=1/.test(meta), "and capped at 1");
ok(/minimum-scale=1/.test(meta), "with no zooming out below 1 either");
ok(/viewport-fit=cover/.test(meta), "still covering the notch");
const touchAction = await p.evaluate(() => getComputedStyle(document.documentElement).touchAction);
ok(touchAction === "manipulation", `double tap zoom is off (touch-action: ${touchAction})`);

// the pinch guard has to actually refuse the event, not just be registered
const refused = await p.evaluate(() => {
  const e = new Event("gesturestart", { cancelable: true, bubbles: true });
  document.dispatchEvent(e);
  return e.defaultPrevented;
});
ok(refused, "a pinch gesture is refused");

console.log("\n--- nothing focusable is under 16px ---");
await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const mk = (n, id) => {
    const i = s.newIngredient("Tesco", n); i.id = id;
    i.products = [s.newProduct(n, "Tesco", { pricePerPack: 3.15, portionsPerPack: 4, packAmount: 2000, packUnit: "ml", priceUpdated: "2026-07-30" })];
    return i;
  };
  const plan = Array.from({ length: 14 }, () => ({ breakfast: [null, null], lunch: [null, null], dinner: [null, null] }));
  plan[0].dinner = ["m1", "m1"];
  await s.saveDb(s.migrate({
    schema: 7,
    ingredients: [mk("Arla Lactofree Semi Skimmed Milk", "arla"), mk("Milk", "milk"), mk("Bread", "bread")],
    meals: [{ id: "m1", name: "Toast", items: [{ ingredientId: "bread", portions: 1 }] }],
    plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

const smallOn = async (label) => {
  const small = await p.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .map((e) => ({ tag: e.tagName.toLowerCase(), act: e.dataset.act || "", size: parseFloat(getComputedStyle(e).fontSize) }))
      .filter((x) => x.size < 16));
  ok(small.length === 0, `${label}: no control under 16px${small.length ? " — " + JSON.stringify(small) : ""}`);
};

for (const tab of ["list", "plan", "food", "meals", "items"]) {
  await p.click(`[data-act="tab"][data-tab="${tab}"]`);
  await p.waitForTimeout(250);
  await smallOn(tab);
}
await p.evaluate(() => document.querySelector('[data-act="openItem"]').click());
await openFirstProduct(p);
await p.waitForTimeout(400);
await smallOn("an open item");
await p.evaluate(() => document.querySelector('[data-act="openSettings"]').click());
await p.waitForTimeout(400);
await smallOn("settings, including the backup box");
await p.evaluate(() => document.querySelector('[data-act="closeSheet"]').click());
await p.waitForTimeout(300);

console.log("\n--- sheets scroll rather than dragging the page ---");
await p.evaluate(() => document.querySelector('[data-act="openSettings"]').click());
await p.waitForTimeout(400);
const sheet = await p.evaluate(() => {
  const s = document.querySelector(".sheet");
  const cs = getComputedStyle(s);
  return { overscroll: cs.overscrollBehavior, overflowY: cs.overflowY,
           scrollable: s.scrollHeight > s.clientHeight,
           scrimOverscroll: getComputedStyle(document.querySelector(".scrim")).overscrollBehavior };
});
console.log("  ", JSON.stringify(sheet));
ok(sheet.overflowY === "auto", "the sheet scrolls its own content");
ok(/contain/.test(sheet.overscroll), "and keeps the gesture to itself");
ok(/none/.test(sheet.scrimOverscroll), "the backdrop does not pass it through either");
await p.evaluate(() => document.querySelector('[data-act="closeSheet"]').click());
await p.waitForTimeout(300);

console.log("\n--- the product card footer fits 360px ---");
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(300);
await p.evaluate(() => [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Arla/.test(e.textContent)).click());
await openFirstProduct(p);
await p.waitForTimeout(400);
const footer = await p.evaluate(() => {
  const acts = document.querySelector(".prodacts");
  if (!acts) return null;
  const kids = [...acts.children].map((e) => {
    const r = e.getBoundingClientRect();
    return { what: e.dataset.act || e.tagName, w: Math.round(r.width), h: Math.round(r.height) };
  });
  const sel = acts.querySelector("select");
  return {
    kids,
    rowWidth: Math.round(acts.getBoundingClientRect().width),
    placeholder: sel.options[0].textContent.trim(),
    selFont: parseFloat(getComputedStyle(sel).fontSize),
    why: document.querySelectorAll(".why").length,
    bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
console.log("  ", JSON.stringify(footer, null, 1));
ok(footer.kids.every((k) => k.w >= 60), `nothing is crushed: ${JSON.stringify(footer.kids.map((k) => k.w))}`);
ok(footer.kids.every((k) => k.h <= 48), `and nothing is stacked into a column: heights ${JSON.stringify(footer.kids.map((k) => k.h))}`);
ok(footer.placeholder === "Move to…", `the picker label is short (${footer.placeholder})`);
ok(footer.selFont >= 16, `and 16px, so tapping it will not zoom (${footer.selFont})`);
ok(footer.bodyOverflow <= 0, `the page does not scroll sideways (${footer.bodyOverflow}px of overflow)`);

await p.evaluate(() => document.querySelector(".prodacts").scrollIntoView({ block: "center" }));
await p.waitForTimeout(200);
await p.screenshot({ path: `${SHOTS}/footer-${TH}.png` });

console.log("\n--- and it still moves ---");
await p.selectOption('[data-act="moveProduct"]', "milk");
await p.waitForTimeout(600);
const moved = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const db = await s.loadDb();
  return { names: db.ingredients.map((i) => i.name),
           flash: document.querySelector(".ok")?.textContent.replace(/\s+/g, " ").trim() || "" };
});
console.log("  ", JSON.stringify(moved));
ok(!moved.names.includes("Arla Lactofree Semi Skimmed Milk"), "the Arla ingredient is gone");
ok(/filed under Milk/.test(moved.flash), "and the banner says so");

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await p.screenshot({ path: `${SHOTS}/mobile-${TH}.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
