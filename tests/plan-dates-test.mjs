/* A meal is planned for a day, not for a position in a list.

   The plan is stored by position and the start date turns position into a
   date, so moving the start used to move every meal with it: a fortnight
   beginning Monday with something planned for Wednesday, restarted a day
   later, served that meal on Thursday without a word. */
import { shiftPlan, daysBetween, SLOTS } from "../lib/store.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };

const blank = () => ({ breakfast: [null, null], lunch: [null, null], dinner: [null, null] });
const make = () => Array.from({ length: 14 }, blank);

/* What is on the plan, by the date it actually falls on, which is the only
   thing a person cares about. */
const dated = (plan, start) => {
  const out = {};
  const at = new Date(`${start}T12:00:00`).getTime();
  plan.forEach((day, i) => {
    const date = new Date(at + i * 86400000).toISOString().slice(0, 10);
    for (const s of SLOTS) {
      for (const id of day[s.key]) if (id) (out[date] ||= []).push(`${s.key}:${id}`);
    }
  });
  return out;
};

console.log("--- counting days ---");
ok(daysBetween("2026-08-03", "2026-08-04") === 1, "one day on");
ok(daysBetween("2026-08-04", "2026-08-03") === -1, "one day back");
ok(daysBetween("2026-08-03", "2026-08-03") === 0, "the same day is no move");
ok(daysBetween("2026-08-03", "2026-08-17") === 14, "a fortnight is fourteen");
// the clock goes back on the last Sunday of October, and a day is still a day
ok(daysBetween("2026-10-24", "2026-10-26") === 2, "across the end of British Summer Time");
ok(daysBetween("2026-03-28", "2026-03-30") === 2, "and across the start of it");
ok(daysBetween("", "2026-08-04") === 0, "a missing date is no move");
ok(daysBetween("2026-08-03", "rubbish") === 0, "and so is nonsense");

console.log("\n--- a meal keeps its date ---");
{
  // Monday the 3rd, with dinner planned for Wednesday the 5th
  const plan = make();
  plan[2].dinner = ["bol", "bol"];
  plan[0].breakfast = ["fry", null];
  const before = dated(plan, "2026-08-03");

  // started a day later: Tuesday the 4th
  const { plan: after, lost } = shiftPlan(plan, daysBetween("2026-08-03", "2026-08-04"));
  const now = dated(after, "2026-08-04");

  console.log("   before:", JSON.stringify(before));
  console.log("   after: ", JSON.stringify(now), `lost ${lost}`);
  ok(now["2026-08-05"] && now["2026-08-05"].includes("dinner:bol"),
    "Wednesday's dinner is still on Wednesday");
  ok(after[1].dinner[0] === "bol", "which is one place earlier in the plan");
  ok(lost === 1, `the day before the new start fell outside, and was counted (${lost})`);
  ok(!now["2026-08-03"], "so Monday's breakfast is gone, since Monday is no longer in it");
}

console.log("\n--- and moving the other way ---");
{
  const plan = make();
  plan[2].dinner = ["bol", null];
  const { plan: after, lost } = shiftPlan(plan, daysBetween("2026-08-04", "2026-08-03"));
  ok(after[3].dinner[0] === "bol", "starting a day earlier slides the plan one place later");
  ok(lost === 0, "and nothing was lost, since there was room");
  ok(JSON.stringify(dated(after, "2026-08-03")["2026-08-06"]) === JSON.stringify(["dinner:bol"]),
    "the meal is on the same date it was");
}

console.log("\n--- nothing silly happens at the edges ---");
{
  const plan = make();
  plan[0].dinner = ["a", null];
  plan[13].dinner = ["b", null];
  const { plan: after, lost } = shiftPlan(plan, 0);
  ok(after === plan && lost === 0, "no move leaves the plan exactly as it was");

  const far = shiftPlan(plan, 20);
  ok(far.lost === 2, `moving further than the fortnight loses everything on it (${far.lost})`);
  ok(far.plan.every((d) => SLOTS.every((s) => d[s.key].every((x) => x === null))),
    "and leaves an empty fortnight rather than a broken one");

  const back = shiftPlan(plan, -13);
  ok(back.plan[13].dinner[0] === "a", "the first day can slide to the last");
  ok(back.lost === 1, "and the last one falls off");
}

console.log("\n--- the shape survives ---");
{
  const plan = make();
  plan[5].lunch = ["x", "y"];
  const { plan: after } = shiftPlan(plan, 2);
  ok(after.length === 14, "still fourteen days");
  ok(after.every((d) => SLOTS.every((s) => Array.isArray(d[s.key]) && d[s.key].length === 2)),
    "every day still has three slots holding two people");
  ok(after[3].lunch[0] === "x" && after[3].lunch[1] === "y", "both people moved together");
}

console.log("\n--- and through the app's own date box ---");
{
  const { browser, BASE } = await import("./browser.mjs");
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { console.log("  pageerror: " + e.message); fail.push("pageerror"); });

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
    plan[2].dinner = ["bol", "bol"];      // Wednesday, if the start is Monday
    plan[0].breakfast = ["fry", null];    // the Monday itself
    await store.saveDb(store.migrate({
      schema: 8,
      ingredients: [mk("mince", "Mince"), mk("eggs", "Eggs")],
      meals: [
        { id: "bol", name: "Bolognese", updatedAt: "", items: [{ ingredientId: "mince", portions: 1 }] },
        { id: "fry", name: "Fry Up", updatedAt: "", items: [{ ingredientId: "eggs", portions: 2 }] },
      ],
      plan, people: ["Lee", "Sam"], planStart: "2026-08-03",
    }));
    location.reload();
  });
  await p.waitForFunction(() => document.getElementById("app").dataset.booted === "1", null, { timeout: 15000 });
  await p.waitForTimeout(300);

  await p.click('[data-act="tab"][data-tab="plan"]');
  await p.waitForTimeout(400);

  /* What the screen says, read off the day headings rather than the store, so
     this is testing what a person actually sees. */
  const onScreen = async () =>
    p.$$eval(".dayblock", (els) =>
      els.map((e) => ({
        day: e.querySelector(".dname").textContent.replace(/\s+/g, " ").trim(),
        meals: [...e.querySelectorAll("select")]
          .map((s) => s.options[s.selectedIndex].textContent.trim())
          .filter((t) => t && t !== "\u2014"),
      })).filter((d) => d.meals.length));

  const before = await onScreen();
  console.log("   before:", JSON.stringify(before));
  ok(before.some((d) => /Wednesday 5 Aug/.test(d.day) && d.meals.includes("Bolognese")),
    "Bolognese is on Wednesday 5 August to start with");

  // nudge the start on by one day
  await p.evaluate(() => {
    const box = document.querySelector('[data-act="setPlanStart"]');
    box.value = "2026-08-04";
    box.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await p.waitForTimeout(600);

  const after = await onScreen();
  const said = await p.evaluate(() => {
    const el = document.querySelector(".ok, .err");
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  });
  console.log("   after: ", JSON.stringify(after));
  console.log("   said:  ", JSON.stringify(said));

  ok(after.some((d) => /Wednesday 5 Aug/.test(d.day) && d.meals.includes("Bolognese")),
    "and is still on Wednesday 5 August after the start moves to the 4th");
  ok(!after.some((d) => /Thursday 6 Aug/.test(d.day) && d.meals.includes("Bolognese")),
    "rather than sliding onto the Thursday");
  ok(!after.some((d) => d.meals.includes("Fry Up")),
    "the Monday breakfast is gone, since Monday is no longer in the fortnight");
  ok(/1 planned meal that now falls outside/.test(said), `and it says so, in English (${said})`);

  // and the stored plan agrees with the screen
  const stored = await p.evaluate(async () => {
    const store = await import("./lib/store.js");
    const db = await store.loadDb();
    return { start: db.planStart, day1: db.plan[1].dinner, day0: db.plan[0] };
  });
  ok(stored.start === "2026-08-04", `the start is stored (${stored.start})`);
  ok(stored.day1[0] === "bol", "and the meal moved one place earlier in the plan");

  // moving it back should put things where they were, minus what fell off
  await p.evaluate(() => {
    const box = document.querySelector('[data-act="setPlanStart"]');
    box.value = "2026-08-03";
    box.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await p.waitForTimeout(600);
  const back = await onScreen();
  console.log("   back:  ", JSON.stringify(back));
  ok(back.some((d) => /Wednesday 5 Aug/.test(d.day) && d.meals.includes("Bolognese")),
    "moving the start back leaves it on Wednesday still");

  await b.close();
}

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
