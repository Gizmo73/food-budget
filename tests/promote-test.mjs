import { browser, BASE, SHOTS } from "./browser.mjs";
import { readFileSync } from "fs";
const FIXTURE = new URL("./fixtures/sample-list.json", import.meta.url).pathname;
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, colorScheme: "dark", isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const fail = []; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

console.log("--- the app is at the root now ---");
const res = await p.goto(`${BASE}/index.html`);
ok(res.status() === 200, "the root app serves");
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
// the 404 this provokes is the point, so it must not count as a page error
const expected404 = [];
p.on("response", (r) => r.status() === 404 && expected404.push(r.url()));
const gone = await p.goto(`${BASE}/next/index.html`);
ok(gone.status() === 404, `and /next/ is gone (${gone.status()})`);

await p.goto(`${BASE}/index.html`);
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(300);

console.log("\n--- it is not badged as a test any more ---");
const look = await p.evaluate(() => ({
  title: document.title,
  h1: document.querySelector(".masthead h1").textContent.trim(),
  sub: document.querySelector(".masthead p").textContent.replace(/\s+/g, " ").trim(),
  tabs: [...document.querySelectorAll('[data-act="tab"]')].map((e) => e.dataset.tab),
}));
console.log("  ", JSON.stringify(look));
ok(look.title === "Fortnight Shop", `title is clean (${look.title})`);
ok(look.h1 === "Fortnight Shop", `no test badge (${look.h1})`);
ok(!/separate data/.test(look.sub), "no warning about separate data");
ok(look.tabs.join(",") === "list,plan,food,meals,items", `all five tabs present (${look.tabs.join(",")})`);

console.log("\n--- it opens the database both phones already use ---");
const dbName = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  await s.loadDb();
  return (await indexedDB.databases()).map((d) => d.name);
});
console.log("   databases on this origin:", JSON.stringify(dbName));
ok(dbName.includes("fortnight-shop"), "fortnight-shop, the live name");
ok(!dbName.includes("fortnight-shop-next"), "and not the test one");

console.log("\n--- a schema 4 database, which is what is on the phones ---");
const v4 = {
  schema: 4, budget: 60, updatedAt: "2026-06-01T10:00:00Z",
  ingredients: [
    { id: "pies", name: "Pies", store: "Tesco", pricePerPack: 2.5, portionsPerPack: 2,
      packLabel: "568g", stockPortions: 1, barcode: "5000000000001", priceUpdated: "2026-05-20" },
    { id: "spuds", name: "Potatoes", store: "Lidl", pricePerPack: 2.25, portionsPerPack: 4,
      packLabel: "2.5kg", stockPortions: 0, priceUpdated: "2026-05-22" },
  ],
  meals: [{ id: "pm", name: "Pie and mash", items: [
    { ingredientId: "pies", portions: 2 }, { ingredientId: "spuds", portions: 1 }] }],
  plan: ["pm", null, "pm", null, null, null, null, null, null, null, null, null, null, null],
};
await p.evaluate(async (db) => {
  // write it raw, exactly as an old version left it
  const idb = await new Promise((res, rej) => {
    const r = indexedDB.open("fortnight-shop", 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const tx = idb.transaction("kv", "readwrite");
    tx.objectStore("kv").put(db, "db");
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}, v4);
await p.reload();
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);

// read the current schema out of the module rather than pinning a number here
const LATEST = await p.evaluate(async () => (await import("./lib/store.js")).SCHEMA_VERSION);
const migrated = await p.evaluate(async () => {
  const s = await import("./lib/store.js");
  const c = await import("./lib/calc.js");
  const db = await s.loadDb();
  const pies = db.ingredients.find((i) => i.id === "pies");
  return {
    schema: db.schema, items: db.ingredients.length,
    packAmount: pies.products[0].packAmount, packUnit: pies.products[0].packUnit,
    barcode: pies.products[0].barcodes[0],
    bothSlots: db.plan[0].dinner[0] === "pm" && db.plan[0].dinner[1] === "pm",
    total: c.computeShopping(db).total,
    itemsBadge: Number(document.querySelector('[data-act="tab"][data-tab="items"] .cnt').textContent),
  };
});
console.log("  ", JSON.stringify(migrated));
ok(migrated.schema === LATEST, `migrated 4 -> ${LATEST} on first load (${migrated.schema})`);
ok(migrated.items === 2, "both items came across");
ok(migrated.packAmount === 568 && migrated.packUnit === "g", '"568g" parsed into the new pack size');
ok(migrated.barcode === "5000000000001", "the barcode survived");
ok(migrated.bothSlots, "the household meal landed in both people's slots");
ok(migrated.itemsBadge === 2, "and the page renders it");

console.log("\n--- restoring the real backup on top ---");
await p.evaluate(async (json) => {
  const s = await import("./lib/store.js");
  await s.saveDb(s.migrate(JSON.parse(json)), true);
}, readFileSync(FIXTURE, "utf8"));
await p.reload();
await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await p.waitForTimeout(400);
const restored = await p.evaluate(() => Number(document.querySelector('[data-act="tab"][data-tab="items"] .cnt').textContent));
ok(restored === 37, `the 37 items load in the promoted app (${restored})`);

console.log("\n--- every tab still works ---");
for (const t of ["list", "plan", "food", "meals", "items"]) {
  await p.click(`[data-act="tab"][data-tab="${t}"]`);
  await p.waitForTimeout(250);
  const n = await p.evaluate(() => document.querySelector(".wrap").textContent.trim().length);
  ok(n > 40, `${t} renders (${n} chars)`);
}

const real = errs.filter((e) => !/404/.test(e));
console.log("\nexpected 404s:", expected404.length ? expected404 : "none");
console.log("page errors:", real.length ? real : "none");
if (real.length) fail.push("page errors");
ok(expected404.every((u) => u.includes("/next/")), "the only 404 is the one this test asked for");
await p.screenshot({ path: `${SHOTS}/promoted.png` });
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
