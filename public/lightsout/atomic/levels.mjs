/* Copyright (c) 2026 MFENX. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-MFENX-Proprietary
 */

export const MODULES = Object.freeze([
  Object.freeze({id: 0, name: "Raw", shift: 0, sign: 1, cost: 0, color: "#a5adc1", description: "Full-ring fuel. No shared power of two."}),
  Object.freeze({id: 1, name: "Flux", shift: 8, sign: 1, cost: 1, color: "#73d8d4", description: "Eight shared trailing zero bits."}),
  Object.freeze({id: 2, name: "Pulse", shift: 12, sign: 1, cost: 2, color: "#efb56d", description: "Positive pulse. Pair with a matching Mirror."}),
  Object.freeze({id: 3, name: "Void", shift: 16, sign: 1, cost: 3, color: "#b7ec8c", description: "Sixteen shared bits; products with another sixteen vanish."}),
  Object.freeze({id: 4, name: "Mirror", shift: 12, sign: -1, cost: 2, color: "#b7a1e8", description: "The wrapping negative of Pulse. Matching paths can cancel."})
]);

function mission(id, name, n, budget, zeroTiles, minAnnihilated, minPromotedTiles, bShifts, dShift, briefing, hint) {
  return Object.freeze({id, name, n, tile: n / 4, budget, seed: (0x51464e58 + id * 0x10201) >>> 0,
    briefing, hint, bShifts: Object.freeze(bShifts), dShift,
    targets: Object.freeze({zeroTiles, minAnnihilated, minPromotedTiles})});
}

export const LEVELS = Object.freeze([
  mission(0, "Shield Sector", 8, 12, 4, 256, 0, [16, 16, 16, 16], 0,
    "Seal four output sectors without spending more than twelve energy. A shield must survive both reactions.",
    "Void carries sixteen shared bits. The first reactor contributes sixteen more. Try a complete row."),
  mission(1, "Mirror Lock", 16, 16, 8, 2048, 8, [8, 8, 8, 8], 0,
    "Contain half the chamber through cancellation, not an all-Void board. Make eight sectors promote to zero.",
    "Tiles in each row share a payload pattern. Equal Pulse and Mirror paths cancel in the ordinary full ring."),
  mission(2, "Cascade Fold", 24, 24, 12, 10368, 8, [0, 8, 16, 24], 8,
    "Three rows must remain contained as four different quotient environments feed the second reactor.",
    "Balance three rows. A result that really becomes zero is free of payload work in the next reaction."),
  mission(3, "Quiet Core", 32, 32, 16, 40960, 12, [0, 8, 16, 24], 16,
    "Contain every sector with thirty-two energy, twelve promotions, and at least five-eighths of payload MACs annihilated.",
    "Each row can close its own loop. A board of Void exceeds the budget; matching signed pulses do not.")
]);

export const DEFAULT_BOARD = Object.freeze([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
const DEMOS = Object.freeze([
  Object.freeze([3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  Object.freeze([2, 4, 2, 4, 2, 4, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0]),
  Object.freeze([2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 0, 0, 0, 0]),
  Object.freeze([2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 2, 4, 2, 4])
]);

export function getLevel(id) {
  if (!Number.isInteger(id) || id < 0 || id >= LEVELS.length) throw new Error("Unknown mission.");
  return LEVELS[id];
}

export function getDefaultBoard(level = 0) { getLevel(level); return [...DEFAULT_BOARD]; }
export function getDemoBoard(level = 0) { getLevel(level); return [...DEMOS[level]]; }

export function validateBoard(board) {
  if (!Array.isArray(board) || board.length !== 16 || Reflect.ownKeys(board).length !== 17) throw new Error("A board must contain exactly sixteen module IDs.");
  const copy = [];
  for (let i = 0; i < 16; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(board, i);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Invalid module ID.");
    const id = descriptor.value;
    if (!Number.isInteger(id) || id < 0 || id >= MODULES.length) throw new Error("Invalid module ID.");
    copy.push(id);
  }
  return copy;
}

export function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be an unsigned 32-bit integer.");
  return seed;
}

export function boardCost(board) { return validateBoard(board).reduce((sum, id) => sum + MODULES[id].cost, 0); }

function mixedWord(value) {
  let word = value >>> 0;
  word = Math.imul(word ^ (word >>> 16), 0x7feb352d) >>> 0;
  word = Math.imul(word ^ (word >>> 15), 0x846ca68b) >>> 0;
  return (word ^ (word >>> 16)) >>> 0;
}

// Generation uses only exact 32-bit integer operations. A row's four tiles
// deliberately share a payload; the signed modules supply the puzzle geometry.
export function generateInputs(levelId, board, seed = getLevel(levelId).seed) {
  const level = getLevel(levelId);
  const selected = validateBoard(board);
  validateSeed(seed);
  const {n, tile} = level;
  const A = new Uint32Array(n * n), B = new Uint32Array(n * n), D = new Uint32Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      const module = MODULES[selected[Math.floor(row / tile) * 4 + Math.floor(column / tile)]];
      const a = (mixedWord(seed ^ Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(column % tile + 1, 0x85ebca6b)) & 31) | 1;
      const shifted = (a << module.shift) >>> 0;
      A[row * n + column] = module.sign < 0 ? (-shifted) >>> 0 : shifted;
      const b = (mixedWord(seed ^ 0x42424242 ^ Math.imul(row % tile + 1, 0x27d4eb2d) ^ Math.imul(column + 1, 0x165667b1)) & 31) | 1;
      B[row * n + column] = (b << level.bShifts[Math.floor(column / tile)]) >>> 0;
      const d = (mixedWord(seed ^ 0x44444444 ^ Math.imul(row + 1, 0x85ebca6b) ^ Math.imul(column + 1, 0x9e3779b1)) & 31) | 1;
      D[row * n + column] = (d << level.dShift) >>> 0;
    }
  }
  return {level: levelId, seed, board: selected, n, tile, A, B, D};
}
