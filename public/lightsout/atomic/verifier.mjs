/* Copyright (c) 2026 MFENX. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-MFENX-Proprietary
 * Independent full-ring replay; no quotient kernel or adaptive arithmetic.
 */
import {getLevel, validateBoard, validateSeed, boardCost} from "./levels.mjs";

export const METRIC_NAMES = Object.freeze(["requested", "executed", "annihilated", "q8", "q16", "q24", "q32", "promoted_tiles", "promotion_bits", "min_output_shift"]);
export const CAPSULE_SCHEMA = "mfenx.atomic-capsule.v1";
const CAPSULE_KEYS = ["schema", "level", "seed", "board", "engineSha256", "outputDigest", "sha256"];
const HEX = /^[0-9a-f]{64}$/;
const MASK = 0xffffffffn;

export function exactRecord(value, keys, label = "record") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`Invalid ${label} prototype.`);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) throw new Error(`Unexpected ${label} fields.`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error(`Invalid ${label} field.`);
  }
}

export function validateRequest(request) {
  if (!request || typeof request !== "object") throw new Error("Invalid worker request.");
  const type = Object.getOwnPropertyDescriptor(request, "type");
  if (!type || !Object.hasOwn(type, "value")) throw new Error("Invalid request type field.");
  if (type.value === "run") {
    exactRecord(request, ["id", "type", "level", "board", "seed"], "run request");
    getLevel(request.level);
    validateSeed(request.seed);
    const board = validateBoard(request.board);
    validateSeed(request.id);
    return {id: request.id, type: "run", level: request.level, seed: request.seed, board};
  }
  if (type.value === "replay") {
    exactRecord(request, ["id", "type", "capsule"], "replay request");
    validateSeed(request.id);
    return {id: request.id, type: "replay", capsule: snapshotCapsule(request.capsule)};
  }
  throw new Error("Unknown worker request type.");
}

function geometry(n, tile) {
  if (![8, 16, 24, 32].includes(n) || tile !== n / 4) throw new Error("Invalid replay geometry.");
}

function words(value, length, label) {
  const ordinary = Array.isArray(value);
  if (!ordinary && !(value instanceof Uint32Array && value.buffer instanceof ArrayBuffer)) throw new Error(`Invalid ${label} words.`);
  if (value.length !== length) throw new Error(`Invalid ${label} length.`);
  if (ordinary && Reflect.ownKeys(value).length !== length + 1) throw new Error(`Invalid ${label} array.`);
  const result = new Array(length);
  for (let i = 0; i < length; i++) {
    const descriptor = ordinary ? Object.getOwnPropertyDescriptor(value, i) : null;
    if (ordinary && (!descriptor || !Object.hasOwn(descriptor, "value"))) throw new Error(`Invalid ${label} word.`);
    const word = ordinary ? descriptor.value : value[i];
    if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) throw new Error(`Invalid ${label} word.`);
    result[i] = word;
  }
  return result;
}

// Every logical MAC is evaluated, including zero inputs and zero-ideal terms.
export function fullRingProduct(lhs, rhs, n) {
  if (![8, 16, 24, 32].includes(n)) throw new Error("Invalid dense replay extent.");
  const a = words(lhs, n * n, "left input").map(BigInt);
  const b = words(rhs, n * n, "right input").map(BigInt);
  const output = new Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      let sum = 0n;
      for (let inner = 0; inner < n; inner++) sum += a[row * n + inner] * b[inner * n + column];
      output[row * n + column] = Number(sum & MASK);
    }
  }
  return output;
}

export function tileShifts(value, n, tile) {
  geometry(n, tile);
  const matrix = words(value, n * n, "tile input");
  const shifts = [];
  for (let blockRow = 0; blockRow < 4; blockRow++) {
    for (let blockColumn = 0; blockColumn < 4; blockColumn++) {
      let shared = 32;
      for (let row = 0; row < tile; row++) {
        for (let column = 0; column < tile; column++) {
          let word = BigInt(matrix[(blockRow * tile + row) * n + blockColumn * tile + column]);
          let trailing = 0;
          if (word === 0n) trailing = 32;
          else while ((word & 1n) === 0n) { trailing++; word >>= 1n; }
          shared = Math.min(shared, trailing);
        }
      }
      shifts.push(shared);
    }
  }
  return shifts;
}

export function deriveMetrics(lhs, rhs, output, n, tile) {
  geometry(n, tile);
  const a = tileShifts(lhs, n, tile), b = tileShifts(rhs, n, tile), shifts = tileShifts(output, n, tile);
  const metrics = {requested: n ** 3, executed: 0, annihilated: 0, q8: 0, q16: 0, q24: 0, q32: 0, promoted_tiles: 0, promotion_bits: 0, min_output_shift: Math.min(...shifts)};
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      let baseline = 32;
      for (let inner = 0; inner < 4; inner++) {
        const sum = a[row * 4 + inner] + b[inner * 4 + column];
        baseline = Math.min(baseline, sum);
        const macs = tile ** 3;
        if (sum >= 32) metrics.annihilated += macs;
        else {
          metrics.executed += macs;
          const quotient = 32 - sum;
          metrics[quotient <= 8 ? "q8" : quotient <= 16 ? "q16" : quotient <= 24 ? "q24" : "q32"] += macs;
        }
      }
      const promotion = shifts[row * 4 + column] - baseline;
      if (baseline < 32 && promotion > 0) { metrics.promoted_tiles++; metrics.promotion_bits += promotion; }
    }
  }
  return {metrics, shifts};
}

export function verifyExecution(input, observedStages) {
  const {n, tile} = input;
  geometry(n, tile);
  if (!Array.isArray(observedStages) || observedStages.length !== 2) throw new Error("Two complete execution stages are required.");
  const A = words(input.A, n * n, "A"), B = words(input.B, n * n, "B"), D = words(input.D, n * n, "D");
  const snapshots = observedStages.map(stage => {
    exactRecord(stage, ["output", "shifts", "metrics"], "stage");
    exactRecord(stage.metrics, METRIC_NAMES, "metrics");
    const output = words(stage.output, n * n, "output"), shifts = words(stage.shifts, 16, "shifts");
    const metrics = {};
    for (const name of METRIC_NAMES) {
      const value = stage.metrics[name];
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("Invalid metric value.");
      metrics[name] = value;
    }
    if (shifts.some(shift => shift > 32)) throw new Error("Invalid output tile content.");
    return {output, shifts, metrics};
  });
  const C = fullRingProduct(A, B, n);
  const E = fullRingProduct(C, D, n);
  const outputs = [C, E], sources = [[A, B], [C, D]];
  const stages = [];
  for (let index = 0; index < 2; index++) {
    const observed = snapshots[index], output = outputs[index];
    for (let word = 0; word < output.length; word++) if (output[word] !== observed.output[word]) throw new Error(`Full-ring replay rejected stage ${index + 1}, word ${word}.`);
    const derived = deriveMetrics(sources[index][0], sources[index][1], output, n, tile);
    for (const name of METRIC_NAMES) if (observed.metrics[name] !== derived.metrics[name]) throw new Error(`Independent accounting rejected ${name} in stage ${index + 1}.`);
    for (let i = 0; i < 16; i++) if (observed.shifts[i] !== derived.shifts[i]) throw new Error("Independent tile-content check rejected an output shift.");
    if (observed.metrics.executed + observed.metrics.annihilated !== n ** 3 || observed.metrics.q8 + observed.metrics.q16 + observed.metrics.q24 + observed.metrics.q32 !== observed.metrics.executed) throw new Error("Execution accounting does not conserve logical MACs.");
    stages.push({output, shifts: derived.shifts, metrics: derived.metrics});
  }
  const totals = {};
  for (const name of METRIC_NAMES.slice(0, -1)) totals[name] = stages[0].metrics[name] + stages[1].metrics[name];
  totals.zero_tiles = stages[1].shifts.filter(value => value === 32).length;
  totals.stage0_zero_tiles = stages[0].shifts.filter(value => value === 32).length;
  totals.min_output_shift = stages[1].metrics.min_output_shift;
  totals.replay_macs = 2 * n ** 3;
  return {stages, totals};
}

export function evaluateObjectives(levelId, board, totals) {
  const level = getLevel(levelId), cost = boardCost(board), target = level.targets;
  const objectives = [
    {id: "budget", label: "Energy within budget", actual: cost, target: level.budget, passed: cost <= level.budget},
    {id: "containment", label: "Final sectors contained", actual: totals.zero_tiles, target: target.zeroTiles, passed: totals.zero_tiles >= target.zeroTiles},
    {id: "annihilation", label: "Payload MACs annihilated", actual: totals.annihilated, target: target.minAnnihilated, passed: totals.annihilated >= target.minAnnihilated},
    {id: "promotion", label: "Output tiles promoted", actual: totals.promoted_tiles, target: target.minPromotedTiles, passed: totals.promoted_tiles >= target.minPromotedTiles}
  ];
  return {cost, budget: level.budget, objectives, won: objectives.every(objective => objective.passed)};
}

export async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function outputDigest(stages, n) {
  if (![8, 16, 24, 32].includes(n) || !Array.isArray(stages) || stages.length !== 2) throw new Error("Invalid digest geometry.");
  const domain = new TextEncoder().encode("MFENX ATOMIC FULL-RING OUTPUT V1\0");
  const bytes = new Uint8Array(domain.length + 4 + 8 * n * n);
  bytes.set(domain);
  const view = new DataView(bytes.buffer);
  view.setUint32(domain.length, n, true);
  let offset = domain.length + 4;
  for (const stage of stages) for (const word of words(stage.output, n * n, "digest output")) { view.setUint32(offset, word, true); offset += 4; }
  return sha256(bytes);
}

function snapshotCapsule(value) {
  exactRecord(value, CAPSULE_KEYS, "share capsule");
  if (value.schema !== CAPSULE_SCHEMA) throw new Error("Unsupported share capsule version.");
  getLevel(value.level); validateSeed(value.seed);
  const board = validateBoard(value.board);
  for (const key of ["engineSha256", "outputDigest", "sha256"]) if (typeof value[key] !== "string" || !HEX.test(value[key])) throw new Error("Invalid capsule content identity.");
  return {schema: CAPSULE_SCHEMA, level: value.level, seed: value.seed, board, engineSha256: value.engineSha256, outputDigest: value.outputDigest, sha256: value.sha256};
}

function capsulePayload(capsule) {
  return JSON.stringify({schema: CAPSULE_SCHEMA, level: capsule.level, seed: capsule.seed, board: capsule.board, engineSha256: capsule.engineSha256, outputDigest: capsule.outputDigest});
}

export async function createCapsule(level, seed, board, engineSha256, digest) {
  const capsule = snapshotCapsule({schema: CAPSULE_SCHEMA, level, seed, board, engineSha256, outputDigest: digest, sha256: "0".repeat(64)});
  capsule.sha256 = await sha256(new TextEncoder().encode(capsulePayload(capsule)));
  return capsule;
}

export async function verifyCapsule(value, engineSha256) {
  const capsule = snapshotCapsule(value);
  const expected = await sha256(new TextEncoder().encode(capsulePayload(capsule)));
  if (capsule.sha256 !== expected) throw new Error("Share capsule content hash rejected.");
  if (capsule.engineSha256 !== engineSha256) throw new Error("Share capsule uses a different engine artifact.");
  return capsule;
}
