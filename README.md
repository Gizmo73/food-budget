# Fortnight Shop

A portion-based meal planner and food budget for UK shopping. Static site, no build step, no server. Prices are captured from receipts and barcodes rather than scraped, so nothing breaks when a supermarket changes its website.

Ported from the Meal_Planner spreadsheet. The maths is identical: portions needed across 14 days, minus the portions in stock, rounded up to whole packs, grouped by store. The seeded data reproduces the spreadsheet's £12.60 total exactly.

## Setup, about 15 minutes

1. **Publish the app.** Copy these files into your Pages repo, either at the root or in a subfolder like `/shop/`. Push. Everything is relative-pathed, so a subfolder is fine.
2. **Create a private repo for the data.** Call it `shop-data`. Leave it empty. Private repos are free and unlimited, and Pages never needs to read it.
3. **Make a token.** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens. Repository access: only `shop-data`. Permissions: Contents → Read and write. Nothing else. **Set the expiry to the longest offered**, because the default is 30 days and syncing simply stops when it lapses. Copy the token.
4. **Get a Gemini key** from Google AI Studio if you do not already have one. The free tier covers a receipt a week many times over.
5. **Open the site on your phone**, tap Settings, fill in the owner, repo and token, paste the Gemini key, then tap **Push to repo**. That creates `prices.json` on the first push.
6. **Add to Home screen** from the Chrome menu. It then runs full screen and works offline.

## How pricing works

**Receipts** are the bulk update. Photograph the whole receipt flat, the model returns line items with unit prices and quantities, and each line is matched to one of your items. You confirm before anything changes.

**A receipt is dated evidence, not the current truth.** The date is read off the photo, shown beside the store and editable if the model misread it, and it is the date recorded against every price on that receipt. So entering a shop a week late no longer outranks corrections you made in between. Any line whose item has been updated since that date is switched off automatically and labelled **old price**, naming what changed and when; tick it back on if you disagree. Correcting the date brings those lines back.

The comparison is by day, not to the minute. A receipt photographed this afternoon and a price you fixed this morning are treated as equal standing, because a receipt carries no time of day and inventing one would only produce false alarms.

**A line that matches nothing now defaults to being added as a new item**, rather than to being ignored. Ignoring was the safe-looking default and the wrong one: it quietly dropped everything you had not recorded yet.

A confirmed line also puts stock in, since a receipt is proof you bought the thing. Each line carries an **Into stock** figure in portions, worked out from the quantity on the receipt times that item's portions per pack, with ± stepping a whole pack at a time. It is editable because a receipt often cannot tell your items apart: three yoghurts on one line may be three flavours you keep separately, so knock that line down to one pack and put the others where they belong. Set it to 0 to record the price and nothing else. Pointing a line at a different item re-derives the figure, because portions are a different size on a different item.

Matching gets better every shop, because confirming a line saves that receipt's wording as an alias:

| Signal | Confidence | Where it comes from |
|---|---|---|
| Barcode | certain | You scanned it once |
| Saved alias | near certain | You confirmed that receipt wording before |
| Name similarity | a guess | Token overlap, shown for you to check |

So the first receipt needs the most tapping and later ones need almost none. This is why the barcode step during receipt review is worth doing even though it is optional: it builds the barcode library that makes in-store scanning work.

**Offers** are recorded per item on the Items tab, and there are three kinds: a loyalty card price, N for a fixed price, and buy N pay for fewer. Each takes an optional end date, and once that date passes the app quietly reverts to full price rather than flattering the budget with a deal that has finished.

Base price and offer price are kept apart on purpose. A loyalty price applies to every pack, so it feeds portion costs and meal costs. A multibuy depends on how many packs you buy, so it only affects the shopping list total. A meal is not cheaper because you bought three.

That separation is also why every receipt line carries a **Paid** choice: full price, card price, or multibuy. Both offer kinds leave the base price untouched, otherwise the base would drift down every time a promotion ran and never come back up.

Getting that choice right matters more than it looks. A "3 for £8" deal recorded as a card price of £2.67 tells the app a single pack costs £2.67, when a single pack actually costs £3.75. Every portion cost, meal cost and budget total downstream is then wrong. Recorded as a multibuy, one pack stays £3.75 and the deal only applies once three are on the list.

The offer editor spells out which you have, in words: *"One pack still costs £3.75. Only at 3 does the deal apply"* versus *"Every pack costs £2.67, however many you buy."*

**Barcodes** are the in-store update. Scan an item, type the shelf price, done. The app tells you what changed since last time.

Anything older than 14 days gets a red dot and a banner, so a stale price never quietly costs a shop.

## Sharing with someone else

Two people can use one shared price list, and there are two ways in.

**The invite code** is the short one. On the phone that is already set up, tap **Settings → Invite someone**. That produces a QR code and a text code carrying the database details and the token. On the other phone, **Settings → Enter an invite**, scan it or paste it, done. They need no GitHub account, no token and no invite to the repo, and joining merges their list into yours rather than replacing either.

Be clear about what that code is: **a key to your list**. Anyone holding it can read and change your prices until you change the token on GitHub. Show it to the person in front of you rather than leaving it in a chat that lives forever. One token then serves everybody, so removing one person means issuing a new token and re-inviting whoever stays.

Attribution survives it anyway. Who did what comes from the **Your name** field on each device, not from the token, so a shared token still produces "Sam saved 10 minutes ago" and a commit log naming them.

**Their own token** is the longer way, and the only reason to prefer it is revoking one person without disturbing the other. On GitHub, open the `shop-data` repo, go to **Settings → Collaborators**, and invite them. They then create their own fine-grained token the same way you did, open the same app URL, and enter the same owner and repo with their own token. **Set the expiry to the longest GitHub offers**: the default is 30 days, and when it lapses the app simply stops saving, reporting only that the token was rejected.

The QR code is generated on the device by `lib/qr.js`, written for this app rather than pulled from a library or an image service, because the code being drawn contains a token with write access and it should never leave the phone.

**Pull merges, it does not overwrite.** That matters, because otherwise whoever pushed second would wipe the other's work. The rules:

| What | Rule |
|---|---|
| Prices and offers | Per item, whoever priced it most recently wins |
| Items | The union of both sides, nothing is dropped |
| Stock and hand-added packs | The higher count, since a bought pack is a physical fact. Stock compares in portions |
| Barcodes and aliases | Combined, never replaced |
| Meals | The union |
| Meal plan | Taken whole from whichever device saved last |

The meal plan is the one thing that cannot merge sensibly, since two different fortnights are not combinable. If you both plan meals, agree who owns the plan.

Opening the app checks the database and merges anything new automatically, naming who it came from. Turn that off under Settings and you get a banner offering the merge instead. Leaving the app or switching away saves your changes, which is the only reliable moment to do it on a phone; desktop browsers additionally warn before you close a tab with unsaved work.

Times are shown in UK wall-clock time, so they read correctly through British Summer Time rather than an hour behind. If you push and someone beat you to it, the app refuses and tells you to pull first rather than clobbering them.

## When things were last updated

Every item carries a **Last updated** stamp, shown in its editor. Two shapes of stamp exist on purpose:

| Source | Recorded as | Why |
|---|---|---|
| An edit by hand | the minute it was made | So two changes on one day still have an order |
| A shelf scan | the minute it was made | Same, and you are standing at the shelf |
| A receipt | the day printed on it | A receipt genuinely does not know the time |

That ordering is what stops an old receipt overwriting a correction, and it is also what decides who wins when two phones have both changed the same item: whoever priced it most recently.

The price stamp and the last-updated stamp are separate. Renaming an item or fixing its portions per pack updates the item without pretending the price was rechecked, so the red stale-price dot still means what it says.

## Portions per pack

New items default to **1**, meaning one pack is one use. That is right for water, kitchen roll, cleaning products and anything else you do not divide into servings, and it is the safe default because it can never under-order.

Raise it for genuinely portioned things: a 500g bag of pasta that does four meals is 4, a jar of sauce that does two is 2.

Setting it to 0 is a trap the app now guards against. An item a planned meal needs but with no portions per pack cannot produce a pack count, so it used to vanish from the shopping list without a word. The list now names those items in red instead.

## Stock is counted in portions

**In stock is a portion count, not a pack count.** An opened pack is the normal case, and a pack that is half gone should not be offered to the planner as a whole one.

The arithmetic follows from that. A pack of pies does 4 portions and 2 are left, so stock is 2. Plan a meal wanting 4 and the deficit is 2 portions, which is less than a pack but cannot be bought as less than a pack, so a whole pack goes on the list and 2 portions show as left over. Stock only cancels a pack when it genuinely covers the portions the plan asks for.

Everything that hands you packs converts on the way in, because shelves and receipts count in packs:

| Where | What you enter | What is stored |
|---|---|---|
| Items tab, In stock | portions | portions |
| Items tab, ± pack | one pack | portions per pack |
| Got it, on the list | the packs bought | packs × portions per pack |
| Scan an item | packs in the trolley | packs × portions per pack |
| Receipt review, Into stock | portions, pre-filled from the receipt | portions |

Old data migrates itself on first open: a stored count of 2 packs at 4 portions each becomes 8 portions. Where portions per pack was never set, a pack counts as one portion, which matches what the shopping list already assumed. Nothing needs re-entering, and the conversion runs once.

## Adding things by hand

Not everything is a meal ingredient. Tapping an item opens it for editing, and tapping it again closes it. Tap **+** on any item to put a pack on the shopping list regardless of what is planned, and the line shows as *by hand* so you can tell it apart from what the plan demands. Tapping **Got it** after shopping turns those packs into portions of stock and clears the hand-added count.

New items start with **no store**, and land in an *Unassigned* group that sorts to the top of the Items tab until you file them. Guessing a store would be worse than leaving it empty, because an item in the wrong group is harder to spot than one in an obviously empty one. Receipts are the exception: the receipt tells you which shop it was, so items created from one inherit it.

Store names are folded to one spelling on the way in, because receipts shout: `ASDA` becomes Asda, `SAINSBURYS` becomes Sainsbury's, `CO-OP` and `co op` both become Co-op. A spelling already in your data always wins, so if you typed something a particular way it stays that way. Anything unrecognised gets plain title case, and grouping ignores case regardless as a backstop.

Both the shopping list and the Items tab group by store, and each store heading collapses. That state is remembered per device rather than synced, since it is a view preference rather than data.

## What syncs and what does not

`prices.json` holds items, meals, the plan and the budget. Tokens and API keys live in IndexedDB on the device and are never written into that file, so nothing secret can end up committed.

IndexedDB is the source of truth. Sync is a deliberate snapshot push, not a live database, because a commit per keystroke would be slow and would conflict across devices. Git history then gives you free price history: `git log -p prices.json` shows every price change you have ever made.

If the remote copy is newer than your last pull, Push warns before overwriting. Last write wins otherwise, so pull before editing on a second device.

## Security position

Everything on a Pages site is public, whether through the repo itself or through view-source. So:

- No keys in the repo. They are entered in the app and stored on the device only.
- The token is fine-grained and scoped to one repo with one permission. Revoke it from GitHub if a device is lost.
- Keys in device storage are readable by anything that achieves script execution on the page. For a personal tool on your own phone that is a reasonable trade, and it is the only option without a server.

## Files

```
index.html              shell
styles.css              shelf-edge ticket design system
app.js                  state, rendering, actions
lib/calc.js             shopping maths, ported from the spreadsheet
lib/store.js            IndexedDB, seed data, receipt line matching
lib/scan.js             live barcode and QR scanning
lib/qr.js               QR encoder for invite codes
lib/vendor/             wasm barcode decoder, only loaded by Firefox and Safari
lib/vision.js           receipt reading, Gemini or Claude
lib/sync.js             GitHub contents API
sw.js                   offline cache
manifest.webmanifest    home screen install
```

No framework. Rendering is a full `innerHTML` rebuild; inputs are uncontrolled and commit on `change`, so a rebuild never interrupts typing. The camera overlay lives outside the render tree because a rebuild would kill the video stream.

## Appearance

Light, dark or follow the system, under Settings. The theme is applied before first paint, so a dark-mode phone never flashes white on open.

## Finding things

The Items tab has a search box that matches loosely: `chkkrm` finds Chicken Korma, and it searches store names, barcodes and remembered receipt wording as well as item names. Searching temporarily opens every store group that has a hit, and clearing it puts your collapsed groups back as they were.

## If the page sits on "Loading."

That means a module failed to load, and it is nearly always a file that did not upload or a stale copy on the server. After five seconds the app now replaces the blank page with the actual error and the list of files it expects, so read that rather than guessing.

Two things worth knowing when it happens. A private window bypasses the service worker, so if the app works there and not normally, the cache is stale and bumping `CACHE` in `sw.js` fixes it. And your saved data is never involved: it lives in IndexedDB, not in the files being served.

## Notes

- **Bump `CACHE` in `sw.js`** whenever you change a file, or the service worker keeps serving the old copy.
- **Scanning needs HTTPS**, which Pages gives you. It will not work over plain HTTP or `file://`.
- **Firefox on Android is fine.** It needs the fallback decoder, which downloads itself on first scan. Nothing to configure.
- **Barcode decoding** uses the browser's own `BarcodeDetector` where it exists, which means Chromium browsers. Firefox and Safari have no such API, so the app lazily loads a vendored wasm decoder from `lib/vendor/` the first time you scan. That is a one-off megabyte, cached by the service worker afterwards, and it makes no third-party requests. Decoding is a little slower than native, so hold the barcode steady for an extra beat.
- **Model names** are editable in Settings. If receipt accuracy disappoints on crumpled thermal paper, try a larger model.
- **Multi-buy and loyalty prices** come through as the amount actually charged, which is usually what you want for budgeting but will look oddly low if you later buy the item at full price.

## Known limits

- Each day has breakfast, lunch and dinner. Breakfast and lunch usually repeat, so the Plan tab has a **Repeat** button per slot that copies day one into every empty day of that slot.
- The app does not suggest buying more to reach a multibuy threshold. It shows the offer terms on the line and leaves the decision to you.
- Pack sizes are assumed stable. If a product shrinks, update Portions per pack by hand.
- Two receipt lines with the same name become two separate items, which is usually right for two different tuna tins. Rename one if you would rather merge them.
- Loose produce sold by weight fits awkwardly into a portions-per-pack model. Treat a typical purchase as one pack.
