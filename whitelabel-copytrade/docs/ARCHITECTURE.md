# Architecture

## 1. What this system is

A multi-tenant, white-label copy-trading platform. One deployment serves many
independent organisations ("tenants"), each with its own users, roles, branding,
subscription and configuration. It is **non-custodial**: the platform never
holds customer funds. Users connect their own exchange accounts with trade-only
API keys, and orders are placed on the user's own exchange account.

Part 1 delivers the foundation - tenancy, identity, authorisation, security and
the service skeletons. Copy-trading logic and live order execution are
explicitly out of scope and are hard-disabled in code.

## 2. Topology

```
                        ┌───────────────────────┐
   Mobile (Flutter) ───▶│                       │
                        │   NestJS API (:4000)  │◀─── Admin console (Next.js :3000)
   Browser ────────────▶│  REST + Socket.IO     │       (server-side proxy only)
                        └───────┬───────────────┘
                                │
            ┌───────────────────┼────────────────────────────┐
            │                   │                            │
     ┌──────▼──────┐     ┌──────▼──────┐            ┌────────▼────────┐
     │ PostgreSQL  │     │    Redis    │            │  Internal HTTP  │
     │  (Prisma)   │     │ cache/queue │            │  (token-gated)  │
     └─────────────┘     └──────┬──────┘            └────────┬────────┘
                                │                            │
                     ┌──────────┴──────────┐      ┌──────────┴──────────┬─────────────┐
                     │ notification-service│      │  trading-engine     │ market-data │
                     │  Node + BullMQ :8003│      │  Python/FastAPI:8001│ Python :8002│
                     └─────────────────────┘      └─────────────────────┘─────────────┘
```

Only the API and the admin console are published. The three supporting services
listen on the internal network and require a shared internal token.

## 3. Why these boundaries

**One API, several workers.** All client traffic terminates at the NestJS API.
It owns the database, authorisation and the audit trail. Everything else is a
worker or a calculator that the API delegates to. This keeps exactly one place
where a tenant boundary can be crossed, which is the property that makes
multi-tenancy auditable.

**Python for market and trading logic.** Exchange connectivity, numerical work
and the risk engine live where the ecosystem is strongest (`ccxt`, the
scientific stack) and where a hot loop will not block a Node event loop.

**Node for the notification worker.** It shares the API's queue contract and
templates; a second language there would buy nothing.

**A separate notification process, not an inline worker.** Email sending is slow
and failure-prone. Running it in the API process would couple request latency to
an SMTP server's mood. `QUEUE_RUN_INLINE_WORKERS` gates the inline path so a
single-process development setup still works.

## 4. Multi-tenancy

### Resolution

The tenant for a request is resolved in this order:

1. Custom domain (`TenantDomain`)
2. Platform subdomain
3. `X-Tenant-Slug` header
4. `DEFAULT_TENANT_SLUG`

For an authenticated request, whatever the above produced is **overridden** by
the tenant in the access token. A client-supplied tenant id is a hint for
unauthenticated flows (sign-in, branding) and never an authorisation input. An
*explicit* selection (domain, sub-domain or header) that contradicts the token
is rejected outright with `403 TENANT_MISMATCH` and recorded as a security
event; the `DEFAULT_TENANT_SLUG` fallback is not, because it reflects a server
assumption rather than a client claim. See `docs/MULTI_TENANCY.md`.

### Isolation

`TenantScopedPrismaFactory` wraps the Prisma client and injects a `tenantId`
predicate into every query against a tenant-owned model. The model allowlist is
explicit, so adding a table is a deliberate decision rather than an accident.

Supporting properties:

* Every tenant-owned table carries a non-null `tenantId`.
* `tenantId` is the first column of every composite index, so the predicate is
  free.
* Uniqueness is scoped: `User` is unique on `(tenantId, email)`, not on `email`.
* Platform-scoped rows use `tenantId = NULL` (system roles, platform plans).
  Prisma cannot express `NULL` inside a compound-unique `where`, so those rows
  are read with `findFirst` and written with explicit update/create branches.

Row-level security is the natural next step; the schema is already shaped for
it.

### Physical naming

Tables and columns are `snake_case` in PostgreSQL (`@@map` / `@map`) while the
Prisma client stays `camelCase` in TypeScript. Application code is unaffected by
the mapping, but every hand-written query, migration, psql session, BI tool and
`GRANT` in `infrastructure/database/init/` avoids permanently quoting
identifiers. Mixing the two conventions - `snake_case` tables with `camelCase`
columns - is the outcome worth avoiding, because it forces quoting anyway while
looking like an oversight.

## 5. Identity and authorisation

### Authentication

* **Passwords**: argon2id, with cost parameters from the environment.
* **Access tokens**: short-lived JWTs, signed with a dedicated key.
* **Refresh tokens**: stored as HMACs, never in the clear. Every refresh rotates
  the token and records `familyId` / `replacedByTokenId`. Presenting a consumed
  token revokes the entire family and raises a `CRITICAL` security event - that
  is the signal of a stolen token.
* **Device binding**: refresh tokens are bound to a client-generated device id,
  so a stolen token is useless elsewhere.
* **Logout**: blacklists the access token's `jti` in Redis until its natural
  expiry.
* **2FA**: TOTP via `otplib`. The secret is encrypted at rest with AAD
  `two_factor_secret:{userId}`; the last used counter is stored to block replay;
  recovery codes are argon2-hashed.
* **Defence**: per-account lockout, uniform responses to defeat account
  enumeration, a session cap with LRU eviction, and suspicious-login scoring.

### Authorisation

Roles are data, not code. Seven system roles ship as immutable templates
(`tenantId = NULL`, `isSystem = true`) and are cloned into each tenant at
creation, so a tenant can customise its own copy without affecting anyone else.

`PermissionsGuard` re-reads live permissions on every request rather than
trusting the token's snapshot, supports `all`/`any` semantics and wildcards
(`*`, `resource:*`), and emits a `PERMISSION_ESCALATION_ATTEMPT` event on
denial. Adding a role or permission is a data change; no authorisation code
needs to be rewritten.

## 6. Secrets and encryption

Exchange API credentials are the highest-value data in the system. They are
protected with envelope encryption:

* A fresh 256-bit **data key** per record.
* The data key is sealed with AES-256-GCM under a **key-encryption key**
  (`ENCRYPTION_MASTER_KEY_BASE64`), identified by `ENCRYPTION_KEY_ID`.
* `ENCRYPTION_PREVIOUS_KEYS_JSON` holds retired keys for decrypt-only, which
  makes rotation a zero-downtime operation.
* **AAD binds ciphertext to its owner** (`{tenantId}:{userId}`). A row copied
  into another tenant will not decrypt.
* `ENCRYPTION_PROVIDER=kms` swaps the local KEK for a managed KMS without
  touching call sites.

Deterministic lookups on encrypted values use an HMAC-SHA256 **blind index**
(`BLIND_INDEX_KEY_BASE64`). The same key hashes client IPs, so the audit trail
is correlatable without storing an address.

Secrets are never returned by the API. Reading a secret tenant setting yields
`{ configured: true }`.

## 7. Errors, logging and observability

Every error leaves the API in one envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable, safe to display.",
    "details": [{ "field": "email", "message": "Must be a valid email address" }],
    "requestId": "0f3c...",
    "timestamp": "2026-09-05T10:00:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```

The Python services emit the same shape, so a client has one parser.

Logging is structured JSON via pino, with a redaction list covering
authorization headers, cookies, passwords, tokens, exchange secrets and payment
credentials. Stack traces never reach a production response body. Every request
carries an `x-request-id` that is propagated to the internal services.

Health endpoints: `/health` (liveness, no dependencies), `/health/ready`
(Postgres + Redis, 503 when down), `/health/deep` (adds queue depth and the
three downstream probes), `/health/startup`.

### The reliability plane (Part 10)

Above the metrics layer sits the reliability plane, and the one law over it:
**observe, never authorise.** Its parts:

* **Tracing.** `apps/api/src/infrastructure/tracing/` (W3C parse/format,
  deterministic BigInt sampling, OTLP/JSON encoder, the middleware,
  `TracingService`) mirrors `libs/trading-core/wlct_trading/observability/`
  (`tracing.py`, `redaction.py`, `faults.py`); the engine's glue is
  `services/trading-engine/app/tracing.py`. Propagation is
  W3C `traceparent`/`tracestate` in, OTLP/JSON out, single-attempt export
  with drop counting that is loud (counters + gauge + a three-streak alert).
  Head sampling is `int(trace_id[:16],16) < ratio_ppm * 2^64 / 10^6` - a pure
  function, identical in both languages, fixture-pinned.
* **SLOs.** Definitions are immutable versioned rows
  (`slo_configuration_versions`, checksummed canonical JSON); measurements
  live in 10-minute Redis bucket hashes (`wlct:trading:ops:slo:<source>:
  <epoch-min/10>`); evaluation appends `slo_evaluations` rows on a */N cron
  and on demand. Dual windows, dual multipliers: paging needs fast burn over
  the short window AND slow burn over the long one (Google SRE style);
  state is `HEALTHY/WARNING/CRITICAL/EXHAUSTED/UNKNOWN`, and UNKNOWN from a
  thin collector is reported as the measurement gap it is (`SLO_TELEMETRY_GAP`),
  never averaged away. The nine default objectives live in the Python catalog
  as the source of truth; the TS catalog is pinned to it by SHA-256 checksums
  that include the human-readable text.
* **Queue correlation.** A publish that succeeds attaches its traceparent to
  a short-TTL Redis sidecar (`captureQueueSidecar`); a worker continues the
  span only if the sidecar exists. Job payloads never carry telemetry fields,
  and telemetry never gates a job.
* **Cross-language contract.** `docs/fixtures/reliability_fixtures.json`
  (generated by `libs/trading-core/scripts/gen_part10_fixtures.py`) pins
  sampling decisions, traceparent/tracestate vectors, attribute hygiene,
  byte-exact OTLP payloads, budget/burn tables, catalog checksums and full
  evaluation rows; `slo-parity.spec.ts` replays every vector through the TS
  implementation. Drift on either side fails the suite, in either direction.

### The worker plane (Part 11)

The process model the earlier parts only described in comments finally
exists: three roles, each able to refuse, none able to impersonate another.

* **API** - unchanged producer of `TRADE_EXECUTION` jobs (deterministic
  `jobId` dedupe at admission, `enqueueOrThrow` for anything a human waits
  on); mounts no consumers, by module graph, not by flag:
  `src/modules/worker/` is imported only by `src/worker.ts`.
* **Worker** (`apps/api/src/worker.ts`, no HTTP server at all) - validates
  each job against the mirrored producer contract, admits it only while it
  verifiably HOLDS the partition claim its `${tenantId}:${accountId}` key
  maps to (rendezvous assignment + Redis claims, both languages pinned by
  `docs/fixtures/coordination_fixtures.json`), forwards, and acks: engine
  2xx completes the job (any business verdict inside it), engine terminal
  4xx/501 fails it visibly with the engine's reason, 5xx/transport retries
  within the producer's attempt budget, and not-owner defers via
  `moveToDelayed` - counted through `WORKER_MAX_DEFERS`, so homeless jobs
  page somebody instead of orbiting forever. Coordination failures fail
  CLOSED to deferral; the job path never awaits Redis.
* **Execution engine** (`services/execution-engine`) - the only process with
  venue-adjacent runtime, hosting the core `ExecutionEngine` behind an
  internal token + required tenant header; serves the four commands the
  queue actually carries, answers 501 to the one it cannot honor
  (`resync-private-stream`), and REFUSES `EXECUTION_MODE=live` at startup
  by code, with live's remaining prerequisites named rather than implied
  (Part 16 wired the credential source and the authenticated order-placement
  review; what live mode still lacks is a venue attestor instance built from the
  deployment's own trading adapter, per-tenant key custody behind
  `EXECUTION_CREDENTIAL_SOURCE=secret-manager`, a signed HTTP transport with the
  egress addresses registered at the venue, and Part 13's durable store).
  The store is a backend choice: `memory` (default, process-local, reports
  `storeDurable: false`) or `postgres` (durable orders/events/fills in the
  three `engine_*` tables, DSN required, missing tables or a dead pool
  refuse startup - never a silent fallback). Its measurements leave the process the
  way its siblings' do - `GET /metrics`, Prometheus 0.0.4 text on the internal
  network, no token and no tenant-shaped label (the core's cardinality law refuses
  such labels at registration, which is the difference between being safe to scrape
  and being filtered after the fact), absent from the OpenAPI document and from the
  worker's forwarding list, and not mounted at all when `OBSERVABILITY_ENABLED` is
  false - which `NODE_ENV=production` refuses (docs/PART18_METRICS_EXPOSITION.md). Part 14 added the bounded
  journal: the event table alone is prunable, apply is dark behind
  `EXECUTION_RETENTION_ENABLED`, every completed run (dry included)
  writes a `engine_retention_runs` ledger row nothing prunes, and no
  schedule ships - the deployment's cron calls
  `scripts/retention-run.mjs`, one tenant per run. The worker's boot gate asserts
  engine compatibility, and since the Part 13 ack-policy re-review it
  accepts a durable engine only when the claim is coherent
  (`storeDurable: true` + `storeBackend: "postgres"`). Part 15 added one more
  read-only route beside retention - `POST /internal/v1/enablement/audit` -
  which counts the catalogue and the rows to grade whether row-level security
  is actually enabled and isolating for the engine's own tables, answers 200
  with a FAIL finding because the finding IS the evidence, and writes nothing
  to the database: the durable record of a run is a line in the DR manifest's
  evidence ledger, appended by an operator script that has no credentials of
  its own (docs/PART15_RLS_ENABLEMENT.md). Part 16 added one more internal
  read-only route beside those - `POST /internal/v1/placement/attest` - which
  runs the venue-side review for one would-be order and answers with the verdict;
  it answers 200 when the review refuses, because the refusal IS the answer to
  the question asked, and every response carries `transmitted: false`, which is a
  constant in this build rather than a computed field. The review is not a second
  rejection path: its verdict is gate 11 of 11 in the engine's safety set, so one
  code path produces the blocked-gate incident, the audit event and the typed
  result, and the verdict's own fields ride inside the order's `SUBMITTED` event
  payload. On a simulated runtime it runs on every order and changes no outcome,
  recording its findings as `INFO`; on a runtime that could transmit, a review
  that cannot be answered is a refusal - and that runtime refuses to start with
  no reviewer wired at all. The posture is published where two deployments can be
  compared: `GET /internal/v1/status` carries `credentialSource` (which key source
  this process was willing to read - the source, never a credential) and a typed
  `placement` block naming the mode, whether a venue answer is required, the
  gatherer's provenance, the policy's bounds and the cache's counters, so "was
  this engine even wired to ask" is answerable without shell access. The same
  dictionary is spread into `/health/ready` with no token at all, because a probe
  cannot be handed a service token it was never issued; that is safe only while
  `describe()` is secret-free by construction, and a test holds both halves of
  that sentence - every described key reaching the probe, and nothing
  credential-shaped at any depth. It is typed
  rather than a passthrough dict so that a field added to the runtime's
  description has to be *decided* before it reaches an internal caller
  (docs/PART16_PLACEMENT_REVIEW.md). Part 18 added one more field decided that
  way - `metricsConfigured`, published because a scrape of all zeros needs an
  answer to "is this process measuring anything at all", and beside it the same
  fact as a wiring gauge. The reason both exist is that until that part this
  service had never handed its engine an instrument, so every counter the
  documents above describe was being incremented by `None`
  (docs/PART18_METRICS_EXPOSITION.md).
  Part 19 is the third instance of that same decision, and the one that shows why the
  rule exists: `describe()` grew `credentialFetcher` and `operatorConfirmation` beside a
  `liveEnablement` block, and because `/health/ready` spreads the wiring view verbatim to a
  caller with no token, the confirmation could only be published as `public_summary()` -
  `required`, `keyConfigured`, `recordPresent`, `expiresAtMicros` and a 12-character digest
  fingerprint. A full digest or the nonce would have made an unauthenticated probe a way to
  collect the material a signed authorisation is made of. Two consequences are pinned rather
  than remembered: `PlacementStatusView` had to grow its two fields in the same edit (its base
  model is `extra="forbid"`, so a describe() key with no schema field is a 500 on both routes,
  which is the failure this law is designed to produce - loudly, at the boundary, instead of
  quietly publishing a partial picture), and the credential fields moved to the names
  `providerSource` / `providerFetcher` IN LOG RECORDS ONLY, because `RedactionFilter` replaces
  the value of any key whose NAME is credential-shaped and a boot line that reads `[REDACTED]`
  where the mechanism name belongs explains nothing to the person it is written for (the API
  spelling is untouched; docs/PART19_LIVE_ENABLEMENT.md sec. 3 and sec. 7).
  Part 17 added
  the second half of the same idea: the engine's incident records are durable over
  the same Postgres pool as the order store (``engine_incidents``), a durable store
  paired with the memory sink is refused at construction rather than noticed after
  a restart, and ``POST /internal/v1/incidents/list`` answers "what is open" with a
  503 when the store cannot reply - because an empty list is what a healthy system
  looks like, and this service would rather be unavailable than misleading
  (docs/PART17_DURABLE_INCIDENTS.md).

Read-replica routing lives beside it as a policy, not a rewire:
`routeRead` fails closed in every direction (execution-critical reads never
see the replica; unknown lag or a stale probe routes primary;
half-configured deployments refuse to boot), and the counter family
`wlct_read_routing_decisions_total` makes "we have a replica we never use"
a number instead of a rumor.

The full law, the queue-consumer inventory, the runbook and the honest
deferral list are in `docs/PART11_WORKER_SCALING.md`.

The engine's self-description has a reader now (Part 20). `describe()` on the runtime
becomes `StatusResponse` on `/internal/v1/status`, and the single TypeScript mirror of that
contract (`apps/api/src/modules/worker/engine-status-contract.ts`) is a table the parser
walks, so the two languages cannot disagree in silence: a spec parses `schemas.py` and
compares field names, kinds, requiredness and defaults one by one. The same parsed object
feeds the worker's startup gate and the operations panel's `ENGINE POSTURE` section, which
is the only place in the platform where the process holding the venue credentials is asked
rather than inferred. The engine is deliberately not a health-mirror publisher - it owns no
Redis client, and copying its facts into a cache a reader polls would be a second copy of a
truth the author already answers on request. `docs/PART20_ENGINE_STATUS_EDGE.md` is the
document; the absence laws (required key missing is a refusal, optional key missing is the
engine's own default, unknown key is reported not dropped) are its sec. 2.

## 8. Real-time

Socket.IO on the `/realtime` namespace. Tokens arrive only in the handshake, and
room membership is derived server-side from the authenticated identity - a
client cannot ask to join `tenant:someone-else`. Cross-node fan-out publishes to
the Redis channel `realtime:dispatch`, and the Redis adapter is keyed with the
configured prefix so several environments can share one Redis instance safely.

## 9. Execution safety

Part 1 must not be able to move money. Four independent gates:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine exposes risk evaluation only; there is no order-placement
   route to call.
3. `RiskDecision.wouldExecute` is `approved AND EXECUTION_ENABLED`, so even an
   approved intent reports that it would not execute.
4. The execution engine's eleven-gate safety set ends in `PLACEMENT_ATTESTED`
   (Part 16), and the runtime that would transmit is the one that refuses to boot
   without a reviewer wired - so gate 4 does not depend on the platform flag being
   read correctly, which is the whole reason it is counted separately.

`EXCHANGE_SANDBOX_MODE=true` additionally disables any venue without a sandbox.

## 10. Deployment

`docker-compose.yml` is the reference topology. Migrations run as a one-shot
job (`migrate`) that must complete successfully before the API starts - running
them from every replica is a race, and a failed migration should stop a deploy
rather than crash-loop an application container.

All images are multi-stage, run as non-root, carry health checks, and contain no
source, no `.env` and no build cache.

## 11. What Part 1 deliberately does not do

* No copy-trading engine, position sizing, or follower allocation.
* No live order placement.
* No payment provider integration (no card data touches the platform).
* No KYC provider integration (the model and status field exist).
* No row-level security policies yet.
* No simulated trading results anywhere in the product.
