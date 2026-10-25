# Placement review and the live-execution gate

> **Current status (2026-10-09):** the review gate exists, but this build still refuses `EXECUTION_MODE=live`. This document describes the checked-in controls; it is not authorization to connect an exchange or send an order.

## 1. The gate

`SafetyGate.PLACEMENT_ATTESTED` is gate **11 of 11** in the execution engine's safety set. It consumes a placement-review verdict gathered before gate evaluation. The gate can preserve or tighten the outcome; it cannot grant permissions or bypass another gate.

The review distinguishes three states:

| State | Result |
| --- | --- |
| No reviewer is wired | The gate is not applicable only for a runtime that cannot transmit; a transmitting runtime is refused at startup without a reviewer. |
| A reviewer returns an allowed verdict | The gate passes with the verdict identifier and venue-backed status. |
| A reviewer returns a refusal | The gate fails with the first blocking finding. The existing `LIVE_TRADING_NOT_AUTHORISED` error vocabulary is reused; no second rejection path is introduced. |

A review is evidence about the requested tenant, account, symbol, order type, and time-in-force. The cache key includes the complete order shape so that evidence collected for one order cannot authorize a different order shape. Missing or stale evidence, unsupported symbols or order types, withdrawal-capable credentials, absent IP restrictions, and a venue response that cannot be trusted are refusals for a transmitting runtime. A venue rate-limit response is not treated as permission to proceed.

## 2. Current live-mode boundary

Live execution is **not wired in this build**: `build_runtime` refuses `EXECUTION_MODE=live`. Its startup refusal is derived from the wiring the process actually constructed, and it says that no order was sent. The current missing items include a configured live credential source and fetcher, a venue attestor over a venue trading adapter, accepted operator confirmation, a durable store, and distributed locks. The reported `signed transport wired` fact refers to the internal service transport; it does **not** mean an authenticated exchange trading adapter or exchange endpoint is wired.

The service's composition root does not construct a live venue trading adapter or select a live/testnet exchange base URL. Therefore the placement reviewer is exercised only in non-transmitting modes; it is not evidence that a live order can be safely placed. Do not switch a deployment to live based on the presence of `PLACEMENT_ATTESTED`, an API response, or generated SDK/OpenAPI artifacts.

## 3. Safe review requirements

Before any live-path review can be considered, the deployment must independently verify, at minimum:

1. the correct per-tenant credential source is built and available only to the order-execution boundary;
2. the venue attestor uses the same authenticated exchange adapter and request-weight accounting as order placement;
3. the exchange key is trade-only, withdrawal permission is disabled, and the venue-side IP allowlist matches the deployed egress addresses;
4. attestations are fresh, tied to the full order shape, and fail closed on unknown or incomplete venue answers;
5. durable order state, idempotency, replay handling, and distributed locking are actually wired and observable;
6. a valid, scoped, time-bounded operator confirmation is present and enforced; and
7. the final order path is covered by contract, integration, and failure-injection tests against a non-production venue before any production authorization.

A missing answer is not a positive answer. A stale or unavailable attestor must not be converted to an allow decision. Rate-limit exhaustion, retry exhaustion, idempotency conflicts, and ambiguous exchange acknowledgements must leave the order in a state that can be reconciled without duplicate placement.

## 4. Read-only status and verification

The internal `/status` report exposes a typed placement/live-enablement posture, not credentials, signing material, or operator-confirmation contents. Its status fields describe the wiring and blockers; they do not authorize a trade. `GET /health/ready` is a separate unauthenticated readiness surface and must remain limited to the deliberately approved public summary.

Relevant verification:

- `services/execution-engine/tests/test_part16_placement.py` pins the gate, startup refusal, and this document's safety statement.
- `libs/trading-core/tests/test_part16_binance_attestation.py` and the trading-core placement-review tests exercise venue facts, request weights, cache scoping, and fail-closed verdicts.
- `services/execution-engine/tests/test_part19_live_wiring.py` pins the live-mode refusal even when an operator-confirmation record is supplied.

A passing unit suite proves only the tested code paths and fixtures. It is not a venue certification, a production RLS audit, or evidence that this build has transmitted or reconciled a live exchange order.