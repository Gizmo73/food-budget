/* Two phones, one shared file. Everything one person does has to reach the
   other: edits to meals, the fortnight's plan, and things thrown out. */
import {
  mergeSnapshots, migrate, markDeleted, newIngredient, newProduct, moveProduct,
  seed, SCHEMA_VERSION,
} from "../lib/store.js";

const fail = [];
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail.push(m); };
const at = (d) => `2026-08-${String(d).padStart(2, "0")}T10:00:00.000Z`;
const clone = (x) => JSON.parse(JSON.stringify(x));

function base() {
  const mk = (id, name, pname, price) => {
    const ing = newIngredient("Tesco", name);
    ing.id = id;
    ing.updatedAt = at(1);
    ing.products = [newProduct(pname, "Tesco", { pricePerPack: price, priceUpdated: "2026-08-01" })];
    return ing;
  };
  return migrate({
    schema: SCHEMA_VERSION,
    ingredients: [mk("milk", "Milk", "Semi skimmed", 1.45), mk("mince", "Mince", "500g", 3.5)],
    meals: [
      { id: "bol", name: "Bolognese", updatedAt: at(1), items: [{ ingredientId: "mince", portions: 2 }] },
      { id: "brew", name: "Tea", updatedAt: at(1), items: [{ ingredientId: "milk", portions: 1 }] },
    ],
    plan: Array.from({ length: 14 }, () => ({ breakfast: [null, null], lunch: [null, null], dinner: [null, null] })),
    people: ["Lee", "Sam"],
    planStart: "2026-08-03",
    planUpdatedAt: at(1),
    updatedAt: at(1),
  });
}

/* One person edits and pushes; the other pulls and merges. What they end up
   with is the whole question. */
const reaches = (edit) => {
  const lee = base();
  edit(lee);
  return mergeSnapshots(base(), lee).db;
};

console.log("--- what travels from one phone to the other ---");

let got = reaches((db) => {
  db.meals[0].name = "Bolognese (big)";
  db.meals[0].items = [{ ingredientId: "mince", portions: 4, productId: "", by: "portions", grams: 0 }];
  db.meals[0].updatedAt = at(5);
});
ok(got.meals.find((m) => m.id === "bol").name === "Bolognese (big)", "a meal you renamed reaches them");
ok(got.meals.find((m) => m.id === "bol").items[0].portions === 4, "and so do its new portions");

got = reaches((db) => db.meals.push({ id: "curry", name: "Curry", items: [], updatedAt: at(5) }));
ok(got.meals.some((m) => m.id === "curry"), "a meal you added reaches them");

got = reaches((db) => {
  db.ingredients[0].name = "Whole milk";
  db.ingredients[0].updatedAt = at(5);
});
ok(got.ingredients.find((i) => i.id === "milk").name === "Whole milk", "a renamed ingredient reaches them");

got = reaches((db) => {
  db.ingredients[0].products[0].pricePerPack = 1.9;
  db.ingredients[0].products[0].priceUpdated = "2026-08-05";
});
ok(got.ingredients.find((i) => i.id === "milk").products[0].pricePerPack === 1.9, "a new price reaches them");

console.log("\n--- the plan has its own clock ---");
{
  const lee = base();
  lee.plan[0].dinner = ["bol", "bol"];
  lee.planUpdatedAt = at(5);
  lee.updatedAt = at(5);

  // Sam has priced something since, which used to be enough to outrank it
  const sam = base();
  sam.ingredients[0].products[0].pricePerPack = 1.5;
  sam.updatedAt = at(6);

  const merged = mergeSnapshots(sam, lee).db;
  ok(merged.plan[0].dinner[0] === "bol", "a fortnight they planned reaches you even when you have edited a price");
  ok(merged.ingredients[0].products[0].pricePerPack === 1.5, "and your price survives it");
}
{
  // the other way: your plan is newer, so it stays
  const lee = base();
  lee.plan[0].lunch = ["brew", null];
  lee.planUpdatedAt = at(3);
  const sam = base();
  sam.plan[0].lunch = ["bol", null];
  sam.planUpdatedAt = at(7);
  const merged = mergeSnapshots(sam, lee).db;
  ok(merged.plan[0].lunch[0] === "bol", "the later plan wins, whichever phone it is on");
}
{
  const lee = base();
  lee.people = ["Lee", "Jo"];
  lee.planStart = "2026-08-17";
  lee.planUpdatedAt = at(5);
  const sam = base();
  sam.updatedAt = at(9);
  const merged = mergeSnapshots(sam, lee).db;
  ok(merged.people[1] === "Jo", "who the two of you are travels with the plan");
  ok(merged.planStart === "2026-08-17", "and so does when the fortnight starts");
}

console.log("\n--- things thrown out stay thrown out ---");
got = reaches((db) => {
  markDeleted(db, "ing", "mince");
  db.ingredients = db.ingredients.filter((i) => i.id !== "mince");
});
ok(!got.ingredients.some((i) => i.id === "mince"), "an ingredient they deleted does not come back");
ok(got.ingredients.some((i) => i.id === "milk"), "and the rest is untouched");

got = reaches((db) => {
  markDeleted(db, "meal", "brew");
  db.meals = db.meals.filter((m) => m.id !== "brew");
});
ok(!got.meals.some((m) => m.id === "brew"), "a meal they deleted does not come back");

{
  // and a deleted meal cannot be left sitting on somebody's plan
  const sam = base();
  sam.plan[2].dinner = ["brew", "brew"];
  sam.planUpdatedAt = at(9);
  const lee = base();
  markDeleted(lee, "meal", "brew");
  lee.meals = lee.meals.filter((m) => m.id !== "brew");
  const merged = mergeSnapshots(sam, lee).db;
  ok(merged.plan[2].dinner[0] === null, "and it is taken off the plan rather than left dangling");
}

{
  // one of several products, not the ingredient
  const lee = base();
  lee.ingredients[0].products.push(newProduct("Whole", "Asda", { pricePerPack: 1.6, priceUpdated: "2026-08-01" }));
  const sam = clone(lee);
  markDeleted(lee, "prod", "milk", lee.ingredients[0].products[1].id);
  lee.ingredients[0].products = [lee.ingredients[0].products[0]];
  lee.ingredients[0].updatedAt = at(5);
  const merged = mergeSnapshots(sam, lee).db;
  ok(merged.ingredients[0].products.length === 1, "one product of several, stopped buying, stays gone");
}

{
  // never leave an ingredient with nothing to buy, whatever the headstones say
  const lee = base();
  markDeleted(lee, "prod", "milk", lee.ingredients[0].products[0].id);
  const sam = base();
  const merged = mergeSnapshots(sam, lee).db;
  ok(merged.ingredients[0].products.length === 1, "an ingredient is never left with nothing to buy");
}

console.log("\n--- acting last wins ---");
{
  // they binned it on Tuesday, you edited it on Wednesday: you meant it
  const lee = base();
  markDeleted(lee, "ing", "mince");
  lee.deleted["ing:mince"] = at(5);
  lee.ingredients = lee.ingredients.filter((i) => i.id !== "mince");
  const sam = base();
  sam.ingredients[1].name = "Beef mince";
  sam.ingredients[1].updatedAt = at(6);
  const merged = mergeSnapshots(sam, lee).db;
  ok(merged.ingredients.some((i) => i.id === "mince"), "something you edited after they binned it is kept");
  ok(merged.ingredients.find((i) => i.id === "mince").name === "Beef mince", "with your edit on it");
}
{
  // and the other way round
  const lee = base();
  markDeleted(lee, "ing", "mince");
  lee.deleted["ing:mince"] = at(9);
  lee.ingredients = lee.ingredients.filter((i) => i.id !== "mince");
  const sam = base();
  sam.ingredients[1].name = "Beef mince";
  sam.ingredients[1].updatedAt = at(6);
  const merged = mergeSnapshots(sam, lee).db;
  ok(!merged.ingredients.some((i) => i.id === "mince"), "an edit older than the deletion does not save it");
}

console.log("\n--- a full round trip, both ways ---");
{
  // Lee deletes and renames; Sam merges, pushes; Lee merges Sam's file back
  let lee = base();
  markDeleted(lee, "meal", "brew");
  lee.meals = lee.meals.filter((m) => m.id !== "brew");
  lee.meals[0].name = "Bolognese (big)";
  lee.meals[0].updatedAt = at(5);
  lee.updatedAt = at(5);

  const sam = mergeSnapshots(base(), clone(lee)).db;
  ok(!sam.meals.some((m) => m.id === "brew"), "Sam's copy loses the deleted meal");
  ok(sam.deleted["meal:brew"], "and carries the headstone, so a third device learns of it too");

  lee = mergeSnapshots(lee, clone(sam)).db;
  ok(!lee.meals.some((m) => m.id === "brew"), "and it does not come back to Lee on the next pull");
  ok(lee.meals.find((m) => m.id === "bol").name === "Bolognese (big)", "the rename survives the round trip");

  // and again, to be sure it is stable rather than just slow to resurface
  const again = mergeSnapshots(lee, clone(sam)).db;
  ok(!again.meals.some((m) => m.id === "brew"), "and it is still gone after another round");
}

console.log("\n--- moving a product between ingredients ---");
{
  const lee = base();
  const done = moveProduct(lee, "milk", lee.ingredients[0].products[0].id, "mince");
  ok(!!done, "the move went through");
  ok(!!lee.deleted[`prod:milk:${done.product.id}`] || Object.keys(lee.deleted).length > 0,
    "and left a headstone where it used to be");
  const merged = mergeSnapshots(lee, base()).db;
  const milk = merged.ingredients.find((i) => i.id === "milk");
  ok(!milk, "the emptied ingredient does not reappear from the other phone");
  ok(merged.ingredients.find((i) => i.id === "mince").products.length === 2,
    "and it is where it was moved to, once");
}

console.log("\n--- old data still loads ---");
{
  const old = {
    schema: 7,
    ingredients: [{ id: "milk", name: "Milk", products: [{ id: "a", name: "Semi", store: "Tesco", pricePerPack: 1.4 }] }],
    meals: [{ id: "brew", name: "Tea", items: [{ ingredientId: "milk", portions: 1 }] }],
    plan: [], people: ["Lee", "Sam"], planStart: "", updatedAt: at(1),
  };
  const up = migrate(old);
  ok(up.schema === SCHEMA_VERSION, `migrates to ${up.schema}`);
  ok(up.meals[0].updatedAt === "", "a meal from before this has no stamp, so any edit outranks it");
  ok(up.planUpdatedAt === at(1), "the plan inherits the snapshot's own time rather than starting blank");
  ok(JSON.stringify(up.deleted) === "{}", "and nothing is marked deleted");
  ok(JSON.stringify(migrate(clone(up))) === JSON.stringify(up), "migrating twice is identical");

  // two devices on the old data, neither having edited anything
  const merged = mergeSnapshots(clone(up), clone(up)).db;
  ok(merged.meals.length === 1 && merged.ingredients.length === 1, "and merging it with itself changes nothing");
}

console.log("\n--- a phone that has not started yet ---");
{
  const fresh = seed();
  ok(fresh.demo === true, "a new install is marked as the demo list");
  const shared = base();
  const merged = mergeSnapshots(fresh, shared).db;
  ok(merged.ingredients.length === shared.ingredients.length,
    `joining takes the shared list whole (${merged.ingredients.length} items)`);
  ok(!merged.ingredients.some((i) => i.name === "Pies"),
    "and does not push the demo items onto the other person's list");
  ok(!merged.meals.some((m) => m.name === "Pie and Mash"), "nor the demo meals");
  ok(merged.demo === false, "and the joined list is no longer marked demo");

  // once they have edited anything of their own, it is theirs and is kept
  const started = seed();
  started.demo = false;
  started.updatedAt = at(4);
  const both = mergeSnapshots(started, shared).db;
  ok(both.ingredients.length > shared.ingredients.length,
    "a list they had actually started is merged rather than thrown away");
}

console.log(fail.length ? `\n${fail.length} FAILED` : "\nall passed");
process.exit(fail.length ? 1 : 0);
