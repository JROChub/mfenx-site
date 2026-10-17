// Container writers: embed / extract / strip an XMP packet in common file formats.
// Design rule: strip(embed(x)) is a canonical form, and strip is idempotent on it, so
// contentDigest = sha256(strip(file)) can be recomputed by anyone from the protected file alone.

import { concat, equal, indexOf, utf8, fromUtf8, u16be, u32be, u32le, u24le, putU16be, putU32be, putU32le, putU24le, crc32, lastIndexOf } from "./bytes.mjs";
import { isTweekXmp, NS } from "./xmp.mjs";

const XMP_JPEG_ID = utf8("http://ns.adobe.com/xap/1.0/\0");
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_XMP_KEY = utf8("XML:com.adobe.xmp");
const MP4_XMP_UUID = new Uint8Array([0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac]);
const PLACEHOLDER = `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:tweek="${NS.tweek}"/>`;

export const TEXT_EXT = {
  js: "//", mjs: "//", cjs: "//", ts: "//", tsx: "//", jsx: "//", c: "//", h: "//", cc: "//", cpp: "//", hpp: "//", cs: "//", java: "//", kt: "//", kts: "//", swift: "//", go: "//", rs: "//", scala: "//", dart: "//", php: "//", zig: "//", sol: "//", m: "//", mm: "//", v: "//", sv: "//", groovy: "//",
  py: "#", rb: "#", sh: "#", bash: "#", zsh: "#", fish: "#", pl: "#", r: "#", yaml: "#", yml: "#", toml: "#", ini: "#", cfg: "#", conf: "#", dockerfile: "#", makefile: "#", mk: "#", nim: "#", jl: "#", ex: "#", exs: "#", tf: "#", ps1: "#", cmake: "#", nix: "#", gitignore: "#", env: "#",
  sql: "--", lua: "--", hs: "--", elm: "--", ada: "--", vhd: "--",
  html: "<!--", htm: "<!--", xml: "<!--", svg: "<!--", xhtml: "<!--", md: "<!--", markdown: "<!--", vue: "<!--", svelte: "<!--",
  css: "/*", scss: "/*", less: "/*",
  tex: "%", bib: "%", erl: "%", pro: "%",
  asm: ";", s: ";", lisp: ";", clj: ";", cljs: ";", el: ";", scm: ";", rkt: ";",
  txt: "", text: "", rst: "", adoc: "", csv: "", tsv: "",
};

export function detectType(bytes, name = "") {
  const b = bytes;
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "jpeg", mime: "image/jpeg", ext: "jpg" };
  if (b.length > 8 && equal(b.subarray(0, 8), PNG_SIG)) return { kind: "png", mime: "image/png", ext: "png" };
  if (b.length > 12 && tag(b, 0) === "RIFF" && tag(b, 8) === "WEBP") return { kind: "webp", mime: "image/webp", ext: "webp" };
  if (b.length > 12 && tag(b, 0) === "RIFF" && tag(b, 8) === "WAVE") return { kind: "wav", mime: "audio/wav", ext: "wav" };
  if (b.length > 12 && tag(b, 4) === "ftyp") return { kind: "mp4", mime: ext === "mov" ? "video/quicktime" : ext === "m4a" ? "audio/mp4" : "video/mp4", ext: ext || "mp4" };
  if (b.length > 5 && fromUtf8(b.subarray(0, 5)) === "%PDF-") return { kind: "pdf", mime: "application/pdf", ext: "pdf" };
  if (b.length > 2 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { kind: "gif", mime: "image/gif", ext: "gif", unsupported: "GIF has no metadata container; export as PNG or WebP, or use the sidecar manifest." };
  if (ext in TEXT_EXT || looksLikeText(b)) return { kind: "text", mime: ext === "md" ? "text/markdown" : ext === "html" ? "text/html" : "text/plain", ext: ext || "txt", comment: TEXT_EXT[ext] ?? "" };
  return { kind: "binary", mime: "application/octet-stream", ext: ext || "bin", unsupported: "No in-file metadata container is known for this type; the signed sidecar manifest still binds its digest." };
}

function tag(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
function looksLikeText(b) {
  const n = Math.min(b.length, 4096);
  if (n === 0) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0) return false; if (c < 7 || (c > 13 && c < 32 && c !== 27)) bad++; }
  return bad / n < 0.02;
}

// ───────────────────────────────── JPEG ─────────────────────────────────
function jpegSegments(b) {
  const segs = [];
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) throw new Error("JPEG: marker expected");
    const marker = b[o + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { segs.push({ marker, start: o, end: o + 2 }); o += 2; continue; }
    const len = u16be(b, o + 2);
    segs.push({ marker, start: o, end: o + 2 + len, dataStart: o + 4 });
    o += 2 + len;
    if (marker === 0xda) break; // SOS: rest is entropy-coded data up to EOI
  }
  return { segs, rest: o };
}
function isXmpApp1(b, s) { return s.marker === 0xe1 && s.dataStart && b.length >= s.dataStart + XMP_JPEG_ID.length && equal(b.subarray(s.dataStart, s.dataStart + XMP_JPEG_ID.length), XMP_JPEG_ID); }

function jpegExtract(b) {
  const { segs } = jpegSegments(b);
  for (const s of segs) if (isXmpApp1(b, s)) {
    const x = fromUtf8(b.subarray(s.dataStart + XMP_JPEG_ID.length, s.end));
    if (isTweekXmp(x)) return x;
  }
  return null;
}
function jpegStrip(b) {
  const { segs } = jpegSegments(b);
  const keep = [b.subarray(0, 2)];
  let cursor = 2;
  for (const s of segs) {
    if (s.start < 2) continue;
    if (isXmpApp1(b, s) && isTweekXmp(fromUtf8(b.subarray(s.dataStart + XMP_JPEG_ID.length, s.end)))) { keep.push(b.subarray(cursor, s.start)); cursor = s.end; }
  }
  keep.push(b.subarray(cursor));
  return concat(...keep);
}
function jpegEmbed(b0, xmp) {
  const b = jpegStrip(b0);
  const payload = concat(XMP_JPEG_ID, utf8(xmp));
  if (payload.length + 2 > 65535) throw new Error("XMP packet too large for a JPEG APP1 segment");
  const seg = concat(new Uint8Array([0xff, 0xe1]), putU16be(payload.length + 2), payload);
  const { segs } = jpegSegments(b);
  // Insert after APP0 (JFIF) and Exif APP1 so Exif stays first, as readers expect.
  let at = 2;
  for (const s of segs) {
    if (s.marker === 0xe0 || (s.marker === 0xe1 && !isXmpApp1(b, s))) at = s.end; else if (s.start >= 2) break;
  }
  return concat(b.subarray(0, at), seg, b.subarray(at));
}

// ───────────────────────────────── PNG ─────────────────────────────────
function pngChunks(b) {
  const out = [];
  let o = 8;
  while (o + 8 <= b.length) {
    const len = u32be(b, o);
    const type = tag(b, o + 4);
    out.push({ type, start: o, dataStart: o + 8, dataEnd: o + 8 + len, end: o + 12 + len });
    o += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}
function pngIsTweekXmp(b, c) {
  if (c.type !== "iTXt") return false;
  const d = b.subarray(c.dataStart, c.dataEnd);
  if (!equal(d.subarray(0, PNG_XMP_KEY.length), PNG_XMP_KEY) || d[PNG_XMP_KEY.length] !== 0) return false;
  return isTweekXmp(fromUtf8(pngITxtText(d)));
}
function pngITxtText(d) {
  let o = PNG_XMP_KEY.length + 1; // keyword + NUL
  const compressed = d[o]; o += 2; // compression flag + method
  while (d[o] !== 0) o++; o++; // language tag
  while (d[o] !== 0) o++; o++; // translated keyword
  if (compressed) return new Uint8Array(); // tweek never writes compressed packets
  return d.subarray(o);
}
function pngExtract(b) {
  for (const c of pngChunks(b)) if (pngIsTweekXmp(b, c)) return fromUtf8(pngITxtText(b.subarray(c.dataStart, c.dataEnd)));
  return null;
}
function pngStrip(b) {
  const parts = [b.subarray(0, 8)];
  let cursor = 8;
  for (const c of pngChunks(b)) if (pngIsTweekXmp(b, c)) { parts.push(b.subarray(cursor, c.start)); cursor = c.end; }
  parts.push(b.subarray(cursor));
  return concat(...parts);
}
function pngEmbed(b0, xmp) {
  const b = pngStrip(b0);
  const data = concat(PNG_XMP_KEY, new Uint8Array([0, 0, 0, 0, 0]), utf8(xmp));
  const type = utf8("iTXt");
  const chunk = concat(putU32be(data.length), type, data, putU32be(crc32(type, data)));
  const ihdr = pngChunks(b)[0];
  if (!ihdr || ihdr.type !== "IHDR") throw new Error("PNG: IHDR missing");
  return concat(b.subarray(0, ihdr.end), chunk, b.subarray(ihdr.end));
}

// ───────────────────────────────── RIFF (WebP, WAV) ─────────────────────────────────
function riffChunks(b) {
  const out = [];
  let o = 12;
  const end = Math.min(b.length, 8 + u32le(b, 4));
  while (o + 8 <= end) {
    const size = u32le(b, o + 4);
    out.push({ type: tag(b, o), start: o, dataStart: o + 8, dataEnd: o + 8 + size, end: o + 8 + size + (size & 1) });
    o += 8 + size + (size & 1);
  }
  return out;
}
function riffChunk(type, data) {
  const pad = data.length & 1 ? new Uint8Array([0]) : new Uint8Array();
  return concat(utf8(type), putU32le(data.length), data, pad);
}
function riffAssemble(form, chunks) {
  const body = concat(...chunks);
  return concat(utf8("RIFF"), putU32le(body.length + 4), utf8(form), body);
}
function riffReplace(b, form, filter, append) {
  const kept = [];
  for (const c of riffChunks(b)) {
    const data = b.subarray(c.dataStart, c.dataEnd);
    const k = filter(c.type, data);
    if (k === false) continue;
    kept.push(k instanceof Uint8Array ? riffChunk(c.type, k) : b.subarray(c.start, c.end));
  }
  for (const [t, d] of append) kept.push(riffChunk(t, d));
  return riffAssemble(form, kept);
}

function webpExtract(b) {
  for (const c of riffChunks(b)) if (c.type === "XMP ") { const x = fromUtf8(b.subarray(c.dataStart, c.dataEnd)); if (isTweekXmp(x)) return x; }
  return null;
}
function webpStrip(b) {
  const had = webpExtract(b) !== null;
  if (!had) return b;
  return riffReplace(b, "WEBP", (t, d) => {
    if (t === "XMP " && isTweekXmp(fromUtf8(d))) return false;
    if (t === "VP8X") { const d2 = new Uint8Array(d); d2[0] &= ~0x04; return d2; }
    return true;
  }, []);
}
function webpDims(b) {
  for (const c of riffChunks(b)) {
    const d = b.subarray(c.dataStart, c.dataEnd);
    if (c.type === "VP8 ") return { w: (d[6] | (d[7] << 8)) & 0x3fff, h: (d[8] | (d[9] << 8)) & 0x3fff, alpha: false };
    if (c.type === "VP8L") { const bits = u32le(d, 1); return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, alpha: !!((bits >>> 28) & 1) }; }
    if (c.type === "VP8X") return { w: u24le(d, 4) + 1, h: u24le(d, 7) + 1, alpha: !!(d[0] & 0x10) };
  }
  throw new Error("WebP: no bitstream chunk");
}
function webpEmbed(b0, xmp) {
  const b = webpStrip(b0);
  const chunks = riffChunks(b);
  const hasVp8x = chunks.some((c) => c.type === "VP8X");
  const payload = utf8(xmp);
  if (hasVp8x) return riffReplace(b, "WEBP", (t, d) => (t === "VP8X" ? (() => { const d2 = new Uint8Array(d); d2[0] |= 0x04; return d2; })() : t === "XMP " ? false : true), [["XMP ", payload]]);
  const { w, h, alpha } = webpDims(b);
  const vp8x = concat(new Uint8Array([0x04 | (alpha ? 0x10 : 0), 0, 0, 0]), putU24le(w - 1), putU24le(h - 1));
  const kept = [riffChunk("VP8X", vp8x)];
  for (const c of chunks) kept.push(b.subarray(c.start, c.end));
  kept.push(riffChunk("XMP ", payload));
  return riffAssemble("WEBP", kept);
}

function wavExtract(b) {
  for (const c of riffChunks(b)) if (c.type === "_PMX") { const x = fromUtf8(b.subarray(c.dataStart, c.dataEnd)); if (isTweekXmp(x)) return x; }
  return null;
}
function wavStrip(b) {
  if (wavExtract(b) === null) return b;
  return riffReplace(b, "WAVE", (t, d) => !(t === "_PMX" && isTweekXmp(fromUtf8(d))) && !(t === "LIST" && tag(d, 0) === "INFO" && indexOf(d, utf8("tweek:")) >= 0), []);
}
function wavEmbed(b0, xmp, info = {}) {
  const b = wavStrip(b0);
  const sub = [];
  const add = (id, text) => { const d = concat(utf8(text), new Uint8Array([0])); sub.push(riffChunk(id, d)); };
  if (info.copyright) add("ICOP", info.copyright);
  add("ICMT", `tweek:${info.id || ""} ${info.policy || ""} verify at https://mfenx.com/tweek/verify/`);
  if (info.artist) add("IART", info.artist);
  const list = concat(utf8("INFO"), ...sub);
  return riffReplace(b, "WAVE", () => true, [["_PMX", utf8(xmp)], ["LIST", list]]);
}

// ───────────────────────────────── ISO BMFF (MP4 / MOV / M4A) ─────────────────────────────────
function mp4Boxes(b) {
  const out = [];
  let o = 0;
  while (o + 8 <= b.length) {
    let size = u32be(b, o);
    let hdr = 8;
    if (size === 1) { size = Number((BigInt(u32be(b, o + 8)) << 32n) | BigInt(u32be(b, o + 12))); hdr = 16; }
    else if (size === 0) size = b.length - o;
    if (size < hdr) break;
    out.push({ type: tag(b, o + 4), start: o, hdr, end: Math.min(o + size, b.length), openEnded: u32be(b, o) === 0 });
    o += size;
  }
  return out;
}
function mp4IsTweek(b, box) {
  if (box.type !== "uuid") return false;
  const u = b.subarray(box.start + box.hdr, box.start + box.hdr + 16);
  return equal(u, MP4_XMP_UUID) && isTweekXmp(fromUtf8(b.subarray(box.start + box.hdr + 16, box.end)));
}
function mp4Extract(b) {
  for (const box of mp4Boxes(b)) if (mp4IsTweek(b, box)) return fromUtf8(b.subarray(box.start + box.hdr + 16, box.end));
  return null;
}
function mp4Strip(b) {
  const parts = [];
  let cursor = 0;
  for (const box of mp4Boxes(b)) if (mp4IsTweek(b, box)) { parts.push(b.subarray(cursor, box.start)); cursor = box.end; }
  parts.push(b.subarray(cursor));
  return concat(...parts);
}
function mp4Embed(b0, xmp) {
  let b = mp4Strip(b0);
  const boxes = mp4Boxes(b);
  const last = boxes[boxes.length - 1];
  if (last && last.openEnded) { // close an open-ended final box so our appended box is not swallowed
    const len = last.end - last.start;
    if (len > 0xffffffff) throw new Error("MP4: open-ended box too large");
    b = concat(b.subarray(0, last.start), putU32be(len), b.subarray(last.start + 4));
  }
  const payload = concat(MP4_XMP_UUID, utf8(xmp));
  const box = concat(putU32be(8 + payload.length), utf8("uuid"), payload);
  return concat(b, box);
}

// ───────────────────────────────── PDF ─────────────────────────────────
const PDF_MARK = "%%tweek-ing-update-begin";
async function inflate(data) {
  const ds = new DecompressionStream("deflate");
  const w = ds.writable.getWriter();
  w.write(data); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
const latin1 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
function pdfStrip(b) {
  const i = lastIndexOf(b, utf8("\n" + PDF_MARK + "\n"));
  return i < 0 ? b : b.subarray(0, i);
}
function pdfExtract(b) {
  const i = lastIndexOf(b, utf8(PDF_MARK));
  if (i < 0) return null;
  const s = latin1(b.subarray(i));
  const m = /<\?xpacket begin[\s\S]*?<\?xpacket end="w"\?>/.exec(s);
  if (!m) return null;
  const x = fromUtf8(b.subarray(i + m.index, i + m.index + m[0].length));
  return isTweekXmp(x) ? x : null;
}
function balancedDict(s, from) {
  let depth = 0, i = from;
  for (; i < s.length - 1; i++) {
    if (s[i] === "<" && s[i + 1] === "<") { depth++; i++; }
    else if (s[i] === ">" && s[i + 1] === ">") { depth--; i++; if (depth === 0) return s.slice(from, i + 1); }
  }
  throw new Error("PDF: unbalanced dictionary");
}
async function pdfFindObject(b, s, num) {
  const re = new RegExp(`(?:^|[^0-9])${num}\\s+0\\s+obj\\b`, "g");
  let m, last = null;
  while ((m = re.exec(s))) last = m;
  if (last) {
    const at = last.index + last[0].length;
    const dStart = s.indexOf("<<", at);
    return { dict: balancedDict(s, dStart), inStream: false };
  }
  // Compressed object streams
  const osRe = /\/Type\s*\/ObjStm/g;
  while ((m = osRe.exec(s))) {
    const dStart = s.lastIndexOf("<<", m.index);
    let dict;
    try { dict = balancedDict(s, dStart); } catch { continue; }
    const streamAt = s.indexOf("stream", dStart + dict.length);
    if (streamAt < 0) continue;
    let dataAt = streamAt + 6; if (s[dataAt] === "\r") dataAt++; if (s[dataAt] === "\n") dataAt++;
    const lenM = /\/Length\s+(\d+)(?!\s+0\s+R)/.exec(dict); if (!lenM) continue;
    const n = +(/\/N\s+(\d+)/.exec(dict) || [])[1], first = +(/\/First\s+(\d+)/.exec(dict) || [])[1];
    let raw = b.subarray(dataAt, dataAt + +lenM[1]);
    if (/\/Filter\s*\/FlateDecode/.test(dict)) { try { raw = await inflate(raw); } catch { continue; } }
    else if (/\/Filter/.test(dict)) continue;
    const text = latin1(raw);
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n * 2; i += 2) if (header[i] === num) {
      const objStart = first + header[i + 1];
      const d = balancedDict(text, text.indexOf("<<", objStart));
      return { dict: d, inStream: true };
    }
  }
  throw new Error(`PDF: object ${num} not found`);
}
async function pdfEmbed(b0, xmp) {
  const b = pdfStrip(b0);
  const s = latin1(b);
  const sx = s.lastIndexOf("startxref");
  if (sx < 0) throw new Error("PDF: startxref missing");
  const prev = parseInt(s.slice(sx + 9).trim(), 10);
  if (!Number.isFinite(prev) || prev >= b.length) throw new Error("PDF: bad startxref");
  // Trailer dictionary: classic table or cross-reference stream.
  let trailer, xrefStream = false;
  if (s.startsWith("xref", prev)) {
    const t = s.indexOf("trailer", prev);
    trailer = balancedDict(s, s.indexOf("<<", t));
  } else {
    xrefStream = true;
    trailer = balancedDict(s, s.indexOf("<<", prev));
  }
  if (/\/Encrypt\b/.test(trailer)) throw new Error("PDF is encrypted; the metadata stream would be unreadable. A signed sidecar manifest is produced instead.");
  const root = +(/\/Root\s+(\d+)\s+0\s+R/.exec(trailer) || [])[1];
  const size = +(/\/Size\s+(\d+)/.exec(trailer) || [])[1];
  if (!root || !size) throw new Error("PDF: trailer lacks /Root or /Size");
  const { dict: catalog } = await pdfFindObject(b, s, root);
  const metaNum = size, xrefNum = size + 1;
  let newCatalog = catalog.replace(/\/Metadata\s+\d+\s+\d+\s+R/, "").replace(/>>\s*$/, ` /Metadata ${metaNum} 0 R >>`);
  const xmpBytes = utf8(xmp);
  const idM = /\/ID\s*\[[^\]]*\]/.exec(trailer);
  const infoM = /\/Info\s+\d+\s+0\s+R/.exec(trailer);
  const base = b.length + 1 + PDF_MARK.length + 1; // after "\n%%mark\n"
  const parts = [utf8("\n" + PDF_MARK + "\n")];
  let off = base;
  const offsets = {};
  const push = (str) => { const u = utf8(str); parts.push(u); off += u.length; };
  offsets[root] = off; push(`${root} 0 obj\n${newCatalog}\nendobj\n`);
  offsets[metaNum] = off; push(`${metaNum} 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${xmpBytes.length} >>\nstream\n`);
  parts.push(xmpBytes); off += xmpBytes.length; push(`\nendstream\nendobj\n`);
  const startxref = off;
  const extra = `${infoM ? infoM[0] + " " : ""}${idM ? idM[0] + " " : ""}`;
  if (!xrefStream) {
    push(`xref\n0 1\n0000000000 65535 f \n${root} 1\n${String(offsets[root]).padStart(10, "0")} 00000 n \n${metaNum} 1\n${String(offsets[metaNum]).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${metaNum + 1} /Root ${root} 0 R /Prev ${prev} ${extra}>>\nstartxref\n${startxref}\n%%EOF\n`);
  } else {
    const row = (type, f2, f3) => concat(new Uint8Array([type]), putU32be(f2), putU16be(f3));
    const rows = concat(row(1, offsets[root], 0), row(1, offsets[metaNum], 0), row(1, startxref, 0));
    push(`${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] /Index [${root} 1 ${metaNum} 2] /Root ${root} 0 R /Prev ${prev} ${extra}/Length ${rows.length} >>\nstream\n`);
    parts.push(rows); off += rows.length;
    push(`\nendstream\nendobj\nstartxref\n${startxref}\n%%EOF\n`);
  }
  return concat(b, ...parts);
}

// ───────────────────────────────── Text / source code ─────────────────────────────────
const T_BEGIN = "tweek-ing provenance — do not remove";
const T_END = "end tweek-ing provenance";
const fence = (c) => {
  if (c === "<!--") return { open: (l) => `<!-- ${l} -->`, block: (lines) => lines.map((l) => `<!-- ${l} -->`).join("\n") };
  if (c === "/*") return { block: (lines) => `/*\n${lines.map((l) => ` * ${l}`).join("\n")}\n */` };
  if (c === "") return { block: (lines) => lines.map((l) => `| ${l}`).join("\n") };
  return { block: (lines) => lines.map((l) => `${c} ${l}`).join("\n") };
};

export function textHeaderLines(fields) {
  const lines = [`═══ ${T_BEGIN} ═══`];
  for (const [k, v] of fields) if (v !== undefined && v !== null && v !== "") lines.push(`${k}: ${v}`);
  lines.push(`═══ ${T_END} ═══`);
  return lines;
}
function textBlockRange(lines) {
  let a = -1, z = -1;
  for (let i = 0; i < lines.length; i++) { if (a < 0 && lines[i].includes(T_BEGIN)) a = i; if (a >= 0 && lines[i].includes(T_END)) { z = i; break; } }
  if (a < 0 || z < 0) return null;
  if (a > 0 && lines[a - 1].trim() === "/*") a--;            // block-comment wrapper
  if (z + 1 < lines.length && lines[z + 1].trim() === "*/") z++;
  return [a, z];
}
function textStrip(text) {
  const lines = text.split("\n");
  const r = textBlockRange(lines);
  if (!r) return text;
  const [a, z] = r;
  return [...lines.slice(0, a), ...lines.slice(z + 1)].join("\n");
}
export function textExtractFields(text) {
  const lines = text.split("\n");
  const r = textBlockRange(lines);
  if (!r) return null;
  const out = {};
  for (const raw of lines.slice(r[0], r[1] + 1)) {
    const m = /^\W*?\s*([A-Za-z][A-Za-z0-9-]*):\s(.*?)\s*(?:-->|\*\/)?\s*$/.exec(raw);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function textEmbed(text, comment, fields) {
  const body = textStrip(text);
  const f = fence(comment);
  const block = f.block(textHeaderLines(fields));
  if (body.startsWith("#!")) { // keep shebang first
    const nl = body.indexOf("\n");
    const first = nl < 0 ? body : body.slice(0, nl);
    const rest = nl < 0 ? "" : body.slice(nl + 1);
    return `${first}\n${block}\n${rest}`;
  }
  if (/^<\?xml/.test(body)) {
    const nl = body.indexOf("?>") + 2;
    return `${body.slice(0, nl)}\n${block}\n${body.slice(nl).replace(/^\n/, "")}`;
  }
  return `${block}\n${body}`;
}

// ───────────────────────────────── Dispatcher ─────────────────────────────────
export const containers = {
  jpeg: { embed: jpegEmbed, extract: jpegExtract, strip: jpegStrip },
  png: { embed: pngEmbed, extract: pngExtract, strip: pngStrip },
  webp: { embed: webpEmbed, extract: webpExtract, strip: webpStrip },
  wav: { embed: wavEmbed, extract: wavExtract, strip: wavStrip },
  mp4: { embed: mp4Embed, extract: mp4Extract, strip: mp4Strip },
  pdf: { embed: pdfEmbed, extract: pdfExtract, strip: pdfStrip },
};
export const text = { embed: textEmbed, strip: textStrip, extractFields: textExtractFields };

/** Canonical bytes whose digest is the contentDigest: the file as it will look once the tweek packet is removed. */
export async function canonicalize(bytes, kind) {
  const c = containers[kind];
  if (!c) return bytes;
  return c.strip(await c.embed(bytes, PLACEHOLDER));
}
export async function embed(bytes, kind, xmp, info) { const c = containers[kind]; if (!c) throw new Error("unsupported container"); return c.embed(bytes, xmp, info); }
export function extract(bytes, kind) { const c = containers[kind]; return c ? c.extract(bytes) : null; }
export function strip(bytes, kind) { const c = containers[kind]; return c ? c.strip(bytes) : bytes; }
