# Live Enablement Runbook — Binance SPOT (execution-engine)

This is the operator procedure for moving the execution engine from the
default simulated mode to Binance SPOT testnet rehearsal, and then — only
when every gate below passes — to live trading. It describes what the code
actually checks; where this document and the code disagree, the code wins
and this document is a bug.

Scope of this build: Binance **SPOT only**, via the signed transport in
`services/execution-engine/app/venue/`. Futures/perpetuals, other
exchanges' placement, and custody/withdrawal of any kind are out of scope
and not wired. The default remains `EXECUTION_MODE=simulated` with
`EXECUTION_DRY_RUN=true`; nothing in this runbook changes a default.

## 1. What is wired

For `EXECUTION_MODE=testnet|live`, composition
(`services/execution-engine/app/composition.py`) builds one venue stack
via `services/execution-engine/app/venue/binance_runtime.py`:

- one HTTP transport (`app/venue/binance_transport.py`) over the core's
  signed sender — TLS verification on, redirects off, per-request timeout
  from `EXECUTION_REQUEST_TIMEOUT_MS`, and a hard base-URL allowlist:
  testnet is exactly `https://testnet.binance.vision`, live is exactly
  `https://api.binance.com`. Any other host is refused **before**
  transmission, so a signed request (and the API key it carries) can never
  be sent anywhere else;
- one venue clock, synchronised against `GET /api/v3/time` at startup and
  every `EXECUTION_CLOCK_SYNC_INTERVAL_SECONDS` after that. Signing is
  refused until the offset has been measured and while it is stale;
  `recvWindow` is 5000 ms;
- one rate-limit registry shared by the trading adapter, the account
  adapter and the placement attestor, plus the transport's observed
  `X-MBX-USED-WEIGHT-*` budget. During a venue 429/418 `Retry-After`
  window, requests are refused locally instead of transmitted;
- one trading adapter, shared with the placement attestor (the review and
  the order it approves sign with the same key, the same clock and the
  same budget) and with reconciliation;
- deterministic `clientOrderId`s derived from the order intent. An order
  POST is never retried blindly: on timeout, reset or 5xx the outcome is
  resolved by `GET /api/v3/order` with `origClientOrderId`
  (`app/venue/order_outcome.py`), and cancels are issued the same way.

Simulated mode builds none of this and is unchanged.

## 2. Venue keys (do this at Binance, per account)

1. Create a dedicated API key per trading account. Enable **SPOT trading
   only**. Never enable withdrawals — the placement review refuses keys
   that can withdraw, and a key that can empty an account has no place in
   an order-placement process.
2. Restrict the key to the deployment's **egress IP addresses** (the NAT /
   egress IPs of the hosts running the execution engine — register every
   address the fleet can present, and re-check after any infrastructure
   change). Live mode requires `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true`,
   and the review verifies the allowlist at the venue per order.
3. Testnet keys come from the Binance SPOT testnet and work only against
   `https://testnet.binance.vision`; live keys only against
   `https://api.binance.com`. Keys are never interchangeable.
4. Rotation is policy, not intention: `EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS`
   (default 90) bounds acceptable key age in the placement review. Keep
   the venue-side creation date in your change log so the age evidence the
   review reads matches reality.

## 3. Custody — where the keys live

Live mode accepts exactly one custody arrangement:

- `EXECUTION_CREDENTIAL_SOURCE=secret-manager`
- `EXECUTION_CREDENTIAL_FETCHER=vault-kv2` (with `EXECUTION_VAULT_ADDR` and
  the token in the environment variable named by `EXECUTION_VAULT_TOKEN_ENV`)

`EXECUTION_CREDENTIAL_SOURCE=environment` fails the live gates by design:
environment variables are readable by every co-tenant of the process and
surface in crash dumps. It exists for local rehearsal against testnet only.

Secrets are never logged: transport log lines carry method, path (never
the signed query), status, venue error code and weight. If you ever see a
key, secret or signature in a log, treat it as an incident.

## 4. Testnet rehearsal

Goal: prove the full wire — attestation, placement, query, cancel,
reconciliation — with keys that cannot lose money.

1. Configure (testnet keys in Vault, or environment source for a local
   run): `EXECUTION_MODE=testnet`, keep `EXECUTION_DRY_RUN=true`.
2. Boot and check `/internal/v1/status`: `mode` is `testnet`; the `venue`
   block shows `testnet: true`, base URL
   `https://testnet.binance.vision`, and the attestor source. The engine
   will attest and read, but transmits no order while dry-run is on.
3. For a transmitting rehearsal set `EXECUTION_DRY_RUN=false`. The core
   engine then demands the real-money wiring law even on testnet: a
   durable Postgres store (`EXECUTION_STORE_BACKEND=postgres`), Redis
   distributed locks, and the venue attestor. That is intentional — a
   rehearsal that skips the durable path rehearses a system you will not
   run.
4. Run the recorded + live proof suite against your testnet keys:
   `libs/trading-core/tests/live_testnet/test_binance_testnet_roundtrip.py`
   with `WLCT_LIVE_TESTNET=1` and `BINANCE_TESTNET_API_KEY` /
   `BINANCE_TESTNET_API_SECRET` set. It places a resting LIMIT order far
   from the touch through this transport, polls it, cancels it, and proves
   the key cannot withdraw.
5. Place a small testnet order through the normal command path; watch it
   reconcile. Kill the process mid-flight once and confirm restart
   recovery reads the durable store, not memory.

## 5. Going live — the gates

`EXECUTION_MODE=live` returns a runtime only when **every** gate in
`services/execution-engine/app/venue/live_gates.py` passes. Otherwise
startup fails with `ExecutionUnavailable` listing each failed gate (plus
the enablement report's own rendering). There is no partial live.

| Gate | What must be true |
| --- | --- |
| `ENABLEMENT_REPORT` | The typed live-enablement grading has nothing missing: credential source configured, fetcher wired, venue attestor wired, operator confirmation accepted, durable store, distributed locks, IP allowlist enforced, signed transport wired. |
| `OPERATOR_CONFIRMATION` | The scoped, HMAC-verified operator confirmation record verifies in this process (`EXECUTION_OPERATOR_CONFIRMATION_FILE` + the key in `EXECUTION_CONFIRMATION_KEY_ENV`). |
| `IP_ALLOWLIST` | `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true` (Settings also refuses `false` in live mode). |
| `CREDENTIAL_SOURCE` | `secret-manager` + `vault-kv2`. Environment keys refuse. |
| `KEY_AGE_POLICY` | A finite `EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS` (Settings enforces 1..365). |
| `DURABLE_STORE` | Postgres-backed store; the in-memory store is a refusal. |
| `DRY_RUN_EXPLICIT_OFF` | `EXECUTION_DRY_RUN=false` **set explicitly**. A missing line is not a decision and refuses. |
| `KILL_SWITCH_READABLE` | `EXECUTION_LIVE_KILL_SWITCH_ENGAGED=false` set explicitly. Unset/blank means "state unreadable" and refuses; `true` means engaged and refuses. |

Procedure:

1. Complete the testnet rehearsal (section 4) with transmitting settings.
2. Prepare live keys per sections 2–3; confirm egress IPs registered.
3. Issue the operator confirmation for the exact tenant/account/scope;
   keep its validity window short and treat re-issue as a change, with a
   second pair of eyes.
4. Set: `EXECUTION_MODE=live`, `EXECUTION_DRY_RUN=false`,
   `EXECUTION_LIVE_KILL_SWITCH_ENGAGED=false`,
   `EXECUTION_STORE_BACKEND=postgres`, `EXECUTION_DISTRIBUTED_LOCKS=true`
   (+ `EXECUTION_REDIS_URL`), `NODE_ENV=production` with observability on.
5. Deploy. If startup refuses, read the gate list literally — each name
   is a fixable fact, not a riddle. Do not work around a gate; a gate you
   cannot satisfy is the system working.
6. First live order: smallest size the venue filters allow, during staffed
   hours, watched end to end (submit → venue ack → status → fill/cancel →
   reconciliation clean).

## 6. Kill switch and rollback

- **Immediate hold:** set `EXECUTION_LIVE_KILL_SWITCH_ENGAGED=true` and
  restart — live composition refuses. For an already-running process, the
  per-order kill switch inside the core engine still applies; use the
  existing operational controls to trip it, then restart into the refused
  state so the refusal is durable.
- **Dry-run hold:** `EXECUTION_DRY_RUN=true` + restart keeps the stack
  reading and reconciling while every placement stops before transmission.
- **Full rollback:** `EXECUTION_MODE=simulated` + restart. No venue
  adapter exists in the process; resting live orders remain at the venue
  and must be cancelled/adopted deliberately — check the venue before
  assuming the book is flat.
- After any rollback, reconcile against the venue by
  `origClientOrderId` before trading again; `unknown` outcomes are never
  resubmitted blind.

## 7. Reading a refusal

- Startup `ExecutionUnavailable` (live): the message contains the
  enablement report (satisfied vs missing prerequisites) followed by
  `Failed live gates: ...`. Fix exactly those.
- `EXECUTION_MODE=testnet` refusing at startup: no credential source — the
  adapters have nothing to sign with.
- Orders refusing with clock errors: the venue clock could not synchronise
  (check egress to the venue, then `venue` in status); signing stays
  refused until a sync succeeds — that is the fail-closed behaviour, not
  an outage to bypass.
- HTTP 429/418 from the venue: the transport records the `Retry-After`
  window and refuses locally until it closes; weight figures are in the
  `venue.transport` status block.

## 8. Environment reference (venue modes)

| Variable | Meaning |
| --- | --- |
| `EXECUTION_MODE` | `simulated` (default) \| `testnet` \| `live` — selects paper venue or the Binance base URL. |
| `EXECUTION_DRY_RUN` | Default `true`. Live requires an explicit `false`. |
| `EXECUTION_REQUEST_TIMEOUT_MS` | Per-request venue timeout handed to the transport and engine. |
| `EXECUTION_CLOCK_SYNC_INTERVAL_SECONDS` | Venue clock re-sync cadence (default 60, range 5..300). |
| `EXECUTION_LIVE_KILL_SWITCH_ENGAGED` | Startup kill-switch state; live requires explicit `false`. |
| `EXECUTION_CREDENTIAL_SOURCE` / `EXECUTION_CREDENTIAL_FETCHER` | Custody; live requires `secret-manager` / `vault-kv2`. |
| `EXECUTION_VAULT_ADDR`, `EXECUTION_VAULT_TOKEN_ENV` | Vault reach and token location. |
| `EXECUTION_STORE_BACKEND` | Live requires `postgres` (durable). |
| `EXECUTION_DISTRIBUTED_LOCKS`, `EXECUTION_REDIS_URL` | Live requires distributed locks. |
| `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST` | Live requires `true`. |
| `EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS` | Key-age policy bound (1..365). |
| `EXECUTION_OPERATOR_CONFIRMATION_FILE`, `EXECUTION_CONFIRMATION_KEY_ENV` | Operator confirmation record + verifying key location. |
| `EXECUTION_VENUE_ATTESTATION_INCLUDE_ACCOUNT` | Whether the placement review also reads account-level flags (extra venue weight per review). |

## 9. Known limits of this build

- **Binance SPOT only.** No futures/perpetuals, no other venue's placement
  path, no withdrawals or custody operations.
- **No venue base-URL configurability.** The two allowlisted hosts are the
  whole list; pointing the transport anywhere else is a code change with
  review, by design.
- The submission route's reference-price input is paper-venue market data;
  in venue modes there is deliberately no book wired, so submissions that
  need a reference price refuse as market-data-down rather than pricing a
  real order against a simulated mid. Venue market data for the route is
  future work; the engine command path is unaffected.
- User-data-stream: listen keys are creatable/keepalive-able per account
  through the runtime (`listen_key_manager`), and stream events parse via
  the core's userstream module; operating the socket is a deployment
  concern on top of that wiring.
