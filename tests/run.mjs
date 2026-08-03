/* Runs every test in this folder.

   It serves the app itself, on a port of its own, so there is nothing to start
   first and nothing left running afterwards. Each test is a separate process:
   one that hangs or crashes cannot take the rest down with it, and a browser
   left open dies with its process.

   node tests/run.mjs             every test
   node tests/run.mjs sync meal   only tests whose name contains one of these
*/
import { createServer } from "http";
import { readFile } from "fs/promises";
import { readdirSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { extname, join, normalize } from "path";

const here = new URL(".", import.meta.url).pathname;
const root = join(here, "..");
const only = process.argv.slice(2);

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".wasm": "application/wasm", ".webmanifest": "application/manifest+json",
};

/* Deliberately not a cache-friendly server: a test that passes because the
   browser held yesterday's app.js is worse than no test. */
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split("?")[0]));

  /* One deliberately slow file, so the service worker's "give up on a slow
     network" rule can be tested against a real slow network rather than a
     mock. Four seconds, comfortably past the worker's three. */
  if (path.includes("__slow")) {
    await new Promise((r) => setTimeout(r, 4000));
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    res.end("export const slow = true;\n");
    return;
  }

  if (path.includes("..")) {
    res.writeHead(403).end();
    return;
  }
  const file = join(root, path.endsWith("/") ? path + "index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      // the service worker has to be allowed to claim the whole site
      "Service-Worker-Allowed": "/",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
});

const port = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const base = `http://localhost:${port}`;
console.log(`serving ${root} on ${base}\n`);

mkdirSync(join(here, "output"), { recursive: true });

const tests = readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && !["run.mjs", "browser.mjs"].includes(f))
  .filter((f) => !only.length || only.some((want) => f.includes(want)))
  .sort();

const run = (file) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(here, file)], {
      env: { ...process.env, FS_BASE: base },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    /* Long enough for a slow cold start on a shared runner, short enough that
       a wedged browser does not hold the whole run for ever. */
    const timer = setTimeout(() => child.kill("SIGKILL"), 240000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ file, code, out, ms: Date.now() - started });
    });
  });

const results = [];
for (const file of tests) {
  const r = await run(file);
  results.push(r);
  const name = file.replace(/\.mjs$/, "");
  const secs = `${(r.ms / 1000).toFixed(1)}s`;
  console.log(`${r.code === 0 ? "ok  " : "FAIL"}  ${name.padEnd(22)} ${secs.padStart(7)}`);
  if (r.code !== 0) {
    /* The named failures first, then the tail of everything. A filter alone
       hid the actual stack once already: a CI log saying only "name: 'Error'"
       cost a round trip to find out what had gone wrong. */
    const lines = r.out.split("\n");
    const named = lines.filter((l) => /^FAIL/.test(l));
    for (const l of named) console.log(`        ${l}`);
    if (named.length) console.log("        --- last of the output ---");
    for (const l of lines.slice(-25)) if (l.trim()) console.log(`        ${l}`);
  }
}

server.close();

const failed = results.filter((r) => r.code !== 0);
const total = (results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1);
console.log(
  `\n${results.length - failed.length}/${results.length} passed in ${total}s` +
    (failed.length ? `\nfailed: ${failed.map((r) => r.file).join(", ")}` : "")
);
process.exit(failed.length ? 1 : 0);
