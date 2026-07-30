# Fortnight Shop


A portion-based meal planner and food budget for UK shopping. Static site, no build step, no server. Prices are captured from receipts and barcodes rather than scraped, so nothing breaks when a supermarket changes its website.

Ported from the Meal_Planner spreadsheet. The maths is identical: portions needed across 14 days, minus what is in stock, rounded up to whole packs, grouped by store. The seeded data reproduces the spreadsheet's £12.60 total exactly.

## Setup, about 15 minutes

1. **Publish the app.** Copy these files into your Pages repo, either at the root or in a subfolder like `/shop/`. Push. Everything is relative-pathed, so a subfolder is fine.
2. **Create a private repo for the data.** Call it `shop-data`. Leave it empty. Private repos are free and unlimited, and Pages never needs to read it.
3. **Make a token.** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens. Repository access: only `shop-data`. Permissions: Contents → Read and write. Nothing else. Copy the token.
4. **Get a Gemini key** from Google AI Studio if you do not already have one. The free tier covers a receipt a week many times over.
5. **Open the site on your phone**, tap Settings, fill in the owner, repo and token, paste the Gemini key, then tap **Push to repo**. That creates `prices.json` on the first push.
6. **Add to Home screen** from the Chrome menu. It then runs full screen and works offline.

## How pricing works

**Receipts** are the bulk update. Photograph the whole receipt flat, the model returns line items with unit prices, and each line is matched to one of your items. You confirm before anything changes.

Matching gets better every shop, because confirming a line saves that receipt's wording as an alias:

| Signal | Confidence | Where it comes from |
|---|---|---|
| Barcode | certain | You scanned it once |
| Saved alias | near certain | You confirmed that receipt wording before |
| Name similarity | a guess | Token overlap, shown for you to check |

So the first receipt needs the most tapping and later ones need almost none. This is why the barcode step during receipt review is worth doing even though it is optional: it builds the barcode library that makes in-store scanning work.

**Offers** are recorded per item on the Items tab, and there are three kinds: a loyalty card price, N for a fixed price, and buy N pay for fewer. Each takes an optional end date, and once that date passes the app quietly reverts to full price rather than flattering the budget with a deal that has finished.

Base price and offer price are kept apart on purpose. A loyalty price applies to every pack, so it feeds portion costs and meal costs. A multibuy depends on how many packs you buy, so it only affects the shopping list total. A meal is not cheaper because you bought three.

That separation is also why receipt lines marked **offer price** are saved as the loyalty price and leave the base price untouched. Without it, the base price would drift down every time a promotion ran and never come back up.

**Barcodes** are the in-store update. Scan an item, type the shelf price, done. The app tells you what changed since last time.

Anything older than 14 days gets a red dot and a banner, so a stale price never quietly costs a shop.

## Adding things by hand

Not everything is a meal ingredient. Tap **+** on any item to put a pack on the shopping list regardless of what is planned, and the line shows as *by hand* so you can tell it apart from what the plan demands. Tapping **Got it** after shopping moves those packs into stock and clears the hand-added count.

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
lib/scan.js             live barcode scanning
lib/vendor/             wasm barcode decoder, only loaded by Firefox and Safari
lib/vision.js           receipt reading, Gemini or Claude
lib/sync.js             GitHub contents API
sw.js                   offline cache
manifest.webmanifest    home screen install
```

No framework. Rendering is a full `innerHTML` rebuild; inputs are uncontrolled and commit on `change`, so a rebuild never interrupts typing. The camera overlay lives outside the render tree because a rebuild would kill the video stream.

## Notes

- **Bump `CACHE` in `sw.js`** whenever you change a file, or the service worker keeps serving the old copy.
- **Scanning needs HTTPS**, which Pages gives you. It will not work over plain HTTP or `file://`.
- **Firefox on Android is fine.** It needs the fallback decoder, which downloads itself on first scan. Nothing to configure.
- **Barcode decoding** uses the browser's own `BarcodeDetector` where it exists, which means Chromium browsers. Firefox and Safari have no such API, so the app lazily loads a vendored wasm decoder from `lib/vendor/` the first time you scan. That is a one-off megabyte, cached by the service worker afterwards, and it makes no third-party requests. Decoding is a little slower than native, so hold the barcode steady for an extra beat.
- **Model names** are editable in Settings. If receipt accuracy disappoints on crumpled thermal paper, try a larger model.
- **Multi-buy and loyalty prices** come through as the amount actually charged, which is usually what you want for budgeting but will look oddly low if you later buy the item at full price.

## Known limits

- One meal per day. Add breakfast and lunch by making them separate meals and extending `plan` beyond 14 entries.
- The app does not suggest buying more to reach a multibuy threshold. It shows the offer terms on the line and leaves the decision to you.
- Pack sizes are assumed stable. If a product shrinks, update Portions per pack by hand.
- Loose produce sold by weight fits awkwardly into a portions-per-pack model. Treat a typical purchase as one pack.
