// OpenTimestamps client (no dependencies). Submits a SHA-256 digest to public calendar servers,
// assembles a standard .ots proof, parses proofs into a tree, re-serialises them, and upgrades pending
// attestations to Bitcoin attestations once the calendar has anchored them (usually within hours).
// Wire format follows python-opentimestamps (core/serialize.py, core/timestamp.py).

import { concat, hex, fromHex, utf8, fromUtf8, sha256 } from "./bytes.mjs";

export const OTS_MAGIC = new Uint8Array([0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94]);
export const CALENDARS = ["https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org", "https://a.pool.eternitywall.com", "https://ots.btc.catallaxy.com"];
const OP = { append: 0xf0, prepend: 0xf1, reverse: 0xf2, hexlify: 0xf3, sha1: 0x02, ripemd160: 0x03, sha256: 0x08, keccak256: 0x67 };
const ATT_PENDING = "83dfe30d2ef90c8e", ATT_BITCOIN = "0588960d73d71901", ATT_LITECOIN = "06869a0d73d71b45";

export function varuint(n) { const out = []; while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return new Uint8Array(out); }
function readVaruint(b, o) { let n = 0, shift = 1; for (;;) { const x = b[o++]; n += (x & 127) * shift; if (!(x & 128)) break; shift *= 128; } return [n, o]; }
const varbytes = (b) => concat(varuint(b.length), b);

// ── tree model ──  Timestamp = { msg, attestations: [Uint8Array raw (tag‖varbytes payload)], ops: [{op: Uint8Array, ts: Timestamp}] }
function applyOp(tag, arg, msg) {
  switch (tag) {
    case OP.append: return concat(msg, arg);
    case OP.prepend: return concat(arg, msg);
    case OP.reverse: return msg.slice().reverse();
    case OP.hexlify: return utf8(hex(msg));
    case OP.sha256: return sha256Sync(msg);
    default: throw new Error(`unsupported OpenTimestamps op 0x${tag.toString(16)} (use the ots CLI)`);
  }
}
function deserializeTs(b, o, msg) {
  const ts = { msg, attestations: [], ops: [] };
  const one = (o) => {
    const tag = b[o++];
    if (tag === 0x00) { const t = b.subarray(o, o + 8); o += 8; let n; [n, o] = readVaruint(b, o); const payload = b.subarray(o, o + n); o += n; ts.attestations.push(concat(t, varbytes(payload))); return o; }
    let arg = new Uint8Array(0), opBytes;
    if (tag === OP.append || tag === OP.prepend) { let n; [n, o] = readVaruint(b, o); arg = b.subarray(o, o + n); o += n; opBytes = concat(new Uint8Array([tag]), varbytes(arg)); } else opBytes = new Uint8Array([tag]);
    const child = deserializeTs(b, o, applyOp(tag, arg, msg)); ts.ops.push({ op: opBytes, ts: child.ts }); return child.o;
  };
  for (;;) { if (b[o] === 0xff) { o = one(o + 1); continue; } o = one(o); break; }
  return { ts, o };
}
function serializeTs(ts) {
  const parts = [];
  const atts = [...ts.attestations].sort((a, b) => cmp(a, b));
  const ops = [...ts.ops].sort((a, b) => cmp(a.op, b.op));
  if (!atts.length && !ops.length) throw new Error("empty timestamp");
  for (let i = 0; i < atts.length - 1; i++) parts.push(new Uint8Array([0xff, 0x00]), atts[i]);
  if (!ops.length) parts.push(new Uint8Array([0x00]), atts[atts.length - 1]);
  else {
    if (atts.length) parts.push(new Uint8Array([0xff, 0x00]), atts[atts.length - 1]);
    ops.forEach((e, i) => { if (i < ops.length - 1) parts.push(new Uint8Array([0xff])); parts.push(e.op, serializeTs(e.ts)); });
  }
  return concat(...parts);
}
function cmp(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
function mergeInto(dst, src) {
  for (const a of src.attestations) if (!dst.attestations.some((x) => hex(x) === hex(a))) dst.attestations.push(a);
  for (const e of src.ops) { const ex = dst.ops.find((x) => hex(x.op) === hex(e.op)); if (ex) mergeInto(ex.ts, e.ts); else dst.ops.push(e); }
}

export function parseProof(proof) {
  for (let i = 0; i < OTS_MAGIC.length; i++) if (proof[i] !== OTS_MAGIC[i]) throw new Error("not an OpenTimestamps proof");
  let o = OTS_MAGIC.length, v; [v, o] = readVaruint(proof, o); if (v !== 1) throw new Error("unsupported proof version");
  if (proof[o++] !== OP.sha256) throw new Error("expected SHA256 file-hash op");
  const digest = proof.subarray(o, o + 32); o += 32;
  const { ts } = deserializeTs(proof, o, digest);
  return { digest: hex(digest), ts, attestations: collect(ts) };
}
function collect(ts, out = []) {
  for (const a of ts.attestations) {
    const t = hex(a.subarray(0, 8)); let [n, p] = readVaruint(a, 8); const payload = a.subarray(p, p + n);
    if (t === ATT_PENDING) { const [l, q] = readVaruint(payload, 0); out.push({ type: "pending", uri: fromUtf8(payload.subarray(q, q + l)), commitment: hex(ts.msg) }); }
    else if (t === ATT_BITCOIN) out.push({ type: "bitcoin", height: readVaruint(payload, 0)[0], merkleRoot: hex(ts.msg.slice().reverse()) });
    else if (t === ATT_LITECOIN) out.push({ type: "litecoin", height: readVaruint(payload, 0)[0] });
    else out.push({ type: "unknown:" + t });
  }
  for (const e of ts.ops) collect(e.ts, out);
  return out;
}
export function serializeProof(digest32, ts) { return concat(OTS_MAGIC, varuint(1), new Uint8Array([OP.sha256]), digest32, serializeTs(ts)); }

/** Submit a digest to calendars in parallel. Returns {proof|null, calendars:[{url,ok,error}]}. */
export async function stamp(digest32, { calendars = CALENDARS, timeoutMs = 10000, fetchFn = globalThis.fetch } = {}) {
  if (digest32.length !== 32) throw new Error("digest must be 32 bytes");
  const results = await Promise.all(calendars.map(async (url) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchFn(url + "/digest", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/vnd.opentimestamps.v1" }, body: digest32, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = new Uint8Array(await r.arrayBuffer());
      const { ts } = deserializeTs(body, 0, digest32);
      if (!collect(ts).some((a) => a.type === "pending")) throw new Error("calendar returned no pending attestation");
      return { url, ok: true, ts };
    } catch (e) { return { url, ok: false, error: e.name === "AbortError" ? "timeout" : String(e.message || e) }; }
    finally { clearTimeout(t); }
  }));
  const good = results.filter((r) => r.ok);
  const calendarsOut = results.map(({ url, ok, error }) => ({ url, ok, error }));
  if (!good.length) return { proof: null, calendars: calendarsOut };
  const root = { msg: digest32, attestations: [], ops: [] };
  for (const g of good) mergeInto(root, g.ts);
  return { proof: serializeProof(digest32, root), calendars: calendarsOut };
}

/** Try to replace pending attestations with Bitcoin attestations. Network only to the calendar URIs inside the proof. */
export async function upgrade(proof, { fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const parsed = parseProof(proof);
  let changed = false;
  const visit = async (ts) => {
    const keep = [];
    for (const a of ts.attestations) {
      const t = hex(a.subarray(0, 8));
      if (t !== ATT_PENDING) { keep.push(a); continue; }
      let [n, p] = readVaruint(a, 8); const payload = a.subarray(p, p + n); const [l, q] = readVaruint(payload, 0); const uri = fromUtf8(payload.subarray(q, q + l));
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
        const r = await fetchFn(`${uri.replace(/\/$/, "")}/timestamp/${hex(ts.msg)}`, { headers: { Accept: "application/vnd.opentimestamps.v1" }, signal: ctl.signal });
        clearTimeout(tm);
        if (r.ok) { const body = new Uint8Array(await r.arrayBuffer()); const sub = deserializeTs(body, 0, ts.msg).ts; if (collect(sub).some((x) => x.type === "bitcoin")) { mergeInto(ts, sub); changed = true; continue; } }
      } catch { /* keep pending */ }
      keep.push(a);
    }
    ts.attestations = keep;
    for (const e of ts.ops) await visit(e.ts);
  };
  await visit(parsed.ts);
  const out = changed ? serializeProof(fromHex(parsed.digest), parsed.ts) : proof;
  return { upgraded: changed, proof: out, parsed: parseProof(out) };
}

// Synchronous SHA-256 to walk proof trees.
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256Sync(msg) {
  const l = msg.length, padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(msg); padded[l] = 0x80;
  const dv = new DataView(padded.buffer); dv.setUint32(padded.length - 4, (l * 8) >>> 0); dv.setUint32(padded.length - 8, Math.floor((l * 8) / 4294967296));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64); const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]); return out;
}
export const digestOf = (bytes) => sha256(bytes);
