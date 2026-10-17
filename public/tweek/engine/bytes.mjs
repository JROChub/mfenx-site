// tweek-ing engine — byte utilities. Dependency-free; runs in browsers and Node 20+.

const subtle = globalThis.crypto?.subtle;
if (!subtle) throw new Error("Web Crypto is required");

export const te = new TextEncoder();
export const td = new TextDecoder("utf-8", { fatal: false });

export const utf8 = (s) => te.encode(s);
export const fromUtf8 = (b) => td.decode(b);

export function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p instanceof Uint8Array ? p : new Uint8Array(p), o);
    o += p.byteLength;
  }
  return out;
}

export function equal(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function indexOf(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function lastIndexOf(hay, needle) {
  outer: for (let i = hay.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(h) {
  h = h.trim().replace(/^0x/, "");
  if (h.length % 2 || /[^0-9a-fA-F]/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function b64(b, url = false) {
  let s = "";
  if (typeof Buffer !== "undefined") s = Buffer.from(b).toString("base64");
  else {
    let bin = "";
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    s = btoa(bin);
  }
  return url ? s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : s;
}
export function fromB64(s) {
  s = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Crockford-free base32 (RFC 4648, lowercase, no padding) for human-readable identifiers.
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function b32(b) {
  let bits = 0, val = 0, out = "";
  for (const x of b) {
    val = (val << 8) | x; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export async function sha256(data) {
  return new Uint8Array(await subtle.digest("SHA-256", data));
}
export const sha256hex = async (data) => hex(await sha256(data));

export function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }
export function u32be(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
export function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
export function u24le(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }
export function putU16be(n) { return new Uint8Array([(n >>> 8) & 255, n & 255]); }
export function putU32be(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
export function putU32le(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
export function putU24le(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]); }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(...parts) {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

// Deterministic keyed PRNG (xoshiro128**) seeded from a 16-byte seed. Used to spread watermark bits.
export function prng(seed16) {
  let s = [u32le(seed16, 0) || 1, u32le(seed16, 4) || 2, u32le(seed16, 8) || 3, u32le(seed16, 12) || 4];
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return {
    next() {
      const result = (rotl(Math.imul(s[1], 5) >>> 0, 7) * 9) >>> 0;
      const t = (s[1] << 9) >>> 0;
      s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
      s[2] ^= t; s[3] = rotl(s[3], 11);
      return result;
    },
    float() { return this.next() / 4294967296; },
    int(n) { return this.next() % n; },
    sign() { return this.next() & 1 ? 1 : -1; },
    shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = this.int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
  };
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
