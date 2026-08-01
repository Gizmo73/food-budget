/* Barcode scanning.
   Chromium browsers have BarcodeDetector built in and we use it directly.
   Firefox and Safari do not, so we lazily load a vendored wasm decoder from
   lib/vendor/. That download only happens on browsers that need it, and the
   service worker keeps it for offline use afterwards. */

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

/* Invites are QR, products are not. Kept apart on purpose: a QR code printed
   on a packet must never be mistaken for that product's barcode. */
export const QR_FORMATS = ["qr_code"];

let ctor = null;
let kind = null;

export const cameraSupported = () =>
  typeof navigator !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/* Scanning is possible wherever there is a camera, because the decoder
   now has a fallback for browsers without a built-in one. */
export const scanSupported = cameraSupported;

/* "native" on Chromium, "fallback" on Firefox and Safari, null before the
   first scan, "none" if the fallback failed to load. */
export const decoderKind = () => kind;

async function getCtor() {
  if (ctor) return ctor;

  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    ctor = window.BarcodeDetector;
    kind = "native";
    return ctor;
  }

  const mod = await import("./vendor/barcode-polyfill.js");
  ctor = mod.BarcodeDetector;
  kind = "fallback";
  return ctor;
}

/* Start a live scan. onCode fires each time a code settles in view.
   Returns { stop, torch } or null if the camera could not be opened. */
export async function startScan(video, onCode, onError, onStatus, formats = FORMATS) {
  if (!cameraSupported()) {
    onError && onError(new Error("This browser has no camera access. Type the number instead."));
    return null;
  }

  let Detector;
  try {
    onStatus && onStatus("Loading the decoder");
    Detector = await getCtor();
  } catch (err) {
    kind = "none";
    onError && onError(new Error("Could not load the barcode decoder. Type the number instead."));
    return null;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    onError && onError(new Error("Camera blocked. Allow camera access for this site, then retry."));
    return null;
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  try {
    await video.play();
  } catch (err) {
    /* autoplay can reject on a cold start; the frame loop still works */
  }

  const detector = new Detector({ formats });
  const track = stream.getVideoTracks()[0];
  // the wasm decoder is heavier than the native one, so give it more room
  const interval = kind === "fallback" ? 400 : 220;

  let running = true;
  let lastValue = "";
  let lastAt = 0;

  onStatus && onStatus("Looking for a barcode");

  const tick = async () => {
    if (!running) return;
    try {
      if (video.readyState >= 2) {
        const found = await detector.detect(video);
        if (found && found.length) {
          const value = found[0].rawValue;
          const now = Date.now();
          // the same code fires every frame while it stays in view
          if (value && (value !== lastValue || now - lastAt > 2500)) {
            lastValue = value;
            lastAt = now;
            onCode(value);
          }
        }
      }
    } catch (err) {
      /* a dropped frame is not worth surfacing */
    }
    if (running) setTimeout(tick, interval);
  };
  tick();

  return {
    stop() {
      running = false;
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        /* already gone */
      }
      video.srcObject = null;
    },
    async torch(on) {
      try {
        await track.applyConstraints({ advanced: [{ torch: !!on }] });
        return true;
      } catch (err) {
        return false;
      }
    },
  };
}

/* Fallback for when the live scan will not start: decode a still photo. */
export async function decodeStill(file, formats = FORMATS) {
  try {
    const Detector = await getCtor();
    const bitmap = await createImageBitmap(file);
    const found = await new Detector({ formats }).detect(bitmap);
    return found && found.length ? found[0].rawValue : null;
  } catch (err) {
    return null;
  }
}
