"use strict";

const RELEASES = Object.freeze({
  v2: Object.freeze({
    root: "release/",
    manifestSha256: "71033d917be233ea260417a1f7521c8098f27715475ad0ddf8318a5ecf2fd966",
    manifestEntries: 1307,
    files: Object.freeze([
      "acceptance.json", "artifacts/gemm.inspect.json", "artifacts/gemm.mfx.json",
      "artifacts/resumed.result.json", "artifacts/resumed.verify.json",
      "artifacts/uninterrupted.result.json", "artifacts/uninterrupted.verify.json",
      "checkpoints/killed-and-resumed/plan.json",
      "checkpoints/killed-and-resumed/receipt-00000000.json",
      "checkpoints/killed-and-resumed/receipt-00000001.json",
      "provenance/binary.sha256", "provenance/containment-probes.txt",
      "provenance/containment.txt", "provenance/lane-overlap.json",
      "provenance/memory-summary.json", "provenance/post-kill-receipts.json",
      "provenance/post-resume-checkpoint.json", "provenance/resumed-io-counters.json",
      "provenance/source-root.sha256", "provenance/trace-summary.json",
      "provenance/uninterrupted-io-counters.json", "provenance/workload-contract.json"
    ])
  }),
  v1: Object.freeze({
    root: "release-v1/",
    manifestSha256: "3a08e8a61b6eb0a9cec94959fa5b666ff1441de6c310b07f388e9ce57a80296d",
    manifestEntries: 1298,
    files: Object.freeze([
      "acceptance.json", "artifacts/gemm.inspect.json", "artifacts/gemm.mfx.json",
      "artifacts/resumed.result.json", "artifacts/resumed.verify.json",
      "artifacts/uninterrupted.result.json", "artifacts/uninterrupted.verify.json",
      "checkpoints/killed-and-resumed/plan.json",
      "checkpoints/killed-and-resumed/receipt-00000000.json",
      "checkpoints/killed-and-resumed/receipt-00000001.json",
      "provenance/binary.sha256", "provenance/containment-probes.txt",
      "provenance/containment.txt", "provenance/lane-overlap.json",
      "provenance/memory-summary.json", "provenance/post-kill-receipts.json",
      "provenance/post-resume-checkpoint.json", "provenance/source-root.sha256",
      "provenance/trace-summary.json", "provenance/workload-contract.json"
    ])
  })
});

const SCIENTIFIC_EVIDENCE = Object.freeze({
  root: "evidence/v0.1.6/",
  summaryPath: "summary.json",
  manifestPath: "SHA256SUMS",
  signaturePath: "SHA256SUMS.sig",
  summarySha256: "812a40c69f37a444d992aec53f08fdd89b205185333673f7e9f94bc989eecb5a",
  manifestSha256: "45f799e05030cba6575023ac2f92c418043c1bd8268cc4e1e6938799e7fe406f",
  signatureSha256: "28c63596aff42945bd0acf1c6268b4eaafcceaaa6a5d00e6f85c3c42ab6f8010",
  schema: "mfenx.lightsout.scientific-evidence-summary.v2",
  sourceLockSha256: "ce4a6b58710cc70bc6675ee7c444760b8ea8d54e979a90f063e0e99934d1f201",
  suiteSha256: "2af381d5204d0526a4ba55a04582d481d51ec804cd00e06eb4564a1b65c5b56f",
  files: Object.freeze({
    "BENCHMARK-ATTRIBUTION.md": "10fe1b39e8f14bc9b8ea5ba076e75c3d48548ea9238a7e159f8e43a01264c5a3",
    "git-allowed-signers": "a14cd84069171942d3968e67cc473753167bdbf3b203944fb4d2c7e6de9e0ca4",
    "release-allowed-signers": "a1d0fac9ee95cfde1573faca068c46437ad5464cd02cb4a4a0a4438186392607",
    "release-ed25519.pub": "0f7c5f5eacc52b9f5c54eb7a5166e7e8e0a5a5b73d9a23f94dc9e2bdad244426",
    "summary.json": "812a40c69f37a444d992aec53f08fdd89b205185333673f7e9f94bc989eecb5a"
  })
});

// Preserved signed v0.1.3 foundation. These established pins remain separate
// from the v0.1.6 scientific summary and are authenticated by the site gate.
const COMMERCIAL_STATUS = Object.freeze({
  root: "current-release/",
  recordPath: "COMMERCIAL-STATUS.canonical.json",
  signaturePath: "COMMERCIAL-STATUS.canonical.json.sig",
  publicKeyPath: "release-signing-key.pub",
  allowedSignersPath: "allowed_signers",
  recordSha256: "bf6d6f6d6e3d0f75fd054c38600579a5954df63012dbbdaf75b65b19d14cbb15",
  detachedSignatureSha256: "17d7dc6e5bce1e59c7c85b7a5db9a026dd037cecdb9cdd57f9ef3505a7f3edd0",
  publicKeySha256: "0f7c5f5eacc52b9f5c54eb7a5166e7e8e0a5a5b73d9a23f94dc9e2bdad244426",
  allowedSignersSha256: "cfec795857dd01e48eb4a9d62b1ed0e2af5a6edbc95ed30542afa17b8e9e3e95"
});

const EXPECTED = Object.freeze({
  leftShape: Object.freeze([3, 56]),
  rightShape: Object.freeze([56, 1048576]),
  outputShape: Object.freeze([3, 1048576]),
  logicalInputBytes: 234881696,
  outputBytes: 12582912,
  usefulOperations: 352321536,
  physicalOperations: 704643072,
  managedPeakBytes: 42411200,
  outputRoot: "4691a345a8818af410da311bc4d79131dcd093ff47384e71d4832ca08fed638c",
  v2ExternalWallNs: 5608764486,
  v1ExternalWallNs: 276103268901
});

const CHECK_NAMES = Object.freeze([
  "scientific-digest", "scientific-builds", "scientific-suite", "npb", "hpl-hpcg",
  "stream-osu", "v2-pack", "v1-pack", "comparison"
]);
const BLOCKED_SOFTWARE_HREF = /(?:^|\/)(?:release(?:-v1)?\/bin\/)|\.tar\.zst(?:$|[?#])/i;
const state = { loading: false, ready: false, scientific: null, v2: null, v1: null };
const byId = (id) => document.getElementById(id);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equalArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertDigest(value, message) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), message);
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(label + " is not valid UTF-8");
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(decodeUtf8(bytes, label));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(label + " is not valid JSON");
    throw error;
  }
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function concatBytes(...parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function sshString(bytes) {
  const output = new Uint8Array(4 + bytes.byteLength);
  new DataView(output.buffer).setUint32(0, bytes.byteLength, false);
  output.set(bytes, 4);
  return output;
}

function sshReader(bytes, label) {
  let offset = 0;
  return Object.freeze({
    bytes(length) {
      assert(Number.isSafeInteger(length) && length >= 0 && offset + length <= bytes.byteLength, label + " is truncated");
      const value = bytes.slice(offset, offset + length);
      offset += length;
      return value;
    },
    uint32() {
      assert(offset + 4 <= bytes.byteLength, label + " is truncated");
      const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
      offset += 4;
      return value;
    },
    string(maxBytes = 16 * 1024) {
      const length = this.uint32();
      assert(length <= maxBytes, label + " contains an oversized SSH field");
      return this.bytes(length);
    },
    done() {
      assert(offset === bytes.byteLength, label + " contains trailing data");
    }
  });
}

function decodeBase64(value, label) {
  assert(value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value), label + " is not canonical base64");
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error(label + " is not valid base64");
  }
  assert(btoa(binary) === value, label + " is not canonical base64");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseEd25519KeyBlob(blob, label) {
  const reader = sshReader(blob, label);
  const algorithm = decodeUtf8(reader.string(64), label + " algorithm");
  const key = reader.string(64);
  reader.done();
  assert(algorithm === "ssh-ed25519" && key.byteLength === 32, label + " is not an Ed25519 public key");
  return key;
}

function parseOpenSshEd25519PublicKey(bytes) {
  const text = decodeUtf8(bytes, "release public key");
  const match = /^ssh-ed25519 ([A-Za-z0-9+/]+={0,2}) ([^\r\n]+)\n$/.exec(text);
  assert(match, "release public key format changed");
  const blob = decodeBase64(match[1], "release public key");
  return Object.freeze({ blob, key: parseEd25519KeyBlob(blob, "release public key") });
}

function parseSshSignature(bytes) {
  const text = decodeUtf8(bytes, "scientific evidence signature").replaceAll("\r\n", "\n");
  const match = /^-----BEGIN SSH SIGNATURE-----\n([A-Za-z0-9+/=\n]+)\n-----END SSH SIGNATURE-----\n$/.exec(text);
  assert(match, "scientific evidence signature armor changed");
  const encoded = match[1].replaceAll("\n", "");
  const blob = decodeBase64(encoded, "scientific evidence signature");
  const reader = sshReader(blob, "scientific evidence signature");
  assert(decodeUtf8(reader.bytes(6), "scientific evidence signature magic") === "SSHSIG", "scientific evidence signature magic changed");
  assert(reader.uint32() === 1, "scientific evidence signature version changed");
  const publicKeyBlob = reader.string();
  const namespace = decodeUtf8(reader.string(256), "scientific evidence signature namespace");
  const reserved = reader.string();
  const hashAlgorithm = decodeUtf8(reader.string(64), "scientific evidence signature hash algorithm");
  const signatureBlob = reader.string();
  reader.done();

  const signatureReader = sshReader(signatureBlob, "scientific evidence Ed25519 signature");
  const signatureAlgorithm = decodeUtf8(signatureReader.string(64), "scientific evidence signature algorithm");
  const signature = signatureReader.string(128);
  signatureReader.done();
  assert(signatureAlgorithm === "ssh-ed25519" && signature.byteLength === 64, "scientific evidence signature algorithm changed");
  return Object.freeze({ publicKeyBlob, namespace, reserved, hashAlgorithm, signature });
}

async function verifySshSignature(message, armoredSignature, publicKeyBytes, namespace) {
  const encoder = new TextEncoder();
  const publicKey = parseOpenSshEd25519PublicKey(publicKeyBytes);
  const parsed = parseSshSignature(armoredSignature);
  assert(equalBytes(parsed.publicKeyBlob, publicKey.blob), "scientific evidence signature key changed");
  assert(parsed.namespace === namespace, "scientific evidence signature namespace changed");
  assert(parsed.reserved.byteLength === 0, "scientific evidence signature reserved field changed");
  assert(parsed.hashAlgorithm === "sha512", "scientific evidence signature hash algorithm changed");
  const messageHash = new Uint8Array(await crypto.subtle.digest("SHA-512", message));
  const signedData = concatBytes(
    encoder.encode("SSHSIG"),
    sshString(encoder.encode(parsed.namespace)),
    sshString(parsed.reserved),
    sshString(encoder.encode(parsed.hashAlgorithm)),
    sshString(messageHash)
  );
  const key = await crypto.subtle.importKey("raw", publicKey.key, { name: "Ed25519" }, false, ["verify"]);
  assert(await crypto.subtle.verify({ name: "Ed25519" }, key, parsed.signature, signedData), "scientific evidence SSH signature rejected");
}

async function fetchBytes(path, maxBytes = 4 * 1024 * 1024) {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  assert(response.ok, path + " returned HTTP " + response.status);
  const length = Number(response.headers.get("content-length"));
  assert(!Number.isFinite(length) || length <= maxBytes, path + " exceeds the selected byte limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert(bytes.byteLength <= maxBytes, path + " exceeds the selected byte limit");
  return bytes;
}

function parseManifest(bytes, label, expectedEntries) {
  const lines = decodeUtf8(bytes, label).split(/\r?\n/).filter(Boolean);
  assert(lines.length === expectedEntries, label + " entry population changed");
  const entries = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    assert(match, label + " contains a malformed row");
    const manifestPath = match[2].startsWith("./") ? match[2].slice(2) : match[2];
    assert(manifestPath.length > 0 && !manifestPath.startsWith("/") && !manifestPath.includes("..") && !manifestPath.includes("\\"), label + " contains an unsafe path");
    assert(!entries.has(manifestPath), label + " contains a duplicate path");
    entries.set(manifestPath, match[1]);
  }
  return entries;
}

async function loadRelease(label, config) {
  const manifestBytes = await fetchBytes(config.root + "SHA256SUMS", 512 * 1024);
  assert(await sha256(manifestBytes) === config.manifestSha256, label + " integrity manifest changed");
  const manifest = parseManifest(manifestBytes, label + " integrity manifest", config.manifestEntries);
  const files = {};
  await Promise.all(config.files.map(async (path) => {
    const expected = manifest.get(path);
    assertDigest(expected, label + " manifest omits " + path);
    const bytes = await fetchBytes(config.root + path);
    assert(await sha256(bytes) === expected, label + " file changed: " + path);
    files[path] = path.endsWith(".json") ? parseJson(bytes, label + " " + path) : decodeUtf8(bytes, label + " " + path);
  }));
  return { config, manifest, files };
}

async function loadScientificEvidence() {
  const root = SCIENTIFIC_EVIDENCE.root;
  const [manifestBytes, signatureBytes, publicKeyBytes] = await Promise.all([
    fetchBytes(root + SCIENTIFIC_EVIDENCE.manifestPath, 16 * 1024),
    fetchBytes(root + SCIENTIFIC_EVIDENCE.signaturePath, 16 * 1024),
    fetchBytes(root + "release-ed25519.pub", 4 * 1024)
  ]);
  assert(await sha256(manifestBytes) === SCIENTIFIC_EVIDENCE.manifestSha256, "scientific evidence manifest changed");
  assert(await sha256(signatureBytes) === SCIENTIFIC_EVIDENCE.signatureSha256, "scientific evidence signature changed");
  assert(await sha256(publicKeyBytes) === SCIENTIFIC_EVIDENCE.files["release-ed25519.pub"], "scientific evidence public key changed");
  await verifySshSignature(manifestBytes, signatureBytes, publicKeyBytes, "mfenx-release");
  const expectedPaths = Object.keys(SCIENTIFIC_EVIDENCE.files).sort();
  const manifest = parseManifest(manifestBytes, "scientific evidence manifest", expectedPaths.length);
  assert(equalArray([...manifest.keys()], expectedPaths), "scientific evidence manifest population or order changed");
  const files = { "release-ed25519.pub": publicKeyBytes };
  await Promise.all(expectedPaths.filter((path) => path !== "release-ed25519.pub").map(async (path) => {
    const expected = SCIENTIFIC_EVIDENCE.files[path];
    assert(manifest.get(path) === expected, "scientific evidence manifest disagrees on " + path);
    const bytes = await fetchBytes(root + path, path === SCIENTIFIC_EVIDENCE.summaryPath ? 64 * 1024 : 32 * 1024);
    assert(await sha256(bytes) === expected, "scientific evidence file changed: " + path);
    files[path] = bytes;
  }));
  assert(manifest.get("release-ed25519.pub") === SCIENTIFIC_EVIDENCE.files["release-ed25519.pub"], "scientific evidence manifest disagrees on release-ed25519.pub");
  const publicKeyLine = decodeUtf8(publicKeyBytes, "release public key").trimEnd();
  assert(decodeUtf8(files["release-allowed-signers"], "release signer policy").trimEnd() ===
    'mfenx-release namespaces="mfenx-hpc-evidence,mfenx-release-materials,mfenx-release" ' + publicKeyLine,
  "release signer policy changed");
  assert(decodeUtf8(files["git-allowed-signers"], "Git signer policy").trimEnd() ===
    'lexluger.dev@proton.me namespaces="git" ' + publicKeyLine,
  "Git signer policy changed");
  assert(SCIENTIFIC_EVIDENCE.files[SCIENTIFIC_EVIDENCE.summaryPath] === SCIENTIFIC_EVIDENCE.summarySha256, "scientific summary cross-binding changed");
  return validateScientificEvidence(parseJson(files[SCIENTIFIC_EVIDENCE.summaryPath], "scientific evidence summary"));
}

function validateScientificEvidence(record) {
  const exact = (actual, expected, message) => {
    assert(JSON.stringify(actual) === JSON.stringify(expected), message);
  };
  const exactKeys = (actual, expected, message) => {
    assert(isRecord(actual) && equalArray(Object.keys(actual).sort(), [...expected].sort()), message);
  };
  exactKeys(record, [
    "schema", "release", "generated_at_utc", "product", "release_identity", "signing",
    "integrity", "verification", "history", "builds", "suite", "benchmark_sources",
    "capture_topology", "npb", "hpl", "hpcg", "stream", "osu"
  ], "scientific evidence top-level fields changed");
  assert(record.schema === SCIENTIFIC_EVIDENCE.schema && record.release === "0.1.6", "scientific evidence release identity changed");
  assert(/^2026-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(record.generated_at_utc)
    && Number.isFinite(Date.parse(record.generated_at_utc)), "scientific evidence generation time changed");
  exact(record.product, {
    name: "MFENX Lights Out",
    machine_class: "software-defined local supercomputer",
    execution_engines: ["QQfenx adaptive quotient-ring execution", "MFENX native IEEE FP64 HPC"],
    commercial_distribution: "proprietary"
  }, "scientific product identity changed");
  exact(record.release_identity, {
    tag: "v0.1.6",
    tag_object: "08a2b39f134e7a7d86d2ebae9865ee70c6e0e1d8",
    commit: "74699c9d2249bd55ce95e149e00940752b6ff260",
    root_tree: "64883826ed796ebc3363763e70ce66808d49672d",
    power_house_tree: "32feafbb998d90ee7aead03d14b4f9aabb141ed4",
    git_object_format: "sha1"
  }, "scientific release identity changed");
  exact(record.signing, {
    git: {
      principal: "lexluger.dev@proton.me",
      namespace: "git",
      fingerprint: "SHA256:Uhj/Ci2+3KA2JN/H8+Sl6nhAiTeD76zvajqvxLOYTTc"
    },
    release: {
      principal: "mfenx-release",
      namespaces: ["mfenx-hpc-evidence", "mfenx-release-materials", "mfenx-release"],
      fingerprint: "SHA256:Uhj/Ci2+3KA2JN/H8+Sl6nhAiTeD76zvajqvxLOYTTc"
    }
  }, "scientific signing identity changed");

  exactKeys(record.integrity, [
    "source_lock_sha256", "product_source_manifest_sha256", "evidence_suite_sha256",
    "suite_verification_sha256", "build_verification_sha256", "product_archive",
    "product_materials", "hpc_evidence", "release_assets", "security_assurance"
  ], "scientific integrity fields changed");
  assert(record.integrity.source_lock_sha256 === SCIENTIFIC_EVIDENCE.sourceLockSha256, "scientific source lock changed");
  assert(record.integrity.evidence_suite_sha256 === SCIENTIFIC_EVIDENCE.suiteSha256, "scientific suite identity changed");
  assert(record.integrity.product_source_manifest_sha256 === "6de246f03b5bca1426ce2553c74e678a454234f0cf563b5c662cf1e9e3f347ee", "product source manifest changed");
  assert(record.integrity.suite_verification_sha256 === "9460e292f5837db4272ac7251f5456dbf7a29d74dae1450604b6596fa094bbd3", "suite verification identity changed");
  assert(record.integrity.build_verification_sha256 === "b4886958817738037ccdcbbed3f1e6406e4a1e17df49e44053e091a919309e2e", "build verification identity changed");
  exact(record.integrity.product_archive, {
    filename: "mfenx-lights-out-v0.1.6-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "5285e2986c72c86c4743fbca2c127f5fcea5a35955b3f15384de2bbc78081316",
    signature_sha256: "95f4a9b1249645c638fae4214922ef7896d1622a06d9196946ae665d2a9b1593"
  }, "product archive identity changed");
  exact(record.integrity.product_materials, {
    release_sha256_sha256: "a9ed3213b528b09040d91b4f0a683d979800caf375b06eb7a9ae6680c03b5235",
    artifact_manifest_sha256: "e19e1c75203f7cf1e4a04a02bc5ec7b5bf4973278cdb5c7dded359c352e57d08"
  }, "product material identity changed");
  exact(record.integrity.hpc_evidence, {
    filename: "mfenx-lights-out-v0.1.6-hpc-evidence.tar.gz",
    archive_sha256: "8a9f85209cbd8c5ba98c3514084ec3e8dec96f33d59fe470dbf71f0b7e487686",
    bundle_manifest_sha256: "12f5934d045c2e708a3601eb5b897dc08e4669140e57c5ce4046eba5de40bfc5",
    bundle_closure_sha256: "4f33675cad279cd70d4e1749cc31ba32048ce5148b1ca651cf48ecfd5801f8ca",
    bundle_signature_sha256: "cbc754b2a5cb1868cca5b5b34a53c3ecbf3467f7e4041e37d8acfe74e490699c"
  }, "HPC evidence identity changed");
  exact(record.integrity.release_assets, {
    manifest_filename: "SHA256SUMS",
    manifest_sha256: "fce2166276caa075e452a0f2add62787579c97eb277605c248cda7564fe555a3",
    signature_filename: "SHA256SUMS.sig",
    signature_sha256: "3a83c9b1b41129a40d40c8cc71b36ecf203368d0745e534d83ff25fb80e4a400"
  }, "release asset closure identity changed");
  exact(record.integrity.security_assurance, {
    filename: "security-assurance-evidence.tar.gz",
    archive_sha256: "0d05649ece7bfcd0fdfa3a5ff97c5a55a7c0ca1f8d65fafd3944aa113aaa7447",
    signature_sha256: "208bf9ededd7f26a02092969f2e23ef91d240bb1b54e8a97f8456d134819fc3f"
  }, "Security Assurance archive identity changed");

  exactKeys(record.verification, ["release_verification", "security_assurance"], "verification fields changed");
  exact(record.verification.release_verification, {
    workflow: "Release Verification",
    run_id: 33234816536,
    attempt: 1,
    head_sha: "74699c9d2249bd55ce95e149e00940752b6ff260",
    conclusion: "success"
  }, "release verification identity changed");
  const expectedOutcomes = [
    "analysis-prerequisites", "toolchain-context", "workspace-build", "workspace-policy",
    "python-policy-tests", "cargo-audit", "cargo-deny", "rustfmt", "clippy", "unit-tests",
    "native-hpc", "hpc-evidence-harness", "native-qqfenx", "qqfenx-benchmark-smoke",
    "fuzz-lock", "fuzz-contract-control", "fuzz-qqfenx-contract", "fuzz-tensor-manifest",
    "fuzz-reproducers", "fuzz-lock-integrity", "static-policy"
  ];
  exact(record.verification.security_assurance, {
    workflow: "Security Assurance",
    run_id: 33237688176,
    attempt: 2,
    head_sha: "74699c9d2249bd55ce95e149e00940752b6ff260",
    tag: "v0.1.6",
    conclusion: "success",
    outcomes: expectedOutcomes.map((name) => ({ name, conclusion: "success" }))
  }, "Security Assurance identity changed");

  exact(record.history, {
    supporting_builds: 15, accepted_attempts: 25, rejected_attempts: 1,
    superseded_attempts: 2, quarantined_builds: 3, total_records: 46, status: "complete"
  }, "scientific evidence history changed");
  exact(record.builds, { verified: 15, total: 15, status: "pass" }, "scientific build verification changed");
  exact(record.suite, {
    measured: 26, accepted: 25, retained_rejected: 1, status: "valid",
    population: "active_suite", bundle_record_count: 46, history_status: "complete"
  }, "scientific suite totals changed");
  exact(record.benchmark_sources, [
    { id: "hpl", name: "High-Performance Linpack", version: "2.3", sha256: "32c5c17d22330e6f2337b681aded51637fb6008d3f0eb7c277b163fadd612830", url: "https://netlib.org/benchmark/hpl/" },
    { id: "hpcg", name: "HPCG", version: "3.1", sha256: "33a434e716b79e59e745f77ff72639c32623e7f928eeb7977655ffcaade0f4a4", url: "https://www.hpcg-benchmark.org/software/" },
    { id: "npb", name: "NAS Parallel Benchmarks", version: "3.4.4", sha256: "1ae219398e02a0a79ad51b7460fcffbf7b5df83a69d5d3d3a9dc2d8acf523549", url: "https://www.nas.nasa.gov/software/npb.html" },
    { id: "stream", name: "STREAM", version: "5.10", sha256: "a52bae5e175bea3f7832112af9c085adab47117f7d2ce219165379849231692b", url: "https://www.cs.virginia.edu/stream/ref.html" },
    { id: "osu", name: "OSU Micro-Benchmarks", version: "7.5.2", sha256: "618de3d0b1122f73a9229177d2da1e5cd62e431190580cb915f2605849cbbbdc", url: "https://mvapich.cse.ohio-state.edu/benchmarks/" }
  ], "benchmark source identities changed");
  exact(record.capture_topology, {
    physical_nodes: 1, worker_slots: 4, threaded_profile: "1 rank x 4 threads",
    mpi_profile: "4 ranks x 1 thread", collective_profile: "2 ranks x 1 thread"
  }, "scientific capture topology changed");
  exact(record.npb, {
    name: "NAS Parallel Benchmarks", version: "3.4.4", class: "A", role: "upstream_system_qualification",
    kernels: ["CG", "MG", "FT", "EP", "IS", "BT", "SP", "LU"],
    openmp: { topology: "1 rank x 4 threads", verified: 8, total: 8 },
    mpi: { topology: "4 ranks x 1 thread", verified: 8, total: 8 },
    verification: { passed: 16, total: 16, status: "pass" }
  }, "NPB evidence changed");
  exact(record.hpl, {
    name: "High-Performance Linpack", version: "2.3",
    geometry: { n: 1024, nb: 64, p: 2, q: 2, ranks: 4 },
    mfenx: { gflop_s: 4.3438, scaled_residual: 0.00426987511, residual_status: "pass", runtime_provider_processes: 4 },
    openblas_comparator: { gflop_s: 9.1858, scaled_residual: 0.00716583107, residual_status: "pass" }
  }, "HPL evidence changed");
  exact(record.hpcg, {
    name: "HPCG", version: "3.1", comparison: "same-host point capture", topology: "2 ranks x 1 thread",
    mfenx: { gflop_s: 3.38003, raw_total_gb_s: 27.0054, valid: true },
    stock: { gflop_s: 2.81253, raw_total_gb_s: 22.2204, valid: true },
    mfenx_delta_percent: { gflop_s: 20.178, raw_total_gb_s: 21.534 }
  }, "HPCG evidence changed");
  exact(record.stream, {
    name: "STREAM", version: "5.10", mfenx_profile: "tuned STREAM 5.10",
    comparison: "same-host point capture", topology: "1 rank x 4 threads", unit: "MB/s",
    mfenx: { copy: 11808.9, scale: 11428.6, add: 13560.8, triad: 13678.4 },
    stock: { copy: 15463.6, scale: 12156.1, add: 11104.5, triad: 12414.5 },
    mfenx_delta_percent: { copy: -23.634, scale: -5.985, add: 22.120, triad: 10.181 },
    provider_telemetry: { threads: 4, calls_per_kernel: 20, elements_per_kernel: 200000000, status: "pass" }
  }, "STREAM evidence changed");
  exact(record.osu, {
    name: "OSU Micro-Benchmarks", version: "7.5.2", topology: "2 ranks x 1 thread",
    message_sizes_bytes: [8, 16, 32, 64, 128, 256, 512, 1024],
    broadcast_f64: {
      rows_passed: 8, rows_total: 8, calls_per_rank: 56, elements_per_rank: 1785,
      bytes_per_rank: 14280, latency_us_range: [1.28, 1.75], telemetry_status: "pass"
    },
    allreduce_sum_f64: {
      rows_passed: 8, rows_total: 8, calls_per_rank: 56, in_place_calls_per_rank: 56,
      elements_per_rank: 1785, bytes_per_rank: 14280, latency_us_range: [1.44, 2.19], telemetry_status: "pass"
    }
  }, "OSU evidence changed");
  return record;
}

function parseChecksumLine(text, expectedTarget, label) {
  const match = /^([0-9a-f]{64})  ([^\r\n]+)\r?\n?$/.exec(text);
  assert(match && match[2] === expectedTarget, label + " checksum record changed");
  return match[1];
}

function validateCommonRelease(release, expectedSchema, expectedClass, expectedWallNs) {
  const files = release.files;
  const acceptance = files["acceptance.json"];
  const result = files["artifacts/uninterrupted.result.json"];
  const resumed = files["artifacts/resumed.result.json"];
  const standalone = files["artifacts/uninterrupted.verify.json"];
  const memory = files["provenance/memory-summary.json"];
  const lane = files["provenance/lane-overlap.json"];
  const workloadContract = files["provenance/workload-contract.json"];
  const workload = acceptance.workload;
  const postKill = files["provenance/post-kill-receipts.json"];
  const postResume = files["provenance/post-resume-checkpoint.json"];
  assert(acceptance.schema_version === expectedSchema && acceptance.status === "PASS" && acceptance.release_acceptance === true, "execution acceptance identity changed");
  assert(acceptance.machine.machine_class === expectedClass && acceptance.machine.isa_version === 6 && acceptance.machine.opcode === "streamed_i32_gemm", "execution machine identity changed");
  assert(acceptance.machine.gpu_devices_required === 0 && acceptance.machine.network_transports_required === 0, "execution dependency identity changed");
  assert(parseChecksumLine(files["provenance/binary.sha256"], "bin/mfenx-local", "binary") === acceptance.binary_sha256, "binary identity disagrees");
  assert(parseChecksumLine(files["provenance/source-root.sha256"], "provenance/source-before.sha256", "source") === acceptance.source_tree_sha256, "source identity disagrees");
  for (const [key, value] of Object.entries(workloadContract)) {
    assert(JSON.stringify(acceptance.workload[key]) === JSON.stringify(value), "workload record disagrees on " + key);
  }
  assert(equalArray(workload.left_shape, EXPECTED.leftShape) && equalArray(workload.right_shape, EXPECTED.rightShape), "workload shapes changed");
  assert(workload.logical_input_bytes === EXPECTED.logicalInputBytes && workload.lanes === 2 && workload.total_pieces === 2, "workload geometry changed");
  assert(workload.input_more_than_four_times_managed === true && workload.logical_input_bytes > 4 * workload.certified_managed_peak_bytes, "workload memory scale changed");
  for (const captured of [result, resumed]) {
    assert(captured.outputs[0].tensor.manifest_digest === EXPECTED.outputRoot, "output root changed");
    assert(equalArray(captured.outputs[0].tensor.ty.shape, EXPECTED.outputShape) && captured.outputs[0].tensor.byte_length === EXPECTED.outputBytes, "output tensor changed");
    assert(captured.verification.verified === true && captured.verification.verification_integer_operations === EXPECTED.usefulOperations, "embedded exact replay changed");
    assert(captured.metrics.useful_integer_operations === EXPECTED.usefulOperations, "logical operation count changed");
  }
  assert(result.metrics.physical_integer_operations === EXPECTED.physicalOperations, "fresh-run operation count changed");
  assert(resumed.metrics.executed_primary_integer_operations > 0
    && resumed.metrics.executed_primary_integer_operations < EXPECTED.usefulOperations
    && resumed.metrics.physical_integer_operations === resumed.metrics.executed_primary_integer_operations + resumed.verification.verification_integer_operations,
  "resumed operation accounting changed");
  assert(standalone.verified === true && standalone.verification_integer_operations === EXPECTED.usefulOperations && standalone.bytes_checked === EXPECTED.outputBytes, "standalone exact replay changed");
  assert(acceptance.uninterrupted_output_root === EXPECTED.outputRoot && acceptance.resumed_output_root === EXPECTED.outputRoot, "accepted roots changed");
  assert(memory.external_timings["uninterrupted-run"].wall_ns === expectedWallNs && memory.external_timings["uninterrupted-run"].exit_status === 0, "external timing changed");
  assert(memory.virtual_memory_within_external_limit === true && memory.maxima_kib.VmSwap_kib === 0, "memory record changed");
  assert(lane.overlap_proven === true && lane.configured_lanes === 2 && new Set(lane.witness.tasks.map((task) => task.lane_index)).size === 2, "lane overlap record changed");
  assert(postKill.receipt_count === 1 && postKill.expected_total_pieces === 2 && postResume.entries.length === 2, "recovery record changed");
  return { acceptance, result, resumed, standalone, memory, lane, workload, workloadContract, postKill, postResume };
}

function validateV2(release) {
  const validated = validateCommonRelease(release, 3, "software_defined_local_supercomputer_v2", EXPECTED.v2ExternalWallNs);
  const { acceptance, result, resumed } = validated;
  assert(acceptance.workload.certified_managed_peak_bytes === EXPECTED.managedPeakBytes, "v2 managed-memory certificate changed");
  assert(result.metrics.executed_pieces === 2 && result.metrics.reused_pieces === 0, "v2 fresh partition changed");
  assert(resumed.metrics.executed_pieces === 1 && resumed.metrics.reused_pieces === 1, "v2 resumed partition changed");
  const probes = {
    input_chunk: "corrupt-input-chunk", checkpoint_piece: "corrupt-checkpoint-piece",
    checkpoint_receipt: "corrupt-checkpoint-receipt", image: "corrupt-image", result: "corrupt-result"
  };
  for (const [probe, timing] of Object.entries(probes)) {
    assert(acceptance.corruption_rejection[probe] === "passed" && validated.memory.external_timings[timing].exit_status === 1, probe + " mutation record changed");
  }
  return validated;
}

function validateV1(release) {
  return validateCommonRelease(release, 2, "software_defined_local_supercomputer_v1", EXPECTED.v1ExternalWallNs);
}

function validateComparison(v1, v2) {
  assert(equalArray(v1.workload.left_shape, v2.workload.left_shape) && equalArray(v1.workload.right_shape, v2.workload.right_shape), "comparison shapes differ");
  assert(v1.workload.logical_input_bytes === v2.workload.logical_input_bytes && v1.workload.lanes === v2.workload.lanes, "comparison geometry differs");
  assert(v1.result.metrics.useful_integer_operations === v2.result.metrics.useful_integer_operations, "comparison operation counts differ");
  assert(v1.result.outputs[0].tensor.manifest_digest === v2.result.outputs[0].tensor.manifest_digest, "comparison roots differ");
  assert(v1.memory.external_timings["uninterrupted-run"].observer === v2.memory.external_timings["uninterrupted-run"].observer, "comparison timing observers differ");
}

function setCheck(name, status, text) {
  const row = document.querySelector("[data-check='" + name + "']");
  if (!row) return;
  row.className = status;
  row.querySelector("b").textContent = text;
}

function releaseState(status, text) {
  const node = byId("release-state");
  node.className = "release-state " + status;
  node.querySelector("span").textContent = text;
}

function updateClock() {
  byId("utc-clock").textContent = new Date().toISOString().slice(11, 19) + " UTC";
}

function humanBytes(value, decimals = 2) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return amount.toFixed(index === 0 ? 0 : decimals) + " " + units[index];
}

function seconds(ns) {
  return (ns / 1e9).toFixed(3) + " s";
}

function shortHash(value) {
  return value.slice(0, 8) + "…" + value.slice(-5);
}

function assignmentLabel(assignments) {
  return assignments.map((entry) => "piece " + entry.piece_index + " / lane " + entry.lane_index).join(", ");
}

function clearEvidenceDisplays() {
  for (const node of document.querySelectorAll("[data-scientific-values]")) node.hidden = true;
  for (const id of [
    "evidence-capture", "evidence-builds", "evidence-suite", "evidence-source-lock",
    "scientific-build-total", "scientific-suite-total", "scientific-accepted-total",
    "scientific-history-total", "npb-result-total", "hpcg-mfenx", "hpcg-stock",
    "hpcg-delta", "hpl-mfenx", "hpl-openblas", "scientific-summary-hash",
    "logical-input", "memory-ratio", "managed-peak", "lane-count", "peak-rss",
    "swap-used", "gpu-count", "network-count", "kill-time", "output-root",
    "uninterrupted-assignments", "retained-assignments", "reused-assignments",
    "executed-assignments"
  ]) {
    const node = byId(id);
    node.textContent = "—";
    node.removeAttribute("title");
  }
  for (const prefix of ["admission", "primary", "replay", "output"]) {
    for (const field of ["auth", "requested", "loads", "hits"]) {
      byId("io-" + prefix + "-" + field).textContent = "—";
    }
  }
  for (const card of document.querySelectorAll("[data-probe]")) {
    card.className = "";
    card.querySelector("b").textContent = "—";
  }
  byId("capture-footer").textContent = "release evidence pending";
}

function displayScientific(record) {
  const generated = new Date(record.generated_at_utc);
  for (const node of document.querySelectorAll("[data-scientific-values]")) node.hidden = false;
  byId("release-verdict").textContent = "PASS";
  byId("release-verdict").className = "pass";
  byId("evidence-capture").textContent = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).format(generated) + " UTC";
  byId("evidence-builds").textContent = record.builds.verified + " / " + record.builds.total + " PASS";
  byId("evidence-suite").textContent = record.suite.accepted + " accepted · complete " + record.suite.bundle_record_count + "-record history";
  byId("evidence-source-lock").textContent = shortHash(record.integrity.source_lock_sha256);
  byId("evidence-source-lock").title = record.integrity.source_lock_sha256;
  byId("scientific-build-total").textContent = record.builds.verified + " / " + record.builds.total;
  byId("scientific-suite-total").textContent = String(record.suite.measured);
  byId("scientific-accepted-total").textContent = String(record.suite.accepted);
  byId("scientific-history-total").textContent = String(record.suite.bundle_record_count);
  byId("npb-result-total").textContent = record.npb.verification.passed + " / " + record.npb.verification.total;
  byId("hpcg-mfenx").textContent = record.hpcg.mfenx.gflop_s.toFixed(5) + " GF/s";
  byId("hpcg-stock").textContent = record.hpcg.stock.gflop_s.toFixed(5) + " GF/s";
  byId("hpcg-delta").textContent = "+" + record.hpcg.mfenx_delta_percent.gflop_s.toFixed(3) + "%";
  byId("hpl-mfenx").textContent = record.hpl.mfenx.gflop_s.toFixed(4) + " GF/s";
  byId("hpl-openblas").textContent = record.hpl.openblas_comparator.gflop_s.toFixed(4) + " GF/s";
  byId("scientific-summary-hash").textContent = shortHash(SCIENTIFIC_EVIDENCE.summarySha256);
  byId("scientific-summary-hash").title = SCIENTIFIC_EVIDENCE.summarySha256;
  byId("capture-footer").textContent = "SCIENTIFIC EVIDENCE GENERATED · " + generated.toISOString();
}

function displayIo(prefix, counter) {
  byId("io-" + prefix + "-auth").textContent = humanBytes(counter.authenticated_chunk_bytes);
  byId("io-" + prefix + "-requested").textContent = humanBytes(counter.requested_bytes);
  byId("io-" + prefix + "-loads").textContent = counter.chunk_loads.toLocaleString("en-US");
  byId("io-" + prefix + "-hits").textContent = counter.cache_hits.toLocaleString("en-US");
}

function displayV2(validated) {
  const { acceptance, result, resumed, memory, lane, postKill } = validated;
  const workload = acceptance.workload;
  byId("logical-input").textContent = humanBytes(workload.logical_input_bytes);
  byId("memory-ratio").textContent = (workload.logical_input_bytes / workload.certified_managed_peak_bytes).toFixed(3) + "×";
  byId("managed-peak").textContent = humanBytes(workload.certified_managed_peak_bytes);
  byId("lane-count").textContent = new Set(lane.witness.tasks.map((task) => task.lane_index)).size + " / " + lane.configured_lanes;
  byId("peak-rss").textContent = humanBytes(memory.maxima_kib.VmHWM_kib * 1024);
  byId("swap-used").textContent = humanBytes(memory.maxima_kib.VmSwap_kib * 1024, 0);
  byId("gpu-count").textContent = String(acceptance.syscall_trace.product_gpu_device_paths);
  byId("network-count").textContent = String(acceptance.syscall_trace.product_network_syscalls);
  byId("kill-time").textContent = seconds(memory.external_timings["killed-run"].wall_ns);
  byId("output-root").textContent = acceptance.uninterrupted_output_root;
  byId("uninterrupted-assignments").textContent = assignmentLabel(result.metrics.executed_assignments);
  byId("retained-assignments").textContent = assignmentLabel(postKill.receipt_assignments);
  byId("reused-assignments").textContent = assignmentLabel(resumed.metrics.reused_assignments);
  byId("executed-assignments").textContent = assignmentLabel(resumed.metrics.executed_assignments);
  const io = workload.io_accounting.actual;
  displayIo("admission", io.admission_input_io);
  displayIo("primary", io.primary_input_io);
  displayIo("replay", io.verification_input_io);
  displayIo("output", io.verification_output_io);
  const probes = {
    input_chunk: "corrupt-input-chunk", checkpoint_piece: "corrupt-checkpoint-piece",
    checkpoint_receipt: "corrupt-checkpoint-receipt", image: "corrupt-image", result: "corrupt-result"
  };
  for (const [probe, timing] of Object.entries(probes)) {
    const card = document.querySelector("[data-probe='" + probe + "']");
    const passed = acceptance.corruption_rejection[probe] === "passed" && memory.external_timings[timing].exit_status === 1;
    card.className = passed ? "pass" : "fail";
    card.querySelector("b").textContent = passed ? "BLOCKED · EXIT 1" : "CHECK FAILED";
  }
}

function clearComparison() {
  for (const id of [
    "v2-wall", "v1-wall", "release-speedup", "v1-e2e", "v2-e2e", "ratio-e2e",
    "v1-execution", "v2-execution", "ratio-execution", "v1-finalization",
    "v2-finalization", "ratio-finalization", "v1-verification", "v2-verification", "ratio-verification"
  ]) byId(id).textContent = "—";
  byId("release-reduction").textContent = "waiting for both releases";
}

function displayComparison(v1, v2) {
  const v1Wall = v1.memory.external_timings["uninterrupted-run"].wall_ns;
  const v2Wall = v2.memory.external_timings["uninterrupted-run"].wall_ns;
  byId("v1-wall").textContent = seconds(v1Wall);
  byId("v2-wall").textContent = seconds(v2Wall);
  byId("release-speedup").textContent = (v1Wall / v2Wall).toFixed(10) + "×";
  byId("release-reduction").textContent = (100 * (1 - v2Wall / v1Wall)).toFixed(6) + "% less external wall";
  const phases = [
    ["e2e", v1.result.metrics.end_to_end_ns, v2.result.metrics.end_to_end_ns],
    ["execution", v1.result.metrics.execution_ns, v2.result.metrics.execution_ns],
    ["finalization", v1.result.metrics.finalization_ns, v2.result.metrics.finalization_ns],
    ["verification", v1.result.verification.verification_ns, v2.result.verification.verification_ns]
  ];
  for (const [name, before, after] of phases) {
    byId("v1-" + name).textContent = seconds(before);
    byId("v2-" + name).textContent = seconds(after);
    byId("ratio-" + name).textContent = (before / after).toFixed(3) + "×";
  }
}

function assertCommercialUiPolicy() {
  for (const link of document.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") || "";
    assert(!BLOCKED_SOFTWARE_HREF.test(href), "active UI exposes a restricted software distribution path");
    assert(!link.hasAttribute("download"), "active UI exposes a direct software download control");
  }
}

async function loadAndValidate() {
  if (state.loading) return;
  state.loading = true;
  state.ready = false;
  clearEvidenceDisplays();
  clearComparison();
  releaseState("pending", "hashing scientific and execution evidence");
  byId("release-verdict").textContent = "CHECKING";
  byId("release-verdict").className = "";
  byId("rerun-verification").disabled = true;
  byId("rerun-verification").textContent = "checking…";
  for (const name of CHECK_NAMES) setCheck(name, "", "checking");
  try {
    const [scientific, v2Release, v1Release] = await Promise.all([
      loadScientificEvidence(), loadRelease("v2", RELEASES.v2), loadRelease("v1", RELEASES.v1)
    ]);
    setCheck("scientific-digest", "pass", "SHA-256 PASS");
    setCheck("scientific-builds", "pass", "15 / 15 PASS");
    setCheck("scientific-suite", "pass", "25 accepted · complete 46-record history");
    setCheck("npb", "pass", "16 / 16 PASS");
    setCheck("hpl-hpcg", "pass", "residuals + topology PASS");
    setCheck("stream-osu", "pass", "metrics + telemetry PASS");
    const v2 = validateV2(v2Release);
    const v1 = validateV1(v1Release);
    setCheck("v2-pack", "pass", RELEASES.v2.files.length + " / " + RELEASES.v2.files.length + " selected files");
    setCheck("v1-pack", "pass", RELEASES.v1.files.length + " / " + RELEASES.v1.files.length + " selected files");
    validateComparison(v1, v2);
    setCheck("comparison", "pass", "same workload · same root");
    Object.assign(state, { scientific, v2, v1, ready: true });
    displayScientific(scientific);
    displayV2(v2);
    displayComparison(v1, v2);
    byId("verification-copy").textContent = "The signed scientific publication pack and every selected v2/v1 execution file match their pinned SHA-256 identities. Workload geometry, benchmark results, provider telemetry where applicable, exact replay, recovery, and matching result roots passed the browser checks.";
    releaseState("pass", "Lights Out evidence verified");
  } catch (error) {
    Object.assign(state, { scientific: null, v2: null, v1: null, ready: false });
    clearEvidenceDisplays();
    clearComparison();
    byId("release-verdict").textContent = "REJECTED";
    byId("release-verdict").className = "fail";
    for (const name of CHECK_NAMES) {
      const row = document.querySelector("[data-check='" + name + "']");
      if (!row.className) setCheck(name, "fail", "rejected");
    }
    byId("verification-copy").textContent = error instanceof Error ? error.message : "Evidence verification failed";
    releaseState("fail", "published evidence rejected");
  } finally {
    state.loading = false;
    byId("rerun-verification").disabled = false;
    byId("rerun-verification").textContent = "rerun browser checks";
  }
}

async function copyCommands() {
  const button = byId("copy-commands");
  try {
    await navigator.clipboard.writeText(byId("run-commands").textContent);
    button.textContent = "copied";
  } catch {
    button.textContent = "select + copy";
  }
  window.setTimeout(() => { button.textContent = "copy commands"; }, 1800);
}

assertCommercialUiPolicy();
byId("verify-release").addEventListener("click", () => {
  byId("verify").scrollIntoView({ behavior: "smooth", block: "start" });
  loadAndValidate();
});
byId("rerun-verification").addEventListener("click", loadAndValidate);
byId("copy-commands").addEventListener("click", copyCommands);
window.__MFENX_LIGHTS_OUT__ = Object.freeze({ validateScientificEvidence, validateV2, validateV1, validateComparison });
updateClock();
window.setInterval(updateClock, 1000);
loadAndValidate();
