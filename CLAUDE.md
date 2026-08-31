# Fortnight Shop

A fortnightly meal planner and shopping list. Static files with no build step:
`index.html`, `app.js`, `styles.css`, `sw.js` and `lib/`, served straight from
GitHub Pages. Nothing here is compiled, so anything committed is what runs.

## Delivering work

**When asked for a feature: open a pull request and merge it to `main`.** This
is standing authorisation — do not stop to ask each time. Develop on a branch,
push it, open the PR, then merge it once the tests pass.

Restart the branch from the latest `main` when its previous PR has already been
merged, rather than stacking new work on merged history.

## Tests

`npm test` runs everything (`node tests/run.mjs`); pass a substring to filter,
e.g. `node tests/run.mjs jottings ui`. The runner serves the app on a port of
its own, so nothing needs starting first.

Most tests drive a real browser through Playwright. Where the installed browser
does not match the pinned Playwright, point `CHROMIUM_PATH` at it:

```
CHROMIUM_PATH=/path/to/chrome node tests/run.mjs
```

A new feature is expected to come with a test. `tests/output/` holds
screenshots and is ignored by git.

## Things worth knowing before editing

- **Rendering is a full `innerHTML` rebuild.** Inputs are uncontrolled and
  commit on `change` (blur or Enter), so a rebuild never interrupts typing.
  Focus and scroll are restored afterwards by `data-act`/`data-field` keys.
- **Buttons and inputs are wired by `data-act`**, dispatched through one
  delegated listener into the `actions` map. There are no per-element handlers.
- **The database is shared between phones and merged, not overwritten.** A
  deletion therefore has to leave a headstone in `db.deleted`, or the union in
  `mergeSnapshots` writes the deleted thing straight back.
- **Anything added to the database shape** needs handling in `seed()`,
  `migrate()` and `mergeSnapshots()` in `lib/store.js`.
- **`sw.js` caches the app shell.** Adding a file the app loads means adding it
  to `SHELL` and bumping `CACHE`, or phones will run a half-old set of files.
