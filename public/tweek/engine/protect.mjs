// The protect pipeline: watermark → canonical content digest → signed manifest → OpenTimestamps → embed.

import { b32, hex, randomBytes, sha256, utf8, fromUtf8, nowIso, concat } from "./bytes.mjs";
import { buildXmp, POLICIES, DATA_MINING } from "./xmp.mjs";
import { detectType, canonicalize, embed as embedContainer, text as textContainer } from "./containers.mjs";
import { embedImage, psnr as psnrOf } from "./watermark-image.mjs";
import { makeCanary, weaveProse, encodeZw, countMarks } from "./watermark-text.mjs";
import { sign, exportPublic, identityOf, canonicalBytes, canonicalJson } from "./sign.mjs";
import { stamp } from "./ots.mjs";

export const WM_PUBLIC_KEY = "tweek-public-v1"; // blind detection by anyone: the mark says "this is tw1_…"
export const NS_CONTEXT = "https://mfenx.com/tweek/ns/1.0/";
export const idString = (id40) => "tw1_" + b32(id40);
export function parseIdString(s) {
  const m = /^tw1_([a-z2-7]{8})$/.exec(String(s).trim()); if (!m) return null;
  const B = "abcdefghijklmnopqrstuvwxyz234567"; let bits = 0, val = 0; const out = []; for (const ch of m[1]) { val = (val << 5) | B.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out.slice(0, 5));
}
const dg = async (b) => "sha256:" + hex(await sha256(b));

/**
 * @param {object} p
 * @param {Uint8Array} p.bytes          original file bytes
 * @param {string}     p.name           original filename
 * @param {object}     p.creator        { name, contact? }
 * @param {string}     p.policyId       key of POLICIES
 * @param {string=}    p.license        URL (e.g. Creative Commons) or SPDX id
 * @param {string=}    p.title
 * @param {object=}    p.key            { alg, pair } from sign.mjs (null → unsigned manifest, still digest-bound)
 * @param {object=}    p.pixels         { width, height, data } RGBA of the image (images only; enables the watermark)
 * @param {function=}  p.encode         async (pixels, kind) → Uint8Array; re-encodes watermarked pixels (browser: canvas)
 * @param {object=}    p.options        { watermark=true, timestamp=true, strength=1, zwEvery=40, fetchFn, calendars }
 */
export async function protect(p) {
  const o = { watermark: true, timestamp: true, strength: 1, zwEvery: 40, ...(p.options || {}) };
  const notes = [];
  const type = detectType(p.bytes, p.name);
  const id40 = randomBytes(5);
  const id = idString(id40);
  const canary = await makeCanary(id40);
  const created = nowIso();
  const pol = POLICIES[p.policyId] || POLICIES["no-ai"];
  const originalDigest = await dg(p.bytes);

  let carrier = p.bytes, carrierText = null, watermark = null, pixelsOut = null;
  if (type.kind === "text") {
    carrierText = textContainer.strip(fromUtf8(p.bytes));
    if (o.watermark) {
      const isCode = type.comment !== "" && type.comment !== "<!--";
      if (isCode) { watermark = { scheme: "tweek-zw-v1", payload: hex(id40), placement: "provenance-comment" }; }
      else { carrierText = weaveProse(carrierText, id40, { every: o.zwEvery }); watermark = { scheme: "tweek-zw-v1", payload: hex(id40), placement: "prose", marks: countMarks(carrierText, id40) }; }
    }
  } else if (["jpeg", "png", "webp"].includes(type.kind) && o.watermark) {
    if (!p.pixels || !p.encode) notes.push("Image watermark skipped: pixel data not supplied.");
    else {
      pixelsOut = await embedImage(p.pixels, id40, WM_PUBLIC_KEY, { strength: o.strength });
      const q = psnrOf(p.pixels, pixelsOut);
      carrier = await p.encode(pixelsOut, type.kind);
      watermark = { scheme: "tweek-dct-qim-v1", payload: hex(id40), key: "public", strength: o.strength, psnrDb: Number.isFinite(q) ? Math.round(q * 10) / 10 : null, grid: 256 };
      if (type.kind === "jpeg") notes.push("The image was re-encoded to carry the watermark; the original JPEG bytes are not preserved (original digest is recorded).");
    }
  } else if (o.watermark && type.kind !== "binary") notes.push(`No invisible watermark is defined for ${type.kind}; provenance relies on the signed metadata and the sidecar manifest.`);

  // Canonical content → digest that anyone can recompute from the protected file
  let canonical;
  if (type.kind === "text") canonical = utf8(carrierText);
  else if (type.unsupported) canonical = carrier;
  else canonical = await canonicalize(carrier, type.kind);
  const contentDigest = await dg(canonical);

  const manifest = {
    "@context": NS_CONTEXT, version: 1, id, created,
    creator: { name: p.creator?.name || "", identity: "", ...(p.creator?.contact ? { contact: p.creator.contact } : {}) },
    asset: { name: p.name, mediaType: type.mime, kind: type.kind, bytes: canonical.length, originalDigest, contentDigest, documentId: "xmp.did:" + hex(randomBytes(16)), instanceId: "xmp.iid:" + hex(randomBytes(16)), ...(p.title ? { title: p.title } : {}), ...(p.pixels ? { width: p.pixels.width, height: p.pixels.height } : {}) },
    policy: { id: p.policyId in POLICIES ? p.policyId : "no-ai", label: pol.label, dataMining: pol.dataMining, tdmReservation: pol.tdmReservation, url: `https://mfenx.com/tweek/policy/${p.policyId in POLICIES ? p.policyId : "no-ai"}/`, usageTerms: pol.usageTerms, rights: `© ${created.slice(0, 4)} ${p.creator?.name || "the rights holder"}. All rights reserved.`, ...(p.license ? { license: p.license } : {}) },
    ...(watermark ? { watermark } : {}),
    canary,
    verify: "https://mfenx.com/tweek/verify/",
  };
  if (p.key) {
    const publicKey = await exportPublic(p.key);
    manifest.creator.identity = await identityOf(publicKey);
    const toSign = canonicalBytes(manifest);
    manifest.signature = { alg: p.key.alg, publicKey, value: await sign(p.key, toSign), covers: "canonical JSON of this manifest without the signature member (RFC 8785 ordering)" };
  } else { manifest.creator.identity = "tweek:unsigned"; notes.push("No signing key: the manifest binds the digest but does not prove who made it."); }
  const manifestJson = canonicalJson(manifest);
  const manifestDigest = "sha256:" + hex(await sha256(utf8(manifestJson)));

  // Timestamp the signed manifest (binds content digest + identity + declared time to Bitcoin)
  let ots = null;
  if (o.timestamp) {
    try {
      const r = await stamp(await sha256(utf8(manifestJson)), { fetchFn: o.fetchFn, calendars: o.calendars, timeoutMs: o.otsTimeoutMs });
      ots = r;
      if (!r.proof) notes.push("OpenTimestamps calendars were unreachable; the manifest can be stamped later with the .tweek.json file.");
    } catch (e) { notes.push("Timestamping failed: " + (e.message || e)); }
  }

  // Embed
  const xmp = buildXmp({ ...manifest, manifestJson, manifestDigest });
  let outputBytes, outputText = null;
  if (type.kind === "text") {
    const fields = [
      ["SPDX-FileCopyrightText", `${created.slice(0, 4)} ${p.creator?.name || manifest.creator.identity}`],
      ["Rights", manifest.policy.rights + " " + pol.usageTerms],
      ["TDM-Reservation", String(pol.tdmReservation)], ["TDM-Policy", manifest.policy.url], ["Data-Mining", pol.dataMining],
      ...(p.license ? [["License", p.license]] : []),
      ["tweek-id", id], ["tweek-canary", canary + (watermark && watermark.placement === "provenance-comment" ? encodeZw(id40) : "")],
      ["tweek-created", created], ["tweek-content-sha256", contentDigest.slice(7)], ["tweek-signer", manifest.creator.identity],
      ...(manifest.signature ? [["tweek-signature", `${manifest.signature.alg}:${manifest.signature.value}`], ["tweek-public-key", manifest.signature.publicKey]] : []),
      ["tweek-manifest-sha256", manifestDigest.slice(7)], ["tweek-verify", "https://mfenx.com/tweek/verify/"],
    ];
    outputText = textContainer.embed(carrierText, type.comment, fields);
    outputBytes = utf8(outputText);
  } else if (type.unsupported) { outputBytes = carrier; notes.push(type.unsupported); }
  else {
    try { outputBytes = await embedContainer(carrier, type.kind, xmp, { copyright: manifest.policy.rights, id, policy: pol.label, artist: p.creator?.name }); }
    catch (e) { outputBytes = carrier; notes.push("Metadata could not be embedded in this file: " + (e.message || e)); }
  }
  const base = p.name.replace(/\.[^.]+$/, "") || "protected";
  const outExt = type.kind === "text" ? (p.name.includes(".") ? p.name.split(".").pop() : "txt") : type.ext;
  return {
    id, id40, canary, type, manifest, manifestJson, manifestDigest, xmp, notes,
    outputBytes, outputText, outputName: `${base}.tweek.${outExt}`,
    sidecarName: `${base}.tweek.json`, otsName: `${base}.tweek.ots`, ots, pixelsOut,
    snippets: snippets(manifest),
  };
}

/** Companion declarations for the creator's own website / repository. */
export function snippets(m) {
  const p = m.policy;
  return {
    "robots.txt": `# tweek-ing: AI/TDM reservation for ${m.id}\nUser-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\nUser-agent: Google-Extended\nDisallow: /\nUser-agent: CCBot\nDisallow: /\nUser-agent: Applebot-Extended\nDisallow: /\nUser-agent: Bytespider\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /\nUser-agent: meta-externalagent\nDisallow: /\nUser-agent: anthropic-ai\nDisallow: /\nUser-agent: cohere-ai\nDisallow: /\nUser-agent: Amazonbot\nDisallow: /\n`,
    "HTTP headers": `TDM-Reservation: ${p.tdmReservation}\nTDM-Policy: ${p.url}\nX-Robots-Tag: noai, noimageai\n`,
    "HTML <head>": `<meta name="tdm-reservation" content="${p.tdmReservation}">\n<meta name="tdm-policy" content="${p.url}">\n<meta name="robots" content="noai, noimageai">\n<link rel="license" href="${p.license || p.url}">\n`,
    "tdmrep.json": JSON.stringify([{ location: "/*", "tdm-reservation": p.tdmReservation, "tdm-policy": p.url }], null, 2) + "\n",
    "ai.txt": `# ai.txt (spawning.ai) generated by tweek-ing\nUser-Agent: *\nDisallow: /\nDisallow: *.txt\nDisallow: *.md\nDisallow: *.jpg\nDisallow: *.png\nDisallow: *.webp\nDisallow: *.pdf\nDisallow: *.wav\nDisallow: *.mp4\n`,
  };
}
export { POLICIES, DATA_MINING };
