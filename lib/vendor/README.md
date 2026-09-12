# Vendored barcode decoder

`barcode-polyfill.js` is [barcode-detector](https://github.com/Sec-ant/barcode-detector) v3.2.1
bundled to a single ES module, wrapping zxing-wasm v3.1.1. `zxing_reader.wasm` is its decoder.

Used only when the browser has no built-in `BarcodeDetector`, which means Firefox and Safari.
Chromium browsers never download these files.

The bundle is patched to load the wasm from this folder rather than a CDN, so scanning
works offline and the app makes no third-party requests.

To rebuild:

    npm install barcode-detector@3.2.1
    # entry.js: re-export BarcodeDetector, setZXingModuleOverrides locateFile -> ./zxing_reader.wasm
    npx esbuild entry.js --bundle --format=esm --minify --outfile=barcode-polyfill.js
    cp node_modules/zxing-wasm/dist/reader/zxing_reader.wasm .

# Vendored fonts

`fonts/inter-latin-var.woff2` is the Inter variable font's latin subset, taken from Google
Fonts (`css2?family=Inter:wght@400;500;600`, the `/* latin */` block only). One file covers
weights 400/500/600 via the variable axis. `LICENSE-inter` is the SIL Open Font License.

`fonts/phosphor-regular.css` and `fonts/phosphor-regular.woff2` are Phosphor Icons v2.1.1's
regular weight, taken from the `phosphor-icons/web` repo (`src/regular/`). The CSS's
`@font-face` was edited to point at the woff2 alone — the repo also ships woff/ttf/svg
fallbacks, dropped here since every browser this app targets understands woff2.
`LICENSE-phosphor` is its MIT license.

Both are vendored for the same reason as the barcode decoder: `sw.js` can only cache files
on this origin, and a phone with no signal in a shop still needs its type and icons to
render. Rebuild by re-fetching the same URLs and re-applying the `Phosphor.woff2` rename.
