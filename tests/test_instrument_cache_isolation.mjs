import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// CacheStorage is origin-wide, even when service-worker scopes differ. Execute
// each real activation handler against mixed-product caches to prevent one
// instrument's update from destroying another instrument's offline artifacts.
for (const [file, constant, prefix] of [
  ["tessaryn/sw.js", "CACHE", "tessaryn-origin-"],
  ["ckodmk/sw.js", "CACHE_NAME", "ckodmk-browser-"],
]) {
  test(`${file}: activation removes only obsolete owned caches`, async () => {
    const listeners = new Map();
    const deleted = [];
    let claims = 0;
    let names;
    const context = vm.createContext({
      self: {
        addEventListener: (type, callback) => listeners.set(type, callback),
        clients: { claim: () => { claims += 1; return Promise.resolve(); } },
      },
      caches: {
        keys: async () => [...names],
        delete: async name => { deleted.push(name); return names.delete(name); },
      },
    });
    vm.runInContext(readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
    const current = vm.runInContext(constant, context);
    assert.ok(current.startsWith(prefix));
    const unrelated = [
      "unrelated-browser-cache", "ckodmk-browser-other-product",
      "tessaryn-origin-other-product", "tessaryn-other-namespace",
    ].filter(name => !name.startsWith(prefix));
    names = new Set([current, `${prefix}obsolete-v1`, `${prefix}obsolete-v2`, ...unrelated]);
    let completion;
    listeners.get("activate")({ waitUntil: promise => { completion = promise; } });
    assert.ok(completion instanceof Promise || typeof completion?.then === "function");
    await completion;
    assert.deepEqual(deleted.sort(), [`${prefix}obsolete-v1`, `${prefix}obsolete-v2`]);
    assert.deepEqual([...names].sort(), [current, ...unrelated].sort());
    assert.equal(claims, 1);
  });
}
