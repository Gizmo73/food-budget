/* Three things: ingredient pickers in alphabetical order, an accent colour
   that is remembered and legible, and an ingredient editor you can navigate
   when it holds several products. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text()));
const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

/* Deliberately out of alphabetical order in the database, and one ingredient
   with three products so the folding has something to fold. */
await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mk = (id, name, products) => {
    const ing = store.newIngredient("Tesco", name);
    ing.id = id;
    ing.products = products.map(([pname, shop, price, stock]) =>
      store.newProduct(pname, shop, {
        pricePerPack: price, portionsPerPack: 4, packAmount: 500, packUnit: "g",
        stockPortions: stock, priceUpdated: "2026-07-30",
      })
    );
    return ing;
  };
  const yog = mk("yog", "Activia Yoghurt", [
    ["Blueberry", "Tesco", 3, 4],
    ["Strawberry", "Tesco", 2.4, 0],
    ["Peach", "Asda", 3.2, 1],
  ]);
  await store.saveDb(store.migrate({
    schema: 7,
    ingredients: [
      mk("zucchini", "Zucchini", [["Loose", "Tesco", 1, 0]]),
      yog,
      mk("milk", "Milk", [["Semi skimmed", "Tesco", 1.45, 2]]),
      mk("apples", "Apples", [["Braeburn", "Tesco", 1.8, 0]]),
    ],
    meals: [{ id: "brek", name: "Breakfast", items: [{ ingredientId: "milk", portions: 1 }] }],
    plan: [], people: ["Lee", "Sam"],
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(300);

console.log("--- ingredient pickers are A to Z ---");
await p.click('[data-act="tab"][data-tab="meals"]');
await p.waitForTimeout(250);
await p.click('[data-act="openMeal"]');
await p.waitForTimeout(350);
const opts = await p.$eval('[data-act="setMealIng"]', (s) => [...s.options].map((o) => o.text));
console.log("   ", JSON.stringify(opts));
const sorted = [...opts].sort((a, b) => a.localeCompare(b));
ok(JSON.stringify(opts) === JSON.stringify(sorted), "the meal ingredient list is in order");
ok(opts[0] === "Activia Yoghurt" && opts[opts.length - 1] === "Zucchini", "from Activia to Zucchini");
ok(opts.indexOf("Milk") > opts.indexOf("Apples"), "and it is not the order they were added in");
const stillSelected = await p.$eval('[data-act="setMealIng"]', (s) => s.options[s.selectedIndex].text);
ok(stillSelected === "Milk", `and the row still points at what it did (${stillSelected})`);

console.log("\n--- the accent colour ---");
await p.click('[data-act="openSettings"]');
await p.waitForTimeout(350);
const swatches = await p.$$eval(".swatch", (els) =>
  els.map((e) => ({ hex: e.dataset.accent, bg: getComputedStyle(e).backgroundColor, on: e.classList.contains("on") })));
console.log("   ", JSON.stringify(swatches.slice(0, 3)));
ok(swatches.length >= 6, `there is a row of colours (${swatches.length})`);
ok(swatches.filter((s) => s.on).length === 1, "exactly one is marked as chosen");
ok(swatches[0].hex === "", "and the first is the app's own");

const before = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
await p.click('.swatch[data-accent="#9B6BE0"]');
await p.waitForTimeout(400);
const picked = await p.evaluate(() => ({
  accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  on: getComputedStyle(document.documentElement).getPropertyValue("--on-accent").trim(),
  saved: localStorage.getItem("fs-accent"),
}));
console.log(`   was ${before}, now ${JSON.stringify(picked)}`);
ok(picked.accent.toUpperCase() === "#9B6BE0", "picking a colour applies it");
ok(picked.on.toUpperCase() === "#FFFFFF", `and writing on the violet is white (${picked.on})`);
ok(picked.saved === "#9B6BE0", "and it is written where the page can read it before it paints");

// it has to reach the actual furniture, not just the variable
const used = await p.evaluate(() => {
  const solid = document.querySelector(".btn.solid, .seg button[data-on='1']");
  return solid ? getComputedStyle(solid).backgroundColor : "";
});
ok(used === "rgb(155, 107, 224)", `a solid control is that colour (${used})`);

// survives a reload, with no yellow frame first
await p.reload();
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
const early = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
ok(early.toUpperCase() === "#9B6BE0", `it is still set after a reload (${early})`);

// yellow needs black on it; that is the case the formula exists for
await p.click('[data-act="openSettings"]');
await p.waitForTimeout(300);
await p.click('.swatch[data-accent=""]');
await p.waitForTimeout(400);
const backToYellow = await p.evaluate(() => ({
  accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  inline: document.documentElement.style.getPropertyValue("--accent"),
  saved: localStorage.getItem("fs-accent"),
}));
console.log("   ", JSON.stringify(backToYellow));
ok(backToYellow.inline === "", "choosing the app's own colour clears the override");
ok(backToYellow.accent.toUpperCase() === "#F5C400", "so the stylesheet's yellow is back");

console.log("\n--- the ingredient editor ---");
await p.click('[data-act="closeSheet"]').catch(() => {});
await p.waitForTimeout(200);
await p.click('[data-act="tab"][data-tab="items"]');
await p.waitForTimeout(300);
await p.evaluate(() => {
  [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Activia/.test(e.textContent)).click();
});
await p.waitForTimeout(400);

const editing = await p.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const open = document.querySelector(".card.editing");
  const ring = open ? getComputedStyle(open).boxShadow : "";
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return { cards: cards.length, ringed: document.querySelectorAll(".card.editing").length, ring, accent,
           holdsName: !!(open && open.querySelector('[data-field="name"]')) };
});
console.log("   ring:", editing.ring);
ok(editing.ringed === 1, `exactly one card is outlined (${editing.ringed})`);
ok(editing.holdsName, "and it is the one holding the ingredient name");
ok(/245, 196, 0/.test(editing.ring), `the outline is the accent colour (${editing.ring})`);

const heads = await p.$$eval(".prodtitle", (els) =>
  els.map((e) => ({
    text: e.textContent.replace(/\s+/g, " ").trim(),
    open: e.dataset.open === "1",
    product: e.dataset.product,
  })));
console.log("   headers:", JSON.stringify(heads, null, 1));
ok(heads.length === 3, `all three products have a header (${heads.length})`);
ok(heads.filter((h) => h.open).length === 0, "and none of them starts open");
ok(heads.every((h) => /Tesco|Asda/.test(h.text)), "every header names its shop");
ok(heads.some((h) => /cheapest/.test(h.text)), "the cheapest is badged as such");
ok(heads.every((h) => /£/.test(h.text)), "and every header carries a price");

const bodies = await p.evaluate(() => ({
  shut: document.querySelectorAll(".subcard.shut").length,
  editors: document.querySelectorAll('[data-act="setProductPrice"]').length,
}));
console.log("   ", JSON.stringify(bodies));
ok(bodies.editors === 0, `no editor is open (${bodies.editors} price boxes)`);
ok(bodies.shut === 3, `all three are shut, so they fit one screen (${bodies.shut})`);

// opening one, then another, moves the open one rather than stacking editors
const first = heads.find((h) => h.text.includes("Strawberry"));
await p.click(`.prodtitle[data-product="${first.product}"]`);
await p.waitForTimeout(350);
ok(
  (await p.$$('[data-act="setProductPrice"]')).length === 1,
  "tapping a header opens that one"
);
const other = heads.find((h) => h.text.includes("Peach"));
await p.click(`.prodtitle[data-product="${other.product}"]`);
await p.waitForTimeout(350);
const moved = await p.evaluate(() => ({
  open: [...document.querySelectorAll(".prodtitle")].filter((e) => e.dataset.open === "1")
    .map((e) => e.textContent.replace(/\s+/g, " ").trim().slice(0, 12)),
  editors: document.querySelectorAll('[data-act="setProductPrice"]').length,
}));
console.log("   ", JSON.stringify(moved));
ok(moved.editors === 1, "still only one editor open");
ok(moved.open.length === 1 && /Peach/.test(moved.open[0]), `and it is the one just tapped (${moved.open})`);

// tapping the open one shuts it
await p.click(`.prodtitle[data-product="${other.product}"]`);
await p.waitForTimeout(350);
ok(
  (await p.$$('[data-act="setProductPrice"]')).length === 0,
  "tapping it again shuts it, leaving just the headers"
);

// adding one opens it, because a blank collapsed header says nothing
await p.click('[data-act="addProduct"]');
await p.waitForTimeout(450);
const added = await p.evaluate(() => ({
  heads: document.querySelectorAll(".prodtitle").length,
  editors: document.querySelectorAll('[data-act="setProductPrice"]').length,
  openText: [...document.querySelectorAll(".prodtitle")].filter((e) => e.dataset.open === "1")
    .map((e) => e.textContent.replace(/\s+/g, " ").trim())[0] || "",
}));
console.log("   ", JSON.stringify(added));
ok(added.heads === 4, `there are four products now (${added.heads})`);
ok(added.editors === 1 && /Unnamed/.test(added.openText), `and the new blank one is the open one (${added.openText})`);

await p.screenshot({ path: `${SHOTS}/items-folded.png`, fullPage: true });

// a different ingredient starts fresh rather than inheriting the choice
await p.evaluate(() => {
  [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Milk/.test(e.textContent)).click();
});
await p.waitForTimeout(400);
const single = await p.evaluate(() => ({
  heads: document.querySelectorAll(".prodtitle").length,
  editors: document.querySelectorAll('[data-act="setProductPrice"]').length,
}));
ok(single.heads === 1 && single.editors === 0,
  `a different ingredient starts collapsed too, rather than inheriting the choice (${JSON.stringify(single)})`);

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
