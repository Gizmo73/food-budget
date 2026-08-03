/* A record of things that went wrong.

   Deliberately in localStorage rather than in IndexedDB with everything else.
   The failures most worth recording are the ones where storage itself is the
   problem — a full quota, a private window, a browser that has decided the
   database is corrupt — and a log kept in the thing that just failed is a log
   that is empty exactly when it is needed.

   Everything here is best effort and swallows its own errors. A logger that
   can throw turns one problem into two, and the second one is invisible. */

const KEY = "fs-log";
const KEEP = 60;

/* Long enough to say what happened, short enough that sixty of them cannot
   fill a storage quota that may already be the reason we are here. */
const MAX_DETAIL = 400;

export function note(what, detail) {
  try {
    const entry = {
      at: new Date().toISOString(),
      what: String(what || "Something went wrong").slice(0, 120),
      detail: String(
        detail && detail.message ? detail.message : detail == null ? "" : detail
      ).slice(0, MAX_DETAIL),
    };
    const all = [entry, ...entries()].slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(all));
    // so a developer console shows it too, without the app having to be open
    if (typeof console !== "undefined") console.warn(`[fortnight-shop] ${entry.what}`, detail);
    return entry;
  } catch (err) {
    return null;
  }
}

export function entries() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((e) => e && e.at && e.what) : [];
  } catch (err) {
    return [];
  }
}

export function clearLog() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    /* nothing useful to do about a storage that will not forget */
  }
}

/* Plain text, for pasting somewhere it can be read by somebody who can act on
   it. Newest first, same as the screen. */
export function logText(version = "") {
  const head = [
    `Fortnight Shop problem log`,
    version ? `app ${version}` : "",
    `taken ${new Date().toISOString()}`,
    typeof navigator !== "undefined" ? navigator.userAgent : "",
    "",
  ].filter(Boolean);
  const lines = entries().map(
    (e) => `${e.at}  ${e.what}${e.detail ? `\n    ${e.detail}` : ""}`
  );
  return [...head, ...(lines.length ? lines : ["(nothing recorded)"])].join("\n");
}
