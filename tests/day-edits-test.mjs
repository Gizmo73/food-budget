/* Editing a meal on the fly, for one day only.

   The case from the ask: Pie and Mash is planned, but on one day you want new
   potatoes instead of the usual mash. Rather than fork a whole new meal, the
   day carries a loose override — the swapped items live on the day, the shared
   meal is untouched — and the shopping list is worked out against those. A
   per-person "extras" list does the same for single things eaten outside any
   meal. */
import { newProduct, newIngredient, migrate, mergeSnapshots } from "../lib/store.js";
import { computeShopping, dayOverride, planItems, dayExtras } from "../lib/calc.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const near = (a, b, t = 0.001) => Math.abs(a - b) <= t;

const ing = (id, name, price, pp) => {
  const i = newIngredient("Tesco", name);
  i.id = id;
  i.products = [
    newProduct(name, "Tesco", {
      id: `${id}-p`, pricePerPack: price, portionsPerPack: pp,
      priceUpdated: "2026-08-01T10:00:00Z", portionBy: "weight", portionGrams: 100, kcal100: 90,
    }),
  ];
  return i;
};

const emptyPlan = () =>
  Array.from({ length: 14 }, () => ({
    breakfast: [null, null], lunch: [null, null], dinner: [null, null],
  }));

// Pie and Mash = beef + potato. New potatoes are their own ingredient.
const base = () => ({
  schema: 7,
  budget: 60,
  ingredients: [
    ing("beef", "Beef", 3.0, 4),
    ing("potato", "Potato", 1.0, 8),
    ing("newpot", "New Potatoes", 1.6, 8),
    ing("apple", "Apple", 0.3, 3),
  ],
  meals: [
    {
      id: "pm", name: "Pie and Mash",
      items: [
        { ingredientId: "beef", productId: "", portions: 1 },
        { ingredientId: "potato", productId: "", portions: 1 },
      ],
    },
  ],
  plan: emptyPlan(),
  people: ["Lee", "Sam"],
  planStart: "",
});

console.log("--- the plain plan asks for what the meal says ---");
let raw = base();
raw.plan[0].dinner = ["pm", null];
let db = migrate(raw);
let c = computeShopping(db);
ok(near(c.need.potato, 1), `Pie and Mash puts a portion of potato on the list (${c.need.potato})`);
ok(near(c.need.beef, 1), "and a portion of beef");
ok(!c.need.newpot, "and nothing of new potatoes");

console.log("\n--- swap the mash for new potatoes, this day only ---");
raw = base();
raw.plan[0].dinner = ["pm", null];
raw.plan[0].edits = {
  dinner: [
    {
      name: "Pie and Mash",
      items: [
        { ingredientId: "beef", portions: 1 },
        { ingredientId: "newpot", portions: 1 },
      ],
    },
    null,
  ],
};
db = migrate(raw);
c = computeShopping(db);
ok(near(c.need.newpot, 1), `the day now asks for new potatoes (${c.need.newpot})`);
ok(!c.need.potato, "and no longer for ordinary potato");
ok(near(c.need.beef, 1), "the beef is untouched");
ok(db.meals[0].items.some((it) => it.ingredientId === "potato"),
  "and the shared Pie and Mash still lists potato — nothing else using it changed");
ok(!!dayOverride(db.plan[0], "dinner", 0), "the day holds a loose override");
ok(planItems(db.plan[0], "dinner", 0, { pm: db.meals[0] }).some((it) => it.ingredientId === "newpot"),
  "which is what the day reads back as its dinner");

console.log("\n--- an extra, logged against one person ---");
raw = base();
raw.plan[0].dinner = ["pm", null];
raw.plan[0].extras = [[{ ingredientId: "apple", portions: 2 }], []];
db = migrate(raw);
c = computeShopping(db);
ok(near(c.need.apple, 2), `two apples land on the list from the extra (${c.need.apple})`);
ok(dayExtras(db.plan[0], 0).length === 1 && dayExtras(db.plan[0], 1).length === 0,
  "the extra sits under the first person only");
ok(c.dayMeals[0][0] > 0, "so their day counts as one they ate on");
ok(c.dayNutrition[0][0].kcal > 0, "and the apple feeds their calories for the day");
ok(near(c.dayNutrition[0][1].kcal, 0), "the other person got none of it");

console.log("\n--- a loose edit survives a save and reload ---");
raw = base();
raw.plan[0].dinner = ["pm", null];
raw.plan[0].edits = { dinner: [{ name: "Pie and Mash", items: [{ ingredientId: "newpot", portions: 1 }] }, null] };
raw.plan[0].extras = [[{ ingredientId: "apple", portions: 2 }], []];
db = migrate(raw);
const reloaded = migrate(JSON.parse(JSON.stringify(db)));
ok(dayOverride(reloaded.plan[0], "dinner", 0), "the override is still there after a reload");
ok(reloaded.plan[0].edits.dinner[0].items[0].ingredientId === "newpot", "with its swapped item");
ok(dayExtras(reloaded.plan[0], 0).length === 1, "and the extra survived too");
ok(!reloaded.plan[1].edits && !reloaded.plan[1].extras, "an untouched day stays plain, with no edits or extras");

console.log("\n--- two phones: the newer plan brings its edits ---");
const a = migrate(base());
a.plan[0].dinner = ["pm", null];
a.planUpdatedAt = "2026-08-10T09:00:00Z";
const bb = migrate(base());
bb.plan[0].dinner = ["pm", null];
bb.plan[0].edits = { dinner: [{ name: "Pie and Mash", items: [{ ingredientId: "newpot", portions: 1 }] }, null] };
bb.planUpdatedAt = "2026-08-11T09:00:00Z"; // newer
const merged = mergeSnapshots(a, bb).db;
ok(!!dayOverride(merged.plan[0], "dinner", 0), "the phone with the later plan wins, edit and all");
const mc = computeShopping(merged);
ok(near(mc.need.newpot, 1) && !mc.need.potato, "and the merged list follows the swap");

// the other way round, the plan without the edit wins and the swap is dropped
const merged2 = mergeSnapshots(bb, { ...a, planUpdatedAt: "2026-08-12T09:00:00Z" }).db;
ok(!dayOverride(merged2.plan[0], "dinner", 0), "a later plain plan drops a stale edit");

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
