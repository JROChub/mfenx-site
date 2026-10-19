import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";

const source = await readFile(new URL("../public/network/status-client.js", import.meta.url), "utf8");
const { NETWORK, validateStatus, fetchStatus, pollStatus, storageObservation } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const fixture = JSON.parse(await readFile(new URL("./fixtures/network-status-v1.json", import.meta.url), "utf8"));
const now = Date.parse(fixture.generated_at);
const fresh = () => structuredClone(fixture);
const check = data => validateStatus(data, now);
const mutations = {
  "old history": data => data.identity.chain_id = 177155,
  "wrong history label": data => data.identity.history_id = "old-history",
  "wrong genesis": data => data.identity.genesis_hash = "0x" + "2".repeat(64),
  "false restoration claim": data => data.identity.previous_history_restored = true,
  "wrong schema": data => data.schema = "mfenx.network-status.v0",
  "stale generation": data => data.generated_at = "2026-09-27T06:58:59Z",
  "stale health sample": data => data.sampled_at = "2026-09-27T06:58:59Z",
  "future sample": data => data.sampled_at = "2026-09-27T07:00:11Z",
  "impossible calendar date": data => data.identity.started_at = "2026-02-31T06:58:00Z",
  "non UTC time": data => data.generated_at = "2026-09-27T07:00:00+01:00",
  "coverage before history": data => data.availability.observed_seconds = 1000,
  "three region claim": data => data.topology.regions = ["sfo3", "nyc3", "ams3"],
  "wrong single region": data => data.topology.regions = ["nyc3"],
  "three host claim": data => data.topology.host_count = 3,
  "wrong quorum": data => data.topology.quorum = 1,
  "duplicate identity": data => data.validators[1].node_id = data.validators[0].node_id,
  "duplicate peer": data => data.validators[1].peer_id = data.validators[0].peer_id,
  "RPC down claimed operational": data => data.rpc.reachable = false,
  "legacy RPC URL": data => data.rpc.url = "https://rpc.mfenx.com",
  "unpublished RPC hostname": data => data.rpc.url = "https://2026.rpc.mfenx.com",
  "unscoped shared hostname": data => data.rpc.url = "https://license.mfenx.com/",
  "unpinned telemetry alias": data => data.rpc.url = "https://rpc.mfenx.com/2026/",
  "missing RPC URL": data => delete data.rpc.url,
  "no agreement claimed operational": data => data.quorum_agreement = false,
  "two validators claimed operational": data => { data.validators[2].healthy = false; data.validators_healthy = 2; },
  "count inconsistency": data => data.validators_healthy = 2,
  "tip disagreement": data => data.validators[2].tip_hash = "0x" + "3".repeat(64),
  "height disagreement": data => data.validators[2].height = 2,
  "healthy unbound genesis": data => data.validators[2].genesis_hash = null,
  "healthy blocked admission": data => data.validators[2].admission = "blocked",
  "healthy unavailable admission": data => data.validators[2].admission = "unavailable",
  "healthy missing admission": data => delete data.validators[2].admission,
  "operational without finalized time": data => data.last_finalized_at = null,
  "operational genesis height": data => {
    data.block_height = 0;
    data.tip_hash = data.identity.genesis_hash;
    data.validators.forEach(v => { v.height = 0; v.tip_hash = data.identity.genesis_hash; });
  },
  "malformed tip": data => data.validators[2].tip_hash = "0xwrong",
  "malformed current tip": data => data.tip_hash = "0xwrong",
  "missing current tip": data => delete data.tip_hash,
  "current tip disagreement": data => data.tip_hash = "0x" + "3".repeat(64),
  "current tip without height": data => { data.status = "degraded"; data.quorum_agreement = false; data.block_height = null; },
  "current height without tip": data => { data.status = "degraded"; data.quorum_agreement = false; data.tip_hash = null; },
  "negative height": data => data.block_height = -1,
  "string height": data => data.block_height = "1",
  "unsafe height": data => data.block_height = Number.MAX_SAFE_INTEGER + 1,
  "negative samples": data => data.availability.sample_count = -1,
  "fabricated availability": data => data.availability.percent = 100,
  "fabricated campaign": data => data.reliability_campaign.status = "passed",
  "unexpected enrollment": data => data.enrollment.observers = true,
  "missing observed time": data => delete data.sampled_at,
  "missing finalized time": data => delete data.last_finalized_at,
  "old finalized time": data => data.last_finalized_at = "2026-09-27T06:00:00Z",
  "zero samples claiming percent": data => { data.availability.sample_count = 0; data.availability.successful_samples = 0; },
  "claimed quorum without observations": data => { data.status = "degraded"; data.validators.forEach(v => v.healthy = false); data.validators_healthy = 0; },
};
test("valid new-history snapshot and reviewed pin", () => {
  assert.equal(check(fresh()).status, "operational");
  assert.equal(NETWORK.apiRoot, "https://license.mfenx.com/network/2026/");
  assert.equal(NETWORK.statusUrl, "https://license.mfenx.com/network/2026/network-status.json");
  assert.throws(() => validateStatus(fresh(), now, null), /not configured/);
});
for (const [name, mutate] of Object.entries(mutations)) test(`reject ${name}`, () => {
  const data = fresh(); mutate(data); assert.throws(() => check(data));
});
test("two healthy validators can be degraded, never operational", () => {
  const data = fresh(); data.status = "degraded"; data.validators[2].healthy = false; data.validators_healthy = 2;
  data.validators[2].admission = "blocked";
  assert.equal(check(data).status, "degraded");
});
test("degraded state still rejects healthy validators with closed admission", () => {
  const data = fresh(); data.status = "degraded"; data.validators[2].healthy = false; data.validators_healthy = 2;
  data.validators[0].admission = "blocked";
  assert.throws(() => check(data), /admission must be open/);
});
test("starting observations carry null height, tip and sample percentage", () => {
  const data = fresh(); data.status = "starting"; data.rpc.reachable = false; data.quorum_agreement = false;
  data.validators_healthy = 0; data.block_height = null; data.tip_hash = null; data.last_finalized_at = null;
  data.validators.forEach(v => Object.assign(v, {healthy: false, admission: "unavailable", height: null, tip_hash: null, genesis_hash: null}));
  Object.assign(data.availability, {observed_seconds: 0, sample_count: 0, successful_samples: 0, percent: null});
  assert.equal(check(data).status, "starting");
});
test("Python UTC fractional timestamps are accepted", () => {
  const data = fresh(); data.generated_at = "2026-09-27T07:00:00.000000+00:00"; check(data);
});
for (const interval of [12]) test(`${interval}-second cadence uses its own exact freshness boundary`, () => {
  const data = fresh(); data.empty_block_interval_seconds = interval;
  data.identity.started_at = "2026-09-26T05:00:00Z";
  data.last_finalized_at = new Date(now - interval * 1000).toISOString(); check(data);
  data.last_finalized_at = new Date(now - (interval + 90) * 1000).toISOString(); check(data);
  data.last_finalized_at = new Date(now - (interval + 90) * 1000 - 1).toISOString();
  assert.throws(() => check(data), /heartbeat/);
});
for (const interval of [undefined, null, "12", "86400", 0, 1, 15, 12.5, 86400, 86401, NaN, Infinity]) {
  test(`reject unreviewed empty-block interval ${String(interval)} (${typeof interval})`, () => {
    const data = fresh(); data.empty_block_interval_seconds = interval;
    assert.throws(() => check(data), /empty-block schedule/);
  });
}
test("twelve-second cadence keeps the twenty-four-hour observation window", () => {
  const data = fresh(); data.empty_block_interval_seconds = 12;
  assert.equal(check(data).availability.window_seconds, 86400);
  data.availability.window_seconds = 12;
  assert.throws(() => check(data), /observation window/);
});
const storage = overrides => ({schema: "mfenx.native-storage-observation.v1", sampled_at_unix: now / 1000,
  ok: true, warning: null, ...overrides});
test("storage and backup warnings remain separate from consensus health", () => {
  const capacity = "observed_growth_reaches_storage_boundary_within_seven_days";
  const data = fresh(); data.storage = storage({warning: capacity, warnings: [capacity, "backup_stale"]});
  assert.equal(check(data).status, "operational");
  const observation = storageObservation(data.storage, now);
  assert.equal(observation.available, true);
  assert.deepEqual(observation.warningCodes, [capacity, "backup_stale"]);
  assert.match(observation.message, /within seven days/);
  assert.match(observation.message, /host backup is overdue/);
});
test("storage checks distinguish a reported failure from absent observations", () => {
  assert.match(storageObservation(storage({}), now).message, /reported no warning/);
  const failed = storageObservation(storage({ok: false, warning: "storage_observation_failed"}), now);
  assert.equal(failed.available, true); assert.match(failed.message, /check failed/);
  for (const value of [undefined, null, {ok: null, warning: "storage_observation_unavailable"}]) {
    assert.equal(storageObservation(value, now).available, false);
  }
});
for (const warning of ["disk_reserve_margin_below_one_gib", "backup_receipt_missing", "backup_receipt_invalid",
  "backup_archive_missing", "backup_archive_metadata_invalid", "backup_receipt_time_invalid", "backup_storage_mode_mismatch", "backup_stale"]) {
  test(`render reported ${warning} without changing operational status`, () => {
    const data = fresh(); data.storage = storage({warning});
    assert.equal(check(data).status, "operational");
    const observation = storageObservation(data.storage, now);
    assert.equal(observation.available, true);
    assert.deepEqual(observation.warningCodes, [warning]);
    assert.match(observation.message, /^(Storage|Backup) warning:/);
  });
}
test("storage observations enforce freshness and clear malformed or unrecognized warnings", () => {
  assert.equal(storageObservation(storage({sampled_at_unix: now / 1000 - 180}), now).available, true);
  assert.equal(storageObservation(storage({sampled_at_unix: now / 1000 + 10}), now).available, true);
  const invalid = [
    [], "backup_stale", storage({schema: "unknown"}), storage({ok: "true"}),
    storage({sampled_at_unix: "now"}), storage({sampled_at_unix: NaN}),
    storage({sampled_at_unix: now / 1000 - 180.001}), storage({sampled_at_unix: now / 1000 + 10.001}),
    storage({warning: "<img src=x onerror=alert(1)>"}), storage({warning: "__proto__"}),
    storage({warning: "x".repeat(1000)}), storage({warning: "backup_stale", warnings: ["backup_stale", "backup_stale"]}),
    storage({warning: "backup_stale", warnings: ["backup_stale", "backup_receipt_missing", "backup_receipt_invalid"]}),
    storage({warning: null, warnings: ["backup_stale"]}), storage({warning: "backup_stale", warnings: ["unknown"]}),
    storage({ok: false, warning: null}), storage({ok: true, warning: "storage_observation_failed"}),
    storage({ok: false, warning: "storage_observation_failed", warnings: ["storage_observation_failed", "backup_stale"]}),
  ];
  for (const value of invalid) {
    const observation = storageObservation(value, now);
    assert.equal(observation.available, false);
    assert.equal(observation.message, "Storage and backup observations are not available.");
    const data = fresh(); data.storage = value;
    assert.equal(check(data).status, "operational");
  }
});
test("observation pages load the cadence-aware module versions through every import", async () => {
  for (const pageName of ["status", "campaign", "register"]) {
    const page = await readFile(new URL(`../public/${pageName}.html`, import.meta.url), "utf8");
    assert.ok(page.includes(`src="/${pageName}.js?v=20261019-storage1"`));
    const entry = await readFile(new URL(`../public/${pageName}.js`, import.meta.url), "utf8");
    assert.ok(entry.includes('/network/history-view.js?v=20261019-storage1'));
  }
  const view = await readFile(new URL("../public/network/history-view.js", import.meta.url), "utf8");
  assert.ok(view.includes('./status-client.js?v=20261019-storage1'));
});
test("fetch uses exact new URL, no credentials, no redirects, bounded JSON", async () => {
  let captured;
  const data = await fetchStatus({now: () => now, fetchImpl: async (url, options) => {
    captured = {url, options}; return new Response(JSON.stringify(fresh()), {headers: {"Content-Type": "application/json"}});
  }});
  assert.equal(data.status, "operational"); assert.equal(captured.url, NETWORK.statusUrl);
  assert.equal(captured.options.method, "GET"); assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.redirect, "error"); assert.equal(captured.options.cache, "no-store");
});
for (const [name, response] of [
  ["HTTP 503", () => new Response("{}", {status: 503})],
  ["non JSON", () => new Response("{}", {headers: {"content-type": "text/html"}})],
  ["malformed JSON", () => new Response("{", {headers: {"content-type": "application/json"}})],
  ["oversize declared", () => new Response("{}", {headers: {"content-type": "application/json", "content-length": "65537"}})],
  ["oversize streamed", () => new Response(" ".repeat(65537), {headers: {"content-type": "application/json"}})],
  ["invalid UTF8", () => new Response(new Uint8Array([0xff]), {headers: {"content-type": "application/json"}})],
]) test(`fetch rejects ${name}`, async () => {
  await assert.rejects(fetchStatus({now: () => now, fetchImpl: async () => response()}));
});
test("retired chain has no RPC and new metadata has exact identity", async () => {
  const retired = JSON.parse(await readFile(new URL("../public/network/177155.json", import.meta.url)));
  const current = JSON.parse(await readFile(new URL("../public/network/2026092601.json", import.meta.url)));
  assert.equal(retired.chainId, 177155); assert.deepEqual(retired.rpc, []); assert.equal(retired.status, "retired");
  assert.equal(retired.historyRestored, false); assert.equal(current.chainId, NETWORK.chainId);
  assert.equal(current.genesisHash, NETWORK.genesisHash);
  assert.deepEqual(current.rpc, [NETWORK.apiRoot, "https://rpc.mfenx.com/2026/"]);
  assert.equal(current.protocol, "mfenx-native"); assert.equal(current.evmCompatible, true);
  assert.equal(current.publicRpcMode, "evm_contracts"); assert.equal(current.transactionSubmission, "public_signed_evm");
  assert.deepEqual(current.capabilities, ["native_signed_transfers", "contract_creation", "contract_calls", "contract_storage", "event_logs", "quorum_execution_replay", "gas_estimation", "fee_history", "account_history", "bounded_rpc_batches"]);
  assert.deepEqual(current.execution, {
    profile: "mfenx-evm-cancun-fee-free-v1", evmRevision: "cancun", backend: "revm", backendVersion: "43.0.3",
    activationHeight: 14, transactionType: "0x02", blockGasLimit: 3000000, gasPriceWei: "0",
    validatorReplay: true, stateCommitment: "mfenx-evm-contract-state-v1",
  });
  assert.equal(current.manifestURL, `${NETWORK.apiRoot}network-manifest.json`);
  assert.equal(current.statusURL, NETWORK.statusUrl);
  assert.equal(retired.currentNetworkMetadataURL, "https://mfenx.com/network/2026092601.json");
  assert.equal(retired.retirementRecordURL, "https://github.com/ethereum-lists/chains/pull/8790");
  const page = await readFile(new URL("../public/status.html", import.meta.url), "utf8");
  assert.match(page, /href="https:\/\/rpc\.mfenx\.com\/2026\/"/);
  assert.match(page, /href="https:\/\/license\.mfenx\.com\/network\/2026\/"/);
  assert.match(page, /public RPC accepts signed contract deployments, contract calls and native transfers/);
  assert.match(page, /href="\/network\/contracts\.html"/);
  assert.doesNotMatch(page, /public RPC is read only|protected loopback interface/);
  assert.match(page, /empty-block interval reported by the sampler/);
  assert.doesNotMatch(page, /Empty blocks are scheduled daily|Empty blocks are scheduled every twelve seconds/);
  const campaign = await readFile(new URL("../public/campaign.html", import.meta.url), "utf8");
  assert.match(campaign, /sampler reports the configured empty-block interval/);
  assert.match(campaign, /public RPC accepts signed contract deployments, contract calls and native transfers/);
  assert.doesNotMatch(campaign, /Empty blocks are scheduled daily|public RPC is read only|protected loopback interface/);
  const contract = await readFile(new URL("../docs/NETWORK_STATUS_CONTRACT.md", import.meta.url), "utf8");
  assert.match(contract, /`evmCompatible: true`/);
  assert.match(contract, /`transactionSubmission: public_signed_evm`/);
  assert.doesNotMatch(contract, /`evmCompatible: false`|`publicRpcMode: read_only`|`transactionSubmission: operator_only`|eth_sendRawTransaction` is not offered/);
});
test("contract execution record binds the published source and finalized ledger", async () => {
  const load = async path => JSON.parse(await readFile(new URL(`../public/network/${path}`, import.meta.url)));
  const current = await load("2026092601.json");
  const record = await load("execution-20261008.json");
  const ledger = await load("execution-20261008-ledger.json");
  const host = await load("execution-20261008-host.json");
  const archive = await readFile(new URL("../public/network/validator-execution-20261008.3.tar.gz", import.meta.url));
  const page = await readFile(new URL("../public/network/contracts.html", import.meta.url), "utf8");
  assert.equal(current.executionDocsURL, "https://mfenx.com/network/contracts.html");
  assert.equal(current.executionEvidenceURL, "https://mfenx.com/network/execution-20261008.json");
  assert.equal(current.executionLedgerURL, "https://mfenx.com/network/execution-20261008-ledger.json");
  const historicalSourceSha256 = "5da858924e47e1d376d6729f1b6e4d9fc659bd308039f45566e7547d26034db6";
  assert.equal(historicalSourceSha256, createHash("sha256").update(archive).digest("hex"));
  assert.equal(record.status, "passed");
  assert.equal(record.chain_id, NETWORK.chainId);
  assert.equal(record.genesis_hash, NETWORK.genesisHash);
  assert.equal(record.asset_value_transferred_wei, "0");
  assert.ok(Object.values(record.checks).length >= 6);
  assert.ok(Object.values(record.checks).every(passed => passed === true));
  assert.equal(ledger.chain_id, NETWORK.chainId);
  assert.equal(ledger.quorum, 2);
  assert.equal(ledger.validators.length, 3);
  assert.equal(new Set(ledger.validators).size, 3);
  assert.equal(ledger.blocks[0].proposal.hash, NETWORK.genesisHash);
  assert.equal(ledger.blocks.length, 19);
  assert.equal(ledger.evm.activation_height, current.execution.activationHeight);
  assert.equal(host.status, "passed");
  assert.equal(host.restart_tested, true);
  assert.equal(host.validators.length, ledger.validators.length);
  for (const validator of host.validators) {
    assert.equal(validator.height, ledger.blocks.length - 1);
    assert.equal(validator.genesis_hash, NETWORK.genesisHash);
    assert.equal(validator.tip, ledger.blocks.at(-1).proposal.hash);
    assert.equal(validator.contract_state_root, ledger.blocks.at(-1).proposal.state_root);
    assert.equal(validator.execution_profile, current.execution.profile);
    assert.equal(validator.historical_prefix_preserved, true);
    assert.equal(validator.matching_public_receipts, true);
    assert.equal(validator.committed_storage_value, 42);
  }
  const contract = ledger.evm.accounts[record.contract_address];
  assert.ok(contract.code.length > 500);
  assert.equal(BigInt(contract.storage["0x" + "0".repeat(64)]), 42n);
  for (const [hash, {receipt}] of Object.entries(record.transactions)) {
    const block = ledger.blocks[Number(BigInt(receipt.blockNumber))];
    assert.equal(block.proposal.hash, receipt.blockHash);
    assert.equal(block.proposal.evm.profile, current.execution.profile);
    const committed = block.proposal.evm.receipts.find(entry => entry.transaction_hash === hash);
    assert.ok(committed, `Missing finalized receipt ${hash}`);
    assert.equal(Number(BigInt(receipt.gasUsed)), committed.gas_used);
    assert.equal(Number(BigInt(receipt.status)), Number(committed.success));
    assert.ok(block.votes.length >= ledger.quorum);
  }
  assert.match(page, new RegExp(record.contract_address));
  assert.match(page, new RegExp(historicalSourceSha256));
  assert.match(page, /validate-state \.\.\/execution-20261008-ledger\.json/);
  assert.match(page, /not an Ethereum Merkle Patricia trie/);
  assert.match(page, /href="\/network\/MFENXExecutionProbe\.sol" download/);
  assert.doesNotMatch(page, /<script|<strong|<b[\s>]|style="/);
});
test("current validator source binds the separate storage release and acceptance evidence", async () => {
  const current = JSON.parse(await readFile(new URL("../public/network/2026092601.json", import.meta.url)));
  const record = JSON.parse(await readFile(new URL("../public/network/validator-storage-20261019.1.json", import.meta.url)));
  const archive = await readFile(new URL("../public/network/validator-execution-20261019.1.tar.gz", import.meta.url));
  const page = await readFile(new URL("../public/network/contracts.html", import.meta.url), "utf8");
  assert.equal(current.validatorSource.release, "20261019.1");
  assert.equal(current.validatorSource.sha256, createHash("sha256").update(archive).digest("hex"));
  assert.equal(current.validatorSource.sha256, record.source.sha256);
  assert.equal(current.validatorSource.url, record.source.url);
  assert.equal(current.validatorSource.localGitRevision, record.source.localGitRevision);
  assert.equal(current.validatorSource.localGitRevision, "cbfa978c7b07af210855e6e7b42d33c92bef22df");
  assert.equal(Object.hasOwn(current.validatorSource, "commit"), false);
  assert.equal(current.validatorSource.provenanceURL, "https://mfenx.com/network/validator-storage-20261019.1.json");
  assert.equal(record.schema, "mfenx.validator-storage-release.v1");
  assert.equal(record.chain.chainId, NETWORK.chainId);
  assert.equal(record.chain.genesisHash, NETWORK.genesisHash);
  assert.equal(record.storage.emptyBlockIntervalSeconds, 12);
  assert.equal(record.storage.mainFileLimitBytes, 262549504);
  assert.equal(record.validation.rust.failed, 0);
  assert.equal(record.validation.operations.failed, 0);
  assert.equal(record.validation.soak.passed, true);
  assert.equal(record.validation.concurrentMaintenance.passed, true);
  assert.equal(record.validation.capabilities.standalone.passed, true);
  assert.equal(record.validation.capabilities.heldWal.passed, true);
  assert.match(page, new RegExp(current.validatorSource.sha256));
  assert.match(page, /native-store-tool verify --database/);
  assert.match(page, /--max-bytes 536870912 --json/);
});
test("network PNG is published with exact dimensions, content digest and download link", async () => {
  const current = JSON.parse(await readFile(new URL("../public/network/2026092601.json", import.meta.url)));
  const retired = JSON.parse(await readFile(new URL("../public/network/177155.json", import.meta.url)));
  const png = await readFile(new URL("../public/assets/mfenx-network.png", import.meta.url));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.ok(png.length < 250000);
  for (const metadata of [current, retired]) {
    assert.equal(metadata.logo.https, "https://mfenx.com/assets/mfenx-network.png");
    assert.equal(metadata.logo.format, "png");
    assert.equal(metadata.logo.sha256, createHash("sha256").update(png).digest("hex"));
    assert.equal(metadata.logo.width, png.readUInt32BE(16));
    assert.equal(metadata.logo.height, png.readUInt32BE(20));
  }
  const page = await readFile(new URL("../public/status.html", import.meta.url), "utf8");
  assert.match(page, /href="\/assets\/mfenx-network\.png" download="mfenx-network\.png"/);
});
test("published enrollment script cannot probe or submit; old bootstrap addresses absent", async () => {
  for (const name of ["register.html", "register.js", "status.html", "status.js", "campaign.html", "campaign.js", "network/status-client.js", "network/history-view.js"]) {
    let text = await readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
    if (name === "status.html") text = text.replaceAll("https://rpc.mfenx.com/2026/", "CURRENT_SCOPED_RPC");
    assert.doesNotMatch(text, /159\.203\.109\.128|64\.23\.182\.213|164\.92\.150\.22|https:\/\/(?:2026\.)?rpc\.mfenx\.com|observer-probe|observer-registrations/);
  }
});
test("poll has a five-second abort deadline, no overlap and cancellable retry", async () => {
  const original = {fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  const timers = new Map(); let nextId = 0, calls = 0, failures = 0, currentSignal;
  let stop;
  try {
    globalThis.setTimeout = (callback, delay) => { const id = ++nextId; timers.set(id, {callback, delay}); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    globalThis.fetch = (_url, {signal}) => {
      calls++; currentSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Aborted fixture")), {once: true}));
    };
    stop = pollStatus(() => assert.fail("A timed out request cannot produce success"), () => failures++);
    assert.equal(calls, 1); assert.equal(timers.size, 1);
    const deadline = [...timers.values()][0]; assert.equal(deadline.delay, 5000);
    deadline.callback(); await tick();
    assert.equal(currentSignal.aborted, true); assert.equal(failures, 1); assert.equal(calls, 1);
    assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 15000);
    stop(); assert.equal(timers.size, 0);
  } finally { stop?.(); Object.assign(globalThis, original); }
});
