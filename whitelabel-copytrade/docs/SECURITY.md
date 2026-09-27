# Security

This document states what the platform does, why, and where the control lives in
the code. It is written to be checked, not admired: every claim points at a file.

## Threat model in one paragraph

The platform holds credentials that can place trades on a user's exchange
account, and it serves many organisations from one deployment. The two failures
that matter most are **cross-tenant data exposure** and **exchange credential
disclosure**. Everything below is ordered by how directly it prevents one of
those two.

---

## 1. Tenant isolation

| Control | Where |
| --- | --- |
| Query-level tenant predicate | `apps/api/src/infrastructure/prisma/tenant-scoped-prisma.factory.ts` |
| Tenant resolution and override | `apps/api/src/modules/tenants/guards/tenant.guard.ts` |
| Non-null `tenantId` + scoped uniqueness | `apps/api/prisma/schema.prisma` |

* A client-supplied tenant identifier is **never** an authorisation input. For
  an authenticated request the tenant comes from the access token.
* Every tenant-owned model is in an explicit allowlist. Adding a table to the
  scoped set is a deliberate edit, not a default.
* Uniqueness is per tenant: two organisations may both have `admin@example.com`.
* Platform-scoped rows (`tenantId = NULL`) are only reachable by platform users,
  enforced by `@PlatformOnly()`.

## 2. Authentication

| Control | Detail |
| --- | --- |
| Password hashing | argon2id; memory/time/parallelism from `ARGON2_*` |
| Access token | short-lived JWT, dedicated signing key |
| Refresh token | stored as HMAC, rotated on every use |
| Reuse detection | a replayed token revokes the whole family and raises `TOKEN_REUSE` (CRITICAL) |
| Device binding | refresh tokens bound to a client-generated device id |
| Logout | access-token `jti` blacklisted in Redis until expiry |
| Global revocation | `sv` claim vs `User.sessionVersion`, checked on every request |
| Session cap | LRU eviction by `lastSeenAt` |
| Lockout | per-account after `LOGIN_FAILED_MAX_ATTEMPTS` within the window |
| Enumeration | identical response and timing for unknown and wrong-password |

### Invalidating live access tokens

Blacklisting a `jti` only kills one token. Password changes and "sign out of
all devices" have to kill *every* token the user holds, including ones already
in flight, so each access token carries an `sv` claim holding the user's
`sessionVersion` at issue time. `JwtStrategy` (and `WsAuthGuard`, so open
sockets drop too) compares it with the stored counter on every request and
rejects a mismatch with `TOKEN_REVOKED`. Incrementing the counter therefore
invalidates all outstanding tokens instantly, without a distributed blacklist.

An integer counter is used rather than comparing the token's `iat` with
`passwordChangedAt`. `iat` has one-second resolution while the timestamp is
stored in milliseconds, so any time-based comparison is ambiguous for tokens
minted in the same second as the change - which is exactly what happens when a
user is handed new tokens immediately after changing their password, or when a
freshly provisioned tenant owner signs in for the first time. The counter also
cannot be skewed by clock drift between API instances.

### Two-factor authentication

TOTP via `otplib`. The shared secret is encrypted at rest with AAD
`two_factor_secret:{userId}`. `lastUsedCounter` is persisted so a captured code
cannot be replayed inside its window. Recovery codes are argon2-hashed and
single-use.

The challenge token issued between the password step and the code step is
bounded rather than strictly single-use: up to
`TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS` (default 5) codes may be tried against it,
after which it is discarded, and it is burned outright the moment a code is
accepted. Burning it on first sight would force a user who mistyped one digit
back through the password step; allowing unlimited tries would leave a captured
challenge open to brute force for its whole TTL. The attempt counter lives in
Redis under the challenge `jti` and expires with it. The endpoint additionally
sits behind the strict `auth` throttler, so the per-challenge budget is the
inner of two independent bounds.

## 3. Authorisation

Deny-by-default. `JwtAuthGuard` rejects any request without a valid token unless
the route is explicitly `@Public()`.

`PermissionsGuard` re-reads the user's live permissions on every request rather
than trusting the token payload, so revoking a role takes effect immediately
rather than at the next token refresh. Wildcards (`*`, `resource:*`) are
supported. A denial emits `PERMISSION_ESCALATION_ATTEMPT`.

Roles are data. Seven system roles ship as immutable templates and are cloned
per tenant. Adding a role never requires an authorisation-code change.

## 4. Exchange credential protection

**The platform never stores an exchange API secret in plaintext, never returns
one through the API, and never writes one to a log.**

Envelope encryption (`packages/utils/src/crypto.ts`):

1. A fresh 256-bit data key (DEK) is generated per record.
2. The payload is sealed AES-256-GCM under the DEK.
3. The DEK is sealed under the key-encryption key (KEK) from
   `ENCRYPTION_MASTER_KEY_BASE64`, tagged with `ENCRYPTION_KEY_ID`.
4. Additional authenticated data binds the ciphertext to `{tenantId}:{userId}`.
   A row copied to another tenant fails to decrypt - tampering is detected, not
   tolerated.

### Key management

| Variable | Purpose |
| --- | --- |
| `ENCRYPTION_MASTER_KEY_BASE64` | active KEK |
| `ENCRYPTION_KEY_ID` | identifies the active KEK in each ciphertext |
| `ENCRYPTION_PREVIOUS_KEYS_JSON` | retired KEKs, decrypt-only |
| `ENCRYPTION_PROVIDER` | `local` or `kms` |

Rotation is zero-downtime: add a new KEK, move the old one into
`ENCRYPTION_PREVIOUS_KEYS_JSON`, and re-wrap records in the background. Nothing
needs to be decrypted and re-encrypted synchronously.

For production, set `ENCRYPTION_PROVIDER=kms` so the KEK never exists in process
memory as raw bytes.

### Runtime credential sources (Part 16)

The engine resolves exchange keys through one of three sources, chosen by
`EXECUTION_CREDENTIAL_SOURCE`. None of them is a place a key may be written into
a file that is committed, and none of them is allowed to answer "permitted"
without a venue behind it:

| source | what it is | what refuses |
| --- | --- | --- |
| `none` (default) | a provider that declines every authenticated lookup | a paper process that turns out to need a key fails loudly instead of trading on nothing |
| `environment` | exactly two variables (`<PREFIX>_API_KEY` / `<PREFIX>_API_SECRET`) for exactly one tenant/account pair | boot when `NODE_ENV=production` - an environment cannot scope a secret per customer, is copied into every crash dump, and does not rotate |
| `secret-manager` | a `SecretFetcher` in front of the encrypted store - since Part 19 selectable by configuration as `EXECUTION_CREDENTIAL_FETCHER=vault-kv2` (`app/secret_fetcher.py`), or injected in code by the service that owns the store | boot without a fetcher at all: the API, a queue job and this endpoint's own request body are all refused as places a key provider could be installed, and naming a fetcher for a source that ignores it is refused as a deployment that believes it has plumbing it does not use |

Cached credentials live for `EXECUTION_CREDENTIAL_CACHE_SECONDS` (default 300)
and are dropped on expiry rather than served stale; `invalidate()` exists because
rotation and revocation must stop working promptly. The cache is not a security
window and is not described as one anywhere. Resolution results are never
returned by any endpoint, and `ExchangeCredentials.__str__`/`__repr__`/`__format__`
are overridden so a key cannot enter a log line, an exception message or a
debugger's repr by accident - the redaction helper is defence in depth, not the
control.

The Vault fetcher keeps the same property the environment provider was built
with: there is no settings field that could hold the token. `EXECUTION_VAULT_TOKEN_ENV`
names a variable and the value is read from `os.environ` inside the module that signs
the request, so `to_public_dict()`, `model_dump()` and `repr()` of the settings object
each have nothing to leak - which is a stronger guarantee than "the view omits it", and
is tested as the absence of the field (`test_the_token_has_no_field_it_could_be_stored_in`).
What the fetcher will not do is also part of the control: it refuses an `http://` address
and a `user:pass@host` authority even over TLS, refuses a tenant, account or exchange
identifier that is not one safe path segment BEFORE any request leaves the process (the
alternative - percent-encoding it - is what would let a traversal reach another tenant's
secret), bounds the response body before parsing it and quotes no body in any refusal, and
never renders the secret map it read. A path template is validated at boot rather than
interpreted at order time, because a typo like `{tenent}` would otherwise look up a path that
does not exist and report "no secret" for every tenant until somebody notices.

The operator confirmation (Part 19) is an authorisation record, not a credential: it holds no
key material, and it is safe to store in a configuration management system - but its `digest`
is only as strong as the HMAC key that made it, so the key is env-only under the same rule as
a venue key (`EXECUTION_CONFIRMATION_KEY_ENV`, default `EXECUTION_CONFIRMATION_HMAC_KEY`,
minimum 32 characters, never a settings field). The record's own bounds are what make it an
approval rather than a standing permission: a window no wider than 90 days, a `nonce` of at
least 16 characters so a superseded ceremony is distinguishable from the live one in the audit
trail, and a scope over tenant, account, instance, exchange, symbol and order type that the
per-order review re-derives rather than trusts - approving `BTCUSDT` never authorises `SOLUSDT`.
Verification is `hmac.compare_digest` over canonical JSON (sorted keys, both because a
signature needs the byte sequence to be reproducible and because a set does not have an order),
never `==`, so a record cannot be probed one byte at a time. An expired record refuses every
order without stopping the process, because the process is still the only path that can
safely cancel and reconcile; a *missing* key or an unparseable record is a boot failure,
because that is a deployment whose configuration is wrong rather than merely old.

The review that consumes those credentials answers a narrower question than
"are these bytes signed correctly": whether this key may place this order type on
this symbol in this trading phase right now, and - since Part 19 - whether a named
operator authorised this scope inside a window the deployment can verify. A key that
can withdraw is a refusal on any runtime, and a venue that cannot be asked is a refusal
on a runtime that could transmit (docs/PART16_PLACEMENT_REVIEW.md,
docs/PART19_LIVE_ENABLEMENT.md).

### Incident records

An incident is the platform's own account of a failure, so two rules apply to it
that are stricter than the ones for ordinary logs. Details are scrubbed before the
record exists (`ExecutionIncident.create`), because the instinct when writing an
incident is to attach the failing request, and the request is where a key lives.
And the sink is durable: `engine_incidents` is written over the same pool as the
order store, the write path never raises into execution (a lost record is counted
and published, never a stopped order), the read path never returns an empty list on
a failure it could not distinguish from health, and there is no `UPDATE` anywhere -
closing an incident means recording a new one, which is what makes the trail
non-re writable by construction rather than by policy (docs/PART17_DURABLE_INCIDENTS.md).

### Operational rules

* Keys come from the environment or a secrets manager. Never from source, never
  from the database.
* Different keys per environment. A staging leak must not affect production.
* Exchange keys should be created trade-only, with withdrawal permission
  disabled and IP-allowlisted to the platform's egress addresses.
* The confirmation HMAC key is a signing key for authorisations and is custody-graded
  as one: one per environment, injected as an environment variable, rotated by
  restarting with a fresh value (a key rotation and a record replacement are two acts,
  not one, because the record is parsed at boot and the key at verifier construction).
  A key rotation invalidates every record signed with the previous key, because
  verification recomputes the digest with the key the process currently holds: mint with
  the new key, publish the record, restart, in that order, or the deployment spends an
  interval refusing its own orders with `OPERATOR_CONFIRMATION_UNVERIFIED`. Verdicts
  already recorded stay auditable - they carry the record's fingerprint and codes, not a
  live dependency on the key - which is why the fingerprint is published and the digest
  is not (docs/PART19_LIVE_ENABLEMENT.md sec. 5 and sec. 7).

## 5. Transport and browser security

| Control | Where |
| --- | --- |
| Helmet security headers | `apps/api/src/main.ts` |
| HSTS, `X-Frame-Options: DENY`, `nosniff` | API + `apps/admin-web/next.config.mjs` |
| Content-Security-Policy with per-request nonce | `apps/admin-web/src/middleware.ts` |
| CORS allowlist | `CORS_ALLOWED_ORIGINS` |
| HTTPS enforced in mobile production builds | `apps/mobile/lib/core/config/app_config.dart` |

### CSRF

The API is token-authenticated and stateless, so it is not inherently
CSRF-exposed. The admin console is, because it keeps its session in cookies. It
therefore uses:

* `SameSite=Strict`, `httpOnly`, `Secure` session cookies.
* A double-submit token: a readable `wlct_csrf` cookie echoed in an
  `x-csrf-token` header, verified on every state-changing route
  (`apps/admin-web/src/app/api/proxy/[...path]/route.ts`).

Tokens are never placed in `localStorage`. An XSS bug in the console cannot
read an `httpOnly` cookie.

## 6. Input validation

* API: `class-validator` with a global `ValidationPipe`
  (`whitelist`, `forbidNonWhitelisted`, `transform`). Unknown properties are
  rejected, not ignored.
* Shared schemas: `packages/validation`.
* Python services: pydantic v2 models with `extra="forbid"`.
* Admin console: zod on every route-handler body.
* Money is `Decimal` end to end - `Decimal(18,6)` in the database, decimal
  strings on the wire, `Decimal` in Python. Never a float.

## 7. Rate limiting

Two buckets backed by Redis so limits hold across replicas:

* `default` for general traffic.
* `auth` for sign-in, registration, refresh and 2FA - the endpoints an attacker
  hits first.

The tracker keys on `user:{id}` when authenticated and `ip:{tenantId}:{ip}`
otherwise, so one noisy tenant cannot exhaust another's budget. Health endpoints
are exempt.

## 8. Audit logging

`AuditLog` is append-only and tenant-scoped. Every privileged action records the
actor, action, outcome, resource, a before/after diff, the request id, and a
**hashed** client IP - never a raw address.

`SecurityEvent` records authentication anomalies: new device, impossible travel,
token reuse, permission escalation attempts, lockouts.

## 9. Logging hygiene

Never logged, in any service:

* passwords, in any form
* access tokens, refresh tokens, challenge tokens, session cookies
* exchange API keys, secrets or passphrases
* encryption keys, data keys, blind-index keys
* payment credentials
* raw client IP addresses

Enforcement:

| Runtime | Mechanism |
| --- | --- |
| Node | pino redaction paths, extensible via `PINO_REDACT_PATHS`; the recursive `redact()` in `@wlct/utils` (keys AND credential-shaped values AND buffers) gates audit payloads and error bodies |
| Python | `wlct_trading.observability.redaction` - since Part 9, the ONE policy both services' `logging_config.py` filters delegate to (recursive dicts/lists/bytes, exception messages, bounded depth). The old per-service key-only regex filters are gone; a cross-language fixture pins the two languages to identical answers |
| Flutter | `AppLogger.redact`, applied at every nesting depth |

The Flutter mobile client disables network logging entirely outside development,
because a request log there would contain a bearer token on a user's device.

### Telemetry-side rules (Part 9)

Observability is a secret-leak surface like any other, so it inherits the same
policy at its own boundary, enforced by the label policy in
`wlct_trading/observability/labels.py` and mirrored in the API registry:

* **Identifier and secret label names are forbidden outright** (`order_id`,
  `request_id`, `correlation_id`, `tenant_id`, `api_key`, `token`, ...) -
  not discouraged; refused at registration. Label names are additionally
  allow-listed, so inventing a label is a code review event.
* **Label values must be bounded wire tokens**; symbols and other finite sets
  only against declared enumerated domains. Series caps make runaway
  cardinality a counted refusal, not an outage.
* **Health details and incident links are redacted/validated at the boundary**:
  component details pass through the redactor where every publisher shares one
  policy; incident records are (kind, targetId) references only - no payload
  can ride into the operations tables by accident.
* **Correlation ids are UUID-or-mint, everywhere** - the API middleware and
  the Python services both refuse unbounded inbound values, so log fields and
  audit columns cannot be injected through a header.
* **`/metrics` exposure**: unauthenticated only under network isolation;
  `METRICS_TOKEN` (constant-time compared) is mandatory in production on the API
  plane, and the exposition's production-off posture is a boot error, not a
  setting: `OBSERVABILITY_ENABLED`/`METRICS_ENABLED`/`HEALTH_ENABLED`/
  `PROMETHEUS_ENABLED`/`ALERTING_ENABLED` cannot be false in production. The three
  Python services (`services/trading-engine`, `services/market-data`,
  `services/execution-engine` since Part 18) share the `OBSERVABILITY_ENABLED`
  name, its default, and that refusal, and none of them requires the token: the
  guarantee that makes the exposition safe to leave unauthenticated is the
  cardinality law at registration - a metric sample here cannot carry a tenant,
  account, order or client-order id, so there is nothing on it to disclose and
  nothing for a token to buy beyond a delay. The token is therefore not this
  surface's control, and the internal network is; docs/PART18_METRICS_EXPOSITION.md
  sec. 7 states what would have to change (a new label) before the difference
  became a hole rather than a decision.
* **No metric sample is a financial record.** Panels report; the risk gate
  decides; nothing in the trading path imports the observability layer
  (boundary tests enforce the one-way dependency).

### Trace-side rules (Part 10)

W3C trace context is attacker-influenced input - every service treats it that
way, and the rules below are enforced by tests on both sides of the language
line:

* **Inbound `traceparent` is parsed-or-ignored, never trusted.** Malformed,
  version-mismatched, all-zero-id, or over-long headers simply do not join:
  the process starts its own root. A foreign trace id can never group
  spans from two unrelated requests, which is how a correlation surface
  becomes a privacy leak.
* **Trace ids are correlation handles, not credentials, and nothing more
  enters the wire.** Span attributes pass a closed-set sanitizer (`safe
  attribute` in both languages): key allow-regex, sensitive-name refusal
  (`api_key`, `authorization`, `password`, ...), value redaction through the
  same `redaction` policy the loggers use, length caps, and a ban on the
  forbidden label names from the metric policy. Header values that must
  travel (the traceparent itself) are re-canonicalised, never echoed raw.
* **Spans carry no payloads.** The queue hop continues traces through a
  Redis **sidecar** keyed by queue+jobId holding only the 55-char traceparent
  - never inside the job payload - so span-graph joins exist without any
  payload ever being copied into telemetry. Writes are fire-and-forget with a
  TTL; a failed sidecar can neither fail nor alter a publish.
* **Fault injection is a boot-time, non-production, closed-set configuration**
  (`FAILURE_INJECTION_ENABLED`, refused by the env validators of both
  runtimes in production). The only runtime operation anywhere is `consume`
  at instrumented points; there is no arm/disarm route, no admin control, and
  the armed plan is reported read-only. The metrics-scrape fault sits AFTER
  token authentication so injection state is not probeable.
* **The trading path never reads telemetry.** `consumeFault` exists in exactly
  two production files (the tracing service and the scrape endpoint); the
  engine's evaluate router must not contain the tokens `injector`,
  `tracer.`, `should_sample` or `sampler` (statically tested); risk decisions
  are computed before any hub is touched and the except-path records a sample
  then re-raises untouched. Sampling changes only what is RECORDED, never
  what is ANSWERED - an unsampled request still gets its `x-trace-id`.
* **SLO evidence is append-only and pruning is bounded.** `SloConfigurationVersion`
  rows are immutable (the only "update" appends version N+1); evaluations and
  sample buckets expire no faster than 7 days regardless of configuration;
  deleting history is not an API surface on any plane.

## 10. Internal service authentication

The Python services are not public. Every route requires:

| Header | Meaning |
| --- | --- |
| `x-internal-token` | equals `INTERNAL_SERVICE_TOKEN`, minimum 32 chars, compared with `hmac.compare_digest` |
| `x-tenant-id` | the tenant the call acts for; the body must agree or the call is rejected |
| `x-request-id` | optional, propagates the API's correlation id |

Comparison is constant-time. A token that is a known placeholder is rejected at
startup rather than accepted quietly.

## 11. Execution safety

Four independent gates prevent Part 1 from placing an order:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine has no order-placement route.
3. `RiskDecision.wouldExecute = approved AND EXECUTION_ENABLED`.
4. The execution engine refuses to start in live mode with no placement reviewer
   wired, and refuses each order whose review is not an unambiguous venue permit
   (Part 16, gate `PLACEMENT_ATTESTED`) or that a required operator confirmation
   does not cover (Part 19, `OPERATOR_CONFIRMATION_*`). There
   is no configuration that removes control 4, because a switch that lets a
   deployment trade without asking the venue whether the key may trade is the same
   as no review - which is why the confirmation is a signed, scoped, expiring record
   and not an `ALLOW_LIVE` boolean: a boolean is the same kind of object as the
   switch this control exists to make impossible.

`EXCHANGE_SANDBOX_MODE=true` additionally disables venues that offer no sandbox.

## 12. Dependency and container posture

* Pinned base images (`node:20.11.0-bookworm-slim`, `python:3.11-slim-bookworm`,
  `postgres:16.4-alpine`, `redis:7.4-alpine`).
* Multi-stage builds; runtime images contain no compiler, no source, no `.env`.
* Every container runs as a non-root user.
* Postgres and Redis publish to `127.0.0.1` only.
* Redis requires a password and uses `volatile-lru`, so queue jobs and sessions
  are never silently evicted.

## 13. Incident response starting points

| Situation | First action |
| --- | --- |
| Suspected token theft | Bump `User.sessionVersion` to invalidate every session for that user |
| Suspected KEK exposure | Rotate `ENCRYPTION_MASTER_KEY_BASE64`, move the old key to `ENCRYPTION_PREVIOUS_KEYS_JSON`, re-wrap in the background |
| Tenant compromise | Set the tenant to `SUSPENDED`; this mass-revokes its sessions |
| Exchange key exposure | Revoke at the exchange first, then delete the record |
| Panel says "healthy" but reality disagrees | Check the publisher mirrors first (`GET /health/components` per service, the fold's `mirrorPresent` in the sync log, and `wlct_registry_series_overflow_total`); absence of alerts means *no publisher reported*, never "all clear" |
| Metrics exposition exposed too widely | Rotate `METRICS_TOKEN`, restrict the listener; the payload itself is label-policy-guarded, so assume no leak of identifiers/secrets until proven otherwise - but treat scraping clients as known callers |

## 14. Worker plane (Part 11)

* The worker (`src/worker.ts`) serves no HTTP at all - not "no public
  routes", no listener exists. Its only egress is one internal service.
* The worker-to-engine secret (`EXECUTION_INTERNAL_TOKEN` /
  `EXECUTION_ENGINE_TOKEN`) is a deployment secret, min 32 chars,
  placeholder-prefixed values refused at both boots, constant-time compared,
  carried ONLY in a header - the engine's client never puts it in a body,
  and its own error surfaces never echo payloads (422 names fields, 500s
  carry correlation ids).
* The execution engine accepts no tenantless command (tenant header
  required), rejects body/header tenant divergence with 403, and its
  simulated answers are labelled as such at every surface. One route is not a
  command, and Part 20 wrote that distinction down instead of leaving it implied:
  `GET /internal/v1/status` answers with this process's own wiring and acts on no
  tenant, so it depends on `require_internal_auth_readonly`. The token is still
  required (401 without it, and the check runs first, so a stranger cannot reach the
  tenant branch); a tenant header that IS sent is still validated (400 on a bad one,
  because an exemption from presence is not an exemption from sanity); the command
  scope's refusal text is unchanged to the byte, because the worker matches on it; and
  a test walks the application's route table to hold the read scope to that one
  route, since the way a scoping exemption rots is by becoming convenient. The
  exemption cannot disclose anything that was hidden: `GET /health/ready` publishes a
  superset of those keys to an unauthenticated caller, and that superset relation is
  itself a test, so narrowing readiness without re-arguing the exemption fails CI.
* `EXECUTION_MODE=live` is refused at the engine's startup by code: the
  queue, the worker, or any API route cannot talk the process into venue
  transmission. Part 16 wired the credential source and the review and Part 19
  closed the per-tenant key custody half of the open list with the Vault fetcher, so
  the remaining items are computed at boot from the wiring the process built rather
  than asserted in a document: `VENUE_ATTESTOR_WIRED` and `SIGNED_TRANSPORT_WIRED`
  (one absence seen twice - the gatherer is built over the live adapter this
  composition root never constructs), `DISTRIBUTED_LOCKS_WIRED` (the core ships a
  Redis lock manager; `app/composition.py:338` does not select it), and
  `DURABLE_STORE_WIRED`, whose store shipped in Part 13 (docs/PART13_DURABLE_STORE.md)
  and is selected by `EXECUTION_STORE_BACKEND=postgres`. They stay enforced, not
  configurable away, and `liveRefused` is `true` in the report of every build this
  repository ships (docs/PART19_LIVE_ENABLEMENT.md sec. 7 and sec. 8). The placement route is internal-plane only like the rest:
  token, tenant-header-matched, absent from the worker's forwarding path list,
  and its response model has no field a credential could occupy (a test holds
  that, so the day a secret-bearing view is added the suite says so).
* The ops view (`GET /v1/observability/worker-coordination`) reads claim
  state written by workers and writes nothing; an expired claim is reported
  as absence, never as a dead worker.
* The execution engine's own posture reaches the same panel the same way (Part 20,
  `GET /v1/observability/execution` -> `ENGINE POSTURE`): one process reads
  `/internal/v1/status` through the worker's client and renders what the engine says about
  itself. Three properties are held by tests rather than asserted here. No credential
  material crosses the surface - the section's rendered JSON is scanned for secret shapes
  and for the correlation `fingerprint` the status document does carry, so a row that
  dumps a sub-document whole fails the suite; a missing answer renders `unverified`,
  never `ok`, because an absent engine is not a healthy one; and the read cannot become a
  control, since the only fields it consults for tone are the engine's own claims about its
  wiring. Nothing on this path writes, and nothing on it can enable live mode: the
  `EXECUTION_MODE=live` refusal above is unchanged by this part, as is the fact that no
  order leaves the process.
* `docs/dr/schedule/dr.cron` is generated from `docs/dr/manifest.json` by
  `--emit-schedule` and verified by `--check-schedule`. It schedules the three read-only
  modes (`--due`, `--check`, `--check-rls`) and cannot schedule the ledger's two write
  modes: a job that records an outcome nobody observed is faked seed data, and the drift
  gate refuses a hand-added `--record` line on its own terms rather than as a byte
  mismatch. The emitted file also avoids the `NAME=long-literal` shape the repository's
  secret scanner keys on, by naming its one free variable in lower case - the scanner is
  not narrowed for the artifact's convenience (docs/PART20_ENGINE_STATUS_EDGE.md sec. 6).

## 15. Known gaps for later parts

* Row-level security: policies and the GUC plumbing ship in Part 11, **dormant
  by design** - enablement is the checklist-gated `apps/api/prisma/rls/enable.sql`
  DBA step, verified by the probes in docs/DR.md; coverage is generated from
  the schema and spec-pinned so no tenant table can silently lack a policy.
* No automated dependency scanning in CI.
* No WAF or bot management in front of the API.
* No hardware-backed key storage; `ENCRYPTION_PROVIDER=kms` is the hook.
* Backups: the contract (manifest, validator, dry-run planner, drill record)
  ships in Part 11; Part 12 adds the freshness ledger (per-component cadence
  or explicit waiver, `--due`'s alertable exit code, `--record` with a
  note-level secret scan that JSON escaping cannot launder) - but the
  *scheduler* that runs them on a timer is still deployment-side wiring, so
  backups today are operator processes against a validated, checkable plan,
  not an unverified cron.
* Worker membership registry (Part 12): the heartbeat zset is
  deployment-scoped state, deliberately NOT tenant-scoped (fleet topology
  is operator-visible by necessity); it carries only worker-id tokens, and
  the registry can never grant authority - claims remain the sole gate, so
  a poisoned or forged membership entry buys an attacker deferral of
  nothing and access to nothing.
* The execution engine's default store is process-local (durability
  `false` is REPORTED, not hidden). The Part 13 durable backend
  (`EXECUTION_STORE_BACKEND=postgres`) persists orders, the event journal
  and the fill ledger in the `engine_*` tables under the same tenant law
  as everything else: every store transaction sets `app.tenant_id` first,
  the tables carry `tenant_id UUID` + the generated row-level-security
  policies, and configuration mismatches (postgres without a DSN, a DSN
  with memory, missing tables) are STARTUP refusals - an engine never
  claims durability it does not have.
* Retention (Part 14) is the only deletion path on the engine plane and
  it is triply narrow: the event journal is the ONLY table any engine
  statement deletes from (a test scans the whole service to hold that
  line - orders, the fill ledger, and the run ledger are not deletable by
  ANY configuration), apply mode is dark until `EXECUTION_RETENTION_ENAB-
  LED=true` restarts the process, and every run - including refused-state
  rehearsals and zero-row runs - leaves a row in `engine_retention_runs`,
  under the same RLS law as its subjects. The route is internal-token and
  tenant-header-matched like the commands, is proxied by nothing public,
  and refuses cross-tenant form by construction (one `--tenant` per call,
  enforced by the same canonical-UUID guard the store writes under).
* Row-level security is a CLAIM, not a state (Part 15,
  docs/PART15_RLS_ENABLEMENT.md): the platform may say policies are enabled
  and enforcing only while a PASSING enablement audit is younger than
  `rlsEvidence.cadenceHours` in the DR manifest. The audit is six `SELECT`s
  and one `SET TRANSACTION READ ONLY` - no seeding, no writes, no
  enable/disable capability anywhere in the verifying code - run inside the
  same tenant-GUC transaction the money path uses, with the leak check
  deliberately performed OUTSIDE it (a bare count taken inside the GUC would
  be the scoped count by construction and could not report a leak). A role
  holding `BYPASSRLS` or superuser fails the whole run whatever the counts
  say; a run that skipped or missed a covered table grades `unverified`,
  which is a third answer and never a shade of green. The route answers 200
  with a FAIL finding rather than 500 (the audit ran; its answer is the
  evidence), refuses with 409/400/503 when there is no durable store, the
  request is out of scope, or `pg_roles` cannot say which role it audited,
  and it is internal-plane only: token, tenant-header-matched, and absent
  from the worker's forwarding path list, which is the public plane's reach.
  What it verifies is the engine plane's five tables; the platform's other
  covered tables (Part 17's `engine_incidents` among them: an unprotected incident
  table is a cross-tenant readable list of one tenant's failures, which is exactly
  the leak shape this audit hunts) stay with `enable.sql`'s checklist, and the manifest's
  `rlsEvidence.scope` says so in words the validator refuses to let anyone
  overclaim. The record of each run is one append-only line in
  `docs/dr/rls-evidence.jsonl` (secret-scanned, refusal-on-corruption like
  the backup ledger), and a RECENT failing audit outranks a stale passing
  one: fixing the alarm means fixing the isolation.
* The placement review (Part 16, docs/PART16_PLACEMENT_REVIEW.md) is the venue-side
  half of "may this order exist", and it is deliberately unable to permit anything:
  the policy object holds durations and bounds only - attestation age, key age,
  clock skew, the receive window, the IP-allowlist requirement - and has no field
  that grants a permission, because a knob that lets a deployment trade without
  asking the venue is the same as no review. Absence outranks evidence: no
  attestation is `NO_ATTESTATION`, a venue that says no is a different code, and a
  gatherer that could not answer is never reported as a permission. Severity is
  what refuses, so a runtime that CAN transmit raises an evidence-absence warning
  to a refusal, and a runtime that cannot records the same finding as `INFO` - the
  mode is part of the verdict digest, so a paper verdict can never be presented as
  authority for a live order. What is still open is custody, not the check: the
  environment source is refused in production, `secret-manager` needs a fetcher
  injected in code, and no HTTP surface of the engine may install one - so
  per-tenant key custody, a venue attestor instance, a signed transport with the
  egress addresses allow-listed at the venue, and Part 13's durable store are the
  four things standing between this build and live transmission.

## 16. Operational tooling that touches nothing (Part 21)

Three scripts (`scripts/dr-schedule-install.mjs`, `scripts/dr-rehearsal.mjs`) and two core modules
(`wlct_trading/observability/chaos.py`, `red.py`) exist to answer operational questions. They are
documented here because "it only reports" is the claim every tool that can reach something makes, so
the boundary is stated as rules instead:

* **No new secret surface.** Nothing in Part 21 reads a credential value. The rehearsal runner checks
  that environment *names* referenced by the DR manifest exist in a `.env.example` template and,
  separately, whether they are set in its own process - and records only the name, never the value,
  never a length. It forwards `DATABASE_URL` and `ENGINE_INTERNAL_TOKEN` to a probe by name, from
  its own environment, exactly as the service does; the values appear in no artifact it writes, and
  probe output is stored as a SHA-256 digest rather than as text.
* **The evidence artifacts scan themselves.** Before a rehearsal record is appended it is run through
  the manifest's own `findSecretShapes`, and a hit is a refusal to write (exit 3), not a redaction. A
  tool that silently redacted would eventually be trusted with notes it should not accept.
* **Commands are an argv allowlist, never a shell.** Both scripts spawn with argument arrays, no
  shell, a per-call timeout, and a hard-coded allowlist: `crontab` for the installer, and the four
  named probes for the rehearsal runner. There is no configuration field, flag, or manifest key that
  becomes a command line - a rehearsal tool that accepted a command from a JSON file would be a
  remote-execution tool with a clipboard. Tests assert this on the source text (one `spawn`/`spawnSync`
  call site each, no `exec`, no `shell: true`) because a property like this is only worth what the
  check that enforces it is worth.
* **Paths are validated to stay inside the repository.** The `paths` a manifest component declares
  are resolved under the repo root and refused on traversal, as is every `--schedule`/`--manifest`/
  `--out` override. A malformed path is a `FAIL` finding in the record, not an attempt.
* **Production is refused, and ambiguity is refused.** The rehearsal runner refuses `--target
  production`/`prod` and any target it cannot prove non-production (a closed set: `local`, `dev`,
  `test`, `ci`, `staging`), refuses to run under `NODE_ENV=production` whatever `--target` says, and
  requires `--confirm <rehearsalId>` - the hash of the plan being approved - for `--execute`. The
  chaos matrix refuses `production` and any environment name outside its closed set before reading a
  probe, and its probes can only read the injector's state: the injector has no arm method, is
  constructed from validated configuration, and production boot refuses `enabled=True` (Part 10).
* **Grades are not opinions.** `pass`, `fail`, `unverified`, `planned` and `skipped` are the whole
  vocabulary in these tools. `unverified` is required whenever the thing being checked is
  unreachable - no cron facility, no database, no worker process - and a rehearsal ledger refuses to
  parse a dry run recorded as `pass`. The point of the distinction is that a red cell in a recovery
  plan is information and a green cell that was not earned is an outage waiting to be scheduled.
* **The trading path does not know any of this exists.** No money-path module imports the matrix, the
  RED view, the status document or a rehearsal record; a test walks the tree and asserts it. The
  schedule installer writes nothing but a marked block in a user crontab and preserves every
  unmanaged entry byte for byte, so a DR check cannot become the cause of the outage it exists to
  detect.
