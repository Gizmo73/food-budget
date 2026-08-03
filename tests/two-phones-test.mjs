/* The real thing: two browsers, one fake shared file, driven through the app's
   own buttons. The unit test proves the merge rules; this proves the app
   actually stamps what it changes and sends it. */
import { browser, BASE, SHOTS } from "./browser.mjs";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

// the shared file, held here instead of on GitHub
let file = null;
let sha = 0;
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8");

const b = await browser();

async function phone(name) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { console.log(`  ${name} pageerror: ${e.message}`); fail.push("pageerror"); });

  await ctx.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      if (!file) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: b64(file), sha: `sha${sha}` }),
      });
    }
    if (req.method() === "PUT") {
      file = unb64(JSON.parse(req.postData()).content);
      sha += 1;
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: { sha: `sha${sha}` }, commit: { sha: `c${sha}` } }),
      });
    }
    return route.fulfill({ status: 400, body: "{}" });
  });

  await p.goto(`${BASE}/index.html`);
  await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
  return { ctx, p };
}

const connect = (p, person) =>
  p.evaluate(async (who) => {
    const store = await import("./lib/store.js");
    await store.saveSettings({
      ...(await store.loadSettings()),
      owner: "someone", repo: "shop-data", path: "prices.json", branch: "main",
      token: "t", person: who, autoMerge: true, warnOnLeave: false,
    });
  }, person);

const seedList = (p) =>
  p.evaluate(async () => {
    const store = await import("./lib/store.js");
    const mk = (id, name, price) => {
      const i = store.newIngredient("Tesco", name);
      i.id = id;
      i.updatedAt = "2026-08-01T10:00:00.000Z";
      i.products = [store.newProduct(name, "Tesco", { pricePerPack: price, portionsPerPack: 4, priceUpdated: "2026-08-01" })];
      return i;
    };
    await store.saveDb(store.migrate({
      schema: 8,
      ingredients: [mk("milk", "Milk", 1.45), mk("mince", "Mince", 3.5), mk("beans", "Beans", 0.9)],
      meals: [
        { id: "bol", name: "Bolognese", updatedAt: "2026-08-01T10:00:00.000Z",
          items: [{ ingredientId: "mince", portions: 2 }] },
        { id: "toast", name: "Beans on toast", updatedAt: "2026-08-01T10:00:00.000Z",
          items: [{ ingredientId: "beans", portions: 1 }] },
      ],
      plan: [], people: ["Lee", "Sam"], planStart: "2026-08-03",
      updatedAt: "2026-08-01T10:00:00.000Z", planUpdatedAt: "2026-08-01T10:00:00.000Z",
    }));
  });

const push = async (p) => {
  await p.click('[data-act="openSettings"]');
  await p.waitForTimeout(250);
  await p.click('[data-act="pushNow"]');
  await p.waitForTimeout(700);
  const msg = await p.$eval(".sheet", (e) => e.textContent.replace(/\s+/g, " "));
  await p.click('[data-act="closeSheet"]');
  await p.waitForTimeout(200);
  return msg;
};

const readDb = (p) =>
  p.evaluate(async () => {
    const store = await import("./lib/store.js");
    const db = await store.loadDb();
    return {
      ingredients: db.ingredients.map((i) => i.name).sort(),
      meals: db.meals.map((m) => `${m.name} (${m.items.length})`).sort(),
      day1: db.plan[0].dinner,
      people: db.people,
      milkPrice: (db.ingredients.find((i) => i.id === "milk") || { products: [{}] }).products[0].pricePerPack,
    };
  });

console.log("--- Lee sets up and shares ---");
const lee = await phone("Lee");
await connect(lee.p, "Lee");
await seedList(lee.p);
await lee.p.reload();
await lee.p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await lee.p.waitForTimeout(300);
console.log("   " + (await push(lee.p)).slice(-60));
ok(!!file, "the shared file now exists");

console.log("\n--- Sam joins and gets the same list ---");
const sam = await phone("Sam");
await connect(sam.p, "Sam");
await sam.p.reload();
await sam.p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
await sam.p.waitForTimeout(1200);
let s = await readDb(sam.p);
console.log("   Sam sees:", JSON.stringify(s.ingredients), JSON.stringify(s.meals));
ok(s.ingredients.includes("Mince"), "Sam picked up Lee's items");
ok(s.meals.some((m) => m.startsWith("Bolognese")), "and Lee's meals");

console.log("\n--- Lee changes things and pushes ---");
await lee.p.click('[data-act="tab"][data-tab="meals"]');
await lee.p.waitForTimeout(300);
// rename a meal both phones already hold
await lee.p.evaluate(() => {
  [...document.querySelectorAll('[data-act="openMeal"]')].find((e) => /Bolognese/.test(e.textContent)).click();
});
await lee.p.waitForTimeout(350);
await lee.p.fill('[data-act="setMealName"]', "Bolognese, the good one");
await lee.p.evaluate(() => document.querySelector('[data-act="setMealName"]').blur());
await lee.p.waitForTimeout(400);
// add an ingredient to it
await lee.p.click('[data-act="addMealIng"]');
await lee.p.waitForTimeout(400);
// plan a day
await lee.p.click('[data-act="tab"][data-tab="plan"]');
await lee.p.waitForTimeout(300);
await lee.p.evaluate(() => {
  const sel = document.querySelector('[data-act="setSlot"][data-idx="0"][data-slot="dinner"]');
  sel.value = "bol";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await lee.p.waitForTimeout(400);
// throw an item out
await lee.p.click('[data-act="tab"][data-tab="items"]');
await lee.p.waitForTimeout(300);
lee.p.on("dialog", (d) => d.accept());
await lee.p.evaluate(() => {
  [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Beans/.test(e.textContent)).click();
});
await lee.p.waitForTimeout(400);
await lee.p.click('[data-act="delItem"]');
await lee.p.waitForTimeout(500);
const leeNow = await readDb(lee.p);
ok(!leeNow.ingredients.includes("Beans"), "Lee's Beans are gone locally");
console.log("   " + (await push(lee.p)).slice(-60));

console.log("\n--- Sam comes back to the app ---");
// no reload: the phone was backgrounded and brought back, which is the case
// that used to leave the other person on stale data for days
await sam.p.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
await sam.p.waitForTimeout(200);
await sam.p.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
await sam.p.waitForTimeout(1500);
s = await readDb(sam.p);
console.log("   Sam sees:", JSON.stringify(s, null, 1));
ok(s.meals.some((m) => /the good one/.test(m)), "the renamed meal reached Sam without a reload");
ok(s.meals.some((m) => /the good one \(2\)/.test(m)), "with the ingredient Lee added to it");
ok(s.day1[0] === "bol", "the day Lee planned reached Sam");
ok(!s.ingredients.includes("Beans"), "and the item Lee threw out is gone from Sam's list too");

console.log("\n--- Sam edits, pushes back, and Lee pulls ---");
await sam.p.click('[data-act="tab"][data-tab="items"]');
await sam.p.waitForTimeout(300);
await sam.p.evaluate(() => {
  [...document.querySelectorAll('[data-act="openItem"]')].find((e) => /Milk/.test(e.textContent)).click();
});
await sam.p.waitForTimeout(400);
// products start collapsed under an ingredient, so open the one being priced
await sam.p.evaluate(() => document.querySelector('.prodtitle[data-open="0"]').click());
await sam.p.waitForTimeout(400);
await sam.p.fill('[data-act="setProductPrice"]', "1.95");
await sam.p.evaluate(() => document.querySelector('[data-act="setProductPrice"]').blur());
await sam.p.waitForTimeout(500);
console.log("   " + (await push(sam.p)).slice(-60));

await lee.p.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
await lee.p.waitForTimeout(1500);
const l = await readDb(lee.p);
console.log("   Lee sees:", JSON.stringify(l, null, 1));
ok(l.milkPrice === 1.95, `Sam's price reached Lee (${l.milkPrice})`);
ok(!l.ingredients.includes("Beans"), "and the deletion did not bounce back off Sam's copy");
ok(l.meals.some((m) => /the good one/.test(m)), "Lee's own rename survived the round trip");
ok(l.day1[0] === "bol", "and so did the plan");

await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
