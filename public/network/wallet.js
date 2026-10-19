// Wallet configuration is pinned to the new history, never the retired RPC root.
export const CHAIN = Object.freeze({
  chainId: "0x78c3b839",
  chainName: "MFENX Native 2026",
  nativeCurrency: Object.freeze({ name: "JULIAN", symbol: "JULIAN", decimals: 18 }),
  rpcUrls: Object.freeze(["https://rpc.mfenx.com/2026/", "https://license.mfenx.com/network/2026/"]),
  iconUrls: Object.freeze(["https://mfenx.com/assets/mfenx-network.png"]),
});
export const GENESIS = "0x3b0b36b6acdcc5f0d7a1e38dd6621c58a9546a0e1a98cb58911b7646a0de5e8e";

export async function verifyRpc(url, fetcher = fetch) {
  if (!CHAIN.rpcUrls.includes(url)) throw new Error("Unrecognized RPC URL.");
  const response = await fetcher(url, {
    method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
    headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(12000),
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["0x0", false] },
      { jsonrpc: "2.0", id: 3, method: "eth_syncing", params: [] },
    ]),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}.`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error("RPC response is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const results = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!Array.isArray(results) || results.length !== 3) throw new Error("Invalid RPC response.");
  const byId = new Map();
  for (const item of results) {
    if (!item || item.jsonrpc !== "2.0" || ![1, 2, 3].includes(item.id) ||
        byId.has(item.id) || "error" in item || !("result" in item)) throw new Error("Invalid RPC response.");
    byId.set(item.id, item.result);
  }
  if (byId.get(1) !== CHAIN.chainId) throw new Error("RPC chain ID does not match MFENX Native 2026.");
  const genesis = byId.get(2);
  if (!genesis || genesis.number !== "0x0" || genesis.hash !== GENESIS) throw new Error("RPC genesis does not match the published history.");
  if (byId.get(3) !== false) throw new Error("RPC is still syncing.");
  return url;
}

export async function addNetwork(provider, fetcher = fetch) {
  if (!provider || typeof provider.request !== "function") throw new Error("Open this page in Zerion's dApp browser or install a compatible wallet extension.");
  let verified;
  for (const url of CHAIN.rpcUrls) {
    try { verified = await verifyRpc(url, fetcher); break; } catch { /* Try the published alternate. */ }
  }
  if (!verified) throw new Error("Neither published RPC passed chain, genesis and sync checks. Network setup was stopped.");
  // Supply only the endpoint whose history was checked in this invocation.
  await provider.request({ method: "wallet_addEthereumChain", params: [{ ...CHAIN, rpcUrls: [verified] }] });
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] });
  const active = await provider.request({ method: "eth_chainId" });
  if (typeof active !== "string" || !/^0x[0-9a-f]+$/i.test(active) || BigInt(active) !== BigInt(CHAIN.chainId)) {
    throw new Error("The wallet has not switched to MFENX Native 2026. Select it in the wallet's network settings.");
  }
}

export function walletError(error) {
  const code = error?.code ?? error?.data?.originalError?.code;
  if (code === 4001) return "Request declined in the wallet. You can try again when ready.";
  if (code === -32002) return "A wallet request is already open. Complete it in your wallet first.";
  if (code === 4200 || code === -32601) return "This wallet requires manual setup. Use the network details below.";
  return error instanceof Error ? error.message : "Wallet setup failed. Use the manual network details below.";
}
