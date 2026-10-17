// tweek-ing protect UI. Everything runs in this browser; the only network call is the optional
// OpenTimestamps submission (a 32-byte hash) made by the engine.
import { protect, POLICIES } from "./engine/protect.mjs";
import { generateKeyPair, exportPrivate, importPrivate, exportPublic, identityOf } from "./engine/sign.mjs";
import { detectType } from "./engine/containers.mjs";
import { utf8 } from "./engine/bytes.mjs";

const $ = (id) => document.getElementById(id);
const KEY_STORE = "tweek.signing-key.v1";
const MAX_BYTES = 256 * 1024 * 1024;
let key = null;
let busy = false;

// ───────── key management ─────────
async function loadKey() {
  try {
    const raw = localStorage.getItem(KEY_STORE);
    if (raw) key = await importPrivate(JSON.parse(raw));
  } catch { key = null; }
  if (!key) await newKey(false);
  await showIdentity();
}
async function newKey(confirmFirst = true) {
  if (confirmFirst && key && !confirm("Create a new signing identity? Files signed with the current key stay valid, but new files will carry a different identity. Export the current key first if you want to keep it.")) return;
  key = await generateKeyPair();
  localStorage.setItem(KEY_STORE, JSON.stringify(await exportPrivate(key)));
  await showIdentity();
}
async function showIdentity() {
  const pub = await exportPublic(key);
  $("identity").textContent = `${await identityOf(pub)} · ${key.alg}`;
}
async function exportKey() {
  const saved = await exportPrivate(key);
  const id = await identityOf(saved.pub);
  download(utf8(JSON.stringify({ "@context": "https://mfenx.com/tweek/ns/1.0/", type: "tweek-signing-key", warning: "PRIVATE KEY. Anyone holding this file can sign as you. Keep it offline.", identity: id, ...saved }, null, 2)), `${id.replace(":", "-")}.tweek-key.json`, "application/json");
}
async function importKey(file) {
  try {
    const saved = JSON.parse(await file.text());
    if (!saved.jwk || !saved.alg) throw new Error("not a tweek signing key");
    key = await importPrivate(saved);
    localStorage.setItem(KEY_STORE, JSON.stringify({ alg: saved.alg, jwk: saved.jwk, pub: saved.pub }));
    await showIdentity();
  } catch (e) { alert("Could not import key: " + (e.message || e)); }
}

// ───────── image helpers (browser only) ─────────
async function decodePixels(bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { width: img.width, height: img.height, data: img.data };
}
async function encodePixels(pixels, kind) {
  const c = document.createElement("canvas");
  c.width = pixels.width; c.height = pixels.height;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.data.buffer ? pixels.data : pixels.data), pixels.width, pixels.height), 0, 0);
  const mime = kind === "jpeg" ? "image/jpeg" : kind === "webp" ? "image/webp" : "image/png";
  const blob = await new Promise((res) => c.toBlob(res, mime, 0.92));
  if (!blob) throw new Error("encoder unavailable");
  if (blob.type !== mime) throw new Error(`browser cannot encode ${mime}`);
  return new Uint8Array(await blob.arrayBuffer());
}
function pixelsToDataUrl(pixels, max = 480) {
  const scale = Math.min(1, max / Math.max(pixels.width, pixels.height));
  const c = document.createElement("canvas");
  const src = document.createElement("canvas");
  src.width = pixels.width; src.height = pixels.height;
  src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  c.width = Math.max(1, Math.round(pixels.width * scale)); c.height = Math.max(1, Math.round(pixels.height * scale));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

// ───────── UI plumbing ─────────
function download(bytes, name, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function blobLink(bytes, name, type, label, primary = false) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name; a.textContent = label; if (primary) a.className = "primary";
  return a;
}
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k === "html") n.innerHTML = v; else n.setAttribute(k, v); }
  for (const c of children) if (c != null) n.append(c);
  return n;
};
function card(title, eyebrow, cls = "") {
  const c = el("div", { class: `result-card ${cls}`.trim() }, el("div", { class: "eyebrow", text: eyebrow }), el("h2", { text: title }));
  const results = $("results");
  $("intro-card")?.remove();
  results.prepend(c);
  return c;
}
function copyButton(getText, label = "Copy") {
  const b = el("button", { type: "button", class: "plain-button", text: label });
  b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(getText()); b.textContent = "Copied"; setTimeout(() => (b.textContent = label), 1500); } catch { b.textContent = "Select and copy manually"; } });
  return b;
}

// ───────── protect one input ─────────
async function protectOne({ bytes, name }, opts) {
  const c = card(name, "PROTECTING…", "pending");
  const progress = el("p", { class: "progress", text: "Reading file…" });
  c.append(progress);
  try {
    if (bytes.length > MAX_BYTES) throw new Error("File is larger than 256 MiB; use a smaller export.");
    const type = detectType(bytes, name);
    let pixels = null, encode = null;
    if (["jpeg", "png", "webp"].includes(type.kind) && opts.watermark) {
      progress.textContent = "Decoding image…";
      try { pixels = await decodePixels(bytes, type.mime); encode = encodePixels; } catch { pixels = null; }
      if (pixels && pixels.width * pixels.height > 40_000_000) { pixels = null; opts.notes = ["Image exceeds 40 megapixels; watermark skipped to keep the browser responsive."]; }
    }
    progress.textContent = pixels ? "Embedding watermark and signing… (large images take a few seconds)" : "Signing…";
    await new Promise((r) => setTimeout(r, 30));
    const r = await protect({
      bytes, name, creator: { name: opts.creator, contact: opts.contact || undefined }, policyId: opts.policy, license: opts.license || undefined,
      key: opts.sign ? key : null, pixels, encode,
      options: { watermark: opts.watermark, timestamp: opts.timestamp, strength: opts.strength, otsTimeoutMs: 12_000 },
    });
    progress.remove();
    render(c, r, pixels, opts);
  } catch (e) {
    c.className = "result-card error";
    c.querySelector(".eyebrow").textContent = "FAILED";
    progress.textContent = e.message || String(e);
    console.error(e);
  }
}

function render(c, r, pixels, opts) {
  c.className = "result-card";
  c.querySelector(".eyebrow").textContent = "PROTECTED · " + r.type.kind.toUpperCase();
  const m = r.manifest;
  const otsState = r.ots?.proof ? `pending Bitcoin confirmation (${r.ots.calendars.filter((x) => x.ok).length} calendar${r.ots.calendars.filter((x) => x.ok).length === 1 ? "" : "s"})` : opts.timestamp ? "not obtained" : "off";
  const dl = el("dl", { class: "meta" });
  const row = (k, v) => dl.append(el("dt", { text: k }), typeof v === "string" ? el("dd", { text: v }) : el("dd", {}, v));
  row("Identifier", r.id);
  row("Signer", m.creator.identity + (m.signature ? ` (${m.signature.alg})` : ""));
  row("Policy", m.policy.label);
  row("Content digest", m.asset.contentDigest);
  row("Canary", el("span", { class: "canary", text: r.canary }));
  if (m.watermark) row("Watermark", m.watermark.scheme + (m.watermark.psnrDb ? ` · ${m.watermark.psnrDb} dB` : m.watermark.marks ? ` · ${m.watermark.marks} marks` : ""));
  row("Timestamp", otsState);
  c.append(dl);

  if (pixels && r.pixelsOut) {
    const prev = el("div", { class: "preview" });
    prev.append(el("figure", {}, el("img", { src: pixelsToDataUrl(pixels), alt: "original" }), el("figcaption", { text: "Original" })));
    prev.append(el("figure", {}, el("img", { src: pixelsToDataUrl(r.pixelsOut), alt: "watermarked" }), el("figcaption", { text: `Watermarked · PSNR ${m.watermark.psnrDb} dB` })));
    c.append(prev);
  }

  const d = el("div", { class: "downloads" });
  d.append(blobLink(r.outputBytes, r.outputName, r.type.mime, `Download ${r.outputName}`, true));
  d.append(blobLink(utf8(r.manifestJson), r.sidecarName, "application/json", r.sidecarName));
  if (r.ots?.proof) d.append(blobLink(r.ots.proof, r.otsName, "application/octet-stream", r.otsName));
  const all = el("button", { type: "button", text: "Download all" });
  all.addEventListener("click", () => { download(r.outputBytes, r.outputName, r.type.mime); setTimeout(() => download(utf8(r.manifestJson), r.sidecarName, "application/json"), 250); if (r.ots?.proof) setTimeout(() => download(r.ots.proof, r.otsName), 500); });
  d.append(all);
  const v = el("a", { href: "/tweek/verify/", text: "Open verifier" });
  d.append(v);
  c.append(d);

  if (r.notes.length) c.append(el("ul", { class: "notes" }, ...r.notes.map((n) => el("li", { text: n }))));

  // snippets + manifest
  const sn = el("div", { class: "snippets" });
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const pre = el("pre", { class: "code" });
  const entries = Object.entries(r.snippets).concat([["manifest", JSON.stringify(m, null, 2)], ["XMP", r.xmp.replace(/\n\s{90,}/g, "")]]);
  const show = (i) => { entries.forEach(([, ], j) => tabs.children[j].setAttribute("aria-selected", String(i === j))); pre.textContent = entries[i][1]; };
  entries.forEach(([label], i) => { const b = el("button", { type: "button", role: "tab", text: label }); b.addEventListener("click", () => show(i)); tabs.append(b); });
  sn.append(el("p", { class: "note", text: "Declarations for your own website or repository, generated for this policy:" }), tabs, el("div", { class: "copy-line" }, el("span", { class: "muted", text: "Paste where it applies." }), copyButton(() => pre.textContent)), pre);
  show(0);
  c.append(sn);
}

// ───────── form handling ─────────
function options() {
  return {
    creator: $("creator").value.trim() || "Anonymous rights holder",
    contact: $("contact").value.trim(),
    policy: $("policy").value in POLICIES ? $("policy").value : "no-ai",
    license: $("license").value,
    sign: $("opt-sign").checked, watermark: $("opt-watermark").checked, timestamp: $("opt-timestamp").checked,
    strength: parseFloat($("strength").value) || 1,
  };
}
async function run(files) {
  if (busy) return; busy = true;
  $("protect-button").disabled = true;
  try {
    const opts = options();
    for (const f of files) await protectOne(f, { ...opts });
  } finally { busy = false; $("protect-button").disabled = false; }
}
async function gather() {
  const list = [];
  for (const f of $("files").files) list.push({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
  const t = $("idea-text").value;
  if (t.trim()) { const md = /^#|\n#|\*\*|\n- /.test(t); list.push({ bytes: utf8(t.endsWith("\n") ? t : t + "\n"), name: `idea-${new Date().toISOString().slice(0, 10)}.${md ? "md" : "txt"}` }); }
  return list;
}

$("protect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const files = await gather();
  if (!files.length) { $("dropzone").classList.add("drag"); setTimeout(() => $("dropzone").classList.remove("drag"), 600); return; }
  await run(files);
});
$("clear-button").addEventListener("click", () => { $("protect-form").reset(); $("strength-out").textContent = "1.0 · ≈44 dB"; });
$("files").addEventListener("change", () => { const n = $("files").files.length; $("dropzone").querySelector("strong").textContent = n ? `${n} file${n > 1 ? "s" : ""} selected` : "Drop files here or click to choose"; });
for (const ev of ["dragenter", "dragover"]) $("dropzone").addEventListener(ev, (e) => { e.preventDefault(); $("dropzone").classList.add("drag"); });
for (const ev of ["dragleave", "drop"]) $("dropzone").addEventListener(ev, (e) => { e.preventDefault(); $("dropzone").classList.remove("drag"); });
$("dropzone").addEventListener("drop", async (e) => { const files = [...e.dataTransfer.files]; if (!files.length) return; const list = []; for (const f of files) list.push({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name }); await run(list); });
$("strength").addEventListener("input", () => { const s = parseFloat($("strength").value); $("strength-out").textContent = `${s.toFixed(1)} · ≈${Math.round(44.5 - 20 * Math.log10(s))} dB`; });
$("opt-sign").addEventListener("change", () => { $("key-panel").hidden = !$("opt-sign").checked; });
$("key-export").addEventListener("click", exportKey);
$("key-rotate").addEventListener("click", () => newKey(true));
$("key-import").addEventListener("change", () => { const f = $("key-import").files[0]; if (f) importKey(f); $("key-import").value = ""; });
$("load-example").addEventListener("click", async () => {
  // A synthetic sample image generated locally — nothing is fetched.
  const w = 640, h = 400, c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, "#2a6f97"); grad.addColorStop(0.5, "#e9c46a"); grad.addColorStop(1, "#8b2f3c"); g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255},0.35)`; g.beginPath(); g.arc((i * 131) % w, (i * 71) % h, 4 + (i % 23), 0, 7); g.fill(); }
  g.fillStyle = "#fff"; g.font = "bold 40px Arial"; g.fillText("sample idea sketch", 40, 70);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  $("idea-text").value = $("idea-text").value || "A pocket device that translates birdsong into short poems, with a shared notebook for the neighbourhood.";
  if (!$("creator").value) $("creator").value = "Sample Creator";
  await run([{ bytes: new Uint8Array(await blob.arrayBuffer()), name: "sample-sketch.png" }, ...(await gather()).filter((f) => f.name.startsWith("idea-"))]);
});

if (!globalThis.crypto?.subtle) { $("identity").textContent = "Web Crypto unavailable — signing disabled"; $("opt-sign").checked = false; $("opt-sign").disabled = true; }
else loadKey().catch((e) => { $("identity").textContent = "Key error: " + (e.message || e); });
