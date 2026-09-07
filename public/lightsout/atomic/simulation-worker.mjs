/* Copyright (c) 2026 MFENX. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-MFENX-Proprietary
 * One bounded worker. The controller owns its wall-clock termination deadline.
 */
import {generateInputs} from "./levels.mjs";
import {METRIC_NAMES, exactRecord, validateRequest, verifyExecution, evaluateObjectives, sha256, outputDigest, createCapsule, verifyCapsule} from "./verifier.mjs";

const MEMORY_BYTES = 4194304;
const ARENA_BYTES = 1048576;
const MAX_WASM_BYTES = 262144;
const FUNCTION_EXPORTS = Object.freeze(["atomic_abi_version", "atomic_max_n", "atomic_input_ptr", "atomic_output_ptr", "atomic_metrics_ptr", "atomic_shift_ptr", "atomic_set_budget", "atomic_run"]);
const HEX = /^[0-9a-f]{64}$/;

function equalArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, i) => value === expected[i]);
}

export function validateManifest(manifest) {
  exactRecord(manifest, ["schema", "name", "license", "notice", "wasm", "abi", "source", "build"], "engine manifest");
  if (manifest.schema !== "mfenx.atomic-engine.v1" || manifest.name !== "QQfenx C11 Atomic engine" || manifest.license !== "LicenseRef-MFENX-Commercial" || typeof manifest.notice !== "string" || manifest.notice.length > 2048) throw new Error("Unsupported engine manifest.");
  exactRecord(manifest.wasm, ["path", "sha256", "size_bytes"], "WASM identity");
  if (manifest.wasm.path !== "qqfenx.wasm" || typeof manifest.wasm.sha256 !== "string" || !HEX.test(manifest.wasm.sha256) || !Number.isInteger(manifest.wasm.size_bytes) || manifest.wasm.size_bytes < 8 || manifest.wasm.size_bytes > MAX_WASM_BYTES) throw new Error("Invalid WASM identity.");
  const abi = manifest.abi;
  exactRecord(abi, ["version", "max_n", "memory_bytes", "arena_bytes", "input_slots", "stages", "metric_names", "metric_word_bytes", "shift_word_bytes", "exports", "imports", "statuses"], "engine ABI");
  if (abi.version !== 1 || abi.max_n !== 32 || abi.memory_bytes !== MEMORY_BYTES || abi.arena_bytes !== ARENA_BYTES || abi.metric_word_bytes !== 4 || abi.shift_word_bytes !== 1 || !equalArray(abi.input_slots, ["A", "B", "D"]) || !equalArray(abi.stages, ["AB", "ABD"]) || !equalArray(abi.metric_names, METRIC_NAMES) || !equalArray(abi.exports, FUNCTION_EXPORTS) || !equalArray(abi.imports, [])) throw new Error("Engine ABI or resource cap mismatch.");
  exactRecord(abi.statuses, ["0", "1", "2", "3"], "engine status codes");
  if (!equalArray(Object.values(abi.statuses), ["success", "invalid_geometry_or_budget_argument", "arena_budget_exhausted", "engine_invariant_failure"])) throw new Error("Engine status contract mismatch.");
  exactRecord(manifest.build, ["backend", "compiler", "debug_sections", "language", "linear_memory_growth", "linker", "threads"], "engine build");
  if (manifest.build.backend !== "portable scalar" || manifest.build.language !== "C11" || manifest.build.threads !== 1 || manifest.build.linear_memory_growth !== false || manifest.build.debug_sections !== false || typeof manifest.build.compiler !== "string" || manifest.build.compiler.length > 1024 || typeof manifest.build.linker !== "string" || manifest.build.linker.length > 1024) throw new Error("Unexpected browser execution backend.");
  exactRecord(manifest.source, ["qqfenx_release_commit", "sha256"], "engine source identity");
  if (typeof manifest.source.qqfenx_release_commit !== "string" || !/^[0-9a-f]{40}$/.test(manifest.source.qqfenx_release_commit)) throw new Error("Invalid engine source identity.");
  exactRecord(manifest.source.sha256, ["arena.c", "arena.h", "atomic.c", "atomic.h", "build.py", "freestanding/stdlib.h", "freestanding/string.h", "vendor/qqfenx.c", "vendor/qqfenx.h"], "engine source hashes");
  if (Object.values(manifest.source.sha256).some(value => typeof value !== "string" || !HEX.test(value))) throw new Error("Invalid engine source hash.");
  return Object.freeze({sha256: manifest.wasm.sha256, bytes: manifest.wasm.size_bytes, memoryBytes: MEMORY_BYTES, arenaBytes: ARENA_BYTES});
}

// Check the declared hard ceiling before instantiation. A later byteLength
// check alone would detect growth only after the allocation had happened.
export function validateFixedMemory(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > MAX_WASM_BYTES || !equalArray(Array.from(bytes.subarray(0, 8)), [0, 97, 115, 109, 1, 0, 0, 0])) throw new Error("Invalid WASM envelope.");
  let offset = 8, memories = 0;
  function uleb(limit) {
    let value = 0, factor = 1;
    for (let count = 0; count < 5; count++) {
      if (offset >= limit) throw new Error("Truncated WASM length.");
      const byte = bytes[offset++];
      if (count === 4 && (byte & 0xf0)) throw new Error("Oversized WASM integer.");
      value += (byte & 127) * factor;
      if (!(byte & 128)) return value;
      factor *= 128;
    }
    throw new Error("Invalid WASM integer.");
  }
  while (offset < bytes.length) {
    const section = bytes[offset++], length = uleb(bytes.length), end = offset + length;
    if (end > bytes.length) throw new Error("Truncated WASM section.");
    if (section === 5) {
      memories++;
      if (uleb(end) !== 1 || uleb(end) !== 1 || uleb(end) !== 64 || uleb(end) !== 64 || offset !== end) throw new Error("WASM memory must have a fixed four-MiB ceiling.");
    }
    offset = end;
  }
  if (memories !== 1) throw new Error("WASM must declare exactly one bounded memory.");
}

export async function instantiateEngine(manifest, suppliedBytes) {
  const identity = validateManifest(manifest);
  if (!(suppliedBytes instanceof Uint8Array) || suppliedBytes.byteLength !== identity.bytes) throw new Error("WASM byte length rejected.");
  // Snapshot bytes before asynchronous hashing: callers cannot mutate a buffer
  // between its integrity check and compilation.
  const bytes = Uint8Array.from(suppliedBytes);
  if (await sha256(bytes) !== identity.sha256) throw new Error("WASM SHA-256 integrity rejected.");
  validateFixedMemory(bytes);
  const module = await WebAssembly.compile(bytes);
  if (WebAssembly.Module.imports(module).length !== 0) throw new Error("WASM imports are prohibited.");
  const exports = WebAssembly.Module.exports(module);
  if (exports.length !== FUNCTION_EXPORTS.length + 1 || !exports.some(item => item.name === "memory" && item.kind === "memory") || FUNCTION_EXPORTS.some(name => !exports.some(item => item.name === name && item.kind === "function"))) throw new Error("WASM exports do not match the engine ABI.");
  const instance = await WebAssembly.instantiate(module, {});
  const engine = instance.exports;
  if (!(engine.memory instanceof WebAssembly.Memory) || engine.memory.buffer.byteLength !== MEMORY_BYTES || engine.atomic_abi_version() !== 1 || engine.atomic_max_n() !== 32) throw new Error("Instantiated engine ABI rejected.");
  return Object.freeze({engine, identity});
}

async function boundedFetch(url, limit) {
  const response = await fetch(url, {cache: "no-store", credentials: "same-origin", redirect: "error"});
  if (!response.ok || !response.body) throw new Error("Engine artifact could not be loaded.");
  const declared = response.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error("Engine artifact exceeds its transfer bound.");
  const reader = response.body.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Engine artifact exceeds its transfer bound.");
      parts.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

async function loadEngine() {
  const manifestBytes = await boundedFetch(new URL("./engine-manifest.json", import.meta.url), 16384);
  const manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(manifestBytes));
  const identity = validateManifest(manifest);
  const bytes = await boundedFetch(new URL("./qqfenx.wasm", import.meta.url), identity.bytes);
  return instantiateEngine(manifest, bytes);
}

function range(pointer, bytes, alignment, memory) {
  if (!Number.isInteger(pointer) || pointer <= 0 || pointer % alignment !== 0 || pointer > memory.byteLength - bytes) throw new Error("Engine returned an invalid memory range.");
  return {start: pointer, end: pointer + bytes};
}
function disjoint(ranges) {
  for (let a = 0; a < ranges.length; a++) for (let b = a + 1; b < ranges.length; b++) if (ranges[a].start < ranges[b].end && ranges[b].start < ranges[a].end) throw new Error("Engine buffers overlap.");
}

export function executeEngine(loaded, input) {
  if (!input || ![8, 16, 24, 32].includes(input.n) || input.tile !== input.n / 4) throw new Error("Invalid execution geometry.");
  const engine = loaded.engine;
  if (loaded.identity.memoryBytes !== MEMORY_BYTES || loaded.identity.arenaBytes !== ARENA_BYTES || engine.memory.buffer.byteLength !== MEMORY_BYTES) throw new Error("Engine resource ceiling changed.");
  if (engine.atomic_set_budget(ARENA_BYTES) !== 0) throw new Error("Engine arena admission failed.");
  const matrixBytes = input.n * input.n * 4;
  const pointers = [0, 1, 2].map(slot => engine.atomic_input_ptr(slot));
  const inputs = pointers.map(pointer => range(pointer, 4096, 4, engine.memory.buffer));
  disjoint(inputs);
  const view = new DataView(engine.memory.buffer);
  for (const [slot, words] of [input.A, input.B, input.D].entries()) {
    if (!(words instanceof Uint32Array) || words.length !== input.n * input.n) throw new Error("Invalid generated input extent.");
    for (let i = 0; i < words.length; i++) view.setUint32(pointers[slot] + 4 * i, words[i], true);
  }
  const status = engine.atomic_run(input.n, input.tile);
  if (status !== 0) throw new Error(`C11 engine rejected execution (status ${status}).`);
  if (engine.memory.buffer.byteLength !== MEMORY_BYTES) throw new Error("Engine memory ceiling changed during execution.");
  const outputRanges = [], addresses = [];
  for (let stage = 0; stage < 2; stage++) {
    const output = engine.atomic_output_ptr(stage), metrics = engine.atomic_metrics_ptr(stage), shifts = engine.atomic_shift_ptr(stage);
    outputRanges.push(range(output, matrixBytes, 4, engine.memory.buffer), range(metrics, 40, 4, engine.memory.buffer), range(shifts, 16, 1, engine.memory.buffer));
    addresses.push({output, metrics, shifts});
  }
  disjoint([...inputs, ...outputRanges]);
  const readback = new DataView(engine.memory.buffer);
  return addresses.map(address => {
    const output = [], shifts = [], metrics = {};
    for (let i = 0; i < input.n * input.n; i++) output.push(readback.getUint32(address.output + i * 4, true));
    for (let i = 0; i < 16; i++) shifts.push(readback.getUint8(address.shifts + i));
    for (let i = 0; i < METRIC_NAMES.length; i++) metrics[METRIC_NAMES[i]] = readback.getUint32(address.metrics + 4 * i, true);
    return {output, shifts, metrics};
  });
}

export function createMessageHandler(post, engineLoader = loadEngine) {
  let busy = false, loaded = null;
  return async function handle(message) {
    let id = null;
    try {
      const descriptor = message && Object.getOwnPropertyDescriptor(message, "id");
      if (descriptor && Object.hasOwn(descriptor, "value") && Number.isInteger(descriptor.value) && descriptor.value >= 0 && descriptor.value <= 0xffffffff) id = descriptor.value;
    } catch { /* unusable request identity */ }
    if (busy) { post({id, type: "error", error: {code: "BUSY", message: "This worker already owns an execution."}}); return; }
    busy = true;
    const start = performance.now();
    let phase = "INVALID_REQUEST";
    try {
      const request = validateRequest(message);
      phase = "ENGINE_INTEGRITY";
      if (!loaded) loaded = await engineLoader();
      let job = request;
      if (request.type === "replay") {
        phase = "CAPSULE_INTEGRITY";
        const capsule = await verifyCapsule(request.capsule, loaded.identity.sha256);
        job = {level: capsule.level, seed: capsule.seed, board: capsule.board};
      }
      const input = generateInputs(job.level, job.board, job.seed);
      phase = "EXECUTION";
      post({id, type: "progress", phase: "execute"});
      const engineStart = performance.now();
      const observed = executeEngine(loaded, input);
      const engineMs = performance.now() - engineStart;
      phase = "REPLAY_INTEGRITY";
      post({id, type: "progress", phase: "replay"});
      const replayStart = performance.now();
      const verified = verifyExecution(input, observed);
      const replayMs = performance.now() - replayStart;
      const digest = await outputDigest(verified.stages, input.n);
      if (request.type === "replay" && digest !== request.capsule.outputDigest) throw new Error("Share capsule output identity did not replay.");
      const capsule = await createCapsule(job.level, job.seed, job.board, loaded.identity.sha256, digest);
      const objectives = evaluateObjectives(job.level, job.board, verified.totals);
      const report = {schema: "mfenx.atomic-report.v1", level: job.level, seed: job.seed, board: [...job.board], n: input.n, tile: input.tile,
        verified: true, won: objectives.won, cost: objectives.cost, budget: objectives.budget, objectives: objectives.objectives,
        totals: verified.totals, stages: verified.stages, timings: {engineMs, replayMs, totalMs: performance.now() - start},
        engine: {sha256: loaded.identity.sha256, bytes: loaded.identity.bytes, memoryBytes: MEMORY_BYTES, arenaBytes: ARENA_BYTES}, capsule};
      post({id, type: "result", report});
    } catch (error) {
      // A failed engine is never reused. No partial result, score, or capsule is
      // published; the next request must authenticate a fresh instance.
      loaded = null;
      post({id, type: "error", error: {code: phase, message: error instanceof Error ? error.message.slice(0, 240) : "Execution was rejected."}});
    } finally { busy = false; }
  };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const handle = createMessageHandler(message => globalThis.postMessage(message));
  globalThis.addEventListener("message", event => { void handle(event.data); });
}
