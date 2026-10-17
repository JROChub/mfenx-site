// Node test suite for the tweek-ing engine. Run: node tests/test_tweek_engine.mjs
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { concat, utf8, fromUtf8, hex, putU32be, putU32le, crc32, sha256, randomBytes } from "../public/tweek/engine/bytes.mjs";
import { detectType, containers, canonicalize, text as textC } from "../public/tweek/engine/containers.mjs";
import { buildXmp, parseXmp, POLICIES } from "../public/tweek/engine/xmp.mjs";
import { embedImage, detectImage, psnr, payloadFromId, idFromPayload } from "../public/tweek/engine/watermark-image.mjs";
import { makeCanary, weaveProse, decodeZwAll, stripZw, encodeZw } from "../public/tweek/engine/watermark-text.mjs";
import { generateKeyPair, exportPrivate, importPrivate, sign, verify as verifySig, exportPublic, canonicalJson } from "../public/tweek/engine/sign.mjs";
import { stamp, parseProof, upgrade, varuint, OTS_MAGIC, sha256Sync } from "../public/tweek/engine/ots.mjs";
import { protect, parseIdString, idString } from "../public/tweek/engine/protect.mjs";
import { verify } from "../public/tweek/engine/verify.mjs";

let passed = 0; const failures = [];
async function test(name, fn) { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { failures.push(name); console.log("FAIL  " + name + "\n      " + (e.stack || e).split("\n").slice(0, 3).join("\n      ")); } }

// ── synthetic fixtures ──
function pngChunk(type, data) { const t = utf8(type); return concat(putU32be(data.length), t, data, putU32be(crc32(t, data))); }
function makePng(img) { // RGBA → PNG
  const { width: w, height: h, data } = img;
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const ihdr = concat(putU32be(w), putU32be(h), new Uint8Array([8, 6, 0, 0, 0]));
  return concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", new Uint8Array(zlib.deflateSync(raw))), pngChunk("IEND", new Uint8Array()));
}
function decodePng(b) { // our own PNGs only (8-bit RGBA, filter 0)
  let o = 8, w = 0, h = 0; const idat = [];
  while (o < b.length) { const len = (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0; const type = fromUtf8(b.subarray(o + 4, o + 8)); const d = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = (d[0] << 24 | d[1] << 16 | d[2] << 8 | d[3]) >>> 0; h = (d[4] << 24 | d[5] << 16 | d[6] << 8 | d[7]) >>> 0; } if (type === "IDAT") idat.push(d); o += 12 + len; }
  const raw = new Uint8Array(zlib.inflateSync(Buffer.concat(idat.map((x) => Buffer.from(x)))));
  const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) data.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  return { width: w, height: h, data };
}
function photo(w, h, seed = 7) { // smooth gradients + texture + edges, photograph-like statistics
  const data = new Uint8ClampedArray(w * h * 4); let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const u = x / w, v = y / h;
    const base = 120 + 80 * Math.sin(u * 6.3 + v * 2) * Math.cos(v * 4.1) + (x > w * 0.6 && y > h * 0.3 ? 40 : 0) + 18 * (rnd() - 0.5);
    data[i] = base + 30 * u; data[i + 1] = base - 20 * v; data[i + 2] = base * 0.8 + 25; data[i + 3] = 255; }
  return { width: w, height: h, data };
}
function makeJpeg() { // structurally valid segment stream (no real scan data needed for our parser)
  const seg = (m, d) => concat(new Uint8Array([0xff, m]), new Uint8Array([(d.length + 2) >> 8, (d.length + 2) & 255]), d);
  const app0 = seg(0xe0, concat(utf8("JFIF\0"), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0])));
  const exif = seg(0xe1, concat(utf8("Exif\0\0"), new Uint8Array(20)));
  const dqt = seg(0xdb, new Uint8Array(65)); const sof = seg(0xc0, new Uint8Array(15)); const sos = seg(0xda, new Uint8Array(10));
  return concat(new Uint8Array([0xff, 0xd8]), app0, exif, dqt, sof, sos, randomBytes(300).map((x) => (x === 0xff ? 0xfe : x)), new Uint8Array([0xff, 0xd9]));
}
function riff(form, chunks) { const body = concat(...chunks.map(([t, d]) => concat(utf8(t), putU32le(d.length), d, d.length & 1 ? new Uint8Array([0]) : new Uint8Array()))); return concat(utf8("RIFF"), putU32le(body.length + 4), utf8(form), body); }
function makeWebpLossless(w, h) { const bits = (w - 1) | ((h - 1) << 14) | (1 << 28); return riff("WEBP", [["VP8L", concat(new Uint8Array([0x2f]), putU32le(bits), randomBytes(40))]]); }
function makeWav() { return riff("WAVE", [["fmt ", new Uint8Array(16)], ["data", randomBytes(201)]]); }
function makeMp4() { const box = (t, d) => concat(putU32be(8 + d.length), utf8(t), d); return concat(box("ftyp", utf8("isom\0\0\0\0isommp42")), box("moov", randomBytes(64)), concat(putU32be(0), utf8("mdat"), randomBytes(100))); }
function makePdfClassic() {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"];
  let s = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = s.length; s += `xref\n0 4\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 4 /Root 1 0 R /ID [<0102><0304>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function makePdfXrefStream() { // catalog inside a compressed object stream, xref as stream
  const inner = "1 0 2 40 "; const pad = " ".repeat(40 - inner.length);
  const objsText = "<< /Type /Catalog /Pages 2 0 R >>" + " ".repeat(40 - 33) + "<< /Type /Pages /Kids [] /Count 0 >>";
  const streamData = Buffer.from(inner + pad.slice(0, 0) + objsText, "latin1"); // First = 40 → header occupies 40 bytes
  const header = Buffer.from((inner + " ".repeat(40)).slice(0, 40), "latin1");
  const full = Buffer.concat([header, Buffer.from(objsText, "latin1")]);
  const comp = zlib.deflateSync(full);
  let s = "%PDF-1.5\n"; const off4 = s.length;
  s += `4 0 obj\n<< /Type /ObjStm /N 2 /First 40 /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`;
  const pre = Buffer.from(s, "latin1"); const after = `\nendstream\nendobj\n`;
  const xrefOff = pre.length + comp.length + after.length;
  const row = (t, a, b) => Buffer.from([t, a >>> 24 & 255, a >>> 16 & 255, a >>> 8 & 255, a & 255, b >> 8, b & 255]);
  const rows = Buffer.concat([row(0, 0, 65535), row(2, 4, 0), row(2, 4, 1), row(0, 0, 0), row(1, off4, 0), row(1, xrefOff, 0)]);
  const xs = `5 0 obj\n<< /Type /XRef /Size 6 /W [1 4 2] /Root 1 0 R /Length ${rows.length} >>\nstream\n`;
  const tail = `\nendstream\nendobj\nstartxref\n${xrefOff}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([pre, comp, Buffer.from(after, "latin1"), Buffer.from(xs, "latin1"), rows, Buffer.from(tail, "latin1")]));
}

const manifestStub = () => ({ id: "tw1_test", created: "2026-10-17T00:00:00Z", creator: { name: "Ada", identity: "tweek:abc" }, policy: { id: "no-ai" }, asset: { documentId: "xmp.did:1", instanceId: "xmp.iid:1", contentDigest: "sha256:00", originalDigest: "sha256:01" }, canary: "velmor-quan-7f3a", manifestJson: '{"a":1,"x":"]]>"}', manifestDigest: "sha256:ff" });

console.log("tweek-ing engine tests");

await test("xmp: build + parse round trip incl. CDATA escape", async () => {
  const x = buildXmp(manifestStub());
  assert.ok(x.startsWith('<?xpacket begin="﻿"')); assert.ok(x.endsWith('<?xpacket end="w"?>'));
  const a = parseXmp(x);
  assert.equal(a["plus:DataMining"], POLICIES["no-ai"].dataMining); assert.equal(a["tdm:reservation"], "1"); assert.equal(a["tweek:manifest"], '{"a":1,"x":"]]>"}'); assert.equal(a["dc:creator"], "Ada");
});

for (const [kind, make] of [["jpeg", makeJpeg], ["png", () => makePng(photo(16, 16))], ["webp", () => makeWebpLossless(33, 17)], ["wav", makeWav], ["mp4", makeMp4], ["pdf", makePdfClassic], ["pdf-xrefstream", makePdfXrefStream]]) {
  await test(`container ${kind}: embed → extract → strip is canonical and idempotent`, async () => {
    const k = kind.startsWith("pdf") ? "pdf" : kind; const c = containers[k]; const orig = make();
    assert.equal(detectType(orig, "f." + k).kind, k);
    const xmp = buildXmp(manifestStub());
    const out = await c.embed(orig, xmp, { copyright: "c", id: "tw1", policy: "p" });
    assert.equal(c.extract(out), xmp, "extract returns exact packet");
    const canon = await canonicalize(orig, k);
    assert.equal(hex(c.strip(out)), hex(canon), "strip(embed) == canonical");
    assert.equal(hex(c.strip(c.strip(out))), hex(canon), "strip idempotent");
    const again = await c.embed(out, xmp.replace("Ada", "Bob"), {});
    assert.ok(c.extract(again).includes("Bob")); assert.equal(c.extract(again).split("xpacket begin").length, 2, "single packet after re-embed");
    assert.equal(hex(c.strip(again)), hex(canon));
    if (k === "pdf") { const s = Buffer.from(out).toString("latin1"); assert.ok(/\/Metadata \d+ 0 R/.test(s)); assert.ok(s.trim().endsWith("%%EOF")); assert.ok(s.includes("/Prev ")); }
    if (k === "webp") { assert.equal(fromUtf8(out.subarray(12, 16)), "VP8X"); assert.equal(out[20] & 0x04, 0x04, "XMP flag set"); assert.equal(out[20] & 0x10, 0x10, "alpha flag carried from VP8L"); }
    if (k === "jpeg") { assert.equal(out[2], 0xff); assert.equal(out[3], 0xe0, "APP0 still first"); }
    if (k === "mp4") { const n = (out[0] << 24 | out[1] << 16 | out[2] << 8 | out[3]) >>> 0; assert.ok(n > 0); const s = Buffer.from(out).toString("latin1"); assert.ok(s.includes("uuid")); }
  });
}

await test("text: header insert/strip, shebang kept, fields parse, comment styles", async () => {
  for (const [cmt, src] of [["//", "const a = 1;\n"], ["#", "#!/usr/bin/env python3\nprint(1)\n"], ["<!--", "<?xml version=\"1.0\"?>\n<a/>\n"], ["/*", "body{}\n"], ["", "Plain idea text.\n"], ["--", "select 1;\n"]]) {
    const out = textC.embed(src, cmt, [["tweek-id", "tw1_abc"], ["Rights", "x: y"]]);
    if (src.startsWith("#!")) assert.ok(out.startsWith("#!/usr/bin/env python3\n"));
    if (src.startsWith("<?xml")) assert.ok(out.startsWith('<?xml version="1.0"?>\n<!--'));
    assert.equal(textC.strip(out), src, `strip restores (${cmt || "plain"})`);
    const f = textC.extractFields(out); assert.equal(f["tweek-id"], "tw1_abc"); assert.equal(f.Rights, "x: y");
    assert.equal(textC.strip(textC.embed(out, cmt, [["tweek-id", "z"]])), src, "re-embed replaces");
  }
});

await test("watermark-image: payload CRC, embed invisibility, detect after resize + noise + brightness", async () => {
  const id = randomBytes(5); const bits = payloadFromId(id); assert.equal(bits.length, 48); assert.deepEqual([...idFromPayload(bits)], [...id]);
  bits[3] ^= 1; assert.equal(idFromPayload(bits), null, "CRC catches a flipped bit");
  const img = photo(640, 427);
  const wm = await embedImage(img, id, "tweek-public-v1");
  const q = psnr(img, wm); assert.ok(q > 40, `PSNR ${q.toFixed(1)} dB should exceed 40`);
  const d0 = await detectImage(wm, "tweek-public-v1"); assert.deepEqual([...d0.id], [...id], "clean detect");
  // attack: downscale to 55%, add noise ±6, brighten +12, then detect
  const sw = 352, sh = 235; const atk = { width: sw, height: sh, data: new Uint8ClampedArray(sw * sh * 4) };
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const sx = Math.min(wm.width - 1, Math.floor(x * wm.width / sw)), sy = Math.min(wm.height - 1, Math.floor(y * wm.height / sh)); const si = (sy * wm.width + sx) * 4, di = (y * sw + x) * 4; const n = (Math.random() - 0.5) * 12 + 12; atk.data[di] = wm.data[si] + n; atk.data[di + 1] = wm.data[si + 1] + n; atk.data[di + 2] = wm.data[si + 2] + n; atk.data[di + 3] = 255; }
  const d1 = await detectImage(atk, "tweek-public-v1"); assert.ok(d1.id, "detect after attack"); assert.deepEqual([...d1.id], [...id]);
  const wrong = await detectImage(wm, "other-key"); assert.equal(wrong.id, null, "wrong key → nothing");
  const blank = await detectImage(img, "tweek-public-v1"); assert.equal(blank.id, null, "unmarked image → no false positive");
  // PNG round trip through a real encoder
  const png = makePng(wm); const back = decodePng(png); const d2 = await detectImage(back, "tweek-public-v1"); assert.deepEqual([...d2.id], [...id]);
});

await test("watermark-text: canary determinism, zero-width weave/decode/strip", async () => {
  const id = new Uint8Array([1, 2, 3, 4, 5]);
  assert.equal(await makeCanary(id), await makeCanary(id)); assert.match(await makeCanary(id), /^[a-z]+-[a-z]+-0102$/);
  const prose = "An idea is a thing with edges. ".repeat(60);
  const w = weaveProse(prose, id, { every: 20 }); assert.equal(stripZw(w), prose);
  const found = decodeZwAll(w); assert.ok(found.length >= 5, "repeated marks"); for (const f of found) assert.deepEqual([...f], [...id]);
  const partial = w.slice(Math.floor(w.length / 3), Math.floor(w.length * 2 / 3)); assert.ok(decodeZwAll(partial).length >= 1, "partial copy still carries a mark");
  assert.equal(decodeZwAll(prose).length, 0); assert.equal(encodeZw(id).length, 25);
});

await test("sign: Ed25519 (or ES256) key export/import, canonical JSON, verify + tamper", async () => {
  const k = await generateKeyPair(); assert.ok(["Ed25519", "ES256"].includes(k.alg));
  const saved = await exportPrivate(k); const k2 = await importPrivate(saved);
  const msg = utf8(canonicalJson({ b: 2, a: { z: 1, y: [3, 2] } })); assert.equal(fromUtf8(msg), '{"a":{"y":[3,2],"z":1},"b":2}');
  const sig = await sign(k, msg); const pub = await exportPublic(k2);
  assert.equal(await verifySig(k.alg, pub, sig, msg), true); msg[0] ^= 1; assert.equal(await verifySig(k.alg, pub, sig, msg), false);
});

// ── OTS with a mocked calendar ──
function mockCalendar(digestRecorder) {
  const nonce = randomBytes(16);
  return async (url, init) => {
    if (url.includes("dead")) return { ok: false, status: 503 };
    if (url.endsWith("/digest")) {
      const digest = new Uint8Array(init.body); digestRecorder.push(hex(digest));
      // ops: append nonce → sha256 → pending attestation "https://mock.calendar"
      const uri = utf8("https://mock.calendar"); const payload = concat(varuint(uri.length), uri);
      const ts = concat(new Uint8Array([0xf0]), varuint(16), nonce, new Uint8Array([0x08]), new Uint8Array([0x00]), Uint8Array.from(Buffer.from("83dfe30d2ef90c8e", "hex")), varuint(payload.length), payload);
      return { ok: true, arrayBuffer: async () => ts.buffer.slice(ts.byteOffset, ts.byteOffset + ts.byteLength) };
    }
    if (url.includes("/timestamp/")) { // upgraded path: commitment → prepend junk → sha256 → bitcoin attestation at height 870000
      const junk = randomBytes(32); const payload = varuint(870000);
      const ts = concat(new Uint8Array([0xf1]), varuint(32), junk, new Uint8Array([0x08]), new Uint8Array([0x00]), Uint8Array.from(Buffer.from("0588960d73d71901", "hex")), varuint(payload.length), payload);
      return { ok: true, arrayBuffer: async () => ts.buffer.slice(ts.byteOffset, ts.byteOffset + ts.byteLength) };
    }
    return { ok: false, status: 404 };
  };
}
await test("ots: stamp → .ots proof → parse (pending) → upgrade (bitcoin) → re-parse", async () => {
  const rec = []; const fetchFn = mockCalendar(rec);
  const digest = await sha256(utf8("hello")); const r = await stamp(digest, { fetchFn, calendars: ["https://mock.calendar", "https://dead.calendar"] });
  assert.ok(r.proof); assert.equal(rec.length, 1); assert.equal(r.calendars.filter((c) => c.ok).length, 1);
  for (let i = 0; i < OTS_MAGIC.length; i++) assert.equal(r.proof[i], OTS_MAGIC[i]);
  const p = parseProof(r.proof); assert.equal(p.digest, hex(digest)); assert.equal(p.attestations.length, 1); assert.equal(p.attestations[0].type, "pending"); assert.equal(p.attestations[0].uri, "https://mock.calendar");
  const up = await upgrade(r.proof, { fetchFn }); assert.equal(up.upgraded, true);
  const types = up.parsed.attestations.map((a) => a.type); assert.ok(types.includes("bitcoin")); assert.ok(!types.includes("pending"));
  assert.equal(up.parsed.attestations.find((a) => a.type === "bitcoin").height, 870000);
  assert.equal(hex(sha256Sync(utf8("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const dead = await stamp(digest, { fetchFn, calendars: ["https://dead.calendar"] }); assert.equal(dead.proof, null);
});

// ── end-to-end ──
const key = await generateKeyPair();
const encode = async (pixels) => makePng(pixels);
await test("e2e image: protect PNG → verify (all checks pass) → strip metadata → watermark-only → tamper → fail", async () => {
  const rec = []; const fetchFn = mockCalendar(rec);
  const img = photo(300, 200); const png = makePng(img);
  const r = await protect({ bytes: png, name: "idea.png", creator: { name: "Ada Lovelace" }, policyId: "no-ai", title: "Idea", key, pixels: img, encode, options: { fetchFn, calendars: ["https://mock.calendar"] } });
  assert.match(r.id, /^tw1_[a-z2-7]{8}$/); assert.deepEqual([...parseIdString(r.id)], [...r.id40]); assert.equal(r.outputName, "idea.tweek.png");
  assert.ok(r.ots.proof); assert.equal(rec[0], r.manifestDigest.slice(7), "OTS stamps the manifest digest");
  assert.equal(r.manifest.creator.identity.slice(0, 6), "tweek:"); assert.ok(r.manifest.watermark.psnrDb > 40);
  const pixels = decodePng(containers.png.strip(r.outputBytes));
  const v = await verify({ bytes: r.outputBytes, name: r.outputName, pixels, sidecar: r.manifestJson, ots: r.ots.proof });
  const st = Object.fromEntries(v.checks.map((c) => [c.name, c.status]));
  assert.equal(v.verdict, "pass", JSON.stringify(v.checks)); assert.equal(st.content, "pass"); assert.equal(st.signature, "pass"); assert.equal(st.identity, "pass"); assert.equal(st.policy, "pass"); assert.equal(st.watermark, "pass"); assert.equal(st.timestamp, "warn"); assert.equal(st.sidecar, "pass");
  assert.equal(v.watermark.id, r.id); assert.equal(v.canary, r.canary);
  // metadata stripped by a hostile party
  const naked = containers.png.strip(r.outputBytes); const v2 = await verify({ bytes: naked, name: "x.png", pixels: decodePng(naked) });
  assert.equal(v2.verdict, "watermark-only"); assert.equal(v2.watermark.id, r.id);
  // content tampered after signing (flip a pixel byte inside IDAT → different canonical bytes)
  const t = new Uint8Array(r.outputBytes); const idat = Buffer.from(t).indexOf("IDAT"); t[idat + 20] ^= 0xff;
  const v3 = await verify({ bytes: t, name: "x.png" }); assert.equal(v3.checks.find((c) => c.name === "content").status, "fail");
  // forged manifest: change creator name inside the embedded manifest → signature fails
  const xmpTxt = containers.png.extract(r.outputBytes); const forged = await containers.png.embed(r.outputBytes, xmpTxt.replace(/Ada Lovelace/g, "Mallory Smith"));
  const v4 = await verify({ bytes: forged, name: "x.png" }); assert.equal(v4.checks.find((c) => c.name === "signature").status, "fail");
});

await test("e2e code: protect .py → header present, strip restores, verify passes, mutation detected", async () => {
  const src = "#!/usr/bin/env python3\n\ndef idea():\n    return 42\n";
  const r = await protect({ bytes: utf8(src), name: "idea.py", creator: { name: "Ada" }, policyId: "no-genai", key, options: { timestamp: false } });
  assert.ok(r.outputText.startsWith("#!/usr/bin/env python3\n# ═══ tweek-ing provenance"));
  assert.equal(textC.strip(r.outputText), src, "code body untouched (no zero-width inside code)");
  assert.ok(r.outputText.includes(r.canary)); assert.equal(decodeZwAll(r.outputText).length, 1, "fingerprint lives in the comment");
  const v = await verify({ bytes: utf8(r.outputText), name: "idea.tweek.py", sidecar: r.manifestJson }); assert.equal(v.verdict, "pass", JSON.stringify(v.checks));
  const v2 = await verify({ bytes: utf8(r.outputText.replace("return 42", "return 43")), name: "idea.tweek.py" }); assert.equal(v2.checks.find((c) => c.name === "content").status, "fail");
});

await test("e2e prose: .txt gets woven fingerprint, visible footer-style header, verify passes without sidecar", async () => {
  const prose = "My idea: a machine that folds laundry while it explains the news. ".repeat(30);
  const r = await protect({ bytes: utf8(prose), name: "idea.txt", creator: { name: "Ada" }, policyId: "no-ai", key, options: { timestamp: false } });
  assert.ok(r.manifest.watermark.marks >= 2); assert.equal(stripZw(textC.strip(r.outputText)), prose);
  const v = await verify({ bytes: utf8(r.outputText), name: "idea.tweek.txt" }); assert.equal(v.checks.find((c) => c.name === "content").status, "pass"); assert.equal(v.checks.find((c) => c.name === "watermark").status, "pass"); assert.equal(v.checks.find((c) => c.name === "signature").status, "skip");
});

await test("e2e pdf/wav/mp4/webp: protect embeds and verify passes", async () => {
  for (const [name, make] of [["doc.pdf", makePdfClassic], ["doc2.pdf", makePdfXrefStream], ["a.wav", makeWav], ["v.mp4", makeMp4], ["i.webp", () => makeWebpLossless(40, 30)]]) {
    const r = await protect({ bytes: make(), name, creator: { name: "Ada" }, policyId: "all-reserved", key, options: { timestamp: false } });
    assert.equal(r.notes.filter((n) => /could not be embedded/.test(n)).length, 0, name + ": " + r.notes.join(" | "));
    const v = await verify({ bytes: r.outputBytes, name: r.outputName }); assert.equal(v.verdict, "pass", name + " " + JSON.stringify(v.checks));
  }
});

await test("unsigned + unsupported types degrade gracefully", async () => {
  const r = await protect({ bytes: randomBytes(64), name: "blob.bin", creator: { name: "Ada" }, policyId: "no-ai", key: null, options: { timestamp: false } });
  assert.equal(r.manifest.creator.identity, "tweek:unsigned"); assert.ok(r.notes.length >= 2); assert.equal(r.outputBytes.length, 64);
});

console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ": " + failures.join(", ") : ""}`);
process.exit(failures.length ? 1 : 0);
