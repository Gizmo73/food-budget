# Code review and UX plan

Reviewed 2026-10-06 against `main` at 5411b95. Everything here was read in the
code, then checked on screen: the fixture list at 390px, dark theme, every tab
plus the day sheet and Settings. Suite was 35/35 green before any change.

How the app should end up looking and working is in [VISION.md](VISION.md).

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

Read on 2026-10-06 from each vendor's own pages, fetched with `curl` once the
network was opened (the WebFetch tool kept reporting the hosts as blocked, so
these were read as text by hand). Vendor pages describe themselves favourably,
so treat claims about results as marketing and the described *features* as fact.
Still unreachable: `docs.mealie.io`, `chromium.googlesource.com`; and the Material
bottom-sheet page is built by script and returned no text.

| App | What the page says it does | What it means here |
|---|---|---|
| [Plan to Eat](https://learn.plantoeat.com/help/change-your-shopping-list-date-range) | The shopping list follows a **date range**, defaulting to the next 7 days, with *today*, *next 2 weeks*, *current week* (from the planner's **start-day setting**) and a custom range. | Direct support for "today onward", and for the week start being a setting rather than a rule. For you the range is always *today to Friday*, so no range control is needed. |
| [Mealime](https://support.mealime.com/article/151-getting-started-guide) | Lands on the meal plan; starting the next plan is one button (*Start Your Next Meal Plan*). The list groups by store department, and extra items are added **in a text box at the top of the list**. Supports planning a week ahead or day by day. | Same shape as the add bar. "Start your next plan" is the model for *Move on a week*: one obvious button at the moment it is needed. |
| [AnyList](https://www.anylist.com/features) | **Autocomplete** and automatic categories; **Favorites** as a master list; **recently used** items to build a list; categories matched to the local store; **prices on items to stick to a budget** (paid tier). | Confirms the add sheet. Recently used and favourites are the next step for it once the app has a history to rank by. |
| [Listonic](https://listonic.com/compare-apps/listonic-vs-bring) | Saved item prices and a **running total at the point of shopping**; compares itself with Bring!, which it says has no price tracking. Suggestions from past use. | The in-shop running total is the part to copy: *in the trolley £x, still to get £y*. |
| [Paprika](https://paprikaapp.com/) | Lists sorted by aisle with similar items combined; several lists; custom aisles; cloud sync of recipes, lists and plans. | Nothing new beyond what the app has. Its pantry and saved menus remain the idea worth borrowing. |
| [Eat This Much](https://www.eatthismuch.com/) | Daily calorie and macro **targets**; a virtual **pantry** that the plan uses up first; grocery list updates as the plan changes. | Targets are a later option on the Plan's nutrition line. The pantry idea is what your stock check already is. |
| Trolley and similar price sites | One basket compared across supermarkets (from search summaries only; the site itself was blocked). | The app already holds per-shop prices, so *this list at Aldi would be £x* needs no scraping. |

Two things from outside the apps changed the plan:

- **Confirm or undo** ([Nielsen Norman Group](https://www.nngroup.com/articles/confirmation-dialog/)):
  confirmation dialogs belong on serious or irreversible actions and should name
  what will happen; routine actions should not have them, because people learn to
  click through; and an undo should be offered wherever it can be. So routine
  actions (*Got it*, removing a pack) get an undo toast, and the few truly
  destructive ones (delete an item or meal, reset) get a specific in-app
  confirmation, not the browser's.
- **Back button** (Chromium's history manipulation intervention, from search
  summaries of its design doc): an entry a page adds without any user tap can be
  skipped by the back button, but a page that has received a tap at any point has
  its entries treated as ordinary. The guard adds its entry on load, so it behaves
  as intended once you have tapped anything, which you will have. Only a back
  gesture before touching the app at all could still slip past it.

## Plan

Phase 0 shipped in PR #5. The rest is now delivered as four pull requests, each
merged only when the suite is green, in this order because each one needs the
last. [VISION.md](VISION.md) is the destination; this is the route.

### Phase 0, shipped

- **The list counts today onward.** Days before today stay on the plan with their
  cost and calories but add nothing to the list, stock check or "needs" figures.
  Without a start date everything counts, as before.
- **Add from the List with a fuzzy search**, with a write-in line and a shop
  chooser for anything that is not an item.
- **Back button**: closes the camera, then a sheet, then returns to the List, and
  is otherwise absorbed. Installed app only.
- Fixed B1 (`delMeal`), B2 (UTC `today()`), B8 (`storeNames`); removed dead
  imports, an unwired action and dead CSS. The eight tests that planned from a
  fixed August day now pin the browser clock (`pinClock`).

### A. Foundations that the rest stands on

1. **An undo toast** and **one in-app confirm** replacing every `prompt()` and
   `confirm()`. Routine actions get the toast; the destructive few (delete an
   item or a meal, reset, clear the week) get a confirmation that names what goes.
2. **Spacing utilities** in the CSS. No new inline `style` from here on; each view
   is converted as it is rewritten in B to D, and a last sweep takes what is left.
3. Small fixes that ride with it: B9 (manifest description), unused parameters.

### B. The week

1. **One week, Saturday to Friday, plus a single carry-over day** (the next
   Saturday) for leftovers. Storage stays at fourteen days so nothing is lost and
   an older phone still merges; only the first eight are shown.
2. **Move on a week**: a banner on the Plan once the week is over, and a button
   always. It slides the plan back seven days, and offers *Move on, empty* or
   *Move on, repeat this week* (copy into empty slots only, so the carry-over day
   is never overwritten). It replaces *Start the next fortnight*, which goes.
3. Today is marked; days that have gone fold under *Earlier this week*.
4. Names, week start and budget move into *Plan settings*.
5. **A day opens on its meal pickers**, one per slot for *Both* of you, with
   *Split* when you differ. *Write a meal in* and *Swap* live inside the day, and
   cooking something else is just choosing another meal there. Changing what is in
   a meal is folded away per slot, and acts on both of you when the slot is shared.
6. **Food folds into Plan**: a calories line per day and a *Nutrition* toggle.
   Four tabs: List, Plan, Meals, Items. The pager bars go.

### C. The list and the shop

1. **Pinned total and budget.** The budget (a weekly cap) is edited by tapping it,
   and in Plan settings.
2. **Go shopping**: the stock check as the front door, then the list recalculated,
   then the in-shop view with *in the trolley £x, still to get £y* against the cap.
   *Done shopping* offers the receipt.
3. **Undo** on *Got it*. The stale-price dot only when it is the exception.
4. **Scan moves into the add sheet** (new items), with the price optional because
   the receipt fills it in. Each result also gets *Bought*, which puts a pack
   straight into stock for a top-up you never put on the list.
5. Receipt moves out of the top of the list to the end of *Go shopping* and the
   add sheet's menu.

### D. Editing and polish

1. One **item-line editor** for meals and days, and one fuzzy **item picker**
   replacing the native `<select>` in meal lines, day lines, receipt targets and
   scan targets.
2. Items: price, stock and shop up front, the rest folded; the thin **+** goes.
3. Settings in three groups: Sync, Appearance, About.
4. One word per level (*item*, *product*, *pack*, *week*, *shop*), 44px targets,
   pinned sheet actions, and the README rewritten to a single model.

### Later

A read-only *This week's meals* view or share for the other person, saved menus,
a cheapest-shop total, calorie targets, recently used items in the add sheet.

## Decisions

1. **Settled: stock under-buying.** You do the stock check by hand before every
   shop, which counts what is really in the cupboard, including leftovers from
   meals you swapped. Counting from today is right.
2. **Settled: the budget is a weekly cap**, adjustable. On shop day the list total
   is the week's cost. Ticking *Got it* shrinks that total (the pack becomes
   stock), so in the shop the bar shows what is in the trolley against the cap.
3. **Settled: one week, Saturday to Friday, shop on Saturday**, with one carry-over
   day. The window is eight days; the fortnight goes.
4. **Settled: Food folds into Plan**; four tabs.
5. **Back button.** *Reported 2026-10-06:* back gives a completely blank page in
   the app's background colour. That is the signature of the browser's empty
   starting page, not of the app: the installed app has no entry behind it, back
   falls onto that, and no page is there to run code, which is why only closing and
   reopening helps. The guard keeps an entry in front of it. Please check after
   updating that *Settings → Install this app* says "Installed. You are running it
   as its own app" (the condition the guard runs under) and that back from the
   List does nothing. If it still goes blank I would widen the condition.
6. **Open: how the week rolls over.** I propose a banner and one tap, not an
   automatic change, because the plan is shared between devices and a silent edit
   on opening would be hard to explain. Say if you would rather it just happened
   on Saturday.

## Status

| Item | State |
|---|---|
| Phase 0 | Shipped, PR #5 |
| A. Foundations | Built: dialogs, undo toasts, spacing utilities, B9, unused parameters |
| B. The week | Built: one week plus the leftovers Saturday, Move on, Both/Split day sheet, Food folded into Plan, four tabs |
| C. The list and the shop | Built: pinned total and budget, Go shopping with the trolley, Bought, scan in the add sheet, optional price |
| D. Editing and polish | Not started |
| Back button blank page | Guard should prevent it; needs confirming on the phone |
