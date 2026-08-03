/* Launching a browser, in a way that works both on a machine that has run
   `npm install` and on one where Playwright is installed globally. The tests
   all go through this rather than hard-coding a path to somebody's disk. */
let cached = null;

export async function playwright() {
  if (cached) return cached;
  try {
    cached = await import("playwright");
  } catch (err) {
    // a globally installed copy, which is how the sandboxes here have it
    cached = await import("/opt/node22/lib/node_modules/playwright/index.js");
  }
  return cached.default || cached;
}

/* Chromium is found by Playwright itself: either where npm put it, or where
   PLAYWRIGHT_BROWSERS_PATH points. CHROMIUM_PATH overrides both, for the case
   where a project pins a different Playwright than the browser on disk. */
export async function browser(opts = {}) {
  const pw = await playwright();
  const path = process.env.CHROMIUM_PATH;
  return pw.chromium.launch(path ? { ...opts, executablePath: path } : opts);
}

export const BASE = process.env.FS_BASE || "http://localhost:8123";

/* Where a test may leave a screenshot. Handy locally, ignored by git. */
export const SHOTS = new URL("./output/", import.meta.url).pathname;
