// Verifier: everything runs locally from the protected file (and optional .tweek.json / .ots sidecars).

import { hex, sha256, utf8, fromUtf8, fromHex } from "./bytes.mjs";
import { parseXmp } from "./xmp.mjs";
import { detectType, extract, strip, text as textContainer } from "./containers.mjs";
import { detectImage } from "./watermark-image.mjs";
import { decodeZwAll, stripZw } from "./watermark-text.mjs";
import { verify as verifySig, identityOf, canonicalBytes, canonicalJson } from "./sign.mjs";
import { parseProof } from "./ots.mjs";
import { WM_PUBLIC_KEY, idString } from "./protect.mjs";

const check = (name, status, detail) => ({ name, status, detail });

/**
 * @param {object} p { bytes, name, pixels?, sidecar? (manifest JSON text), ots? (Uint8Array) }
 */
export async function verify(p) {
  const checks = [];
  const type = detectType(p.bytes, p.name);
  let manifest = null, fields = null, xmpAttrs = null, source = null;

  // 1. Locate the manifest
  if (type.kind === "text") {
    const t = fromUtf8(p.bytes);
    fields = textContainer.extractFields(t);
    if (fields) source = "provenance header";
  } else {
    const xmp = extract(p.bytes, type.kind);
    if (xmp) { xmpAttrs = parseXmp(xmp); source = "embedded XMP"; if (xmpAttrs["tweek:manifest"]) { try { manifest = JSON.parse(xmpAttrs["tweek:manifest"]); } catch { checks.push(check("manifest", "fail", "Embedded manifest is not valid JSON")); } } }
  }
  if (p.sidecar) { try { const m = JSON.parse(p.sidecar); if (!manifest) { manifest = m; source = source ? source + " + sidecar" : "sidecar manifest"; } else if (JSON.stringify(m) !== JSON.stringify(manifest)) checks.push(check("sidecar", "warn", "Sidecar manifest differs from the embedded manifest; the embedded one is used")); else checks.push(check("sidecar", "pass", "Sidecar manifest matches the embedded manifest")); } catch { checks.push(check("sidecar", "fail", "Sidecar is not valid JSON")); } }
  if (!manifest && !fields) checks.push(check("manifest", "fail", "No tweek-ing provenance found in this file. Metadata may have been stripped — try the watermark scan below, or supply the .tweek.json sidecar."));
  else checks.push(check("manifest", "pass", `Provenance found (${source})`));

  // 2. Content digest
  let contentDigestOk = null;
  const canonical = type.kind === "text" ? utf8(textContainer.strip(fromUtf8(p.bytes))) : strip(p.bytes, type.kind);
  const actual = "sha256:" + hex(await sha256(canonical));
  const claimed = manifest?.asset?.contentDigest || (fields?.["tweek-content-sha256"] ? "sha256:" + fields["tweek-content-sha256"] : null);
  if (claimed) { contentDigestOk = claimed === actual; checks.push(check("content", contentDigestOk ? "pass" : "fail", contentDigestOk ? "Content digest matches: the content is byte-for-byte what was signed" : `Content digest mismatch — the content was altered after protection (expected ${claimed.slice(0, 23)}…, got ${actual.slice(0, 23)}…)`)); }

  // 3. Signature
  const sig = manifest?.signature || (fields?.["tweek-signature"] ? { alg: fields["tweek-signature"].split(":")[0], value: fields["tweek-signature"].split(":").slice(1).join(":"), publicKey: fields["tweek-public-key"] } : null);
  let identity = null;
  if (sig && sig.publicKey) {
    identity = await identityOf(sig.publicKey);
    const claimedId = manifest?.creator?.identity || fields?.["tweek-signer"];
    if (manifest) {
      const unsigned = { ...manifest }; delete unsigned.signature;
      const ok = await verifySig(sig.alg, sig.publicKey, sig.value, canonicalBytes(unsigned));
      checks.push(check("signature", ok ? "pass" : "fail", ok ? `${sig.alg} signature verifies for ${identity}` : "Signature does not verify — manifest was altered or forged"));
    } else checks.push(check("signature", "skip", `Header carries a ${sig.alg} signature by ${identity}; supply the .tweek.json sidecar to verify it`));
    checks.push(check("identity", claimedId === identity ? "pass" : "fail", claimedId === identity ? "Signer identity is derived from the embedded public key" : `Claimed identity ${claimedId} does not match the key's identity ${identity}`));
  } else if (manifest || fields) checks.push(check("signature", "warn", "Unsigned provenance: digest and policy are declared but no key proves authorship"));

  // 4. Policy consistency between XMP attributes and manifest
  if (xmpAttrs && manifest) {
    const ok = xmpAttrs["plus:DataMining"] === manifest.policy?.dataMining && String(xmpAttrs["tdm:reservation"]) === String(manifest.policy?.tdmReservation) && xmpAttrs["tweek:id"] === manifest.id;
    checks.push(check("policy", ok ? "pass" : "fail", ok ? "IPTC Data Mining, TDM reservation and identifier agree with the signed manifest" : "Standard metadata fields disagree with the signed manifest"));
  }

  // 5. Watermark
  let watermark = null;
  const expectedId = manifest?.id || fields?.["tweek-id"] || null;
  if (p.pixels) {
    const d = await detectImage(p.pixels, WM_PUBLIC_KEY, { strength: manifest?.watermark?.strength || 1 });
    watermark = { detected: !!d.id, id: d.id ? idString(d.id) : null, confidence: d.confidence };
    if (d.id) checks.push(check("watermark", expectedId && watermark.id !== expectedId ? "fail" : "pass", expectedId ? (watermark.id === expectedId ? `Invisible watermark decodes to ${watermark.id}, matching the manifest` : `Watermark decodes to ${watermark.id} but the manifest says ${expectedId}`) : `Invisible watermark decodes to ${watermark.id} — the metadata was removed but the mark survived`));
    else checks.push(check("watermark", manifest?.watermark ? "fail" : "skip", manifest?.watermark ? "Watermark not detected (heavy crop, rotation or very strong edits defeat it)" : "No watermark detected"));
  } else if (type.kind === "text") {
    const found = decodeZwAll(fromUtf8(p.bytes)).map(idString);
    const uniq = [...new Set(found)];
    watermark = { detected: found.length > 0, ids: uniq, marks: found.length };
    if (found.length) checks.push(check("watermark", expectedId && !uniq.includes(expectedId) ? "fail" : "pass", `${found.length} zero-width fingerprint${found.length > 1 ? "s" : ""} decode to ${uniq.join(", ")}`));
    else checks.push(check("watermark", "skip", "No zero-width fingerprint present"));
  }

  // 6. Timestamp
  let timestamp = null;
  if (p.ots) {
    try {
      const parsed = parseProof(p.ots);
      const manifestDigest = manifest ? hex(await sha256(utf8(canonicalJson(manifest)))) : fields?.["tweek-manifest-sha256"];
      const bound = manifestDigest === parsed.digest;
      const btc = parsed.attestations.find((a) => a.type === "bitcoin");
      const pending = parsed.attestations.filter((a) => a.type === "pending").length;
      timestamp = { digest: parsed.digest, bound, attestations: parsed.attestations, bitcoinHeight: btc?.height ?? null, independentlyVerified: false };
      const detail = btc
        ? `Timestamp proof is bound to this manifest and contains a Bitcoin attestation for block ${btc.height}; block-header verification has not been performed, so anchoring is unverified`
        : pending
          ? `Timestamp proof is bound to this manifest and is pending Bitcoin confirmation (${pending} calendar${pending === 1 ? "" : "s"}); upgrade later to obtain additional attestations`
          : "Timestamp proof is bound to this manifest but contains no supported Bitcoin or pending calendar attestation; anchoring is unverified";
      checks.push(check("timestamp", bound ? "warn" : "fail", bound ? detail : "Timestamp proof is for a different manifest"));
    } catch (e) { checks.push(check("timestamp", "fail", "Could not parse the .ots proof: " + (e.message || e))); }
  }

  const failed = checks.some((c) => c.status === "fail");
  return { type, source, manifest, fields, xmp: xmpAttrs, identity, actualDigest: actual, checks, watermark, timestamp, canary: manifest?.canary || fields?.["tweek-canary"]?.replace(/[​‌‍⁠﻿]/g, "") || null, verdict: !manifest && !fields ? (watermark?.detected ? "watermark-only" : "none") : failed ? "fail" : "pass" };
}
function sortDeep(v) { if (v === null || typeof v !== "object") return v; if (Array.isArray(v)) return v.map(sortDeep); return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])); }
export { stripZw };
