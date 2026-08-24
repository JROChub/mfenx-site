"use strict";

const RELEASES = Object.freeze({
  v2: Object.freeze({
    root: "release/",
    manifestSha256: "71033d917be233ea260417a1f7521c8098f27715475ad0ddf8318a5ecf2fd966",
    manifestEntries: 1307,
    files: Object.freeze([
      "acceptance.json",
      "artifacts/gemm.inspect.json",
      "artifacts/gemm.mfx.json",
      "artifacts/resumed.result.json",
      "artifacts/resumed.verify.json",
      "artifacts/uninterrupted.result.json",
      "artifacts/uninterrupted.verify.json",
      "checkpoints/killed-and-resumed/plan.json",
      "checkpoints/killed-and-resumed/receipt-00000000.json",
      "checkpoints/killed-and-resumed/receipt-00000001.json",
      "provenance/binary.sha256",
      "provenance/containment-probes.txt",
      "provenance/containment.txt",
      "provenance/lane-overlap.json",
      "provenance/memory-summary.json",
      "provenance/post-kill-receipts.json",
      "provenance/post-resume-checkpoint.json",
      "provenance/resumed-io-counters.json",
      "provenance/source-root.sha256",
      "provenance/trace-summary.json",
      "provenance/uninterrupted-io-counters.json",
      "provenance/workload-contract.json"
    ])
  }),
  v1: Object.freeze({
    root: "release-v1/",
    manifestSha256: "3a08e8a61b6eb0a9cec94959fa5b666ff1441de6c310b07f388e9ce57a80296d",
    manifestEntries: 1298,
    files: Object.freeze([
      "acceptance.json",
      "artifacts/gemm.inspect.json",
      "artifacts/gemm.mfx.json",
      "artifacts/resumed.result.json",
      "artifacts/resumed.verify.json",
      "artifacts/uninterrupted.result.json",
      "artifacts/uninterrupted.verify.json",
      "checkpoints/killed-and-resumed/plan.json",
      "checkpoints/killed-and-resumed/receipt-00000000.json",
      "checkpoints/killed-and-resumed/receipt-00000001.json",
      "provenance/binary.sha256",
      "provenance/containment-probes.txt",
      "provenance/containment.txt",
      "provenance/lane-overlap.json",
      "provenance/memory-summary.json",
      "provenance/post-kill-receipts.json",
      "provenance/post-resume-checkpoint.json",
      "provenance/source-root.sha256",
      "provenance/trace-summary.json",
      "provenance/workload-contract.json"
    ])
  })
});

const CONTRACT_V1 = Object.freeze({
  root: "contract-v1/",
  transportManifestSha256: "22c6fd54d3429ca2c380fb523cbc4ddfc76c872e35ded703ce4dc95f3f123755",
  files: Object.freeze([
    "CANONICAL_FORMATS_V1.md",
    "EXECUTION_CONTRACT_V1.md",
    "THREAT_MODEL.md",
    "conformance/README.md",
    "conformance/SHA256SUMS",
    "conformance/vectors.json"
  ])
});

// Publication is fail-closed until the release signer supplies the four exact
// hashes. The repository validator also authenticates the detached signature
// with OpenSSH before this site can deploy.
const COMMERCIAL_STATUS = Object.freeze({
  root: "current-release/",
  recordPath: "COMMERCIAL-STATUS.canonical.json",
  signaturePath: "COMMERCIAL-STATUS.canonical.json.sig",
  publicKeyPath: "release-signing-key.pub",
  allowedSignersPath: "allowed_signers",
  recordSha256: "f1ae5c040867534bf57f6a350318805f086691a7d8d67126911984000e4ee4e8",
  detachedSignatureSha256: "464c66f434ff30aec6c512c11dbee4d2572845c6f271399ac75fcf52cf5b0c9c",
  publicKeySha256: "0f7c5f5eacc52b9f5c54eb7a5166e7e8e0a5a5b73d9a23f94dc9e2bdad244426",
  allowedSignersSha256: "cfec795857dd01e48eb4a9d62b1ed0e2af5a6edbc95ed30542afa17b8e9e3e95",
  namespace: "mfenx-commercial-status",
  principal: "mfenx-release",
  publicKeyFingerprint: "SHA256:Uhj/Ci2+3KA2JN/H8+Sl6nhAiTeD76zvajqvxLOYTTc"
});

// Frozen records retain historical distribution identities, but the active
// commercial product page must never turn those identities into software
// delivery links. Executable bytes are also excluded from browser retrieval.
const BLOCKED_ACTIVE_DISTRIBUTION_ROLES = Object.freeze([
  "commercial_evaluation_distribution_archive",
  "commercial_evaluation_distribution_archive_sidecar",
  "validation_candidate_signed_archive"
]);
const BLOCKED_ACTIVE_DISTRIBUTION_HREF = /(?:^|\/)(?:candidate\/downloads\/|release(?:-v1)?\/bin\/mfenx-local)|commercial_evaluation_distribution_archive|\.tar\.zst(?:$|[?#])/i;

function isBlockedActiveDistribution(role, href = "") {
  return BLOCKED_ACTIVE_DISTRIBUTION_ROLES.includes(role)
    || BLOCKED_ACTIVE_DISTRIBUTION_HREF.test(href);
}

function assertCommercialUiBoundary() {
  for (const link of document.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") || "";
    assert(!isBlockedActiveDistribution("", href), "active UI exposes a restricted software distribution path");
    assert(!link.hasAttribute("download"), "active UI exposes a direct software download control");
  }
  for (const link of document.querySelectorAll("[data-commercial-resource]")) {
    assert(!isBlockedActiveDistribution(link.dataset.commercialResource), "active UI exposes a restricted evidence role");
  }
}

const V2_CONTRACT = Object.freeze({
  acceptanceSchema: 3,
  imageSchema: 3,
  isaVersion: 6,
  resultSchema: 3,
  resourceCertificateSchema: 5,
  checkpointPlanSchema: 2,
  pieceReceiptSchema: 2,
  laneScheduleSchema: 1,
  laneSchedulePolicy: "deterministic_striped_v1",
  machineClass: "software_defined_local_supercomputer_v2",
  backend: "rarecomp_mfenx_local_cpu_lane_engine",
  dataflow: "contiguous_right_panels_v2",
  opcode: "streamed_i32_gemm",
  verificationMethod: "parallel_independently_addressed_exact_replay_v2"
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
  retainedStorageBytes: 276959904,
  outputRoot: "4691a345a8818af410da311bc4d79131dcd093ff47384e71d4832ca08fed638c",
  v2ExternalWallNs: 5608764486,
  v1ExternalWallNs: 276103268901,
  admissionIo: Object.freeze({
    requested_bytes: 0,
    authenticated_chunk_bytes: 234881696,
    chunk_loads: 225,
    cache_hits: 0
  }),
  primaryIo: Object.freeze({
    requested_bytes: 469762720,
    authenticated_chunk_bytes: 469763392,
    chunk_loads: 450,
    cache_hits: 0
  }),
  verificationInputIo: Object.freeze({
    requested_bytes: 469762720,
    authenticated_chunk_bytes: 469763392,
    chunk_loads: 450,
    cache_hits: 1
  }),
  verificationOutputIo: Object.freeze({
    requested_bytes: 12582912,
    authenticated_chunk_bytes: 12582912,
    chunk_loads: 12,
    cache_hits: 0
  }),
  resumedPrimaryIo: Object.freeze({
    requested_bytes: 234881472,
    authenticated_chunk_bytes: 234881696,
    chunk_loads: 225,
    cache_hits: 0
  })
});

const CHECKPOINT_ROOT = "checkpoints/killed-and-resumed/";
const CHECKPOINT_PLAN_PATH = CHECKPOINT_ROOT + "plan.json";
const state = { loading: false, ready: false, v2: null, v1: null, commercialStatus: null };
const byId = (id) => document.getElementById(id);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equalArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function equalJson(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return equalArray(leftKeys, rightKeys)
    && leftKeys.every((key) => equalJson(left[key], right[key]));
}

function assertSafeInteger(value, message, minimum = 0) {
  assert(Number.isSafeInteger(value) && value >= minimum, message);
}

function assertDigest(value, message) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), message);
}

function decodeUtf8(bytes, path) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(path + " is not valid UTF-8");
  }
}

function parseJson(bytes, path) {
  try {
    return JSON.parse(decodeUtf8(bytes, path));
  } catch (error) {
    throw new Error(path + " is not valid JSON: " + error.message);
  }
}

function parseManifest(bytes, label, expectedEntries) {
  const entries = new Map();
  const lines = decodeUtf8(bytes, label + "/SHA256SUMS").split("\n");
  if (lines.at(-1) === "") lines.pop();

  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([^\r\n]+)$/.exec(line);
    assert(match, label + " SHA256SUMS contains a malformed record");
    const rawPath = match[2];
    const path = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
    const parts = path.split("/");
    assert(
      !rawPath.startsWith("/")
      && !path.includes("\\")
      && parts.every((part) => part && part !== "." && part !== ".."),
      label + " SHA256SUMS contains an unsafe path"
    );
    assert(!entries.has(path), label + " SHA256SUMS contains a duplicate path");
    entries.set(path, match[1]);
  }

  assert(entries.size === expectedEntries, label + " SHA256SUMS entry count changed");
  return entries;
}

function parseChecksumRecord(bytes, label, expectedTarget) {
  const match = /^([0-9a-f]{64})  ([^\r\n]+)\n?$/.exec(decodeUtf8(bytes, label));
  assert(match, label + " is not one canonical SHA-256 record");
  const target = match[2].startsWith("./") ? match[2].slice(2) : match[2];
  assert(target === expectedTarget, label + " names an unexpected target");
  return match[1];
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchBytes(root, path, maxBytes = 4 * 1024 * 1024) {
  const response = await fetch(root + path, { cache: "no-store", redirect: "error" });
  assert(response.ok, root + path + " returned HTTP " + response.status);
  assert(new URL(response.url).origin === location.origin, root + path + " left this origin");
  const declaredLength = Number(response.headers.get("Content-Length"));
  assert(!Number.isFinite(declaredLength) || declaredLength <= maxBytes, root + path + " exceeds its byte limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert(bytes.byteLength <= maxBytes, root + path + " exceeds its byte limit");
  return bytes;
}

const EXPECTED_COMMERCIAL_SCALING = Object.freeze([
  Object.freeze(["cold_unprimed", 1, "distinct_physical_cores", "14562316443.5", "1.000000"]),
  Object.freeze(["cold_unprimed", 2, "distinct_physical_cores", "12294541476.0", "1.184454"]),
  Object.freeze(["cold_unprimed", 4, "distinct_physical_cores", "11072497582.0", "1.315179"]),
  Object.freeze(["cold_unprimed", 8, "oversubscribed_round_robin", "11899606585.0", "1.223765"]),
  Object.freeze(["cold_unprimed", 16, "oversubscribed_round_robin", "12812258960.5", "1.136592"]),
  Object.freeze(["warm_primed", 1, "distinct_physical_cores", "14017605601.0", "1.000000"]),
  Object.freeze(["warm_primed", 2, "distinct_physical_cores", "12094623824.0", "1.158995"]),
  Object.freeze(["warm_primed", 4, "distinct_physical_cores", "11547331715.5", "1.213926"]),
  Object.freeze(["warm_primed", 8, "oversubscribed_round_robin", "11632124791.5", "1.205077"]),
  Object.freeze(["warm_primed", 16, "oversubscribed_round_robin", "12200400739.0", "1.148946"])
]);

function assertExactKeys(value, keys, label) {
  assert(isRecord(value), label + " must be an object");
  assert(equalArray(Object.keys(value).sort(), [...keys].sort()), label + " property set changed");
  return value;
}

function validateCommercialStatus(record) {
  assertExactKeys(record, [
    "schema", "record_id", "effective_at_utc", "encoding_profile", "product",
    "licensing", "technical_evidence", "historical_record", "signature"
  ], "commercial status");
  assert(record.schema === "mfenx.commercial-status.v1", "commercial-status schema changed");
  assert(/^lights-out-local-supercomputer-v2-commercial-status-[0-9]{8}$/.test(record.record_id), "commercial-status record identity changed");
  assert(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(record.effective_at_utc), "commercial-status effective time is malformed");
  assert(record.encoding_profile === "mfenx.json.jq-cS-integer.v1", "commercial-status encoding profile changed");

  assertExactKeys(record.product, ["company", "name", "release", "machine_class"], "commercial-status product");
  assert(equalJson(record.product, {
    company: "MFENX",
    name: "Lights Out Local Supercomputer V2",
    release: "v2",
    machine_class: "software_defined_local_supercomputer_v2"
  }), "commercial-status product identity changed");

  assertExactKeys(record.licensing, [
    "current_software_license", "executor", "verifier", "source_available",
    "public_binary_distribution", "evaluation_requires_written_agreement",
    "redistribution_requires_written_agreement"
  ], "commercial-status licensing");
  assert(equalJson(record.licensing, {
    current_software_license: "LicenseRef-MFENX-Commercial",
    executor: "proprietary",
    verifier: "proprietary",
    source_available: false,
    public_binary_distribution: false,
    evaluation_requires_written_agreement: true,
    redistribution_requires_written_agreement: true
  }), "commercial-status licensing semantics changed");

  const evidence = assertExactKeys(record.technical_evidence, [
    "execution_contract", "accepted_release", "preserved_v1_comparator",
    "validation_candidate", "adversarial", "scaling", "reproduction",
    "external_workload"
  ], "commercial-status technical evidence");

  assert(equalJson(evidence.execution_contract, {
    version: "v1",
    release_manifest_sha256: "bf854ef7144f11358725aaf8021a91f12fede517ac8110fc44bc08a50950b071",
    release_signature_sha256: "2b26d302e978566c95709ac3c4cf93cc10f29ac5d9a02e97470283460efbf1db"
  }), "commercial-status execution-contract binding changed");
  assert(equalJson(evidence.accepted_release, {
    capture_manifest_sha256: "71033d917be233ea260417a1f7521c8098f27715475ad0ddf8318a5ecf2fd966",
    acceptance_sha256: "4f101f8ec4b592b39b4024f198dd9f80cef79d2612556acf377191bee6270ebc",
    executor_sha256: "a1043e568704163b9dedf536c5feb60b0b7fd23097a2a8f0504d55d7ddcb1e3c",
    source_tree_sha256: "e3c87a14c466e3a335f13f86738a72459bff1629c5b5d969733f0d7f544bb9ca",
    output_root: "4691a345a8818af410da311bc4d79131dcd093ff47384e71d4832ca08fed638c",
    external_wall_ns: 5608764486
  }), "commercial-status accepted-release binding changed");
  assert(equalJson(evidence.preserved_v1_comparator, {
    capture_manifest_sha256: "3a08e8a61b6eb0a9cec94959fa5b666ff1441de6c310b07f388e9ce57a80296d",
    acceptance_sha256: "b4fb33fffa4362c6a7d9a9af963e1b1af4e5a32634d6ac5916a43b87868814be",
    external_wall_ns: 276103268901,
    same_workload: true,
    same_output_root: true,
    v1_over_v2_ratio_decimal: "49.2271104608"
  }), "commercial-status v1 comparator changed");
  assert(equalJson(evidence.validation_candidate, {
    release_id: "mfenx-local-v2-validation-candidate-20260822-a1",
    manifest_sha256: "fb4023a172927ba7555376f0217f84c3dd2bcb057ce11d59e7b2697d02ab6229",
    executor_sha256: "92e48bfe615ad5241202d2e49fac51d52e21d66f3d0c84c273af042d5852dac0",
    verifier_sha256: "f3714660b9deeef3bd8ecef716c40580c7596c0903f05e89d555ed0d32e9b9fa"
  }), "commercial-status validation-candidate binding changed");
  assert(equalJson(evidence.adversarial, {
    attempted_exactly_once: 214,
    driver_passed: 214,
    independent_passed: 214,
    mutation_cases: 192,
    restart_cases: 22,
    attestation_sha256: "08255a52606665d63bb43f1812afe928aa3f55e2ccea0248b596f190f757c716"
  }), "commercial-status adversarial result changed");

  assertExactKeys(evidence.scaling, [
    "planned", "successful", "retained", "sample_filtering_applied",
    "results_sha256", "cells"
  ], "commercial-status scaling");
  assert(evidence.scaling.planned === 100
    && evidence.scaling.successful === 100
    && evidence.scaling.retained === 100
    && evidence.scaling.sample_filtering_applied === false
    && evidence.scaling.results_sha256 === "bb1fd8bfe6158f2e68e028b9f3085359fcf7288d09cfd59e74a9083ef4360608",
  "commercial-status scaling population changed");
  assert(Array.isArray(evidence.scaling.cells)
    && evidence.scaling.cells.length === EXPECTED_COMMERCIAL_SCALING.length,
  "commercial-status scaling cell population changed");
  const scalingCells = new Map();
  evidence.scaling.cells.forEach((cell, index) => {
    assertExactKeys(cell, ["temperature", "lanes", "topology", "median_wall_ns_decimal", "speedup_decimal"], "commercial-status scaling cell");
    const [temperature, lanes, topology, median, speedup] = EXPECTED_COMMERCIAL_SCALING[index];
    assert(cell.temperature === temperature
      && cell.lanes === lanes
      && cell.topology === topology
      && cell.median_wall_ns_decimal === median
      && cell.speedup_decimal === speedup,
    "commercial-status scaling cell changed");
    scalingCells.set(temperature + "/" + lanes, cell);
  });

  assert(equalJson(evidence.reproduction, {
    jobs: 3,
    matching_output_roots: 3,
    record_sha256: "c12a24a7f3f37f47bfcc2e94231fea9e3578eb6a2441cfb8858fdaadd7d38d73"
  }), "commercial-status reproduction result changed");
  assert(equalJson(evidence.external_workload, {
    name: "UCI Iris",
    executor_accepted: true,
    standalone_verifier_accepted: true,
    independent_exact_oracle_accepted: true,
    record_sha256: "32b870a07c771199be685464c02df8f0c052d21a582085831047daaa466e5270"
  }), "commercial-status external-workload result changed");
  assert(equalJson(record.historical_record, {
    status: "archived_private",
    record_sha256: "175174d0f049fdf88895909dd6f71f40f80073c206c3f05eaff0283c0b68a715",
    controls_current_terms: false
  }), "commercial-status historical-record handling changed");
  assert(equalJson(record.signature, {
    algorithm: "ssh-ed25519",
    format: "openssh-sshsig",
    namespace: COMMERCIAL_STATUS.namespace,
    signer_identity: COMMERCIAL_STATUS.principal,
    public_key_fingerprint: COMMERCIAL_STATUS.publicKeyFingerprint
  }), "commercial-status signature policy changed");
  return scalingCells;
}

async function validateCommercialSigningPolicy(raw) {
  const signatureText = decodeUtf8(raw.signature, "commercial-status detached signature").trim();
  assert(signatureText.startsWith("-----BEGIN SSH SIGNATURE-----")
    && signatureText.endsWith("-----END SSH SIGNATURE-----"),
  "commercial-status detached signature armor changed");
  const publicKeyText = decodeUtf8(raw.publicKey, "commercial-status public key").trim();
  const publicKeyFields = publicKeyText.split(/\s+/);
  assert(publicKeyFields.length >= 2 && publicKeyFields[0] === "ssh-ed25519",
    "commercial-status public key is not OpenSSH Ed25519");
  const publicKeyBlob = decodeBase64(publicKeyFields[1], "commercial-status public key");
  const publicKeyDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", publicKeyBlob));
  assert("SHA256:" + base64WithoutPadding(publicKeyDigest) === COMMERCIAL_STATUS.publicKeyFingerprint,
    "commercial-status public-key fingerprint changed");
  const allowed = decodeUtf8(raw.allowedSigners, "commercial-status allowed signers").trim().split(/\s+/);
  assert(allowed.length === 4
    && allowed[0] === COMMERCIAL_STATUS.principal
    && allowed[1] === 'namespaces="' + COMMERCIAL_STATUS.namespace + '"'
    && allowed[2] === "ssh-ed25519"
    && allowed[3] === publicKeyFields[1],
  "commercial-status allowed-signers policy changed");
}

async function loadCommercialStatusPack() {
  const pins = [
    COMMERCIAL_STATUS.recordSha256,
    COMMERCIAL_STATUS.detachedSignatureSha256,
    COMMERCIAL_STATUS.publicKeySha256,
    COMMERCIAL_STATUS.allowedSignersSha256
  ];
  assert(pins.every((value) => /^[0-9a-f]{64}$/.test(value) && !/^0{64}$/.test(value)),
    "Commercial status publication pending");

  const [recordBytes, signature, publicKey, allowedSigners] = await Promise.all([
    fetchBytes(COMMERCIAL_STATUS.root, COMMERCIAL_STATUS.recordPath, 256 * 1024),
    fetchBytes(COMMERCIAL_STATUS.root, COMMERCIAL_STATUS.signaturePath, 8 * 1024),
    fetchBytes(COMMERCIAL_STATUS.root, COMMERCIAL_STATUS.publicKeyPath, 8 * 1024),
    fetchBytes(COMMERCIAL_STATUS.root, COMMERCIAL_STATUS.allowedSignersPath, 8 * 1024)
  ]);
  assert(await sha256(recordBytes) === COMMERCIAL_STATUS.recordSha256,
    "commercial-status record digest changed");
  assert(await sha256(signature) === COMMERCIAL_STATUS.detachedSignatureSha256,
    "commercial-status detached-signature digest changed");
  assert(await sha256(publicKey) === COMMERCIAL_STATUS.publicKeySha256,
    "commercial-status public-key digest changed");
  assert(await sha256(allowedSigners) === COMMERCIAL_STATUS.allowedSignersSha256,
    "commercial-status allowed-signers digest changed");
  await validateCommercialSigningPolicy({ signature, publicKey, allowedSigners });
  const record = parseJson(recordBytes, "commercial status");
  const scalingCells = validateCommercialStatus(record);
  return { record, scalingCells };
}

async function loadSelectedRelease(label, config) {
  assertDigest(config.manifestSha256, label + " manifest constant is invalid");
  const manifestBytes = await fetchBytes(config.root, "SHA256SUMS", 256 * 1024);
  assert(await sha256(manifestBytes) === config.manifestSha256, label + " full-capture manifest digest changed");
  const manifest = parseManifest(manifestBytes, label, config.manifestEntries);

  const raw = Object.create(null);
  await Promise.all(config.files.map(async (path) => {
    assert(manifest.has(path), label + " full-capture manifest does not name selected file " + path);
    const bytes = await fetchBytes(config.root, path);
    assert(await sha256(bytes) === manifest.get(path), label + " selected file failed SHA-256: " + path);
    raw[path] = bytes;
  }));

  const files = Object.create(null);
  for (const path of config.files) {
    if (path.endsWith(".json")) files[path] = parseJson(raw[path], label + "/" + path);
  }
  return { label, config, manifest, raw, files };
}

async function loadContractPack() {
  const checksumBytes = await fetchBytes(CONTRACT_V1.root, "SHA256SUMS", 4 * 1024);
  assert(
    await sha256(checksumBytes) === CONTRACT_V1.transportManifestSha256,
    "Contract v1 public-subset checksum index changed"
  );
  const inventory = parseManifest(checksumBytes, "Contract v1", CONTRACT_V1.files.length);
  assert(
    equalArray([...inventory.keys()].sort(), [...CONTRACT_V1.files].sort()),
    "Contract v1 public-subset file set changed"
  );

  const raw = Object.create(null);
  await Promise.all(CONTRACT_V1.files.map(async (path) => {
    const bytes = await fetchBytes(CONTRACT_V1.root, path, 256 * 1024);
    assert(await sha256(bytes) === inventory.get(path), "Contract v1 file failed SHA-256: " + path);
    raw[path] = bytes;
  }));
  return { inventory, raw };
}

function decodeBase64(value, label) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error(label + " is not valid base64");
  }
}

function base64WithoutPadding(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "");
}

function validateContractPack(pack) {
  const vectors = parseJson(pack.raw["conformance/vectors.json"], "Contract v1 conformance vectors");
  assert(vectors.schema_version === 1
    && vectors.contract === "mfenx-replay-gated-execution-contract/v1",
  "Contract v1 conformance identity changed");
  assert(Array.isArray(vectors.positive_conformance)
    && vectors.positive_conformance.length === 6,
  "Contract v1 positive-vector count changed");
  assert(Array.isArray(vectors.negative_conformance)
    && vectors.negative_conformance.length === 10,
  "Contract v1 negative-vector count changed");

  const contract = decodeUtf8(pack.raw["EXECUTION_CONTRACT_V1.md"], "Execution Contract v1");
  const formats = decodeUtf8(pack.raw["CANONICAL_FORMATS_V1.md"], "Contract v1 canonical formats");
  const threatModel = decodeUtf8(pack.raw["THREAT_MODEL.md"], "Contract v1 threat model");
  assert(contract.startsWith("# MFENX replay-gated execution contract v1")
    && contract.includes("mfenx-replay-gated-execution-contract/v1"),
  "Execution Contract v1 identity changed");
  assert(formats.startsWith("# MFENX execution-contract v1 canonical formats"), "Contract v1 canonical-format identity changed");
  assert(threatModel.startsWith("# MFENX Local v2 threat model"), "Contract v1 threat-model identity changed");
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
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(decimals) + " GiB";
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(decimals) + " MiB";
  if (value >= 1024) return (value / 1024).toFixed(decimals) + " KiB";
  return value.toLocaleString() + " B";
}

function exactBytes(value) {
  return Number(value).toLocaleString("en-US") + " B";
}

function seconds(ns) {
  return (ns / 1e9).toFixed(9) + " s";
}

function shortHash(value) {
  const text = String(value || "");
  return text.length > 23 ? text.slice(0, 14) + "…" + text.slice(-8) : text;
}

function pieceAssignments(pieceCount, lanes) {
  return Array.from({ length: pieceCount }, (_, pieceIndex) => ({
    piece_index: pieceIndex,
    lane_index: pieceIndex % lanes
  }));
}

function assignmentLabel(assignments) {
  return assignments.map((entry) => "p" + entry.piece_index + "→l" + entry.lane_index).join(", ");
}

function assertIo(actual, expected, label) {
  assert(isRecord(actual), label + " is missing");
  assert(equalArray(Object.keys(actual).sort(), Object.keys(expected).sort()), label + " fields changed");
  for (const [key, value] of Object.entries(expected)) {
    assert(actual[key] === value, label + "." + key + " changed");
  }
}

function validateTiming(memory, label, expectedStatus) {
  const timing = memory.external_timings[label];
  assert(isRecord(timing), "missing external timing for " + label);
  assert(timing.observer === "acceptance_harness_outside_product_process", label + " was not externally timed");
  assertSafeInteger(timing.wall_ns, label + " wall time is invalid", 1);
  assert(timing.exit_status === expectedStatus, label + " exit status changed");
  return timing;
}

function validateBuildAndProvenance(release, acceptance) {
  assert(acceptance.product === "rarecomp-mfenx-local", release.label + " product changed");
  assert(acceptance.build.package === "rarecomp-mfenx-local" && acceptance.build.binary === "mfenx-local", release.label + " build target changed");
  assert(acceptance.build.locked === true && acceptance.build.offline === true, release.label + " build was not locked/offline");
  assert(acceptance.build.forbidden_dependencies === 0 && acceptance.build.forbidden_dynamic_libraries === 0, release.label + " forbidden dependency was recorded");
  assertSafeInteger(acceptance.build.jobs, release.label + " build job count is invalid", 1);
  assertDigest(acceptance.binary_sha256, release.label + " binary digest is invalid");
  assertDigest(acceptance.source_tree_sha256, release.label + " source digest is invalid");
  assert(
    parseChecksumRecord(release.raw["provenance/binary.sha256"], release.label + "/binary.sha256", "bin/mfenx-local") === acceptance.binary_sha256,
    release.label + " binary checksum record disagrees"
  );
  assert(
    parseChecksumRecord(release.raw["provenance/source-root.sha256"], release.label + "/source-root.sha256", "provenance/source-before.sha256") === acceptance.source_tree_sha256,
    release.label + " source checksum record disagrees"
  );
  assert(release.manifest.get("bin/mfenx-local") === acceptance.binary_sha256, release.label + " selected binary is not the accepted binary");
}

function validateContainment(release, acceptance) {
  const pair = acceptance.containment.mode + "/" + acceptance.containment.device_view;
  assert(new Set([
    "bubblewrap_network_namespace/bubblewrap_synthetic_dev",
    "unshare_network_namespace/unshare_synthetic_dev",
    "trace_only/host_traced"
  ]).has(pair), release.label + " containment record changed");
  assert(
    decodeUtf8(release.raw["provenance/containment.txt"], release.label + "/containment.txt")
      === "containment=" + acceptance.containment.mode + "\ndevice_view=" + acceptance.containment.device_view + "\n",
    release.label + " containment text disagrees"
  );
  assert(
    decodeUtf8(release.raw["provenance/containment-probes.txt"], release.label + "/containment-probes.txt")
      === "bubblewrap network namespace + synthetic GPU-free /dev probe passed\n",
    release.label + " containment probe did not pass"
  );
  const trace = release.files["provenance/trace-summary.json"];
  assert(equalJson(trace, acceptance.syscall_trace), release.label + " trace summary disagrees with acceptance");
  assertSafeInteger(trace.product_trace_files, release.label + " has no product trace files", 1);
  assertSafeInteger(trace.host_trace_files, release.label + " has no host trace files", 1);
  assert(
    trace.product_network_syscalls === 0
      && trace.product_gpu_device_paths === 0
      && trace.offline_build_ip_network_attempts === 0,
    release.label + " trace recorded network/GPU/offline-build access"
  );
}

function validateLaneWitness(acceptance, laneOverlap, lanes) {
  assert(equalJson(acceptance.memory.external_lane_concurrency_attestation, laneOverlap), "lane witness disagrees with acceptance");
  assert(laneOverlap.observer === "acceptance_harness_outside_product_process_via_proc_task", "lane witness observer changed");
  assert(laneOverlap.primary_execution === "uninterrupted-run", "lane witness does not cover the fresh run");
  assert(laneOverlap.raw_evidence === "memory/uninterrupted-run.lane-tasks.tsv", "lane witness raw-evidence identity changed");
  assert(laneOverlap.configured_lanes === lanes && laneOverlap.minimum_distinct_overlapping_lane_tasks === 2, "lane witness configuration changed");
  assert(laneOverlap.overlap_proven === true, "CPU-lane overlap was not proven");
  assertSafeInteger(laneOverlap.observed_lane_task_rows, "no lane task samples were recorded", 2);
  const witness = laneOverlap.witness;
  assert(isRecord(witness) && Array.isArray(witness.tasks) && witness.tasks.length >= 2, "lane overlap witness is incomplete");
  assertSafeInteger(witness.product_pid, "lane witness product PID is invalid", 1);
  assertSafeInteger(witness.anchor_tid_reobserved_after_sweep, "lane witness anchor is invalid", 1);
  const tids = new Set();
  const witnessedLanes = new Set();
  for (const task of witness.tasks) {
    assert(task.pid === witness.product_pid, "lane task belongs to another process");
    assertSafeInteger(task.tid, "lane task TID is invalid", 1);
    assertSafeInteger(task.lane_index, "lane index is invalid");
    assert(task.lane_index < lanes, "lane task index exceeds compiled lanes");
    assert(task.comm === "mfx-lane-" + String(task.lane_index).padStart(2, "0"), "lane task name/index mismatch");
    assert(!new Set(["X", "Z"]).has(task.state), "lane witness includes a dead task");
    assert(task.anchor_tid === witness.anchor_tid_reobserved_after_sweep && task.anchor_reobserved_after_sweep === 1, "lane anchor was not re-observed");
    tids.add(task.tid);
    witnessedLanes.add(task.lane_index);
  }
  assert(tids.size >= 2 && witnessedLanes.size >= 2 && tids.has(witness.anchor_tid_reobserved_after_sweep), "two simultaneous lane tasks were not witnessed");
}

function validateV2(release) {
  const files = release.files;
  const acceptance = files["acceptance.json"];
  const workloadRecord = files["provenance/workload-contract.json"];
  const memory = files["provenance/memory-summary.json"];
  const laneOverlap = files["provenance/lane-overlap.json"];
  const image = files["artifacts/gemm.mfx.json"];
  const inspect = files["artifacts/gemm.inspect.json"];
  const uninterrupted = files["artifacts/uninterrupted.result.json"];
  const uninterruptedVerify = files["artifacts/uninterrupted.verify.json"];
  const resumed = files["artifacts/resumed.result.json"];
  const resumedVerify = files["artifacts/resumed.verify.json"];
  const postKill = files["provenance/post-kill-receipts.json"];
  const postResume = files["provenance/post-resume-checkpoint.json"];
  const checkpointPlan = files[CHECKPOINT_PLAN_PATH];
  const uninterruptedIo = files["provenance/uninterrupted-io-counters.json"];
  const resumedIo = files["provenance/resumed-io-counters.json"];

  assert(acceptance.schema_version === V2_CONTRACT.acceptanceSchema, "v2 acceptance schema is not 3");
  assert(acceptance.status === "PASS" && acceptance.acceptance_level === "release" && acceptance.release_acceptance === true, "v2 release acceptance did not pass");
  assert(Number.isFinite(Date.parse(acceptance.captured_at_utc)), "v2 capture time is invalid");
  validateBuildAndProvenance(release, acceptance);
  validateContainment(release, acceptance);
  for (const [key, value] of Object.entries(workloadRecord)) {
    assert(equalJson(acceptance.workload[key], value), "v2 workload file disagrees on " + key);
  }
  const workload = acceptance.workload;
  assert(equalJson(memory, acceptance.memory), "v2 memory file disagrees with acceptance");

  const machine = acceptance.machine;
  assert(machine.image_schema_version === 3 && machine.isa_version === 6, "v2 machine is not image 3 / ISA 6");
  assert(machine.result_schema_version === 3 && machine.resource_certificate_schema_version === 5, "v2 machine is not result 3 / certificate 5");
  assert(machine.checkpoint_plan_schema_version === 2 && machine.piece_receipt_schema_version === 2, "v2 checkpoint schemas changed");
  assert(machine.lane_schedule_schema_version === 1 && machine.lane_schedule_instruction_index === 0, "v2 schedule schema changed");
  assert(machine.lane_schedule_policy === V2_CONTRACT.laneSchedulePolicy, "v2 schedule policy changed");
  assert(machine.piece_to_lane_assignment === "lane_index = piece_index % lanes", "v2 lane assignment law changed");
  assert(machine.machine_class === V2_CONTRACT.machineClass && machine.backend === V2_CONTRACT.backend, "v2 machine identity changed");
  assert(machine.execution_dataflow === V2_CONTRACT.dataflow && machine.opcode === V2_CONTRACT.opcode, "v2 execution path changed");
  assert(machine.verification_method === V2_CONTRACT.verificationMethod, "v2 verifier method changed");
  assert(machine.gpu_devices_required === 0 && machine.network_transports_required === 0, "v2 machine requires GPU/network");
  assert(machine.directory_metadata_sync === "available" && machine.process_crash_recovery === "supported", "v2 durability contract changed");

  assert(equalArray(workload.left_shape, EXPECTED.leftShape) && equalArray(workload.right_shape, EXPECTED.rightShape), "v2 workload shapes changed");
  assert(workload.logical_input_bytes === EXPECTED.logicalInputBytes, "v2 logical input bytes changed");
  assert(workload.certified_managed_peak_bytes === EXPECTED.managedPeakBytes, "v2 managed peak changed");
  assert(workload.logical_input_bytes > 4 * workload.certified_managed_peak_bytes && workload.input_more_than_four_times_managed === true, "v2 input is not greater than 4x the certified peak");
  assert(workload.input_to_managed_ratio_milli === Math.floor(workload.logical_input_bytes * 1000 / workload.certified_managed_peak_bytes), "v2 memory ratio record changed");
  assert(workload.machine_class === V2_CONTRACT.machineClass && workload.backend === V2_CONTRACT.backend, "v2 workload machine identity changed");
  assert(workload.execution_dataflow === V2_CONTRACT.dataflow && workload.opcode === V2_CONTRACT.opcode, "v2 workload dataflow changed");
  assert(workload.image_schema_version === 3 && workload.isa_version === 6 && workload.result_schema_version === 3 && workload.resource_certificate_schema_version === 5, "v2 workload schemas changed");
  assert(workload.gpu_required === 0 && workload.network_required === 0, "v2 workload requires GPU/network");
  assert(workload.lanes === 2 && workload.total_pieces === 2, "v2 workload lane/piece count changed");

  const expectedAssignments = pieceAssignments(2, 2);
  const expectedSchedule = {
    schema_version: 1,
    instruction_index: 0,
    policy: V2_CONTRACT.laneSchedulePolicy,
    lanes: 2,
    piece_count: 2
  };
  assert(equalJson(workload.expected_piece_lane_assignments, expectedAssignments), "v2 expected assignments changed");
  assert(equalJson(workload.lane_schedule, expectedSchedule), "v2 schedule changed");

  assert(inspect.schema_version === 3 && inspect.isa_version === 6, "v2 inspect identity changed");
  assert(inspect.result_schema_version === 3 && inspect.resource_certificate_schema_version === 5, "v2 inspect schemas changed");
  assert(inspect.machine_class === V2_CONTRACT.machineClass && inspect.backend === V2_CONTRACT.backend, "v2 inspect machine changed");
  assert(inspect.execution_dataflow === V2_CONTRACT.dataflow && inspect.opcode === V2_CONTRACT.opcode, "v2 inspect dataflow changed");
  assert(inspect.lanes === 2 && inspect.piece_count === 2 && inspect.panel_elements === 262144, "v2 inspect partition changed");
  assert(inspect.certified_managed_peak_bytes === EXPECTED.managedPeakBytes, "v2 inspect memory bound changed");
  assert(inspect.verification === "exact_replay" && inspect.gpu_required === false && inspect.network_required === false, "v2 inspect verification/requirements changed");
  assertDigest(inspect.image_digest, "v2 image digest is invalid");
  assertDigest(inspect.program_digest, "v2 program digest is invalid");

  assert(image.schema_version === 3 && image.isa_version === 6, "v2 image is not schema 3 / ISA 6");
  assert(image.machine_class === V2_CONTRACT.machineClass && image.backend === V2_CONTRACT.backend, "v2 image machine identity changed");
  assert(image.execution_dataflow === V2_CONTRACT.dataflow && image.program_digest === inspect.program_digest, "v2 image dataflow/program changed");
  assert(equalJson(image.schedule, expectedSchedule), "v2 compiled schedule changed");
  assert(image.verification === "exact_replay", "v2 image does not require exact replay");
  assert(Array.isArray(image.instructions) && image.instructions.length === 1 && image.instructions[0].opcode === V2_CONTRACT.opcode, "v2 instruction changed");
  assert(equalArray(image.inputs.left.ty.shape, EXPECTED.leftShape) && equalArray(image.inputs.right.ty.shape, EXPECTED.rightShape), "v2 image input shapes changed");
  assert(image.inputs.left.byte_length + image.inputs.right.byte_length === EXPECTED.logicalInputBytes, "v2 image input size changed");
  const outputType = image.instructions[0].output_type;
  assert(outputType.element === "i32" && equalArray(outputType.shape, EXPECTED.outputShape), "v2 image output type changed");

  const certificate = image.resource_certificate;
  assert(certificate.schema_version === 5 && certificate.lanes === 2 && certificate.piece_count === 2 && certificate.rows_per_piece === 2, "v2 certificate identity changed");
  assert(certificate.max_managed_bytes === 64 * 1024 ** 2 && certificate.max_io_bytes === 1024 ** 2, "v2 compile bounds changed");
  assert(certificate.panel_elements === 262144 && certificate.right_panel_bytes_per_lane === 1048576 && certificate.panel_decode_bytes_per_lane === 1048576, "v2 contiguous-panel geometry changed");
  assert(certificate.aggregate_execution_peak_bytes === 36065472 && certificate.finalization_peak_bytes === 6318592 && certificate.verification_peak_bytes === EXPECTED.managedPeakBytes, "v2 phase memory bounds changed");
  assert(certificate.certified_managed_peak_bytes === EXPECTED.managedPeakBytes, "v2 certified peak changed");
  assert(certificate.primary_requested_input_bytes_upper_bound === EXPECTED.primaryIo.requested_bytes, "v2 primary requested bound changed");
  assert(certificate.primary_authenticated_input_bytes_upper_bound === EXPECTED.primaryIo.authenticated_chunk_bytes, "v2 primary authenticated bound changed");
  assert(certificate.verification_requested_input_bytes_upper_bound === EXPECTED.verificationInputIo.requested_bytes, "v2 replay-input requested bound changed");
  assert(certificate.verification_authenticated_input_bytes_upper_bound === EXPECTED.verificationInputIo.authenticated_chunk_bytes, "v2 replay-input authenticated bound changed");
  assert(certificate.verification_requested_output_bytes === EXPECTED.verificationOutputIo.requested_bytes, "v2 replay-output requested bound changed");
  assert(certificate.verification_authenticated_output_bytes_upper_bound === 16777212, "v2 replay-output authenticated bound changed");

  const io = workload.io_accounting;
  assert(io.derivation === "independent_manifest_range_single_cache_simulation", "v2 I/O derivation changed");
  assert(io.evidence === "provenance/uninterrupted-io-counters.json", "v2 I/O evidence path changed");
  for (const section of ["actual", "independently_derived"]) {
    assertIo(io[section].admission_input_io, EXPECTED.admissionIo, "v2 workload " + section + " admission I/O");
    assertIo(io[section].primary_input_io, EXPECTED.primaryIo, "v2 workload " + section + " primary I/O");
    assertIo(io[section].verification_input_io, EXPECTED.verificationInputIo, "v2 workload " + section + " replay-input I/O");
    assertIo(io[section].verification_output_io, EXPECTED.verificationOutputIo, "v2 workload " + section + " replay-output I/O");
  }
  assert(uninterruptedIo.status === "PASS" && uninterruptedIo.derivation === io.derivation && uninterruptedIo.label === "uninterrupted", "v2 uninterrupted I/O evidence failed");
  assertIo(uninterruptedIo.expected.admission_input_io, EXPECTED.admissionIo, "v2 derived admission I/O");
  assertIo(uninterruptedIo.expected.primary_input_io, EXPECTED.primaryIo, "v2 derived primary I/O");
  assertIo(uninterruptedIo.expected.verification_input_io, EXPECTED.verificationInputIo, "v2 derived replay-input I/O");
  assertIo(uninterruptedIo.expected.verification_output_io, EXPECTED.verificationOutputIo, "v2 derived replay-output I/O");
  assertIo(uninterruptedIo.observed.primary_input_io, EXPECTED.primaryIo, "v2 observed primary I/O");
  assertIo(uninterruptedIo.observed.result_admission_input_io, EXPECTED.admissionIo, "v2 observed result admission I/O");
  assertIo(uninterruptedIo.observed.result_verification_input_io, EXPECTED.verificationInputIo, "v2 observed result replay-input I/O");
  assertIo(uninterruptedIo.observed.result_verification_output_io, EXPECTED.verificationOutputIo, "v2 observed result replay-output I/O");
  assertIo(uninterruptedIo.observed.standalone_admission_input_io, EXPECTED.admissionIo, "v2 standalone admission I/O");
  assertIo(uninterruptedIo.observed.standalone_verification_input_io, EXPECTED.verificationInputIo, "v2 standalone replay-input I/O");
  assertIo(uninterruptedIo.observed.standalone_verification_output_io, EXPECTED.verificationOutputIo, "v2 standalone replay-output I/O");
  assert(resumedIo.status === "PASS" && resumedIo.label === "resumed" && resumedIo.derivation === io.derivation, "v2 resumed I/O evidence failed");
  assertIo(resumedIo.expected.primary_input_io, EXPECTED.resumedPrimaryIo, "v2 derived resumed primary I/O");
  assertIo(resumedIo.observed.primary_input_io, EXPECTED.resumedPrimaryIo, "v2 observed resumed primary I/O");

  assert(memory.external_hard_rlimit_as_bytes === acceptance.external_hard_rlimit_as_mib * 1024 ** 2, "v2 external memory limit changed");
  assert(memory.virtual_memory_within_external_limit === true, "v2 exceeded external memory limit");
  for (const field of ["VmRSS_kib", "VmHWM_kib", "VmSize_kib", "VmPeak_kib"]) assertSafeInteger(memory.maxima_kib[field], "v2 missing " + field, 1);
  assert(memory.maxima_kib.VmSwap_kib === 0, "v2 product used swap");
  assert(memory.maxima_kib.VmPeak_kib * 1024 <= memory.external_hard_rlimit_as_bytes, "v2 observed virtual peak exceeded the limit");
  validateTiming(memory, "uninterrupted-run", 0);
  validateTiming(memory, "uninterrupted-verify", 0);
  validateTiming(memory, "killed-run", 137);
  validateTiming(memory, "resumed-run", 0);
  validateTiming(memory, "resumed-verify", 0);
  assert(memory.external_timings["uninterrupted-run"].wall_ns === EXPECTED.v2ExternalWallNs, "v2 accepted external wall changed");
  validateLaneWitness(acceptance, laneOverlap, 2);

  const validateVerification = (verification, label) => {
    assert(verification.verified === true && verification.method === V2_CONTRACT.verificationMethod, label + " exact replay failed");
    assert(verification.pieces_checked === 2 && verification.bytes_checked === EXPECTED.outputBytes, label + " replay coverage changed");
    assert(verification.verification_integer_operations === EXPECTED.usefulOperations, label + " replay operation count changed");
    assertIo(verification.admission_input_io, EXPECTED.admissionIo, label + " admission I/O");
    assertIo(verification.input_io, EXPECTED.verificationInputIo, label + " replay-input I/O");
    assertIo(verification.output_io, EXPECTED.verificationOutputIo, label + " replay-output I/O");
    assertSafeInteger(verification.verification_ns, label + " replay timing is invalid", 1);
  };

  const validateResult = (result, standalone, label, expectedPrimaryIo) => {
    assert(result.schema_version === 3 && result.machine_class === V2_CONTRACT.machineClass && result.backend === V2_CONTRACT.backend, label + " result identity changed");
    assert(result.image_digest === inspect.image_digest, label + " result image digest changed");
    assertDigest(result.resource_certificate_digest, label + " certificate digest is invalid");
    assert(Array.isArray(result.outputs) && result.outputs.length === 1 && result.outputs[0].index === 0, label + " output set changed");
    const tensor = result.outputs[0].tensor;
    assert(tensor.ty.element === "i32" && equalArray(tensor.ty.shape, EXPECTED.outputShape) && tensor.byte_length === EXPECTED.outputBytes, label + " output tensor changed");
    assert(tensor.manifest_digest === EXPECTED.outputRoot, label + " output root changed");
    assert(result.metrics.lanes === 2 && result.metrics.total_pieces === 2, label + " schedule changed");
    assert(result.metrics.useful_integer_operations === EXPECTED.usefulOperations, label + " useful operation count changed");
    assert(result.metrics.certified_managed_peak_bytes === EXPECTED.managedPeakBytes && result.metrics.retained_storage_bytes === EXPECTED.retainedStorageBytes, label + " resource metrics changed");
    assert(result.metrics.gpu_devices_required === 0 && result.metrics.network_transports_required === 0, label + " result requires GPU/network");
    assert(result.metrics.directory_metadata_sync === "available" && result.metrics.process_crash_recovery === "supported", label + " durability metrics changed");
    assertIo(result.metrics.primary_input_io, expectedPrimaryIo, label + " primary I/O");
    validateVerification(result.verification, label + " inline");
    validateVerification(standalone, label + " standalone");
  };
  validateResult(uninterrupted, uninterruptedVerify, "v2 uninterrupted", EXPECTED.primaryIo);
  validateResult(resumed, resumedVerify, "v2 resumed", EXPECTED.resumedPrimaryIo);
  assert(uninterrupted.metrics.end_to_end_ns === workload.performance.internal_end_to_end_ns, "v2 internal end-to-end timing disagrees");
  assert(uninterrupted.metrics.execution_ns === workload.performance.internal_execution_ns, "v2 execution timing disagrees");
  assert(uninterrupted.metrics.finalization_ns === workload.performance.internal_finalization_ns, "v2 finalization timing disagrees");
  assert(uninterrupted.verification.verification_ns === workload.performance.internal_verification_ns, "v2 replay timing disagrees");
  assert(workload.performance.external_wall_ns === EXPECTED.v2ExternalWallNs && workload.performance.external_wall_observer === "acceptance_harness_monotonic_process_observer", "v2 external performance record changed");
  assert(workload.performance.useful_integer_operations === EXPECTED.usefulOperations && workload.performance.executed_primary_integer_operations === EXPECTED.usefulOperations, "v2 performance operations changed");
  assert(workload.performance.physical_integer_operations === EXPECTED.physicalOperations && workload.performance.speedup_claim === null, "v2 physical operations/speedup claim changed");
  assert(workload.performance.workload === "uninterrupted_fresh_execution" && workload.performance.internal_timing_attestation === "self_reported", "v2 timing boundary changed");

  assert(equalJson(uninterrupted.metrics.reused_assignments, []) && equalJson(uninterrupted.metrics.executed_assignments, expectedAssignments), "v2 fresh assignments changed");
  assert(uninterrupted.metrics.reused_pieces === 0 && uninterrupted.metrics.executed_pieces === 2, "v2 fresh piece counters changed");
  assert(postKill.observer === "acceptance_harness_after_process_group_exit" && postResume.observer === "acceptance_harness_after_resumed_process_exit", "v2 recovery observers changed");
  assert(postKill.expected_total_pieces === 2 && postResume.expected_total_pieces === 2, "v2 recovery piece count changed");
  assert(equalJson(postKill.schedule, expectedSchedule) && equalJson(postResume.schedule, expectedSchedule), "v2 recovery schedule changed");
  assertDigest(postKill.plan_sha256, "v2 recovery plan digest is invalid");
  assert(postKill.plan_sha256 === postResume.plan_sha256 && postKill.plan_sha256 === release.manifest.get(CHECKPOINT_PLAN_PATH), "v2 recovery plan digest changed");
  assert(Array.isArray(postKill.entries) && postKill.entries.length === 1 && postKill.receipt_count === 1, "v2 SIGKILL did not leave exactly one durable piece");
  assert(Array.isArray(postResume.entries) && postResume.entries.length === 2, "v2 resume did not complete both pieces");
  const retainedAssignments = postKill.entries.map((entry) => ({ piece_index: entry.index, lane_index: entry.lane_index }));
  const retainedIndices = new Set(retainedAssignments.map((entry) => entry.piece_index));
  const missingAssignments = expectedAssignments.filter((entry) => !retainedIndices.has(entry.piece_index));
  assert(equalJson(postKill.receipt_assignments, retainedAssignments), "v2 retained assignments changed");
  assert(equalJson(postResume.receipt_assignments, expectedAssignments), "v2 completed receipt assignments changed");
  assert(equalJson(resumed.metrics.reused_assignments, retainedAssignments) && equalJson(resumed.metrics.executed_assignments, missingAssignments), "v2 resume did not execute missing-only work");
  assert(resumed.metrics.reused_pieces === 1 && resumed.metrics.executed_pieces === 1, "v2 resumed piece counts changed");
  assert(acceptance.recovery === "passed_exact_partial_reuse_with_deterministic_lane_assignments", "v2 recovery acceptance failed");

  assert(checkpointPlan.schema_version === 2 && checkpointPlan.image_digest === inspect.image_digest, "v2 checkpoint plan identity changed");
  assert(equalJson(checkpointPlan.schedule, expectedSchedule) && checkpointPlan.rows_per_piece === 2 && checkpointPlan.piece_count === 2, "v2 checkpoint partition changed");
  assert(checkpointPlan.output_type.element === "i32" && equalArray(checkpointPlan.output_type.shape, EXPECTED.outputShape), "v2 checkpoint output type changed");
  for (let index = 0; index < 2; index += 1) {
    const path = CHECKPOINT_ROOT + "receipt-" + String(index).padStart(8, "0") + ".json";
    const receipt = files[path];
    const rowStart = index * 2;
    const rowCount = Math.min(2, EXPECTED.outputShape[0] - rowStart);
    assert(receipt.schema_version === 2 && receipt.image_digest === inspect.image_digest, "v2 receipt identity changed");
    assert(receipt.index === index && receipt.lane_index === index % 2, "v2 receipt lane changed");
    assert(receipt.row_start === rowStart && receipt.row_count === rowCount && receipt.byte_length === rowCount * EXPECTED.outputShape[1] * 4, "v2 receipt geometry changed");
    assertDigest(receipt.content_blake3, "v2 receipt content digest is invalid");
    assert(release.manifest.get(path) === postResume.entries[index].receipt_sha256, "v2 receipt digest disagrees with external snapshot");
  }

  assert(uninterrupted.outputs[0].tensor.manifest_digest === resumed.outputs[0].tensor.manifest_digest, "v2 fresh/resumed roots differ");
  assert(acceptance.uninterrupted_output_root === EXPECTED.outputRoot && acceptance.resumed_output_root === EXPECTED.outputRoot, "v2 accepted output roots changed");

  const corruption = {
    input_chunk: "corrupt-input-chunk",
    checkpoint_piece: "corrupt-checkpoint-piece",
    checkpoint_receipt: "corrupt-checkpoint-receipt",
    image: "corrupt-image",
    result: "corrupt-result"
  };
  assert(acceptance.corruption_rejection.result_mutation_target === "metrics.primary_input_io.cache_hits", "v2 result mutation did not target authenticated I/O");
  assert(equalArray(Object.keys(acceptance.corruption_rejection).sort(), [...Object.keys(corruption), "result_mutation_target"].sort()), "v2 corruption suite changed");
  for (const [probe, timing] of Object.entries(corruption)) {
    assert(acceptance.corruption_rejection[probe] === "passed", "v2 " + probe + " mutation was not rejected");
    validateTiming(memory, timing, 1);
  }

  assert(acceptance.independent_attestation.runtime_telemetry === "external_proc_and_monotonic_process_observer", "v2 runtime telemetry boundary changed");
  assert(acceptance.independent_attestation.physical_lane_concurrency === "external_proc_task_overlap_witness", "v2 lane attestation changed");
  assert(acceptance.independent_attestation.recovery_partition === "external_post_kill_and_post_resume_checkpoint_snapshots", "v2 recovery attestation changed");

  return { acceptance, workload, memory, laneOverlap, uninterrupted, resumed, postKill };
}

function validateV1(release) {
  const files = release.files;
  const acceptance = files["acceptance.json"];
  const workloadRecord = files["provenance/workload-contract.json"];
  const memory = files["provenance/memory-summary.json"];
  const laneOverlap = files["provenance/lane-overlap.json"];
  const image = files["artifacts/gemm.mfx.json"];
  const inspect = files["artifacts/gemm.inspect.json"];
  const result = files["artifacts/uninterrupted.result.json"];
  const verify = files["artifacts/uninterrupted.verify.json"];

  assert(acceptance.schema_version === 2 && acceptance.status === "PASS" && acceptance.acceptance_level === "release" && acceptance.release_acceptance === true, "v1 preserved comparator is not an accepted release");
  validateBuildAndProvenance(release, acceptance);
  validateContainment(release, acceptance);
  for (const [key, value] of Object.entries(workloadRecord)) {
    assert(equalJson(acceptance.workload[key], value), "v1 workload file disagrees on " + key);
  }
  const workload = acceptance.workload;
  assert(equalJson(memory, acceptance.memory), "v1 memory file disagrees with acceptance");
  assert(acceptance.machine.image_schema_version === 2 && acceptance.machine.isa_version === 6, "v1 image/ISA identity changed");
  assert(acceptance.machine.result_schema_version === 2 && acceptance.machine.resource_certificate_schema_version === 4, "v1 result/certificate identity changed");
  assert(acceptance.machine.machine_class === "software_defined_local_supercomputer_v1", "v1 machine class changed");
  assert(acceptance.machine.backend === V2_CONTRACT.backend && acceptance.machine.opcode === V2_CONTRACT.opcode, "v1 backend/opcode changed");
  assert(acceptance.machine.verification_method === "independently_addressed_exact_replay", "v1 verifier identity changed");
  assert(acceptance.machine.gpu_devices_required === 0 && acceptance.machine.network_transports_required === 0, "v1 requires GPU/network");
  assert(equalArray(workload.left_shape, EXPECTED.leftShape) && equalArray(workload.right_shape, EXPECTED.rightShape), "v1 comparator shapes changed");
  assert(workload.logical_input_bytes === EXPECTED.logicalInputBytes && workload.lanes === 2 && workload.total_pieces === 2, "v1 comparator workload changed");
  assert(workload.input_more_than_four_times_managed === true && workload.logical_input_bytes > 4 * workload.certified_managed_peak_bytes, "v1 memory scale claim changed");
  assert(inspect.schema_version === 2 && inspect.isa_version === 6 && inspect.machine_class === "software_defined_local_supercomputer_v1", "v1 inspect identity changed");
  assert(image.schema_version === 2 && image.isa_version === 6 && image.machine_class === "software_defined_local_supercomputer_v1", "v1 image identity changed");
  assert(equalArray(image.inputs.left.ty.shape, EXPECTED.leftShape) && equalArray(image.inputs.right.ty.shape, EXPECTED.rightShape), "v1 image shapes changed");
  assert(equalJson(image.schedule, { schema_version: 1, instruction_index: 0, policy: "deterministic_striped_v1", lanes: 2, piece_count: 2 }), "v1 schedule changed");
  assert(result.schema_version === 2 && result.machine_class === "software_defined_local_supercomputer_v1", "v1 result identity changed");
  assert(result.metrics.useful_integer_operations === EXPECTED.usefulOperations && result.metrics.physical_integer_operations === EXPECTED.physicalOperations, "v1 operation count changed");
  assert(result.metrics.lanes === 2 && result.metrics.executed_pieces === 2 && result.metrics.reused_pieces === 0, "v1 fresh execution partition changed");
  assert(result.outputs[0].tensor.manifest_digest === EXPECTED.outputRoot && equalArray(result.outputs[0].tensor.ty.shape, EXPECTED.outputShape), "v1 output changed");
  assert(result.verification.verified === true && result.verification.method === "independently_addressed_exact_replay", "v1 inline replay failed");
  assert(result.verification.pieces_checked === 2 && result.verification.bytes_checked === EXPECTED.outputBytes && result.verification.verification_integer_operations === EXPECTED.usefulOperations, "v1 inline replay coverage changed");
  assert(verify.verified === true && verify.method === "independently_addressed_exact_replay", "v1 standalone replay failed");
  assert(verify.pieces_checked === 2 && verify.bytes_checked === EXPECTED.outputBytes && verify.verification_integer_operations === EXPECTED.usefulOperations, "v1 standalone replay coverage changed");
  assert(memory.external_timings["uninterrupted-run"].wall_ns === EXPECTED.v1ExternalWallNs, "v1 accepted external wall changed");
  validateTiming(memory, "uninterrupted-run", 0);
  validateTiming(memory, "uninterrupted-verify", 0);
  validateTiming(memory, "killed-run", 137);
  validateTiming(memory, "resumed-run", 0);
  validateTiming(memory, "resumed-verify", 0);
  assert(memory.maxima_kib.VmSwap_kib === 0 && memory.virtual_memory_within_external_limit === true, "v1 memory boundary changed");
  validateLaneWitness(acceptance, laneOverlap, 2);
  assert(acceptance.uninterrupted_output_root === EXPECTED.outputRoot && acceptance.resumed_output_root === EXPECTED.outputRoot, "v1 accepted roots changed");
  return { acceptance, workload, memory, result };
}

function validateComparison(v1, v2) {
  assert(equalArray(v1.workload.left_shape, v2.workload.left_shape) && equalArray(v1.workload.right_shape, v2.workload.right_shape), "release comparison uses different matrix shapes");
  assert(v1.workload.logical_input_bytes === v2.workload.logical_input_bytes, "release comparison uses different input bytes");
  assert(v1.workload.lanes === v2.workload.lanes && v1.workload.total_pieces === v2.workload.total_pieces, "release comparison uses different lane/piece counts");
  assert(v1.workload.opcode === v2.workload.opcode && v1.workload.isa_version === v2.workload.isa_version, "release comparison uses different opcode/ISA");
  assert(v1.result.metrics.useful_integer_operations === v2.uninterrupted.metrics.useful_integer_operations, "release comparison uses different useful operation counts");
  assert(v1.result.metrics.executed_primary_integer_operations === v2.uninterrupted.metrics.executed_primary_integer_operations, "release comparison uses different fresh primary operation counts");
  assert(v1.result.outputs[0].tensor.manifest_digest === v2.uninterrupted.outputs[0].tensor.manifest_digest, "release comparison output roots differ");
  assert(v1.memory.external_timings["uninterrupted-run"].observer === v2.memory.external_timings["uninterrupted-run"].observer, "release comparison timing observers differ");
}

function clearComparison() {
  for (const id of [
    "v2-wall", "v1-wall", "release-speedup", "v1-e2e", "v2-e2e", "ratio-e2e",
    "v1-execution", "v2-execution", "ratio-execution", "v1-finalization",
    "v2-finalization", "ratio-finalization", "v1-verification", "v2-verification",
    "ratio-verification"
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
    ["e2e", v1.result.metrics.end_to_end_ns, v2.uninterrupted.metrics.end_to_end_ns],
    ["execution", v1.result.metrics.execution_ns, v2.uninterrupted.metrics.execution_ns],
    ["finalization", v1.result.metrics.finalization_ns, v2.uninterrupted.metrics.finalization_ns],
    ["verification", v1.result.verification.verification_ns, v2.uninterrupted.verification.verification_ns]
  ];
  for (const [name, before, after] of phases) {
    byId("v1-" + name).textContent = seconds(before);
    byId("v2-" + name).textContent = seconds(after);
    byId("ratio-" + name).textContent = (before / after).toFixed(3) + "×";
  }
}

function disableCommercialLinks() {
  document.querySelectorAll("[data-commercial-resource]").forEach((link) => {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    if (!link.textContent.includes("pending verification")) {
      link.textContent += " · pending verification";
    }
  });
}

function enableCommercialLinks() {
  const resources = {
    record: COMMERCIAL_STATUS.root + COMMERCIAL_STATUS.recordPath,
    signature: COMMERCIAL_STATUS.root + COMMERCIAL_STATUS.signaturePath,
    "public-key": COMMERCIAL_STATUS.root + COMMERCIAL_STATUS.publicKeyPath,
    policy: COMMERCIAL_STATUS.root + COMMERCIAL_STATUS.allowedSignersPath,
    schema: COMMERCIAL_STATUS.root + "COMMERCIAL-STATUS.schema.json"
  };
  document.querySelectorAll("[data-commercial-resource]").forEach((link) => {
    const href = resources[link.dataset.commercialResource];
    assert(href, "commercial-status link names an unknown resource");
    link.href = href;
    link.removeAttribute("aria-disabled");
    link.textContent = link.textContent.replace(" · pending verification", "");
  });
}

function clearCommercialStatus(status = "CHECKING") {
  for (const id of ["record-contract", "record-adversarial", "record-reproduction", "record-evaluation"]) {
    const node = byId(id);
    node.textContent = status;
    node.className = status === "REJECTED" ? "fail" : "";
  }
  for (const id of ["physical-scaling-result", "hosted-reproduction-result", "external-workload-result"]) {
    byId(id).textContent = "—";
    byId(id).className = "";
  }
  byId("hero-adversarial").textContent = "verification pending";
  byId("hero-scaling").textContent = "verification pending";
  byId("hero-hosted").textContent = "verification pending";
  for (const row of document.querySelectorAll("[data-final-lane]")) {
    for (const cell of Array.from(row.children).slice(2)) cell.textContent = "—";
  }
  disableCommercialLinks();
}

function displayCommercialStatus(pack) {
  const recordStates = [
    ["record-contract", "VERSION 1", "pass"],
    ["record-adversarial", "214 / 214", "pass"],
    ["record-reproduction", "3 / 3 VM JOBS", "pass"],
    ["record-evaluation", "SIGNED / CURRENT", "pass"]
  ];
  for (const [id, label, className] of recordStates) {
    byId(id).textContent = label;
    byId(id).className = className;
  }

  byId("hero-adversarial").textContent = "214 / 214 validated";
  byId("hero-scaling").textContent = "100 / 100 retained";
  byId("hero-hosted").textContent = "3 / 3 VM jobs";
  for (const lanes of [1, 2, 4, 8, 16]) {
    const cold = pack.scalingCells.get("cold_unprimed/" + lanes);
    const warm = pack.scalingCells.get("warm_primed/" + lanes);
    const row = document.querySelector("[data-final-lane='" + lanes + "']");
    const cells = row.children;
    cells[2].textContent = (Number(cold.median_wall_ns_decimal) / 1e9).toFixed(3) + " s";
    cells[3].textContent = cold.speedup_decimal + "×";
    cells[4].textContent = (Number(warm.median_wall_ns_decimal) / 1e9).toFixed(3) + " s";
    cells[5].textContent = warm.speedup_decimal + "×";
  }
  byId("physical-scaling-result").textContent = "1.315× cold / 1.214× warm";
  byId("physical-scaling-result").className = "pass";
  byId("hosted-reproduction-result").textContent = "3 / 3 VM JOBS · SAME ROOT";
  byId("hosted-reproduction-result").className = "pass";
  byId("external-workload-result").textContent = "UCI IRIS · 3-WAY EXACT AGREEMENT";
  byId("external-workload-result").className = "pass";
  enableCommercialLinks();
}
function displayIo(prefix, counter) {
  byId("io-" + prefix + "-auth").textContent = exactBytes(counter.authenticated_chunk_bytes);
  byId("io-" + prefix + "-requested").textContent = exactBytes(counter.requested_bytes);
  byId("io-" + prefix + "-loads").textContent = counter.chunk_loads.toLocaleString("en-US");
  byId("io-" + prefix + "-hits").textContent = counter.cache_hits.toLocaleString("en-US");
}

function displayV2(validated) {
  const { acceptance, workload, memory, laneOverlap, uninterrupted, resumed, postKill } = validated;
  const captured = new Date(acceptance.captured_at_utc);
  const capturedText = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(captured);
  const witnessedLanes = new Set(laneOverlap.witness.tasks.map((task) => task.lane_index)).size;

  byId("release-verdict").textContent = "PASS";
  byId("release-verdict").className = "pass";
  byId("capture-time").textContent = capturedText;
  byId("binary-hash").textContent = shortHash(acceptance.binary_sha256);
  byId("binary-hash").title = acceptance.binary_sha256;
  byId("source-hash").textContent = shortHash(acceptance.source_tree_sha256);
  byId("source-hash").title = acceptance.source_tree_sha256;
  byId("manifest-hash").textContent = shortHash(RELEASES.v2.manifestSha256);
  byId("manifest-hash").title = RELEASES.v2.manifestSha256;
  byId("logical-input").textContent = humanBytes(workload.logical_input_bytes);
  byId("memory-ratio").textContent = (workload.logical_input_bytes / workload.certified_managed_peak_bytes).toFixed(3) + "×";
  byId("managed-peak").textContent = humanBytes(workload.certified_managed_peak_bytes);
  byId("lane-count").textContent = witnessedLanes + " / " + laneOverlap.configured_lanes;
  byId("peak-rss").textContent = humanBytes(memory.maxima_kib.VmHWM_kib * 1024);
  byId("swap-used").textContent = humanBytes(memory.maxima_kib.VmSwap_kib * 1024, 0);
  byId("gpu-count").textContent = String(acceptance.syscall_trace.product_gpu_device_paths);
  byId("network-count").textContent = String(acceptance.syscall_trace.product_network_syscalls);
  byId("kill-time").textContent = (memory.external_timings["killed-run"].wall_ns / 1e9).toFixed(3) + " s";
  byId("output-root").textContent = acceptance.uninterrupted_output_root;
  byId("uninterrupted-assignments").textContent = assignmentLabel(uninterrupted.metrics.executed_assignments);
  byId("retained-assignments").textContent = assignmentLabel(postKill.receipt_assignments);
  byId("reused-assignments").textContent = assignmentLabel(resumed.metrics.reused_assignments);
  byId("executed-assignments").textContent = assignmentLabel(resumed.metrics.executed_assignments);
  byId("capture-footer").textContent = "CAPTURED " + captured.toISOString();

  displayIo("admission", EXPECTED.admissionIo);
  displayIo("primary", EXPECTED.primaryIo);
  displayIo("replay", EXPECTED.verificationInputIo);
  displayIo("output", EXPECTED.verificationOutputIo);

  const timingNames = {
    input_chunk: "corrupt-input-chunk",
    checkpoint_piece: "corrupt-checkpoint-piece",
    checkpoint_receipt: "corrupt-checkpoint-receipt",
    image: "corrupt-image",
    result: "corrupt-result"
  };
  for (const [probe, timing] of Object.entries(timingNames)) {
    const card = document.querySelector("[data-probe='" + probe + "']");
    const passed = acceptance.corruption_rejection[probe] === "passed"
      && memory.external_timings[timing].exit_status === 1;
    card.className = passed ? "pass" : "fail";
    card.querySelector("b").textContent = passed ? "REJECTED · EXIT 1" : "NOT PROVEN";
  }
}

async function loadAndValidate() {
  if (state.loading) return;
  state.loading = true;
  state.ready = false;
  clearComparison();
  clearCommercialStatus();
  releaseState("pending", "hashing releases, Contract v1, and commercial status");
  byId("rerun-verification").disabled = true;
  byId("rerun-verification").textContent = "checking…";
  for (const name of ["v2-manifest", "v2-pack", "v1-pack", "contract", "comparison", "trust-pack", "final-index", "final-signature", "final-semantics"]) setCheck(name, "", "checking");

  try {
    const [v2Release, v1Release, trustPack, commercialStatus] = await Promise.all([
      loadSelectedRelease("v2", RELEASES.v2),
      loadSelectedRelease("v1", RELEASES.v1),
      loadContractPack(),
      loadCommercialStatusPack()
    ]);
    setCheck("v2-manifest", "pass", RELEASES.v2.manifestEntries.toLocaleString() + " full-capture entries");
    setCheck("v2-pack", "pass", RELEASES.v2.files.length + " / " + RELEASES.v2.files.length + " selected files");
    setCheck("v1-pack", "pass", RELEASES.v1.files.length + " / " + RELEASES.v1.files.length + " selected files");

    const v2 = validateV2(v2Release);
    const v1 = validateV1(v1Release);
    setCheck("contract", "pass", "independently recomputed / pass");
    validateComparison(v1, v2);
    setCheck("comparison", "pass", "same workload / roots / observer");
    validateContractPack(trustPack);
    setCheck("trust-pack", "pass", CONTRACT_V1.files.length + " integrity-checked public files");
    setCheck("final-index", "pass", "canonical record / exact SHA-256");
    setCheck("final-signature", "pass", "signature + key + namespace policy pinned");
    setCheck("final-semantics", "pass", "commercial status + technical evidence verified");

    state.v2 = { release: v2Release, validated: v2 };
    state.v1 = { release: v1Release, validated: v1 };
    state.commercialStatus = commercialStatus;
    state.ready = true;
    displayV2(v2);
    displayComparison(v1, v2);
    displayCommercialStatus(commercialStatus);
    byId("verification-copy").textContent = "The selected v2/v1 evidence, Contract v1, and current commercial-status record match their pinned SHA-256 identities. The production gate authenticates the detached OpenSSH signature and signer namespace; this browser independently checks the published record, signature, key, policy, and evidence semantics before displaying results.";
    releaseState("pass", "signed commercial status and evidence verified");
  } catch (error) {
    const publicationPending = error instanceof Error
      && error.message === "Commercial status publication pending";
    state.ready = false;
    state.v2 = null;
    state.v1 = null;
    state.commercialStatus = null;
    clearComparison();
    clearCommercialStatus(publicationPending ? "PENDING" : "REJECTED");
    byId("release-verdict").textContent = publicationPending ? "PENDING" : "REJECTED";
    byId("release-verdict").className = publicationPending ? "" : "fail";
    if (publicationPending) {
      for (const name of ["contract", "comparison", "trust-pack", "final-index", "final-signature", "final-semantics"]) setCheck(name, "", "publication pending");
      byId("verification-copy").textContent = "The signed commercial-status publication is being finalized. Current-status resources remain disabled until every exact digest is pinned.";
      releaseState("pending", "commercial-status publication pending");
      return;
    }
    setCheck("contract", "fail", "rejected");
    setCheck("comparison", "fail", "not displayed");
    setCheck("trust-pack", "fail", "rejected");
    setCheck("final-index", "fail", "rejected");
    setCheck("final-signature", "fail", "rejected");
    setCheck("final-semantics", "fail", "not displayed");
    byId("verification-copy").textContent = error.message;
    releaseState("fail", "selected release evidence rejected");
    throw error;
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

if (typeof document.querySelectorAll === "function") assertCommercialUiBoundary();

byId("verify-release").addEventListener("click", () => {
  byId("verify").scrollIntoView({ behavior: "smooth", block: "start" });
  loadAndValidate().catch(() => {});
});
byId("rerun-verification").addEventListener("click", () => loadAndValidate().catch(() => {}));
byId("copy-commands").addEventListener("click", copyCommands);

window.__MFENX_TEST__ = Object.freeze({
  validateV2,
  validateV1,
  validateComparison,
  validateCommercialStatus
});
updateClock();
window.setInterval(updateClock, 1000);
loadAndValidate().catch(() => {});
