# API reference

Base URL: `http://localhost:4000/api`
Versioned prefix: `/api/v1`
Interactive docs: `/docs` (only when `SWAGGER_ENABLED=true`; basic-auth gated
outside development, and 404 when the credentials are unset).

Health endpoints sit outside the versioned prefix: `/health`, `/health/ready`,
`/health/deep`, `/health/startup`, `/health/trading`. The Prometheus scrape
endpoint `/metrics` is likewise unversioned; see Operations and health below.

## Conventions

### Request headers

| Header | When | Purpose |
| --- | --- | --- |
| `authorization: Bearer <token>` | authenticated routes | access token |
| `x-tenant-slug` | unauthenticated routes | resolves the organisation; ignored once authenticated |
| `x-request-id` | optional | correlation id, echoed back and propagated to internal services |
| `two-factor-token` | 2FA-protected mutations | step-up confirmation |

### Success envelope

```json
{ "success": true, "data": { } }
```

Paginated:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1, "limit": 25, "totalItems": 0,
      "totalPages": 0, "hasNextPage": false, "hasPreviousPage": false
    }
  }
}
```

### Error envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the highlighted fields.",
    "details": [{ "field": "email", "message": "Must be a valid email address" }],
    "requestId": "3f1c9a2e-...",
    "timestamp": "2026-09-05T10:00:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```

`details` is present only for validation failures. Stack traces are never
included in any environment's response body.

### Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | request body or query failed validation |
| `UNAUTHORIZED` | 401 | missing or invalid credentials |
| `INVALID_CREDENTIALS` | 401 | wrong email or password |
| `TOKEN_EXPIRED` | 401 | access token expired - refresh |
| `TOKEN_INVALID` | 401 | malformed, revoked or blacklisted token |
| `TWO_FACTOR_REQUIRED` | 401 | complete the challenge |
| `FORBIDDEN` | 403 | authenticated but not permitted |
| `INSUFFICIENT_PERMISSIONS` | 403 | missing a specific permission |
| `FEATURE_DISABLED` | 403 | the feature flag is off for this organisation |
| `NOT_FOUND` | 404 | no such resource in this tenant |
| `TENANT_NOT_FOUND` | 404 | the organisation could not be resolved |
| `CONFLICT` / `ALREADY_EXISTS` | 409 | uniqueness or state conflict |
| `ACCOUNT_LOCKED` | 423 | too many failed sign-ins |
| `RATE_LIMIT_EXCEEDED` | 429 | throttled; see `Retry-After` |
| `INTERNAL_SERVER_ERROR` | 500 | unexpected failure; quote the `requestId` |
| `SERVICE_UNAVAILABLE` | 503 | a dependency is down |

## Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/v1/auth/register` | public | creates an account in the resolved tenant, assigns `FOLLOWER` |
| POST | `/v1/auth/login` | public | returns a session **or** a 2FA challenge |
| POST | `/v1/auth/two-factor/verify` | public | completes a challenge |
| POST | `/v1/auth/refresh` | public | rotates the token pair |
| POST | `/v1/auth/logout` | bearer | `{ allDevices }`; blacklists the access token |
| GET | `/v1/auth/me` | bearer | current user with roles and permissions |
| POST | `/v1/auth/change-password` | bearer | revokes every other session |

### `POST /v1/auth/login`

```json
{
  "email": "admin@acme-capital.test",
  "password": "…",
  "deviceId": "web-9f3c…",
  "deviceName": "Admin console",
  "platform": "web"
}
```

Success:

```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "…", "refreshToken": "…",
      "tokenType": "Bearer", "expiresIn": 900, "refreshExpiresIn": 2592000
    },
    "user": { },
    "sessionId": "…"
  }
}
```

2FA required:

```json
{
  "success": true,
  "data": {
    "twoFactorRequired": true,
    "challengeToken": "…",
    "expiresIn": 300,
    "methods": ["TOTP", "RECOVERY_CODE"]
  }
}
```

`deviceId` is mandatory. Refresh tokens are bound to it, which is what makes a
stolen refresh token useless from another device.

### Refresh semantics

Every refresh rotates the token. Presenting a token that has already been used
revokes the entire family, terminates every session for that user and raises a
`CRITICAL` `TOKEN_REUSE` security event. Clients must therefore serialise
refreshes - the mobile client does this with a single completer, and the admin
console does it server-side.

## Two-factor authentication

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/v1/auth/two-factor/setup` | authenticated |
| POST | `/v1/auth/two-factor/enable` | authenticated |
| POST | `/v1/auth/two-factor/disable` | authenticated |

Setup returns an `otpauth://` URL and a QR-code data URL. The secret is
encrypted at rest and is never returned again.

## Sessions

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/auth/sessions` | list active devices |
| DELETE | `/v1/auth/sessions/:id` | revoke one device |

## Users

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/v1/users/me` | authenticated |
| PATCH | `/v1/users/me` | authenticated |
| GET | `/v1/users` | `user:read` |
| GET | `/v1/users/:id` | `user:read` |
| POST | `/v1/users` | `user:manage` |
| PATCH | `/v1/users/:id` | `user:manage` |
| POST | `/v1/users/:id/suspend` | `user:manage` |
| POST | `/v1/users/:id/reinstate` | `user:manage` |
| POST | `/v1/users/:id/roles` | `user:assign_role` |
| DELETE | `/v1/users/:id` | `user:manage` (soft delete) |

Every route is tenant-scoped automatically. There is no `tenantId` parameter to
pass, and passing one would not change the scope.

## Organisations

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/v1/tenants/public-config` | public - branding for the sign-in screen |
| GET | `/v1/tenants/current` | `tenant:read` |
| PATCH | `/v1/tenants/current` | `tenant:manage` |
| GET | `/v1/tenants/current/branding` | `tenant:read` |
| PATCH | `/v1/tenants/current/branding` | `tenant:manage` |
| GET | `/v1/tenants/current/settings` | `tenant:read` |
| POST | `/v1/tenants/current/settings` | `tenant:manage` |
| DELETE | `/v1/tenants/current/settings/:key` | `tenant:manage` |
| POST | `/v1/tenants/current/domains` | `tenant:manage` |
| DELETE | `/v1/tenants/current/domains/:domainId` | `tenant:manage` |
| GET | `/v1/tenants` | platform only |
| POST | `/v1/tenants` | platform only |
| GET | `/v1/tenants/:id` | platform only |

Settings marked secret are encrypted at rest and read back as
`{ "configured": true }`. The value cannot be retrieved through the API.

## Roles and permissions

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/v1/roles` | `role:read` |
| GET | `/v1/roles/:id` | `role:read` |
| POST | `/v1/roles` | `role:manage` |
| PATCH | `/v1/roles/:id` | `role:manage` |
| DELETE | `/v1/roles/:id` | `role:manage` |
| GET | `/v1/permissions` | `permission:read` |

System roles are immutable templates and cannot be edited or deleted; each
tenant edits its own clone.

## Billing

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/v1/billing/plans` | `billing:read` |
| GET | `/v1/billing/plans/:id` | `billing:read` |
| POST | `/v1/billing/plans` | `billing:manage` |
| PATCH | `/v1/billing/plans/:id` | `billing:manage` |
| DELETE | `/v1/billing/plans/:id` | `billing:manage` (archive) |
| GET | `/v1/billing/subscription` | `billing:read` |
| GET | `/v1/billing/subscription/limits` | `billing:read` |
| POST | `/v1/billing/subscription` | `billing:manage` |
| POST | `/v1/billing/subscription/change-plan` | `billing:manage` |
| POST | `/v1/billing/subscription/cancel` | `billing:manage` |

Prices are decimal **strings** (`"149.000000"`). Never parse them into a float.
No card data is accepted or stored anywhere in the platform.

## Feature flags

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/v1/feature-flags/resolved` | authenticated - `{ "key": true }` map |
| GET | `/v1/feature-flags` | `tenant:read` |
| PATCH | `/v1/feature-flags/:key` | `tenant:manage` |
| GET | `/v1/feature-flags/definitions` | platform only |
| POST | `/v1/feature-flags/definitions` | platform only |

## Audit and security

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/v1/audit-logs` | `audit:read` |
| GET | `/v1/security/events` | `security:read` |

Client IPs are stored as keyed hashes, never in the clear.

## Notifications

| Method | Path |
| --- | --- |
| GET | `/v1/notifications` |
| GET | `/v1/notifications/unread-count` |
| PATCH | `/v1/notifications/:id/read` |
| POST | `/v1/notifications/read-all` |
| GET | `/v1/notifications/preferences` |
| PATCH | `/v1/notifications/preferences` |

## Health

| Path | Checks | Failure |
| --- | --- | --- |
| `/health` | process is alive | never fails while the process runs |
| `/health/ready` | Postgres, Redis | 503 |
| `/health/deep` | + queue depth, trading-engine, market-data, notification-service | 503 |
| `/health/startup` | boot completed | 503 until ready |
| `/health/trading` | the merged nine-gate trading-readiness verdict (Part 9) | always 200; the verdict lives in the body - see below |

All are public and exempt from throttling. `/health/trading` answers 200 even
when reporting NOT ready, deliberately: an operations endpoint that 503s for
honestly reporting a blocked trading plane invites an orchestrator to kill the
messenger during exactly the outage it is describing. It reports; the risk
gate decides.

## Operations and alerts (Part 9)

Reads require `operations:read`; mutations require `operations:alerts_update`
(a non-wildcard permission) and are audited immediately.

| Route | Purpose |
| --- | --- |
| `GET /v1/observability/overview` | the panel document: status, mirrors, queues, alert counts |
| `GET /v1/observability/trading-readiness` | the merged gate table with per-gate source (same evaluation as `/health/trading`, console-wrapped) |
| `GET /v1/observability/market-data` / `risk` / `execution` / `queues` / `datasets` | the section panels, each derived from mirrors and bounded aggregates |
| `GET /v1/observability/alerts` / `alerts/:id` | the deduplicated alert table (folded by `rule|component|scope`, storm-safe by construction) |
| `POST /v1/observability/alerts/:id/acknowledge` | `OPEN -> ACKNOWLEDGED` with a >=5-char reason; acknowledges nothing about trading state |
| `POST /v1/observability/alerts/:id/force-resolve` | close WITHOUT observed recovery: typed phrase `FORCE RESOLVE ALERT` + >=20-char reason, immediate audit row |
| `GET /v1/observability/incidents` / `incidents/:id` | correlated operational stories; links only, never payload copies |
| `POST /v1/observability/incidents/:id/status` | `OPEN -> REVIEWING -> CLOSED`; closing requires a note |
| `GET /metrics` (unversioned) | Prometheus 0.0.4 exposition of the API process |

`GET /metrics` posture: open only where the network isolates it (the shipped
compose publishes no metrics port); with `METRICS_TOKEN` set - mandatory in
production - scrapers present `x-metrics-token`, compared constant-time. The
payload is policy-guarded at the source (allow-listed labels, forbidden
identifier names, wire-token values, bounded series cap) so there is no
tenant row, credential, order id or request id in it, ever.

There is deliberately NO operations route that disables observability at
runtime, releases a kill switch, approves or replays an order, or writes a
metric. Alert acknowledgement is not an authorisation, and the panel's own
note fields say so in as many words.

## Service objectives, tracing, fault posture (Part 10)

All routes are under `/v1/operational`, all require `operations:read` except
the config publish, which requires the explicit non-wildcard
`operations:slo:update` (`OPERATIONS_SLO_UPDATE`); both mutating families are
audited immediately.

| Route | Purpose |
| --- | --- |
| `GET /v1/operational/slos` | every objective: latest version + latest evaluation (`includeDisabled` keeps disabled rows visible - switching measurement off is not deleting evidence) |
| `GET /v1/operational/slos/readiness` | the rollup: state counts, worst remaining budget (the floor, not the average), max long burn, paging ids, unmeasured ids |
| `GET /v1/operational/slos/:sloId` | one objective's current status view |
| `GET /v1/operational/slos/:sloId/versions` | the append-only definition history, payload and checksum included |
| `GET /v1/operational/slos/:sloId/evaluations` | evaluation rows, newest first; null ppm means "undefined for the window", never zero |
| `POST /v1/operational/slos/:sloId/config` | publish a NEW version (audited `SLO_CONFIG_UPDATED`, before/after field deltas); identical definitions no-op without a phantom version |
| `POST /v1/operational/slos/:sloId/evaluate` | evaluate one objective now - the scheduled tick's code path (audited as a request to measure) |
| `POST /v1/operational/slos/evaluate-all` | evaluate every enabled objective; returns `{evaluated, alertingSloIds, skipped[]}` |
| `GET /v1/operational/tracing` | this process's telemetry posture (enabled, endpoint configured-or-not - never the URL, ratio, priority ops, buffered/exported/dropped totals, export streak) |
| `POST /v1/operational/tracing/flush` | run one export tick now; changes WHEN evidence leaves, never what it says; one batch, one attempt, like the loop |
| `GET /v1/operational/faults` | the config-armed fault plan: `{enabled, production, activePoints[]}` - read-only description; **there is no arm/disarm/consume route anywhere** |
| `GET /v1/operational/traces/current` | the CURRENT request's traceparent/traceId/spanId for "copy trace id"; no trace search, no trace store, no retention promise |

Objective semantics an API consumer must not misread: `objective` is a decimal
PERCENT STRING (`"99.5"`), because floats that have passed through IEEE-754
are not the promise anyone configured; all ppm values are integers, all
microseconds are integer strings; `dataComplete: false` means the evaluator
saw too few collector ticks to certify the window and the row says so -
compliance computed over incomplete evidence renders as UNKNOWN, not as a
percentage. Burn-rate alerting pages only on the AND (short-window fast burn
AND long-window slow burn); budget exhaustion pages on its own.

There is deliberately NO route to edit or delete a stored version, purge
evaluations below the retention floor, arm fault injection, resolve an SLO
alert by hand (burn alerts auto-resolve when the windows no longer page), or
make any of these numbers authorise a trade.

## Rate limits

| Bucket | Applies to | Limit |
| --- | --- | --- |
| `auth` | login, register, refresh, 2FA | 5-30 per 5 minutes depending on the route |
| `default` | everything else | `THROTTLE_LIMIT` per `THROTTLE_TTL` |

Keyed on `user:{id}` when authenticated, otherwise `ip:{tenantId}:{ip}`. A 429
carries `Retry-After`.

## Realtime

Socket.IO, namespace `/realtime`, path `/socket.io`.

```js
const socket = io('http://localhost:4000/realtime', {
  auth: { token: accessToken },       // handshake only, never a query string
  transports: ['websocket'],
});
```

Rooms are assigned server-side from the authenticated identity. A client cannot
request one.

## Internal services

`trading-engine` (8001) and `market-data` (8002) are not publicly routable.

| Header | Requirement |
| --- | --- |
| `x-internal-token` | equals `INTERNAL_SERVICE_TOKEN`, minimum 32 characters |
| `x-tenant-id` | required; the request body must agree |
| `x-request-id` | optional correlation id |

| Service | Route | Purpose |
| --- | --- | --- |
| trading-engine | `GET /health`, `GET /health/ready` | probes |
| trading-engine | `GET /v1/engine/status` | capability and configuration |
| trading-engine | `POST /v1/engine/risk/evaluate` | pre-trade risk check; evaluates only, never places an order |
| market-data | `GET /health`, `GET /health/ready` | probes |
| market-data | `GET /v1/market/symbols` | tracked universe |
| market-data | `GET /v1/market/quotes` | cached quotes |
| market-data | `GET /v1/market/quotes/{symbol}` | one cached quote |

`RiskDecision.wouldExecute` is `approved AND EXECUTION_ENABLED`. In Part 1
`EXECUTION_ENABLED` is `false`, so it is always `false`.
