// tweek-ing verify UI. Local-only; optional OpenTimestamps upgrade contacts the calendar named in the proof.
import { verify } from "../engine/verify.mjs";
import { upgrade, stamp } from "../engine/ots.mjs";
import { detectType } from "../engine/containers.mjs";
import { sha256, utf8 } from "../engine/bytes.mjs";
import { canonicalJson } from "../engine/sign.mjs";

const $ = (id) => document.getElementById(id);
const LABELS = { manifest: "Provenance manifest", content: "Content integrity", signature: "Signature", identity: "Signer identity", policy: "Declared AI policy", watermark: "Invisible watermark", timestamp: "Timestamp proof", sidecar: "Sidecar manifest" };
const STATUS = { pass: ["status-good", "Pass"], fail: ["status-error", "Fail"], warn: ["status-warn", "Attention"], skip: ["status-skip", "Not checked"] };
let last = null;

async function decodePixels(bytes, mime) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0); bmp.close?.();
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return { width: d.width, height: d.height, data: d.data };
  } catch { return null; }
}
const el = (tag, attrs = {}, ...children) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v); } for (const c of children) if (c != null) n.append(c); return n; };
function download(bytes, name, type = "application/octet-stream") { const url = URL.createObjectURL(new Blob([bytes], { type })); const a = Object.assign(document.createElement("a"), { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }

function reset() {
  const card = $("result-card"); card.className = "result-card pending";
  $("result-state").textContent = "LOCAL VERIFIER"; $("result-title").textContent = "Awaiting a file.";
  $("result-summary").textContent = "The result separates authorship (signature), integrity (content digest), declared terms (policy), resilience (watermark) and time (Bitcoin attestation).";
  $("checks").replaceChildren(); $("meta").replaceChildren(); $("meta").hidden = true; $("actions").replaceChildren(); $("actions").hidden = true;
  $("manifest-details").hidden = true; $("xmp-details").hidden = true; $("manifest-json").textContent = ""; $("xmp-fields").textContent = "";
  last = null;
}

async function run() {
  const f = $("file").files[0]; if (!f) return;
  $("verify-button").disabled = true;
  const card = $("result-card"); card.className = "result-card pending"; $("result-state").textContent = "VERIFYING…"; $("result-title").textContent = f.name;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = detectType(bytes, f.name);
    const pixels = ["jpeg", "png", "webp"].includes(type.kind) ? await decodePixels(bytes, type.mime) : null;
    const sidecar = $("sidecar").files[0] ? await $("sidecar").files[0].text() : null;
    const ots = $("ots").files[0] ? new Uint8Array(await $("ots").files[0].arrayBuffer()) : null;
    const r = await verify({ bytes, name: f.name, pixels, sidecar, ots });
    last = { r, ots, name: f.name };
    show(r, ots);
  } catch (e) {
    card.className = "result-card error"; $("result-state").textContent = "ERROR"; $("result-summary").textContent = e.message || String(e); console.error(e);
  } finally { $("verify-button").disabled = false; }
}

function show(r, ots) {
  const card = $("result-card");
  const limitations = r.checks.some((c) => c.status === "warn" || c.status === "skip");
  const verdictText = { pass: limitations ? ["VERIFIED WITH LIMITATIONS", "No check failed. Review checks marked Attention or Not checked.", ""] : ["VERIFIED", "Every check passed.", ""], fail: ["FAILED", "At least one check failed. Treat the file's claims as unproven.", "error"], "watermark-only": ["WATERMARK FOUND", "No manifest is present (metadata was removed), but the invisible watermark identifies the protected work.", ""], none: ["NOTHING FOUND", "This file carries no tweek-ing provenance or watermark.", "error"] }[r.verdict];
  card.className = "result-card " + verdictText[2];
  $("result-state").textContent = verdictText[0];
  $("result-summary").textContent = verdictText[1];
  const ul = $("checks"); ul.replaceChildren();
  for (const c of r.checks) { const [cls, word] = STATUS[c.status]; ul.append(el("li", {}, el("span", { text: `${LABELS[c.name] || c.name} — ${c.detail}` }), el("strong", { class: cls, text: word }))); }

  const dl = $("meta"); dl.replaceChildren(); dl.hidden = false;
  const row = (k, v) => { if (v) dl.append(el("dt", { text: k }), el("dd", { text: v })); };
  const m = r.manifest;
  row("Identifier", m?.id || r.fields?.["tweek-id"] || r.watermark?.id || (r.watermark?.ids || []).join(", "));
  row("Signer", r.identity || m?.creator?.identity || r.fields?.["tweek-signer"]);
  row("Rights holder", m?.creator?.name || r.fields?.["SPDX-FileCopyrightText"]);
  row("Contact", m?.creator?.contact);
  row("Created", m?.created || r.fields?.["tweek-created"]);
  row("Policy", m?.policy?.label || (r.fields?.["TDM-Policy"] ? `${r.fields["TDM-Policy"]} (TDM-Reservation ${r.fields["TDM-Reservation"]})` : null));
  row("Data mining", m?.policy?.dataMining || r.fields?.["Data-Mining"]);
  row("Licence", m?.policy?.license || r.fields?.License);
  row("Canary", r.canary);
  row("Content digest", r.actualDigest);
  if (r.watermark) row("Watermark", r.watermark.detected ? `${r.watermark.id || r.watermark.ids.join(", ")}${r.watermark.confidence != null ? ` · confidence ${(r.watermark.confidence * 100).toFixed(0)}%` : ` · ${r.watermark.marks} marks`}` : "not detected");
  const pendingCalendars = r.timestamp?.attestations.filter((a) => a.type === "pending") || [];
  if (r.timestamp) row("Timestamp", !r.timestamp.bound ? "Proof does not bind to this manifest." : r.timestamp.bitcoinHeight != null ? `Attestation for Bitcoin block ${r.timestamp.bitcoinHeight}; independent block-header verification is required.` : pendingCalendars.length ? `Pending at ${pendingCalendars.map((a) => a.uri).join(", ")}` : "No supported Bitcoin or pending calendar attestation; anchoring is unverified.");

  const actions = $("actions"); actions.replaceChildren(); actions.hidden = false;
  if (ots && r.timestamp?.bound && r.timestamp.bitcoinHeight == null && pendingCalendars.length) {
    const name = last.name.replace(/\.[^.]+$/, "") + ".tweek.ots";
    const b = el("button", { id: "timestamp-upgrade", type: "button", text: "Check timestamp status" });
    const status = el("p", { id: "timestamp-status", role: "status" });
    let available = false;
    b.addEventListener("click", async () => {
      b.disabled = true; status.textContent = "Contacting timestamp calendars…";
      try {
        const u = await upgrade(ots);
        if (!b.isConnected) return;
        if (u.upgraded) {
          const h = u.parsed.attestations.find((a) => a.type === "bitcoin")?.height;
          status.textContent = `Bitcoin attestation available for block ${h}. Independent block-header verification is still required.`;
          const save = el("button", { id: "timestamp-download", type: "button", text: "Download upgraded .tweek.ots" });
          save.addEventListener("click", () => download(u.proof, name));
          actions.append(save); available = true;
        } else {
          const pending = u.calendars.filter((c) => c.status === "pending").length;
          const errors = u.calendars.filter((c) => c.status === "error").length;
          status.textContent = pending ? `Timestamp pending at ${pending} calendar${pending === 1 ? "" : "s"}. ${errors ? `${errors} calendar${errors === 1 ? " was" : "s were"} unavailable. ` : ""}You can retry this check.` : "Timestamp status could not be checked. Calendar responses were unavailable or invalid. You can retry this check.";
        }
      } catch (e) { if (b.isConnected) status.textContent = "Timestamp status could not be checked: " + (e.message || e); }
      finally { b.disabled = available; }
    });
    actions.append(b, status);
  }
  if (m && !ots) {
    const b = el("button", { id: "timestamp-stamp", type: "button", text: "Stamp this manifest now (OpenTimestamps)" });
    const status = el("p", { id: "timestamp-status", role: "status" });
    let available = false;
    b.addEventListener("click", async () => {
      b.disabled = true; status.textContent = "Submitting 32-byte hash…";
      try {
        const s = await stamp(await sha256(utf8(canonicalJson(m))));
        if (!b.isConnected) return;
        if (s.proof) {
          const accepted = s.calendars.filter((c) => c.ok).length;
          status.textContent = `Timestamp request accepted by ${accepted} calendar${accepted === 1 ? "" : "s"}. Bitcoin confirmation remains pending.`;
          const save = el("button", { id: "timestamp-stamp-download", type: "button", text: "Download .tweek.ots" });
          save.addEventListener("click", () => download(s.proof, (m.asset?.name || "manifest").replace(/\.[^.]+$/, "") + ".tweek.ots"));
          actions.append(save); available = true;
        } else status.textContent = "Timestamp calendars were unavailable. You can retry this request.";
      } catch (e) { if (b.isConnected) status.textContent = "Timestamp request failed: " + (e.message || e); }
      finally { b.disabled = available; }
    });
    actions.append(b, status);
  }
  if (m) { const b = el("button", { type: "button", text: "Download embedded manifest" }); b.addEventListener("click", () => download(utf8(JSON.stringify(m, null, 2)), (m.asset?.name || "manifest").replace(/\.[^.]+$/, "") + ".tweek.json", "application/json")); actions.append(b); }
  if (m?.policy?.url) actions.append(el("a", { href: m.policy.url, text: "Read the policy page" }));

  if (m) { $("manifest-details").hidden = false; $("manifest-json").textContent = JSON.stringify(m, null, 2); }
  if (r.xmp) { $("xmp-details").hidden = false; $("xmp-fields").textContent = Object.entries(r.xmp).filter(([k]) => k !== "tweek:manifest").map(([k, v]) => `${k} = ${v}`).join("\n"); }
  else if (r.fields) { $("xmp-details").hidden = false; $("xmp-details").querySelector("summary").textContent = "Inspect provenance header fields"; $("xmp-fields").textContent = Object.entries(r.fields).map(([k, v]) => `${k}: ${v}`).join("\n"); }
}

$("verify-form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
$("clear-button").addEventListener("click", () => { $("verify-form").reset(); reset(); });
$("file").addEventListener("change", () => { if ($("file").files[0]) run(); });
$("sidecar").addEventListener("change", () => { if ($("file").files[0]) run(); });
$("ots").addEventListener("change", () => { if ($("file").files[0]) run(); });
