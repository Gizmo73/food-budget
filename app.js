/* Fortnight Shop.
   No framework and no build step, so this file can be edited on a phone and
   pushed straight to Pages. Rendering is a full innerHTML rebuild; inputs are
   uncontrolled and commit on "change" (blur or Enter), so a rebuild never
   interrupts typing. The camera overlay lives outside the render tree because
   a rebuild would kill the video stream. */

import {
  loadDb, saveDb, loadSettings, saveSettings, seed, migrate, newIngredient,
  resolveLine, norm, uid, slug,
} from "./lib/store.js";
import { computeShopping, mealCost, portionCost, money, today, daysSince, STALE_DAYS } from "./lib/calc.js";
import { scanSupported, decoderKind, startScan, decodeStill } from "./lib/scan.js";
import { readReceipt } from "./lib/vision.js";
import { pull, push } from "./lib/sync.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const root = document.getElementById("app");

const state = { db: null, settings: null, tab: "list", sheet: null, flash: null, calc: null };

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const trim2 = (n) => String(Math.round(n * 100) / 100);

function titleise(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .slice(0, 30) || "New item";
}

/* ------------------------------ state plumbing ------------------------- */

let saveTimer = null;

function commit(mutator) {
  mutator(state.db);
  state.db.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDb(state.db).catch(() => {}), 300);
  draw();
}

function setSheet(sheet) {
  state.sheet = sheet;
  draw();
}

function flash(kind, text) {
  state.flash = { kind, text };
  draw();
}

const ingredient = (id) => state.db.ingredients.find((i) => i.id === id);

function patchIngredient(id, changes) {
  commit((db) => {
    const i = db.ingredients.findIndex((x) => x.id === id);
    if (i >= 0) db.ingredients[i] = { ...db.ingredients[i], ...changes };
  });
}

/* --------------------------------- views ------------------------------- */

function draw() {
  state.calc = computeShopping(state.db);
  const sheetScroll = document.querySelector(".sheet") ? document.querySelector(".sheet").scrollTop : null;
  const pageScroll = window.scrollY;

  root.innerHTML = [
    viewMasthead(),
    `<div class="wrap">`,
    state.flash ? `<div class="${state.flash.kind === "err" ? "err" : "ok"}">${esc(state.flash.text)}</div>` : "",
    { list: viewList, plan: viewPlan, meals: viewMeals, items: viewItems }[state.tab](),
    `</div>`,
    viewTabs(),
    viewSheet(),
  ].join("");

  window.scrollTo(0, pageScroll);
  if (sheetScroll !== null) {
    const s = document.querySelector(".sheet");
    if (s) s.scrollTop = sheetScroll;
  }
}

function viewMasthead() {
  const c = state.calc;
  return `<header class="masthead"><div class="row">
    <div class="grow">
      <h1>Fortnight Shop</h1>
      <p>${c.plannedDays} of 14 days planned &middot; ${state.db.ingredients.length} items priced by hand</p>
    </div>
    <button class="btn small ghost" data-act="openSettings">Settings</button>
  </div></header>`;
}

function viewTabs() {
  const c = state.calc;
  const tabs = [
    ["list", "List", c.lines.length],
    ["plan", "Plan", c.plannedDays],
    ["meals", "Meals", state.db.meals.length],
    ["items", "Items", state.db.ingredients.length],
  ];
  return `<nav class="tabs">${tabs
    .map(
      ([key, label, n]) =>
        `<button data-act="tab" data-tab="${key}" data-on="${state.tab === key ? 1 : 0}">
          <span class="cnt">${n}</span>${label}</button>`
    )
    .join("")}</nav>`;
}

/* ---- list ---- */

function viewList() {
  const c = state.calc;
  const over = c.total > state.db.budget;
  const pct = state.db.budget > 0 ? Math.min(1, c.total / state.db.budget) : 0;
  const [whole, pence] = money(c.total).split(".");

  const stale = c.staleCount
    ? `<div class="warn"><strong>${c.staleCount}</strong> ${c.staleCount === 1 ? "price is" : "prices are"}
       over ${STALE_DAYS} days old. Shoot your next receipt to refresh them.</div>`
    : "";

  const body = c.lines.length
    ? c.stores
        .map(
          (store) => `<section class="card">
        <div class="row" style="margin-bottom:4px">
          <span class="eyebrow grow">${esc(store.name)}</span>
          <span class="num muted">£${money(store.total)}</span>
        </div>
        ${store.lines.map(ticket).join("")}
      </section>`
        )
        .join("")
    : `<div class="empty">Nothing to buy. Plan meals on the Plan tab, or reduce stock on Items.</div>`;

  return `
    <div class="row" style="gap:8px;margin-bottom:10px">
      <button class="btn solid grow" data-act="openReceipt">Read a receipt</button>
      <button class="btn grow" data-act="openScan">Scan an item</button>
    </div>
    ${stale}
    ${body}
    <div class="till">
      <div class="line"><span class="lbl">Total</span><span class="leader"></span>
        <span class="big">£${whole}.<em>${pence}</em></span></div>
      <div class="bar${over ? " over" : ""}"><span style="width:${Math.round(pct * 100)}%"></span></div>
      <div class="row" style="margin-top:8px">
        <span class="lbl grow">${
          over ? `£${money(c.total - state.db.budget)} over budget` : `£${money(state.db.budget - c.total)} left`
        }</span>
        <input class="inp mono" style="width:82px;padding:5px 7px;text-align:right" type="number"
          step="1" min="0" value="${state.db.budget}" data-act="setBudget" aria-label="Budget in pounds">
      </div>
    </div>
    <p class="muted">Whole packs only, less what you already have. Tap "Got it" after shopping to move packs into stock.</p>
    <div class="spacer"></div>`;
}

function ticket(l) {
  const [w, p] = money(l.cost).split(".");
  const bits = [`${l.packs} pack${l.packs === 1 ? "" : "s"} @ £${money(l.ing.pricePerPack)}`];
  if (l.ing.packLabel) bits.push(esc(l.ing.packLabel));
  if (l.leftover > 0.001) bits.push(`${trim2(l.leftover)} left over`);
  return `<div class="ticket">
    <div class="grow">
      <div class="name trunc">${l.stale ? '<span class="dot"></span>' : ""}${esc(l.ing.name)}</div>
      <div class="meta">${bits.join(" · ")}</div>
    </div>
    <span class="leader"></span>
    <div style="text-align:right">
      <div class="price">£${w}.<em>${p}</em></div>
      <button class="btn small ghost" style="margin-top:3px" data-act="bought" data-id="${l.ing.id}"
        data-packs="${l.packs}">Got it</button>
    </div>
  </div>`;
}

/* ---- plan ---- */

function viewPlan() {
  const c = state.calc;
  const options = (selected) =>
    [`<option value="">—</option>`]
      .concat(
        state.db.meals.map(
          (m) => `<option value="${m.id}"${m.id === selected ? " selected" : ""}>${esc(m.name)}</option>`
        )
      )
      .join("");

  const week = (w) => {
    const subtotal = c.dayCost.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0);
    const rows = DAYS.map((name, i) => {
      const idx = w * 7 + i;
      return `<div class="day">
        <span class="dname">${name.slice(0, 3)}</span>
        <select data-act="setDay" data-idx="${idx}" aria-label="${name} week ${w + 1}">${options(state.db.plan[idx])}</select>
        <span class="cost">${c.dayCost[idx] > 0 ? "£" + money(c.dayCost[idx]) : ""}</span>
      </div>`;
    }).join("");
    return `<section class="card">
      <div class="row" style="margin-bottom:6px">
        <span class="eyebrow grow">Week ${w + 1}</span>
        <span class="num muted">£${money(subtotal)}</span>
      </div>${rows}</section>`;
  };

  return `${week(0)}${week(1)}
    <p class="muted">Day costs are portion costs, so they show what a meal is worth. The List tab rounds up to whole packs.</p>
    <button class="btn ghost wide" data-act="clearPlan">Clear both weeks</button>
    <div class="spacer"></div>`;
}

/* ---- meals ---- */

function viewMeals() {
  const byId = Object.fromEntries(state.db.ingredients.map((i) => [i.id, i]));
  const open = state.sheet && state.sheet.kind === "meal" ? state.sheet.id : null;

  const cards = state.db.meals
    .map((meal) => {
      const cost = mealCost(meal, byId);
      if (meal.id !== open) {
        return `<section class="card"><div class="row" data-act="openMeal" data-id="${meal.id}">
          <div class="grow">
            <div style="font-weight:700">${esc(meal.name)}</div>
            <div class="muted">${meal.items.length} ingredient${meal.items.length === 1 ? "" : "s"}</div>
          </div>
          <span class="num" style="font-weight:700">£${money(cost)}</span>
          <button class="btn small ghost" data-act="openMeal" data-id="${meal.id}">Edit</button>
        </div></section>`;
      }

      const picker = (selected) =>
        state.db.ingredients
          .map((i) => `<option value="${i.id}"${i.id === selected ? " selected" : ""}>${esc(i.name)}</option>`)
          .join("");

      const rows = meal.items
        .map(
          (it, i) => `<div class="row" style="margin-bottom:6px">
        <select class="inp grow" data-act="setMealIng" data-id="${meal.id}" data-i="${i}">${picker(it.ingredientId)}</select>
        <input class="inp mono" style="width:74px;text-align:right" type="number" step="0.05" min="0"
          value="${it.portions}" data-act="setMealPortions" data-id="${meal.id}" data-i="${i}" aria-label="Portions">
        <button class="btn small danger" data-act="delMealIng" data-id="${meal.id}" data-i="${i}" aria-label="Remove">×</button>
      </div>`
        )
        .join("");

      return `<section class="card">
        <div class="row"><span class="eyebrow grow">Editing</span>
          <button class="btn small ghost" data-act="closeSheet">Close</button></div>
        <label class="field" style="margin:8px 0">
          <span class="eyebrow">Meal name</span>
          <input class="inp" value="${esc(meal.name)}" data-act="setMealName" data-id="${meal.id}">
        </label>
        ${rows || '<p class="muted">No ingredients yet.</p>'}
        <div class="row" style="margin-top:8px;gap:8px">
          <button class="btn small grow" data-act="addMealIng" data-id="${meal.id}"${
        state.db.ingredients.length ? "" : " disabled"
      }>Add ingredient</button>
          <button class="btn small danger" data-act="delMeal" data-id="${meal.id}">Delete meal</button>
        </div>
        <div class="row" style="margin-top:8px"><span class="eyebrow grow">Cost per serving</span>
          <span class="num" style="font-weight:700">£${money(cost)}</span></div>
      </section>`;
    })
    .join("");

  return `${cards}<button class="btn wide" data-act="addMeal">Add a meal</button><div class="spacer"></div>`;
}

/* ---- items ---- */

function viewItems() {
  const c = state.calc;
  const open = state.sheet && state.sheet.kind === "item" ? state.sheet.id : null;
  const stores = [...new Set(state.db.ingredients.map((i) => i.store).filter(Boolean))];

  const cards = state.db.ingredients
    .map((ing) => {
      const age = daysSince(ing.priceUpdated);
      const stale = age > STALE_DAYS;
      const head = `<div class="row" data-act="openItem" data-id="${ing.id}">
        <div class="grow">
          <div class="trunc" style="font-weight:700">${stale ? '<span class="dot"></span>' : ""}${esc(ing.name)}</div>
          <div class="muted num">${esc(ing.store || "no store")} · ${ing.portionsPerPack}/pack · £${money(
        portionCost(ing)
      )} a portion</div>
        </div>
        <div style="text-align:right">
          <div class="num" style="font-weight:700">£${money(ing.pricePerPack)}</div>
          <div class="muted num${stale ? " stale" : ""}">${ing.priceUpdated ? age + "d ago" : "never set"}</div>
        </div>
      </div>`;

      if (ing.id !== open) return `<section class="card">${head}</section>`;

      const codes = (ing.barcodes || []).length
        ? (ing.barcodes || [])
            .map(
              (b) =>
                `<span class="pill on" style="margin:0 4px 4px 0">${esc(b)}
                 <button class="btn small ghost" style="border:0;padding:0 0 0 4px" data-act="delBarcode"
                   data-id="${ing.id}" data-code="${esc(b)}">×</button></span>`
            )
            .join("")
        : `<span class="muted">none yet</span>`;

      return `<section class="card">${head}
        <div style="border-top:1px solid var(--rule);margin-top:10px;padding-top:10px">
          <label class="field" style="margin-bottom:8px"><span class="eyebrow">Item name</span>
            <input class="inp" value="${esc(ing.name)}" data-act="setField" data-id="${ing.id}" data-field="name"></label>
          <div class="grid2" style="margin-bottom:8px">
            <label class="field"><span class="eyebrow">Price per pack £</span>
              <input class="inp mono" type="number" step="0.01" min="0" value="${ing.pricePerPack}"
                data-act="setPrice" data-id="${ing.id}"></label>
            <label class="field"><span class="eyebrow">Portions per pack</span>
              <input class="inp mono" type="number" step="0.5" min="0" value="${ing.portionsPerPack}"
                data-act="setNumber" data-id="${ing.id}" data-field="portionsPerPack"></label>
          </div>
          <div class="grid2" style="margin-bottom:8px">
            <label class="field"><span class="eyebrow">Store</span>
              <input class="inp" list="fb-stores" value="${esc(ing.store || "")}"
                data-act="setField" data-id="${ing.id}" data-field="store"></label>
            <label class="field"><span class="eyebrow">In stock (packs)</span>
              <input class="inp mono" type="number" step="0.25" min="0" value="${ing.stockPacks}"
                data-act="setNumber" data-id="${ing.id}" data-field="stockPacks"></label>
          </div>
          <label class="field" style="margin-bottom:8px"><span class="eyebrow">Pack size note</span>
            <input class="inp" placeholder="500g" value="${esc(ing.packLabel || "")}"
              data-act="setField" data-id="${ing.id}" data-field="packLabel"></label>
          <div style="margin-bottom:8px">
            <span class="eyebrow" style="display:block;margin-bottom:4px">Barcodes</span>
            <div style="margin-bottom:6px">${codes}</div>
            <button class="btn small" data-act="addBarcode" data-id="${ing.id}">Scan a barcode</button>
          </div>
          <div class="row">
            <span class="muted grow">Needs ${trim2(c.need[ing.id] || 0)} portions this fortnight</span>
            <button class="btn small danger" data-act="delItem" data-id="${ing.id}">Delete</button>
          </div>
        </div></section>`;
    })
    .join("");

  return `${cards}
    <datalist id="fb-stores">${stores.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>
    <button class="btn wide" data-act="addItem">Add an item</button><div class="spacer"></div>`;
}

/* -------------------------------- sheets ------------------------------- */

function viewSheet() {
  const s = state.sheet;
  if (!s) return "";
  if (s.kind === "receipt") return sheetReceipt(s);
  if (s.kind === "settings") return sheetSettings(s);
  return "";
}

function shell(title, blurb, inner) {
  return `<div class="scrim" data-act="closeSheet"><div class="sheet" data-stop="1">
    <button class="btn small ghost close" data-act="closeSheet">Close</button>
    <h2>${title}</h2>
    <p class="muted" style="margin-top:0">${blurb}</p>
    ${inner}</div></div>`;
}

function sheetReceipt(s) {
  const inner = [];
  if (s.err) inner.push(`<div class="err">${esc(s.err)}</div>`);

  inner.push(`<button class="btn solid wide" data-act="shootReceipt"${s.busy ? " disabled" : ""}>
    ${s.busy ? "Reading the receipt…" : s.rows ? "Photograph another receipt" : "Photograph the receipt"}</button>`);

  if (s.rows && s.rows.length) {
    inner.push(`<label class="field" style="margin:12px 0 8px"><span class="eyebrow">Store on this receipt</span>
      <input class="inp" value="${esc(s.store || "")}" placeholder="Tesco" data-act="setReceiptStore"></label>`);

    const picker = (sel) =>
      [`<option value=""${sel ? "" : " selected"}>Ignore this line</option>`,
       `<option value="__new__"${sel === "__new__" ? " selected" : ""}>+ Add as a new item</option>`]
        .concat(
          state.db.ingredients.map(
            (i) => `<option value="${i.id}"${i.id === sel ? " selected" : ""}>${esc(i.name)} (now £${money(
              i.pricePerPack
            )})</option>`
          )
        )
        .join("");

    inner.push(
      `<div class="card">` +
        s.rows
          .map(
            (r, i) => `<div class="rline">
        <div class="row">
          <input type="checkbox"${r.use ? " checked" : ""} data-act="toggleRow" data-i="${i}" aria-label="Use this line">
          <span class="raw grow trunc">${esc(r.raw)}</span>
          <input class="inp mono" style="width:76px;text-align:right;padding:5px 7px" type="number" step="0.01"
            value="${r.price}" data-act="setRowPrice" data-i="${i}" aria-label="Unit price">
        </div>
        <select class="inp" style="margin-top:5px" data-act="setRowTarget" data-i="${i}">${picker(r.targetId)}</select>
        <div class="row" style="margin-top:5px">
          <span class="why grow">${r.barcode ? "barcode " + esc(r.barcode) : esc(r.why)}${
              r.qty > 1 ? ` · ${r.qty} bought` : ""
            }</span>
          <button class="btn small ghost" data-act="scanRow" data-i="${i}">${
              r.barcode ? "Rescan" : "Scan barcode"
            }</button>
        </div>
      </div>`
          )
          .join("") +
        `</div>`
    );

    const ready = s.rows.filter((r) => r.use && r.targetId && r.price > 0).length;
    inner.push(`<button class="btn solid wide" style="margin-top:10px" data-act="applyReceipt"${
      ready ? "" : " disabled"
    }>Update ${ready} price${ready === 1 ? "" : "s"}</button>
    <p class="muted">Confirming a line teaches the app that receipt wording, so it matches itself next time.
    Scanning binds the barcode too, which is what makes in-store scanning work later.</p>`);
  }

  return shell(
    "Read a receipt",
    "Photograph the whole receipt flat, in good light. Nothing changes until you confirm.",
    inner.join("")
  );
}

function sheetSettings(s) {
  const set = state.settings;
  const on = (p) => (set.provider === p ? " checked" : "");
  return shell(
    "Settings",
    "Keys and tokens stay on this device. They are never written into the synced file.",
    `
    ${s.msg ? `<div class="${s.err ? "err" : "ok"}">${esc(s.msg)}</div>` : ""}

    <span class="eyebrow" style="display:block;margin-bottom:6px">Price data repo (private)</span>
    <div class="grid2" style="margin-bottom:8px">
      <label class="field"><span class="eyebrow">Owner</span>
        <input class="inp" value="${esc(set.owner)}" placeholder="your-username" data-act="setSetting" data-key="owner"></label>
      <label class="field"><span class="eyebrow">Repo</span>
        <input class="inp" value="${esc(set.repo)}" placeholder="shop-data" data-act="setSetting" data-key="repo"></label>
    </div>
    <div class="grid2" style="margin-bottom:8px">
      <label class="field"><span class="eyebrow">File path</span>
        <input class="inp" value="${esc(set.path)}" data-act="setSetting" data-key="path"></label>
      <label class="field"><span class="eyebrow">Branch</span>
        <input class="inp" value="${esc(set.branch)}" data-act="setSetting" data-key="branch"></label>
    </div>
    <label class="field" style="margin-bottom:10px"><span class="eyebrow">Fine-grained token, contents write</span>
      <input class="inp mono" type="password" value="${esc(set.token)}" placeholder="github_pat_…"
        data-act="setSetting" data-key="token"></label>
    <div class="row" style="gap:8px;margin-bottom:6px">
      <button class="btn grow" data-act="pullNow">Pull from repo</button>
      <button class="btn solid grow" data-act="pushNow">Push to repo</button>
    </div>
    <p class="muted">${set.lastPush ? "Last push " + esc(set.lastPush.slice(0, 16).replace("T", " ")) : "Never pushed."}
      ${set.lastPull ? " · last pull " + esc(set.lastPull.slice(0, 16).replace("T", " ")) : ""}</p>

    <span class="eyebrow" style="display:block;margin:14px 0 6px">Receipt reading</span>
    <div class="row" style="margin-bottom:8px">
      <label class="row grow"><input type="radio" name="prov" value="gemini" data-act="setProvider"${on("gemini")}> Gemini</label>
      <label class="row grow"><input type="radio" name="prov" value="anthropic" data-act="setProvider"${on(
        "anthropic"
      )}> Claude</label>
    </div>
    ${
      set.provider === "anthropic"
        ? `<label class="field" style="margin-bottom:8px"><span class="eyebrow">Anthropic key</span>
            <input class="inp mono" type="password" value="${esc(set.anthropicKey)}" placeholder="sk-ant-…"
              data-act="setSetting" data-key="anthropicKey"></label>
           <label class="field" style="margin-bottom:8px"><span class="eyebrow">Model</span>
            <input class="inp mono" value="${esc(set.anthropicModel)}" data-act="setSetting" data-key="anthropicModel"></label>`
        : `<label class="field" style="margin-bottom:8px"><span class="eyebrow">Gemini key</span>
            <input class="inp mono" type="password" value="${esc(set.geminiKey)}" placeholder="AIza…"
              data-act="setSetting" data-key="geminiKey"></label>
           <label class="field" style="margin-bottom:8px"><span class="eyebrow">Model</span>
            <input class="inp mono" value="${esc(set.geminiModel)}" data-act="setSetting" data-key="geminiModel"></label>`
    }

    <span class="eyebrow" style="display:block;margin:14px 0 6px">Manual backup</span>
    <textarea class="inp mono" data-act="setBackup" spellcheck="false">${esc(JSON.stringify(state.db, null, 2))}</textarea>
    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn grow" data-act="copyBackup">Copy</button>
      <button class="btn grow" data-act="restoreBackup">Restore</button>
      <button class="btn danger" data-act="resetAll">Reset</button>
    </div>
    <p class="muted">Scanning needs camera access. ${
      !scanSupported()
        ? "This browser has no camera access, so type barcodes by hand."
        : "BarcodeDetector" in window
        ? "Your browser decodes barcodes natively."
        : "Your browser has no built-in decoder, so the app loads its own the first time you scan. About a megabyte, cached afterwards, then it works offline like everything else."
    }</p>`
  );
}

/* ---------------------------- camera overlay --------------------------- */
/* Kept out of the render tree: a rebuild would tear down the video stream. */

let cam = null;

function closeCamera() {
  if (cam) {
    if (cam.handle) cam.handle.stop();
    cam.el.remove();
    cam = null;
  }
}

async function openCamera(title, onCode) {
  closeCamera();
  const el = document.createElement("div");
  el.className = "scrim";
  el.innerHTML = `<div class="sheet">
    <button class="btn small ghost close" data-cam="close">Close</button>
    <h2>${esc(title)}</h2>
    <p class="muted" style="margin-top:0">Hold the barcode inside the frame.</p>
    <div class="scanner">
      <video playsinline muted></video><div class="reticle"></div>
      <div class="hint">Looking for a barcode</div>
      <button class="btn small torch" data-cam="torch">Light</button>
    </div>
    <label class="field"><span class="eyebrow">Or type the number</span>
      <input class="inp mono" inputmode="numeric" placeholder="5010000000000" data-cam="manual"></label>
    <button class="btn solid wide" style="margin-top:8px" data-cam="useManual">Use this number</button>
  </div>`;
  document.body.appendChild(el);
  cam = { el, handle: null, onCode, torchOn: false };

  const hint = el.querySelector(".hint");
  const handle = await startScan(
    el.querySelector("video"),
    (code) => {
      hint.textContent = code;
      if (navigator.vibrate) navigator.vibrate(40);
      const cb = cam && cam.onCode;
      closeCamera();
      if (cb) cb(code);
    },
    (err) => {
      hint.textContent = "Camera unavailable";
      const note = document.createElement("div");
      note.className = "err";
      note.textContent = err.message;
      el.querySelector(".sheet").prepend(note);
    },
    (status) => {
      hint.textContent = status;
    }
  );
  if (cam) cam.handle = handle;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cam]");
  if (!btn || !cam) return;
  const what = btn.dataset.cam;
  if (what === "close") closeCamera();
  if (what === "torch" && cam.handle) {
    cam.torchOn = !cam.torchOn;
    cam.handle.torch(cam.torchOn);
  }
  if (what === "useManual") {
    const value = cam.el.querySelector('[data-cam="manual"]').value.trim();
    if (!value) return;
    const cb = cam.onCode;
    closeCamera();
    if (cb) cb(value);
  }
});

/* ------------------------------- receipts ------------------------------ */

const filePicker = (() => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.setAttribute("capture", "environment");
  input.style.display = "none";
  document.body.appendChild(input);
  return (onFile) => {
    input.value = "";
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (f) onFile(f);
    };
    input.click();
  };
})();

function receiptRow(line) {
  const res = resolveLine(line, state.db.ingredients);
  return {
    raw: line.name,
    price: Number(line.unitPrice) || 0,
    qty: Number(line.qty) || 1,
    targetId: res.id,
    why: res.why,
    confident: res.confident,
    use: !!res.id,
    barcode: "",
  };
}

async function shootReceipt() {
  filePicker(async (file) => {
    setSheet({ ...state.sheet, busy: true, err: "" });
    try {
      const out = await readReceipt(state.settings, file);
      const rows = out.lines.map(receiptRow);
      setSheet({
        kind: "receipt",
        busy: false,
        err: rows.length ? "" : "No product lines came back. Try a flatter photo with the whole receipt in frame.",
        store: out.store || "",
        date: out.date || "",
        rows,
      });
    } catch (err) {
      setSheet({ ...state.sheet, busy: false, err: err.message });
    }
  });
}

function applyReceipt() {
  const s = state.sheet;
  const rows = s.rows.filter((r) => r.use && r.targetId && r.price > 0);
  let created = 0;
  let updated = 0;

  commit((db) => {
    for (const r of rows) {
      const alias = norm(r.raw);
      let target = r.targetId;

      if (target === "__new__") {
        const made = newIngredient(s.store || (db.ingredients[0] && db.ingredients[0].store));
        made.name = titleise(r.raw);
        made.id = slug(made.name) + "-" + uid().slice(1, 4);
        db.ingredients.push(made);
        target = made.id;
        created += 1;
      } else {
        updated += 1;
      }

      const idx = db.ingredients.findIndex((i) => i.id === target);
      if (idx < 0) continue;
      const ing = { ...db.ingredients[idx] };
      ing.pricePerPack = r.price;
      ing.priceUpdated = today();
      if (s.store) ing.store = s.store;
      ing.aliases = [...new Set([...(ing.aliases || []), alias])];
      if (r.barcode) ing.barcodes = [...new Set([...(ing.barcodes || []), r.barcode])];
      db.ingredients[idx] = ing;
    }
  });

  state.sheet = null;
  flash(
    "ok",
    `${updated} price${updated === 1 ? "" : "s"} updated${created ? `, ${created} new item${created === 1 ? "" : "s"} added` : ""}.`
  );
}

/* --------------------------------- sync -------------------------------- */

async function pullNow() {
  setSheet({ ...state.sheet, msg: "Pulling…", err: false });
  try {
    const { db } = await pull(state.settings);
    if (!db) {
      setSheet({ ...state.sheet, msg: "No file there yet. Push first to create it.", err: false });
      return;
    }
    state.db = migrate(db);
    await saveDb(state.db);
    state.settings = { ...state.settings, lastPull: new Date().toISOString() };
    await saveSettings(state.settings);
    setSheet({ ...state.sheet, msg: `Pulled ${state.db.ingredients.length} items.`, err: false });
  } catch (err) {
    setSheet({ ...state.sheet, msg: err.message, err: true });
  }
}

async function pushNow() {
  setSheet({ ...state.sheet, msg: "Pushing…", err: false });
  try {
    let remoteNewer = false;
    try {
      const { db } = await pull(state.settings);
      if (db && db.updatedAt && state.settings.lastPull && db.updatedAt > state.settings.lastPull) {
        remoteNewer = true;
      }
    } catch (err) {
      /* a missing file is fine, push will create it */
    }
    if (remoteNewer && !confirm("The copy in the repo is newer than your last pull. Overwrite it?")) {
      setSheet({ ...state.sheet, msg: "Push cancelled. Pull first to take the newer copy.", err: true });
      return;
    }
    await push(state.settings, state.db);
    state.settings = { ...state.settings, lastPush: new Date().toISOString(), lastPull: new Date().toISOString() };
    await saveSettings(state.settings);
    setSheet({ ...state.sheet, msg: "Pushed. Git now holds this snapshot.", err: false });
  } catch (err) {
    setSheet({ ...state.sheet, msg: err.message, err: true });
  }
}

/* ------------------------------- actions ------------------------------- */

const actions = {
  tab: (el) => {
    state.tab = el.dataset.tab;
    state.sheet = null;
    state.flash = null;
    draw();
  },
  closeSheet: () => setSheet(null),
  openSettings: () => setSheet({ kind: "settings", msg: "", err: false }),
  openReceipt: () => setSheet({ kind: "receipt", busy: false, err: "", store: "", rows: null }),

  openScan: () =>
    openCamera("Scan an item", (code) => {
      const hit = state.db.ingredients.find((i) => (i.barcodes || []).includes(code));
      if (!hit) {
        state.tab = "items";
        const made = newIngredient(state.db.ingredients[0] && state.db.ingredients[0].store);
        made.barcodes = [code];
        commit((db) => db.ingredients.push(made));
        setSheet({ kind: "item", id: made.id });
        flash("ok", "New barcode. Name it and set the price.");
        return;
      }
      const value = prompt(`${hit.name}\nShelf price per pack in pounds:`, String(hit.pricePerPack || ""));
      if (value === null) return;
      const price = Number(value);
      if (!Number.isFinite(price) || price <= 0) {
        flash("err", "That price did not look like a number.");
        return;
      }
      const before = hit.pricePerPack;
      patchIngredient(hit.id, { pricePerPack: price, priceUpdated: today() });
      const delta = price - before;
      flash(
        "ok",
        `${hit.name} now £${money(price)}${
          Math.abs(delta) > 0.001 ? `, ${delta > 0 ? "up" : "down"} £${money(Math.abs(delta))}` : ""
        }.`
      );
    }),

  bought: (el) => {
    const ing = ingredient(el.dataset.id);
    if (!ing) return;
    patchIngredient(ing.id, { stockPacks: (Number(ing.stockPacks) || 0) + Number(el.dataset.packs) });
  },

  setBudget: (el) => commit((db) => { db.budget = Number(el.value) || 0; }),
  setDay: (el) => commit((db) => { db.plan[Number(el.dataset.idx)] = el.value || null; }),
  clearPlan: () => {
    if (confirm("Clear both weeks?")) commit((db) => { db.plan = Array(14).fill(null); });
  },

  openItem: (el) => setSheet({ kind: "item", id: el.dataset.id }),
  addItem: () => {
    const made = newIngredient(state.db.ingredients[0] && state.db.ingredients[0].store);
    commit((db) => db.ingredients.push(made));
    setSheet({ kind: "item", id: made.id });
  },
  delItem: (el) => {
    const id = el.dataset.id;
    const ing = ingredient(id);
    if (!confirm(`Delete ${ing ? ing.name : "this item"}? It will be removed from every meal too.`)) return;
    commit((db) => {
      db.ingredients = db.ingredients.filter((i) => i.id !== id);
      db.meals = db.meals.map((m) => ({ ...m, items: m.items.filter((it) => it.ingredientId !== id) }));
    });
    setSheet(null);
  },
  setField: (el) => patchIngredient(el.dataset.id, { [el.dataset.field]: el.value }),
  setNumber: (el) => patchIngredient(el.dataset.id, { [el.dataset.field]: Number(el.value) || 0 }),
  setPrice: (el) =>
    patchIngredient(el.dataset.id, { pricePerPack: Number(el.value) || 0, priceUpdated: today() }),
  addBarcode: (el) => {
    const id = el.dataset.id;
    openCamera("Scan a barcode", (code) => {
      const ing = ingredient(id);
      if (!ing) return;
      patchIngredient(id, { barcodes: [...new Set([...(ing.barcodes || []), code])] });
      flash("ok", `Barcode ${code} bound to ${ing.name}.`);
    });
  },
  delBarcode: (el) => {
    const ing = ingredient(el.dataset.id);
    if (!ing) return;
    patchIngredient(ing.id, { barcodes: (ing.barcodes || []).filter((b) => b !== el.dataset.code) });
  },

  openMeal: (el) => setSheet({ kind: "meal", id: el.dataset.id }),
  addMeal: () => {
    const meal = { id: uid(), name: "New meal", items: [] };
    commit((db) => db.meals.push(meal));
    setSheet({ kind: "meal", id: meal.id });
  },
  delMeal: (el) => {
    const id = el.dataset.id;
    if (!confirm("Delete this meal? Any planned days using it will empty.")) return;
    commit((db) => {
      db.meals = db.meals.filter((m) => m.id !== id);
      db.plan = db.plan.map((p) => (p === id ? null : p));
    });
    setSheet(null);
  },
  setMealName: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (m) m.name = el.value;
    }),
  addMealIng: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (m) m.items.push({ ingredientId: db.ingredients[0].id, portions: 0.5 });
    }),
  delMealIng: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (m) m.items.splice(Number(el.dataset.i), 1);
    }),
  setMealIng: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (m) m.items[Number(el.dataset.i)].ingredientId = el.value;
    }),
  setMealPortions: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (m) m.items[Number(el.dataset.i)].portions = Number(el.value) || 0;
    }),

  shootReceipt: () => shootReceipt(),
  setReceiptStore: (el) => setSheet({ ...state.sheet, store: el.value }),
  toggleRow: (el) => {
    const rows = state.sheet.rows.slice();
    rows[Number(el.dataset.i)] = { ...rows[Number(el.dataset.i)], use: el.checked };
    setSheet({ ...state.sheet, rows });
  },
  setRowPrice: (el) => {
    const rows = state.sheet.rows.slice();
    rows[Number(el.dataset.i)] = { ...rows[Number(el.dataset.i)], price: Number(el.value) || 0 };
    setSheet({ ...state.sheet, rows });
  },
  setRowTarget: (el) => {
    const rows = state.sheet.rows.slice();
    const i = Number(el.dataset.i);
    rows[i] = { ...rows[i], targetId: el.value, use: !!el.value, why: el.value ? "you chose it" : "ignored" };
    setSheet({ ...state.sheet, rows });
  },
  scanRow: (el) => {
    const i = Number(el.dataset.i);
    openCamera("Bind a barcode", (code) => {
      const rows = state.sheet.rows.slice();
      const known = state.db.ingredients.find((x) => (x.barcodes || []).includes(code));
      rows[i] = {
        ...rows[i],
        barcode: code,
        targetId: rows[i].targetId || (known ? known.id : ""),
        use: !!(rows[i].targetId || known),
        why: known ? `barcode already on ${known.name}` : "barcode captured",
      };
      setSheet({ ...state.sheet, rows });
    });
  },
  applyReceipt: () => applyReceipt(),

  setSetting: async (el) => {
    state.settings = { ...state.settings, [el.dataset.key]: el.value.trim() };
    await saveSettings(state.settings);
    draw();
  },
  setProvider: async (el) => {
    state.settings = { ...state.settings, provider: el.value };
    await saveSettings(state.settings);
    draw();
  },
  pullNow: () => pullNow(),
  pushNow: () => pushNow(),
  setBackup: (el) => { state.sheet = { ...state.sheet, backup: el.value }; },
  copyBackup: async () => {
    const text = JSON.stringify(state.db, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setSheet({ ...state.sheet, msg: "Copied.", err: false });
    } catch (err) {
      setSheet({ ...state.sheet, msg: "Copy blocked. Select the text and copy by hand.", err: true });
    }
  },
  restoreBackup: async () => {
    const text = state.sheet.backup;
    if (!text) {
      setSheet({ ...state.sheet, msg: "Paste a backup into the box first.", err: true });
      return;
    }
    try {
      state.db = migrate(JSON.parse(text));
      await saveDb(state.db);
      setSheet({ ...state.sheet, msg: "Restored.", err: false });
    } catch (err) {
      setSheet({ ...state.sheet, msg: "That is not valid JSON.", err: true });
    }
  },
  resetAll: async () => {
    if (!confirm("Reset to the starting items and meals? Local changes will be lost.")) return;
    state.db = seed();
    await saveDb(state.db);
    setSheet(null);
    flash("ok", "Reset to the starting data.");
  },
};

/* ------------------------------ delegation ----------------------------- */

function dispatch(e) {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = actions[el.dataset.act];
  if (!act) return;

  const tag = el.tagName;
  const isInput = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  // inputs act on change, buttons act on click
  if (e.type === "click" && isInput) return;
  if (e.type === "change" && !isInput) return;
  if (e.type === "click") e.preventDefault();

  act(el);
}

root.addEventListener("click", (e) => {
  // a tap on the dim area behind a sheet closes it, a tap inside must not
  if (e.target.classList && e.target.classList.contains("scrim")) {
    setSheet(null);
    return;
  }
  if (e.target.closest("[data-stop]") && e.target.closest(".scrim") && !e.target.closest("[data-act]")) return;
  dispatch(e);
});
root.addEventListener("change", dispatch);

/* --------------------------------- boot -------------------------------- */

(async function boot() {
  state.db = await loadDb();
  state.settings = await loadSettings();
  draw();
})();
