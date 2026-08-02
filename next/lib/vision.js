/* Receipt reading. One prompt, two providers, same output shape.
   Keys live in device settings and are sent straight to the provider.
   Nothing is stored or proxied anywhere else. */

import { parsePackSize } from "./store.js";

const PROMPT = `You are reading a photograph of a UK supermarket receipt.

Return ONLY a JSON object, with no preamble and no markdown fences:
{"store": string|null, "date": string|null, "lines": [{"name": string, "unitPrice": number, "qty": number, "offerKind": "none"|"loyalty"|"multibuy", "offerQty": number|null, "offerTotal": number|null}]}

Rules:
- unitPrice is the price in pounds for ONE pack of that item. If the receipt shows a line total for a multiple quantity, divide it by the quantity.
- qty is how many packs were bought on that line.
- Expand receipt abbreviations into normal words, for example "TESCO SPGHTI 500G" becomes "Tesco Spaghetti 500g".
- Skip every non-product line: subtotals, totals, savings, Clubcard or Nectar messages, vouchers, payment, change, VAT, store address, phone numbers.
- offerKind describes the promotion on that line, and the distinction matters:
  - "loyalty" means a lower price per pack with no minimum quantity, such as a Clubcard or Nectar price. Anyone with the card pays this for one pack.
  - "multibuy" means the price depends on buying several, such as "3 FOR 8.00" or "2 FOR 5". Buying one does NOT get this price.
  - "none" means full price.
- For a multibuy, set offerQty to how many packs the deal covers and offerTotal to the price for that group. "3 FOR 8.00" is offerQty 3 and offerTotal 8.00. Leave both null otherwise.
- Look for promotion markers beside the line and for matching saving lines further down the receipt.
- unitPrice is always the amount actually charged for one pack on this visit, even under a promotion.
- date must be ISO format YYYY-MM-DD if you can read it, otherwise null.
- If nothing is legible, return {"store": null, "date": null, "lines": []}.`;

/* Shrink before upload. A raw phone photo is several megabytes of base64
   and slows the request down for no gain in legibility. */
export async function shrink(file, max = 1600, quality = 0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality).split(",")[1];
}

function parseJson(text) {
  const clean = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The model did not return JSON.");
  const parsed = JSON.parse(clean.slice(start, end + 1));
  return {
    store: parsed.store || "",
    date: parsed.date || "",
    lines: (Array.isArray(parsed.lines) ? parsed.lines : [])
      .map((l) => ({
        name: String(l.name || "").trim(),
        unitPrice: Number(l.unitPrice) || 0,
        qty: Number(l.qty) || 1,
        offerKind: ["loyalty", "multibuy"].includes(l.offerKind) ? l.offerKind : "none",
        offerQty: Number(l.offerQty) || 0,
        offerTotal: Number(l.offerTotal) || 0,
      }))
      .filter((l) => l.name),
  };
}

const NUTRITION_PROMPT = `You are reading the nutrition information panel on a UK food package.

Return ONLY a JSON object, with no preamble and no markdown fences:
{"name": string|null, "packSize": string|null, "preparedSize": string|null, "basis": "as sold"|"as prepared"|null,
 "servingSize": string|null, "servingsPerPack": number|null,
 "per100": {"kcal": number, "protein": number, "carbs": number, "fat": number}|null,
 "perServing": {"kcal": number, "protein": number, "carbs": number, "fat": number}|null}

Rules:
- The panel is a table. One column is per 100g or per 100ml. A second column, if present, is the serving, and it is not always headed "per serving": "per 1/2 pot (300g)", "per pack", "per biscuit" and "each" all mean the serving column.
- Fill per100 only from the per 100g column, and perServing only from the serving column. Never copy one into the other, and use null for a column that is not printed.
- IGNORE any column headed %RI, %RDA, "Reference intake" or "your RI". Those are percentages and adult daily targets, not the nutrition of this food. A row reading "Fat 1.2g 3.6g 5% 70g" has per100 fat 1.2 and perServing fat 3.6; 5 and 70 are not nutrition values.
- kcal is energy in kilocalories, not kilojoules. A row reading "167kJ 40kcal" has kcal 40.
- carbs means total carbohydrate, NOT the "of which sugars" line underneath it. fat means total fat, NOT "of which saturates". Take the parent row every time.
- All four numbers are in grams except kcal. Strip units and return plain numbers.
- packSize is the total weight or volume of the pack as sold, such as "600g" or "1.5kg".
- basis says what the nutrition figures describe. A table headed "when grilled according to instructions", "when cooked", "as prepared" or "as consumed" is "as prepared". A plain table with no such heading is "as sold".
- preparedSize is the weight of the WHOLE PACK after cooking, when the label states it. Raw meat and frozen food often carry a footnote like "when grilled according to instructions 342g typically weighs 248g": there packSize is "342g" and preparedSize is "248g". Leave it null when no cooked weight is printed.
- servingSize is the weight of ONE serving, in grams, if it can be read anywhere: from the serving column heading such as "per 1/2 pot (300g)" or "One sausage patty (41g)", or from a line like "Serving size 125g". Take it from the same column the perServing figures came from, so it is on the same basis as them.
- servingsPerPack is how many servings the pack says it holds, including footnotes such as "Contains 2 portions" or "Pack contains 6 servings".
- name is the product name if it is legible in the photograph.
- If no nutrition panel is legible, return every field as null.`;

function parseNutrition(text) {
  const clean = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The model did not return JSON.");
  const parsed = JSON.parse(clean.slice(start, end + 1));

  /* A column the label does not print must stay missing. Coercing it to zeroes
     would quietly claim the food has no calories. */
  const column = (src) => {
    if (!src || typeof src !== "object") return null;
    const out = {
      kcal: Math.max(0, Number(src.kcal) || 0),
      protein: Math.max(0, Number(src.protein) || 0),
      carbs: Math.max(0, Number(src.carbs) || 0),
      fat: Math.max(0, Number(src.fat) || 0),
    };
    return Object.values(out).some((v) => v > 0) ? out : null;
  };

  const packSize = String(parsed.packSize || "").trim();
  const preparedSize = String(parsed.preparedSize || "").trim();
  const servingSize = String(parsed.servingSize || "").trim();
  const pack = parsePackSize(packSize);
  const prepared = parsePackSize(preparedSize);
  const serving = parsePackSize(servingSize);

  return {
    name: String(parsed.name || "").trim(),
    packSize,
    preparedSize,
    servingSize,
    // resolved here so callers never have to parse a size string themselves
    packAmount: pack.amount,
    packUnit: pack.unit || prepared.unit || serving.unit,
    preparedAmount: prepared.amount,
    servingGrams: serving.amount,
    servingsPerPack: Math.max(0, Number(parsed.servingsPerPack) || 0),
    basis: parsed.basis === "as prepared" ? "as prepared" : parsed.basis === "as sold" ? "as sold" : "",
    per100: column(parsed.per100),
    perServing: column(parsed.perServing),
  };
}

async function viaGemini(settings, base64, prompt = PROMPT, parse = parseJson) {
  const model = settings.geminiModel || "gemini-3.1-flash-lite-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": settings.geminiKey },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: "image/jpeg", data: base64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini refused the request (${res.status}). ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  const candidate = (data.candidates || [])[0] || {};
  const parts = (candidate.content && candidate.content.parts) || [];
  const text = parts.map((p) => p.text || "").join("");
  return parse(text);
}

async function viaAnthropic(settings, base64, prompt = PROMPT, parse = parseJson) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.anthropicModel || "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude refused the request (${res.status}). ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return parse(text);
}

async function look(settings, file, prompt, parse) {
  const provider = settings.provider || "gemini";
  if (provider === "gemini" && !settings.geminiKey) {
    throw new Error("Add a Gemini API key in Settings first.");
  }
  if (provider === "anthropic" && !settings.anthropicKey) {
    throw new Error("Add an Anthropic API key in Settings first.");
  }
  const base64 = await shrink(file);
  return provider === "anthropic"
    ? viaAnthropic(settings, base64, prompt, parse)
    : viaGemini(settings, base64, prompt, parse);
}

export const readReceipt = (settings, file) => look(settings, file, PROMPT, parseJson);

export const readNutrition = (settings, file) =>
  look(settings, file, NUTRITION_PROMPT, parseNutrition);
