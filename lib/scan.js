/* Barcode scanning.
   Uses the browser's own BarcodeDetector, which Chrome on Android has built in.
   No library, no CDN, works offline once the page is cached. */

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

export const scanSupported = () =>
  typeof window !== "undefined" &&
  "BarcodeDetector" in window &&
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

function makeDetector() {
  return new window.BarcodeDetector({ formats: FORMATS });
}

/* Start a live scan. Calls onCode(value) once, then keeps running until you
   call the returned stop(). Returns { stop, torch } where torch(on) may fail
   silently on hardware without a lamp. */
export async function startScan(video, onCode, onError) {
  if (!scanSupported()) {
    onError && onError(new Error("This browser cannot scan barcodes. Type the number instead."));
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

  const detector = makeDetector();
  const track = stream.getVideoTracks()[0];
  let running = true;
  let lastValue = "";
  let lastAt = 0;

  const tick = async () => {
    if (!running) return;
    try {
      if (video.readyState >= 2) {
        const found = await detector.detect(video);
        if (found && found.length) {
          const value = found[0].rawValue;
          const now = Date.now();
          // debounce: the same code fires every frame while it is in view
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
    if (running) setTimeout(tick, 220);
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
export async function decodeStill(file) {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const found = await makeDetector().detect(bitmap);
    return found && found.length ? found[0].rawValue : null;
  } catch (err) {
    return null;
  }
}
