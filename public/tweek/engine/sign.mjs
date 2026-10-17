// Keys and signatures. Ed25519 via Web Crypto where available (Chrome 137+, Firefox, Safari, Node 20),
// ECDSA P-256 otherwise. Identity = "tweek:" + base32(sha256(SPKI)[0..15]) so it is stable and printable.

import { b64, fromB64, b32, sha256, utf8 } from "./bytes.mjs";
const subtle = globalThis.crypto.subtle;

export async function ed25519Supported() {
  try { const k = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]); return !!k; } catch { return false; }
}
export async function generateKeyPair() {
  if (await ed25519Supported()) return { alg: "Ed25519", pair: await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) };
  return { alg: "ES256", pair: await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) };
}
export async function exportPublic(k) { return b64(new Uint8Array(await subtle.exportKey("spki", k.pair.publicKey)), true); }
export async function exportPrivate(k) { return { alg: k.alg, jwk: await subtle.exportKey("jwk", k.pair.privateKey), pub: await exportPublic(k) }; }
export async function importPrivate(saved) {
  const algo = saved.alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
  const priv = await subtle.importKey("jwk", saved.jwk, algo, true, ["sign"]);
  const pubJwk = { ...saved.jwk }; delete pubJwk.d; pubJwk.key_ops = ["verify"];
  const pub = await subtle.importKey("jwk", pubJwk, algo, true, ["verify"]);
  return { alg: saved.alg, pair: { privateKey: priv, publicKey: pub } };
}
export async function importPublic(alg, spkiB64u) {
  const algo = alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
  return subtle.importKey("spki", fromB64(spkiB64u), algo, true, ["verify"]);
}
export async function identityOf(spkiB64u) { const h = await sha256(fromB64(spkiB64u)); return "tweek:" + b32(h.subarray(0, 15)); }
export async function sign(k, data) {
  const params = k.alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
  return b64(new Uint8Array(await subtle.sign(params, k.pair.privateKey, data)), true);
}
export async function verify(alg, spkiB64u, sigB64u, data) {
  try {
    const pub = await importPublic(alg, spkiB64u);
    const params = alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
    return await subtle.verify(params, pub, fromB64(sigB64u), data);
  } catch { return false; }
}

// RFC 8785-style canonical JSON (sorted keys, no whitespace, UTF-8).
export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}
export const canonicalBytes = (v) => utf8(canonicalJson(v));
