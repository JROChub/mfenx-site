/* Public telemetry is a reported observation, not a signature or liveness proof. */
export const NETWORK = Object.freeze({
  name: "MFENX Native 2026",
  chainId: 2026092601,
  historyId: "mfenx-native-2026-09-27",
  apiRoot: "https://license.mfenx.com/network/2026/",
  statusUrl: "https://license.mfenx.com/network/2026/network-status.json",
  genesisHash: "0x3b0b36b6acdcc5f0d7a1e38dd6621c58a9546a0e1a98cb58911b7646a0de5e8e",
});
export const MAX_AGE_MS = 60_000;
const HASH = /^0x[0-9a-f]{64}$/;
const MAX_BYTES = 65_536;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function record(value, name) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  return value;
}
function integer(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  requireValue(Number.isSafeInteger(value) && value >= 0 && value <= maximum, `${name} is invalid`);
}
function text(value, name, maximum = 200) {
  requireValue(typeof value === "string" && value.trim().length > 0 && value.length <= maximum, `${name} is invalid`);
}
function instant(value, name) {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value), `${name} must be UTC ISO time`);
  const time = Date.parse(value);
  requireValue(Number.isFinite(time), `${name} is invalid`);
  requireValue(new Date(time).toISOString().slice(0, 19) === value.slice(0, 19), `${name} is not a real calendar time`);
  return time;
}

export function validateStatus(value, now = Date.now(), genesisHash = NETWORK.genesisHash) {
  const data = record(value, "Status");
  requireValue(data.schema === "mfenx.network-status.v1", "Unrecognized status schema");
  requireValue(HASH.test(genesisHash ?? ""), "Reviewed genesis identity is not configured");
  const identity = record(data.identity, "Identity");
  requireValue(identity.name === NETWORK.name && identity.chain_id === NETWORK.chainId && identity.history_id === NETWORK.historyId,
    "Status belongs to a different network history");
  requireValue(identity.genesis_hash === genesisHash, "Genesis does not match the reviewed history");
  requireValue(identity.previous_chain_id === 177155 && identity.previous_history_restored === false,
    "The original ledger must not be presented as restored");
  const generated = instant(data.generated_at, "generated_at");
  const sampled = instant(data.sampled_at, "sampled_at");
  const started = instant(identity.started_at, "started_at");
  for (const [name, time] of [["Generated status", generated], ["Health sample", sampled]]) {
    requireValue(time <= now + 10_000 && now - time <= MAX_AGE_MS, `${name} is stale or future-dated`);
  }
  requireValue(started <= sampled && sampled <= generated + 1000, "History/sample timestamps are inconsistent");
  if (data.last_finalized_at !== null) {
    const finalized = instant(data.last_finalized_at, "last_finalized_at");
    requireValue(finalized >= started && finalized <= generated + 10_000, "Finalized time is outside this history");
  }
  requireValue(data.empty_block_interval_seconds === 86400, "Unexpected empty-block schedule");
  const topology = record(data.topology, "Topology");
  requireValue(topology.validator_count === 3 && topology.quorum === 2 && topology.host_count === 1 && topology.failure_domain_count === 1,
    "Unexpected deployment topology");
  requireValue(Array.isArray(topology.regions) && topology.regions.length === 1 && topology.regions[0] === "sfo3",
    "Region does not match the reviewed deployment");
  requireValue(["starting", "operational", "degraded", "unavailable"].includes(data.status), "Unknown network state");
  const rpc = record(data.rpc, "RPC");
  requireValue(rpc.url === NETWORK.apiRoot, "RPC does not match this network history");
  requireValue(typeof rpc.reachable === "boolean" && typeof data.quorum_agreement === "boolean", "Health flags must be boolean");
  integer(data.validators_healthy, "Healthy validators", 3);
  if (data.block_height !== null) integer(data.block_height, "Block height");
  requireValue(data.tip_hash === null || (typeof data.tip_hash === "string" && HASH.test(data.tip_hash)), "Invalid current tip hash");
  requireValue((data.block_height === null) === (data.tip_hash === null), "Current tip and height must be observed together");
  text(data.client, "Client", 256);
  requireValue(Array.isArray(data.validators) && data.validators.length === 3, "Three validator observations are required");
  const ids = new Set(), peers = new Set();
  for (const validator of data.validators) {
    record(validator, "Validator");
    text(validator.node_id, "Validator node ID", 128);
    text(validator.peer_id, "Validator peer ID", 128);
    requireValue(!ids.has(validator.node_id) && !peers.has(validator.peer_id), "Duplicate validator identity");
    ids.add(validator.node_id); peers.add(validator.peer_id);
    requireValue(typeof validator.healthy === "boolean", "Validator health must be boolean");
    if (validator.height !== null) integer(validator.height, "Validator height");
    requireValue(validator.tip_hash === null || HASH.test(validator.tip_hash), "Invalid validator tip hash");
    requireValue(validator.genesis_hash === null || validator.genesis_hash === genesisHash, "Validator genesis mismatch");
    if (validator.healthy) {
      requireValue(validator.admission === "open", "Healthy validator admission must be open");
      requireValue(validator.height !== null && HASH.test(validator.tip_hash ?? "") && validator.genesis_hash === genesisHash,
        "Healthy validator lacks a bound observation");
    }
  }
  const healthy = data.validators.filter(item => item.healthy);
  requireValue(healthy.length === data.validators_healthy, "Healthy validator count mismatch");
  if (data.quorum_agreement) {
    requireValue(data.block_height !== null && healthy.some(first => healthy.filter(other =>
      other.height === data.block_height && other.tip_hash === data.tip_hash &&
      first.height === other.height && first.tip_hash === other.tip_hash).length >= 2),
    "Quorum agreement lacks two matching bound observations");
  }
  if (data.status === "operational") {
    requireValue(rpc.reachable && data.quorum_agreement && healthy.length === 3 && data.block_height > 0 && data.last_finalized_at !== null,
      "Operational state requires all three validators, reachable RPC and a finalized nonzero height");
    requireValue(healthy.every(item => item.height === data.block_height && item.tip_hash === healthy[0].tip_hash),
      "Operational validators disagree on the current tip");
    const finalized = instant(data.last_finalized_at, "last_finalized_at");
    requireValue(sampled - finalized <= 86_490_000, "Operational tip is older than the heartbeat tolerance");
  }
  const enrollment = record(data.enrollment, "Enrollment");
  requireValue(enrollment.observers === false && enrollment.validators === false, "Enrollment is not enabled for this reviewed deployment");
  const availability = record(data.availability, "Availability");
  requireValue(availability.window_seconds === 86400, "Unexpected observation window");
  integer(availability.observed_seconds, "Observed seconds", 86400);
  integer(availability.sample_count, "Sample count");
  integer(availability.successful_samples, "Successful samples", availability.sample_count);
  requireValue(availability.observed_seconds <= Math.ceil((sampled - started) / 1000) + 5,
    "Observation coverage predates this history");
  if (availability.sample_count === 0) {
    requireValue(availability.percent === null && availability.successful_samples === 0, "No samples cannot establish availability");
  } else {
    requireValue(typeof availability.percent === "number" && Number.isFinite(availability.percent) &&
      Math.abs(availability.percent - 100 * availability.successful_samples / availability.sample_count) <= .001,
      "Sample success percentage is inconsistent");
  }
  requireValue(record(data.reliability_campaign, "Reliability campaign").status === "not_started",
    "No reviewed reliability campaign has been completed for this history");
  return data;
}

export async function fetchStatus({ signal, fetchImpl = fetch, now = Date.now, genesisHash = NETWORK.genesisHash } = {}) {
  const response = await fetchImpl(NETWORK.statusUrl, {
    method: "GET", cache: "no-store", credentials: "omit", redirect: "error", signal,
    headers: { Accept: "application/json" },
  });
  requireValue(response.ok, `Status endpoint returned HTTP ${response.status}`);
  requireValue((response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() === "application/json", "Status response is not JSON");
  const length = Number(response.headers.get("content-length"));
  requireValue(!Number.isFinite(length) || length <= MAX_BYTES, "Status response exceeds the size limit");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Status response exceeds the size limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return validateStatus(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), now(), genesisHash);
}

export function pollStatus(onStatus, onFailure) {
  let stopped = false, timer, controller;
  const refresh = async () => {
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const data = await fetchStatus({ signal: controller.signal });
      if (!stopped) onStatus(data);
    } catch (error) {
      if (!stopped) onFailure(error instanceof Error ? error.message : "Status unavailable");
    } finally {
      clearTimeout(timeout);
      if (!stopped) timer = setTimeout(refresh, 15_000);
    }
  };
  refresh();
  return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
}
