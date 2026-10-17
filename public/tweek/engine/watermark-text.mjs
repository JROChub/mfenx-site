// Text and source-code watermarking.
//
// 1) Canary: a unique, pronounceable, never-before-seen token (e.g. "velmorith-quandrex-7f3a") that is
//    placed in a comment / footer. If a model later reproduces it, the training-data provenance is
//    established. The canary is also recorded in the signed manifest.
// 2) Zero-width fingerprint: the 40-bit identifier is encoded with four zero-width code points
//    (2 bits/char) and woven into natural whitespace — after spaces in prose, or inside the provenance
//    comment for code (never inside code tokens, so compilers and linters are unaffected). Repeated
//    across the document so partial copies still carry it. Survives copy-paste, most CMSs and
//    plain-text conversion; defeated by deliberate Unicode normalisation.

import { prng, sha256 } from "./bytes.mjs";
import { crc8 } from "./watermark-image.mjs";

const ZW = ["​", "‌", "‍", "⁠"]; // ZWSP, ZWNJ, ZWJ, WJ
const ZW_SET = new Set(ZW);
const START = "﻿"; // BOM as a start sentinel inside the text (zero-width in rendering)

const SYLL = ["ba", "ce", "dri", "fa", "go", "hu", "ji", "ka", "lo", "mi", "na", "or", "pe", "qua", "ri", "so", "tu", "ve", "wo", "xi", "ya", "zo", "th", "el", "um", "an", "ith", "ex", "ol", "ur"];
export async function makeCanary(id40) {
  const h = await sha256(id40);
  const r = prng(h.subarray(0, 16));
  const word = (n) => { let s = ""; for (let i = 0; i < n; i++) s += SYLL[r.int(SYLL.length)]; return s; };
  const hex = Array.from(id40.subarray(0, 2), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${word(3)}-${word(2)}-${hex}`;
}

export function encodeZw(id40) {
  const bytes = [...id40, crc8(id40)];
  let s = START;
  for (const b of bytes) for (let i = 6; i >= 0; i -= 2) s += ZW[(b >> i) & 3];
  return s; // 1 + 24 chars
}
export function decodeZwAll(text) {
  const found = [];
  const re = new RegExp(`${START}([${ZW.join("")}]{24})`, "g");
  let m;
  while ((m = re.exec(text))) {
    const bytes = new Uint8Array(6);
    for (let i = 0; i < 24; i++) bytes[i >> 2] |= ZW.indexOf(m[1][i]) << (6 - 2 * (i & 3));
    if (crc8(bytes.subarray(0, 5)) === bytes[5]) found.push(bytes.subarray(0, 5));
  }
  return found;
}
export function stripZw(text) { return text.replace(new RegExp(`[${ZW.join("")}${START}]`, "g"), ""); }
export function hasZw(text) { for (const ch of text) if (ZW_SET.has(ch) || ch === START) return true; return false; }

/** Weave the zero-width code into prose: after every ~N-th space (N scales with length), and at the end. */
export function weaveProse(text, id40, { every = 40 } = {}) {
  const code = encodeZw(id40);
  const clean = stripZw(text);
  let out = "", count = 0, inserted = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    out += ch;
    if (ch === " " && clean[i + 1] && clean[i + 1] !== " ") { if (++count % every === 0) { out += code; inserted++; } }
  }
  if (inserted === 0 || !out.endsWith(code)) out += code;
  return out;
}
export function countMarks(text, id40) {
  return decodeZwAll(text).filter((f) => f.every((b, i) => b === id40[i])).length;
}
