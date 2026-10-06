# How the app should look and work

First written 2026-10-06 and revised the same day with your answers. It describes
where the app should end up, built from how you use it. [REVIEW.md](REVIEW.md) has
the route there, in four pull requests.

## How you use it

Everything below came from you; nothing is guessed any more.

- **One week, Saturday to Friday, shopping on Saturday.** You never plan beyond a
  week except for one day: Friday's leftovers can be Saturday's meal.
- **The £60 is a weekly cap**, and it should be adjustable.
- **Before every shop you do the stock check by hand.** You also cook off-plan
  sometimes, so that check is where leftovers get counted. It is the correction,
  so the app never needs to track what you eat.
- **Top-ups are not logged.** When you do one you add the things by hand on the
  List and put them into stock from there.
- **Receipts are scanned after each shop.** Barcodes and nutrition are scanned when
  something is new to the app. You do not update prices in the shop; the receipt
  does that.
- **Android**, installed, one-handed, often with no signal.
- **The other person does not use the app.** Being able to show them each day's
  meals would be nice, but is not needed now.
- You like Food folded into the Plan, and you want the whole thing to feel like one
  app rather than a set of tools.

## What the app is for

> Know what this week's meals will cost at the shop, buy only what you do not
> already have, and never do admin to keep that true.

The loop it serves, every week:

1. **Move on a week** (Saturday) and plan it, with Friday's leftover day already in.
2. **Check the cupboard**, as you already do, just before leaving.
3. **Shop** from a list that is already right, against the cap, with a running
   trolley total.
4. **Scan the receipt** when you get home. That is the only time prices change.
5. Cook, swap, eat out. Tell the app only if it changes what you will need.

## Principles

1. **The list is home.** You open the app to see what to buy and what it costs.
2. **The past is not your problem.** Days that have gone drop out of the maths, and
   a new week is one tap that asks nothing.
3. **The number you came for is always visible**, and in the shop it is the trolley
   against the cap.
4. **Pick, then edit.** Choosing a meal, an item or a shop is a tap on a search
   result. Detail sits one level down, folded until asked for.
5. **One way to do each thing.** One add flow, one picker, one dialog.
6. **Say less.** One line of help at most, and only where a mistake is likely.
7. **Undo for routine, a named confirmation for the irreversible.** No browser
   dialogs, and no "are you sure?" on a tick.
8. **One thumb, no signal, a bag in the other hand.** Targets are 44px or more.
9. **Never lose what was typed**, and never redraw under a finger.

## The screens

Four tabs: **List · Plan · Meals · Items**. Settings is the gear. The row of pager
bars goes; the tab bar already says where you are.

### List

```
┌──────────────────────────────────┐
│ Shopping list                 ⚙  │
│ ┌──────────────────────────────┐ │
│ │ ＋ Add to the list      📷   │ │
│ └──────────────────────────────┘ │
│                    [Go shopping] │
│                                  │
│ Tesco                  £44.45 ⌄ │
│  Steak Pies × 10        £25.00 ○ │
│  Potatoes × 2            £2.30 ○ │
│  Bin bags                      ○ │
│ Asda                   £12.70 ⌄ │
├──────────────────────────────────┤
│ £57.15 of £60 ✎        £2.85 left│  ← pinned, tap the cap to change it
│ ████████████████████▌            │
└──────────────────────────────────┘
```

- **The add bar** opens the search sheet (built). The camera icon in it is how you
  add something new to the app: scan its barcode, then its label.
- Hand-written lines and real items look the same in the list; a written line has
  no price and a tick only strikes it off.
- **Rows**: name, quantity, price, a tick. The tick is *Got it*, and it offers undo.
  A second quiet line carries the product and any deal.
- **Total and cap are pinned** above the tab bar, and the cap is edited in place.
- **Receipt is not here.** It is offered when you finish shopping, and sits in the
  add sheet's menu for the day you forget.
- The red stale-price dot shows only when it is the exception. If everything is
  stale the banner says so once and the dots stay off.

### Go shopping

One flow, three steps, each skippable, never blocking the list.

```
 1 Check the cupboard      2 The list         3 In the shop
 ─────────────────────     ───────────────    ───────────────
 What the week still       Recalculated:      Big rows, tick as
 needs, A–Z. Each row:     "+£3.00, at        you go.
 what the plan asks for,   £38.15 of £60".    In trolley £31.10
 what the app thinks       Anything over      Still to get £27.05
 you have.                 the cap is red.    Done → scan receipt?
 [ − ] 2 [ + ] [None]
 [Right]
```

- **Step 1 is your habit made the default.** It lists only what the week still
  needs, so it is short, and each row shows what the plan asks for against what is
  recorded so a leftover from an off-plan meal stands out. *Right* and *None* are
  one tap. It remembers when it was last done and never shows a count of what is
  left to do.
- **Step 3 fixes a real problem.** Ticking *Got it* turns a pack into stock, so the
  list total shrinks as you shop and you lose sight of what the shop is costing.
  In the shop the bar shows **in the trolley** against the cap, with **still to
  get** beside it. Trolley plus still-to-get is the week's cost, and the bar goes
  red if that passes the cap.
- A top-up never needs this flow: add by hand and tick, as you do now.

### Plan

```
┌──────────────────────────────────┐
│ ‹  Sat 3 – Fri 9 Oct  ›    £38.28│
│ A new week has started           │
│ [Move on, empty] [Move on, repeat]│
│                                  │
│ ▸ Earlier this week (3)          │
│ Tue 6 Oct  TODAY       £6.69 1840│
│   Both   Pie and Mash · — · Fish │
│ Wed 7 Oct                        │
│   Both   …               ⌄ Split │
│ …                                │
│ Sat 10 Oct   leftovers           │
│   Both   — · Leftovers · —       │
│                         Nutrition│
└──────────────────────────────────┘
```

- **One week, plus the single carry-over Saturday.** Today is marked; days that
  have gone fold under *Earlier this week* and add nothing to the list.
- **Move on a week** is a banner once the week is over and a button always. It
  slides the plan back seven days, so the carry-over Saturday becomes day one. You
  choose *empty* or *repeat this week*; repeat fills only empty places, so the
  leftover day is never overwritten. It replaces *Start the next fortnight*, the
  date-picker rollover, and *Clear both weeks* beside it.
- **A day opens on its meal pickers**, one per slot for *Both* of you. *Split* is
  there for the day you differ. *Write a meal in* and *Swap* are inside the day, and
  changing what is in a meal is folded away. Cooking something else than planned is
  just choosing another meal there, two taps from the Plan, and it changes the list;
  what it leaves in the cupboard is your stock check's job.
- **Food is folded in.** A calories line per day, and a *Nutrition* toggle for the
  protein, carbs and fat figures, with a mark where an item has no label yet.
  Targets per person are a later option.
- **Week settings** (one button away): names, the day the week starts, the budget,
  and clearing the plan.

### Meals

Name-ordered, search at the top, *Can make* kept. A meal is a list of lines; each
line is an item chosen with the same search picker as the add sheet, an amount, and
a proper Portions/grams switch. It shows cost per serving and what you are short of,
as now. The paragraph under every line goes.

### Items

Search first. A row shows name, best price, stock. Opening one shows the three
things you change (price, stock, shop) and folds the rest (pack and portion, offer,
nutrition, barcodes). The thin **+** goes: adding to the list is the List's job.
New items arrive by scanning, and the price is optional because the receipt fills it
in later.

### Settings

Three groups, not one long scroll: **Sync**, **Appearance**, **About**.

## Look and feel

Keep the Nocturne dark theme and the accent choice. What changes is discipline.

- **One spacing scale** (4, 8, 12, 16, 24) as CSS utilities, no inline `style`.
  This is the single biggest fix for "slightly off".
- **Three text sizes** plus the small-caps label; tabular figures for numbers.
- **One primary action per screen**, drawn as a filled button; secondary actions
  are outlines, tertiary are text. Today `solid` is an outline; that gets fixed.
- **Nothing tappable under 44px.**
- **Sheets** keep their title and Close in view, scroll in the middle, and pin the
  main action at the bottom. Tapping beside a sheet that holds work does not close it.
- **No native dialogs.** Routine actions get an undo toast. Delete an item or a
  meal, reset, and clear the week get an in-app confirmation that names what goes.
- **One icon set** (the vendored Phosphor), **empty states** with one line and the
  button, and motion limited to the tab slide.

## Words

| Say | Not |
|---|---|
| **Item** (what a meal asks for: Cheddar) | ingredient, kind of thing |
| **Product** (what is on the shelf: Cathedral City, Tesco) | what to buy, one of them |
| **Pack** | unit |
| **Week** | fortnight |
| **Shop** (the place) / **Go shopping** (the act) | store, trip |

The model underneath does not change; only what the screen calls it.

## What it is not

- Not a recipe manager: meals are lists of items, not method and photos.
- Not a price scraper: prices come from your receipts, which is why it keeps
  working when a supermarket redesigns its site.
- Not an account service: sync is a file in your own repo.
- Not a consumption tracker. Your stock check is better than tracking could be.

## Still open

1. **How the week rolls over.** A banner and one tap, or automatically on Saturday?
   I would not do it silently: the plan is shared between devices, and an edit you
   did not make is hard to explain.
2. **Showing the other person the week.** Not needed now. When it is, the cheapest
   version is a *Share this week* button that sends a plain-text list of the days
   through Android's share sheet, with no account and nothing for them to install.
3. **Bought.** For top-ups, I plan a second button on each add-sheet result that puts
   a pack straight into stock without putting it on the list. Say if you would
   rather keep add-then-tick.
