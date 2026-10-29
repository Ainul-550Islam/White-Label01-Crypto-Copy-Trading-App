# Custody Chain Providers (Batch 03, item C)

## What this is

The custody module's chain-observation surface. Before Batch 03 the custody stack
was ledger-only: `BlockchainProvider` as an interface existed and every concrete
selection refused (fail closed), which made deposits unverifiable on chain and
left confirmation refresh impossible to ground. Batch 03 wires real, OBSERVATION-
ONLY providers for the five operator-configured networks behind a master switch
that is **off by default**.

These providers

- never read, store, log or handle private keys (they pin no signing library, and
  the capability flags `canSubmitTransaction` and `canGenerateAddress` are always
  `false` - this is asserted in the specs, not just documented);
- never silently fall back to another source or invent an answer: when the chain
  is unreachable, the circuit is open, the host is not allow-listed, the response
  is oversized, or the payload violates the protocol shape, the call fails with a
  typed error and the ledger row stays exactly as it was;
- never mark anything final: confirmation state always comes from the ledger
  reconcile, and `refreshConfirmationsFromChain` only feeds chain evidence into
  the existing `observeConfirmation` state machine through the standard
  `observeConfirmation` branch (a CONFIRMED transaction whose recorded block hash
  no longer sits at the chain head flips REORGED through the existing branch).

## Layout

Everything lives under `apps/api/src/modules/custody/providers/`:

| File | Responsibility |
| --- | --- |
| `chain-amount.ts` | Base-unit/decimal-string arithmetic for chain payloads. BigInt-only; hex quantities must be canonical `0x`-quantities (padded forms are refused at the protocol boundary, matching custodial EVM JSON-RPC semantics); dust-truncation of float paths is refused rather than parsed. |
| `chain-http-client.ts` | Single audited egress chokepoint: https-only, no userinfo, exact-host allowlist, no redirect following (3xx is a protocol violation), per-request timeout, byte cap on responses (cap violations are honest - they never count toward the breaker), per-host circuit breaker with cooldown, process-unique crypto-random request IDs, typed errors only. |
| `evm-json-rpc.provider.ts` | Observation provider for EVM networks (`ethereum`, `bsc`, `polygon`, `arbitrum`): native balances via `eth_getBalance`, token balances via `eth_call balanceOf`, transactions via `eth_getTransactionByHash` + receipt + `eth_blockNumber` for confirmation arithmetic, address observation via `eth_getLogs` over `Transfer` topics. |
| `tron-grid.provider.ts` | Observation provider for `tron` via TronGrid/`/wallet` routes. TRX amounts are Sun; base58check decoding (including double-SHA256 checksum verification) happens locally so a corrupted address refuses rather than simulating against fabricated bytes. |
| `chain-metrics.ts` | Registers the four `wlct_custody_chain_*` families on the scoped `MetricsRegistry`; labels restricted to `network`/`provider`/`result` (allowlist parity between `metrics.registry.ts` and `labels.py`). |
| `chain-observation.service.ts` | Nest gateway that reads validated env, constructs at most one client plus one provider per configured network, and hands the providers to custody services. |

Specs sit next to each unit (`*.spec.ts`) plus `chain-provider-integration.spec.ts`
for module-level wiring, registry family presence, and the confirmation-service
fail-closed contract.

## Configuration (validated at boot)

All keys live in `packages/config/src/env.schema.ts` under the
`CUSTODY_CHAIN_*` prefix, with a `.superRefine` that cross-checks them:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CUSTODY_CHAIN_PROVIDERS_ENABLED` | `false` | Master switch. `false` ⇒ the module keeps zero provider material in memory and every `getProviderForNetwork` call is a typed `CHAIN_PROVIDERS_DISABLED` refusal. |
| `CUSTODY_CHAIN_ETHEREUM_RPC_URL`, `CUSTODY_CHAIN_BSC_RPC_URL`, `CUSTODY_CHAIN_POLYGON_RPC_URL`, `CUSTODY_CHAIN_ARBITRUM_RPC_URL`, `CUSTODY_CHAIN_TRON_RPC_URL` | unset | Observation endpoint per network. Must be `https://`, must not embed userinfo, and its host must be on the allowlist. |
| `CUSTODY_CHAIN_HOST_ALLOWLIST` | empty | Comma-separated exact lower-case hostnames. While the switch is on, at least one configured endpoint must be present and at least one host must be allow-listed, otherwise boot validation refuses - an enabled-but-empty surface never silently pretends to observe. |
| `CUSTODY_CHAIN_HTTP_TIMEOUT_MS` | `5000` | Per-attempt budget, 1000-30000 ms. |
| `CUSTODY_CHAIN_MAX_RESPONSE_BYTES` | `1048576` | Response cap 16 KiB - 16 MiB. |
| `CUSTODY_CHAIN_BREAKER_THRESHOLD` | `5` | Consecutive failures before a per-host circuit opens, 1-50. |

Error propagation rules the spec suite pins down:

- Egress refusals (scheme, userinfo, host not allow-listed) are `CONFIG` errors
  and never touch a socket.
- 3xx replies are `PROTOCOL_VIOLATION` - redirects are never followed.
- Responses over the byte cap abort mid-stream with `PROTOCOL_VIOLATION` and do
  not blame the host's breaker.
- Transport failures/timeouts are `CHAIN_UNAVAILABLE`, count toward the breaker,
  and after the threshold calls refuse instantly with the breaker-open message
  until cooldown lapses.
- JSON-RPC fault envelopes surface their numeric code only; upstream message text
  is not propagated (it can mirror request material).
- The lifecycle answer of a transaction that cannot be observed on-chain is a
  typed refusal (throw), never a fabricated `0 confirmations`; the caller keeps
  the row in whatever state the ledger last evidenced.

## Wiring inside the custody module

`custody.module.ts` provides and exports `ChainObservationService`. The
confirmation surface consumes it:

- `ConfirmationService.refreshConfirmationsFromChain(tenantId, transactionId)` -
  new for Batch 03. Reads the transaction row, refuses when the service was built
  without a chain surface, refuses when the transaction carries no chain hash,
  calls `provider.getConfirmations` (canonical chain evidence: tip height minus
  inclusion block + 1, or - for Tron - `/wallet/gettransactioninfobyid` block
  arithmetic), then feeds the observed count into `observeConfirmation` with the
  tenant's required-confirmation policy. Terminal/rewinds are handled by the
  same state machine as today; nothing bypasses `ConfirmationService.observeConfirmation`.

Metrics families (all `wlct_custody_chain_*`, health-diagnosable from
`/metrics`):

- `wlct_custody_chain_rpc_requests_total{network,provider,result}`
- `wlct_custody_chain_rpc_latency_seconds{network,provider}` (histogram)
- `wlct_custody_chain_breaker_state{network,provider}` (1 = open)
- `wlct_custody_chain_observations_total{network,provider}`

Label names are pinned to the shared allow-list on both sides: the TS registry
in `apps/api/src/infrastructure/metrics/metrics.registry.ts` and the Python
catalogue in `libs/trading-core/wlct_trading/observability/labels.py` carry the
same names (`network`, `provider`, plus the futures `guard` axis from item B).
The parity spec fails the build if either side forgets the other.

## Failure mode taxonomy (what an operator sees)

| Situation | Surface behaviour |
| --- | --- |
| Switch off | `ServiceUnavailableException{code:'CHAIN_PROVIDERS_DISABLED'}`; module holds no RPC material |
| Network not configured | `CHAIN_PROVIDER_UNAVAILABLE` refusal, zero providers for that network |
| Boot misconfig (enabled but zero endpoints/hosts) | env schema `superRefine` refuses startup |
| Endpoint host not on allowlist | boot refuses (schema) AND client refuses again at call time (belt + braces) |
| JSON-RPC fault | `PROTOCOL_VIOLATION` with numeric code |
| Breaker open | `CHAIN_UNAVAILABLE` instantly, metered as `result="breaker_open"` |
| Truncated/oversized body | `PROTOCOL_VIOLATION`, breaker unaffected |
| Tx not indexed yet (Tron) | `CHAIN_UNAVAILABLE` ("not indexed") - never fabricated zero-fee/values |

## What stays out of scope

- No transaction submission, broadcasting, signing or key custody (by design and
  by test).
- No automatic re-enablement after failure: breakers cool down on their own
  timer, but network-level enablement is an operator act (`ENABLED=true` +
  endpoint + allowlist), mirrored in the runbook `docs/LIVE_ENABLEMENT_RUNBOOK.md`.
