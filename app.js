/* Fortnight Shop.
   No framework and no build step, so this file can be edited on a phone and
   pushed straight to Pages. Rendering is a full innerHTML rebuild; inputs are
   uncontrolled and commit on "change" (blur or Enter), so a rebuild never
   interrupts typing. The camera overlay lives outside the render tree because
   a rebuild would kill the video stream. */

import {
  loadDb, saveDb, loadSettings, saveSettings, seed, migrate, newIngredient,
  resolveLine, resolveProduct, norm, uid, slug, uniqueId, canonicalStore, storeNames,
  cleanOffer, mergeSnapshots, makeInvite, readInvite, newProduct, productKey,
  findProductByBarcode, findByBarcode, findAllByBarcode, copyToShop, moveProduct,
  tidyProductName, SLOTS,
} from "./lib/store.js";
import {
  computeShopping, mealCost, portionCost, itemPortionCost, packCost, activeOffer,
  offerLabel, offerExpired, anyOfferExpired, offerMeaning, groupByStore, searchItems,
  ukTime, ago, money, today, now, dayOf, isEarlierDay, daysSince, STALE_DAYS,
  stockPortions, stockPacks, packPortions, productStock,
  productsOf, productById, chooseProduct, isPinned, productPortionCost, cheaperThan, mealStock,
  NUTRIENTS, PER100, emptyNutrition, addNutrition, hasNutrition, gramsPerPortion,
  labelToPer100, labelSizing,
  portionsPer, productNutrition, itemPortions, itemNutrition, itemProduct, itemIsGrams,
  nutritionUsable,
} from "./lib/calc.js";
import { scanSupported, decoderKind, startScan, decodeStill, QR_FORMATS } from "./lib/scan.js";
import { qrSvg } from "./lib/qr.js";
import { readReceipt, readNutrition } from "./lib/vision.js";
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

/* Safari on iOS has ignored user-scalable=no since iOS 10, so the meta tag
   alone leaves pinch zoom live. Zooming out then shrinks the app inside a
   blank page it can never scroll back from, which reads as a broken layout.
   These are the only events that offer a way to refuse it. */
for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

/* Which copy of the app is running, asked of the service worker rather than
   baked into a constant, so it cannot be out of date by construction. This is
   what turns "I do not think the update came through" into something you can
   read off the screen. */
const build = { version: "", checking: false };

function askVersion() {
  const sw = navigator.serviceWorker;
  if (!sw || !sw.controller) return;
  sw.controller.postMessage("version");
}

if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (!e.data || !e.data.version || e.data.version === build.version) return;
    build.version = e.data.version;
    if (state.sheet && state.sheet.kind === "settings") draw();
  });
  navigator.serviceWorker.ready.then(askVersion).catch(() => {});
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
  const chosen = ing ? chooseProduct(ing) : null;
  const store = (chosen && chosen.store) || "Unassigned";
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

/* A product's id is built from its name and shop, so that two devices agree
   without talking. Renaming either therefore has to move the id, and carry the
   pin and any meal that named it along with it. */
function renameProduct(ing, product, changes) {
  const name = changes.name !== undefined ? changes.name : product.name;
  const store = changes.store !== undefined ? changes.store : product.store;
  const nextId = productKey(name, store);

  if (nextId !== product.id && productsOf(ing).some((p) => p.id === nextId)) {
    flash("err", `${ing.name} already has one called that. Edit that one, or remove it first.`);
    draw();
    return;
  }

  commit((db) => {
    const i = db.ingredients.findIndex((x) => x.id === ing.id);
    if (i < 0) return;
    const was = db.ingredients[i];
    db.ingredients[i] = {
      ...was,
      updatedAt: now(),
      preferredProductId: was.preferredProductId === product.id ? nextId : was.preferredProductId,
      products: (was.products || []).map((p) =>
        p.id === product.id ? { ...p, name, store, id: nextId } : p
      ),
    };
    if (nextId !== product.id) {
      db.meals = db.meals.map((m) => ({
        ...m,
        items: m.items.map((it) =>
          it.ingredientId === ing.id && it.productId === product.id
            ? { ...it, productId: nextId }
            : it
        ),
      }));
    }
  });
}

/* Edit one line of a meal. The mutator is handed the line and the ingredient
   it points at, since deciding what to change usually means knowing how big a
   portion of that product is. */
function patchMealItem(mealId, index, changes) {
  commit((db) => {
    const meal = db.meals.find((m) => m.id === mealId);
    const it = meal && meal.items[index];
    if (!it) return;
    const ing = db.ingredients.find((i) => i.id === it.ingredientId) || null;
    Object.assign(it, changes(it, ing) || {});
  });
}

/* Edit one product. The ingredient's own stamp moves too, because changing
   what the Aldi one costs is a change to the ingredient as far as sharing is
   concerned. */
function patchProduct(id, productId, changes) {
  commit((db) => {
    const i = db.ingredients.findIndex((x) => x.id === id);
    if (i < 0) return;
    const ing = db.ingredients[i];
    const products = (ing.products || []).map((p) =>
      p.id === productId ? { ...p, ...changes } : p
    );
    db.ingredients[i] = { ...ing, products, updatedAt: now() };
  });
}

const productOf = (id, productId) => productById(ingredient(id), productId);

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

  /* An edit can move the card you are working on: giving a product a shop
     files its item under a different heading. Restoring the old pixel offset
     then leaves you staring at whatever slid into that spot, which is the
     clunky part. Remember where the open card sits on screen instead. */
  const openId = state.sheet && state.sheet.kind === "item" ? state.sheet.id : null;
  const openCard = openId ? root.querySelector(`[data-scroll="${openId}"]`) : null;
  const anchorWas = openCard ? openCard.getBoundingClientRect().top : null;

  root.innerHTML = [
    viewMasthead(),
    `<div class="wrap">`,
    state.flash ? `<div class="${state.flash.kind === "err" ? "err" : "ok"}">${esc(state.flash.text)}</div>` : "",
    ({ list: viewList, plan: viewPlan, food: viewFood, meals: viewMeals, items: viewItems }[
      state.tab
    ] || viewList)(),
    `</div>`,
    viewTabs(),
    viewSheet(),
  ].join("");

  root.dataset.booted = "1";
  window.scrollTo(0, pageScroll);

  /* Put the card back under your thumb, wherever the rebuild moved it to.
     Twice, because the first correction can be cut short: restoring the old
     offset on a page that has become shorter clamps at the bottom, and the
     move then starts from somewhere other than where it was measured. */
  if (anchorWas !== null) {
    for (let i = 0; i < 2; i++) {
      const now = root.querySelector(`[data-scroll="${openId}"]`);
      if (!now) break;
      const off = now.getBoundingClientRect().top - anchorWas;
      if (Math.abs(off) < 1) break;
      window.scrollBy(0, off);
    }
  }
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
      /* preventScroll, or restoring focus drags the page to wherever the
         field ended up and undoes the anchoring just done above. */
      again.focus({ preventScroll: true });
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
      <p>${c.plannedMeals} of ${c.totalSlots} meals planned &middot; ${state.db.ingredients.length} items
        </p>
    </div>
    <button class="btn small ghost" data-act="openSettings">Settings</button>
  </div></header>`;
}

function viewTabs() {
  const c = state.calc;
  const tabs = [
    ["list", "List", c.lines.length],
    ["plan", "Plan", c.plannedMeals],
    ["food", "Food", c.dayKcal],
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
  const bits = [`${l.packs} pack${l.packs === 1 ? "" : "s"} @ £${money(l.product && l.product.pricePerPack)}`];
  if (l.offer) bits.push(l.offer);
  if (l.product && l.product.packLabel) bits.push(esc(l.product.packLabel));
  if (l.extra) bits.push(`${l.extra} by hand`);
  // needs 4, has 2, so a whole pack is still required: say so on the line
  if (l.stock > 0.001) bits.push(`${trim2(l.stock)} in stock`);
  if (l.leftover > 0.001) bits.push(`${trim2(l.leftover)} left over`);

  /* The heading is the ingredient, because that is what the meal asked for.
     The product goes underneath, because that is what you pick off the shelf,
     and the two are different the moment an ingredient has more than one. */
  const product = l.product ? l.product.name : "";
  const named = product && product !== l.ing.name;

  return `<div class="ticket">
    <div class="grow">
      <div class="name trunc">${l.stale ? '<span class="dot"></span>' : ""}${esc(l.ing.name)}</div>
      ${named ? `<div class="meta">${esc(product)}</div>` : ""}
      <div class="meta">${bits.join(" &middot; ")}</div>
      ${l.saving > 0.004 ? `<div class="meta save">saves £${money(l.saving)}</div>` : ""}
      ${
        l.only
          ? `<div class="meta">this one only, asked for by name</div>`
          : l.cheaper && l.cheaper.perPortion > 0.001
          ? `<div class="meta save">cheapest of ${l.cheaper.count}${
              isPinned(l.ing, l.product) ? ", pinned" : ""
            } &middot; ${esc(l.cheaper.against.name || l.cheaper.against.store || "another")} is £${money(
              l.cheaper.perPortion
            )} more a portion</div>`
          : isPinned(l.ing, l.product) && l.cheaper
          ? `<div class="meta">pinned &middot; ${l.cheaper.count} priced</div>`
          : ""
      }
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
        <button class="btn small ghost" data-act="bought" data-id="${l.ing.id}"
          data-product="${esc((l.product && l.product.id) || "")}" data-packs="${l.packs}">Got it</button>
      </div>
    </div>
  </div>`;
}

/* ---- plan ---- */

/* Day names come from the start date rather than a fixed Monday, because a
   fortnight that begins on a Thursday should say so. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function planDate(start, index) {
  if (!start) return null;
  const t = new Date(`${dayOf(start)}T12:00:00`).getTime();
  if (!Number.isFinite(t)) return null;
  // midday, so British Summer Time cannot roll a date backwards
  return new Date(t + index * 86400000);
}

function viewPlan() {
  const c = state.calc;
  const people = state.db.people || ["Person 1", "Person 2"];
  const start = state.db.planStart || "";

  // the same order as the Meals tab, since this is the other place you pick one
  const inOrder = state.db.meals.slice().sort((a, b) => a.name.localeCompare(b.name));
  const options = (selected) =>
    [`<option value="">\u2014</option>`]
      .concat(
        inOrder.map(
          (m) => `<option value="${m.id}"${m.id === selected ? " selected" : ""}>${esc(m.name)}</option>`
        )
      )
      .join("");

  const week = (w) => {
    const subtotal = c.dayCost.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0);

    const rows = Array.from({ length: 7 }, (_, i) => {
      const idx = w * 7 + i;
      const day = state.db.plan[idx] || {};
      const when = planDate(start, idx);
      const name = when ? WEEKDAYS[when.getDay()] : DAYS[i];
      const dated = when
        ? when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
        : "";

      const slots = SLOTS.map((slot) => {
        const pair = Array.isArray(day[slot.key]) ? day[slot.key] : [day[slot.key] || null, null];
        const pick = (person) => `<select data-act="setSlot" data-idx="${idx}" data-slot="${slot.key}"
            data-person="${person}" aria-label="${slot.label} for ${esc(people[person])}, ${name}">${options(
          pair[person]
        )}</select>`;
        return `<div class="slot">
          <span class="slabel">${slot.short}</span>
          <div class="grow" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            ${pick(0)}${pick(1)}
          </div>
          <button class="btn small ghost copy" data-act="copySlot" data-idx="${idx}" data-slot="${slot.key}"
            title="Give ${esc(people[1])} the same" aria-label="${slot.label} on ${name}: give ${esc(
          people[1]
        )} the same as ${esc(people[0])}">=</button>
        </div>`;
      }).join("");

      return `<div class="dayblock">
        <div class="row">
          <span class="dname grow">${name}${
        dated ? ` <span class="muted num" style="font-weight:400">${esc(dated)}</span>` : ""
      }</span>
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

  return `
    <section class="card">
      <div class="grid2" style="margin-bottom:8px">
        <label class="field"><span class="eyebrow">${esc(people[0])}</span>
          <input class="inp" value="${esc(people[0])}" placeholder="Person 1"
            data-act="setPerson" data-person="0"></label>
        <label class="field"><span class="eyebrow">${esc(people[1])}</span>
          <input class="inp" value="${esc(people[1])}" placeholder="Person 2"
            data-act="setPerson" data-person="1"></label>
      </div>
      <label class="field"><span class="eyebrow">The fortnight starts</span>
        <input class="inp mono" type="date" value="${esc(dayOf(start))}" data-act="setPlanStart"></label>
      <p class="muted" style="margin:7px 0 0">${
        start
          ? "Each day shows its date, so you can tell whether something will still be in date by then."
          : "Set a date and every day shows the date it falls on, which is what tells you whether a use-by will hold."
      }</p>
    </section>
    ${week(0)}${week(1)}
    <div class="card">
      <span class="eyebrow" style="display:block;margin-bottom:6px">Fill the fortnight</span>
      <div class="row" style="gap:6px">${fillers}</div>
      <p class="muted" style="margin:7px 0 0">Copies day one into every empty day of that slot, for
      both of you. The arrow beside a day copies ${esc(people[0])}'s choice to ${esc(people[1])}.</p>
    </div>
    <p class="muted">Day costs are portion costs, so they show what the meals are worth. The List tab rounds up to whole packs.</p>
    <button class="btn ghost wide" data-act="clearPlan">Clear both weeks</button>
    <div class="spacer"></div>`;
}

/* ---- food ---- */

/* Calories and macros live on their own page so the plan stays a plan. It is
   the same fortnight, the same two people and the same meals, read a second
   way: what the choices add up to rather than what they cost. */
function viewFood() {
  const c = state.calc;
  const people = state.db.people || ["Person 1", "Person 2"];
  const start = state.db.planStart || "";
  const days = state.db.plan.length;

  const macros = (n) =>
    `<span class="macro"><b>${Math.round(n.protein)}</b>P</span>
     <span class="macro"><b>${Math.round(n.carbs)}</b>C</span>
     <span class="macro"><b>${Math.round(n.fat)}</b>F</span>`;

  const person = (idx, who) => {
    const n = c.dayNutrition[idx][who];
    const meals = c.dayMeals[idx][who];
    const partial = !c.dayComplete[idx][who];
    return `<div class="foodrow">
      <span class="pname grow">${esc(people[who])}</span>
      ${
        meals
          ? `<span class="kcal num">${Math.round(n.kcal)}<span class="unit"> kcal</span>${
              partial ? '<span class="part" title="Some items have no nutrition filled in">*</span>' : ""
            }</span>
             <span class="macros">${macros(n)}</span>`
          : `<span class="muted">nothing planned</span>`
      }
    </div>`;
  };

  const week = (w) => {
    const idxs = Array.from({ length: 7 }, (_, i) => w * 7 + i).filter((i) => i < days);
    const rows = idxs
      .map((idx) => {
        const when = planDate(start, idx);
        const name = when ? WEEKDAYS[when.getDay()] : DAYS[idx % 7];
        const dated = when ? when.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
        const both = c.dayNutrition[idx][0].kcal + c.dayNutrition[idx][1].kcal;
        return `<div class="dayblock">
          <div class="row">
            <span class="dname grow">${name}${
          dated ? ` <span class="muted num" style="font-weight:400">${esc(dated)}</span>` : ""
        }</span>
            <span class="cost">${both > 0 ? `${Math.round(both)} kcal` : ""}</span>
          </div>
          ${person(idx, 0)}${person(idx, 1)}
        </div>`;
      })
      .join("");

    return `<section class="card">
      <div class="row" style="margin-bottom:6px"><span class="eyebrow grow">Week ${w + 1}</span></div>
      ${rows}</section>`;
  };

  /* An average over the days that actually have meals on them. Dividing by
     fourteen when only nine are planned would read as a crash diet. */
  const average = (who) => {
    const fed = Array.from({ length: days }, (_, i) => i).filter((i) => c.dayMeals[i][who] > 0);
    if (!fed.length) return null;
    const sum = fed.reduce((acc, i) => addNutrition(acc, c.dayNutrition[i][who]), emptyNutrition());
    return {
      days: fed.length,
      ...Object.fromEntries(NUTRIENTS.map((k) => [k, sum[k] / fed.length])),
    };
  };

  const averages = [0, 1]
    .map((who) => {
      const a = average(who);
      return `<div class="foodrow">
        <span class="pname grow">${esc(people[who])}</span>
        ${
          a
            ? `<span class="kcal num">${Math.round(a.kcal)}<span class="unit"> kcal</span></span>
               <span class="macros">${macros(a)}</span>`
            : `<span class="muted">no meals planned</span>`
        }
      </div>`;
    })
    .join("");

  const anyPartial = c.dayComplete.some((d) => !d[0] || !d[1]);
  const blank = state.db.ingredients.filter((i) => productsOf(i).some((p) => !hasNutrition(p))).length;

  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, w) => week(w)).join("");

  return `<section class="card">
      <div class="row" style="margin-bottom:6px">
        <span class="eyebrow grow">Average a day</span>
        <span class="muted">over the days with meals on them</span>
      </div>
      ${averages}
    </section>
    ${weeks}
    ${
      anyPartial
        ? `<p class="muted">A <span class="part">*</span> means at least one thing in that day has no
           nutrition filled in, so the real figure is higher. ${
             blank ? `${blank} item${blank === 1 ? " is" : "s are"} still blank.` : ""
           } Fill them in on the Items tab, or photograph the label.</p>`
        : `<p class="muted">Driven by the meals on the Plan tab. Change a meal there and these move with it.</p>`
    }
    <div class="spacer"></div>`;
}

/* ---- meals ---- */

function viewMeals() {
  const byId = Object.fromEntries(state.db.ingredients.map((i) => [i.id, i]));
  const open = state.sheet && state.sheet.kind === "meal" ? state.sheet.id : null;

  const stockOnly = state.settings.mealFilter === "stock";
  const makeable = Object.fromEntries(state.db.meals.map((m) => [m.id, mealStock(m, byId)]));
  const canCount = state.db.meals.filter((m) => makeable[m.id].canMake).length;

  /* Sorted by name, and the one being edited is never filtered away: having a
     meal vanish because you just used up its last ingredient would be a
     strange way to find out. */
  const shown = state.db.meals
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((m) => !stockOnly || makeable[m.id].canMake || m.id === open);

  const filter = `<div class="row" style="margin-bottom:10px">
    <span class="eyebrow grow">Show</span>
    <div class="seg">
      <button data-act="setMealFilter" data-filter="all" data-on="${stockOnly ? 0 : 1}">All ${
    state.db.meals.length
  }</button>
      <button data-act="setMealFilter" data-filter="stock" data-on="${stockOnly ? 1 : 0}">Can make ${canCount}</button>
    </div>
  </div>`;

  const cards = shown
    .map((meal) => {
      const cost = mealCost(meal, byId);
      if (meal.id !== open) {
        const can = makeable[meal.id];
        /* What is stopping you, named. "Not enough in" is a dead end; "short
           of mince" is something you can act on. */
        const note = can.canMake
          ? `<span class="ok-note">everything in</span>`
          : can.lines === 0
          ? "nothing in it yet"
          : `short of ${can.short
              .slice(0, 2)
              .map((x) => esc(x.name).toLowerCase())
              .join(" and ")}${can.short.length > 2 ? ` and ${can.short.length - 2} more` : ""}`;

        return `<section class="card"><div class="row" data-act="openMeal" data-id="${meal.id}">
          <div class="grow">
            <div style="font-weight:700">${esc(meal.name)}</div>
            <div class="muted">${meal.items.length} ingredient${
          meal.items.length === 1 ? "" : "s"
        } &middot; ${note}</div>
          </div>
          <span class="num" style="font-weight:700">£${money(cost)}</span>
          <button class="btn small ghost" data-act="openMeal" data-id="${meal.id}">Edit</button>
        </div></section>`;
      }

      const picker = (selected) =>
        state.db.ingredients
          .map((i) => `<option value="${i.id}"${i.id === selected ? " selected" : ""}>${esc(i.name)}</option>`)
          .join("");

      /* Which one, under that ingredient. Blank is the useful default: the
         meal wants cheddar, and whichever cheddar is cheapest will do. Naming
         one is for when the recipe really does mean that jar. */
      const which = (ing, selected) => {
        const options = productsOf(ing);
        const cheapest = chooseProduct(ing);
        return [
          `<option value=""${selected ? "" : " selected"}>Any${
            cheapest ? ` (now ${cheapest.name || cheapest.store || "cheapest"})` : ""
          }</option>`,
        ]
          .concat(
            options.map(
              (p) =>
                `<option value="${p.id}"${p.id === selected ? " selected" : ""}>${esc(
                  p.name || "Unnamed"
                )}${p.store ? ` at ${esc(p.store)}` : ""}</option>`
            )
          )
          .join("");
      };

      const rows = meal.items
        .map((it, i) => {
          const ing = byId[it.ingredientId];
          const named = it.productId && ing ? productById(ing, it.productId) : null;
          const grams = itemIsGrams(it);
          const product = ing ? itemProduct(ing, it) : null;
          const per = gramsPerPortion(product);
          const unit = (product && product.packUnit) === "ml" ? "ml" : "g";

          /* Written in grams, the line still has to become portions for the
             shopping list, and that needs a portion size on the product. Say
             so here rather than letting the line quietly count as nothing. */
          const sum = grams
            ? per > 0
              ? `${trim2(Number(it.grams) || 0)}${unit} is ${trim2(
                  itemPortions(ing, it)
                )} portions of ${trim2(per)}${unit}`
              : `Set a pack size and portion on ${esc(
                  (product && product.name) || (ing && ing.name) || "this"
                )} so the list can turn ${unit} into packs`
            : `${trim2(Number(it.portions) || 0)} portion${
                Math.abs((Number(it.portions) || 0) - 1) < 0.001 ? "" : "s"
              }${per > 0 ? ` of ${trim2(per)}${unit}` : ""}`;

          return `<div class="subcard">
        <div class="row" style="margin-bottom:6px">
          <select class="inp grow" data-act="setMealIng" data-id="${meal.id}" data-i="${i}">${picker(
            it.ingredientId
          )}</select>
          <button class="btn small danger" data-act="delMealIng" data-id="${meal.id}" data-i="${i}" aria-label="Remove">×</button>
        </div>
        <div class="row" style="margin-bottom:6px">
          <div class="seg" style="flex:0 0 auto">
            <button data-act="setMealBy" data-id="${meal.id}" data-i="${i}" data-by="portions"
              data-on="${grams ? 0 : 1}">Portions</button>
            <button data-act="setMealBy" data-id="${meal.id}" data-i="${i}" data-by="grams"
              data-on="${grams ? 1 : 0}">${unit}</button>
          </div>
          ${
            grams
              ? `<input class="inp mono grow" style="text-align:right" type="number" step="1" min="0"
                  value="${trim2(Number(it.grams) || 0)}" data-act="setMealGrams" data-id="${meal.id}"
                  data-i="${i}" aria-label="${unit} of ${esc((ing && ing.name) || "it")} in this meal">`
              : `<input class="inp mono grow" style="text-align:right" type="number" step="0.05" min="0"
                  value="${it.portions}" data-act="setMealPortions" data-id="${meal.id}"
                  data-i="${i}" aria-label="Portions each">`
          }
        </div>
        <select class="inp" data-act="setMealProduct" data-id="${meal.id}" data-i="${i}">${
            ing ? which(ing, it.productId) : ""
          }</select>
        <p class="why" style="margin:4px 0 0">${sum}. ${
            named
              ? `Only ${esc(named.name || "this one")} will do, so it goes on the list even with other ${esc(
                  ing.name
                )} in.`
              : `Any ${esc((ing && ing.name) || "of it")} in the house counts, and the list buys the cheapest.`
          }</p>
      </div>`;
        })
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
        <p class="muted" style="margin:0 0 8px">Portions are for one person. Plan it for both of
        you and it counts twice.</p>
        <div class="row" style="margin-top:8px"><span class="eyebrow grow">Cost per serving</span>
          <span class="num" style="font-weight:700">£${money(cost)}</span></div>
      </section>`;
    })
    .join("");

  const nothing =
    stockOnly && !shown.length
      ? `<div class="empty">Nothing can be made from what is in right now. The List tab knows what to buy.</div>`
      : "";

  /* Adding sits at the top, as it does on Items. It is the only thing you
     come to this screen to press that is not one of the meals themselves. */
  return `<button class="btn tonal wide" style="margin-bottom:10px" data-act="addMeal">Add a meal</button>
    ${filter}${nothing}${cards}<div class="spacer"></div>`;
}

/* ---- items ---- */

/* Shared by the Items tab and the scan sheet. Takes a plain
   { pricePerPack, offer } shape so it works before an item exists. */
function offerEditor(subject, acts) {
  const o = subject.offer || {};
  const kind = o.kind || "";
  const own = `${acts.id ? ` data-id="${acts.id}"` : ""}${
    acts.product ? ` data-product="${acts.product}"` : ""
  }`;
  const attrs = `data-act="${acts.kind}"${own}`;
  const field = (name) => `data-act="${acts.field}"${own} data-field="${name}"`;
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

  return `<div class="subcard">
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

/* Filing a product under a different ingredient. The ingredient is the
   category a meal asks for, so something recorded as its own kind of thing
   when it is really one of the milks gets corrected here rather than deleted
   and retyped. Hidden when there is nowhere to move it to. */
function moveControl(ing, product) {
  const others = state.db.ingredients.filter((i) => i.id !== ing.id);
  if (!others.length) return "";
  const last = productsOf(ing).length === 1;

  /* No font-size here on purpose: anything under 16px makes Safari zoom the
     page in the moment it is tapped. The label stays short for the same
     reason a select cannot be trusted with a long one, since the widest
     option decides how much room it demands from the row. */
  return `<select class="inp move" data-act="moveProduct" data-id="${ing.id}"
      data-product="${esc(product.id)}"
      title="${last ? `Moving this leaves ${esc(ing.name)} empty, so it goes too` : "File this one under a different ingredient"}"
      aria-label="File ${esc(product.name || "this")} under a different ingredient">
      <option value="" selected>Move to&hellip;</option>
      ${others
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => `<option value="${i.id}">${esc(i.name)}</option>`)
        .join("")}
    </select>`;
}

/* A section of the product editor that can be folded away.

   Which sections are open is remembered by kind rather than per product, so
   closing nutrition closes it everywhere. That is the point of the request:
   somebody who is not editing calories does not want to see them on any of
   forty items, and would not want to close them forty times either.

   A closed section still carries its summary, so the fold hides the controls
   without hiding the state. A section you cannot read at a glance is worse
   than one that is simply long. */
function fold(kind, title, summary, body) {
  const open = (state.settings.openSections || []).includes(kind);
  return `<section class="fold${open ? " open" : ""}">
    <button class="foldhead" data-act="toggleSection" data-kind="${kind}"
      aria-expanded="${open ? "true" : "false"}">
      <span class="chev">${open ? "\u25BE" : "\u25B8"}</span>
      <span class="foldtext">
        <span class="foldname">${title}</span>
        <span class="foldsum">${summary}</span>
      </span>
    </button>
    ${open ? `<div class="foldbody">${body}</div>` : ""}
  </section>`;
}

/* Nutrition as the label prints it: per 100. What a portion comes to is
   derived from the portion size and shown underneath, so redefining a portion
   visibly moves the calories rather than leaving a stale figure behind. */
function nutritionEditor(ing, product) {
  const per = gramsPerPortion(product);
  const unit = product.packUnit === "ml" ? "ml" : "g";
  const known = hasNutrition(product);
  const portion = productNutrition(product);

  const box = (key, label) =>
    `<label class="field"><span class="eyebrow">${label}</span>
      <input class="inp mono" type="number" step="0.1" min="0" value="${trim2(
        Number(product[`${key}100`]) || 0
      )}" data-act="setProductNumber" data-id="${ing.id}" data-product="${esc(
      product.id
    )}" data-field="${key}100" aria-label="${label} per 100${unit}"></label>`;

  /* The summary is what a closed section has to earn its place with: the
     calories a portion, which is the number anybody opening this wanted. */
  const summary = !known
    ? "not filled in"
    : per > 0
    ? `${Math.round(portion.kcal)} kcal a portion`
    : `${trim2(Number(product.kcal100) || 0)} kcal per 100${unit}, no portion weight`;

  return fold(
    "nutrition",
    `Nutrition`,
    summary,
    `<div class="row" style="margin-bottom:6px">
      <span class="eyebrow grow">Per 100${unit}, as the label prints it</span>
      <button class="btn small tonal" data-act="shootLabel" data-id="${ing.id}"
        data-product="${esc(product.id)}">Scan the label</button>
    </div>
    <div class="grid2" style="margin-bottom:6px">${box("kcal", "Calories")}${box(
    "protein",
    "Protein g"
  )}</div>
    <div class="grid2" style="margin-bottom:6px">${box("carbs", "Carbs g")}${box("fat", "Fat g")}</div>
    <p class="why" style="margin:0">${
      !known
        ? "Not filled in yet, so meals using this will not count towards the day."
        : per > 0
        ? `A ${trim2(per)}${unit} portion is <b>${Math.round(portion.kcal)} kcal</b>, ${trim2(
            portion.protein
          )}g protein, ${trim2(portion.carbs)}g carbs, ${trim2(portion.fat)}g fat.`
        : `Set a pack size and portion above and this becomes a figure per portion.`
    }${
    product.nutritionUpdated && known ? ` Read ${esc(ago(product.nutritionUpdated))}.` : ""
  }</p>`
  );
}

/* Pack size and what a portion of it is. These two decide the portion weight,
   which is what every calorie figure is scaled by and what turns a recipe
   written in grams into packs on the list. */
function portionEditor(ing, product) {
  const byWeight = product.portionBy === "weight";
  const unit = product.packUnit === "ml" ? "ml" : "g";
  const pack = Number(product.packAmount) || 0;
  const per = gramsPerPortion(product);
  const count = portionsPer(product);

  const attrs = (act, field) =>
    `data-act="${act}" data-id="${ing.id}" data-product="${esc(product.id)}"${
      field ? ` data-field="${field}"` : ""
    }`;

  const unitOption = (value, label) =>
    `<option value="${value}"${product.packUnit === value ? " selected" : ""}>${label}</option>`;

  /* Whichever side you are not editing is the derived one, so it is shown as
     a sentence rather than a box you could contradict. */
  const derived = byWeight
    ? pack > 0 && per > 0
      ? `That makes <b>${trim2(count)} portions</b> in a ${trim2(pack)}${unit} pack.`
      : `Add a pack size and the list can work out how many portions a pack holds.`
    : per > 0
    ? `That makes a portion <b>${trim2(per)}${unit}</b>.`
    : `Add a pack size and a portion gets a weight, which is what calories are worked out from.`;

  const summary = !product.packUnit
    ? `${trim2(count)} a pack, no weight`
    : byWeight
    ? `${trim2(Number(product.portionGrams) || 0)}${unit} each, ${trim2(count)} a pack`
    : `${trim2(count)} a pack${per > 0 ? `, ${trim2(Math.round(per))}${unit} each` : ""}`;

  return fold(
    "portion",
    "Pack and portion",
    summary,
    `<div class="grid2" style="margin-bottom:6px">
      <label class="field"><span class="eyebrow">Pack size</span>
        <input class="inp mono" type="number" step="1" min="0" value="${trim2(pack)}"
          ${attrs("setProductNumber", "packAmount")} aria-label="How much is in a pack"></label>
      <label class="field"><span class="eyebrow">Unit</span>
        <select class="inp" ${attrs("setPackUnit")} aria-label="Pack size unit">
          ${unitOption("g", "grams")}${unitOption("ml", "millilitres")}${unitOption("", "no weight")}
        </select></label>
    </div>
    <div class="row" style="margin-bottom:6px">
      <span class="eyebrow grow">A portion is</span>
      <div class="seg">
        <button ${attrs("setPortionBy")} data-by="count" data-on="${byWeight ? 0 : 1}">Count</button>
        <button ${attrs("setPortionBy")} data-by="weight" data-on="${byWeight ? 1 : 0}">Weight</button>
      </div>
    </div>
    ${
      byWeight
        ? `<label class="field" style="margin-bottom:6px"><span class="eyebrow">${unit} per portion</span>
            <input class="inp mono" type="number" step="1" min="0" value="${trim2(
              Number(product.portionGrams) || 0
            )}" ${attrs("setProductNumber", "portionGrams")} aria-label="How much one portion weighs"></label>`
        : `<label class="field" style="margin-bottom:6px"><span class="eyebrow">Portions per pack</span>
            <input class="inp mono" type="number" step="0.5" min="0" value="${trim2(
              Number(product.portionsPerPack) || 0
            )}" ${attrs("setProductNumber", "portionsPerPack")} aria-label="Portions per pack"></label>`
    }
    <p class="why" style="margin:0">${
      product.packUnit ? derived : "This pack has no weight, so calories cannot be worked out from a label."
    }</p>`
  );
}

/* One product: a thing you can actually put in a trolley. It has a name of its
   own, because "which cheddar is this" is a question the app has to be able to
   answer, and its own stock, because a meal may ask for this one specifically. */
function productCard(ing, product, chosen, stores) {
  const age = daysSince(product.priceUpdated);
  const stale = age > STALE_DAYS;
  const pinned = isPinned(ing, product);
  const pp = portionsPer(product);
  const only = productsOf(ing).length === 1;
  const stock = productStock(product);

  const codes = (product.barcodes || []).length
    ? (product.barcodes || [])
        .map(
          (b) => `<span class="pill on" style="margin:0 5px 5px 0">${esc(b)}
           <button class="btn small ghost" style="padding:0 0 0 5px;min-height:0" data-act="delBarcode"
             data-id="${ing.id}" data-product="${esc(product.id)}" data-code="${esc(b)}">&times;</button></span>`
        )
        .join("")
    : `<span class="muted">none yet</span>`;

  return `<div class="subcard">
    <div class="row" style="margin-bottom:8px">
      <span class="grow" style="font-weight:600">${esc(product.name || "Unnamed")}${
    product.store ? ` <span class="muted">at ${esc(product.store)}</span>` : ""
  }</span>
      ${
        chosen
          ? `<span class="pill on">${pinned ? "pinned" : "cheapest"}</span>`
          : `<span class="muted num">£${money(productPortionCost(product))} a portion</span>`
      }
      <button class="pill${pinned ? " on" : ""}" data-act="pinProduct" data-id="${ing.id}"
        data-product="${esc(product.id)}" title="Always buy this one">${pinned ? "Unpin" : "Pin"}</button>
    </div>
    <div class="grid2" style="margin-bottom:8px">
      <label class="field"><span class="eyebrow">What it is called</span>
        <input class="inp" value="${esc(product.name || "")}" placeholder="Cathedral City"
          data-act="setProductName" data-id="${ing.id}" data-product="${esc(product.id)}"></label>
      <label class="field"><span class="eyebrow">Shop</span>
        <input class="inp" list="fb-stores" value="${esc(product.store || "")}" placeholder="Not set"
          data-act="setProductStore" data-id="${ing.id}" data-product="${esc(product.id)}"></label>
    </div>
    <div class="grid2" style="margin-bottom:8px">
      <label class="field"><span class="eyebrow">Base price £ per pack</span>
        <input class="inp mono" type="number" step="0.01" min="0" value="${product.pricePerPack}"
          data-act="setProductPrice" data-id="${ing.id}" data-product="${esc(product.id)}"></label>
      <label class="field"><span class="eyebrow">In stock (portions)</span>
        <input class="inp mono" type="number" step="0.5" min="0" value="${trim2(stock)}"
          data-act="setProductNumber" data-id="${ing.id}" data-product="${esc(
    product.id
  )}" data-field="stockPortions"></label>
    </div>
    ${portionEditor(ing, product)}
    <div class="row" style="margin-bottom:8px">
      <span class="muted grow">${
        pp > 0
          ? `${trim2(stock / pp)} pack${Math.abs(stock / pp - 1) < 0.001 ? "" : "s"} of ${trim2(pp)}`
          : "Set how big a portion is and this counts packs too"
      }</span>
      <button class="btn small tonal" data-act="lessStockPack" data-id="${ing.id}"
        data-product="${esc(product.id)}" title="Take a pack out of stock">&minus; pack</button>
      <button class="btn small tonal" data-act="moreStockPack" data-id="${ing.id}"
        data-product="${esc(product.id)}" title="Put a pack into stock">+ pack</button>
    </div>
    ${fold(
      "offer",
      "Offer",
      offerLabel(product) || (offerExpired(product) ? "ended, full price" : "none"),
      offerEditor(product, {
        kind: "setProductOfferKind",
        field: "setProductOfferField",
        id: ing.id,
        product: product.id,
      })
    )}
    ${nutritionEditor(ing, product)}
    ${fold(
      "barcodes",
      "Barcodes",
      (product.barcodes || []).length
        ? `${product.barcodes.length} scanned`
        : "none yet",
      `<div style="margin-bottom:8px">${codes}</div>
      <button class="btn small tonal" data-act="addBarcode" data-id="${ing.id}"
        data-product="${esc(product.id)}">Scan a barcode</button>`
    )}
    <p class="muted${stale ? " stale" : ""}" style="margin:0 0 8px">${
    product.priceUpdated ? `priced ${esc(ago(product.priceUpdated))}` : "never priced"
  }${pp > 0 ? ` &middot; £${money(productPortionCost(product))} a portion` : " &middot; portions not set"}</p>
    <div class="prodacts">
      <button class="btn small tonal" data-act="copyProduct" data-id="${ing.id}" data-product="${esc(
    product.id
  )}" title="Same thing, another shop">Copy to a shop</button>
      ${moveControl(ing, product)}
      <button class="btn small ghost" data-act="delProduct" data-id="${ing.id}" data-product="${esc(
    product.id
  )}"${only ? " disabled" : ""} title="${
    only ? "An ingredient needs something to buy" : "Remove this one"
  }">Remove</button>
    </div>${
      only && state.db.ingredients.length > 1
        ? `<p class="why" style="margin:6px 0 0">The only one here, so moving it takes ${esc(
            ing.name
          )} with it.</p>`
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

  const byName = state.settings.itemSort === "name";

  /* Demand can arrive either way round: "any cheddar" sits under the
     ingredient, "that cheddar" under a product of it. Both are this
     ingredient's business. */
  const needOf = (ing) =>
    (c.need[ing.id] || 0) +
    Object.entries(c.needProduct || {}).reduce(
      (sum, [key, portions]) => (key.startsWith(`${ing.id}|`) ? sum + portions : sum),
      0
    );

  const card = (ing) => {
    const chosen = chooseProduct(ing);
    const all = productsOf(ing);
    const age = daysSince(chosen && chosen.priceUpdated);
    const stale = age > STALE_DAYS;
    const extra = Number(ing.extraPacks) || 0;
    const live = activeOffer(chosen);
    const stock = stockPortions(ing);
    const pp = portionsPer(chosen);

    const head = `<div class="row head" data-act="openItem" data-id="${ing.id}">
      <div class="grow">
        <div class="trunc" style="font-weight:600">${stale ? '<span class="dot"></span>' : ""}${esc(ing.name)}</div>
        <div class="muted num">${
          // with the shop headings gone, the line has to say where it comes from
          byName && chosen && chosen.store ? `${esc(chosen.store)} &middot; ` : ""
        }${
          pp > 0 ? `${trim2(pp)}/pack` : '<span class="stale">portions not set</span>'
        } &middot; £${money(portionCost(ing))} a portion &middot; ${trim2(stock)} in stock${
      all.length > 1 ? ` &middot; ${all.length} to choose from` : ""
    }${live ? ` &middot; ${esc(offerLabel(chosen))}` : ""}${
      extra ? ` &middot; ${extra} on the list` : ""
    }</div>
      </div>
      <div style="text-align:right">
        <div class="num" style="font-weight:700">£${money(chosen && chosen.pricePerPack)}</div>
        <div class="muted num${stale ? " stale" : ""}">${
      chosen && chosen.priceUpdated ? age + "d ago" : "never set"
    }</div>
      </div>
      <button class="btn small ghost" data-act="addToList" data-id="${ing.id}" title="Add a pack to the shopping list">+</button>
    </div>`;

    if (ing.id !== open) return `<section class="card" data-scroll="${ing.id}">${head}</section>`;

    return `<section class="card" data-scroll="${ing.id}">${head}
      <div style="border-top:1px solid var(--outline);margin-top:12px;padding-top:12px">
        <label class="field" style="margin-bottom:6px"><span class="eyebrow">Ingredient</span>
          <input class="inp" value="${esc(ing.name)}" data-act="setField" data-id="${ing.id}" data-field="name"></label>
        <p class="muted" style="margin:0 0 10px">What a meal asks for. The things below are what
        you can actually buy to satisfy it.</p>

        <div class="row" style="margin-bottom:10px">
          <span class="eyebrow grow">On the list by hand</span>
          <button class="btn small tonal" data-act="lessExtra" data-id="${ing.id}">&minus;</button>
          <span class="num" style="min-width:24px;text-align:center;font-weight:700">${extra}</span>
          <button class="btn small tonal" data-act="addToList" data-id="${ing.id}">+</button>
        </div>

        <div class="row" style="margin-bottom:6px">
          <span class="eyebrow grow">What to buy</span>
          <span class="muted">${trim2(stock)} in stock in total</span>
        </div>
        <p class="muted" style="margin:0 0 8px">Whichever is cheapest a portion is what the list
        uses, unless you pin one. A meal can also ask for one of these by name.</p>
        ${all.map((product) => productCard(ing, product, product === chosen, stores)).join("")}
        <button class="btn small tonal wide" style="margin-bottom:10px" data-act="addProduct"
          data-id="${ing.id}">Add another one</button>

        <div style="margin-bottom:10px">
          <span class="eyebrow" style="display:block;margin-bottom:4px">Last updated</span>
          <span class="muted num">${
            ing.updatedAt
              ? `${esc(stampText(ing.updatedAt))} &middot; ${esc(ago(ing.updatedAt))}`
              : "not since this ingredient was made"
          }</span>
        </div>
        <div class="row">
          <span class="muted grow">Needs ${trim2(needOf(ing))} portions this fortnight</span>
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

  const flat = matches
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(card)
    .join("");

  const sortToggle = `<div class="row" style="margin-bottom:10px">
    <span class="eyebrow grow">Sort</span>
    <div class="seg">
      <button data-act="setItemSort" data-sort="store" data-on="${byName ? 0 : 1}">By shop</button>
      <button data-act="setItemSort" data-sort="name" data-on="${byName ? 1 : 0}">A to Z</button>
    </div>
  </div>`;

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

  /* Adding sits at the top. With 40-odd items the button was a scroll away
     from the only screen you would press it on. */
  return `${search}
    ${q ? `<p class="muted" style="margin:-4px 0 10px">${matches.length} of ${state.db.ingredients.length} items</p>` : ""}
    <button class="btn tonal wide" style="margin-bottom:10px" data-act="addItem">Add an item</button>
    ${sortToggle}
    ${nothing}${byName ? flat : groups}
    <datalist id="fb-stores">${stores.map((st) => `<option value="${esc(st)}"></option>`).join("")}</datalist>
    <div class="spacer"></div>`;
}

/* -------------------------------- sheets ------------------------------- */

function viewSheet() {
  const s = state.sheet;
  if (!s) return "";
  if (s.kind === "receipt") return sheetReceipt(s);
  if (s.kind === "label") return sheetLabel(s);
  if (s.kind === "settings") return sheetSettings(s);
  if (s.kind === "scanned") return sheetScanned(s);
  if (s.kind === "help") return sheetHelp();
  if (s.kind === "invite") return sheetInvite(s);
  if (s.kind === "join") return sheetJoin(s);
  return "";
}

/* Sheets do not close when you tap beside them. Every one of these holds
   something half finished, and a receipt is twenty lines of review that a
   misjudged tap on the edge used to throw away without asking. Close is
   always in the corner. Pass dismissable for a sheet that is only reading
   material, where there is nothing to lose. */
function shell(title, blurb, inner, dismissable = false) {
  return `<div class="scrim"${
    dismissable ? ' data-dismiss="1"' : ""
  }><div class="sheet" data-stop="1">
    <button class="btn small ghost close" data-act="closeSheet">Close</button>
    <h2>${title}</h2>
    <p class="muted" style="margin-top:0">${blurb}</p>
    ${inner}</div></div>`;
}

/* The stock control on a receipt line. Counted in portions like everywhere
   else, stepped by whole packs because that is how a receipt counts, and
   pre-filled from the quantity the model read off the paper. */
function receiptStockRow(r, i, store) {
  const add = rowStock(r, store);
  const perPack = rowPackPortions(r, store);
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

    /* Which one of that kind, at this shop. Blank is not offered: a receipt
       line is always a specific thing you actually bought. */
    const which = (r) => {
      const ing = ingredient(r.targetId);
      if (!ing) return "";
      return [
        `<option value="__new__"${r.productId === "__new__" ? " selected" : ""}>Something new</option>`,
      ]
        .concat(
          productsOf(ing).map(
            (p) =>
              `<option value="${p.id}"${p.id === r.productId ? " selected" : ""}>${esc(
                p.name || "Unnamed"
              )}${p.store ? ` at ${esc(p.store)}` : ""}</option>`
          )
        )
        .join("");
    };

    const picker = (sel) =>
      [`<option value=""${sel ? "" : " selected"}>Ignore this line</option>`,
       `<option value="__new__"${sel === "__new__" ? " selected" : ""}>+ Add as a new item</option>`]
        .concat(
          state.db.ingredients.map(
            (i) => `<option value="${i.id}"${i.id === sel ? " selected" : ""}>${esc(i.name)} (now £${money(
              (chooseProduct(i) || {}).pricePerPack
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
          r.targetId && r.targetId !== "__new__"
            ? `<select class="inp" style="margin-top:5px" data-act="setRowProduct" data-i="${i}">${which(
                r
              )}</select>`
            : ""
        }
        ${
          r.targetId === "__new__" || r.productId === "__new__"
            ? `<div class="grid2" style="margin-top:5px">
                 <label class="field"><span class="eyebrow">${
                   r.targetId === "__new__" ? "Ingredient" : "What it is called"
                 }</span>
                   <input class="inp" value="${esc(
                     r.targetId === "__new__" ? r.newName : r.newProductName
                   )}" data-act="${
                r.targetId === "__new__" ? "setRowName" : "setRowProductName"
              }" data-i="${i}"></label>
                 <label class="field"><span class="eyebrow">Portions per pack</span>
                   <input class="inp mono" type="number" step="0.5" min="0.5" value="${r.newPortions}"
                     data-act="setRowPortions" data-i="${i}"></label>
               </div>
               <p class="why" style="margin:3px 0 0">${
                 r.targetId === "__new__"
                   ? "The ingredient is what a meal asks for, so keep it general: Cheddar, not Tesco Finest Mature 320g."
                   : "A new kind of this, alongside the ones you already buy."
               }</p>`
            : ""
        }
        <div class="row" style="margin-top:5px">
          <span class="why grow">${
              r.outdated
                ? `<strong class="stale">old price</strong> &middot; ${esc(
                    (productById(ingredient(r.targetId), r.productId) || {}).name || "this one"
                  )} was priced after ${esc(dayOf(s.date))}`
                : r.barcode
                ? "barcode " + esc(r.barcode)
                : esc(r.why)
            }${r.qty > 1 ? ` &middot; ${r.qty} bought` : ""}</span>
          <button class="btn small ghost" data-act="scanRow" data-i="${i}">${
              r.barcode ? "Rescan" : "Scan barcode"
            }</button>
        </div>
        ${r.targetId ? receiptStockRow(r, i, s.store) : ""}
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
    const stocking = live.filter((r) => rowStock(r, s.store) > 0).length;
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
  /* A barcode on more than one shop's entry. Which shop you are in is the
     only thing the scan cannot tell, so it is the only thing asked, and
     nothing else is shown until it is answered. */
  if (s.matches && s.matches.length > 1 && !s.chose) {
    const rows = s.matches
      .map((m) => {
        const ing = ingredient(m.ingId);
        const product = ing ? productById(ing, m.productId) : null;
        if (!product) return "";
        const age = product.priceUpdated ? ago(product.priceUpdated) : "never priced";
        return `<button class="pickrow subcard"
          data-act="pickScanMatch" data-id="${esc(m.ingId)}" data-product="${esc(m.productId)}">
          <span class="shop">${esc(product.store || "No shop set")}</span>
          <span class="detail">${esc(product.name || (ing && ing.name) || "")} &middot; £${money(
          product.pricePerPack
        )} &middot; priced ${esc(age)}</span>
        </button>`;
      })
      .join("");

    return shell(
      "Which shop are you in?",
      `That barcode is on ${s.matches.length} entries. They are the same thing in different shops,
       so pick where you are and the price you type lands on that one.`,
      `${rows}<p class="why">Scanned ${esc(s.code)}.</p>`
    );
  }

  const known = s.targetId ? ingredient(s.targetId) : null;
  const stores = storeNames(state.db.ingredients);
  const base = Number(s.price) || 0;
  const bought = Number(s.bought) || 0;

  /* Two steps, because a barcode identifies a product and a meal asks for an
     ingredient. First what kind of thing this is, then which one of them. */
  const here = known && s.productId ? productById(known, s.productId) : null;
  const making = !known || s.productId === "__new__";

  const kinds = [`<option value=""${s.targetId ? "" : " selected"}>A new ingredient</option>`]
    .concat(
      state.db.ingredients.map(
        (i) => `<option value="${i.id}"${i.id === s.targetId ? " selected" : ""}>${esc(i.name)}</option>`
      )
    )
    .join("");

  const whichOnes = known
    ? [`<option value="__new__"${s.productId === "__new__" ? " selected" : ""}>Something new</option>`]
        .concat(
          productsOf(known).map(
            (p) =>
              `<option value="${p.id}"${p.id === s.productId ? " selected" : ""}>${esc(
                p.name || "Unnamed"
              )}${p.store ? ` at ${esc(p.store)}` : ""} &middot; £${money(p.pricePerPack)}</option>`
          )
        )
        .join("")
    : "";

  const was = here ? Number(here.pricePerPack) || 0 : 0;
  const delta =
    here && base > 0 && was > 0 && Math.abs(base - was) > 0.004
      ? `<p class="muted" style="margin:-2px 0 8px">Was £${money(was)}, so that is ${
          base > was ? "up" : "down"
        } £${money(Math.abs(base - was))}.</p>`
      : known && making
      ? `<p class="muted" style="margin:-2px 0 8px">A new kind of ${esc(
          known.name
        )}. What you already have priced is left alone.</p>`
      : "";

  // what the packs in the trolley actually cost, deal included
  const spend = bought > 0 ? packCost({ pricePerPack: base, offer: s.offer }, bought) : 0;
  const full = bought * base;
  // the trolley is counted in packs, stock is kept in portions
  const stockNow = here ? productStock(here) : 0;
  const perPack = here ? packPortions(here) : Math.max(0.5, Number(s.portions) || 1);
  const adding = bought * perPack;

  return shell(
    here ? esc(here.name || known.name) : known ? `New ${esc(known.name)}` : "New barcode",
    known
      ? "Say which one this is, then update its price and add what you put in the trolley."
      : "This barcode is new. Fill it in and it is saved when you tap the button.",
    `
    ${s.err ? `<div class="err">${esc(s.err)}</div>` : ""}
    <label class="field" style="margin-bottom:8px"><span class="eyebrow">Barcode</span>
      <input class="inp mono" value="${esc(s.code)}" data-act="setScanCode"></label>

    <label class="field" style="margin-bottom:8px"><span class="eyebrow">This is a kind of</span>
      <select class="inp" data-act="setScanTarget">${kinds}</select></label>

    ${
      known
        ? `<label class="field" style="margin-bottom:8px"><span class="eyebrow">Which one</span>
             <select class="inp" data-act="setScanProduct">${whichOnes}</select></label>`
        : `<label class="field" style="margin-bottom:8px"><span class="eyebrow">Call the ingredient</span>
             <input class="inp" value="${esc(s.name)}" placeholder="Cheddar" data-act="setScanName"></label>`
    }

    ${
      making
        ? `<div class="grid2" style="margin-bottom:8px">
             <label class="field"><span class="eyebrow">${
               known ? "What it is called" : "What this one is called"
             }</span>
               <input class="inp" value="${esc(s.productName)}" placeholder="Cathedral City"
                 data-act="setScanProductName"></label>
             <label class="field"><span class="eyebrow">Portions per pack</span>
               <input class="inp mono" type="number" step="0.5" min="0.5" value="${s.portions}"
                 data-act="setScanPortions"></label>
           </div>`
        : `<label class="field" style="margin-bottom:8px"><span class="eyebrow">Portions per pack</span>
             <input class="inp mono" type="number" step="0.5" min="0.5" value="${trim2(perPack)}"
               data-act="setScanPortions"></label>`
    }

    <label class="field" style="margin-bottom:8px"><span class="eyebrow">Shop you are in</span>
      <input class="inp" list="fb-scan-stores" value="${esc(s.store)}" placeholder="Leave blank to sort later"
        data-act="setScanStore">
      <datalist id="fb-scan-stores">${stores
        .map((st) => `<option value="${esc(st)}"></option>`)
        .join("")}</datalist></label>

    <label class="field" style="margin-bottom:8px"><span class="eyebrow">Shelf price £ per pack</span>
      <input class="inp mono" type="number" step="0.01" min="0" inputmode="decimal"
        value="${s.price}" placeholder="0.00" data-act="setScanPrice"></label>
    ${delta}

    ${offerEditor({ pricePerPack: base, offer: s.offer }, { kind: "setScanOfferKind", field: "setScanOfferField" })}

    <div class="subcard">
      <div class="row">
        <div class="grow">
          <span class="eyebrow" style="display:block">In the trolley</span>
          <span class="muted">${
            here
              ? `${trim2(stockNow)} portion${Math.abs(stockNow - 1) < 0.001 ? "" : "s"} of it in stock`
              : "Nothing of this one in stock yet"
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
            )} portions, so its stock goes to ${trim2(stockNow + adding)} on save.</p>`
          : `<p class="muted" style="margin:7px 0 0">Packs in the trolley. Leave at 0 to record the price only.</p>`
      }
    </div>

    <button class="btn solid wide" data-act="saveScan">${
      bought > 0 ? `Save and add ${trim2(adding)} portions to stock` : "Save price"
    }</button>
    <p class="muted">Saving binds this barcode to that one thing, so next time the scan comes
    straight here. A meal asking for ${esc(
      (known && known.name) || "the ingredient"
    )} in general can be satisfied by any of them.</p>`
  );
}

/* The backup is read by people as often as it is pasted back, and a flat
   array in the order things happened to be created is hard to check against a
   shopping trip. Ordered the same way the Items tab groups them: by the shop
   the list would send you to, alphabetical within each, unassigned first so
   anything unfiled is obvious. Restoring is unaffected, since nothing anywhere
   depends on the order of this array. */
function backupJson(db) {
  const ordered = groupByStore(db.ingredients).flatMap((g) => g.items);
  const seen = new Set(ordered.map((i) => i.id));
  return JSON.stringify(
    // anything grouping somehow missed is kept rather than quietly dropped
    { ...db, ingredients: [...ordered, ...db.ingredients.filter((i) => !seen.has(i.id))] },
    null,
    2
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
    <textarea class="inp mono" data-act="setBackup" spellcheck="false">${esc(backupJson(state.db))}</textarea>
    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn tonal grow" data-act="copyBackup">Copy</button>
      <button class="btn tonal grow" data-act="restoreBackup">Restore</button>
      <button class="btn danger" data-act="resetAll">Reset</button>
    </div>
    <p class="muted">Keys and tokens stay on this device and are never written into the shared database.</p>`
    : "";

  const version = `
    <h3>This copy of the app</h3>
    <div class="row" style="gap:8px">
      <span class="muted grow num">${
        build.version ? esc(build.version) : "asking the offline copy\u2026"
      }</span>
      <button class="btn tonal" data-act="checkUpdate"${s.checking ? " disabled" : ""}>${
    s.checking ? "Checking\u2026" : "Check for an update"
  }</button>
    </div>
    <p class="muted">The app fetches itself fresh whenever there is signal, so this should look
    after itself. The button is for when you want to be sure.</p>`;

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
    ${repoBox}
    ${version}`
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
       <button class="btn tonal wide" data-act="openSettings">Back to settings</button>`,
      true
    );
  }

  return shell(
    "Invite someone",
    "One code is all they need. No GitHub account, no token, no waiting for an invite to be accepted.",
    `
    ${s.msg ? `<div class="ok">${esc(s.msg)}</div>` : ""}
    <div class="subcard">
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
    <button class="btn tonal wide" style="margin-top:10px" data-act="openSettings">Back to settings</button>`,
    true
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
function scanState(code, hit, keep = {}) {
  /* Which product is being edited, in order of how much it is worth trusting:
     the barcode, since it names one exact thing; then one already chosen; then
     the one this ingredient is normally bought as. */
  const byCode = hit && code ? findProductByBarcode(hit, code) : null;
  const asked = hit && keep.productId ? productById(hit, keep.productId) : null;
  /* A product you named beats one the barcode found. Both shops' entries carry
     the same barcode, so the lookup cannot tell them apart and would keep
     snapping back to whichever is listed first. */
  const here = asked || byCode || (hit ? chooseProduct(hit) : null);

  /* The same tin has the same barcode everywhere, so once it is recorded at
     two shops a scan cannot say which one you are standing in. Ask, rather
     than taking the first and writing tonight's price onto the wrong shop. */
  const matches = findAllByBarcode(state.db.ingredients, code);
  const ambiguous = matches.length > 1 && !keep.chose;

  if (ambiguous) {
    return {
      kind: "scanned",
      code: code || "",
      matches: matches.map((m) => ({ ingId: m.ing.id, productId: m.product.id })),
      // nothing is chosen yet, and nothing is editable until it is
      targetId: "",
      productId: "",
      name: "",
      productName: "",
      portions: 1,
      store: "",
      price: "",
      offer: null,
      bought: 0,
      err: "",
    };
  }

  return {
    kind: "scanned",
    code: code || "",
    matches: matches.map((m) => ({ ingId: m.ing.id, productId: m.product.id })),
    chose: true,
    targetId: hit ? hit.id : "",
    productId: here ? here.id : hit ? "__new__" : "",
    // the ingredient's name, when this is a whole new kind of thing
    name: keep.name || "",
    // the product's own name, which is what a shelf label actually says
    productName: keep.productName || "",
    portions: here ? packPortions(here) : keep.portions || 1,
    store: here ? here.store : keep.store || "",
    price: here ? String(here.pricePerPack || "") : "",
    offer: here && here.offer ? { ...here.offer } : null,
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

function receiptRow(line, store) {
  const res = resolveLine(line, state.db.ingredients);
  // No match means something you have not recorded yet, and adding it is
  // nearly always what you want. Ignoring it silently loses the shop.
  const unmatched = !res.id;
  const ing = res.id ? ingredient(res.id) : null;
  /* The shop is known, so the product usually is too: the barcode said so, or
     its printed name matches one you already buy there, or that shop only
     sells you one of these. Otherwise it is something new under that kind. */
  const product =
    res.productId || (ing ? (resolveProduct(ing, store, line.name) || {}).id || "__new__" : "");

  return {
    raw: line.name,
    price: Number(line.unitPrice) || 0,
    qty: Number(line.qty) || 1,
    targetId: unmatched ? "__new__" : res.id,
    productId: unmatched ? "" : product,
    why: unmatched ? "nothing matched, so it will be added" : res.why,
    confident: res.confident,
    use: true,
    outdated: false,
    barcode: "",
    offerKind: line.offerKind || "none",
    offerQty: Number(line.offerQty) || 3,
    offerTotal: Number(line.offerTotal) || 0,
    newName: titleise(tidyProductName(line.name)),
    newProductName: titleise(tidyProductName(line.name)),
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
function refreshRows(rows, date, store) {
  return rows.map((r) => {
    const ing = r.targetId && r.targetId !== "__new__" ? ingredient(r.targetId) : null;
    // Compared against the price this line would actually overwrite. A
    // three-week-old Asda receipt has nothing to say about the Tesco cheddar
    // and must not be blocked by it, but it must not walk back the Asda one.
    const product = ing && r.productId && r.productId !== "__new__"
      ? productById(ing, r.productId)
      : null;
    const outdated = !!(product && isEarlierDay(date, product.priceUpdated));
    if (outdated === r.outdated) return r;
    // Only lines whose standing actually changed are touched, so a line
    // switched off by hand stays off. Correcting the date, though, removes the
    // reason this line was switched off, so it comes back on with it.
    return { ...r, outdated, use: outdated ? false : !!r.targetId };
  });
}

/* One pack's worth of portions for whatever a receipt line points at, at the
   shop the receipt came from, since that is the pack being bought. */
function rowPackPortions(r, store) {
  if (r.targetId === "__new__" || r.productId === "__new__") {
    return Math.max(0.5, Number(r.newPortions) || 1);
  }
  const ing = r.targetId ? ingredient(r.targetId) : null;
  if (!ing) return 1;
  return packPortions(productById(ing, r.productId) || chooseProduct(ing));
}

/* Portions this line puts into stock. The receipt's quantity times the pack
   size is right most of the time, but a receipt cannot tell two flavours of
   the same thing apart, so an edit always wins. */
function rowStock(r, store) {
  if (r.stockTouched) return Math.max(0, Number(r.stockAdd) || 0);
  return Math.max(0, (Number(r.qty) || 1) * rowPackPortions(r, store));
}

/* Step a line's stock by one pack, since a receipt counts in packs even
   though the number in the box is portions. */
function bumpRowStock(i, dir) {
  const rows = state.sheet.rows.slice();
  const r = rows[i];
  if (!r) return;
  const store = state.sheet.store;
  const next = Math.max(0, rowStock(r, store) + dir * rowPackPortions(r, store));
  rows[i] = { ...r, stockAdd: Math.round(next * 100) / 100, stockTouched: true };
  setSheet({ ...state.sheet, rows });
}

/* ---------------------------- nutrition labels ------------------------- */

/* What a worked-out sizing changes on the product. Kept in one place so the
   figure previewed in the sheet is the one that gets saved. */
function sizingChanges(sizing) {
  if (!sizing) return {};
  const out = { packAmount: sizing.packAmount, packUnit: sizing.packUnit };
  if (sizing.portionGrams > 0) {
    out.portionBy = "weight";
    out.portionGrams = sizing.portionGrams;
  }
  if (sizing.portionsPerPack > 0) out.portionsPerPack = sizing.portionsPerPack;
  return out;
}

async function shootLabel(id, productId) {
  const ing = ingredient(id);
  const product = productOf(id, productId);
  if (!ing || !product) return;

  setSheet({ kind: "label", id, productId, busy: true, err: "" });
  filePicker(async (file) => {
    try {
      const out = await readNutrition(state.settings, file);
      const read = labelToPer100(out);
      setSheet({
        kind: "label",
        id,
        productId,
        busy: false,
        err: read ? "" : "No nutrition panel came back. Try filling the frame with the table itself.",
        out,
        values: read ? read.values : null,
        why: read ? read.why : "",
        warn: !!(read && read.warn),
        /* The photograph usually shows enough to size a portion as well, and
           without one these figures cannot reach a plate. Offer it rather
           than making them go and work it out, but never apply it silently. */
        // the product is passed in so a pack size you already recorded wins
        // over the one the label happens to be printed for
        sizing: labelSizing(out, product),
      });
    } catch (err) {
      setSheet({ kind: "label", id, productId, busy: false, err: err.message });
    }
  });
}

function sheetLabel(s) {
  const ing = ingredient(s.id);
  const product = productOf(s.id, s.productId);
  if (!ing || !product) return "";

  const inner = [];
  if (s.err) inner.push(`<div class="err">${esc(s.err)}</div>`);
  if (s.busy) inner.push(`<p class="muted">Reading the label\u2026</p>`);

  if (s.values) {
    const out = s.out || {};
    const unit = out.packUnit === "ml" || product.packUnit === "ml" ? "ml" : "g";
    const row = (label, value, suffix) =>
      `<div class="row" style="margin-bottom:4px"><span class="grow">${label}</span>
        <span class="num" style="font-weight:600">${trim2(value)}${suffix}</span></div>`;

    inner.push(`<div class="subcard">
      <span class="eyebrow" style="display:block;margin-bottom:6px">Per 100${unit}</span>
      ${row("Calories", s.values.kcal, " kcal")}
      ${row("Protein", s.values.protein, " g")}
      ${row("Carbs", s.values.carbs, " g")}
      ${row("Fat", s.values.fat, " g")}
      <p class="why" style="margin:6px 0 0">From ${esc(s.why)}.</p>
    </div>`);

    if (s.warn) {
      inner.push(`<p class="muted">Check these before saving. The label gave a serving column with no
        weight against it, so there is nothing to convert it to per 100${unit} with.</p>`);
    }

    /* What it will come to on a plate, worked out now, so a wrong portion size
       is obvious here rather than three screens away on the Food tab. */
    const sizing = s.sizing;
    const use = sizing && s.useSize !== false;
    const after = use ? { ...product, ...sizingChanges(sizing) } : product;
    const grams = gramsPerPortion(after);

    if (grams > 0) {
      const kcal = ((s.values.kcal || 0) * grams) / 100;
      inner.push(`<p class="muted">A ${trim2(Math.round(grams))}${unit} portion works out at
        <strong>${Math.round(kcal)} kcal</strong>${
        portionsPer(after) > 0 ? `, and a pack holds ${trim2(portionsPer(after))}` : ""
      }.</p>`);
    } else {
      inner.push(`<p class="muted">This product has no portion weight yet, so these will not count
        towards a day until you set a pack size and a portion on it.</p>`);
    }

    if (sizing) {
      const changes = sizingChanges(sizing);
      const same = Object.entries(changes).every(([k, v]) =>
        typeof v === "number" ? Math.abs((Number(product[k]) || 0) - v) < 0.01 : product[k] === v
      );
      if (!same) {
        inner.push(`<label class="row" style="margin-bottom:6px">
          <input type="checkbox" data-act="toggleLabelSize"${s.useSize === false ? "" : " checked"}>
          <span class="grow">Also set the pack size to ${trim2(sizing.packAmount)}${esc(
          sizing.packUnit
        )}${
          sizing.portionGrams
            ? `, with a ${trim2(sizing.portionGrams)}${esc(sizing.packUnit)} portion`
            : ""
        }, from ${esc(sizing.why)}</span></label>`);
        /* The raw against cooked gap gets its own sentence. It is the one
           thing here that looks like an error until it is explained. */
        if (sizing.note) inner.push(`<p class="why" style="margin:0 0 8px">${esc(sizing.note)}</p>`);
      }
    }

    inner.push(`<div class="row">
      <button class="btn solid grow" data-act="applyLabel">Save to ${esc(
        product.name || ing.name
      )}</button>
      <button class="btn tonal" data-act="shootLabel" data-id="${s.id}" data-product="${esc(
      s.productId
    )}">Retake</button>
    </div>`);
  } else if (!s.busy) {
    inner.push(`<button class="btn solid wide" data-act="shootLabel" data-id="${s.id}"
      data-product="${esc(s.productId)}">Take a photo</button>`);
  }

  return shell(
    "Nutrition label",
    `Point the camera at the panel on ${esc(product.name || ing.name)}${
      product.store ? ` from ${esc(product.store)}` : ""
    }. Figures are stored exactly as the label prints them, per 100g or 100ml.`,
    inner.join("")
  );
}

async function shootReceipt() {
  filePicker(async (file) => {
    setSheet({ ...state.sheet, busy: true, err: "" });
    try {
      const out = await readReceipt(state.settings, file);
      // an unreadable date falls back to today, which flags nothing as old
      const date = out.date || today();
      const store = canonicalStore(out.store, storeNames(state.db.ingredients));
      setSheet({
        kind: "receipt",
        busy: false,
        err: out.lines.length ? "" : "No product lines came back. Try a flatter photo with the whole receipt in frame.",
        store,
        date,
        dateRead: !!out.date,
        rows: refreshRows(out.lines.map((line) => receiptRow(line, store)), date, store),
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
  let addedProducts = 0;

  commit((db) => {
    for (const r of rows) {
      const alias = norm(r.raw);
      let target = r.targetId;

      if (target === "__new__") {
        // The receipt genuinely tells us the shop, so that one is not a guess.
        const made = newIngredient(s.store, (r.newName || "").trim() || titleise(r.raw));
        made.updatedAt = stamp;
        made.products = [
          newProduct((r.newProductName || "").trim() || made.name, s.store, {
            portionsPerPack: Math.max(0.5, Number(r.newPortions) || 1),
          }),
        ];
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

      /* The price belongs to one product of that ingredient, not to the
         ingredient itself. Buying a different cheddar therefore adds a cheddar
         to the cheddar you already have, instead of a second Cheddar that no
         meal knows about and whose stock never counts. */
      const wantNew = r.targetId === "__new__" || r.productId === "__new__";
      const existing = wantNew ? null : (ing.products || []).find((x) => x.id === r.productId);
      const product = existing
        ? { ...existing }
        : newProduct((r.newProductName || "").trim() || tidyProductName(r.raw) || ing.name, s.store, {
            // something new starts from the pack size of one already priced
            portionsPerPack: Math.max(0.5, Number(r.newPortions) || packPortions(chooseProduct(ing))),
          });
      // a brand new ingredient always brings a product, and the count above
      // already says so, so only count one added under something you had
      if (!existing && r.targetId !== "__new__") addedProducts += 1;

      // An offer price must not overwrite the base price, or the base price
      // drifts down every time a promotion runs and never comes back up.
      // The kind matters: a card price applies to a single pack, a multibuy
      // does not, so storing a multibuy as a card price understates singles.
      if (r.offerKind === "loyalty") {
        product.offer = { kind: "loyalty", price: r.price, ends: "" };
        if (!product.pricePerPack) product.pricePerPack = r.price;
      } else if (r.offerKind === "multibuy" && r.offerQty > 1 && r.offerTotal > 0) {
        product.offer = { kind: "multibuy", qty: r.offerQty, price: r.offerTotal, ends: "" };
        // With no base price on record the deal rate is the only number we
        // have. It shows in the editor so it can be corrected.
        if (!product.pricePerPack) product.pricePerPack = r.offerTotal / r.offerQty;
      } else {
        product.pricePerPack = r.price;
      }
      product.priceUpdated = stamp;
      if (r.barcode) product.barcodes = [...new Set([...(product.barcodes || []), r.barcode])];

      // Stock is in portions and sits on the product, because a meal is
      // allowed to ask for this one specifically. The line was pre-filled from
      // the receipt's quantity and may have been corrected.
      const add = rowStock(r, s.store);
      if (add > 0) {
        product.stockPortions = (Number(product.stockPortions) || 0) + add;
        // buying it settles whatever was on the list by hand
        ing.extraPacks = 0;
        stocked += add;
        stockedItems += 1;
      }
      ing.products = [...(ing.products || []).filter((x) => x.id !== product.id), product];
      ing.updatedAt = stamp;
      // the wording is remembered against the ingredient, since that is what
      // the next receipt has to find first
      ing.aliases = [...new Set([...(ing.aliases || []), alias])];
      db.ingredients[idx] = ing;
    }
  });

  state.sheet = null;
  flash(
    "ok",
    `${updated} price${updated === 1 ? "" : "s"} updated${
      created ? `, ${created} new item${created === 1 ? "" : "s"} added` : ""
    }${
      addedProducts
        ? `, ${addedProducts} new thing${addedProducts === 1 ? "" : "s"} to buy under ingredients you already had`
        : ""
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
      const found = findByBarcode(state.db.ingredients, code);
      setSheet(scanState(code, found && found.ing));
    }),

  setScanCode: (el) => {
    const code = el.value.trim();
    const found = findByBarcode(state.db.ingredients, code);
    if (found && found.ing.id !== state.sheet.targetId) {
      setSheet({ ...scanState(code, found.ing), bought: state.sheet.bought });
      return;
    }
    setSheet({ ...state.sheet, code });
  },
  pickScanMatch: (el) => {
    const hit = ingredient(el.dataset.id);
    if (!hit) return;
    setSheet({
      ...scanState(state.sheet.code, hit, { chose: true, productId: el.dataset.product }),
      bought: state.sheet.bought,
    });
  },

  setScanTarget: (el) => {
    const hit = el.value ? ingredient(el.value) : null;
    // pull that shop's price and offer in, so you edit what it really has
    setSheet({
      ...scanState(state.sheet.code, hit, { chose: true, store: state.sheet.store }),
      bought: state.sheet.bought,
    });
  },
  setScanProduct: (el) => {
    const hit = state.sheet.targetId ? ingredient(state.sheet.targetId) : null;
    if (el.value === "__new__") {
      /* Another kind of the same thing. Keep what has been typed and drop the
         price, since the price on screen belongs to a different product. */
      setSheet({ ...state.sheet, productId: "__new__", price: "", offer: null });
      return;
    }
    // an existing one: load its shop, price and pack size, so you edit what it has
    setSheet({
      ...scanState(state.sheet.code, hit, { productId: el.value }),
      name: state.sheet.name,
      bought: state.sheet.bought,
    });
  },
  setScanProductName: (el) => setSheet({ ...state.sheet, productName: el.value }),
  setScanName: (el) => setSheet({ ...state.sheet, name: el.value }),
  setScanPortions: (el) => setSheet({ ...state.sheet, portions: Math.max(0.5, Number(el.value) || 1) }),
  setScanStore: (el) => {
    /* Just the shop for the thing being edited. It must not reload from
       anywhere: doing that used to pull the existing product back in and
       quietly overwrite it instead of adding the new one beside it. */
    setSheet({
      ...state.sheet,
      store: canonicalStore(el.value, storeNames(state.db.ingredients)),
    });
  },
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
    const portions = Math.max(0.5, Number(s.portions) || 1);

    /* An existing kind of thing: this either updates one of its products or
       adds another one alongside, and either way the rest are left alone. */
    if (s.targetId) {
      const ing = ingredient(s.targetId);
      if (!ing) return;
      const wantNew = s.productId === "__new__";
      const existing = wantNew ? null : productById(ing, s.productId);
      const name = (s.productName || "").trim() || (existing && existing.name) || ing.name;

      // the id is built from the name and shop, so it moves when either does
      const nextId = productKey(name, s.store);
      const product = {
        ...(existing || newProduct(name, s.store)),
        id: nextId,
        name,
        store: s.store,
        pricePerPack: price,
        priceUpdated: now(),
        offer,
        portionsPerPack: portions,
        barcodes: [...new Set([...((existing && existing.barcodes) || []), s.code].filter(Boolean))],
      };
      const added = bought * packPortions(product);
      product.stockPortions = (Number(product.stockPortions) || 0) + added;

      const before = existing ? Number(existing.pricePerPack) || 0 : 0;
      commit((db) => {
        const i = db.ingredients.findIndex((x) => x.id === ing.id);
        if (i < 0) return;
        const was = db.ingredients[i];
        db.ingredients[i] = {
          ...was,
          updatedAt: now(),
          products: [
            ...(was.products || []).filter(
              (x) => x.id !== product.id && x.id !== (existing && existing.id)
            ),
            product,
          ],
          preferredProductId:
            existing && was.preferredProductId === existing.id
              ? product.id
              : was.preferredProductId,
          // buying it settles whatever was on the list by hand
          extraPacks: bought > 0 ? 0 : was.extraPacks,
        };
      });
      state.sheet = null;

      const delta = price - before;
      const moved =
        existing && before > 0 && Math.abs(delta) > 0.004
          ? `, ${delta > 0 ? "up" : "down"} £${money(Math.abs(delta))}`
          : existing
          ? ""
          : `, a new kind of ${ing.name}`;
      flash(
        "ok",
        bought > 0
          ? `${product.name} now £${money(price)}${moved}. ${bought} pack${
              bought === 1 ? "" : "s"
            }, ${trim2(added)} portions, added to stock.`
          : `${product.name} now £${money(price)}${moved}.`
      );
      return;
    }

    const name = (s.name || "").trim();
    if (!name) {
      setSheet({ ...s, err: "Say what kind of thing this is." });
      return;
    }
    const made = newIngredient(s.store, name);
    made.updatedAt = now();
    made.products = [
      newProduct((s.productName || "").trim() || name, s.store, {
        pricePerPack: price,
        portionsPerPack: portions,
        priceUpdated: now(),
        offer,
        barcodes: s.code ? [s.code] : [],
        stockPortions: bought * portions,
      }),
    ];
    made.id = uniqueId(name, state.db.ingredients.map((i) => i.id));
    commit((db) => db.ingredients.push(made));
    state.sheet = null;
    flash(
      "ok",
      bought > 0
        ? `${made.name} added at £${money(price)}, ${trim2(made.products[0].stockPortions)} portions in stock.`
        : `${made.name} added at £${money(price)}.`
    );
  },

  bought: (el) => {
    const ing = ingredient(el.dataset.id);
    if (!ing) return;
    // packs off a particular shelf, portions onto that particular thing
    const packs = Number(el.dataset.packs) || 0;
    const product = productOf(ing.id, el.dataset.product) || chooseProduct(ing);
    if (!product) return;
    patchProduct(ing.id, product.id, {
      stockPortions: productStock(product) + packs * packPortions(product),
    });
    patchIngredient(ing.id, { extraPacks: 0 });
  },

  moreStockPack: (el) => {
    const ing = ingredient(el.dataset.id);
    const product = ing && (productOf(ing.id, el.dataset.product) || chooseProduct(ing));
    if (!product) return;
    patchProduct(ing.id, product.id, {
      stockPortions: productStock(product) + packPortions(product),
    });
  },
  lessStockPack: (el) => {
    const ing = ingredient(el.dataset.id);
    const product = ing && (productOf(ing.id, el.dataset.product) || chooseProduct(ing));
    if (!product) return;
    patchProduct(ing.id, product.id, {
      stockPortions: Math.max(0, productStock(product) - packPortions(product)),
    });
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
  toggleSection: async (el) => {
    const kind = el.dataset.kind;
    const open = state.settings.openSections || [];
    state.settings = {
      ...state.settings,
      openSections: open.includes(kind) ? open.filter((k) => k !== kind) : [...open, kind],
    };
    await saveSettings(state.settings);
    draw();
  },
  setMealFilter: async (el) => {
    state.settings = { ...state.settings, mealFilter: el.dataset.filter };
    await saveSettings(state.settings);
    draw();
  },
  setItemSort: async (el) => {
    state.settings = { ...state.settings, itemSort: el.dataset.sort };
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

  /* ---- one product of an ingredient ---- */

  setProductName: (el) => {
    const ing = ingredient(el.dataset.id);
    const product = productOf(el.dataset.id, el.dataset.product);
    if (!ing || !product) return;
    renameProduct(ing, product, { name: el.value.trim() });
  },
  setProductStore: (el) => {
    const ing = ingredient(el.dataset.id);
    const product = productOf(el.dataset.id, el.dataset.product);
    if (!ing || !product) return;
    const store = canonicalStore(
      el.value,
      storeNames(state.db.ingredients).filter((n) => n !== product.store)
    );
    renameProduct(ing, product, { store });
  },
  setProductPrice: (el) =>
    patchProduct(el.dataset.id, el.dataset.product, {
      pricePerPack: Math.max(0, Number(el.value) || 0),
      priceUpdated: now(),
    }),
  setProductNumber: (el) => {
    const field = el.dataset.field;
    patchProduct(el.dataset.id, el.dataset.product, {
      [field]: Math.max(0, Number(el.value) || 0),
      // a hand-typed macro is a reading in its own right, and has to be
      // stamped or the other phone's older label would win the merge
      ...(PER100.includes(field) ? { nutritionUpdated: now() } : {}),
    });
  },
  setProductField: (el) =>
    patchProduct(el.dataset.id, el.dataset.product, { [el.dataset.field]: el.value }),

  shootLabel: (el) => shootLabel(el.dataset.id, el.dataset.product),

  toggleLabelSize: (el) => setSheet({ ...state.sheet, useSize: el.checked }),

  applyLabel: () => {
    const s = state.sheet;
    if (!s || !s.values) return;
    const product = productOf(s.id, s.productId);
    // the four figures land under their per-100 names, never per portion
    const per100 = Object.fromEntries(NUTRIENTS.map((k) => [`${k}100`, s.values[k] || 0]));
    const size = s.sizing && s.useSize !== false ? sizingChanges(s.sizing) : {};
    patchProduct(s.id, s.productId, { ...per100, ...size, nutritionUpdated: now() });
    setSheet(null);
    flash("ok", `Nutrition saved to ${(product && product.name) || "the product"}.`);
  },

  setPackUnit: (el) =>
    patchProduct(el.dataset.id, el.dataset.product, { packUnit: el.value === "ml" ? "ml" : el.value === "g" ? "g" : "" }),

  /* Switching how a portion is defined seeds the other side from what is
     already known, so the figures do not lurch when you flip the toggle. */
  setPortionBy: (el) => {
    const product = productOf(el.dataset.id, el.dataset.product);
    if (!product) return;
    const to = el.dataset.by === "weight" ? "weight" : "count";
    const changes = { portionBy: to };
    if (to === "weight" && !(Number(product.portionGrams) > 0)) {
      const grams = gramsPerPortion(product);
      if (grams > 0) changes.portionGrams = Math.round(grams * 100) / 100;
    }
    if (to === "count" && !(Number(product.portionsPerPack) > 0)) {
      const count = portionsPer(product);
      if (count > 0) changes.portionsPerPack = Math.round(count * 100) / 100;
    }
    patchProduct(el.dataset.id, el.dataset.product, changes);
  },

  setMealBy: (el) => {
    const by = el.dataset.by === "grams" ? "grams" : "portions";
    patchMealItem(el.dataset.id, Number(el.dataset.i), (it, ing) => {
      const changes = { by };
      // seed the empty side from the other, so the amount does not vanish
      if (by === "grams" && !(Number(it.grams) > 0)) {
        const per = gramsPerPortion(itemProduct(ing, it));
        if (per > 0) changes.grams = Math.round((Number(it.portions) || 0) * per);
      }
      if (by === "portions" && !(Number(it.portions) > 0)) {
        const per = gramsPerPortion(itemProduct(ing, it));
        if (per > 0) changes.portions = Math.round(((Number(it.grams) || 0) / per) * 100) / 100;
      }
      return changes;
    });
  },

  setMealGrams: (el) =>
    patchMealItem(el.dataset.id, Number(el.dataset.i), () => ({
      grams: Math.max(0, Number(el.value) || 0),
    })),

  /* The same product at another shop. Everything carries over except where
     you buy it and what it costs, because that is the only thing that
     actually differs, and retyping a label and a pack size is the tedious
     part. The barcode comes too: it is the same tin. */
  copyProduct: (el) => {
    const ing = ingredient(el.dataset.id);
    const from = productOf(el.dataset.id, el.dataset.product);
    if (!ing || !from) return;
    commit((db) => {
      const i = db.ingredients.findIndex((x) => x.id === ing.id);
      if (i < 0) return;
      const products = db.ingredients[i].products || [];
      const made = copyToShop(from, products.map((p) => p.id));
      db.ingredients[i] = { ...db.ingredients[i], updatedAt: now(), products: [...products, made] };
    });
    flash("ok", "Copied. Set the shop and its price on the new one.");
  },

  moveProduct: (el) => {
    const toId = el.value;
    if (!toId) return;
    let done = null;
    commit((db) => {
      done = moveProduct(db, el.dataset.id, el.dataset.product, toId);
    });
    if (!done) return;
    /* Say what happened, because emptying the old ingredient removes it from
       the list entirely and that would otherwise look like a deletion. */
    flash(
      "ok",
      done.removedSource
        ? `Now filed under ${done.to}. ${done.from} had nothing else to buy, so that entry has gone.`
        : `${done.product.name || "It"} moved from ${done.from} to ${done.to}.`
    );
  },

  addProduct: (el) => {
    const ing = ingredient(el.dataset.id);
    if (!ing) return;
    // pack size copied from what it is bought as now, since the same thing in
    // two guises is usually a similar pack. Editable either way.
    const from = chooseProduct(ing);
    commit((db) => {
      const i = db.ingredients.findIndex((x) => x.id === ing.id);
      if (i < 0) return;
      const made = newProduct("", "", { portionsPerPack: from ? from.portionsPerPack : 1 });
      made.id = uniqueId(made.id, (db.ingredients[i].products || []).map((p) => p.id));
      db.ingredients[i] = {
        ...db.ingredients[i],
        updatedAt: now(),
        products: [...(db.ingredients[i].products || []), made],
      };
    });
  },
  delProduct: (el) => {
    const ing = ingredient(el.dataset.id);
    if (!ing || productsOf(ing).length < 2) return;
    const product = productOf(ing.id, el.dataset.product);
    if (!confirm(`Stop buying ${ing.name} as ${(product && product.name) || "this"}?`)) return;
    commit((db) => {
      const i = db.ingredients.findIndex((x) => x.id === ing.id);
      if (i < 0) return;
      const was = db.ingredients[i];
      db.ingredients[i] = {
        ...was,
        updatedAt: now(),
        preferredProductId:
          was.preferredProductId === el.dataset.product ? "" : was.preferredProductId,
        products: (was.products || []).filter((p) => p.id !== el.dataset.product),
      };
      // a meal naming this one now means "any", which is better than nothing
      db.meals = db.meals.map((m) => ({
        ...m,
        items: m.items.map((it) =>
          it.ingredientId === ing.id && it.productId === el.dataset.product
            ? { ...it, productId: "" }
            : it
        ),
      }));
    });
  },
  pinProduct: (el) => {
    const ing = ingredient(el.dataset.id);
    if (!ing) return;
    const already = ing.preferredProductId === el.dataset.product;
    patchIngredient(ing.id, { preferredProductId: already ? "" : el.dataset.product });
  },

  setProductOfferKind: (el) => {
    const kind = el.value;
    if (!kind) {
      patchProduct(el.dataset.id, el.dataset.product, { offer: null });
      return;
    }
    const product = productOf(el.dataset.id, el.dataset.product);
    const prev = (product && product.offer) || {};
    const seed = { kind, ends: prev.ends || "" };
    if (kind === "loyalty") seed.price = prev.price || 0;
    if (kind === "multibuy") { seed.qty = prev.qty || 2; seed.price = prev.price || 0; }
    if (kind === "xfory") { seed.qty = prev.qty || 3; seed.pay = prev.pay || 2; }
    patchProduct(el.dataset.id, el.dataset.product, { offer: seed });
  },
  setProductOfferField: (el) => {
    const product = productOf(el.dataset.id, el.dataset.product);
    if (!product || !product.offer) return;
    const field = el.dataset.field;
    const value = field === "ends" ? el.value : Number(el.value) || 0;
    patchProduct(el.dataset.id, el.dataset.product, { offer: { ...product.offer, [field]: value } });
  },

  /* ---- the plan ---- */

  setPerson: async (el) => {
    const which = Number(el.dataset.person) || 0;
    commit((db) => {
      const people = [...(db.people || ["Person 1", "Person 2"])];
      people[which] = el.value.trim() || `Person ${which + 1}`;
      db.people = people;
    });
  },
  setPlanStart: (el) => commit((db) => { db.planStart = el.value || ""; }),
  copySlot: (el) =>
    commit((db) => {
      const day = db.plan[Number(el.dataset.idx)];
      if (!day) return;
      const pair = day[el.dataset.slot] || [null, null];
      day[el.dataset.slot] = [pair[0], pair[0]];
    }),

  setBudget: (el) => commit((db) => { db.budget = Number(el.value) || 0; }),
  setSlot: (el) =>
    commit((db) => {
      const day = db.plan[Number(el.dataset.idx)];
      if (!day) return;
      const pair = Array.isArray(day[el.dataset.slot]) ? [...day[el.dataset.slot]] : [null, null];
      pair[Number(el.dataset.person) || 0] = el.value || null;
      day[el.dataset.slot] = pair;
    }),
  fillSlot: (el) => {
    const slot = el.dataset.slot;
    const first = (state.db.plan[0] && state.db.plan[0][slot]) || [null, null];
    if (!first[0] && !first[1]) {
      flash("err", `Set day one's ${slot} first, then this copies it across.`);
      return;
    }
    commit((db) => {
      db.plan.forEach((day) => {
        if (!day) return;
        const pair = Array.isArray(day[slot]) ? day[slot] : [null, null];
        // only the empty places, so a day you have already decided is safe
        day[slot] = [pair[0] || first[0], pair[1] || first[1]];
      });
    });
  },
  clearPlan: () => {
    if (confirm("Clear both weeks?"))
      commit((db) => {
        db.plan = Array.from({ length: 14 }, () => ({
          breakfast: [null, null], lunch: [null, null], dinner: [null, null],
        }));
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
  addBarcode: (el) => {
    const id = el.dataset.id;
    const productId = el.dataset.product;
    openCamera("Scan a barcode", (code) => {
      const product = productOf(id, productId);
      const ing = ingredient(id);
      if (!ing || !product) return;
      patchProduct(id, productId, { barcodes: [...new Set([...(product.barcodes || []), code])] });
      // a barcode names one exact thing, so say which one it landed on
      flash("ok", `Barcode ${code} bound to ${product.name || ing.name}.`);
    });
  },
  delBarcode: (el) => {
    const product = productOf(el.dataset.id, el.dataset.product);
    if (!product) return;
    patchProduct(el.dataset.id, el.dataset.product, {
      barcodes: (product.barcodes || []).filter((b) => b !== el.dataset.code),
    });
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
      // blank product: any of that ingredient will do, which is the usual case
      if (m) m.items.push({ ingredientId: db.ingredients[0].id, productId: "", portions: 0.5 });
    }),
  delMealIng: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (m) m.items.splice(Number(el.dataset.i), 1);
    }),
  setMealIng: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (!m) return;
      // a product of the old ingredient means nothing under the new one
      m.items[Number(el.dataset.i)] = {
        ...m.items[Number(el.dataset.i)],
        ingredientId: el.value,
        productId: "",
      };
    }),
  setMealProduct: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (m) m.items[Number(el.dataset.i)].productId = el.value || "";
    }),
  setMealPortions: (el) =>
    commit((db) => {
      const m = db.meals.find((x) => x.id === el.dataset.id);
      if (m) m.items[Number(el.dataset.i)].portions = Number(el.value) || 0;
    }),

  shootReceipt: () => shootReceipt(),
  setReceiptStore: (el) => {
    const store = canonicalStore(el.value, storeNames(state.db.ingredients));
    // which shop it was decides which price the lines are compared against
    setSheet({ ...state.sheet, store, rows: refreshRows(state.sheet.rows, state.sheet.date, store) });
  },
  setReceiptDate: (el) => {
    const date = el.value || today();
    setSheet({
      ...state.sheet,
      date,
      dateRead: true,
      rows: refreshRows(state.sheet.rows, date, state.sheet.store),
    });
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
    const ing = el.value && el.value !== "__new__" ? ingredient(el.value) : null;
    rows[i] = {
      ...rows[i],
      targetId: el.value,
      // pick the likeliest one of that kind at this shop, or something new
      productId: ing
        ? (resolveProduct(ing, state.sheet.store, rows[i].raw) || {}).id || "__new__"
        : "",
      use: !!el.value,
      why: el.value ? "you chose it" : "ignored",
      stockAdd: 0,
      stockTouched: false,
    };
    // the item they just chose may itself be newer than this receipt
    setSheet({ ...state.sheet, rows: refreshRows(rows, state.sheet.date, state.sheet.store) });
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
  setRowProduct: (el) => {
    const rows = state.sheet.rows.slice();
    const i = Number(el.dataset.i);
    rows[i] = { ...rows[i], productId: el.value, stockAdd: 0, stockTouched: false };
    // a different one may have been priced since this receipt was printed
    setSheet({ ...state.sheet, rows: refreshRows(rows, state.sheet.date, state.sheet.store) });
  },
  setRowProductName: (el) => {
    const rows = state.sheet.rows.slice();
    const i = Number(el.dataset.i);
    rows[i] = { ...rows[i], newProductName: el.value };
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
    // the same ordering that is on screen, so copy and read agree
    const text = backupJson(state.db);
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
      // forced: restoring is exactly what you do when the read failed
      await saveDb(state.db, true);
      setSheet({ ...state.sheet, msg: "Restored.", err: false });
    } catch (err) {
      setSheet({ ...state.sheet, msg: "That is not valid JSON.", err: true });
    }
  },
  checkUpdate: async () => {
    setSheet({ ...state.sheet, checking: true });
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error("No offline copy is installed yet.");
      await reg.update();
      /* update() fetches the worker but the page keeps running the old files
         until it is reloaded, so do that rather than claiming to be done. */
      location.reload();
    } catch (err) {
      setSheet({ ...state.sheet, checking: false, msg: err.message, err: true });
    }
  },

  resetAll: async () => {
    if (!confirm("Reset to the starting items and meals? Local changes will be lost.")) return;
    state.db = seed();
    await saveDb(state.db, true);
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
  /* A tap on the dim area beside a sheet closes it only where the sheet says
     it may. Most of them hold something half finished, and a receipt is
     twenty lines of review that a thumb landing on the edge used to discard
     without a word. Close is always in the corner. */
  if (e.target.classList && e.target.classList.contains("scrim")) {
    if (e.target.dataset.dismiss === "1") setSheet(null);
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
