/* One week of the fortnight in view at a time: the nav arrows step between
   them and stop at each end, a meal can be written straight onto a day with
   no ingredients behind it, and two days can be swapped wholesale - slots,
   edits, extras and anything written all moving together. */
import { browser, BASE } from "./browser.mjs";

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

await p.addInitScript(() => localStorage.setItem("fs-theme", "dark"));
await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });

await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const mk = (id, name) => {
    const i = store.newIngredient("Tesco", name);
    i.id = id;
    i.products = [store.newProduct(name, "Tesco", { pricePerPack: 2, portionsPerPack: 4, priceUpdated: "2026-08-01" })];
    return i;
  };
  const plan = Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));
  plan[0].dinner = ["bol", null]; // Saturday, if planStart is a Saturday
  await store.saveDb(store.migrate({
    schema: 8,
    ingredients: [mk("mince", "Mince")],
    meals: [{ id: "bol", name: "Bolognese", updatedAt: "", items: [{ ingredientId: "mince", portions: 1 }] }],
    // 2026-08-01 is a Saturday
    plan, people: ["Lee", "Sam"], planStart: "2026-08-01",
  }));
  location.reload();
});
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.click('[data-act="tab"][data-tab="plan"]');
await p.waitForTimeout(300);

console.log("--- the first week is on screen to start with ---");
const dayNames = () => p.$$eval(".dayblock .dname", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
let names = await dayNames();
console.log("   ", JSON.stringify(names));
ok(names.length === 7, `seven days shown, not fourteen (${names.length})`);
ok(/^Saturday/.test(names[0]), `the week starts on Saturday (${names[0]})`);
ok(/^Friday/.test(names[6]), `and ends on Friday (${names[6]})`);

const prevArrow = () => p.$('[data-act="planWeek"][data-w="-1"]');
const nextArrow = () => p.$('[data-act="planWeek"][data-w="1"]');
ok(await p.evaluate((el) => el.disabled, await prevArrow()), "the week-before arrow is disabled on week 1");
ok(!(await p.evaluate((el) => el.disabled, await nextArrow())), "and the week-after arrow is not");

console.log("\n--- stepping to the second week ---");
await p.click('[data-act="planWeek"][data-w="1"]');
await p.waitForTimeout(200);
names = await dayNames();
console.log("   ", JSON.stringify(names));
ok(/^Saturday/.test(names[0]), `week two also starts on Saturday (${names[0]})`);
ok(!names.some((n) => /Bolognese/.test(n)), "and week one's meal is not visible here");
ok(await p.evaluate((el) => el.disabled, await p.$('[data-act="planWeek"][data-w="2"]')),
  "the week-after arrow is disabled on the last week");

await p.click('[data-act="planWeek"][data-w="0"]');
await p.waitForTimeout(200);

console.log("\n--- writing a meal in with no ingredients behind it ---");
p.once("dialog", (d) => d.accept("Chinese takeaway"));
await p.click('[data-act="writeDay"][data-idx="1"]');
await p.waitForTimeout(450);
const written = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return db.plan[1].written;
});
console.log("   ", JSON.stringify(written));
ok(Array.isArray(written) && written[0] === "Chinese takeaway", "it lands in day.written, as plain text");
const onScreen = await p.$eval('.dayblock:nth-child(2) .writtenline', (e) => e.textContent.replace(/\s+/g, " ").trim());
ok(/Chinese takeaway/.test(onScreen), `and shows on the day, with a way to remove it (${onScreen})`);

const costUnaffected = await p.evaluate(async () => {
  const calc = await import("./lib/calc.js");
  const store = await import("./lib/store.js");
  return calc.computeShopping(await store.loadDb()).dayCost[1];
});
ok(!costUnaffected, `a written-in meal costs nothing (${costUnaffected})`);

console.log("\n--- taking it off again ---");
await p.click('[data-act="unwriteDay"][data-idx="1"][data-n="0"]');
await p.waitForTimeout(450);
const cleaned = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return "written" in db.plan[1];
});
ok(cleaned === false, "the array is deleted entirely once empty, not left as []");

console.log("\n--- swapping two days ---");
const before = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return { day0: db.plan[0].dinner, day2: db.plan[2].dinner };
});
console.log("   before:", JSON.stringify(before));
await p.click('[data-act="swapDay"][data-idx="0"]');
await p.waitForTimeout(200);
const armed = await p.$eval('.dayblock:nth-child(1)', (e) => e.dataset.armed);
ok(armed === "1", "tapping Swap arms that day");

await p.click('[data-act="swapDay"][data-idx="2"]');
await p.waitForTimeout(450);
const after = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const db = await store.loadDb();
  return { day0: db.plan[0].dinner, day2: db.plan[2].dinner };
});
console.log("   after: ", JSON.stringify(after));
ok(JSON.stringify(after.day0) === JSON.stringify(before.day2), "day 0 now holds what day 2 held");
ok(JSON.stringify(after.day2) === JSON.stringify(before.day0), "and day 2 holds what day 0 held");
const stillArmed = await p.$('.dayblock[data-armed="1"]');
ok(stillArmed === null, "nothing is left armed after the swap completes");

console.log("\n--- arming, then cancelling ---");
await p.click('[data-act="swapDay"][data-idx="0"]');
await p.waitForTimeout(200);
ok((await p.$('.dayblock[data-armed="1"]')) !== null, "armed again");
await p.click('[data-act="cancelSwap"]');
await p.waitForTimeout(200);
ok((await p.$('.dayblock[data-armed="1"]')) === null, "Cancel disarms it without swapping anything");

console.log("\n--- a written-in meal survives migrate() and a merge ---");
// db.plan is rebuilt fresh by both, so a day's written[] has to be carried
// forward by hand rather than surviving by accident
const carried = await p.evaluate(async () => {
  const store = await import("./lib/store.js");
  const raw = { schema: 7, ingredients: [], meals: [], plan: [{ written: ["Fish and chips"] }] };
  const migrated = store.migrate(raw);
  const local = store.migrate({ ...raw, planUpdatedAt: "2026-01-01T00:00:00.000Z" });
  const remote = store.migrate({ schema: 7, ingredients: [], meals: [], plan: [] });
  const merged = store.mergeSnapshots(local, remote);
  return { migrated: migrated.plan[0].written, merged: merged.db.plan[0].written };
});
console.log("   ", JSON.stringify(carried));
ok(Array.isArray(carried.migrated) && carried.migrated[0] === "Fish and chips",
  `migrate() carries written[] forward (${JSON.stringify(carried.migrated)})`);
ok(Array.isArray(carried.merged) && carried.merged[0] === "Fish and chips",
  `and so does mergeSnapshots() (${JSON.stringify(carried.merged)})`);

console.log("\npage errors:", errs.length ? errs : "none");
if (errs.length) fail.push("page errors");
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
