/* Copyright (c) 2026 MFENX. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-MFENX-Proprietary
 * Public tests use only the published WASM and the independent JS checker.
 */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {webcrypto} from "node:crypto";
import {LEVELS, MODULES, DEFAULT_BOARD, getDemoBoard, getDefaultBoard, generateInputs, validateBoard} from "../public/lightsout/atomic/levels.mjs";
import {METRIC_NAMES, fullRingProduct, deriveMetrics, verifyExecution, evaluateObjectives, validateRequest, createCapsule, verifyCapsule, outputDigest, sha256} from "../public/lightsout/atomic/verifier.mjs";
import {instantiateEngine, executeEngine, createMessageHandler, validateManifest, validateFixedMemory} from "../public/lightsout/atomic/simulation-worker.mjs";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", {value: webcrypto});
const base = new URL("../public/lightsout/atomic/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("engine-manifest.json", base), "utf8"));
const wasm = new Uint8Array(await readFile(new URL("qqfenx.wasm", base)));
const copy = value => structuredClone(value);
const fresh = () => instantiateEngine(copy(manifest), Uint8Array.from(wasm));
const request = (id = 1, level = 0, board = getDemoBoard(level), seed = LEVELS[level].seed) => ({id, type: "run", level, board, seed});

function fixture(level = 0, board = getDemoBoard(level), seed = LEVELS[level].seed) {
  const input = generateInputs(level, board, seed);
  const C = fullRingProduct(input.A, input.B, input.n), E = fullRingProduct(C, input.D, input.n);
  const stages = [{output: C, ...deriveMetrics(input.A, input.B, C, input.n, input.tile)}, {output: E, ...deriveMetrics(C, input.D, E, input.n, input.tile)}];
  return {input, stages};
}

test("frozen missions/modules, independent board copies, deterministic inputs", () => {
  assert(Object.isFrozen(LEVELS)); assert(Object.isFrozen(MODULES)); assert(Object.isFrozen(DEFAULT_BOARD));
  for (const level of LEVELS) {
    assert(Object.isFrozen(level)); assert(Object.isFrozen(level.targets)); assert(Object.isFrozen(level.bShifts));
    const demo = getDemoBoard(level.id), defaults = getDefaultBoard(level.id);
    demo[0] = 99; defaults[0] = 99;
    assert.notEqual(getDemoBoard(level.id)[0], 99); assert.notEqual(getDefaultBoard(level.id)[0], 99);
    const first = generateInputs(level.id, getDemoBoard(level.id));
    const second = generateInputs(level.id, getDemoBoard(level.id));
    assert.deepEqual(first, second);
    first.A.fill(0); assert(second.A.some(word => word !== 0));
  }
});

test("actual C11 WASM solves all four demos; all mixed starts remain unsolved", async () => {
  const loaded = await fresh();
  assert.equal(loaded.engine.memory.buffer.byteLength, 4194304);
  assert.deepEqual(WebAssembly.Module.imports(await WebAssembly.compile(wasm)), []);
  for (const level of LEVELS) for (const demo of [false, true]) {
    const board = demo ? getDemoBoard(level.id) : getDefaultBoard(level.id);
    const input = generateInputs(level.id, board), checked = verifyExecution(input, executeEngine(loaded, input));
    assert.equal(evaluateObjectives(level.id, board, checked.totals).won, demo);
    assert.equal(checked.totals.replay_macs, 2 * level.n ** 3);
    assert.equal(checked.totals.requested, checked.totals.executed + checked.totals.annihilated);
  }
  const input = generateInputs(3, getDemoBoard(3)), checked = verifyExecution(input, executeEngine(loaded, input));
  assert.equal(checked.totals.annihilated, 40960);
  assert.equal(checked.totals.executed, 24576);
  assert.equal(checked.totals.zero_tiles, 16);
});

test("seed extremes and sixty-four random designs replay exactly through actual WASM", async () => {
  const loaded = await fresh();
  let state = 0x6ce123ab;
  function next() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; }
  for (const level of LEVELS) {
    for (const seed of [0, 1, 0x80000000, 0xffffffff]) {
      const board = getDemoBoard(level.id), input = generateInputs(level.id, board, seed);
      const checked = verifyExecution(input, executeEngine(loaded, input));
      assert.equal(evaluateObjectives(level.id, board, checked.totals).won, true);
    }
    for (let trial = 0; trial < 16; trial++) {
      const input = generateInputs(level.id, Array.from({length: 16}, () => next() % 5), next());
      const checked = verifyExecution(input, executeEngine(loaded, input));
      assert.equal(checked.totals.requested, 2 * input.n ** 3);
    }
  }
});

test("full-ring replay includes high words, negatives, overflow, and all zero terms", async () => {
  const loaded = await fresh();
  for (const n of [8, 16, 24, 32]) {
    const patterns = [0xffffffff, 0x80000000, 1, 0, 0x7fffffff, 0xfffffffe];
    const A = Uint32Array.from({length: n * n}, (_, i) => patterns[i % patterns.length]);
    const B = Uint32Array.from({length: n * n}, (_, i) => patterns[(i * 5 + 1) % patterns.length]);
    const D = Uint32Array.from({length: n * n}, (_, i) => patterns[(i * 3 + 2) % patterns.length]);
    verifyExecution({n, tile: n / 4, A, B, D}, executeEngine(loaded, {n, tile: n / 4, A, B, D}));
    const zero = new Uint32Array(n * n);
    const checked = verifyExecution({n, tile: n / 4, A: zero, B, D}, executeEngine(loaded, {n, tile: n / 4, A: zero, B, D}));
    assert.equal(checked.totals.annihilated, 2 * n ** 3);
    assert.equal(checked.totals.replay_macs, 2 * n ** 3);
  }
});

test("every counter field, first/middle/final outputs, and all shifts are checked", () => {
  const {input, stages} = fixture(2);
  verifyExecution(input, stages);
  for (let stage = 0; stage < 2; stage++) {
    for (const name of METRIC_NAMES) {
      const mutation = copy(stages); mutation[stage].metrics[name]++;
      assert.throws(() => verifyExecution(input, mutation));
    }
    for (const index of [0, input.n * input.n / 2, input.n * input.n - 1]) {
      const mutation = copy(stages); mutation[stage].output[index] = (mutation[stage].output[index] + 1) >>> 0;
      assert.throws(() => verifyExecution(input, mutation), /Full-ring replay/);
    }
    for (let index = 0; index < 16; index++) {
      const mutation = copy(stages); mutation[stage].shifts[index] = (mutation[stage].shifts[index] + 1) % 33;
      assert.throws(() => verifyExecution(input, mutation), /tile-content/);
    }
  }
  const forged = copy(stages); forged[0].output.fill(0); forged[1].output.fill(0);
  assert.throws(() => verifyExecution(input, forged));
  const extra = copy(stages); extra[0].metrics.forged = 1;
  assert.throws(() => verifyExecution(input, extra));
  for (const value of [-1, 2 ** 32, NaN, Infinity, 1.5, "0"]) {
    const invalid = copy(stages); invalid[0].output[0] = value;
    assert.throws(() => verifyExecution(input, invalid));
  }
});

test("invalid request geometry/schema/IDs never load or execute WASM", async () => {
  const invalid = [null, [], {}, {...request(), type: "unknown"}, {...request(), level: 4}, {...request(), level: -1}, {...request(), level: "0"}, {...request(), board: []}, {...request(), board: new Array(16)}, {...request(), board: new Array(17).fill(0)}, {...request(), board: new Array(16).fill(5)}, {...request(), seed: 2 ** 32}, {...request(), seed: -1}, {...request(), seed: 1.5}, {...request(), id: "1"}, {...request(), id: -1}, {...request(), budget: 2 ** 32}, {...request(), n: 8192}, {...request(), output: []}, {...request(), type: "replay", capsule: {}}];
  let loads = 0;
  const messages = [], handle = createMessageHandler(message => messages.push(message), async () => { loads++; return fresh(); });
  for (const value of invalid) {
    await handle(value);
    assert.equal(messages.at(-1).type, "error");
    assert.equal(messages.at(-1).error.code, "INVALID_REQUEST");
  }
  assert.equal(loads, 0);
  const decorated = getDefaultBoard(); decorated.untrusted = 1;
  assert.throws(() => validateBoard(decorated));
  const hidden = getDefaultBoard(); Object.defineProperty(hidden, "untrusted", {value: 1});
  assert.throws(() => validateBoard(hidden));
  const symbolic = getDefaultBoard(); symbolic[Symbol("untrusted")] = 1;
  assert.throws(() => validateBoard(symbolic));
  const boardGetter = getDefaultBoard(); Object.defineProperty(boardGetter, 0, {get() { assert.fail("board getter ran"); }});
  assert.throws(() => validateBoard(boardGetter), /module ID/);
  const accessor = request(); Object.defineProperty(accessor, "level", {get() { throw new Error("getter must not run"); }});
  assert.throws(() => validateRequest(accessor), /field/);
  const typeGetter = request(); Object.defineProperty(typeGetter, "type", {get() { assert.fail("type getter ran"); }});
  assert.throws(() => validateRequest(typeGetter), /field/);
  assert.throws(() => executeEngine({}, {n: 4096, tile: 1024}), /geometry/);
});

test("an over-budget computation is verified but cannot win", async () => {
  const messages = [], handle = createMessageHandler(message => messages.push(message), fresh);
  await handle(request(1, 0, new Array(16).fill(3)));
  const result = messages.at(-1);
  assert.equal(result.type, "result"); assert.equal(result.report.verified, true);
  assert.equal(result.report.won, false); assert.equal(result.report.cost, 48);
  assert.equal(result.report.objectives.find(item => item.id === "budget").passed, false);
  assert.equal(result.report.totals.zero_tiles, 16);
});

test("manifest hash, length, ABI, imports and static memory caps fail closed", async () => {
  validateManifest(manifest); validateFixedMemory(wasm);
  const broken = Uint8Array.from(wasm); broken[broken.length - 1] ^= 1;
  await assert.rejects(instantiateEngine(copy(manifest), broken), /SHA-256/);
  await assert.rejects(instantiateEngine(copy(manifest), wasm.subarray(1)), /length/);
  const changes = [m => {m.abi.memory_bytes++;}, m => {m.abi.arena_bytes++;}, m => {m.abi.imports.push("env");}, m => {m.abi.max_n = 33;}, m => {m.abi.metric_names.reverse();}, m => {m.wasm.path = "../outside.wasm";}, m => {m.wasm.size_bytes = 2 ** 30;}, m => {m.build.threads = 4;}, m => {m.build.linear_memory_growth = true;}, m => {m.extra = true;}];
  for (const change of changes) { const m = copy(manifest); change(m); assert.throws(() => validateManifest(m)); }
  function memoryBody(bytes) {
    let at = 8;
    function size() { let n = 0, shift = 0, word; do { word = bytes[at++]; n += (word & 127) * 2 ** shift; shift += 7; } while (word & 128); return n; }
    while (at < bytes.length) { const id = bytes[at++], length = size(); if (id === 5) return at; at += length; }
    throw new Error("memory section missing");
  }
  const growing = Uint8Array.from(wasm); growing[memoryBody(growing) + 3] = 65;
  const m = copy(manifest); m.wasm.sha256 = await sha256(growing);
  await assert.rejects(instantiateEngine(m, growing), /four-MiB/);
  const importing = new Uint8Array([0,97,115,109,1,0,0,0, 1,4,1,96,0,0, 2,9,1,3,101,110,118,1,102,0,0, 5,4,1,1,64,64]);
  const imports = copy(manifest); imports.wasm.size_bytes = importing.length; imports.wasm.sha256 = await sha256(importing);
  await assert.rejects(instantiateEngine(imports, importing), /imports/);
});

test("capsule is a content identity, not authority: forged fields and forged outputs reject", async () => {
  const {input, stages} = fixture(1);
  const digest = await outputDigest(stages, input.n);
  const capsule = await createCapsule(1, input.seed, input.board, manifest.wasm.sha256, digest);
  assert.deepEqual(await verifyCapsule(copy(capsule), manifest.wasm.sha256), capsule);
  for (const change of [c => {c.seed ^= 1;}, c => {c.board[0] = 0;}, c => {c.sha256 = "0".repeat(64);}, c => {c.level = 9;}, c => {c.signature = "fake";}, c => {c.schema = "v2";}]) {
    const forged = copy(capsule); change(forged); await assert.rejects(verifyCapsule(forged, manifest.wasm.sha256));
  }
  const forgedOutput = await createCapsule(1, input.seed, input.board, manifest.wasm.sha256, "0".repeat(64));
  const messages = [], handle = createMessageHandler(message => messages.push(message), fresh);
  await handle({id: 12, type: "replay", capsule: forgedOutput});
  assert.equal(messages.at(-1).type, "error"); assert(!messages.some(message => message.type === "result"));
  await handle({id: 13, type: "replay", capsule});
  assert.equal(messages.at(-1).type, "result"); assert.equal(messages.at(-1).report.won, true);
  assert.deepEqual(messages.at(-1).report.capsule, capsule);
});

test("worker snapshots requests, rejects overlap in time, and protects its cached identity", async () => {
  let release;
  const ready = new Promise(resolve => {release = resolve;});
  const messages = [], handle = createMessageHandler(message => messages.push(message), async () => {await ready; return fresh();});
  const first = request(1), expectedBoard = [...first.board];
  const running = handle(first);
  first.board.fill(0); first.seed = 0; first.level = 3;
  await handle(request(2));
  assert.equal(messages.at(-1).error.code, "BUSY");
  release(); await running;
  assert.deepEqual(messages.at(-1).report.board, expectedBoard);
  assert.equal(messages.at(-1).report.level, 0);
  assert.equal(messages.at(-1).report.won, true);
  messages.at(-1).report.engine.sha256 = "0".repeat(64);
  messages.at(-1).report.stages[0].output.fill(0);
  await handle(request(3));
  assert.equal(messages.at(-1).report.engine.sha256, manifest.wasm.sha256);
  assert.equal(messages.at(-1).report.won, true);
  assert.deepEqual(messages.filter(message => message.id === 1).map(message => message.type === "progress" ? message.phase : message.type), ["execute", "replay", "result"]);
});

test("engine corruption or buffer alias never publishes a partial report", async () => {
  for (const mutation of ["word", "counter", "pointer", "budget"]) {
    const loaded = await fresh(), real = loaded.engine;
    const fake = {};
    for (const key of Object.keys(real)) fake[key] = real[key];
    if (mutation === "pointer") fake.atomic_output_ptr = () => real.atomic_input_ptr(0);
    else if (mutation === "budget") fake.atomic_set_budget = () => 2;
    else fake.atomic_run = (...args) => {
      const status = real.atomic_run(...args), view = new DataView(real.memory.buffer);
      const pointer = mutation === "word" ? real.atomic_output_ptr(0) : real.atomic_metrics_ptr(1);
      view.setUint32(pointer, (view.getUint32(pointer, true) + 1) >>> 0, true);
      return status;
    };
    const messages = [], handle = createMessageHandler(message => messages.push(message), async () => ({engine: fake, identity: loaded.identity}));
    await handle(request());
    assert.equal(messages.at(-1).type, "error");
    assert(!messages.some(message => message.type === "result"));
  }
});

test("real fetch pipeline is bounded, cached only on success, and fails closed on tampering", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++; assert.equal(options.redirect, "error");
      return new Response(String(url).endsWith("engine-manifest.json") ? JSON.stringify(manifest) : wasm);
    };
    const messages = [], handle = createMessageHandler(message => messages.push(message));
    await handle(request()); await handle(request(2));
    assert.equal(calls, 2); assert.equal(messages.at(-1).type, "result");
    globalThis.fetch = async () => new Response(new Uint8Array(16385));
    const oversized = [], reject = createMessageHandler(message => oversized.push(message));
    await reject(request());
    assert.equal(oversized.at(-1).type, "error"); assert.match(oversized.at(-1).error.message, /transfer bound/);
    globalThis.fetch = async url => new Response(String(url).endsWith("engine-manifest.json") ? JSON.stringify(manifest) : new Uint8Array(wasm.length));
    const tampered = [], fail = createMessageHandler(message => tampered.push(message));
    await fail(request()); assert.equal(tampered.at(-1).type, "error"); assert.match(tampered.at(-1).error.message, /SHA-256/);
  } finally { globalThis.fetch = original; }
});
