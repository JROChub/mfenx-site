MFENX Native 2026 public observation contract

This is a new history, not recovery of chain 177155. It starts with empty accounts and zero supply. It does not restore balances, transactions or continuity. Three validator processes share one host in sfo3 and one failure domain. Quorum is two, but the deterministic leader has no failover. Two healthy processes therefore do not establish operational status.

The website fetches only `GET https://license.mfenx.com/network/2026/network-status.json`, with credentials omitted, redirects rejected, no cache and a five-second deadline. Requests do not overlap; the next begins fifteen seconds after completion. JSON responses are limited to 65,536 bytes and require `application/json` plus CORS. They are reported observations, not signature-verified proofs. The backend sampler runs separately every fifteen seconds and persists a bounded rolling 24-hour sample history on the same host; it is not an independent monitoring service.

Legacy `https://rpc.mfenx.com/` returns HTTP 410 and never redirects to the new history. `public/network/177155.json` retains the old identifier but has no RPC entries. The new metadata is `/network/2026092601.json`. Both `https://rpc.mfenx.com/2026/` and `https://license.mfenx.com/network/2026/` serve the new chain. Its manifest is `https://license.mfenx.com/network/2026/network-manifest.json`. These dedicated routes remain separate from license and payment handlers.

The wallet entry on `/status.html#wallet-title` uses EIP-6963 discovery with an injected-provider fallback. A user click checks chain ID, genesis and sync state before issuing `wallet_addEthereumChain` and `wallet_switchEthereumChain`; success requires a subsequent wallet `eth_chainId` match. Only a verified RPC endpoint is supplied. No account request, signature or transaction is requested by setup. The `mfenx` network asset is supplied via `iconUrls`; wallets control whether to display it. Manual setup is documented for compatible EVM wallets. Custom-network setup does not imply automatic discovery or portfolio indexing. The new registry entry must use a distinct name and short name; the retired entry remains retired.

The static metadata declares `protocol: mfenx-native`, `evmCompatible: true`,
`publicRpcMode: evm_contracts` and `transactionSubmission: public_signed_evm`,
consistent with the deployed runtime and manifest. The MFENX Cancun fee-free
execution profile was activated at block 14; its capabilities and recorded
execution checks are described at `/network/contracts.html`. Consensus and the
canonical state commitment remain MFENX native. These capabilities do not imply
full Ethereum protocol equivalence. The metadata links to the live manifest and
observations, not a static availability claim.

Both history records identify the existing 1024 by 1024 PNG with its SHA-256
digest. The status page exposes the same file for download. The retired record
links to ethereum-lists/chains PR 8790 and the distinct current history without
redirecting its RPC or implying restored balances. A third-party merge or listing
is not a certification of the runtime or its availability.

The public RPC accepts signed EIP-1559 transactions through `eth_sendRawTransaction` for contract deployment, contract calls and native transfers. The manifest declares `public_rpc_mode: evm_contracts` and `transaction_submission: public_signed_evm`. Public submission remains subject to gateway request, rate and execution limits and validator admission checks; the gateway does not request private keys. Enabled submission does not imply unlimited history capacity or throughput. The website's status polling remains read only.

Required status fields

The executable representative fixture is `tests/fixtures/network-status-v1.json`. Fixture peer identities, runtime string, timestamps and measurements are synthetic. Production fields are:

- `schema`: `mfenx.network-status.v1`.
- `identity`: name `MFENX Native 2026`, integer chain_id `2026092601`, history_id `mfenx-native-2026-09-27`, genesis_hash `0x3b0b36b6acdcc5f0d7a1e38dd6621c58a9546a0e1a98cb58911b7646a0de5e8e`, actual service-inception `started_at`, previous_chain_id `177155`, previous_history_restored `false`. The genesis block has timestamp zero; neither zero nor manifest-generation time is presented as the public service start.
- `generated_at`, `sampled_at`: UTC ISO timestamps with Z or +00:00. Both must be at most 60 seconds old and no more than ten seconds in the future. Sample time cannot precede service inception or exceed generation time by over one second.
- `topology`: validator_count 3, quorum 2, host_count 1, failure_domain_count 1, regions `["sfo3"]`.
- `status`: `starting`, `operational`, `degraded` or `unavailable`.
- `rpc.reachable`: boolean. `quorum_agreement`: boolean. `validators_healthy`: integer 0 through 3.
- `block_height`: nonnegative safe integer or null when no current quorum height is observed. `client`: runtime identity string.
- `validators`: exactly three unique node_id/peer_id records, each with healthy boolean, height (safe nonnegative integer or null), tip_hash (0x-prefixed lowercase hex32 or null), genesis_hash (pinned genesis or null). Healthy observations require `admission: open`, non-null height, tip and matching genesis. Reported healthy count must agree with these rows.
- Quorum agreement requires two healthy rows matching the current height and tip. Operational additionally requires all three healthy, all matching the current height/tip/genesis, reachable RPC, a nonzero finalized height and non-null `last_finalized_at`. A tip older than the reported `empty_block_interval_seconds` plus 90 seconds at the sample time cannot support operational state. Genesis alone or service inception cannot establish operational finality; startup observations may retain null height, tip and finality time.
- `last_finalized_at`: UTC ISO time or null. `empty_block_interval_seconds`: exactly the number 86400 or 12 during the reviewed cadence transition; strings and other values are rejected. The sampler reports the configured interval, and accepting either value does not assert that a cadence change has been deployed. Empty blocks do not establish transaction activity. This bounded host has finite state capacity; idle blocks do not imply unlimited storage or throughput.
- `enrollment`: observers false, validators false. No registration, host probe or old bootstrap is offered by the website. Enabling enrollment requires a separately reviewed contract, not an arbitrary status-field change.
- `availability`: window_seconds 86400; observed_seconds integer 0 through 86400 and no longer than this history's age; sample_count and successful_samples nonnegative integers with successes no greater than samples; percent null for zero samples, otherwise consistent with successes / samples * 100 within 0.001 percentage points. Coverage and sample denominator remain visible. This is sampled health, not continuous uptime.
- `reliability_campaign.status`: `not_started`. Old campaign results do not carry over. Any future campaign requires separate acceptance criteria and review.
- Optional extra fields such as `state_capacity` are ignored by the current UI and cannot change admission or trust.

HTTP errors, timeouts, malformed/oversize JSON, stale timestamps, identity mismatches and inconsistent observations clear prior live values rather than leaving stale healthy metrics on screen. Enrollment remains disabled even when the feed is unavailable or attempts to enable it. No changes apply to Gate, payment, license, receipts, research proofs or local model execution.

Tests

`node --test tests/test_network_status.mjs` checks identity, shape, semantic health, both accepted cadence values and their freshness boundaries, the unchanged 24-hour availability window, size limits and retired metadata. `python tests/browser_network_history.py --root public` uses local intercepted fixtures only, covers four viewport sizes, keyboard skip focus, disabled enrollment, both cadence values, stale/mismatched states, text escaping and valid-to-unavailable transition. Existing research/design suites retain unrelated checks and now expect deliberately disabled new-history enrollment.
