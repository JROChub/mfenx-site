import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonicalJson } from "../public/power-house-canonical.mjs";

test("Unicode provenance reproduces the Rust and Python v1 fingerprint", () => {
  const value = { schema: "power-house/pha/v1", provenance: { "\u{10000}": "supplementary", "\ue000": "bmp" },
    embedded_proof: { protocol: "research/canonical-probe/v1", public_inputs: {}, proof: {} } };
  const fingerprint = "sha256:" + createHash("sha256").update("power-house:pha:v1:phx-fingerprint\0")
    .update(canonicalJson(value)).digest("hex");
  assert.equal(fingerprint, "sha256:d307f68d655e5569d7f4acbfa6076abb33f106ef62ea1d8ce52754e818784f33");
});

test("Malformed Unicode, unsafe integers and excessive depth reject", () => {
  for (const value of ["\ud800", { "\udfff": 1 }, 2 ** 53, 1.5]) assert.throws(() => canonicalJson(value));
  let deep = 0; for (let i = 0; i < 200; i++) deep = [deep];
  assert.throws(() => canonicalJson(deep), /nesting/);
});
