# Code review and UX plan

Reviewed 2026-10-06 against `main` at 5411b95. Everything here was read in the
code, then checked on screen: the fixture list at 390px, dark theme, every tab
plus the day sheet and Settings. Suite was 35/35 green before any change.

Sections: [Summary](#summary) · [A journey, start to finish](#a-journey-start-to-finish) ·
[Findings](#findings) · [Other apps](#other-apps) · [Plan](#plan) ·
[Decisions I want challenged](#decisions-i-want-challenged) · [Status](#status)

## Summary

The engine is good: portions, pooled stock, per-shop prices and the merge rules
are careful and well tested. The weakness is the surface. Features were added
one at a time, each with its own control, its own explanatory paragraph and its
own spelling of the same idea, so the app reads as a set of tools rather than
one flow. The three biggest symptoms:

1. **Two vocabularies for time.** The data is a fixed 14-day window and the last
   redesign made the Plan screen step a week at a time, but rollover, clear,
   repeat and half the labels still say "fortnight". You talk about weeks.
2. **Two ways to put something on the shopping list.** A real item (pack, price,
   stock) can only be added from the Items tab; a hand-written line can be added
   from the List tab, once under every shop. They are different things that look
   the same on the list and are added in different places.
3. **Editing is the default view.** The day sheet, the meal editor and the item
   editor open straight onto dropdowns, steppers and a paragraph of explanation
   per row. Picking is the common job and editing the rare one.

## A journey, start to finish

What someone actually does, and where it snags. Numbers are screen-heights on a
820px phone.

| Step | What happens now | Snag |
|---|---|---|
| **First open** | Opens on a demo list of 11 Tesco items and 3 meals. | No setup: names say "Person 1/2", budget is £60 and lives in the List footer. The first edit silently turns the demo into your list. |
| **Add what you buy** | Receipt, scan, or Items → *Add an item*. | Three routes, each ending in a different editor. A new item is *Unassigned* until you give a product a shop. |
| **Write meals** | Meals → *Write in a meal*, then one native `<select>` per ingredient. | A 40-option native dropdown per line, no search, and every line carries a paragraph restating the pooling rule. |
| **Plan the week** | Plan → set a start date (must be a Saturday, not enforced) → open each day → six dropdowns. | The setup card (names, start date) is the first thing on the screen you use daily. *Write a meal in* and *Swap* are repeated on all seven rows. |
| **Check the list** | List tab. | The first screen is five buttons and a banner; the total and the budget are **below the last item**, so the one number you want is a long scroll away. |
| **Add a loose item** | *+ Add something by hand* under a shop. | Free text only. To add "Milk" the real item you must leave for Items, find it, and tap a thin **+**. |
| **Shop** | **Got it** per line. | No undo. Tapping the wrong line turns a pack into stock. |
| **Week ends** | Past meals keep adding to the list. Start the next fortnight is at the very bottom of Plan, under *Clear both weeks*. | You delete last week's meals by hand, or roll over the lot. There is no "move on a week". |

## Findings

### Bugs and correctness

| | Where | What |
|---|---|---|
| B1 | `app.js` `delMeal` | Compares `next[slot.key] === id`, but since v6 a slot is `[id, id]`, so it never matches. Deleting a meal leaves dead ids on the plan until a sync merge scrubs them, despite the prompt promising planned days "will empty". No test covered it. |
| B2 | `lib/calc.js` `today()` | Uses the UTC date. Between 00:00 and 01:00 British Summer Time it returns yesterday. It dates receipts and seeds the rollover, and it matters more once the list depends on "today". |
| B3 | `app.js` `fillSlot` | "Repeat breakfast" copies day index 0 of the fortnight, not the visible week, and is labelled *Fill the fortnight*. Day 0 may now be in the past. |
| B4 | seed, `migrate`, `clearPlan` | `14` is typed three times for the plan length. The rest of the code reads `plan.length`. |
| B5 | Plan card | Labelled "starts (a Saturday)"; nothing checks it. Type a Wednesday and the week pager is Wednesday to Tuesday under a label that says otherwise. |
| B6 | List total | The budget bar compares *what is left to buy* with the weekly budget. Fine when the list covers the week, misleading once it covers only the days remaining (see decisions). |
| B8 | `lib/store.js` `storeNames` | Still read the old `sources` field, so it returned `[]` for every list. The shop suggestions on the Items tab and the scan sheet were empty, and a typed shop name could never fold onto the spelling already in your data, which the README promises. Found while building the add sheet, which needs the list. |
| B9 | `manifest.webmanifest` | The description still says "Test build: one ingredient, several shops. Separate data from the live app." It is what an install prompt shows. |
| B7 | Native `prompt()` ×4 and `confirm()` ×6 | A new shop name, "what are you eating", a meal name, and every destructive confirm. Native dialogs break the app's look, show the page URL in some browsers and are suppressed after repeats in Safari. |

### Redundancy and dead code

- **Ten unused imports** in `app.js`: `slug`, `itemPortionCost`, `anyOfferExpired`,
  `stockPacks`, `cheaperThan`, `itemNutrition`, `nutritionUsable`, `scanSupported`,
  `decoderKind`, `decodeStill`.
- **Dead code**: `knownShops` in `viewList` is computed and never read; the
  `setProductField` and `selectInvite` actions are never wired; `.leader`,
  `.track` and `.sliding` in the CSS match nothing; `rowStock`, `rowPackPortions`,
  `refreshRows` and `receiptStockRow` take a `store` argument they ignore;
  `productCard` takes `stores` and ignores it.
- **The item editor is written twice.** `viewMeals` (the meal's rows) and
  `dayItemRow` (the day sheet's rows) are near-copies of about 70 lines, plus their
  own `picker`/`which` closures beside `ingPickerOptions`/`productPickerOptions`.
  The "which product" `<option>` list is built five times (meal, day, receipt,
  scan, product-card).
- **Dates**: `DAYS` and `WEEKDAYS` both exist; `toLocaleDateString("en-GB", …)` is
  spelled six times.
- **Constants**: `NUTRIENTS` and `PER100` are defined in both `calc.js` and
  `store.js`.
- **206 inline `style="…"` attributes** in `app.js`. Spacing is decided in
  template strings, so the same gap is typed as 4, 6, 8, 10 and 12px depending on
  who wrote that block. This is the root of the "slightly off" feel more than
  any single screen.
- **README** is 577 lines. *One ingredient, several shops* describes the older
  "sources" model that *Ingredients, and the products under them* replaced, and
  both are still in. Many sections still say fortnight, yellow accent, "about 80
  seconds" (it is 135).

### Comments

About 11% of `app.js` and a quarter of `calc.js` and `store.js` is comment, which
is fine in principle. The trouble is the kind. Many are a bug's biography
("this used to…", "was the wrong way round", "the first correction can be cut
short") that was useful the day it was written and is noise a year on. The
worst are out of proportion: a 12-line block above the 6-line `shell()`, and the
openStocktake/openRollover comments, which sit on the wrong function. Rule going
forward: a comment says why the code is shaped this way *now*; the history is in
`git log`.

### Tacked on, and the visual jolts

1. **Hand-written lines vs real items** (List tab). Two concepts, one visual,
   added in different places. The "Add something by hand" button repeated under
   every shop and again under an always-visible empty *No shop yet* group. The
   shop was chosen afterwards with chips plus a `prompt()` for a new one.
   *Addressed in Phase 0; the chips and `prompt()` remain for lines filed later.*
2. **Three kinds of "+"** on the Items tab: the thin header **+**, the *Any of it,
   by hand* stepper, and one stepper per product. Putting something on the
   shopping list from the Items tab is the afterthought; the List tab should own
   it.
3. **The List's first screen** is Receipt, Scan, Stock check (full width) and a
   banner. The stock check is a once-a-week job holding prime space and nagging
   ("25 to count"). The list itself starts below the fold.
4. **Red dots**: every row of the demo list carries the stale-price dot, because
   all 15 prices are old. A signal that is always on is no signal; the banner
   already says it.
5. **Day sheet**: each item is about 230px tall (ingredient, remove, Portions/g
   switch, amount, product picker, then a paragraph). Two people × three slots
   is several screens of that. Meanwhile the six meal pickers you came for are
   buried in it. The Portions/g switch is cramped enough to look broken.
6. **Plan**: setup chrome on top; seven rows each repeating *Write a meal in* and
   *Swap*; then Fill, Start next fortnight and **Clear both weeks** stacked in a
   column, so a destructive button sits beside a routine one.
7. **Button language**: `.btn.solid` is an outline, `.tonal` is a fill, `.ghost` is
   text; the List's three header actions use all three, and 47 buttons are
   `small` at 36px, under the 44px a thumb needs. The pager (five bars) repeats
   what the tab bar already says and costs about 20px of height on every screen.
8. **Settings** gives accent colour (seven swatches, a colour input and a
   paragraph) more room than syncing, and is one long scroll rather than three
   groups.
9. **Words**: *item*, *ingredient*, *product*, *kind of thing*, *what to buy*, *any
   of it*. To add milk a person must learn a three-level model. The model is
   right; the labels leak it.
10. **Food** is a fifth tab that shows the Plan's weeks again with calories. It is
    a view of the plan, not a place.

## Other apps

Web fetches were blocked in this environment, so this rests on search-result
summaries rather than hands-on use. Treat it as direction, not a teardown.

| App | Worth borrowing | Applies here |
|---|---|---|
| [Plan to Eat](https://learn.plantoeat.com/help/change-your-shopping-list-date-range) | The shopping list is built from a **date range** with presets: today, next 7 days, current week, custom. Stores are remembered per item. | Direct support for "today or later". A range chip on the List, defaulting to *today onward*, with *whole plan* as the other option. |
| [Mealime](https://expertbeacon.com/mealime-review/) | The list is the product: consolidated, grouped, then nothing else competes with it. | The List first screen should be the list. |
| [Paprika](https://apps.apple.com/ae/app/id1303222868) | Daily/weekly/monthly calendar; **save a week as a reusable menu**; move items between pantry and list. | "Start a new week" as *copy last week* or *a saved menu*, not only *keep everything or nothing*. |
| [AnyList](https://www.anylist.com) | Shared list with recipes feeding it. | Already matched by sync; add-from-meal is a possible later step. |
| [Listonic](https://listonic.com/compare-apps/listonic-vs-bring) and Bring! | Type-ahead from your own history, one-tap frequent items. | The new add sheet. A "frequent" strip is a later step, once there is a history to rank by. |
| Eat This Much | Calorie and macro **targets** per day. | Food shows actuals only. A target line per person would give the numbers somewhere to land. |
| [Trolley](https://thegrocer.co.uk/news/go-compare-launches-deal-finder-desktop-supermarket-app/545612.article) and similar | Compares one basket across supermarkets. | This app already holds per-shop prices for the same item. *This list at Aldi would be £x* needs no scraping. |

## Plan

Each phase is shippable on its own and leaves the suite green. Order is by how
much of the felt clunkiness it removes per line changed.

### Phase 0, done in this change

- **The list counts today onward.** Days before today stay on the plan, their
  costs and calories stay on Plan and Food, but they add nothing to the shopping
  list, stock check, or "needs" figures. Without a start date nothing can be
  dated, so everything counts as before.
- **Add from the List tab with a fuzzy search.** One *Add* button replaces the
  per-shop buttons. It opens a search over your real items (the same matcher as
  the Items tab); tap one to put a pack on the list. Below the results: a free-text
  line with a shop chooser for things that are not items, and a new shop typed in
  place rather than via `prompt()`.
- **Back button.** In the installed app, back closes the camera, then a sheet,
  then returns to the List, and is otherwise absorbed. Not applied in a normal
  browser tab.
- Fixed B1 (`delMeal`), B2 (UTC `today()`) and B8 (`storeNames`). Removed the ten
  unused imports, `knownShops`, the never-wired `setProductField` action and the
  dead CSS, and moved the misplaced comments. The unused parameters are left for
  Phase 1, since they run through the receipt code and are not worth a noisy diff
  here. B9 is left too: it is one line and wants your wording.
- The eight tests that failed once past days stopped counting did so because their
  plan starts on a fixed August day and the clock had moved on. They now pin the
  browser clock (`pinClock` in `tests/browser.mjs`), which also stops them
  depending on the date they happen to be run on.

### Phase 1, foundations (no visible change)

1. One **item-line editor** used by the meal editor and the day sheet.
2. One **ingredient picker** (fuzzy, as the add sheet) replacing the native
   `<select>` in meal lines, day lines, receipt targets and scan targets.
3. One **dialog**: an in-app ask/confirm sheet replacing all `prompt()` and
   `confirm()`.
4. **Spacing utilities** (`.stack`, `.gap-*`, `.mb-*`) replacing the 206 inline
   styles, and one `fmtDate`.
5. README rewritten to one model. Comment pass per the rule above.

### Phase 2, weeks

1. **A rolling window.** Today is marked, past days are dimmed and folded under
   "Earlier this week".
2. **Move on a week** replaces *Start the next fortnight* as the primary action:
   shift the start by 7 days (`shiftPlan` already does the sliding), so the second
   week becomes the first and a new empty week appears. *Copy last week* as the
   option on the empty one. The date-picked rollover stays as a fallback in the
   sheet.
3. Setup (names, start date) moves behind a *Plan settings* row. *Write a meal
   in* and *Swap* move into the day sheet. *Clear* moves out of the routine column.
4. Day sheet opens on the six meal pickers; item tweaks sit behind *Tweak items*
   per slot, collapsed.
5. Labels say *week*; the 14 is derived from one constant; the Saturday rule is
   either enforced or dropped from the label.

### Phase 3, the List tab

1. A **sticky total and budget** so the number you came for is always visible.
2. The first screen is the list: Receipt, Scan and Stock check become one row of
   quiet actions beneath it, or an overflow, and the stock check only asks on the
   first day of a new week.
3. **Range chip**: *Today onward* (default), *Next 7 days*, *Whole plan*.
4. **Undo** after *Got it*. Stale dot only where it is the exception.
5. Drop the per-product "+" stepper clutter from the Items tab now the List owns
   adding.

### Phase 4, navigation and words

1. Fold **Food** into Plan (a calories line under each day and a *Nutrition*
   toggle), taking the bar to four tabs and dropping the pager.
2. Settings in three groups: Sync, Appearance, About.
3. Pick one word for each level of the model and use it everywhere.
4. A first-run step for names, budget and shops, so the demo is a choice rather
   than a trap.

### Phase 5, borrowed ideas

Saved menus, a cheapest-shop basket comparison, calorie targets, frequent items
in the add sheet.

## Decisions I want challenged

1. **Today onward changes what the budget bar means.** It used to say "this
   plan costs £x of £60". It now says "what is left to buy costs £x of £60", so
   mid-week it reads as headroom the week has already spent. If the budget is a
   weekly cap, the honest figure is *spent so far + still to buy*, and that needs
   somewhere to record what was spent (receipts have it).
2. **Stock is never taken out, so the list can under-buy.** Nothing decrements
   stock as meals pass. Counting every day used to offset that by accident:
   total need minus total ever bought. Counting only the days left removes the
   offset, so stock bought on Saturday and eaten by Tuesday still reduces what
   Wednesday's list buys. This is exactly what already happens when you delete
   last week's meals by hand, so it is no worse than your current routine, but it
   is a real limit. The stock check is the existing remedy; the alternative is
   treating a day's meals as eaten when the day passes, which has merge costs.
3. **Disabling back is a trade.** Browsers offer no way to disable it, only to
   add history entries and answer when they are popped. In an installed app on
   Android, back is also the exit gesture, so absorbing it at the root removes
   the quickest way out (Home still works). Closing layers first is the part that
   helps; I have limited the trap to the installed app. I could not reproduce
   "the page breaks", so please tell me what you see: a blank page, the previous
   screen, or the app closing.
4. **Is the add sheet the right shape?** I have made it a bottom sheet with the
   search focused. The alternative is a search row pinned at the top of the List.
   The sheet is quieter when you are not adding; the pinned row is one tap
   fewer when you are.
5. **Four tabs or five?** Folding Food into Plan removes a destination but makes
   the Plan denser, which is the screen already carrying the most. It is worth
   doing only after Phase 2 has thinned the Plan.

## Status

| Item | State |
|---|---|
| Today onward | Done. `today-onward-test`; eight older tests pinned to a clock |
| Fuzzy add from List | Done. `list-add-test`; the two jotting tests rewritten for the new way in |
| Back button | Done. `back-button-test`, which fails with the guard removed |
| B1, B2, B8 | Done. `meal-delete-test` covers B1; the add sheet's shop chips exercise B8 |
| Dead code | Done, except unused parameters |
| Phase 1 onwards | Not started, waiting on your steer on the decisions above |
