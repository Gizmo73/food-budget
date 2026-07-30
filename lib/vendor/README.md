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
