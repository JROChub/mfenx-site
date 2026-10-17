// Blind, keyed, resize- and recompression-robust image watermark.
//
// Method: the luminance plane is resampled to a fixed 256×256 analysis grid, so the mark is
// invariant to scaling. The grid is split into 8×8 blocks and each block is transformed with a
// 2-D DCT. A keyed PRNG assigns every block one payload bit and a ±1 chip; the bit is written by
// quantisation-index modulation of the (2,1)/(1,2) mid-frequency coefficient pair, which survives
// JPEG quantisation at quality ≥ ~50, downscaling to ~40 %, noise, brightness and colour changes. The difference image is upsampled back to
// full resolution and added to the original luminance, so the visible change is a faint, smooth
// texture (PSNR typically 43–46 dB at strength 1). The detector repeats the analysis and majority-votes each bit
// across its ~21 blocks, then checks an 8-bit CRC. Payload: 40-bit identifier + 8-bit CRC = 48 bits.
//
// Known limits (documented honestly in the UI): heavy cropping, rotation and strong geometric
// warps defeat this mark. Recompression, resizing, colour grading, format conversion and
// screenshots generally do not.

import { prng, sha256 } from "./bytes.mjs";

export const GRID = 256;
const BLOCK = 8;
const NBLOCKS = (GRID / BLOCK) ** 2; // 1024
export const PAYLOAD_BITS = 48;
const STEP_DEFAULT = 60; // QIM step on the orthonormal-DCT scale; ≈44 dB PSNR at strength 1, survives ≥0.4× downscale + noise
const PAIR = [17, 10]; // (2,1) and (1,2) // QIM step on DCT coefficient scale (0..255 luminance input)

// ── DCT helpers (8×8, separable, orthonormal) ──
const C = (() => { const c = []; for (let u = 0; u < BLOCK; u++) { c[u] = []; for (let x = 0; x < BLOCK; x++) c[u][x] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2; } return c; })();
function dct8(block, out) {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += C[u][x] * block[y * 8 + x]; tmp[y * 8 + u] = s; }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += C[v][y] * tmp[y * 8 + u]; out[v * 8 + u] = s; }
}
function idct8(coef, out) {
  const tmp = new Float64Array(64);
  for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += C[u][x] * coef[v * 8 + u]; tmp[v * 8 + x] = s; }
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let s = 0; for (let v = 0; v < 8; v++) s += C[v][y] * tmp[v * 8 + x]; out[y * 8 + x] = s; }
}

// ── resampling ──
function luminance(img) { // RGBA → Float32 Y
  const { width: w, height: h, data } = img;
  const Y = new Float32Array(w * h);
  for (let i = 0, p = 0; i < Y.length; i++, p += 4) Y[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  return Y;
}
function resample(src, sw, sh, dw, dh) { // area-averaging downsample / bilinear upsample
  const out = new Float32Array(dw * dh);
  const sx = sw / dw, sy = sh / dh;
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < dh; y++) { const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < dw; x++) { const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let s = 0, n = 0; for (let yy = y0; yy < y1 && yy < sh; yy++) for (let xx = x0; xx < x1 && xx < sw; xx++) { s += src[yy * sw + xx]; n++; }
        out[y * dw + x] = n ? s / n : 0; } }
    return out;
  }
  for (let y = 0; y < dh; y++) { const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5)); const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < dw; x++) { const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5)); const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
      out[y * dw + x] = (1 - wy) * ((1 - wx) * src[y0 * sw + x0] + wx * src[y0 * sw + x1]) + wy * ((1 - wx) * src[y1 * sw + x0] + wx * src[y1 * sw + x1]); } }
  return out;
}

// ── payload ──
export function crc8(bytes) { let c = 0; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; } return c; }
export function payloadFromId(id40) { // id40: Uint8Array(5)
  if (id40.length !== 5) throw new Error("payload id must be 5 bytes");
  const bits = [];
  for (const b of [...id40, crc8(id40)]) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  return bits;
}
export function idFromPayload(bits) {
  const bytes = new Uint8Array(6);
  for (let i = 0; i < 48; i++) bytes[i >> 3] |= bits[i] << (7 - (i & 7));
  return crc8(bytes.subarray(0, 5)) === bytes[5] ? bytes.subarray(0, 5) : null;
}

async function plan(key) { // which block carries which bit, with which chip sign
  const seed = await sha256(new TextEncoder().encode("tweek-wm-v1:" + key));
  const r = prng(seed.subarray(0, 16));
  const order = r.shuffle(Array.from({ length: NBLOCKS }, (_, i) => i));
  const assign = new Int16Array(NBLOCKS), chip = new Int8Array(NBLOCKS);
  for (let i = 0; i < NBLOCKS; i++) { assign[order[i]] = i % PAYLOAD_BITS; chip[order[i]] = r.sign(); }
  return { assign, chip };
}

/**
 * Embed. img = {width,height,data:Uint8ClampedArray|Uint8Array RGBA}. Mutates a copy and returns it.
 * strength ∈ [0.5, 2]: scales the QIM step (1 ≈ invisible on photographs, 1.6 for flat graphics).
 */
export async function embedImage(img, id40, key, { strength = 1, pair = PAIR, baseStep = STEP_DEFAULT } = {}) {
  const { width: w, height: h } = img;
  if (w < 32 || h < 32) throw new Error("image too small to watermark (min 32×32)");
  const step = baseStep * strength; const [P, Q] = pair;
  const bits = payloadFromId(id40);
  const { assign, chip } = await plan(key);
  const Y = luminance(img);
  const g = resample(Y, w, h, GRID, GRID);
  const delta = new Float32Array(GRID * GRID);
  const blk = new Float64Array(64), co = new Float64Array(64), rec = new Float64Array(64);
  for (let by = 0, bi = 0; by < GRID; by += BLOCK) for (let bx = 0; bx < GRID; bx += BLOCK, bi++) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = g[(by + y) * GRID + bx + x];
    dct8(blk, co);
    const bit = bits[assign[bi]] ^ (chip[bi] < 0 ? 1 : 0);
    // QIM on the (2,1)-(1,2) difference feature (indices 2*8+1 and 1*8+2)
    const a = co[P], b = co[Q];
    const f = a - b;
    const q = Math.round((f - (bit ? step / 2 : 0)) / step) * step + (bit ? step / 2 : 0);
    const d = (q - f) / 2;
    co[P] = a + d; co[Q] = b - d;
    idct8(co, rec);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) delta[(by + y) * GRID + bx + x] = rec[y * 8 + x] - blk[y * 8 + x];
  }
  const up = resample(delta, GRID, GRID, w, h);
  const out = { width: w, height: h, data: new Uint8ClampedArray(img.data) };
  for (let i = 0, p = 0; i < up.length; i++, p += 4) {
    const d = up[i];
    if (d === 0) continue;
    out.data[p] = out.data[p] + d; out.data[p + 1] = out.data[p + 1] + d; out.data[p + 2] = out.data[p + 2] + d;
  }
  return out;
}

/** Detect. Returns { id: Uint8Array(5)|null, confidence: 0..1, bits } */
export async function detectImage(img, key, { strength = 1, pair = PAIR, baseStep = STEP_DEFAULT } = {}) {
  const { width: w, height: h } = img;
  const step = baseStep * strength; const [P, Q] = pair;
  const { assign, chip } = await plan(key);
  const Y = luminance(img);
  const g = resample(Y, w, h, GRID, GRID);
  const votes = new Float64Array(PAYLOAD_BITS);
  const blk = new Float64Array(64), co = new Float64Array(64);
  for (let by = 0, bi = 0; by < GRID; by += BLOCK) for (let bx = 0; bx < GRID; bx += BLOCK, bi++) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = g[(by + y) * GRID + bx + x];
    dct8(blk, co);
    const f = co[P] - co[Q];
    const d0 = Math.abs(f - Math.round(f / step) * step);
    const d1 = Math.abs(f - (Math.round((f - step / 2) / step) * step + step / 2));
    let soft = (d0 - d1) / (step / 2); // >0 → bit 1 likely
    if (chip[bi] < 0) soft = -soft;
    votes[assign[bi]] += soft;
  }
  const bits = Array.from(votes, (v) => (v > 0 ? 1 : 0));
  const id = idFromPayload(bits);
  const margin = votes.reduce((s, v) => s + Math.abs(v), 0) / (PAYLOAD_BITS * (NBLOCKS / PAYLOAD_BITS));
  return { id, bits, confidence: Math.max(0, Math.min(1, margin)) };
}

export function psnr(a, b) {
  let se = 0, n = 0;
  for (let i = 0; i < a.data.length; i++) if ((i & 3) !== 3) { const d = a.data[i] - b.data[i]; se += d * d; n++; }
  return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / n));
}
