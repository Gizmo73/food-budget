/* Adding to the shopping list by hand, from the List tab. One way in: a search
   over the things you keep (loose matching, so a typo still finds it), tap one
   to put a pack on the list; and below it, for what is not an item at all, a
   line to write in with the shop to put it under. */
import { browser, BASE, SHOTS } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 2, colorScheme: "dark", isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const booted = () => p.waitForFunction(() => document.getElementById("app")?.dataset.booted === "1", null, { timeout: 15000 });
const db = () => p.evaluate(async () => (await import("./lib/store.js")).loadDb());
const total = () => p.$eval(".till .big", (e) => e.textContent.trim());
const results = () => p.$$eval("#add-live .pickrow .shop", (n) => n.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
const live = () => p.$eval("#add-live", (e) => e.textContent.replace(/\s+/g, " "));

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await booted();
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  await s.saveDb(s.migrate(JSON.parse(json)), true);
}, readFileSync(FIXTURE, "utf8"));
await p.reload();
await booted();
await p.waitForTimeout(300);

console.log("--- one way in ---");
ok((await p.$$('[data-act="openAdd"]')).length === 1, "the List has a single Add button");
ok((await p.$$('[data-act="addJotting"]')).length === 0, "and nothing to add under each shop");
const before = await total();
await p.click('[data-act="openAdd"]');
await p.waitForSelector("#add-live");
ok(await p.evaluate(() => document.activeElement && document.activeElement.dataset.act === "setAddQuery"),
  "the search is focused, so you can just type");
ok(/Start typing to search the 37 items you keep/.test(await live()), "before typing it says what it will search");

console.log("\n--- searching your own items, loosely ---");
await p.evaluate(() => { window.__search = document.querySelector('[data-act="setAddQuery"]'); });
await p.fill('[data-act="setAddQuery"]', "stkpies");
await p.waitForTimeout(150);
let found = await results();
console.log("   stkpies ->", JSON.stringify(found));
ok(found[0] === "Steak Pies", `a typo still finds it, first (${found[0]})`);
ok(await p.evaluate(() => window.__search === document.querySelector('[data-act="setAddQuery"]')),
  "and typing never rebuilt the field, so the keyboard stays up");
ok(/Tesco · £2\.50 a pack/.test(await p.$eval("#add-live .pickrow .detail", (e) => e.textContent)),
  "each result says where it is bought and what a pack costs");

await p.fill('[data-act="setAddQuery"]', "tuna");
await p.waitForTimeout(150);
found = await results();
ok(found.includes("Tuna Spring Water") && found.includes("Tuna Sunflower Oil"), `both tunas turn up (${JSON.stringify(found)})`);

console.log("\n--- tapping one puts a pack on the list ---");
await p.fill('[data-act="setAddQuery"]', "eggs");
await p.waitForTimeout(150);
await p.click('#add-live [data-act="addFromSheet"]');
await p.waitForTimeout(300);
let eggs = (await db()).ingredients.find((i) => i.name === "Eggs");
ok(eggs.extraPacks === 1, `one pack of eggs is on the list (${eggs.extraPacks})`);
ok(/Eggs is on the list/.test(await live()), "and the sheet says so");
ok(await p.$('.sheet [data-act="addFromSheet"]') !== null, "the sheet stays open, to add the next thing");
ok((await p.$eval('[data-act="setAddQuery"]', (e) => e.value)) === "eggs", "with the search as it was");
await p.click('#add-live [data-act="addFromSheet"]');
await p.waitForTimeout(300);
eggs = (await db()).ingredients.find((i) => i.name === "Eggs");
ok(eggs.extraPacks === 2, `a second tap is a second pack (${eggs.extraPacks})`);
ok(/× 2/.test((await results())[0]), "and the result shows the count");
await p.click('#add-live [data-act="lessExtra"]');
await p.waitForTimeout(300);
eggs = (await db()).ingredients.find((i) => i.name === "Eggs");
ok(eggs.extraPacks === 1, `the minus takes one back off (${eggs.extraPacks})`);

await p.click(".sheet >> text=Done");
await p.waitForTimeout(250);
ok((await p.$(".sheet")) === null, "Done closes the sheet");
const names = await p.$$eval(".group .gname", (n) => n.map((e) => e.textContent.trim()));
ok(names.includes("Morrisons"), `eggs have a Morrisons heading on the list (${JSON.stringify(names)})`);
ok((await total()) !== before, `and the total moved (${before} -> ${await total()})`);

console.log("\n--- a heading that was shut is opened for it ---");
await p.click('[data-act="toggleStore"][data-store="Tesco"]');
await p.waitForTimeout(200);
ok((await p.$$eval('[data-act="toggleStore"][data-store="Tesco"] .ph-caret-right', (n) => n.length)) === 1, "Tesco is folded away");
await p.click('[data-act="openAdd"]');
await p.fill('[data-act="setAddQuery"]', "rice");
await p.waitForTimeout(150);
await p.click('#add-live [data-act="addFromSheet"]');
await p.waitForTimeout(300);
await p.click(".sheet >> text=Done");
await p.waitForTimeout(200);
ok((await p.$$eval('[data-act="toggleStore"][data-store="Tesco"] .ph-caret-down', (n) => n.length)) === 1,
  "adding rice opens Tesco, so it is not added out of sight");

console.log("\n--- something that is not an item ---");
await p.click('[data-act="openAdd"]');
await p.fill('[data-act="setAddQuery"]', "zzqx");
await p.waitForTimeout(150);
ok(/Nothing you keep matches/.test(await live()), "a miss says so");
ok((await p.$eval('[data-act="setAddText"]', (e) => e.value)) === "zzqx", "and the write-in line already holds what was typed");

await p.fill('[data-act="setAddText"]', "");
await p.click('[data-act="addWritten"]');
await p.waitForTimeout(200);
ok(/Write what you want to add first/.test(await live()), "an empty line is refused, with a reason");

await p.fill('[data-act="setAddText"]', "Bin bags");
await p.click('[data-act="pickAddShop"][data-store="Asda"]');
await p.waitForTimeout(200);
ok((await p.$eval('[data-act="setAddText"]', (e) => e.value)) === "Bin bags", "choosing a shop does not lose what was written");
ok(await p.$eval('[data-act="pickAddShop"][data-store="Asda"]', (e) => e.classList.contains("on")), "and the chosen shop is marked");
await p.click('[data-act="addWritten"]');
await p.waitForTimeout(300);
let jots = (await db()).jottings.map((j) => ({ store: j.store, text: j.text }));
console.log("   ", JSON.stringify(jots));
ok(jots.length === 1 && jots[0].store === "Asda" && jots[0].text === "Bin bags", "it is written onto Asda");
ok(/“Bin bags” is on the list under Asda/.test(await live()), "and the sheet says so");
ok((await p.$eval('[data-act="setAddText"]', (e) => e.value)) === "", "the line is cleared for the next one");

console.log("\n--- no shop, and a new one ---");
await p.fill('[data-act="setAddText"]', "Stamps");
await p.click('[data-act="pickAddShop"][data-store=""]');
await p.click('[data-act="addWritten"]');
await p.waitForTimeout(300);
await p.fill('[data-act="setAddText"]', "Honey");
await p.click('[data-act="addShopNew"]');
await p.waitForTimeout(200);
ok(await p.evaluate(() => document.activeElement && document.activeElement.dataset.act === "setAddShop"),
  "a new shop opens its own box, focused");
await p.fill('[data-act="setAddShop"]', "farm shop");
await p.click('[data-act="addWritten"]');
await p.waitForTimeout(300);
jots = (await db()).jottings.map((j) => ({ store: j.store, text: j.text }));
console.log("   ", JSON.stringify(jots));
ok(jots.some((j) => j.text === "Stamps" && j.store === ""), "with no shop it is saved with none, not guessed");
ok(jots.some((j) => j.text === "Honey" && j.store === "Farm Shop"), "a new shop is tidied the way every other shop name is");
await p.click(".sheet >> text=Done");
await p.waitForTimeout(250);
const heads = await p.$$eval(".group .gname", (n) => n.map((e) => e.textContent.trim()));
ok(heads.includes("Farm Shop") && heads.includes("No shop yet"), `both groups are on the list (${JSON.stringify(heads)})`);

console.log("\n--- reopened, the shop is on offer ---");
await p.click('[data-act="openAdd"]');
await p.waitForSelector("#add-live");
const chips = await p.$$eval('[data-act="pickAddShop"]', (n) => n.map((e) => e.dataset.store));
ok(chips.includes("Farm Shop") && chips.includes("Tesco"), `known shops, kept ones and written ones, are offered (${JSON.stringify(chips)})`);
await p.screenshot({ path: `${SHOTS}/list-add.png` });

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
