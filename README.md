# Weekly Shop

A meal planner and food budget for UK shopping, built around one week at a time. Static site, no build step, no server. Prices come from receipts and barcodes rather than scraping, so nothing breaks when a supermarket changes its website.

The maths started as a spreadsheet and is unchanged: the portions the week needs, minus the portions in stock, rounded up to whole packs, grouped by shop.

## The week

Every week runs the same loop, and the app is shaped around it.

1. **Move on a week** (Saturday) and plan it, with Friday's leftover day already in.
2. **Check the cupboard**, just before leaving.
3. **Go shopping** from a list that is already right, against the weekly budget, with a running trolley.
4. **Scan the receipt** when you get home. That is the only time prices change.
5. Cook, swap, eat out. Tell the app only if it changes what you will need.

Four tabs: **List**, **Plan**, **Meals**, **Items**. Settings is the gear.

## Setup, about 15 minutes

1. **Publish the app.** Copy these files into your Pages repo, at the root or in a subfolder like `/shop/`. Everything is relative-pathed.
2. **Create a private repo for the data.** Call it `shop-data` and leave it empty. Private repos are free, and Pages never needs to read it.
3. **Make a token.** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens. Repository access: only `shop-data`. Permissions: Contents → Read and write. Nothing else. **Set the expiry to the longest offered**, because the default is 30 days and syncing simply stops when it lapses.
4. **Get a Gemini key** from Google AI Studio if you do not have one. The free tier covers a receipt a week many times over.
5. **Open the site on your phone**, tap the gear, and under **Sync** open *Database, keys and backup*. Fill in the owner, repo and token, paste the Gemini key, then tap **Update database**. That creates `prices.json` on the first push.
6. **Install it** (Settings → About says how for your browser). It then runs full screen and works offline.

## The Plan

The plan is **one week, Saturday to Friday**, and the Saturday after it, where Friday's leftovers get eaten. It is stored as fourteen days so that nothing is lost and an older copy of the app still merges, but only those eight are shown.

**Tap a day** to open it. It opens on one meal picker for each of breakfast, lunch and dinner, set for **both** of you at once, since most days are. **Split** gives each person their own picker for the day you differ, and **Same for both** folds it back. A day where you are the same reads once on the plan, headed *Both*. **Portions on a meal are for one person**, so planning it for both counts it twice.

Today is marked, and days that have gone fold away under *Earlier this week*. Every row shows its date, which is what tells you whether a use-by will still hold when that evening comes round. **Week settings** holds the names, the day the week starts, the weekly **budget** and **Clear the plan**.

**Move on a week.** Once the week is over the Plan says *A new week has started* and offers **repeat meals** or **empty**. Either slides the plan back seven days, so the Saturday becomes day one and keeps what was planned on it, including a meal written in for Friday's leftovers. Repeating copies the week just finished into the new week's *empty* places only, and leaves one-day edits behind since they belonged to that day. A phone left alone for weeks catches up in one tap. This is different from correcting the start date under Week settings, which slides the plan so a meal keeps the day you chose it for; one date box could not tell which you meant. Stock is left alone, since the cupboard did not change because the calendar did.

**Changing a meal for one day.** Under each meal, **Change what's in it** opens its items. The moment you change one, that meal becomes a **loose edit** kept on the day alone: the shared meal, and every other day using it, is untouched, and the shopping list follows what the day actually says. The grid marks it with a **✎**. A loose edit has three ways out: leave it, **Save into** the shared meal (changing it everywhere), or **Save as a new meal**. Choosing a different meal drops the edit.

**Extras** are single things eaten outside a set meal, such as two apples. They are per person, count towards that person's calories, stock and the list, and do not add to the "meals planned" count.

**Write a meal in** puts plain words on a day (a takeaway, a dinner out): it costs nothing and asks for nothing. **Swap** exchanges two whole days. **Repeat** copies a slot from the first planned day into the empty days.

A day's edits, extras and written meals are part of the plan, so they survive a save and reload, ride along when a week is moved on, and come across on a merge.

**Food is part of the Plan.** Switch **Nutrition** on at its foot and every day gets a line of calories and macros, with an average beneath. A day shared by both of you reads once, as *Each*.

## The List

The list counts meals on **today and later**, so last week's dinners never have to be deleted. A day that has gone stays on the Plan with its cost and calories; it just asks the shops for nothing. Without a start date every day counts.

**The total and the budget sit in a bar pinned above the tab bar**, so the number you came for never scrolls away. Tap the budget to change it: it is a weekly cap.

**The add bar** at the top opens a search over the items you keep. It matches loosely (`stkpies` finds Steak Pies). Tap a result and a pack goes on the list, riding on the cheapest shop; tap again for another, or **−** to take one back. **Bought** is for a top-up you never put on the list: it puts a pack straight into stock. The barcode button is how something new gets into the app: scan it, then its label. For anything that is not an item, such as bin bags, the same sheet has a line to write it in and the shop to put it under, one you use, **No shop yet**, or a new one typed there. A written line has no pack behind it, so **Got it** only strikes it off.

**Got it** turns a line's packs into stock and offers **Undo**. The price on a line gets a red dot when it is over 14 days old, but only when that is the exception: if most prices are old the banner says so once and the dots stay off.

Each line says why a shop was chosen (*cheapest of 2 shops · Tesco is £0.15 more a portion*), or *pinned* if you pinned one.

## Go shopping

**Check the cupboard** is the first step. It lists what this week's plan still needs and nothing else, A to Z. Each row says what the plan asks for, whether that is covered, when it was last counted, and how the figure reads in packs as well as portions. Correct the ones that are wrong; tap **Right** on the ones that are not, which changes no figure but records that you looked. **Start shopping** is pinned at the bottom and **Skip the check** is there for a day it is not worth doing. The List says quietly when the cupboard was last checked, never with a count of what is left.

Stock only goes up on its own (a receipt, a scan, **Got it**). Nothing takes it out, and nothing sensibly could: nobody opens an app to record a biscuit. So the app asks once, when asking is worth it. A count is stamped on the product, so progress survives closing the app halfway round the kitchen, and a merge treats a count as beating arithmetic: if one phone added 8 from receipts and the other looked in the freezer and found 2, the 2 wins.

**In the shop**, the pinned bar becomes **the trolley against the budget**. Ticking **Got it** shortens the list, so without this the cost of the shop would shrink as you went round it. The bar shows what is in the trolley and what is still to get, and the two always add up to what the shop comes to. **Undo** takes a line back out. **Done shopping** ends it and offers the receipt. A shop is kept on the phone it was started on, survives closing the app, and is over by the next day.

## Receipts, barcodes and prices

**Receipts** are the bulk update. Photograph the whole receipt flat, the model returns line items, and each is matched to one of your items. You confirm before anything changes. A confirmed line records the price and, since a receipt is proof you bought it, puts stock in: each line carries an **Into stock** figure in portions, from the quantity times that item's portions per pack, stepped a pack at a time and editable (three yoghurts on one line may be three flavours you keep separately). Set it to 0 to record the price alone. Pointing a line at a different item re-derives it.

**A receipt is dated evidence, not the current truth.** The date is read off the photo, shown beside the shop and editable, and is recorded against every price on it. A line whose item has been updated since that date is switched off and labelled **old price**, naming what changed and when; tick it back on if you disagree. The comparison is by day, since a receipt has no time of day. A line that matches nothing defaults to being **added as a new item**, because ignoring was the safe-looking default that quietly dropped everything not yet recorded.

Matching gets better every shop, because confirming a line saves its wording as an alias:

| Signal | Confidence | Where it comes from |
|---|---|---|
| Barcode | certain | You scanned it once |
| Saved alias | near certain | You confirmed that wording before |
| Name similarity | a guess | Token overlap, shown for you to check |

**Barcodes** are how something new gets in. Scan it and name it; the shelf price is optional, since the receipt brings prices and finds the item by its barcode. Saving a scan then offers to photograph the label, but only when that product has no calories or macros yet: scanning is the one moment the pack is in your hand, and it never asks about something already filled in. Scanning is two steps, what kind of thing this is, then which one of them.

**Offers** are recorded per product, since a Clubcard price is Tesco's business and not Aldi's. Three kinds: a loyalty card price, N for a fixed price, and buy N pay for fewer, each with an optional end date after which the app reverts to full price. Base price and offer price are kept apart on purpose. A loyalty price applies to every pack, so it feeds portion and meal costs. A multibuy depends on how many packs you buy, so it only affects the list total: a meal is not cheaper because you bought three. Every receipt line therefore carries a **Paid** choice (full price, card price, or multibuy), because "3 for £8" recorded as a card price of £2.67 would tell the app a single pack costs £2.67 when it costs £3.75. The offer editor spells out which you have.

Offers never lower the base price, otherwise it would drift down with every promotion and never come back up.

## Items and products

**An item is what a recipe asks for. A product is what you put in a trolley.** "Cheddar" is the item; Cathedral City at Tesco, Tesco Finest and the Asda own brand are three of its products. Two products may share a shop.

| On the item | On each product |
|---|---|
| Name, aliases | Its own name, and the shop |
| What meals ask for | Price per pack, portions per pack |
| | **Stock, in portions** |
| | Pack size, portion, nutrition, offer, barcodes |

**Stock sits on the product**, because a meal may demand one specific product and the app has to answer "have I got *that*". An item's stock is the sum of its products', so "any cheddar will do" pools exactly as you would expect: a block in the fridge does not remember which shop it came from.

**A meal line can name a product, or not.** Blank is the useful default: the list buys the cheapest per portion, and any of it in the house counts. Name one and only that one satisfies it, so it goes on the list even with other cheddar in the fridge. **Pin** a product to always buy it.

The list buys from **whichever product is cheapest per portion**, not per pack, so a bigger pack at a higher price can still win. Everything that records a price records it against a shop: a receipt from Asda adds an Asda price to the cheddar you already have rather than creating a second one. Receipts print legal names (`TESCO STORES LTD`) and shop names are folded to one spelling on the way in (`ASDA` becomes Asda); a spelling already in your data always wins.

**The Items tab** opens an item on the three things you change: the shop, the price and the stock. The rest is folded: name, pack and portion; offer; nutrition; barcodes. An item with one product has it open already. There is no **+** here, because putting something on the list is the List's job. New items start with no shop and sort to an *Unassigned* group at the top until you file them: guessing a shop would be worse, since an item in the wrong group is harder to spot than one in an obviously empty one. Receipts are the exception, since they know the shop. Sort by shop or A to Z (remembered per device). The search matches loosely and covers names, shops, barcodes and remembered receipt wording.

**Moving a product to another item** (*Move to…*) corrects "Arla Lactofree Semi Skimmed Milk" having become its own kind of food when it is really one of the milks. It keeps its price, stock, pack size, nutrition and barcode. A meal naming that exact product follows it; a meal asking for the old item in general follows only if the old item is left empty. Aliases and hand-added packs move when the old item goes, and a pin on the product that left is cleared. Moving the only product an item has removes the item, and the screen says so before and after.

**Copy to a shop** clones a product and blanks only what differs between shops: the shop and the price. Stock does not travel (it is a pack in your cupboard), nor does the offer, and the copy is not stamped as priced. The barcode does travel, since it is the same tin. Once a barcode is on two shops' entries a scan cannot tell which you are standing in, so it lists them with price and age and nothing is editable until you pick one.

### Pack size, and what a portion is

**Pack size** is a number and a unit (`600` `g`, `1500` `g`, `500` `ml`), not free text. "No weight" is a real choice, for six eggs or kitchen towel. **A portion is** either a count or a weight, and the app works out the other:

| You enter | It derives |
|---|---|
| 2 portions per pack | a portion is 300g |
| 300 g per portion | 2 portions per pack |

Portions per pack is what the whole shopping engine runs on, so defining a portion by weight still produces a correct list. Neither is stored twice, so the two cannot drift. New items default to **1** portion per pack: one pack, one use, right for water or cleaning products, and it can never under-order. Setting it to 0 would make the item vanish from the list, so the list names those items in red instead.

### Stock is counted in portions

An opened pack is the normal case, and a half-used pack should not be offered to the planner as a whole one. A pack of pies does 4 portions and 2 are left: plan a meal wanting 4 and the deficit is 2 portions, which cannot be bought as less than a pack, so a whole pack goes on the list and 2 portions show as left over.

Everything that hands you packs converts on the way in:

| Where | What you enter | What is stored |
|---|---|---|
| Items, In stock | portions | portions |
| Items, ± pack | one pack | portions per pack |
| Got it, on the list | the packs bought | packs × portions per pack |
| Scan an item | packs in the trolley | packs × portions per pack |
| Receipt review, Into stock | portions, none by default | portions |

### Recipes in grams

A meal line is written **either in portions or in grams**, per line, and switching carries the amount across. Grams is what a recipe says. **Nutrition** from a gram line is exact (400g at 250kcal per 100g is 1000kcal) and never passes through a portion count. **The list** still needs packs, so a gram line is divided by that product's portion size; without a portion weight the line counts as nothing and the list names the product as a problem rather than dropping it silently.

### Choosing a meal

Meals are listed **in name order**. Each says whether you could cook it tonight without shopping, and names what stops you (*short of mince and pasta*). **Can make N** filters to those. A meal is judged on its own, not against the week, since "can I cook this now" is the question in the kitchen, and a meal with nothing in it cannot be made. A line naming a product can only be met by that product's stock. The meal you are editing is never filtered away.

### When things were last updated

| Source | Recorded as | Why |
|---|---|---|
| An edit by hand | the minute | So two changes on one day still have an order |
| A shelf scan | the minute | Same |
| A receipt | the day printed on it | A receipt does not know the time |

That ordering stops an old receipt overwriting a correction, and decides who wins when two phones changed the same item. The price stamp and the last-updated stamp are separate: renaming an item or fixing its portions does not pretend the price was rechecked, so the red dot still means what it says.

## Calories and macros

Every **product** carries calories, protein, carbs and fat, on the product rather than the item because Tesco Finest cheddar and the value block are not the same food. **They are stored per 100g or 100ml, exactly as the label prints them**, and what a portion comes to is worked out from the portion size when needed, so redefining a portion moves the calories with it. A 600g pot at 40kcal per 100g is 120 kcal a portion at 2 portions, 80 at 3, and 240 as one whole pot.

**Scan the label** sends the panel to the provider you set up for receipts and shows what it read in four boxes before anything is saved, because a curved foil pack under supermarket lighting is a good guess rather than a fact and a smudged decimal turns 123 into 1230. A normal label needs no conversion: the per-100 column goes straight in. A label with only a serving column is divided back down by that serving's weight, and if the weight is not printed the figures come back flagged rather than silently rescaled. The sheet also offers to size a portion from the photograph, ticked but never applied unseen, and shows what a portion comes to, so a wrong size is obvious there.

### Raw and cooked weights

Frozen and raw food is the case that quietly goes wrong. A pack of sausage patties is **342g in the freezer and 248g once grilled**, and its table is headed *"when grilled according to instructions"*, so the per-100g figures describe the cooked food. Pair those figures with the 342g on the front and every portion reads about forty per cent too heavy. The label answers this itself: it quotes one patty at 41g and six a pack, on the same basis as the nutrition beside it, and six times 41 is 246g, the pack weight those figures belong to. The scan uses, most trusted first:

| | Source | When |
|---|---|---|
| 1 | **Your** pack size × the label's shrink | The label gives both a raw and a cooked weight |
| 2 | The label's serving weight × servings a pack | Whenever both are printed |
| 3 | The cooked pack weight from a footnote | When the table is for cooked food |
| 4 | The weight on the front | Anything you do not cook |

A label's cooked weight only describes the pack it was printed for, so it is the *proportion* that travels: a 342g pack that grills to 248g has lost 27%, and a 346g pack of the same thing comes out at 251g. Where the two differ by more than 1% the sheet says so. A known servings count is stored as a **count**, not a weight, so six patties are exactly six. If the printed pack size is more than 5% from what the servings come to, the sheet says so in words. The list is unaffected: six patties is still one pack.

**Nutrition is merged on its own clock.** A shop trip updates prices and nothing else, and merging by the price stamp alone would let a phone that only shopped drag its blank label over one the other phone had read. A filled-in label always beats a blank one, and between two the more recent reading wins.

## Sharing and syncing

Two people can use one list, and there are two ways in.

**The invite code** is the short one. On the set-up phone, **Settings → Sync → Invite someone** produces a QR code and a text code carrying the database details and the token. On the other phone, **Enter an invite**, scan or paste it, done: no GitHub account, no token, and joining merges their list into yours rather than replacing either. That code is **a key to your list**. Anyone holding it can read and change your prices until you change the token on GitHub, so show it to the person in front of you rather than leaving it in a chat that lives forever. One token serves everybody, so removing one person means issuing a new token and re-inviting whoever stays. The QR code is drawn on the device by `lib/qr.js`, written for this app, because the code contains a token with write access and should never leave the phone. Attribution survives a shared token: who did what comes from **Your name** on each device.

**Their own token** is the longer way, and the only reason to prefer it is revoking one person without disturbing the other. On GitHub, open `shop-data`, go to **Settings → Collaborators**, and invite them; they make their own fine-grained token the same way and enter the same owner and repo.

**Pull merges, it does not overwrite**, otherwise whoever pushed second would wipe the other's work.

| What | Rule |
|---|---|
| Prices and offers | Per product, whoever priced it most recently |
| Items and products | The union; nothing is dropped |
| Stock | A count beats arithmetic, the later count wins; otherwise the higher figure, since a bought pack is a physical fact |
| Hand-added packs | The higher count |
| Barcodes and aliases | Combined, never replaced |
| Meals | The union; a meal held by both keeps the one edited more recently |
| Written lines | The union |
| Deletions | A headstone is kept for each, so the union cannot write a deleted thing back |
| The plan | Taken whole from whichever phone edited it last |

The plan cannot merge sensibly, since two different weeks are not combinable, so if you both plan, agree who owns it. Opening the app checks the database and merges anything new, naming who it came from; turn that off under Settings → Sync and a banner offers it instead. Leaving the app or switching away saves, which is the only reliable moment on a phone. If you push and someone beat you to it, the app refuses and tells you to pull first. Times are UK wall-clock.

**What syncs.** `prices.json` holds items, meals, the plan and the budget. Tokens and keys live in IndexedDB on the device and are never written to it. IndexedDB is the source of truth; sync is a deliberate snapshot push, not a live database, so Git history gives you free price history (`git log -p prices.json`). The manual backup lists items in the order the Items tab groups them, since it is read as often as pasted back; restoring ignores the order.

**Security.** Everything on a Pages site is public, so no keys are in the repo. The token is fine-grained, scoped to one repo and one permission; revoke it from GitHub if a device is lost. Keys in device storage are readable by anything that gets script execution on the page, a fair trade for a personal tool and the only option without a server.

## Using it

**One way to choose.** An item, a meal or a product is chosen with the same picker: a search over the rows and a tap, in a layer above whatever is open. A short list skips the search. Cancel, back, or a tap beside it changes nothing. Only short fixed lists (offer kind, pack unit) are native selects.

**Questions and undo.** The app never uses the browser's own `prompt()` or `confirm()`. Anything that cannot be taken back (delete an item or a meal, reset, clear the plan) asks in the app, says what will go, and can be cancelled. Anything routine just happens and a toast offers **Undo** for a few seconds: ticking **Got it**, taking hand-added packs off, striking off a written line, removing a written-in meal. Undo puts back exactly what was there.

**Sheets.** Tapping beside a sheet that holds work does not close it; Close is in the corner. Only read-only sheets dismiss on a tap outside. Sheets keep a scroll gesture to themselves. An edit that moves a card keeps the card under your thumb: it is measured before the rebuild and put back on the same line of the screen afterwards.

**Phones.** The page is pinned at 1:1 and pinch zoom is refused (viewport meta, `touch-action: manipulation`, and refusing `gesturestart` on iOS, since no one alone is enough). **No text box or select is under 16px**, because Safari zooms the page when you tap a smaller one and does not zoom back. **Nothing tappable is under 44px** either way, and a test walks the screens asserting it.

**Back.** In the installed app the back gesture never leaves it: it closes the picker, the camera, then the sheet on top (a sheet opened from Settings returns to Settings), then goes to the List, and past that is absorbed. A browser cannot switch the button off, only keep an entry in front of the one it would fall to, so this is done only when running as an app (any display mode but a browser tab, or a launch from the Android app shell); in a browser tab back is how you leave. **The guard waits for the first tap on the page.** Firefox only goes back to an entry the page was tapped on, and skips the rest, so an entry laid down at load, before any tap, makes Back fall straight through to the blank page the app was launched from; before that first tap the browser's own back applies. The entry is then laid down again whenever it is missing, and **Settings → About → Back button** keeps a trail of what the page saw on each press, which survives closing the app, so a blank page after Back can be read off afterwards.

**Folds.** Open sections are remembered by kind, not by product: open nutrition on one item and it is open on all of them. A folded section still shows a summary (*4 a pack, 142g each*, *3 for £8*), and renders nothing at all, so a long editor is genuinely shorter to scroll.

**Appearance** is under Settings → Appearance: light, dark or system, and an accent colour. The theme is applied before first paint, so a dark phone never flashes white.

## When something goes wrong

A failed save says so on screen and tells you to take a backup. A screen that will not draw says what went wrong instead of freezing. All of it, plus anything the browser catches, goes into **Settings → About → Problems**, which says how many are recorded without being opened. The log lives in `localStorage`, deliberately not IndexedDB: the failures most worth recording are the ones where storage is the problem. **Copy all of it** adds the app version and browser, which is most of any bug report, and nothing about what you eat.

If the page sits on "Loading.", a module failed to load, nearly always a file that did not upload or a stale copy on the server. After five seconds the app shows the actual error and the files it expects. A private window bypasses the service worker, so if it works there and not normally, bumping `CACHE` in `sw.js` fixes it. Your data is never involved: it lives in IndexedDB.

## For whoever edits it

```
index.html              shell
styles.css              the design system and the spacing utilities
app.js                  state, rendering, actions
lib/calc.js             shopping maths, search
lib/store.js            IndexedDB, seed data, migration, merge, receipt matching
lib/scan.js             live barcode and QR scanning
lib/qr.js               QR encoder for invite codes
lib/vendor/             wasm barcode decoder, only loaded by Firefox and Safari
lib/vision.js           receipt and label reading, Gemini or Claude
lib/sync.js             GitHub contents API
lib/log.js              what went wrong, kept outside IndexedDB on purpose
sw.js                   offline cache
manifest.webmanifest    home screen install
tests/                  the test suite
package.json            devDependency on Playwright, for the tests only
docs/                   REVIEW.md (the review and plan), VISION.md (where it is going)
```

`package.json` is not part of the app: nothing here is built, bundled or installed to deploy it. No framework. Rendering is a full `innerHTML` rebuild; inputs are uncontrolled and commit on `change`, so a rebuild never interrupts typing; buttons and inputs are wired by `data-act` through one delegated listener. The camera overlay lives outside the render tree because a rebuild would kill the video stream. Deleting something leaves a headstone in `db.deleted`. Anything added to the database shape needs `seed()`, `migrate()` and `mergeSnapshots()`. No inline `style=` for spacing: use the utilities in `styles.css`.

### Tests

```
npm install                     once, to get Playwright
npx playwright install chromium
npm test                        the lot, a few minutes
npm test -- sync meal           only tests whose name contains one of these
```

`tests/run.mjs` serves the repo on a port of its own and runs each test as its own process, so there is nothing to start first and one wedged browser cannot take the rest down. It serves everything `no-store`: a test that passes because the browser kept yesterday's `app.js` is worse than none. Tests that plan from a fixed date pin the clock with `pinClock`, and answer the app's questions with `answer` and its picker with `pick` (all in `tests/browser.mjs`).

There are two kinds. **Rules**, run in Node against `lib/` with no browser: `sync-test` is the important one, every way a change can fail to reach the other person. **The app**, driven in a real Chromium through its own buttons: `two-phones-test` runs two profiles against one fake shared file and checks that a rename, a new item, a planned day and a deletion all survive the round trip. `tests/fixtures/sample-list.json` is a manufactured list the size and shape of a real one (37 items, a dozen meals, offers, barcodes, part-filled stock, two empty meals), and tests derive their expected numbers from it. `tests/validate-backup.mjs` is a tool as well: point it at a real export before restoring one, and it checks the file migrates without losing anything and reports what it noticed.

Every push runs the suite on GitHub Actions (`.github/workflows/test.yml`).

### Notes

- **The old name stays in storage.** The app was first called Fortnight Shop, so the database is `fortnight-shop` and the offline caches start `fortnight-shop-v`. Only what is on screen says Weekly Shop: renaming the storage would leave every phone with an empty database.
- **Bump `CACHE` in `sw.js`** whenever you change a file, or the service worker keeps serving the old copy.
- **Scanning needs HTTPS**, which Pages gives you.
- **Barcode decoding** uses the browser's own `BarcodeDetector` where it exists (Chromium). Firefox and Safari lazily load a vendored wasm decoder from `lib/vendor/` on first scan: a one-off megabyte, cached afterwards, with no third-party requests.
- **Model names** are editable under Settings → Sync → *Database, keys and backup*. If receipt accuracy disappoints on crumpled thermal paper, try a larger model.
- **Multibuy and loyalty prices** come through as the amount actually charged, which suits budgeting but looks oddly low if you later buy the item at full price.

### Known limits

- Correcting the start of the week slides the plan the other way, so a meal planned for Wednesday stays on Wednesday. Days pushed outside the plan are gone, and the app says how many.
- The app does not suggest buying more to reach a multibuy threshold; it shows the terms and leaves it to you.
- Pack sizes are assumed stable. If a product shrinks, update Portions per pack by hand.
- Two receipt lines with the same name become two separate items, usually right for two different tuna tins. Rename one to merge them.
- Loose produce sold by weight fits awkwardly into a portions-per-pack model. Treat a typical purchase as one pack.
