import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";

const source = await readFile(new URL("../public/network/status-client.js", import.meta.url), "utf8");
const { NETWORK, validateStatus, fetchStatus, pollStatus } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
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
test("daily empty-block schedule accepts idle chain but rejects overdue tip", () => {
  const data = fresh(); data.identity.started_at = "2026-09-26T05:00:00Z";
  data.last_finalized_at = "2026-09-26T07:00:00Z"; check(data);
  data.last_finalized_at = "2026-09-26T06:58:29Z"; assert.throws(() => check(data), /heartbeat/);
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
  assert.equal(current.genesisHash, NETWORK.genesisHash); assert.deepEqual(current.rpc, [NETWORK.apiRoot]);
  assert.equal(current.protocol, "mfenx-native"); assert.equal(current.evmCompatible, false);
  assert.equal(current.publicRpcMode, "read_only"); assert.equal(current.transactionSubmission, "operator_only");
  assert.equal(current.manifestURL, `${NETWORK.apiRoot}network-manifest.json`);
  assert.equal(current.statusURL, NETWORK.statusUrl);
  assert.equal(retired.currentNetworkMetadataURL, "https://mfenx.com/network/2026092601.json");
  assert.equal(retired.retirementRecordURL, "https://github.com/ethereum-lists/chains/pull/8790");
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
    const text = await readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
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
