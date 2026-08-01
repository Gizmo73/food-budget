/* Fortnight Shop.
   No framework and no build step, so this file can be edited on a phone and
   pushed straight to Pages. Rendering is a full innerHTML rebuild; inputs are
   uncontrolled and commit on "change" (blur or Enter), so a rebuild never
   interrupts typing. The camera overlay lives outside the render tree because
   a rebuild would kill the video stream. */

import {
  loadDb, saveDb, loadSettings, saveSettings, seed, migrate, newIngredient,
  resolveLine, norm, uid, slug, uniqueId, canonicalStore, storeNames, cleanOffer,
  mergeSnapshots, makeInvite, readInvite, SLOTS,
} from "./lib/store.js";
import {
  computeShopping, mealCost, portionCost, packCost, activeOffer, offerLabel,
  offerExpired, offerMeaning, groupByStore, searchItems, ukTime, ago,
  money, today, now, dayOf, isEarlierDay, daysSince, STALE_DAYS,
  stockPortions, stockPacks, packPortions,
} from "./lib/calc.js";
import { scanSupported, decoderKind, startScan, decodeStill, QR_FORMATS } from "./lib/scan.js";
import { qrSvg } from "./lib/qr.js";
import { readReceipt } from "./lib/vision.js";
import { pull, push } from "./lib/sync.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const root = document.getElementById("app");

const state = {
  db: null, settings: null, tab: "list", sheet: null, flash: null,
  calc: null, reveal: null, query: "", incoming: null,
};

/* ------------------------------- theming ------------------------------- */

function applyTheme(choice) {
  const wanted =
    choice === "system"
      ? window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : choice;
  document.documentElement.dataset.theme = wanted;
  // mirrored into localStorage purely so index.html can set it before first paint
  try {
    localStorage.setItem("fs-theme", choice);
  } catch (err) {
    /* storage can be blocked; the theme still applies for this session */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", wanted === "dark" ? "#1E2126" : "#FFFFFF");
}

if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.settings && state.settings.theme === "system") applyTheme("system");
  });
}

/* Unsaved means the local copy has moved on since the last successful push. */
function isDirty() {
  if (!state.db || !state.settings) return false;
  if (!state.settings.owner || !state.settings.token) return false;
  return (state.db.updatedAt || "") > (state.settings.lastPush || "");
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const trim2 = (n) => String(Math.round(n * 100) / 100);

/* A stamp is either a receipt's day or an edit's minute. Showing "01 Aug,
   01:00" for a receipt would be inventing a time it never had. */
const stampText = (iso) => (String(iso).length > 10 ? ukTime(iso) : dayOf(iso));

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

const isShut = (which, name) => (state.settings[which] || []).includes(name);

/* A new item is useless if you cannot see it. Expand its store group, open it,
   and scroll it into view, otherwise a collapsed group swallows it silently. */
async function revealItem(id) {
  const ing = state.db.ingredients.find((i) => i.id === id);
  const store = (ing && ing.store) || "Unassigned";
  const shut = state.settings.collapsedItems || [];
  if (shut.some((n) => n.toLowerCase() === store.toLowerCase())) {
    state.settings = {
      ...state.settings,
      collapsedItems: shut.filter((n) => n.toLowerCase() !== store.toLowerCase()),
    };
    await saveSettings(state.settings);
  }
  state.tab = "items";
  state.reveal = id;
  setSheet({ kind: "item", id });
}

async function toggleShut(which, name) {
  const list = state.settings[which] || [];
  const next = list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
  state.settings = { ...state.settings, [which]: next };
  await saveSettings(state.settings);
  draw();
}

/* Every edit made by hand lands here, so this is the one place that has to
   record when it happened. A receipt writes its own stamp instead, because
   what matters there is the day the receipt was printed. */
function patchIngredient(id, changes) {
  commit((db) => {
    const i = db.ingredients.findIndex((x) => x.id === id);
    if (i >= 0) db.ingredients[i] = { ...db.ingredients[i], updatedAt: now(), ...changes };
  });
}

/* --------------------------------- views ------------------------------- */

/* Identify a field across a rebuild, so focus and caret survive it. */
function fieldKey(el) {
  if (!el || !el.dataset || !el.dataset.act) return null;
  const d = el.dataset;
  return [d.act, d.id || "", d.field || "", d.i || "", d.key || "", d.which || ""].join("|");
}

function draw() {
  state.calc = computeShopping(state.db);
  const sheetScroll = document.querySelector(".sheet") ? document.querySelector(".sheet").scrollTop : null;
  const pageScroll = window.scrollY;

  // A rebuild replaces every node, so remember where the cursor was.
  // Without this, tabbing from one number field to the next loses focus.
  const active = document.activeElement;
  const focusKey = active && root.contains(active) ? fieldKey(active) : null;
  let selStart = null;
  let selEnd = null;
  if (focusKey) {
    try {
      selStart = active.selectionStart;
      selEnd = active.selectionEnd;
    } catch (err) {
      /* number and date inputs refuse selection access in some browsers */
    }
  }

  root.innerHTML = [
    viewMasthead(),
    `<div class="wrap">`,
    state.flash ? `<div class="${state.flash.kind === "err" ? "err" : "ok"}">${esc(state.flash.text)}</div>` : "",
    { list: viewList, plan: viewPlan, meals: viewMeals, items: viewItems }[state.tab](),
    `</div>`,
    viewTabs(),
    viewSheet(),
  ].join("");

  root.dataset.booted = "1";
  window.scrollTo(0, pageScroll);
  if (sheetScroll !== null) {
    const s = document.querySelector(".sheet");
    if (s) s.scrollTop = sheetScroll;
  }

  if (state.reveal) {
    const card = root.querySelector(`[data-scroll="${state.reveal}"]`);
    if (card) {
      if (card.scrollIntoView) card.scrollIntoView({ block: "center" });
      const nameField = card.querySelector('[data-field="name"]');
      if (nameField) {
        nameField.focus();
        if (nameField.select) nameField.select();
      }
    }
    state.reveal = null;
    return;
  }

  if (focusKey) {
    const again = [...root.querySelectorAll("[data-act]")].find((el) => fieldKey(el) === focusKey);
    if (again) {
      again.focus();
      if (selStart !== null && again.setSelectionRange) {
        try {
          again.setSelectionRange(selStart, selEnd);
        } catch (err) {
          /* not a text-like input */
        }
      }
    }
  }
}

function viewMasthead() {
  const c = state.calc;
  return `<header class="masthead"><div class="row">
    <div class="grow">
      <h1>Fortnight Shop</h1>
      <p>${c.plannedMeals} of ${c.totalSlots} meals planned &middot; ${state.db.ingredients.length} items</p>
    </div>
    <button class="btn small ghost" data-act="openSettings">Settings</button>
  </div></header>`;
}

function viewTabs() {
  const c = state.calc;
  const tabs = [
    ["list", "List", c.lines.length],
    ["plan", "Plan", c.plannedMeals],
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

  const notes = [];
  if (c.staleCount)
    notes.push(`<div class="warn"><strong>${c.staleCount}</strong> ${
      c.staleCount === 1 ? "price is" : "prices are"
    } over ${STALE_DAYS} days old. Shoot your next receipt to refresh them.</div>`);
  if (c.expiredCount)
    notes.push(`<div class="warn"><strong>${c.expiredCount}</strong> ${
      c.expiredCount === 1 ? "offer has" : "offers have"
    } passed the end date, so full price is being counted.</div>`);
  if (c.problems.length)
    notes.push(`<div class="err">${c.problems
      .map((i) => esc(i.name))
      .join(", ")} ${c.problems.length === 1 ? "is" : "are"} needed by a planned meal but ${
      c.problems.length === 1 ? "has" : "have"
    } no portions per pack, so ${
      c.problems.length === 1 ? "it is" : "they are"
    } missing from this list. Set it to 1 on the Items tab if the pack is not divided into servings.</div>`);

  const body = c.lines.length
    ? c.stores
        .map((store) => {
          const shut = isShut("collapsedList", store.name);
          return `<div class="group">
        <button class="grouphead" data-act="toggleStore" data-which="collapsedList" data-store="${esc(store.name)}">
          <span class="chev">${shut ? "\u25B8" : "\u25BE"}</span>
          <span class="grow">
            <span class="gname">${esc(store.name)}</span>
            <span class="gmeta" style="display:block">${store.lines.length} item${
            store.lines.length === 1 ? "" : "s"
          } &middot; £${money(store.total)}</span>
          </span>
        </button>
        ${shut ? "" : `<section class="card">${store.lines.map(ticket).join("")}</section>`}
      </div>`;
        })
        .join("")
    : `<div class="empty">Nothing to buy. Plan meals on the Plan tab, or add something by hand from Items.</div>`;

  const incoming = state.incoming
    ? `<div class="banner">
         <div class="row">
           <span class="grow"><strong>Changes waiting</strong><br>
             <span style="font-size:13px">${esc(state.incoming.who || "Someone")} saved ${esc(
        ago(state.incoming.at)
      )}.</span></span>
           <button class="btn small" data-act="mergeIncoming">Merge</button>
         </div>
       </div>`
    : "";

  return `
    ${incoming}
    <div class="row" style="gap:8px;margin-bottom:10px">
      <button class="btn solid grow" data-act="openReceipt">Read a receipt</button>
      <button class="btn tonal grow" data-act="openScan">Scan an item</button>
    </div>
    ${notes.join("")}
    ${body}
    <div class="till">
      <div class="line"><span class="lbl">Total</span><span class="leader"></span>
        <span class="big">£${money(c.total)}</span></div>
      ${
        c.saving > 0.004
          ? `<div class="line" style="margin-top:2px"><span class="lbl">Offers save</span>
             <span class="leader"></span><span class="num" style="font-size:13px">£${money(c.saving)}</span></div>`
          : ""
      }
      <div class="bar${over ? " over" : ""}"><span style="width:${Math.round(pct * 100)}%"></span></div>
      <div class="row" style="margin-top:8px">
        <span class="lbl grow">${
          over ? `£${money(c.total - state.db.budget)} over budget` : `£${money(state.db.budget - c.total)} left`
        }</span>
        <input class="inp mono" style="width:82px;padding:5px 7px;text-align:right" type="number"
          step="1" min="0" value="${state.db.budget}" data-act="setBudget" aria-label="Budget in pounds">
      </div>
    </div>
    <p class="muted">Whole packs only, less the portions you already have.
    Tap "Got it" after shopping and those packs become portions in stock.</p>
    <div class="spacer"></div>`;
}

function ticket(l) {
  const bits = [`${l.packs} pack${l.packs === 1 ? "" : "s"} @ £${money(l.ing.pricePerPack)}`];
  if (l.offer) bits.push(l.offer);
  if (l.ing.packLabel) bits.push(esc(l.ing.packLabel));
  if (l.extra) bits.push(`${l.extra} by hand`);
  // needs 4, has 2, so a whole pack is still required: say so on the line
  if (l.stock > 0.001) bits.push(`${trim2(l.stock)} in stock`);
  if (l.leftover > 0.001) bits.push(`${trim2(l.leftover)} left over`);

  return `<div class="ticket">
    <div class="grow">
      <div class="name trunc">${l.stale ? '<span class="dot"></span>' : ""}${esc(l.ing.name)}</div>
      <div class="meta">${bits.join(" &middot; ")}</div>
      ${l.saving > 0.004 ? `<div class="meta save">saves £${money(l.saving)}</div>` : ""}
    </div>
    <span class="leader"></span>
    <div style="text-align:right">
      <div class="price">£${money(l.cost)}</div>
      <div class="row" style="gap:4px;margin-top:3px;justify-content:flex-end">
        ${
          l.extra
            ? `<button class="btn small ghost" data-act="clearExtra" data-id="${l.ing.id}" title="Remove the hand-added packs">&times;</button>`
            : ""
        }
        <button class="btn small ghost" data-act="bought" data-id="${l.ing.id}" data-packs="${l.packs}">Got it</button>
      </div>
    </div>
  </div>`;
}

/* ---- plan ---- */

function viewPlan() {
  const c = state.calc;

  const options = (selected) =>
    [`<option value="">\u2014</option>`]
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
      const day = state.db.plan[idx] || {};
      const slots = SLOTS.map(
        (slot) => `<div class="slot">
          <span class="slabel">${slot.short}</span>
          <select data-act="setSlot" data-idx="${idx}" data-slot="${slot.key}"
            aria-label="${slot.label}, ${name} week ${w + 1}">${options(day[slot.key])}</select>
        </div>`
      ).join("");

      return `<div class="dayblock">
        <div class="row">
          <span class="dname grow">${name}</span>
          <span class="cost">${c.dayCost[idx] > 0 ? "£" + money(c.dayCost[idx]) : ""}</span>
        </div>
        ${slots}
      </div>`;
    }).join("");

    return `<section class="card">
      <div class="row" style="margin-bottom:6px">
        <span class="eyebrow grow">Week ${w + 1}</span>
        <span class="num muted">£${money(subtotal)}</span>
      </div>${rows}</section>`;
  };

  // breakfast and lunch are usually the same all fortnight, so offer to fill them
  const fillers = SLOTS.map(
    (slot) => `<button class="btn small ghost grow" data-act="fillSlot" data-slot="${slot.key}">Repeat ${slot.label.toLowerCase()}</button>`
  ).join("");

  return `${week(0)}${week(1)}
    <div class="card">
      <span class="eyebrow" style="display:block;margin-bottom:6px">Fill the fortnight</span>
      <div class="row" style="gap:6px">${fillers}</div>
      <p class="muted" style="margin:7px 0 0">Copies the first day's choice into every empty day of that slot.</p>
    </div>
    <p class="muted">Day costs are portion costs, so they show what the meals are worth. The List tab rounds up to whole packs.</p>
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

/* Shared by the Items tab and the scan sheet. Takes a plain
   { pricePerPack, offer } shape so it works before an item exists. */
function offerEditor(subject, acts) {
  const o = subject.offer || {};
  const kind = o.kind || "";
  const attrs = `data-act="${acts.kind}"${acts.id ? ` data-id="${acts.id}"` : ""}`;
  const field = (name) => `data-act="${acts.field}"${acts.id ? ` data-id="${acts.id}"` : ""} data-field="${name}"`;
  const opt = (v, label) => `<option value="${v}"${kind === v ? " selected" : ""}>${label}</option>`;

  let fields = "";
  if (kind === "loyalty") {
    fields = `<label class="field"><span class="eyebrow">Card price £ per pack</span>
      <input class="inp mono" type="number" step="0.01" min="0" value="${o.price || ""}" ${field("price")}></label>`;
  } else if (kind === "multibuy") {
    fields = `<div class="grid2">
      <label class="field"><span class="eyebrow">Buy this many</span>
        <input class="inp mono" type="number" step="1" min="2" value="${o.qty || ""}" ${field("qty")}></label>
      <label class="field"><span class="eyebrow">For a total of £</span>
        <input class="inp mono" type="number" step="0.01" min="0" value="${o.price || ""}" ${field("price")}></label></div>`;
  } else if (kind === "xfory") {
    fields = `<div class="grid2">
      <label class="field"><span class="eyebrow">Take this many</span>
        <input class="inp mono" type="number" step="1" min="2" value="${o.qty || ""}" ${field("qty")}></label>
      <label class="field"><span class="eyebrow">Pay for this many</span>
        <input class="inp mono" type="number" step="1" min="1" value="${o.pay || ""}" ${field("pay")}></label></div>`;
  }

  const live = activeOffer(subject);
  const expired = offerExpired(subject);

  return `<div style="border:1px solid var(--rule);padding:9px;margin-bottom:8px;background:#fff">
    <label class="field" style="margin-bottom:${kind ? "8px" : "0"}">
      <span class="eyebrow">Offer</span>
      <select class="inp" ${attrs}>
        ${opt("", "None, full price")}
        ${opt("loyalty", "Loyalty card price")}
        ${opt("multibuy", "N for a fixed price")}
        ${opt("xfory", "Buy N, pay for fewer")}
      </select></label>
    ${fields}
    ${
      kind
        ? `<label class="field" style="margin-top:8px"><span class="eyebrow">Offer ends, optional</span>
           <input class="inp mono" type="date" value="${o.ends || ""}" ${field("ends")}></label>`
        : ""
    }
    ${
      expired
        ? `<p class="muted stale" style="margin:6px 0 0">Ended ${esc(o.ends)}, so full price is being used.</p>`
        : live
        ? `<p class="muted" style="margin:6px 0 0">${esc(offerMeaning(subject))}</p>`
        : kind
        ? `<p class="muted" style="margin:6px 0 0">Fill the numbers in and the offer starts counting.</p>`
        : ""
    }
  </div>`;
}

function viewItems() {
  const c = state.calc;
  const open = state.sheet && state.sheet.kind === "item" ? state.sheet.id : null;
  const stores = storeNames(state.db.ingredients);
  const q = state.query;
  const matches = searchItems(q, state.db.ingredients);
  const matchIds = new Set(matches.map((i) => i.id));

  const card = (ing) => {
    const age = daysSince(ing.priceUpdated);
    const stale = age > STALE_DAYS;
    const extra = Number(ing.extraPacks) || 0;
    const live = activeOffer(ing);
    const stock = stockPortions(ing);

    const head = `<div class="row head" data-act="openItem" data-id="${ing.id}">
      <div class="grow">
        <div class="trunc" style="font-weight:600">${stale ? '<span class="dot"></span>' : ""}${esc(ing.name)}</div>
        <div class="muted num">${
          Number(ing.portionsPerPack) > 0
            ? `${ing.portionsPerPack}/pack`
            : '<span class="stale">portions not set</span>'
        } &middot; £${money(portionCost(ing))} a portion &middot; ${trim2(stock)} in stock${
      live ? ` &middot; ${esc(offerLabel(ing))}` : ""
    }${extra ? ` &middot; ${extra} on the list` : ""}</div>
      </div>
      <div style="text-align:right">
        <div class="num" style="font-weight:700">£${money(ing.pricePerPack)}</div>
        <div class="muted num${stale ? " stale" : ""}">${ing.priceUpdated ? age + "d ago" : "never set"}</div>
      </div>
      <button class="btn small ghost" data-act="addToList" data-id="${ing.id}" title="Add a pack to the shopping list">+</button>
    </div>`;

    if (ing.id !== open) return `<section class="card" data-scroll="${ing.id}">${head}</section>`;

    const codes = (ing.barcodes || []).length
      ? (ing.barcodes || [])
          .map(
            (b) => `<span class="pill on" style="margin:0 5px 5px 0">${esc(b)}
             <button class="btn small ghost" style="padding:0 0 0 5px;min-height:0" data-act="delBarcode"
               data-id="${ing.id}" data-code="${esc(b)}">&times;</button></span>`
          )
          .join("")
      : `<span class="muted">none yet</span>`;

    return `<section class="card" data-scroll="${ing.id}">${head}
      <div style="border-top:1px solid var(--outline);margin-top:12px;padding-top:12px">
        <label class="field" style="margin-bottom:10px"><span class="eyebrow">Item name</span>
          <input class="inp" value="${esc(ing.name)}" data-act="setField" data-id="${ing.id}" data-field="name"></label>
        <div class="grid2" style="margin-bottom:10px">
          <label class="field"><span class="eyebrow">Base price £ per pack</span>
            <input class="inp mono" type="number" step="0.01" min="0" value="${ing.pricePerPack}"
              data-act="setPrice" data-id="${ing.id}"></label>
          <label class="field"><span class="eyebrow">Portions per pack</span>
            <input class="inp mono" type="number" step="0.5" min="0" value="${ing.portionsPerPack}"
              data-act="setNumber" data-id="${ing.id}" data-field="portionsPerPack"></label>
        </div>
        ${offerEditor(ing, { kind: "setOfferKind", field: "setOfferField", id: ing.id })}
        <div class="grid2" style="margin-bottom:6px">
          <label class="field"><span class="eyebrow">Store</span>
            <input class="inp" list="fb-stores" value="${esc(ing.store || "")}" placeholder="Not set"
              data-act="setField" data-id="${ing.id}" data-field="store"></label>
          <label class="field"><span class="eyebrow">In stock (portions)</span>
            <input class="inp mono" type="number" step="0.5" min="0" value="${trim2(stock)}"
              data-act="setNumber" data-id="${ing.id}" data-field="stockPortions"></label>
        </div>
        <div class="row" style="margin-bottom:10px">
          <span class="muted grow">${
            Number(ing.portionsPerPack) > 0
              ? `${trim2(stockPacks(ing))} pack${Math.abs(stockPacks(ing) - 1) < 0.001 ? "" : "s"} at ${
                  ing.portionsPerPack
                } a pack`
              : "Set portions per pack and this counts packs too"
          }</span>
          <button class="btn small tonal" data-act="lessStockPack" data-id="${ing.id}"
            title="Take a pack out of stock">&minus; pack</button>
          <button class="btn small tonal" data-act="moreStockPack" data-id="${ing.id}"
            title="Put a pack into stock">+ pack</button>
        </div>
        <label class="field" style="margin-bottom:10px"><span class="eyebrow">Pack size note</span>
          <input class="inp" placeholder="500g" value="${esc(ing.packLabel || "")}"
            data-act="setField" data-id="${ing.id}" data-field="packLabel"></label>
        <div class="row" style="margin-bottom:10px">
          <span class="eyebrow grow">On the list by hand</span>
          <button class="btn small tonal" data-act="lessExtra" data-id="${ing.id}">&minus;</button>
          <span class="num" style="min-width:24px;text-align:center;font-weight:700">${extra}</span>
          <button class="btn small tonal" data-act="addToList" data-id="${ing.id}">+</button>
        </div>
        <div style="margin-bottom:10px">
          <span class="eyebrow" style="display:block;margin-bottom:6px">Barcodes</span>
          <div style="margin-bottom:8px">${codes}</div>
          <button class="btn small tonal" data-act="addBarcode" data-id="${ing.id}">Scan a barcode</button>
        </div>
        <div style="margin-bottom:10px">
          <span class="eyebrow" style="display:block;margin-bottom:4px">Last updated</span>
          <span class="muted num">${
            ing.updatedAt
              ? `${esc(stampText(ing.updatedAt))} &middot; ${esc(ago(ing.updatedAt))}`
              : "not since this item was made"
          }</span>
          ${
            ing.priceUpdated && dayOf(ing.priceUpdated) !== dayOf(ing.updatedAt)
              ? `<br><span class="muted num">price ${esc(ago(ing.priceUpdated))}</span>`
              : ""
          }
        </div>
        <div class="row">
          <span class="muted grow">Needs ${trim2(c.need[ing.id] || 0)} portions this fortnight</span>
          <button class="btn small danger" data-act="delItem" data-id="${ing.id}">Delete</button>
        </div>
      </div></section>`;
  };

  const groups = groupByStore(state.db.ingredients)
    .map((g) => {
      const shown = g.items.filter((i) => matchIds.has(i.id));
      if (q && !shown.length) return "";
      // a search opens every group that has a hit, otherwise results hide
      const shut = q ? false : isShut("collapsedItems", g.name);
      const holding = shown.filter((i) => Number(i.extraPacks) > 0).length;
      const meta = [
        `${shown.length} item${shown.length === 1 ? "" : "s"}`,
        holding ? `${holding} on the list` : "",
        g.name === "Unassigned" ? "set a store to file these" : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `<div class="group">
        <button class="grouphead" data-act="toggleStore" data-which="collapsedItems" data-store="${esc(g.name)}"${
        q ? " disabled" : ""
      }>
          <span class="chev">${q ? "" : shut ? "\u25B8" : "\u25BE"}</span>
          <span class="grow">
            <span class="gname">${esc(g.name)}</span>
            <span class="gmeta" style="display:block">${esc(meta)}</span>
          </span>
        </button>
        ${shut ? "" : shown.map(card).join("")}
      </div>`;
    })
    .join("");

  const search = `<div class="search">
    <span class="mag">&#9906;</span>
    <input class="inp" type="search" value="${esc(q)}" placeholder="Search items, stores, barcodes"
      data-act="setQuery" aria-label="Search items">
    ${q ? `<button class="btn small ghost clear" data-act="clearQuery">Clear</button>` : ""}
  </div>`;

  const nothing =
    q && !matches.length
      ? `<div class="empty">Nothing matches &ldquo;${esc(q)}&rdquo;.</div>`
      : "";

  return `${search}
    ${q ? `<p class="muted" style="margin:-4px 0 10px">${matches.length} of ${state.db.ingredients.length} items</p>` : ""}
    ${nothing}${groups}
    <datalist id="fb-stores">${stores.map((st) => `<option value="${esc(st)}"></option>`).join("")}</datalist>
    <button class="btn tonal wide" data-act="addItem">Add an item</button><div class="spacer"></div>`;
}

/* -------------------------------- sheets ------------------------------- */

function viewSheet() {
  const s = state.sheet;
  if (!s) return "";
  if (s.kind === "receipt") return sheetReceipt(s);
  if (s.kind === "settings") return sheetSettings(s);
  if (s.kind === "scanned") return sheetScanned(s);
  if (s.kind === "help") return sheetHelp();
  if (s.kind === "invite") return sheetInvite(s);
  if (s.kind === "join") return sheetJoin(s);
  return "";
}

function shell(title, blurb, inner) {
  return `<div class="scrim" data-act="closeSheet"><div class="sheet" data-stop="1">
    <button class="btn small ghost close" data-act="closeSheet">Close</button>
    <h2>${title}</h2>
    <p class="muted" style="margin-top:0">${blurb}</p>
    ${inner}</div></div>`;
}

/* The stock control on a receipt line. Counted in portions like everywhere
   else, stepped by whole packs because that is how a receipt counts, and
   pre-filled from the quantity the model read off the paper. */
function receiptStockRow(r, i) {
  const add = rowStock(r);
  const perPack = rowPackPortions(r);
  const known = r.targetId !== "__new__" ? ingredient(r.targetId) : null;
  const now = known ? stockPortions(known) : 0;
  const packs = perPack > 0 ? add / perPack : 0;
  const plural = (n) => (Math.abs(n - 1) < 0.001 ? "" : "s");

  return `<div class="row" style="margin-top:5px">
      <span class="eyebrow grow">Into stock</span>
      <button class="btn small ghost" data-act="lessRowStock" data-i="${i}" aria-label="One pack fewer">&minus;</button>
      <input class="inp mono" style="width:66px;text-align:right;padding:5px 7px" type="number" step="0.5" min="0"
        value="${trim2(add)}" data-act="setRowStock" data-i="${i}" aria-label="Portions to put into stock">
      <button class="btn small ghost" data-act="moreRowStock" data-i="${i}" aria-label="One pack more">+</button>
    </div>
    <p class="why" style="margin:3px 0 0">${trim2(add)} portion${plural(add)} &middot; ${trim2(
    packs
  )} pack${plural(packs)} of ${trim2(perPack)} &middot; ${
    r.stockTouched ? "your figure" : "read off the receipt"
  } &middot; stock ${trim2(now)} &rarr; ${trim2(now + add)}</p>`;
}

function sheetReceipt(s) {
  const inner = [];
  if (s.err) inner.push(`<div class="err">${esc(s.err)}</div>`);

  inner.push(`<button class="btn solid wide" data-act="shootReceipt"${s.busy ? " disabled" : ""}>
    ${s.busy ? "Reading the receipt…" : s.rows ? "Photograph another receipt" : "Photograph the receipt"}</button>`);

  if (s.rows && s.rows.length) {
    const old = s.rows.filter((r) => r.outdated).length;
    inner.push(`<div class="grid2" style="margin:12px 0 8px">
      <label class="field"><span class="eyebrow">Store on this receipt</span>
        <input class="inp" value="${esc(s.store || "")}" placeholder="Tesco" data-act="setReceiptStore"></label>
      <label class="field"><span class="eyebrow">Date on this receipt</span>
        <input class="inp mono" type="date" value="${esc(dayOf(s.date))}" data-act="setReceiptDate"></label>
    </div>
    <p class="muted" style="margin:-2px 0 8px">${
      s.dateRead ? "Read off the receipt" : "Not legible on the photo, so today is assumed"
    }. Prices are recorded as of this date, and lines are switched off where the item has been updated since.${
      old ? ` <strong>${old} line${old === 1 ? "" : "s"} older than what you already have.</strong>` : ""
    }</p>`);

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
        ${
          r.targetId === "__new__"
            ? `<div class="grid2" style="margin-top:5px">
                 <label class="field"><span class="eyebrow">Name</span>
                   <input class="inp" value="${esc(r.newName)}" data-act="setRowName" data-i="${i}"></label>
                 <label class="field"><span class="eyebrow">Portions per pack</span>
                   <input class="inp mono" type="number" step="0.5" min="0.5" value="${r.newPortions}"
                     data-act="setRowPortions" data-i="${i}"></label>
               </div>
               <p class="why" style="margin:3px 0 0">Leave it at 1 for anything you do not divide into servings, like water or kitchen roll.</p>`
            : ""
        }
        <div class="row" style="margin-top:5px">
          <span class="why grow">${
              r.outdated
                ? `<strong class="stale">old price</strong> &middot; ${esc(
                    ingredient(r.targetId) ? ingredient(r.targetId).name : "this item"
                  )} was updated after ${esc(dayOf(s.date))}`
                : r.barcode
                ? "barcode " + esc(r.barcode)
                : esc(r.why)
            }${r.qty > 1 ? ` &middot; ${r.qty} bought` : ""}</span>
          <button class="btn small ghost" data-act="scanRow" data-i="${i}">${
              r.barcode ? "Rescan" : "Scan barcode"
            }</button>
        </div>
        ${r.targetId ? receiptStockRow(r, i) : ""}
        <div class="row" style="margin-top:5px">
          <span class="eyebrow" style="white-space:nowrap">Paid</span>
          <select class="inp grow" data-act="setRowOfferKind" data-i="${i}">
            <option value="none"${r.offerKind === "none" ? " selected" : ""}>Full price</option>
            <option value="loyalty"${r.offerKind === "loyalty" ? " selected" : ""}>Card price, any quantity</option>
            <option value="multibuy"${r.offerKind === "multibuy" ? " selected" : ""}>Multibuy, needs several</option>
          </select>
        </div>
        ${
          r.offerKind === "multibuy"
            ? `<div class="row" style="margin-top:5px">
                 <span class="eyebrow" style="white-space:nowrap">Deal</span>
                 <input class="inp mono" style="width:58px;text-align:right" type="number" step="1" min="2"
                   value="${r.offerQty}" data-act="setRowOfferQty" data-i="${i}" aria-label="Packs in the deal">
                 <span class="eyebrow">for £</span>
                 <input class="inp mono grow" type="number" step="0.01" min="0"
                   value="${r.offerTotal || ""}" data-act="setRowOfferTotal" data-i="${i}" aria-label="Total for the deal">
               </div>
               <p class="why" style="margin:3px 0 0">The base price is left alone, since a multibuy does not tell us what one pack costs.</p>`
            : ""
        }
      </div>`
          )
          .join("") +
        `</div>`
    );

    const live = s.rows.filter((r) => r.use && r.targetId && r.price > 0);
    const ready = live.length;
    const stocking = live.filter((r) => rowStock(r) > 0).length;
    inner.push(`<button class="btn solid wide" style="margin-top:10px" data-act="applyReceipt"${
      ready ? "" : " disabled"
    }>Update ${ready} price${ready === 1 ? "" : "s"}${stocking ? " and stock" : ""}</button>
    <p class="muted">Confirming a line teaches the app that receipt wording, so it matches itself next time.
    Scanning binds the barcode too, which is what makes in-store scanning work later.
    A <strong>card price</strong> applies to every pack, a <strong>multibuy</strong> only once you buy enough. Both leave the base price alone.
    <strong>Into stock</strong> starts from the quantity on the receipt; correct it when one receipt line covers two flavours you keep as separate items.</p>`);
  }

  return shell(
    "Read a receipt",
    "Photograph the whole receipt flat, in good light. Nothing changes until you confirm.",
    inner.join("")
  );
}

/* Scanning opens this rather than sending you to the Items tab, where a
   collapsed store group or a long list would hide the new item completely.

   The whole sheet is a transaction: everything is edited in sheet state and
   nothing touches the item until you save. An abandoned scan halfway down an
   aisle therefore leaves no half-finished edits behind. */
function sheetScanned(s) {
  const known = s.targetId ? ingredient(s.targetId) : null;
  const stores = storeNames(state.db.ingredients);
  const base = Number(s.price) || 0;
  const bought = Number(s.bought) || 0;

  const picker = [`<option value=""${s.targetId ? "" : " selected"}>A new item</option>`]
    .concat(
      state.db.ingredients.map(
        (i) => `<option value="${i.id}"${i.id === s.targetId ? " selected" : ""}>${esc(i.name)} (£${money(
          i.pricePerPack
        )})</option>`
      )
    )
    .join("");

  const delta =
    known && base > 0 && Math.abs(base - known.pricePerPack) > 0.004
      ? `<p class="muted" style="margin:-2px 0 8px">Was £${money(known.pricePerPack)}, so that is ${
          base > known.pricePerPack ? "up" : "down"
        } £${money(Math.abs(base - known.pricePerPack))}.</p>`
      : "";

  // what the packs in the trolley actually cost, deal included
  const spend = bought > 0 ? packCost({ pricePerPack: base, offer: s.offer }, bought) : 0;
  const full = bought * base;
  // the trolley is counted in packs, stock is kept in portions
  const stockNow = known ? stockPortions(known) : 0;
  const perPack = known ? packPortions(known) : Math.max(0.5, Number(s.portions) || 1);
  const adding = bought * perPack;

  return shell(
    known ? esc(known.name) : "New barcode",
    known
      ? "Update the price, record an offer, and add what you put in the trolley."
      : "This barcode is new. Fill it in and it is saved when you tap the button.",
    `
    ${s.err ? `<div class="err">${esc(s.err)}</div>` : ""}
    <label class="field" style="margin-bottom:8px"><span class="eyebrow">Barcode</span>
      <input class="inp mono" value="${esc(s.code)}" data-act="setScanCode"></label>

    <label class="field" style="margin-bottom:8px"><span class="eyebrow">This is</span>
      <select class="inp" data-act="setScanTarget">${picker}</select></label>

    ${
      known
        ? ""
        : `<div class="grid2" style="margin-bottom:8px">
             <label class="field"><span class="eyebrow">Name</span>
               <input class="inp" value="${esc(s.name)}" placeholder="Chicken Korma" data-act="setScanName"></label>
             <label class="field"><span class="eyebrow">Portions per pack</span>
               <input class="inp mono" type="number" step="0.5" min="0.5" value="${s.portions}"
                 data-act="setScanPortions"></label>
           </div>
           <label class="field" style="margin-bottom:8px"><span class="eyebrow">Store</span>
             <input class="inp" list="fb-scan-stores" value="${esc(s.store)}" placeholder="Leave blank to sort later"
               data-act="setScanStore">
             <datalist id="fb-scan-stores">${stores
               .map((st) => `<option value="${esc(st)}"></option>`)
               .join("")}</datalist></label>`
    }

    <label class="field" style="margin-bottom:8px"><span class="eyebrow">Shelf price £ per pack</span>
      <input class="inp mono" type="number" step="0.01" min="0" inputmode="decimal"
        value="${s.price}" placeholder="0.00" data-act="setScanPrice"></label>
    ${delta}

    ${offerEditor({ pricePerPack: base, offer: s.offer }, { kind: "setScanOfferKind", field: "setScanOfferField" })}

    <div style="border:1px solid var(--rule);padding:9px;margin-bottom:10px;background:#fff">
      <div class="row">
        <div class="grow">
          <span class="eyebrow" style="display:block">In the trolley</span>
          <span class="muted">${
            known
              ? `${trim2(stockNow)} portion${Math.abs(stockNow - 1) < 0.001 ? "" : "s"} in stock now`
              : "Nothing in stock yet"
          }</span>
        </div>
        <button class="btn small ghost" data-act="lessScanBought">&minus;</button>
        <span class="num" style="min-width:26px;text-align:center;font-weight:700;font-size:16px">${bought}</span>
        <button class="btn small ghost" data-act="moreScanBought">+</button>
      </div>
      ${
        bought > 0
          ? `<p class="muted" style="margin:7px 0 0">That is £${money(spend)}${
              full - spend > 0.004 ? `, saving £${money(full - spend)} on the offer` : ""
            }. ${bought} pack${bought === 1 ? "" : "s"} at ${trim2(perPack)} a pack is ${trim2(
              adding
            )} portions, so stock goes to ${trim2(stockNow + adding)} on save.</p>`
          : `<p class="muted" style="margin:7px 0 0">Packs in the trolley. Leave at 0 to record the price only.</p>`
      }
    </div>

    <button class="btn solid wide" data-act="saveScan">${
      bought > 0 ? `Save and add ${trim2(adding)} portions to stock` : "Save price"
    }</button>
    <p class="muted">Saving binds this barcode, so next time the scan comes straight here.
    Anything added to stock comes off what the shopping list says to buy.</p>`
  );
}

function sheetSettings(s) {
  const set = state.settings;
  const on = (p) => (set.provider === p ? " checked" : "");
  const configured = set.owner && set.repo && set.token;

  const themeBtn = (key, label) =>
    `<button data-act="setTheme" data-theme="${key}" data-on="${set.theme === key ? 1 : 0}">${label}</button>`;

  const flag = (key, label, note) => `<div class="row" style="margin-bottom:10px">
      <span class="grow"><span style="font-weight:600">${label}</span><br>
        <span class="muted">${note}</span></span>
      <button class="pill${set[key] ? " on" : ""}" data-act="toggleFlag" data-key="${key}">${
    set[key] ? "On" : "Off"
  }</button>
    </div>`;

  const repoBox = set.showRepo
    ? `
    <div class="grid2" style="margin-bottom:10px">
      <label class="field"><span class="eyebrow">Owner</span>
        <input class="inp" value="${esc(set.owner)}" placeholder="your-username" data-act="setSetting" data-key="owner"></label>
      <label class="field"><span class="eyebrow">Repo</span>
        <input class="inp" value="${esc(set.repo)}" placeholder="shop-data" data-act="setSetting" data-key="repo"></label>
    </div>
    <div class="grid2" style="margin-bottom:10px">
      <label class="field"><span class="eyebrow">File path</span>
        <input class="inp" value="${esc(set.path)}" data-act="setSetting" data-key="path"></label>
      <label class="field"><span class="eyebrow">Branch</span>
        <input class="inp" value="${esc(set.branch)}" data-act="setSetting" data-key="branch"></label>
    </div>
    <label class="field" style="margin-bottom:12px"><span class="eyebrow">Access token</span>
      <input class="inp mono" type="password" value="${esc(set.token)}" placeholder="github_pat_…"
        data-act="setSetting" data-key="token"></label>

    <h3>Receipt reading</h3>
    <div class="row" style="margin-bottom:10px">
      <label class="row grow"><input type="radio" name="prov" value="gemini" data-act="setProvider"${on("gemini")}> Gemini</label>
      <label class="row grow"><input type="radio" name="prov" value="anthropic" data-act="setProvider"${on("anthropic")}> Claude</label>
    </div>
    ${
      set.provider === "anthropic"
        ? `<label class="field" style="margin-bottom:10px"><span class="eyebrow">Anthropic key</span>
            <input class="inp mono" type="password" value="${esc(set.anthropicKey)}" placeholder="sk-ant-…"
              data-act="setSetting" data-key="anthropicKey"></label>
           <label class="field" style="margin-bottom:10px"><span class="eyebrow">Model</span>
            <input class="inp mono" value="${esc(set.anthropicModel)}" data-act="setSetting" data-key="anthropicModel"></label>`
        : `<label class="field" style="margin-bottom:10px"><span class="eyebrow">Gemini key</span>
            <input class="inp mono" type="password" value="${esc(set.geminiKey)}" placeholder="AIza…"
              data-act="setSetting" data-key="geminiKey"></label>
           <label class="field" style="margin-bottom:10px"><span class="eyebrow">Model</span>
            <input class="inp mono" value="${esc(set.geminiModel)}" data-act="setSetting" data-key="geminiModel"></label>`
    }

    <h3>Manual backup</h3>
    <textarea class="inp mono" data-act="setBackup" spellcheck="false">${esc(JSON.stringify(state.db, null, 2))}</textarea>
    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn tonal grow" data-act="copyBackup">Copy</button>
      <button class="btn tonal grow" data-act="restoreBackup">Restore</button>
      <button class="btn danger" data-act="resetAll">Reset</button>
    </div>
    <p class="muted">Keys and tokens stay on this device and are never written into the shared database.</p>`
    : "";

  return shell(
    "Settings",
    configured ? "Restore before you edit, update when you are done." : "Connect a database below to sync and share.",
    `
    ${s.msg ? `<div class="${s.err ? "err" : "ok"}">${esc(s.msg)}</div>` : ""}

    <div class="row" style="gap:8px;margin-bottom:8px">
      <button class="btn tonal grow" data-act="pullNow"${configured ? "" : " disabled"}>Restore from database</button>
      <button class="btn solid grow" data-act="pushNow"${configured ? "" : " disabled"}>Update database</button>
    </div>
    <p class="muted" style="margin:0 0 14px">${
      configured
        ? `${esc(set.owner)}/${esc(set.repo)} &middot; last updated ${esc(ago(set.lastPush))}${
            set.lastPush ? ` (${esc(ukTime(set.lastPush))})` : ""
          }${isDirty() ? " &middot; <strong>unsaved changes</strong>" : ""}`
        : "No database connected yet."
    }</p>

    <label class="field" style="margin-bottom:12px"><span class="eyebrow">Your name, shown in the change log</span>
      <input class="inp" value="${esc(set.person)}" placeholder="Lee" data-act="setSetting" data-key="person"></label>

    <h3>Appearance</h3>
    <div class="seg" style="margin-bottom:14px">
      ${themeBtn("light", "Light")}${themeBtn("dark", "Dark")}${themeBtn("system", "System")}
    </div>

    <h3>Syncing</h3>
    ${flag("autoMerge", "Merge on opening", "Pick up the other person's changes automatically.")}
    ${flag("warnOnLeave", "Save when leaving", "Update the database as you close or switch away.")}

    <h3>Share this list</h3>
    <div class="row" style="gap:8px;margin-bottom:8px">
      <button class="btn tonal grow" data-act="openInvite"${configured ? "" : " disabled"}>Invite someone</button>
      <button class="btn tonal grow" data-act="openJoin">Enter an invite</button>
    </div>
    <p class="muted" style="margin:0 0 10px">${
      configured
        ? "An invite hands over this database and its token, so their phone needs no GitHub account."
        : "Connect a database below first, then you can invite someone with one code."
    }</p>

    <button class="btn ghost wide" style="margin-bottom:10px" data-act="openHelp">The long way, with their own token</button>

    <button class="btn ghost wide head" data-act="toggleRepoBox">
      <span class="chev">${set.showRepo ? "\u25BE" : "\u25B8"}</span> Database, keys and backup
    </button>
    ${repoBox}`
  );
}

/* One code carries the database details and the token, so joining is a scan
   rather than a GitHub morning. The warning is not boilerplate: this really
   does hand over write access, and it belongs next to the code itself. */
function sheetInvite(s) {
  let code = "";
  let err = "";
  try {
    code = makeInvite(state.settings);
  } catch (e) {
    err = e.message;
  }

  if (err) {
    return shell(
      "Invite someone",
      "Nothing to share yet.",
      `<div class="err">${esc(err)}</div>
       <button class="btn tonal wide" data-act="openSettings">Back to settings</button>`
    );
  }

  return shell(
    "Invite someone",
    "One code is all they need. No GitHub account, no token, no waiting for an invite to be accepted.",
    `
    ${s.msg ? `<div class="ok">${esc(s.msg)}</div>` : ""}
    <div style="border:1px solid var(--rule);padding:12px;margin-bottom:10px;background:#fff">
      ${qrSvg(code, { label: "Invite code" })}
    </div>
    <p class="muted" style="margin-top:0">On their phone: <strong>Settings</strong>, then
    <strong>Enter an invite</strong>, then <strong>Scan the code</strong>.</p>

    <label class="field" style="margin-bottom:8px"><span class="eyebrow">Or send them this</span>
      <textarea class="inp mono" style="height:78px" readonly spellcheck="false"
        data-act="selectInvite">${esc(code)}</textarea></label>
    <button class="btn tonal wide" style="margin-bottom:10px" data-act="copyInvite">Copy the code</button>

    <p class="muted"><strong>This code is a key to your list.</strong> Anyone holding it can read and
    change your prices, and it works until you change the token on GitHub. Show it to the person in
    front of you rather than posting it somewhere it will sit forever.</p>
    <button class="btn ghost wide" data-act="openSettings">Back to settings</button>`
  );
}

function sheetJoin(s) {
  return shell(
    "Enter an invite",
    "Scan the code on the other phone, or paste one you were sent.",
    `
    ${s.err ? `<div class="err">${esc(s.err)}</div>` : ""}
    ${s.msg ? `<div class="ok">${esc(s.msg)}</div>` : ""}
    <button class="btn solid wide" style="margin-bottom:10px" data-act="scanInvite">Scan the code</button>
    <label class="field" style="margin-bottom:8px"><span class="eyebrow">Or paste the code</span>
      <textarea class="inp mono" style="height:78px" placeholder="FS1." spellcheck="false"
        data-act="setJoinCode">${esc(s.code || "")}</textarea></label>
    <button class="btn tonal wide" data-act="applyJoin">Join this list</button>
    <p class="muted">Joining replaces whichever database this phone was pointed at, and pulls their
    list in. Nothing you have is thrown away: the two are merged, and the higher stock count wins.</p>
    <label class="field" style="margin-top:6px"><span class="eyebrow">Your name, so they can see who changed what</span>
      <input class="inp" value="${esc(state.settings.person)}" placeholder="Sam"
        data-act="setSetting" data-key="person"></label>`
  );
}

function sheetHelp() {
  const set = state.settings;
  const owner = esc(set.owner || "your-username");
  const repo = esc(set.repo || "shop-data");

  return shell(
    "Sharing the long way",
    "About ten minutes for them, most of it waiting for GitHub.",
    `
    <p class="muted"><strong>Only do this if they need their own token.</strong> For a phone in the
    same room, <strong>Invite someone</strong> on the settings screen does the whole job with one
    code and no GitHub account. This way is for when you want each person's access revocable
    separately, at the cost of the setup below.</p>

    <h3>1. Invite them</h3>
    <ol>
      <li>Open <code>github.com/${owner}/${repo}</code></li>
      <li><strong>Settings</strong>, then <strong>Collaborators</strong> in the left menu</li>
      <li><strong>Add people</strong>, type their GitHub username, send the invite</li>
      <li>They accept it from their email or from GitHub notifications</li>
    </ol>

    <h3>2. They make a token</h3>
    <p class="muted">A token lets the app save on their behalf. It is theirs, not yours, and
    you never see it.</p>
    <ol>
      <li>They open <code>github.com/settings/personal-access-tokens/new</code></li>
      <li>Name it anything, set expiry to the longest offered</li>
      <li><strong>Resource owner:</strong> choose <strong>${owner}</strong>, not their own name</li>
      <li><strong>Repository access:</strong> Only select repositories, then <strong>${repo}</strong></li>
      <li><strong>Permissions:</strong> Repository permissions, find <strong>Contents</strong>, set to <strong>Read and write</strong></li>
      <li>Generate, then copy the token straight away. GitHub shows it once</li>
    </ol>

    <h3>3. They set up the app</h3>
    <ol>
      <li>Open this same web address on their phone</li>
      <li><strong>Settings</strong>, open <strong>Database, keys and backup</strong></li>
      <li>Owner <code>${owner}</code>, Repo <code>${repo}</code>, paste their token</li>
      <li>Put their name in the name box, so changes are labelled</li>
      <li>Tap <strong>Restore from database</strong> to pull everything down</li>
      <li>Add to Home screen from the browser menu</li>
    </ol>

    <h3>How it stays in step</h3>
    <ul>
      <li>Opening the app checks for their changes and merges them.</li>
      <li>Prices merge per item, whoever priced it most recently wins.</li>
      <li>Items, barcodes and meals are combined, never dropped.</li>
      <li>Stock takes the higher count, since a bought pack is real.</li>
      <li>The meal plan cannot be combined, so it comes from whoever saved last. Agree who owns it.</li>
    </ul>

    <h3>If something looks wrong</h3>
    <ul>
      <li><strong>Token rejected:</strong> it expired, or Resource owner was set to them instead of ${owner}.</li>
      <li><strong>Not found:</strong> they have not accepted the invite yet.</li>
      <li><strong>Their changes missing:</strong> they need to tap Update database, or leave Save when leaving on.</li>
    </ul>

    <p class="muted">Removing someone: take them off Collaborators on GitHub, and their token stops
    working. If instead you shared a code from <strong>Invite someone</strong>, that one token is the
    key for everybody, so revoking means making a new token on GitHub and re-inviting whoever stays.</p>
    <button class="btn tonal wide" style="margin-top:10px" data-act="openSettings">Back to settings</button>`
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

async function openCamera(title, onCode, opts = {}) {
  closeCamera();
  const qr = opts.formats === QR_FORMATS;
  const el = document.createElement("div");
  el.className = "scrim";
  el.innerHTML = `<div class="sheet">
    <button class="btn small ghost close" data-cam="close">Close</button>
    <h2>${esc(title)}</h2>
    <p class="muted" style="margin-top:0">${
      qr ? "Point this phone at the code on the other one." : "Hold the barcode inside the frame."
    }</p>
    <div class="scanner">
      <video playsinline muted></video><div class="reticle"></div>
      <div class="hint">${qr ? "Looking for a code" : "Looking for a barcode"}</div>
      <button class="btn small torch" data-cam="torch">Light</button>
    </div>
    <label class="field"><span class="eyebrow">${qr ? "Or paste the code" : "Or type the number"}</span>
      <input class="inp mono"${qr ? "" : ' inputmode="numeric"'} placeholder="${
      qr ? "FS1." : "5010000000000"
    }" data-cam="manual"></label>
    <button class="btn solid wide" style="margin-top:8px" data-cam="useManual">${
      qr ? "Use this code" : "Use this number"
    }</button>
  </div>`;
  document.body.appendChild(el);
  cam = { el, handle: null, onCode, torchOn: false };

  const hint = el.querySelector(".hint");
  const handle = await startScan(
    el.querySelector("video"),
    (code) => {
      // an invite code is far too long to splash across the hint line
      hint.textContent = code.length > 24 ? code.slice(0, 24) + "\u2026" : code;
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
    },
    opts.formats
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

/* Load an item into scan-sheet state. Offers are copied rather than
   referenced, so editing the sheet does not mutate the item before saving. */
function scanState(code, hit) {
  return {
    kind: "scanned",
    code: code || "",
    targetId: hit ? hit.id : "",
    name: "",
    portions: 1,
    store: "",
    price: hit ? String(hit.pricePerPack || "") : "",
    offer: hit && hit.offer ? { ...hit.offer } : null,
    bought: 0,
    err: "",
  };
}

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
  // No match means a thing you have not recorded yet, and adding it is nearly
  // always what you want. Ignoring it silently loses the shop.
  const unmatched = !res.id;
  return {
    raw: line.name,
    price: Number(line.unitPrice) || 0,
    qty: Number(line.qty) || 1,
    targetId: unmatched ? "__new__" : res.id,
    why: unmatched ? "nothing matched, so it will be added" : res.why,
    confident: res.confident,
    use: true,
    outdated: false,
    barcode: "",
    offerKind: line.offerKind || "none",
    offerQty: Number(line.offerQty) || 3,
    offerTotal: Number(line.offerTotal) || 0,
    newName: titleise(line.name),
    newPortions: 1,
    // Stock stays derived from the receipt's quantity until you touch it, so
    // changing which item a line points at re-derives rather than going stale.
    stockAdd: 0,
    stockTouched: false,
  };
}

/* A receipt is evidence of a price on the day it was printed, not today. An
   older receipt must never walk back a price corrected since, so any line
   whose item was updated after the receipt date is switched off, with the
   reason shown rather than the line quietly vanishing.

   The comparison is by day. A receipt from this afternoon and a correction
   made this morning are treated as equal standing, because a receipt carries
   no time and guessing one would only annoy. */
function refreshRows(rows, date) {
  return rows.map((r) => {
    const ing = r.targetId && r.targetId !== "__new__" ? ingredient(r.targetId) : null;
    const outdated = !!(ing && isEarlierDay(date, ing.priceUpdated));
    if (outdated === r.outdated) return r;
    // Only lines whose standing actually changed are touched, so a line
    // switched off by hand stays off. Correcting the date, though, removes the
    // reason this line was switched off, so it comes back on with it.
    return { ...r, outdated, use: outdated ? false : !!r.targetId };
  });
}

/* One pack's worth of portions for whatever a receipt line points at. */
function rowPackPortions(r) {
  if (r.targetId === "__new__") return Math.max(0.5, Number(r.newPortions) || 1);
  const ing = r.targetId ? ingredient(r.targetId) : null;
  return ing ? packPortions(ing) : 1;
}

/* Portions this line puts into stock. The receipt's quantity times the pack
   size is right most of the time, but a receipt cannot tell two flavours of
   the same thing apart, so an edit always wins. */
function rowStock(r) {
  if (r.stockTouched) return Math.max(0, Number(r.stockAdd) || 0);
  return Math.max(0, (Number(r.qty) || 1) * rowPackPortions(r));
}

/* Step a line's stock by one pack, since a receipt counts in packs even
   though the number in the box is portions. */
function bumpRowStock(i, dir) {
  const rows = state.sheet.rows.slice();
  const r = rows[i];
  if (!r) return;
  const next = Math.max(0, rowStock(r) + dir * rowPackPortions(r));
  rows[i] = { ...r, stockAdd: Math.round(next * 100) / 100, stockTouched: true };
  setSheet({ ...state.sheet, rows });
}

async function shootReceipt() {
  filePicker(async (file) => {
    setSheet({ ...state.sheet, busy: true, err: "" });
    try {
      const out = await readReceipt(state.settings, file);
      // an unreadable date falls back to today, which flags nothing as old
      const date = out.date || today();
      setSheet({
        kind: "receipt",
        busy: false,
        err: out.lines.length ? "" : "No product lines came back. Try a flatter photo with the whole receipt in frame.",
        store: canonicalStore(out.store, storeNames(state.db.ingredients)),
        date,
        dateRead: !!out.date,
        rows: refreshRows(out.lines.map(receiptRow), date),
      });
    } catch (err) {
      setSheet({ ...state.sheet, busy: false, err: err.message });
    }
  });
}

function applyReceipt() {
  const s = state.sheet;
  // the day on the receipt, not today, or a shop entered a week late would
  // outrank every correction made in between
  const stamp = dayOf(s.date) || today();
  const rows = s.rows.filter((r) => r.use && r.targetId && r.price > 0);
  let created = 0;
  let updated = 0;
  let stocked = 0;
  let stockedItems = 0;

  commit((db) => {
    for (const r of rows) {
      const alias = norm(r.raw);
      let target = r.targetId;

      if (target === "__new__") {
        // The receipt genuinely tells us the store, so that one is not a guess.
        const made = newIngredient(s.store);
        made.name = (r.newName || "").trim() || titleise(r.raw);
        made.portionsPerPack = Math.max(0.5, Number(r.newPortions) || 1);
        made.updatedAt = stamp;
        made.id = uniqueId(made.name, db.ingredients.map((i) => i.id));
        db.ingredients.push(made);
        target = made.id;
        created += 1;
      } else {
        updated += 1;
      }

      const idx = db.ingredients.findIndex((i) => i.id === target);
      if (idx < 0) continue;
      const ing = { ...db.ingredients[idx] };
      // An offer price must not overwrite the base price, or the base price
      // drifts down every time a promotion runs and never comes back up.
      // The kind matters: a card price applies to a single pack, a multibuy
      // does not, so storing a multibuy as a card price understates singles.
      if (r.offerKind === "loyalty") {
        ing.offer = { kind: "loyalty", price: r.price, ends: "" };
        if (!ing.pricePerPack) ing.pricePerPack = r.price;
      } else if (r.offerKind === "multibuy" && r.offerQty > 1 && r.offerTotal > 0) {
        ing.offer = { kind: "multibuy", qty: r.offerQty, price: r.offerTotal, ends: "" };
        // With no base price on record the deal rate is the only number we
        // have. It shows in the editor so it can be corrected.
        if (!ing.pricePerPack) ing.pricePerPack = r.offerTotal / r.offerQty;
      } else {
        ing.pricePerPack = r.price;
      }
      // Stock is in portions. The line was pre-filled from the receipt's
      // quantity and may have been corrected, so take whatever it holds now.
      const add = rowStock(r);
      if (add > 0) {
        ing.stockPortions = (Number(ing.stockPortions) || 0) + add;
        // buying it settles whatever was on the list by hand
        ing.extraPacks = 0;
        stocked += add;
        stockedItems += 1;
      }
      ing.priceUpdated = stamp;
      ing.updatedAt = stamp;
      if (s.store) ing.store = s.store;
      ing.aliases = [...new Set([...(ing.aliases || []), alias])];
      if (r.barcode) ing.barcodes = [...new Set([...(ing.barcodes || []), r.barcode])];
      db.ingredients[idx] = ing;
    }
  });

  state.sheet = null;
  flash(
    "ok",
    `${updated} price${updated === 1 ? "" : "s"} updated${
      created ? `, ${created} new item${created === 1 ? "" : "s"} added` : ""
    }${
      stockedItems
        ? `, ${trim2(stocked)} portions into stock across ${stockedItems} item${
            stockedItems === 1 ? "" : "s"
          }`
        : ""
    }.`
  );
}

/* --------------------------------- sync -------------------------------- */

/* On open, see whether the shared file has moved on since this device last
   pulled. Merging is almost always what you want, so with autoMerge on it
   just happens and reports what changed; otherwise a banner offers it. */
async function checkForChanges() {
  const set = state.settings;
  if (!set.owner || !set.repo || !set.token) return;
  try {
    const { db } = await pull(set);
    if (!db) return;
    const remoteAt = db.updatedAt || "";
    if (!remoteAt || remoteAt <= (set.lastPull || "")) return;

    state.incoming = { at: remoteAt, who: db.lastPushedBy || "", db };
    if (set.autoMerge) {
      await acceptIncoming(true);
    } else {
      draw();
    }
  } catch (err) {
    // offline or a bad token should never block the app from opening
  }
}

async function acceptIncoming(quiet) {
  const incoming = state.incoming;
  if (!incoming) return;
  const { db: merged, notes } = mergeSnapshots(state.db, incoming.db);
  state.db = merged;
  state.incoming = null;
  await saveDb(state.db);
  state.settings = { ...state.settings, lastPull: new Date().toISOString() };
  await saveSettings(state.settings);

  const bits = [];
  if (notes.added) bits.push(`${notes.added} new item${notes.added === 1 ? "" : "s"}`);
  if (notes.updated) bits.push(`${notes.updated} updated price${notes.updated === 1 ? "" : "s"}`);
  const who = incoming.who ? `${incoming.who}'s` : "Their";
  flash(
    "ok",
    bits.length
      ? `${who} changes merged: ${bits.join(", ")}.`
      : `${who} changes merged.`
  );
  if (!quiet) draw();
}

/* Take an invite. The joiner usually has a list of their own already, so this
   merges rather than replaces, on the same rules as any other pull. */
async function joinList(code) {
  let invite;
  try {
    invite = readInvite(code);
  } catch (err) {
    setSheet({ ...state.sheet, err: err.message, msg: "" });
    return;
  }

  setSheet({ ...state.sheet, err: "", msg: "Connecting…" });
  const before = state.settings;
  state.settings = {
    ...before,
    owner: invite.owner,
    repo: invite.repo,
    path: invite.path,
    branch: invite.branch,
    token: invite.token,
    // a different database entirely, so what this device last saw means nothing
    lastPull: "",
    lastPush: "",
  };
  await saveSettings(state.settings);

  try {
    const { db } = await pull(state.settings);
    if (!db) {
      setSheet({
        ...state.sheet,
        err: "",
        msg: "Connected, but there is no list there yet. Ask them to tap Update database, then try again.",
      });
      return;
    }

    const { db: merged, notes } = mergeSnapshots(state.db, db);
    state.db = merged;
    await saveDb(state.db);
    state.settings = { ...state.settings, lastPull: new Date().toISOString() };
    await saveSettings(state.settings);

    const bits = [];
    if (notes.added) bits.push(`${notes.added} item${notes.added === 1 ? "" : "s"} picked up`);
    if (notes.updated) bits.push(`${notes.updated} price${notes.updated === 1 ? "" : "s"} newer than yours`);
    state.sheet = null;
    flash(
      "ok",
      `Joined ${invite.from ? invite.from + "'s" : "the shared"} list${bits.length ? `: ${bits.join(", ")}` : ""}.`
    );
  } catch (err) {
    // put the old connection back rather than stranding them on a broken one
    state.settings = before;
    await saveSettings(state.settings);
    setSheet({ ...state.sheet, err: `${err.message} Nothing was changed.`, msg: "" });
  }
}

async function pullNow() {
  setSheet({ ...state.sheet, msg: "Pulling…", err: false });
  try {
    const { db } = await pull(state.settings);
    if (!db) {
      setSheet({ ...state.sheet, msg: "No file there yet. Push first to create it.", err: false });
      return;
    }

    // Merge rather than replace. Someone else may have priced things since
    // your last pull, and overwriting would silently discard their work.
    const { db: merged, notes } = mergeSnapshots(state.db, db);
    state.db = merged;
    await saveDb(state.db);
    state.settings = { ...state.settings, lastPull: new Date().toISOString() };
    await saveSettings(state.settings);

    const bits = [];
    if (notes.added) bits.push(`${notes.added} new item${notes.added === 1 ? "" : "s"}`);
    if (notes.updated) bits.push(`${notes.updated} price${notes.updated === 1 ? "" : "s"} newer than yours`);
    if (notes.kept) bits.push(`${notes.kept} of yours kept`);
    bits.push(`meal plan from ${notes.planFrom === "remote" ? "the repo" : "this device"}`);
    setSheet({ ...state.sheet, msg: `Merged: ${bits.join(", ")}.`, err: false });
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
    if (remoteNewer) {
      setSheet({
        ...state.sheet,
        msg: "Someone has pushed since your last pull. Tap Pull first, which merges their changes with yours, then push.",
        err: true,
      });
      return;
    }
    state.db.lastPushedBy = (state.settings.person || "").trim();
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
      setSheet(scanState(code, hit));
    }),

  setScanCode: (el) => {
    const code = el.value.trim();
    const hit = state.db.ingredients.find((i) => (i.barcodes || []).includes(code));
    if (hit && hit.id !== state.sheet.targetId) {
      setSheet({ ...scanState(code, hit), bought: state.sheet.bought });
      return;
    }
    setSheet({ ...state.sheet, code });
  },
  setScanTarget: (el) => {
    const hit = el.value ? ingredient(el.value) : null;
    // pull that item's price and offer in, so you are editing what it really has
    setSheet({ ...scanState(state.sheet.code, hit), bought: state.sheet.bought });
  },
  setScanName: (el) => setSheet({ ...state.sheet, name: el.value }),
  setScanPortions: (el) => setSheet({ ...state.sheet, portions: Math.max(0.5, Number(el.value) || 1) }),
  setScanStore: (el) =>
    setSheet({ ...state.sheet, store: canonicalStore(el.value, storeNames(state.db.ingredients)) }),
  setScanPrice: (el) => setSheet({ ...state.sheet, price: el.value }),

  setScanOfferKind: (el) => {
    const kind = el.value;
    if (!kind) {
      setSheet({ ...state.sheet, offer: null });
      return;
    }
    const prev = state.sheet.offer || {};
    const next = { kind, ends: prev.ends || "" };
    if (kind === "loyalty") next.price = prev.price || 0;
    if (kind === "multibuy") { next.qty = prev.qty || 2; next.price = prev.price || 0; }
    if (kind === "xfory") { next.qty = prev.qty || 3; next.pay = prev.pay || 2; }
    setSheet({ ...state.sheet, offer: next });
  },
  setScanOfferField: (el) => {
    if (!state.sheet.offer) return;
    const field = el.dataset.field;
    const value = field === "ends" ? el.value : Number(el.value) || 0;
    setSheet({ ...state.sheet, offer: { ...state.sheet.offer, [field]: value } });
  },
  moreScanBought: () => setSheet({ ...state.sheet, bought: (Number(state.sheet.bought) || 0) + 1 }),
  lessScanBought: () =>
    setSheet({ ...state.sheet, bought: Math.max(0, (Number(state.sheet.bought) || 0) - 1) }),

  saveScan: () => {
    const s = state.sheet;
    const price = Number(s.price);
    if (!Number.isFinite(price) || price <= 0) {
      setSheet({ ...s, err: "Type the shelf price first." });
      return;
    }
    const bought = Math.max(0, Number(s.bought) || 0);
    const offer = cleanOffer(s.offer);

    if (s.targetId) {
      const ing = ingredient(s.targetId);
      if (!ing) return;
      const before = ing.pricePerPack;
      const added = bought * packPortions(ing);
      patchIngredient(ing.id, {
        pricePerPack: price,
        priceUpdated: now(),
        offer,
        stockPortions: stockPortions(ing) + added,
        // buying it settles whatever was on the list by hand
        extraPacks: bought > 0 ? 0 : ing.extraPacks,
        barcodes: [...new Set([...(ing.barcodes || []), s.code].filter(Boolean))],
      });
      state.sheet = null;
      const delta = price - before;
      const moved =
        Math.abs(delta) > 0.004 ? `, ${delta > 0 ? "up" : "down"} £${money(Math.abs(delta))}` : "";
      flash(
        "ok",
        bought > 0
          ? `${ing.name} now £${money(price)}${moved}. ${bought} pack${
              bought === 1 ? "" : "s"
            }, ${trim2(added)} portions, added to stock.`
          : `${ing.name} now £${money(price)}${moved}.`
      );
      return;
    }

    const name = (s.name || "").trim();
    if (!name) {
      setSheet({ ...s, err: "Give the new item a name." });
      return;
    }
    const made = newIngredient(s.store);
    made.name = name;
    made.portionsPerPack = Math.max(0.5, Number(s.portions) || 1);
    made.pricePerPack = price;
    made.priceUpdated = now();
    made.updatedAt = now();
    made.offer = offer;
    made.stockPortions = bought * made.portionsPerPack;
    made.barcodes = s.code ? [s.code] : [];
    made.id = uniqueId(name, state.db.ingredients.map((i) => i.id));
    commit((db) => db.ingredients.push(made));
    state.sheet = null;
    flash(
      "ok",
      bought > 0
        ? `${made.name} added at £${money(price)}, ${trim2(made.stockPortions)} portions in stock.`
        : `${made.name} added at £${money(price)}.`
    );
  },

  bought: (el) => {
    const ing = ingredient(el.dataset.id);
    if (!ing) return;
    // packs off the shelf, portions into stock
    const packs = Number(el.dataset.packs) || 0;
    patchIngredient(ing.id, {
      stockPortions: stockPortions(ing) + packs * packPortions(ing),
      extraPacks: 0,
    });
  },

  moreStockPack: (el) => {
    const ing = ingredient(el.dataset.id);
    if (ing) patchIngredient(ing.id, { stockPortions: stockPortions(ing) + packPortions(ing) });
  },
  lessStockPack: (el) => {
    const ing = ingredient(el.dataset.id);
    if (ing) {
      patchIngredient(ing.id, { stockPortions: Math.max(0, stockPortions(ing) - packPortions(ing)) });
    }
  },

  toggleStore: (el) => toggleShut(el.dataset.which, el.dataset.store),
  setQuery: (el) => {
    state.query = el.value;
    draw();
  },
  clearQuery: () => {
    state.query = "";
    draw();
  },
  mergeIncoming: () => acceptIncoming(),
  setTheme: async (el) => {
    state.settings = { ...state.settings, theme: el.dataset.theme };
    await saveSettings(state.settings);
    applyTheme(state.settings.theme);
    draw();
  },
  toggleFlag: async (el) => {
    const key = el.dataset.key;
    state.settings = { ...state.settings, [key]: !state.settings[key] };
    await saveSettings(state.settings);
    draw();
  },
  openHelp: () => setSheet({ kind: "help" }),

  openInvite: () => setSheet({ kind: "invite", msg: "" }),
  openJoin: () => setSheet({ kind: "join", code: "", err: "", msg: "" }),
  selectInvite: () => {},
  copyInvite: async () => {
    try {
      await navigator.clipboard.writeText(makeInvite(state.settings));
      setSheet({ ...state.sheet, msg: "Copied. Paste it straight into a message to them." });
    } catch (err) {
      setSheet({ ...state.sheet, msg: "Copy blocked. Press and hold the code above to select it." });
    }
  },
  setJoinCode: (el) => {
    state.sheet = { ...state.sheet, code: el.value };
  },
  scanInvite: () =>
    openCamera(
      "Scan an invite",
      (code) => setSheet({ kind: "join", code, err: "", msg: "" }),
      { formats: QR_FORMATS }
    ),
  applyJoin: () => joinList(state.sheet.code),
  addToList: (el) => {
    const ing = ingredient(el.dataset.id);
    if (ing) patchIngredient(ing.id, { extraPacks: (Number(ing.extraPacks) || 0) + 1 });
  },
  lessExtra: (el) => {
    const ing = ingredient(el.dataset.id);
    if (ing) patchIngredient(ing.id, { extraPacks: Math.max(0, (Number(ing.extraPacks) || 0) - 1) });
  },
  clearExtra: (el) => patchIngredient(el.dataset.id, { extraPacks: 0 }),

  setOfferKind: (el) => {
    const kind = el.value;
    if (!kind) {
      patchIngredient(el.dataset.id, { offer: null });
      return;
    }
    const ing = ingredient(el.dataset.id);
    const prev = (ing && ing.offer) || {};
    const seed = { kind, ends: prev.ends || "" };
    if (kind === "loyalty") seed.price = prev.price || 0;
    if (kind === "multibuy") { seed.qty = prev.qty || 2; seed.price = prev.price || 0; }
    if (kind === "xfory") { seed.qty = prev.qty || 3; seed.pay = prev.pay || 2; }
    patchIngredient(el.dataset.id, { offer: seed });
  },
  setOfferField: (el) => {
    const ing = ingredient(el.dataset.id);
    if (!ing || !ing.offer) return;
    const field = el.dataset.field;
    const value = field === "ends" ? el.value : Number(el.value) || 0;
    patchIngredient(ing.id, { offer: { ...ing.offer, [field]: value } });
  },

  setBudget: (el) => commit((db) => { db.budget = Number(el.value) || 0; }),
  setSlot: (el) =>
    commit((db) => {
      const day = db.plan[Number(el.dataset.idx)];
      if (day) day[el.dataset.slot] = el.value || null;
    }),
  fillSlot: (el) => {
    const slot = el.dataset.slot;
    const first = state.db.plan[0] && state.db.plan[0][slot];
    if (!first) {
      flash("err", `Set day one's ${slot} first, then this copies it across.`);
      return;
    }
    commit((db) => {
      db.plan.forEach((day) => {
        if (day && !day[slot]) day[slot] = first;
      });
    });
  },
  clearPlan: () => {
    if (confirm("Clear both weeks?"))
      commit((db) => {
        db.plan = Array.from({ length: 14 }, () => ({ breakfast: null, lunch: null, dinner: null }));
      });
  },

  openItem: (el) => {
    const id = el.dataset.id;
    const open = state.sheet && state.sheet.kind === "item" && state.sheet.id === id;
    setSheet(open ? null : { kind: "item", id });
  },
  addItem: async () => {
    const made = newIngredient();
    made.id = uniqueId(made.name, state.db.ingredients.map((i) => i.id));
    commit((db) => db.ingredients.push(made));
    await revealItem(made.id);
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
  setField: (el) => {
    const field = el.dataset.field;
    const value =
      field === "store"
        ? canonicalStore(el.value, storeNames(state.db.ingredients.filter((i) => i.id !== el.dataset.id)))
        : el.value;
    patchIngredient(el.dataset.id, { [field]: value });
  },
  // portions and stock are both counts of things, so never below zero
  setNumber: (el) =>
    patchIngredient(el.dataset.id, { [el.dataset.field]: Math.max(0, Number(el.value) || 0) }),
  setPrice: (el) =>
    patchIngredient(el.dataset.id, { pricePerPack: Number(el.value) || 0, priceUpdated: now() }),
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

  openMeal: (el) => {
    const id = el.dataset.id;
    const open = state.sheet && state.sheet.kind === "meal" && state.sheet.id === id;
    setSheet(open ? null : { kind: "meal", id });
  },
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
      db.plan = db.plan.map((day) => {
        const next = { ...day };
        SLOTS.forEach((slot) => {
          if (next[slot.key] === id) next[slot.key] = null;
        });
        return next;
      });
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
  setReceiptStore: (el) =>
    setSheet({ ...state.sheet, store: canonicalStore(el.value, storeNames(state.db.ingredients)) }),
  setReceiptDate: (el) => {
    const date = el.value || today();
    setSheet({ ...state.sheet, date, dateRead: true, rows: refreshRows(state.sheet.rows, date) });
  },
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
    // Portions are a different size on a different item, so a figure typed
    // against the old target must not carry over to the new one.
    rows[i] = {
      ...rows[i],
      targetId: el.value,
      use: !!el.value,
      why: el.value ? "you chose it" : "ignored",
      stockAdd: 0,
      stockTouched: false,
    };
    // the item they just chose may itself be newer than this receipt
    setSheet({ ...state.sheet, rows: refreshRows(rows, state.sheet.date) });
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
  setRowName: (el) => {
    const rows = state.sheet.rows.slice();
    rows[Number(el.dataset.i)] = { ...rows[Number(el.dataset.i)], newName: el.value };
    state.sheet = { ...state.sheet, rows };
  },
  setRowPortions: (el) => {
    const rows = state.sheet.rows.slice();
    const i = Number(el.dataset.i);
    rows[i] = { ...rows[i], newPortions: Math.max(0.5, Number(el.value) || 1) };
    // a redraw here, unlike the name field, because the pack size decides how
    // many portions the line puts into stock
    setSheet({ ...state.sheet, rows });
  },
  setRowStock: (el) => {
    const rows = state.sheet.rows.slice();
    const i = Number(el.dataset.i);
    rows[i] = { ...rows[i], stockAdd: Math.max(0, Number(el.value) || 0), stockTouched: true };
    setSheet({ ...state.sheet, rows });
  },
  moreRowStock: (el) => bumpRowStock(Number(el.dataset.i), 1),
  lessRowStock: (el) => bumpRowStock(Number(el.dataset.i), -1),

  setRowOfferKind: (el) => {
    const rows = state.sheet.rows.slice();
    const i = Number(el.dataset.i);
    rows[i] = { ...rows[i], offerKind: el.value };
    setSheet({ ...state.sheet, rows });
  },
  setRowOfferQty: (el) => {
    const rows = state.sheet.rows.slice();
    const i = Number(el.dataset.i);
    rows[i] = { ...rows[i], offerQty: Math.max(2, Number(el.value) || 2) };
    setSheet({ ...state.sheet, rows });
  },
  setRowOfferTotal: (el) => {
    const rows = state.sheet.rows.slice();
    const i = Number(el.dataset.i);
    rows[i] = { ...rows[i], offerTotal: Number(el.value) || 0 };
    setSheet({ ...state.sheet, rows });
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
  toggleRepoBox: async () => {
    state.settings = { ...state.settings, showRepo: !state.settings.showRepo };
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

/* --------------------------- leaving the page --------------------------- */

/* Desktop browsers show their own generic "leave site?" dialog; the wording
   cannot be customised. Mobile browsers mostly ignore it, which is why the
   visibility handler below matters more in practice. */
window.addEventListener("beforeunload", (e) => {
  if (!state.settings || !state.settings.warnOnLeave) return;
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = "";
});

/* On a phone the tab is rarely "closed", it is backgrounded. This is the only
   reliable moment to save, so push quietly then rather than nagging. */
let leaving = false;
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "hidden") return;
  if (!state.settings || !state.settings.warnOnLeave) return;
  if (!isDirty() || leaving) return;
  leaving = true;
  try {
    state.db.lastPushedBy = (state.settings.person || "").trim();
    await push(state.settings, state.db);
    state.settings = {
      ...state.settings,
      lastPush: new Date().toISOString(),
      lastPull: new Date().toISOString(),
    };
    await saveSettings(state.settings);
  } catch (err) {
    // no signal in the aisle is normal; the next manual save will catch up
  } finally {
    leaving = false;
  }
});

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
  try {
    state.db = await loadDb();
    state.settings = await loadSettings();
    applyTheme(state.settings.theme);
    draw();
    checkForChanges();
  } catch (err) {
    // Storage can fail outright in private windows with strict settings.
    // Say so plainly rather than leaving the page on "Loading."
    root.dataset.booted = "1";
    root.innerHTML =
      `<div class="wrap"><div class="err"><strong>Could not open local storage.</strong><br>` +
      `${esc(err && err.message ? err.message : String(err))}</div>` +
      `<p class="muted">This usually means the browser is blocking site data. ` +
      `Private windows and strict cookie settings both do it.</p></div>`;
  }
})();
