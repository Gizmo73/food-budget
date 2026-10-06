/* Choosing an item, a meal or a product is one control: a search over the rows,
   a tap on the one wanted, in a layer above whatever is open. It is dismissed
   without changing anything, closes before the sheet under it does, and a short
   list does not ask for a search at all. */
import { browser, BASE, pinClock, pick } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await pinClock(ctx);
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
const readDb = () => p.evaluate(async () => (await import("./lib/store.js")).loadDb());
const settle = () => p.waitForTimeout(400);
const rows = () => p.$$eval(".picker .pickrow .shop", (els) => els.map((e) => e.textContent.trim()));

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  await s.saveDb(s.migrate(JSON.parse(json)), true);
}, readFileSync(FIXTURE, "utf8"));
await p.reload();
await booted();

console.log("--- an item, from inside a meal ---");
await p.click('[data-act="tab"][data-tab="meals"]');
await p.click('[data-act="openMeal"][data-id="pie-and-mash"]');
await settle();
const first = '[data-act="pickMealIng"][data-id="pie-and-mash"][data-i="0"]';
const was = await p.$eval(first, (e) => e.textContent.trim());
ok(await p.$("select") === null, "no native select is left on the meal editor");
await p.click(first);
await p.waitForSelector(".picker");
ok(await p.evaluate(() => document.activeElement && document.activeElement.matches(".picker input")), "the search already has the cursor");
let list = await rows();
ok(list.length === (await readDb()).ingredients.length, `every item is there (${list.length})`);
ok(JSON.stringify(list) === JSON.stringify([...list].sort((a, c) => a.localeCompare(c))), "in A to Z order");
ok(await p.$eval(".picker .pickrow.on .shop", (e) => e.textContent.trim()) === was, `the one it is now is marked (${was})`);
ok(await p.$('[data-act="setMealName"]') !== null, "and the meal is still there underneath");

console.log("\n--- fuzzy search ---");
await p.fill(".picker input", "chkn brst");
list = await rows();
console.log("   ", JSON.stringify(list));
ok(list[0] === "Chicken Breasts", `a loose spelling finds it first (${list[0]})`);
await p.fill(".picker input", "zzzzqq");
ok(/Nothing matches/.test(await p.$eval("#picker-live", (e) => e.textContent)), "and a miss says so");
ok(await p.evaluate(() => document.activeElement && document.activeElement.matches(".picker input")), "without taking the keyboard away");

console.log("\n--- dismissing changes nothing ---");
await p.click('[data-act="pickCancel"]');
await p.waitForSelector(".picker", { state: "detached" });
ok(await p.$eval(first, (e) => e.textContent.trim()) === was, "Cancel leaves the line as it was");
await p.click(first);
await p.waitForSelector(".picker");
await p.mouse.click(190, 40);
await p.waitForSelector(".picker", { state: "detached" });
ok(await p.$eval(first, (e) => e.textContent.trim()) === was, "so does a tap beside it");

console.log("\n--- choosing ---");
const before = (await readDb()).meals.find((m) => m.id === "pie-and-mash");
await pick(p, first, { query: "eggs", value: "eggs" });
await settle();
const after = (await readDb()).meals.find((m) => m.id === "pie-and-mash");
ok(after.items[0].ingredientId === "eggs", "the line now asks for Eggs");
ok(after.items[0].productId === "", "and a product of the old item is forgotten");
ok(after.items.length === before.items.length, "nothing else moved");
ok(after.updatedAt > before.updatedAt, "and the meal is stamped, so the other phone takes it");

console.log("\n--- a product, from a short list ---");
const prod = '[data-act="pickMealProduct"][data-id="pie-and-mash"][data-i="0"]';
await p.click(prod);
await p.waitForSelector(".picker");
ok(await p.$(".picker input") === null, "a few products need no search box");
ok(await p.$(".picker.short") !== null, "and the sheet is only as tall as they are");
list = await rows();
ok(/^Any/.test(list[0]), `the first row is the usual answer (${list[0]})`);
await p.click('[data-act="pickCancel"]');

console.log("\n--- adding a line is choosing it ---");
const count = after.items.length;
await pick(p, '[data-act="addMealIng"][data-id="pie-and-mash"]', "bacon");
await settle();
const added = (await readDb()).meals.find((m) => m.id === "pie-and-mash");
ok(added.items.length === count + 1 && added.items[count].ingredientId === "bacon", "Bacon is on the end, at one portion");
ok(added.items[count].portions === 1, `at one portion (${added.items[count].portions})`);
await p.click('[data-act="addMealIng"][data-id="pie-and-mash"]');
await p.waitForSelector(".picker");
await p.click('[data-act="pickCancel"]');
await settle();
ok((await readDb()).meals.find((m) => m.id === "pie-and-mash").items.length === count + 1, "and cancelling adds nothing");

console.log("\n--- a meal, from inside a day ---");
await p.click('[data-act="closeSheet"]');
await p.click('[data-act="tab"][data-tab="plan"]');
await p.click('[data-act="openDay"][data-idx="1"]');
await p.waitForTimeout(250);
const dinner = '[data-act="pickDaySlotBoth"][data-key="dinner"]';
await p.click(dinner);
await p.waitForSelector(".picker");
list = await rows();
ok(list[0] === "Nothing", `the first row clears the slot (${list[0]})`);
await p.fill(".picker input", "bolog");
list = await rows();
ok(list.includes("Spaghetti Bolognese") && !list.includes("Fry Up"), "and typing narrows the meals");
await p.click('.picker .pickrow[data-value="bolognese"]');
await p.waitForSelector(".picker", { state: "detached" });
await settle();
let day = (await readDb()).plan[1];
ok(day.dinner[0] === "bolognese" && day.dinner[1] === "bolognese", "both of you have it");
ok(await p.$('.sheet [data-act="splitSlot"]') !== null, "and the day is still open");
await pick(p, dinner, "");
await settle();
day = (await readDb()).plan[1];
ok(!day.dinner[0] && !day.dinner[1], "Nothing takes it off again");

console.log("\n--- page errors ---");
console.log("page errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
