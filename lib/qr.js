/* QR encoding, byte mode, error correction level M, versions 1 to 20.

   Written out rather than vendored, for one reason: the thing being encoded is
   an invite code containing a token with write access to your data. Every
   easy alternative, an image service or a CDN script, means handing that token
   to someone else. Encoding here keeps it on the device like every other
   secret in this app, and it costs a few hundred lines that never change.

   Level M is a deliberate choice over L. The code is read off one phone screen
   by another phone camera, often at an angle, and M tolerates about 15% damage
   against L's 7% for a version or two of extra size. */

/* Per version: error correction codewords per block, then the block groups as
   [count, data codewords each]. Data + EC always fills the version exactly. */
const EC_M = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
  11: [30, [[1, 50], [4, 51]]],
  12: [22, [[6, 36], [2, 37]]],
  13: [22, [[8, 37], [1, 38]]],
  14: [24, [[4, 40], [5, 41]]],
  15: [24, [[5, 41], [5, 42]]],
  16: [28, [[7, 45], [3, 46]]],
  17: [28, [[10, 46], [1, 47]]],
  18: [26, [[9, 43], [4, 44]]],
  19: [26, [[3, 44], [11, 45]]],
  20: [26, [[3, 41], [13, 42]]],
};

/* Centres of the alignment patterns. Version 1 has none. */
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62],
  14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
  17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
};

const dataCapacity = (version) =>
  EC_M[version][1].reduce((sum, [count, each]) => sum + count * each, 0);

/* ---------------------------- GF(256) and RS ---------------------------- */

/* Reed-Solomon works in a field where multiplication is addition of
   logarithms, so both tables are built once and every product is a lookup. */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR primitive polynomial
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/* The generator polynomial for n check codewords is the product of
   (x - 2^i) for i in 0..n-1. */
function generator(n) {
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function ecCodewords(data, count) {
  const gen = generator(count);
  const rem = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < count; i += 1) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

/* ------------------------------ bit stream ------------------------------ */

function bitStream() {
  const bits = [];
  return {
    bits,
    push(value, length) {
      for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
    },
  };
}

/* Encode as bytes and pick the smallest version that holds them. Byte mode
   handles any UTF-8, which matters because a repo or a person's name can
   contain anything. */
function encodeData(text) {
  const bytes = new TextEncoder().encode(text);

  let version = 0;
  for (let v = 1; v <= 20; v += 1) {
    // the character count indicator widens at version 10
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCapacity(v) * 8) {
      version = v;
      break;
    }
  }
  if (!version) {
    throw new Error("Too much data for a QR code this size.");
  }

  const capacity = dataCapacity(version) * 8;
  const stream = bitStream();
  stream.push(0b0100, 4); // byte mode
  stream.push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) stream.push(b, 8);

  // terminator, then pad to a whole byte, then the standard alternating pad
  stream.push(0, Math.min(4, capacity - stream.bits.length));
  while (stream.bits.length % 8) stream.bits.push(0);

  const codewords = [];
  for (let i = 0; i < stream.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | stream.bits[i + j];
    codewords.push(byte);
  }
  const pads = [0xec, 0x11];
  while (codewords.length < dataCapacity(version)) {
    codewords.push(pads[(codewords.length - stream.bits.length / 8) % 2]);
  }

  return { version, codewords };
}

/* Blocks are interleaved rather than concatenated, so a scratch across the
   code damages a little of every block instead of destroying one entirely. */
function interleave(version, codewords) {
  const [ecPerBlock, groups] = EC_M[version];
  const blocks = [];
  let at = 0;
  for (const [count, each] of groups) {
    for (let i = 0; i < count; i += 1) {
      const data = codewords.slice(at, at + each);
      at += each;
      blocks.push({ data, ec: ecCodewords(data, ecPerBlock) });
    }
  }

  const out = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i += 1) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const b of blocks) out.push(b.ec[i]);
  }
  return out;
}

/* ------------------------------- the grid ------------------------------- */

function blankGrid(size) {
  return {
    // null means "not yet set", so function modules can be told from data
    cells: Array.from({ length: size }, () => new Array(size).fill(null)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
    size,
  };
}

function setFunction(grid, x, y, dark) {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return;
  grid.cells[y][x] = dark;
  grid.reserved[y][x] = true;
}

function placeFinder(grid, x, y) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const inner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      setFunction(grid, x + dx, y + dy, inside && (ring || inner));
    }
  }
}

function placeAlignment(grid, version) {
  const centres = ALIGN[version];
  const last = centres.length - 1;
  for (let iy = 0; iy <= last; iy += 1) {
    for (let ix = 0; ix <= last; ix += 1) {
      const cx = centres[ix];
      const cy = centres[iy];
      // Only the three finder corners are skipped. Testing "is this cell
      // already reserved" instead looks equivalent and is not: from version 7
      // the middle centres sit on the timing row, so that test silently drops
      // real alignment patterns and nothing above version 6 scans.
      const corner =
        (ix === 0 && iy === 0) || (ix === last && iy === 0) || (ix === 0 && iy === last);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const edge = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(grid, cx + dx, cy + dy, edge !== 1);
        }
      }
    }
  }
}

/* BCH(15,5) with the format generator, then the fixed XOR mask so an
   all-zero format never reads as a blank code. */
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // 00 is level M
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

/* BCH(18,6). Only versions 7 and up carry it. */
function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | rem;
}

function placeReserved(grid, version) {
  const size = grid.size;
  // format information, written for real once the mask is chosen
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      setFunction(grid, i, 8, false);
      setFunction(grid, 8, i, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setFunction(grid, size - 1 - i, 8, false);
    setFunction(grid, 8, size - 1 - i, false);
  }
  setFunction(grid, 8, size - 8, true); // the module that is always dark

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >> i) & 1) === 1;
      setFunction(grid, Math.floor(i / 3), size - 11 + (i % 3), bit);
      setFunction(grid, size - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }
}

function writeFormat(grid, mask) {
  const size = grid.size;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const bit = ((bits >> i) & 1) === 1;
    // the copy beside the top-left finder
    if (i < 6) setFunction(grid, 8, i, bit);
    else if (i === 6) setFunction(grid, 8, 7, bit);
    else if (i === 7) setFunction(grid, 8, 8, bit);
    else if (i === 8) setFunction(grid, 7, 8, bit);
    else setFunction(grid, 14 - i, 8, bit);
    // and the duplicate split across the other two corners
    if (i < 8) setFunction(grid, size - 1 - i, 8, bit);
    else setFunction(grid, 8, size - 15 + i, bit);
  }
}

/* Data snakes up and down in two-column strips from the bottom right,
   stepping over anything already claimed by a function pattern. */
function placeData(grid, codewords) {
  const size = grid.size;
  let bitIndex = 0;
  const nextBit = () => {
    if (bitIndex >= codewords.length * 8) return false;
    const bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
    bitIndex += 1;
    return bit === 1;
  };

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    // column 6 is the vertical timing pattern, so the strips shift past it
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (grid.reserved[y][x]) continue;
        grid.cells[y][x] = nextBit();
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/* The four penalty rules from the spec. A lower score scans more reliably,
   mostly by avoiding runs and blocks that a decoder could mistake for a
   finder pattern. */
function penalty(grid) {
  const size = grid.size;
  const at = (x, y) => grid.cells[y][x] === true;
  let score = 0;

  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const prev = horizontal ? at(j - 1, i) : at(i, j - 1);
        const curr = horizontal ? at(j, i) : at(i, j);
        if (curr === prev) {
          run += 1;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) score += 3;
    }
  }

  const bad = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= size - 11; j += 1) {
      for (const pattern of bad) {
        let rowHit = true;
        let colHit = true;
        for (let k = 0; k < 11; k += 1) {
          if (at(j + k, i) !== pattern[k]) rowHit = false;
          if (at(i, j + k) !== pattern[k]) colHit = false;
        }
        if (rowHit) score += 40;
        if (colHit) score += 40;
      }
    }
  }

  let dark = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (at(x, y)) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ------------------------------- public -------------------------------- */

/* Returns a square array of booleans, true meaning a dark module. */
export function qrMatrix(text) {
  const { version, codewords } = encodeData(String(text));
  const interleaved = interleave(version, codewords);
  const size = version * 4 + 17;

  const grid = blankGrid(size);
  placeFinder(grid, 0, 0);
  placeFinder(grid, size - 7, 0);
  placeFinder(grid, 0, size - 7);
  for (let i = 8; i < size - 8; i += 1) {
    setFunction(grid, i, 6, i % 2 === 0);
    setFunction(grid, 6, i, i % 2 === 0);
  }
  placeAlignment(grid, version);
  placeReserved(grid, version);
  placeData(grid, interleaved);

  // every mask is tried because the winner depends entirely on the payload
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const trial = {
      size,
      reserved: grid.reserved,
      cells: grid.cells.map((row, y) =>
        row.map((cell, x) => (grid.reserved[y][x] ? cell : cell !== MASKS[mask](x, y)))
      ),
    };
    writeFormat(trial, mask);
    const score = penalty(trial);
    if (score < bestScore) {
      bestScore = score;
      best = trial;
    }
  }

  return best.cells.map((row) => row.map((cell) => cell === true));
}

/* An SVG string, ready to drop into innerHTML.

   Always dark on white, never themed. An inverted QR code is legal but many
   phone cameras will not read one, and a code that does not scan is worse
   than a code that clashes with dark mode. */
export function qrSvg(text, { quiet = 4, label = "QR code" } = {}) {
  const cells = qrMatrix(text);
  const size = cells.length + quiet * 2;

  let path = "";
  cells.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%"
    shape-rendering="crispEdges" role="img" aria-label="${label}" style="display:block;max-width:280px;margin:0 auto">
    <rect width="${size}" height="${size}" fill="#fff"/>
    <path d="${path}" fill="#000"/></svg>`;
}
