# How the app should look and work

Written 2026-10-06, after the first review ([REVIEW.md](REVIEW.md)). It describes
where the app should end up, built from how you use it. Phases in REVIEW.md are
the route; this is the destination.

Anything marked **⚑** is my inference, not something you told me. Those are the
places to correct me first.

## What I know, and what I am guessing

**You told me**

- You think in **weeks**: "starting a new week of meals", "the previous week". The
  repo's own description is "weekly food shop budget based on meals". The app
  calls itself *Fortnight Shop* and plans fourteen days.
- **Before every shop you do the stock check by hand.** You also cook off-plan
  sometimes, so that check is where leftovers from a skipped meal get counted.
- You were deleting last week's meals by hand so the list stayed honest.
- You add odd things to the list by hand, and sometimes a real item.
- You use it **installed on a phone**, and it has to survive being used one-handed
  in a shop with the back gesture.
- You want it to feel like one app, and you notice what is clunky, overdone or
  jarring.

**I am assuming** ⚑

- Android, one phone, used mostly in two places: at home planning, and in the shop.
- The shop is weekly, on a fixed day, with top-ups now and then.
- The budget is a weekly cap you care about, and the total is the first thing you
  look at.
- Two people share the list, or might (the app has two people on every day).
- Calories and macros matter less to you than money and not wasting food. The
  Food tab and label scanning suggest they mattered once.

## What the app is for

> Know what this week's meals will cost at the shop, buy only what you do not
> already have, and never do admin to keep that true.

Everything below is judged against that. The loop it serves:

1. **Plan** the week: pick meals, change a day when life changes.
2. **Check the cupboard**, as you already do, just before leaving.
3. **Shop** from a list that is already right, against a budget you can see.
4. **Record** what happened: tick things off, photograph the receipt for prices.
5. **Move on** a week without clearing anything.

Nothing in that loop is "tell the app what you ate". It does not track
consumption and should not pretend to. Your stock check is the correction, and it
is a better one than any tracking could be.

## Principles

1. **The list is home.** You open the app to see what to buy and what it costs.
   Everything else is in service of that screen being right.
2. **The past is not your problem.** Days that have gone drop out of the maths by
   themselves, and moving to a new week is one tap that asks nothing.
3. **The number you came for is always visible.** Total against budget does not
   scroll away.
4. **Pick, then edit.** Choosing a meal, an item or a shop is a tap on a search
   result. Editing detail sits one level down and is folded until asked for.
5. **One way to do each thing.** One add flow, one picker, one dialog, one way to
   open an editor. If two controls do the same job, one goes.
6. **Say less.** One line of help at most, and only where a mistake is likely.
   The explanations that exist now move to a single *How this works* page.
7. **Undo beats confirm.** Destructive actions happen and offer to be reversed,
   instead of asking in a browser dialog first.
8. **Works with one thumb, no signal, and a bag in the other hand.** Targets are
   44px or more, nothing needs two hands, nothing needs a connection.
9. **Never lose what was typed**, and never surprise-redraw underneath a finger.

## The screens

Four tabs: **List · Plan · Meals · Items**. Settings is the gear, not a tab. Food
is folded into Plan (below). The pager bars go: the tab bar already says where you
are.

### List

```
┌──────────────────────────────────┐
│ Shopping list                 ⚙  │
│ ┌──────────────────────────────┐ │
│ │ ＋ Add to the list           │ │
│ └──────────────────────────────┘ │
│ From today ▾        [Go shopping]│
│                                  │
│ Tesco                  £44.45 ⌄ │
│  Steak Pies × 10        £25.00 ○ │
│  Potatoes × 2            £2.30 ○ │
│  Bin bags                      ○ │
│ Asda                   £12.70 ⌄ │
│  …                               │
├──────────────────────────────────┤
│ £70.55 of £60.00      £10.55 over│  ← pinned, always visible
│ ████████████████████▌            │
└──────────────────────────────────┘
```

- **Add bar** at the top opens the search sheet (built). Hand-written lines and
  real items look the same in the list; a written line just has no price.
- **Range chip**: *From today* by default; *Next 7 days* and *Whole plan* are the
  other two. This is how Plan to Eat does it, and it makes "today onward" a visible
  choice instead of a hidden rule.
- **Go shopping** is the front door described below. It replaces the *Stock check ·
  25 to count* button, which nags about a job you do anyway.
- **Receipt and Scan** are not at the top. They are what you reach for after
  and during a shop, so they live in the shopping view and under the add sheet.
- **Rows**: name, quantity, price, a tick. The tick is *Got it*, with an undo
  toast. A row is one line plus a quiet second line for the product and any deal.
- **Total and budget are pinned** above the tab bar, not at the end of the scroll.
- The red stale-price dot appears only when most prices are fresh. If everything
  is stale the banner says so once and the dots stay off.

### Go shopping

One flow, three steps, each skippable.

```
 1 Check the cupboard      2 The list         3 In the shop
 ─────────────────────     ───────────────    ───────────────
 What this week needs,     Recalculated,      Big rows, tick as
 A–Z. Each row: what       with what the      you go. Add and
 the plan asks for, what   check changed:     scan are one tap
 the app thinks you have,  "+£3.00, at        away. Done →
 [ − ]  2  [ + ]  [None]   £38.15".           optional receipt.
 [Right]
```

- **Step 1 is your existing habit made the default path.** It lists only what the
  plan still needs (today onward), so it is short. Because you cook off-plan, each
  row shows how much the plan asks for against what is recorded, so a leftover is
  obvious. *Right* and *None* are one tap.
- It remembers when it was last done ("Checked Saturday") and says so quietly. It
  never shows a count of things left to do.
- You can start at step 2 or 3 and skip the check. It never blocks the list.

### Plan

```
┌──────────────────────────────────┐
│ ‹  3 Oct – 9 Oct  ›     £38.28   │
│    Move on a week · Copy last    │
│                                  │
│ ▸ Earlier this week (3)          │
│ Tue 6 Oct  TODAY                 │
│   Lee   Pie and Mash · — · Fish  │
│   Sam   Pie and Mash · — · Spag  │
│ Wed 7 Oct                        │
│   …                              │
└──────────────────────────────────┘
```

- **A rolling window of this week and next.** Today is marked. Days that have gone
  fold under *Earlier this week* and add nothing to the list.
- **Move on a week** is one tap: it slides the plan back seven days, so next week
  becomes this week and a new empty week appears. It asks no question, because
  there is only one thing it can mean. **Copy last week** fills the empty week from
  the one just gone; *Repeat breakfast* stays for the common case.
- This replaces *Start the next fortnight*, the date-picker rollover sheet, and
  *Clear both weeks* sitting beside them. Clearing moves into an overflow menu.
- **Setup lives elsewhere.** Names, week start day and budget are *Plan settings*,
  one row away, not the first card on the screen.
- **A day opens on six meal pickers**, nothing else. *Write a meal in* and *Swap*
  live inside the day. Changing what is in a meal is behind *Change what's in it*
  per slot.
- **We had something else.** Because you do not always cook the plan, the day has
  a quick way to say so: swap that slot for another meal, or *Ate out / not
  cooking*, in two taps, with no editor. It changes the plan and so the list. It
  does not touch stock; your stock check does that.
- ⚑ **Food folds in here.** A line under each day (`1,840 kcal`) and a *Nutrition*
  toggle, rather than a tab that shows the same weeks again. If you rarely look at
  calories, the toggle is off by default and the data stays.

### Meals

Name-ordered, search at the top, *Can make* filter kept. A meal is a list of lines;
each line is an item chosen with the same search picker as the add sheet, an
amount, and a Portions/grams switch that is a proper segmented control. Meals
show cost per serving and what you are short of, as now. The paragraph under every
line goes.

### Items

Search first. A row shows name, best price, stock. Opening one shows the three
things you actually change (price, stock, shop) and folds the rest (pack and
portion, offer, nutrition, barcodes), as now. The thin **+** on every row goes:
adding to the list is the List's job.

### Settings

Three groups, not one long scroll: **Sync** (database, invite, merge options),
**Appearance** (theme, accent), **About** (version, update, install, problems).

## Look and feel

Keep the Nocturne dark theme and the accent choice. They are fine. What changes is
discipline.

- **One spacing scale** (4, 8, 12, 16, 24) as CSS utilities. No inline `style`.
  This is the biggest single fix for "slightly off".
- **Three text sizes** plus the small caps label. Numbers use tabular figures.
- **One primary action per screen**, drawn as a filled button. Secondary actions
  are outlines, tertiary are text. Today `solid` is an outline; that gets fixed.
- **Thumb size**: nothing tappable under 44px. The 36px small buttons grow or
  gain padding.
- **Sheets** have a header that stays put (title and Close), a body that scrolls,
  and the main action pinned at the bottom. No tapping beside a sheet to close
  one that holds work.
- **No native dialogs.** `prompt()` and `confirm()` become an in-app sheet or an
  undo toast.
- **One icon set** (the Phosphor already vendored), used for every action.
- **Empty states** say what to do in one line and offer the button.
- **Quiet motion**: the tab slide stays; everything else is instant.

## Words

One word per level, used everywhere:

| Say | Not |
|---|---|
| **Item** (what a meal asks for: Cheddar) | ingredient, kind of thing |
| **Product** (what is on the shelf: Cathedral City, Tesco) | what to buy, one of them |
| **Pack** | portion-pack, unit |
| **Week** | fortnight, except where the plan really is two weeks |
| **Shop** (the place) / **Go shopping** (the act) | store, trip |

The model underneath does not change; only what the screen calls it.

## What it is not

- Not a recipe manager: meals are lists of items, not method and photos.
- Not a price scraper: prices come from your receipts and shelf scans, which is
  why it keeps working when a supermarket redesigns its site.
- Not an account service: sync is a file in your own repo.
- Not a consumption tracker, as above.

## Questions that would change this

1. **Week or fortnight?** Do you ever plan more than a week ahead? If not, the
   window is 7 days plus a look-ahead, and the name changes.
2. **Which day is the shop?** The plan currently asks for a Saturday. Is the week
   Saturday to Friday because that is the shop day?
3. **Is the budget a weekly cap?** If so, the bar should show *spent so far + still
   to buy*, which needs receipts to record the spend. Today it only knows the
   second half.
4. **Food tab**: do you use it? If rarely, it folds into Plan as a toggle. If
   daily, it may deserve to stay.
5. **Two people**: is the second person real, and do they use their own phone? That
   decides how much the day view should show of each.
6. **Receipts and scanning**: how often? If most weeks, they earn a place in the
   shopping flow. If rarely, they go under the add sheet.
7. **Top-ups**: do you shop more than once a week? If so *Go shopping* needs a
   light mode that skips the stock check.
8. **Android only?** It decides whether iOS's back swipe and install flow are
   worth testing.

## How this maps to the plan

| Here | In REVIEW.md |
|---|---|
| List first, pinned total, Go shopping, range chip | Phase 3 |
| Rolling week, Move on a week, day opens on pickers, we-had-something-else | Phase 2 |
| One picker, one dialog, spacing scale, words | Phase 1 and 4 |
| Four tabs, Food folded in, Settings in three | Phase 4 |
| Saved menus, cheapest-shop total, targets | Phase 5 |
