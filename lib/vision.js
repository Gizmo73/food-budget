/* Receipt reading. One prompt, two providers, same output shape.
   Keys live in device settings and are sent straight to the provider.
   Nothing is stored or proxied anywhere else. */

const PROMPT = `You are reading a photograph of a UK supermarket receipt.

Return ONLY a JSON object, with no preamble and no markdown fences:
{"store": string|null, "date": string|null, "lines": [{"name": string, "unitPrice": number, "qty": number}]}

Rules:
- unitPrice is the price in pounds for ONE pack of that item. If the receipt shows a line total for a multiple quantity, divide it by the quantity.
- qty is how many packs were bought on that line.
- Expand receipt abbreviations into normal words, for example "TESCO SPGHTI 500G" becomes "Tesco Spaghetti 500g".
- Skip every non-product line: subtotals, totals, savings, Clubcard or Nectar messages, vouchers, payment, change, VAT, store address, phone numbers.
- Where a multi-buy or loyalty price applied, use the amount actually charged.
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
      }))
      .filter((l) => l.name),
  };
}

async function viaGemini(settings, base64) {
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
            { text: PROMPT },
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
  return parseJson(text);
}

async function viaAnthropic(settings, base64) {
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
            { type: "text", text: PROMPT },
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
  return parseJson(text);
}

export async function readReceipt(settings, file) {
  const provider = settings.provider || "gemini";
  if (provider === "gemini" && !settings.geminiKey) {
    throw new Error("Add a Gemini API key in Settings first.");
  }
  if (provider === "anthropic" && !settings.anthropicKey) {
    throw new Error("Add an Anthropic API key in Settings first.");
  }
  const base64 = await shrink(file);
  return provider === "anthropic" ? viaAnthropic(settings, base64) : viaGemini(settings, base64);
}
