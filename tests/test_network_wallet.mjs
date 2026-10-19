import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../public/network/wallet.js", import.meta.url), "utf8");
const { CHAIN, GENESIS, verifyRpc, addNetwork, walletError } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const results = () => [
  { jsonrpc: "2.0", id: 3, result: false },
  { jsonrpc: "2.0", id: 1, result: CHAIN.chainId },
  { jsonrpc: "2.0", id: 2, result: { number: "0x0", hash: GENESIS } },
];
const fetcher = async () => new Response(JSON.stringify(results()));

test("wallet metadata binds the published current history and logo", async () => {
  const metadata = JSON.parse(await readFile(new URL("../public/network/2026092601.json", import.meta.url)));
  assert.equal(Number(CHAIN.chainId), metadata.chainId);
  assert.equal(CHAIN.chainName, metadata.name);
  assert.deepEqual(CHAIN.nativeCurrency, metadata.nativeCurrency);
  assert.deepEqual([...CHAIN.rpcUrls].sort(), [...metadata.rpc].sort());
  assert.deepEqual(CHAIN.iconUrls, [metadata.logo.https]);
  assert.equal(GENESIS, metadata.genesisHash);
  assert.equal(CHAIN.blockExplorerUrls, undefined);
});
test("identity checks accept reordered batch responses without account access", async () => {
  await verifyRpc(CHAIN.rpcUrls[0], async (url, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body).map(x => x.method), ["eth_chainId", "eth_getBlockByNumber", "eth_syncing"]);
    return fetcher();
  });
});
for (const [name, mutate] of Object.entries({
  "retired chain": r => { r[1].result = "0x2b403"; },
  "different genesis": r => { r[2].result.hash = "0x" + "f".repeat(64); },
  "non-genesis block": r => { r[2].result.number = "0x1"; },
  "syncing node": r => { r[0].result = {}; },
  "duplicate ID": r => { r[0].id = 1; },
  "string ID": r => { r[0].id = "3"; },
  "RPC error alongside result": r => { r[0].error = { code: -1 }; },
  "missing JSON-RPC version": r => { delete r[0].jsonrpc; },
  "missing result": r => { delete r[0].result; },
})) test(`reject ${name} before any wallet request`, async () => {
  const r = results(); mutate(r);
  let requests = 0;
  await assert.rejects(addNetwork({ request() { requests++; } }, async () => new Response(JSON.stringify(r))));
  assert.equal(requests, 0);
});
test("bound untrusted response size and reject malformed JSON, HTTP failures and unknown endpoints", async () => {
  for (const response of [new Response(" ".repeat(65537)), new Response("{"), new Response("{}", { status: 503 })]) {
    await assert.rejects(verifyRpc(CHAIN.rpcUrls[0], async () => response));
  }
  await assert.rejects(verifyRpc("https://rpc.mfenx.com/", fetcher));
});
test("add and switch only after verification; check the active chain", async () => {
  const calls = [];
  await addNetwork({ async request(call) { calls.push(call); return CHAIN.chainId; } }, fetcher);
  assert.deepEqual(calls.map(x => x.method), ["wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_chainId"]);
  assert.deepEqual(calls[0].params[0].rpcUrls, [CHAIN.rpcUrls[0]]);
  assert.deepEqual(calls[0].params[0].iconUrls, CHAIN.iconUrls);
});
test("fallback adds only the verified alternate RPC", async () => {
  let added;
  await addNetwork({ async request(call) { if (call.method === "wallet_addEthereumChain") added = call.params[0]; return CHAIN.chainId; } },
    async url => { if (url === CHAIN.rpcUrls[0]) throw new Error("offline"); return fetcher(); });
  assert.deepEqual(added.rpcUrls, [CHAIN.rpcUrls[1]]);
});
test("never claim success when a wallet ignores switching", async () => {
  await assert.rejects(addNetwork({ async request() { return "0x1"; } }, fetcher), /not switched/);
});
test("user rejection stops without a switch and has useful guidance", async () => {
  const calls = [];
  const error = { code: 4001 };
  await assert.rejects(addNetwork({ async request(call) { calls.push(call); throw error; } }, fetcher));
  assert.equal(calls.length, 1);
  assert.match(walletError(error), /declined/);
  assert.match(walletError({ code: -32002 }), /already open/);
  assert.match(walletError({ data: { originalError: { code: -32601 } } }), /manual/);
  await assert.rejects(addNetwork(undefined, fetcher), /dApp browser/);
});
