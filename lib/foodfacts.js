/* Nutrition by barcode, from Open Food Facts.

   A free, open database of packaged food, filled in by shoppers. It is not a
   language model, so it has no busy hours and needs no key, and for anything
   it knows it answers in a fraction of a second. What it gives back is shaped
   like a read label, so everything downstream treats the two the same.

   It is crowd sourced, so it is a starting point to check against the pack,
   exactly as a photograph is. */

import { parsePackSize } from "./store.js";

const FIELDS = [
  "product_name",
  "product_name_en",
  "brands",
  "quantity",
  "serving_size",
  "nutriments",
].join(",");

// a supermarket aisle can have one bar of signal; the photo is the way out
const TIMEOUT_MS = 8000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/* One column of the four figures the app keeps. kJ stands in for kcal when
   only the one is filled, which is common on older entries. */
function column(n, suffix) {
  if (!n) return null;
  const kj = num(n[`energy_${suffix}`]) ?? num(n[`energy-kj_${suffix}`]);
  const kcal = num(n[`energy-kcal_${suffix}`]) ?? (kj != null ? Math.round(kj / 4.184) : null);
  const out = {
    kcal: kcal || 0,
    protein: num(n[`proteins_${suffix}`]) || 0,
    carbs: num(n[`carbohydrates_${suffix}`]) || 0,
    fat: num(n[`fat_${suffix}`]) || 0,
  };
  // an empty column must stay missing rather than claim the food has nothing in it
  return Object.values(out).some((v) => v > 0) ? out : null;
}

/* Shaped as lib/vision.js returns a read label. Open Food Facts gives per
   100g as sold, so basis is always that and there is no cooked weight. */
export function toLabel(product) {
  if (!product) return null;
  const per100 = column(product.nutriments, "100g");
  const perServing = column(product.nutriments, "serving");
  if (!per100 && !perServing) return null;

  const packSize = String(product.quantity || "").trim();
  const servingSize = String(product.serving_size || "").trim();
  const pack = parsePackSize(packSize);
  const serving = parsePackSize(servingSize);
  const brand = String(product.brands || "").split(",")[0].trim();
  const name = String(product.product_name_en || product.product_name || "").trim();

  return {
    name: brand && name && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name,
    packSize,
    preparedSize: "",
    servingSize,
    packAmount: pack.amount,
    packUnit: pack.unit || serving.unit,
    preparedAmount: 0,
    servingGrams: serving.amount,
    servingsPerPack: 0,
    basis: "as sold",
    per100,
    perServing,
    source: "off",
  };
}

/* The label for a barcode, or null when Open Food Facts does not know it or
   cannot be reached. Never throws: a miss here just means take a photo. */
export async function lookupBarcode(code) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length < 8) return null;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=${FIELDS}`,
      { signal: ctrl ? ctrl.signal : undefined }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.status === 1 ? toLabel(data.product) : null;
  } catch (err) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
