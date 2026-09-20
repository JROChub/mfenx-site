/* MFENX Release Receipt v1. No network, storage, telemetry or external imports. */
const SCHEMA = "mfenx/release-receipt/v1";
const ALGORITHM = "ecdsa-p256-sha256-p1363";
const ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const METRICS = ["samples", "source_correct", "candidate_correct", "decision_changes", "candidate_p95_latency_ns"];
const encoder = new TextEncoder();
export class ReceiptError extends Error {}
const fail = (message) => { throw new ReceiptError(message); };
const ascii = (s) => typeof s === "string" && /^[\x00-\x7f]*$/.test(s);
function keys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) fail(`Unsupported ${label} fields`);
}
function inspect(value, depth = 0) {
  if (depth > 16) fail("Receipt nesting exceeds limit");
  if (value === null || typeof value === "boolean" || Number.isSafeInteger(value)) return;
  if (ascii(value) && value.length <= 4096) return;
  if (Array.isArray(value) && value.length <= 64) { value.forEach((v) => inspect(v, depth + 1)); return; }
  if (value && typeof value === "object" && Object.keys(value).length <= 64) {
    for (const [key, child] of Object.entries(value)) {
      if (!ascii(key) || key.length > 128) fail("Unsupported object key");
      inspect(child, depth + 1);
    }
    return;
  }
  fail("Receipt supports bounded ASCII and safe integers only");
}
export function canonical(value) {
  inspect(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${canonical(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value).replace(/\x7f/g, "\\u007f");
}
export function parseReceipt(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 65536 || bytes.some((v) => v > 127)) fail("Receipt must contain 1–65536 ASCII bytes");
  const text = new TextDecoder().decode(bytes); let at = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(text[at] || "")) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') { try { return JSON.parse(text.slice(start, at)); } catch { fail("Invalid JSON string"); } }
      if (c === "\\") at++;
    }
    fail("Unterminated JSON string");
  }
  function read(depth = 0) {
    if (depth > 16) fail("Receipt nesting exceeds limit");
    ws(); const c = text[at];
    if (c === '"') return string();
    if (c === "{") {
      at++; ws(); const result = Object.create(null), seen = new Set();
      if (text[at] === "}") { at++; return result; }
      while (true) {
        ws(); if (text[at] !== '"') fail("Invalid object key"); const key = string();
        if (seen.has(key) || seen.size >= 64) fail("Duplicate or excessive JSON keys"); seen.add(key);
        ws(); if (text[at++] !== ":") fail("Missing colon"); result[key] = read(depth + 1); ws();
        const next = text[at++]; if (next === "}") return result; if (next !== ",") fail("Invalid JSON object");
      }
    }
    if (c === "[") {
      at++; ws(); const result = []; if (text[at] === "]") { at++; return result; }
      while (true) {
        if (result.length >= 64) fail("Excessive array items"); result.push(read(depth + 1)); ws();
        const next = text[at++]; if (next === "]") return result; if (next !== ",") fail("Invalid JSON array");
      }
    }
    for (const [word, value] of [["null", null], ["true", true], ["false", false]]) {
      if (text.slice(at, at + word.length) === word) { at += word.length; return value; }
    }
    const match = text.slice(at).match(/^-?(?:0|[1-9][0-9]*)/);
    if (!match) fail("Invalid JSON value"); at += match[0].length;
    if (/[.eE]/.test(text[at] || "")) fail("Non-integer JSON number");
    const value = Number(match[0]); if (!Number.isSafeInteger(value)) fail("Unsafe integer"); return value;
  }
  const value = read(); ws(); if (at !== text.length) fail("Trailing JSON input"); inspect(value); return value;
}
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < min || value > max) fail("Integer outside permitted range"); }
function digest(value) { if (typeof value !== "string" || !DIGEST.test(value)) fail("Invalid SHA-256 digest"); }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) fail("Timestamp must be canonical UTC");
  const result = Date.parse(value);
  if (value.startsWith("0000-") || !Number.isFinite(result) || new Date(result).toISOString() !== value.replace("Z", ".000Z")) fail("Invalid timestamp");
  return result;
}
function validate(s, now) {
  keys(s, ["id", "issued_at", "expires_at", "profile", "artifact", "parent_sha256", "contract_sha256", "evaluation"], "statement");
  if (typeof s.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(s.id)) fail("Invalid release identifier");
  const issued = timestamp(s.issued_at), expires = timestamp(s.expires_at);
  if (!Number.isFinite(now) || issued > now || expires <= now || expires <= issued) fail("Receipt is not currently valid");
  keys(s.artifact, ["format", "sha256", "bytes"], "artifact"); digest(s.artifact.sha256); integer(s.artifact.bytes, 1);
  const e = s.evaluation; keys(e, ["decision", "report_sha256", ...METRICS], "evaluation"); digest(e.report_sha256);
  if (s.profile === "onnx-finite-evaluation/v1") {
    if (s.artifact.format !== "onnx" || e.decision !== "PASS") fail("Inconsistent ONNX profile");
    digest(s.parent_sha256); digest(s.contract_sha256); integer(e.samples, 1);
    for (const key of ["source_correct", "candidate_correct", "decision_changes"]) integer(e[key], 0, e.samples);
    integer(e.candidate_p95_latency_ns, 1);
  } else if (s.profile === "safetensors-integrity/v1") {
    if (s.artifact.format !== "safetensors" || e.decision !== "NOT_EVALUATED" || s.parent_sha256 !== null || s.contract_sha256 !== null || METRICS.some((key) => e[key] !== null)) fail("Integrity receipt cannot assert behavioral admission");
  } else fail("Unsupported receipt profile");
}
export async function sha256(bytes) {
  return "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join("");
}
const domain = (name, value) => encoder.encode(`mfenx:release-receipt:v1:${name}\0${canonical(value)}`);
export async function verifyReceipt(receiptBytes, trustedKeyBytes, options = {}) {
  const receipt = parseReceipt(receiptBytes);
  // Bind caller-controlled buffers and policy to this invocation before any
  // asynchronous digest/import can yield. Later mutation must not change the
  // key that was pinned, the artifact that was supplied, or the expected policy.
  const now = options.now ?? Date.now();
  const expectedContractDigest = options.expectedContractDigest;
  const artifactBytes = options.artifactBytes;
  if (!(trustedKeyBytes instanceof Uint8Array) || !trustedKeyBytes.length || trustedKeyBytes.length > 4096) fail("Invalid SPKI trust key bytes");
  const shared = value => typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer;
  if (shared(trustedKeyBytes)) fail("Shared trust-key buffers are unsupported");
  const trustedKey = new Uint8Array(trustedKeyBytes);
  keys(receipt, ["schema", "issuer", "statement", "root_id", "signature"], "receipt");
  if (receipt.schema !== SCHEMA) fail("Unsupported receipt schema");
  validate(receipt.statement, now);
  if (artifactBytes !== undefined && (!(artifactBytes instanceof Uint8Array) || artifactBytes.length !== receipt.statement.artifact.bytes)) fail("Artifact does not match receipt");
  if (artifactBytes !== undefined && shared(artifactBytes)) fail("Shared artifact buffers are unsupported");
  const model = artifactBytes === undefined ? undefined : new Uint8Array(artifactBytes);
  keys(receipt.issuer, ["name", "key_id", "algorithm"], "issuer");
  if (typeof receipt.issuer.name !== "string" || !/^[\x20-\x7e]{1,128}$/.test(receipt.issuer.name) || receipt.issuer.algorithm !== ALGORITHM) fail("Invalid issuer");
  if (await sha256(trustedKey) !== receipt.issuer.key_id) fail("Issuer is not the independently selected trusted key");
  let key;
  try { key = await crypto.subtle.importKey("spki", trustedKey, {name: "ECDSA", namedCurve: "P-256"}, true, ["verify"]); }
  catch { fail("Invalid P-256 SPKI trust key"); }
  const exported = new Uint8Array(await crypto.subtle.exportKey("spki", key));
  if (exported.length !== trustedKey.length || exported.some((v, i) => v !== trustedKey[i])) fail("Noncanonical SPKI key");
  if (receipt.root_id !== await sha256(domain("root", receipt.statement))) fail("Receipt root mismatch");
  const sig = receipt.signature; keys(sig, ["algorithm", "value_base64"], "signature");
  if (sig.algorithm !== ALGORITHM || typeof sig.value_base64 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(sig.value_base64)) fail("Invalid signature encoding");
  let binary; try { binary = atob(sig.value_base64); } catch { fail("Invalid signature encoding"); }
  if (binary.length !== 64 || btoa(binary) !== sig.value_base64) fail("Noncanonical signature encoding");
  const signature = Uint8Array.from(binary, (v) => v.charCodeAt(0));
  const scalar = (bytes) => bytes.reduce((a, b) => (a << 8n) | BigInt(b), 0n);
  const r = scalar(signature.slice(0, 32)), s = scalar(signature.slice(32));
  if (r < 1n || r >= ORDER || s < 1n || s > ORDER / 2n) fail("Signature must be canonical low-S P-256");
  const body = Object.fromEntries(Object.entries(receipt).filter(([name]) => name !== "signature"));
  if (!await crypto.subtle.verify({name: "ECDSA", hash: "SHA-256"}, key, signature, domain("signature", body))) fail("Invalid receipt signature");
  const statement = receipt.statement;
  if (model !== undefined && (!(model instanceof Uint8Array) || model.length !== statement.artifact.bytes || await sha256(model) !== statement.artifact.sha256)) fail("Artifact does not match receipt");
  if (expectedContractDigest !== undefined) {
    digest(expectedContractDigest);
    if (statement.contract_sha256 !== expectedContractDigest) fail("Contract does not match independently expected policy");
  }
  return {status: "ATTESTATION_VERIFIED", artifactStatus: model !== undefined ? "MATCH" : "NOT_CHECKED",
    contractStatus: expectedContractDigest !== undefined ? "MATCH" : statement.contract_sha256 ? "NOT_CHECKED" : "NOT_APPLICABLE",
    behavioralStatus: statement.profile === "onnx-finite-evaluation/v1" ? "ISSUER_ATTESTED_FINITE_EVALUATION" : "NOT_EVALUATED",
    replayStatus: "NOT_PERFORMED", receipt};
}
