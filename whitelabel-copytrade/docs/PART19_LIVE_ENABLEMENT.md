# Part 19 — Live enablement: credentials, attestation grading, and the operator confirmation

Scope: the layer between "the review exists" (Part 16) and "the review can be trusted by a
human who is about to point it at real money". Audit first, then the pieces the audit found
genuinely missing — a concrete credential fetcher, a typed operator confirmation, the axis
that lets either be counted, and a report that states what live still lacks.

Ship state: **`EXECUTION_MODE=live` is still refused at startup, by code.** Nothing here
changes that, and §8 explains why the parts added here cannot.

Source of truth for every claim below: `libs/trading-core/wlct_trading/execution/`
(`credentials.py`, `live_confirmation.py`, `live_enablement.py`, `placement_review.py`,
`placement_attestor.py`, `config.py`, `locks.py`), `services/execution-engine/app/`
(`config.py`, `credentials.py`, `secret_fetcher.py`, `placement.py`, `composition.py`,
`schemas.py`, `logging_config.py`, `observability.py`) and the Part 19 tests
(`libs/trading-core/tests/test_part19_*.py`, `services/execution-engine/tests/test_part19_*.py`).

---

## 1. What changed, and what was already there

The Part 19 brief named thirteen items. Eight were already shipped: provider selection with a
fail-closed default (13), permission attestation with typed per-check reasons (16), symbol
review through the existing normalisation (16), account-capability review (16), key-rotation
review (16), the per-order verdict with correlation ids (16), order-scoped review (16), and
signal routing (18). Those are covered by tests and cross-links here, not by new code.

The gaps were four, plus one documentation gap:

| Gap | What was added | Where |
| --- | --- | --- |
| `SecretFetcher` was an interface with no implementation, so `EXECUTION_CREDENTIAL_SOURCE=secret-manager` could only refuse to start | A Vault KV v2 fetcher: HTTPS-only, no embedded credentials, path-template and identifier validation before any request, bounded responses, and a decoded shape carrying exactly what the provider needs | `app/secret_fetcher.py` |
| The gate had no typed, scoped, expiring human decision in it | `LiveOperatorConfirmation` (HMAC over canonical JSON), `ConfirmationVerifier`, the review's `CONFIRMATION` findings, and the service wiring that builds and reports both | `execution/live_confirmation.py`, `placement_review.py`, `placement_attestor.py`, `app/placement.py`, `app/config.py` |
| No way to count or rank *which part* of enablement is unhealthy — only individual codes | The `ReviewArea` axis, `blocking_areas` / `area_counts` on the verdict, seven derived counters | `placement_review.py`, `wlct_trading/metrics.py`, `execution/engine.py` |
| No way to state what live is missing without re-listing it in prose | `evaluate_live_enablement`: derived from the wiring the process actually built, with prose for humans and codes for machines | `execution/live_enablement.py`, `app/composition.py` |
| The enablement list lived as one paragraph of prose in the Part 16 document | This document is the live statement; §8 says what the old paragraph is now for | here |

One item was deliberately **not** built: no `ALLOW_LIVE` flag, no override, no bypass window.
Item 6 asked for a confirmation that is typed, contextual, scoped and expiring precisely so
that it is not a boolean, and the startup refusal was specified as the invariant to narrow and
never remove.

## 2. The two vocabularies, and why there are exactly two

**Prerequisites** answer "what must exist before this deployment can be trusted live". They
live in `live_enablement.py` as `LivePrerequisite`, and are graded by the composition root
from the objects it just built — never from a settings dump:

| Prerequisite | How it is graded (`app/composition.py:436` onward) |
| --- | --- |
| `CREDENTIAL_SOURCE_CONFIGURED` | `EXECUTION_CREDENTIAL_SOURCE.strip()` is not `none` |
| `CREDENTIAL_FETCHER_WIRED` | that source is `secret-manager` **and** a `SecretFetcher` is in the provider chain (`CredentialWiring.fetcher_source is not None`) |
| `VENUE_ATTESTOR_WIRED` | `PlacementWiring.mode == "venue"` — a gatherer that asked the venue, not one that described this process |
| `OPERATOR_CONFIRMATION_ACCEPTED` | the verifier exists, and its deployment-level grading is `VALID` |
| `DURABLE_STORE_WIRED` | `getattr(store, "is_durable", False)` |
| `DISTRIBUTED_LOCKS_WIRED` | `getattr(locks, "is_distributed", False)` |
| `IP_ALLOWLIST_ENFORCED` | `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST` (default `true`) |
| `SIGNED_TRANSPORT_WIRED` | `False`, written literally at `app/composition.py:454` |

`reason_codes()` returns `"LIVE_" + prerequisite.name`. There is no second enum: a prerequisite
and its refusal code cannot disagree because one is spelled from the other.

**Review areas** answer "which question of the per-order review did this finding answer", and
live in `placement_review.py` as `ReviewArea`. Every `ReviewCode` maps to exactly one via
`REVIEW_AREA_BY_CODE`:

| Area | Codes |
| --- | --- |
| `PROVENANCE` | `NO_ATTESTATION`, `VENUE_ATTESTATION_REQUIRED`, `STALE_ATTESTATION`, `FUTURE_ATTESTATION`, `ATTESTATION_UNREACHABLE`, `ATTESTATION_REFUSED_BY_VENUE`, `ATTESTATION_RATE_LIMITED`, `MALFORMED_VENUE_RESPONSE` |
| `CREDENTIAL` | `NO_SPOT_TRADE_PERMISSION`, `NO_READ_PERMISSION`, `WITHDRAW_ENABLED`, `IP_ALLOWLIST_REQUIRED`, `KEY_EXPIRED`, `KEY_TOO_OLD`, `TRADING_AUTHORITY_EXPIRED`, `CREDENTIAL_UNREADABLE` |
| `ACCOUNT` | `ACCOUNT_TRADING_DISABLED`, `ACCOUNT_TYPE_UNEXPECTED` |
| `SYMBOL` | `SYMBOL_UNATTACHED`, `SYMBOL_NOT_TRADING`, `ORDER_TYPE_UNSUPPORTED`, `TIF_UNSUPPORTED` |
| `CLOCK` | `CLOCK_SKEW_EXCEEDED`, `CLOCK_UNSYNCHRONISED`, `RECV_WINDOW_INSUFFICIENT` |
| `CONFIRMATION` | `OPERATOR_CONFIRMATION_ABSENT`, `OPERATOR_CONFIRMATION_EXPIRED`, `OPERATOR_CONFIRMATION_NOT_YET_VALID`, `OPERATOR_CONFIRMATION_SCOPE_MISMATCH`, `OPERATOR_CONFIRMATION_UNVERIFIED`, `OPERATOR_CONFIRMATION_ACCEPTED` |
| `UNCLASSIFIED` | none, by construction. A finding lands there only if the mapping forgot its code, which is why the area exists: a new code that nobody classified is a visible count, not an invisible omission. |

Two vocabularies and not three, because the enablement report and the per-order counters are
both organised by "which part", and `test_the_counter_fields_are_exactly_the_areas`
(`test_part19_review_areas.py:127`) pins that the counter fields and the areas are the same
set in both directions.

`CONFIRMATION` includes `OPERATOR_CONFIRMATION_ACCEPTED`, an informational code: a dashboard
that can see "the confirmation passed" is one an operator can act on. `blocking_areas` never
contains an informational finding, so acceptance cannot make a verdict look refused.

## 3. Credential provider selection

Chosen once, at boot, by `app/credentials.py:build_credential_provider`:

| `EXECUTION_CREDENTIAL_SOURCE` | What you get | Boot conditions |
| --- | --- | --- |
| `none` (default) | `NullCredentialProvider` | Every order needing a key is refused. A fresh deployment cannot trade by accident. |
| `environment` | `EnvironmentCredentialProvider`, wrapped in `CachingCredentialProvider` | `EXECUTION_CREDENTIAL_ENV_PREFIX` is required; the pair is **refused when `NODE_ENV=production`** ("process-wide key material cannot be scoped per tenant, is visible in every crash dump, and does not rotate") |
| `secret-manager` | `SecretManagerCredentialProvider(fetcher)`, wrapped in `CachingCredentialProvider` | Requires a constructed fetcher. Nothing constructs one unless `EXECUTION_CREDENTIAL_FETCHER` names it; see §4. |

The laws that make this explicit, deterministic and fail-closed:

* **No fallback, in either direction.** `secret-manager` never reads the environment;
  `environment` never calls a fetcher. The choice is made at boot or the boot fails; there is
  no per-order attempt at "the other one".
* **No default fetcher.** `EXECUTION_CREDENTIAL_FETCHER` defaults to `none` even under
  `secret-manager`, so naming a source is a refusal, not a behaviour.
* **A fetcher selected for a source that ignores it is a boot failure:** *"the fetcher is
  consulted only by the secret-manager provider, so this combination is a deployment that
  believes it has credential plumbing it does not use"*.
* **The token is not a settings field.** `EXECUTION_VAULT_TOKEN_ENV` holds the *name* of a
  variable; the value is read from `os.environ` inside the module that uses it, at
  construction and at each lookup. `to_public_dict()`, `model_dump()` and `repr()` therefore
  have nothing to leak — `test_the_token_has_no_field_it_could_be_stored_in` asserts the field
  does not exist, which is a stronger pin than "the view omits it".
* **Caching is bounded.** `EXECUTION_CREDENTIAL_CACHE_SECONDS` (default 300) is how long a
  revoked key can still look live. The cache key includes tenant, account and exchange, so one
  tenant's credential cannot satisfy another's.
* **What the wiring object exposes is what downstream needs:** `provider`, `source`,
  `fetcher_source`, `tenant_id`, `account_id`, `cache_seconds`. `fetcher_source` is `None`
  unless a fetcher is genuinely in the path — which is the exact value the enablement report
  reads, so the report cannot claim a fetcher because a setting mentioned one.

The boot line is `execution_engine.credentials_selected`, carrying `providerSource`, and either
`providerVariableNames` (the two env names, for `environment`) or `providerFetcher`
(`vault-kv2` / `injected`), plus `cacheSeconds`. Those keys say `provider*` rather than
`credential*` for one reason: `app/logging_config.py:RedactionFilter` replaces the value of any
record key whose *name* is credential-shaped, so `credentialSource` in a log line prints
`[REDACTED]` and the line tells an operator nothing. `/status` and `/health/ready` never pass
through that filter and keep the `credentialSource` / `credentialFetcher` spelling published in
Part 16. The rename is confined to log records, and
`test_the_boot_log_names_the_mechanism_and_nothing_else` installs the real filter around its
assertions so the property holds in any test order rather than only when another test happened
to configure logging first.

## 4. Vault KV v2: the concrete fetcher

`app/secret_fetcher.py` implements `SecretFetcher` against the KV v2 HTTP API. The design is
almost entirely refusals, which is why the module is short.

Configuration, and what `VaultKvConfig.__post_init__` (and `app/config.py`) enforce:

| Variable | Default | Enforced |
| --- | --- | --- |
| `EXECUTION_CREDENTIAL_FETCHER` | `none` | `none` or `vault-kv2`, nothing else |
| `EXECUTION_VAULT_ADDR` | unset | required by `vault-kv2`; `scheme must be https or http`; then `must be https`, because "the deployment's service mesh is not a substitute for transport security in a component that fails closed over everything else"; `must not embed credentials (a 'user:pass@host' authority)`; one trailing slash stripped |
| `EXECUTION_VAULT_MOUNT` | `secret` | `must be one safe path segment` — a nested mount is spelled in the template instead, so this value stays checkable |
| `EXECUTION_VAULT_PATH_TEMPLATE` | `wlct/{tenant}/{account}/{exchange}` | not blank; `may only contain {tenant}/{account}/{exchange}` (an `unknown placeholder(s)` list is in the refusal, because a typo like `{tenent}` would otherwise look up a path that never exists and report "no secret" forever); no `unbalanced braces`; no `..` segment |
| `EXECUTION_VAULT_TOKEN_ENV` | `EXECUTION_VAULT_TOKEN` | non-blank and `must be an environment-variable name` |
| `EXECUTION_VAULT_NAMESPACE` | unset | a non-blank namespace path with no control characters |
| `EXECUTION_VAULT_TIMEOUT_MS` | `3000` | at least 250 — below that the fetch tests Vault's availability rather than the network |
| `EXECUTION_VAULT_TLS_VERIFY` | `true` | off is legal outside production; production refuses a credential path that does not verify |
| `EXECUTION_VAULT_MAX_RESPONSE_BYTES` | `65536` | `must be within 1 KiB..4 MiB` |

Per lookup:

* `GET {addr}/v1/{mount}/data/{rendered path}` with `X-Vault-Token` and, only when configured,
  `X-Vault-Namespace`. The `data/` segment and the `.data.data` envelope are asserted in the
  tests rather than remembered, because both are KV v2 specifics and a fetcher that guesses them
  works until the day it silently reads nothing.
* **Identifiers are validated before anything is rendered into a URL.** A tenant, account or
  exchange must match `[A-Za-z0-9._-]{1,64}`; otherwise: *"the tenant identifier '../etc' is not
  a safe path segment … the lookup was refused before any request left this process, because the
  alternative — encoding it — would make a traversal reach a different tenant's secret."*
  `test_an_unsafe_identifier_never_becomes_a_request` pins the "no request" half by asserting the
  transport was never called.
* The rendered path must be inside `1..MAX_VAULT_PATH_LENGTH` (512) characters: an absurd but
  legal template is a named refusal rather than a `414` from a proxy three hops away.
* Any non-200 is `CredentialNotFound` naming the status and quoting **no** response body. 400,
  403, 404, 429, 500 and 503 are each parametrised, because "wrong token" and "wrong path" are
  different faults for the operator and one flattened "lookup failed" costs the next engineer an
  hour. A transport failure names the exception type and not the URL.
* `api_key` and `api_secret` must be present and non-blank (`"the stored secret's api_secret is
  blank."`). Both `api_secret` and `apiSecret` spellings are accepted, and two spellings that
  disagree are refused — a credential path with two answers is a credential path where somebody
  edited one of them.
* `permissions` is optional and defaults to **no claim**: an absent field is not `{"SPOT": true}`.
  A `withdraw` permission is carried through precisely so the review can refuse on it. That is
  the non-custodial rule, and it is split across two places on purpose
  (`placement_review.py:1038`): `ExchangeCredentials.assert_safe` raises on the *positive* case
  — a key that can withdraw — and the review closes the *unknown* case, because "we asked the
  venue and it did not say the key cannot withdraw" is not a state to trade inside. The fetcher
  therefore has no opinion about withdrawal at all: it stores what the path says, and the law that
  acts on it is in the core, where it can be tested against both answers and against neither.
* `expiresAtMicros` is read when stored, and rejects a string that needs a timezone decision
  nobody wrote down — digits are accepted, `"2026-01-01"` is not. It is what lets the core's
  `KEY_EXPIRED` law do anything at all.
* The response body is bound *before* parsing, and an oversized body is refused without being
  consumed: `"the response was 70008 bytes, above the 65536 byte bound for a KV secret; this
  path is not holding an API key pair."`
* Nothing about a response is rendered. `describe()`, `repr()` and every refusal message are
  built from configuration names, and
  `test_the_fetcher_never_renders_the_token_or_the_secret` asserts the token and the secret
  appear in none of them — including in the message of a decode failure, which names the
  exception type and not the bytes it came from.
* There is no retry. A Vault outage is a boot-time or lookup-time fact; the cache is what
  defines how much of an outage a running engine rides through, and re-reading a five-millisecond
  timeout in a loop is how an outage becomes a stampede.

`vault-kv2` is the one concrete fetcher because it is the store this platform's operators
already run, and because it exercises the whole interface — network, auth, envelope, failure
modes — without inventing a provider-specific concept the core would then have to model. A
second fetcher (KMS, or a file whose mode is checked) is additive: implement `SecretFetcher`,
widen the `Literal` and add one branch, and the tests in `test_part19_vault_fetcher.py` are the
checklist of what a fetcher owes.

## 5. Minting an operator confirmation

The confirmation is a signed statement that a named human authorised *this scope*, for *this
deployment*, until *this instant*. The digest exists so that "the operator said yes" cannot be
produced by editing a file nobody signed.

The record, as configuration carries it (`to_payload` / `from_payload`, camelCase, and nothing
else — an unknown key is a boot failure rather than a dropped field):

```json
{
  "instanceId": "exec-prod-1",
  "tenantId": "tenant-1",
  "accountId": "account-1",
  "exchange": "BINANCE",
  "symbols": ["BTCUSDT"],
  "orderTypes": ["LIMIT"],
  "issuedAtMicros": 1789603200000000,
  "expiresAtMicros": 1792195200000000,
  "nonce": "20260101T000000Z-a1b2c3",
  "digest": "…"
}
```

The signed bytes, exactly:

1. That payload without `digest`, encoded by `canonical_confirmation_json`:
   `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`. Sorting keys
   is why the JSON in a repository and the bytes under the MAC can be the same thing;
   `symbols` and `orderTypes` are stored **sorted** for the matching reason — a set has no
   order and a signature needs one.
2. `digest = hmac.new(key, those_bytes, hashlib.sha256).hexdigest()` — lower-case hex, 64
   characters (`SHA256_DIGEST_HEX_LENGTH`), because a truncated line is not a signature.
3. Verification recomputes and compares with `hmac.compare_digest`, never `==`, so a record
   cannot be probed byte by byte.

A worked example, runnable wherever the core is importable:

```python
from datetime import datetime, timedelta, timezone
from wlct_trading.execution.live_confirmation import LiveOperatorConfirmation

now = datetime.now(timezone.utc)
record = LiveOperatorConfirmation(
    instance_id="exec-prod-1",
    tenant_id="tenant-1",
    account_id="account-1",
    exchange="BINANCE",
    symbols=frozenset({"BTCUSDT"}),
    order_types=frozenset({"LIMIT"}),
    issued_at_micros=int(now.timestamp() * 1_000_000),
    expires_at_micros=int((now + timedelta(days=30)).timestamp() * 1_000_000),
    nonce=now.strftime("%Y%m%dT%H%M%SZ") + "-a1b2c3",
).with_digest(open("/run/secrets/confirmation_hmac_key").read().strip())
print(record.to_payload())
```

Put that JSON where `EXECUTION_OPERATOR_CONFIRMATION_FILE` points, or inline in
`EXECUTION_OPERATOR_CONFIRMATION_JSON`. Setting both is a boot refusal: two sources for one
ceremony means one of them is stale, and the stale one will be the one the next person reads.
Put the HMAC key in the variable named by `EXECUTION_CONFIRMATION_KEY_ENV` (default
`EXECUTION_CONFIRMATION_HMAC_KEY`) — env-only, exactly like the Vault token, for exactly the
same reason.

What minting refuses, by `LiveOperatorConfirmation.__post_init__`:

* A window wider than `MAX_CONFIRMATION_WINDOW_MS` — 90 days, expressed in **milliseconds**,
  while `issuedAtMicros` / `expiresAtMicros` are microseconds. That mismatch is a live trap for
  anyone extending this code, so both edges are pinned rather than reasoned about:
  `test_a_window_longer_than_the_ceiling_is_refused` builds the smallest record one
  millisecond past the bound (with the `* 1_000` spelled out in the test), and
  `test_the_ceiling_itself_is_allowed` pins that the bound is inclusive, because a ceiling that
  also refuses the longest legal record is a bug nobody notices until a deployment cannot mint.
  The refusal message is *"re-run the ceremony rather than minting a standing order"*: a
  confirmation that never expires is an API key with extra steps.
* A `nonce` shorter than `MIN_NONCE_LENGTH` (16 characters). The nonce is what makes two
  ceremonies over an identical scope produce different digests, so a replay of a superseded
  record is visible in the audit trail instead of being byte-equal to the live one.
* `required=True` with no key configured: the type will not carry a demand it cannot verify.
* A digest of the wrong length, a payload with unknown keys, an `expiresAtMicros` before
  `issuedAtMicros`.

What it does not refuse, and this is the one place a reader is likely to guess wrong: an
**empty** `symbols` or `orderTypes` set is not "no symbol". It means every symbol the
deployment's policy allows, and in any description it renders as the marker `SCOPE_UNBOUNDED`
(`"all-configured"`) so that "unbounded" and "nothing" — one character apart in JSON — never
have to be told apart by a human. Minting it bounded is still the operationally correct thing
to do, because scope is the entire purpose of the ceremony; it is simply not enforced by the
constructor, and the report of a wide record says so in words rather than hiding it.

**Rotation** is a re-run: mint a record with a fresh nonce starting now, replace the file, let
the old one lapse. The record itself is parsed at boot, so a new file takes effect on the next
start; the key is read at verifier construction, so a key rotation also needs a restart.
`placement.operatorConfirmation.fingerprint` on `/status` (§7) is how you confirm which record a
given process is holding.

Rotating the **key** is the one act with a consequence worth stating before somebody does it
mid-incident: verification recomputes the digest with the key the process holds now, so every
record signed with the previous key stops verifying the moment the new one is loaded. The order
is mint-with-the-new-key, publish, restart. Doing it the other way round leaves a deployment
refusing its own orders with `OPERATOR_CONFIRMATION_UNVERIFIED` until someone works out that the
ceremony is fine and the key under it moved.

## 6. How a confirmation is checked, per order

`ConfirmationVerifier.assess(tenant_id, account_id, symbol, order_type, now_micros)` returns a
`ConfirmationOutcome(state, code, detail)`. Nothing else.

| State | Code | Operator's move |
| --- | --- | --- |
| `NOT_REQUIRED` | — | The policy does not ask; the review adds nothing on this axis |
| `ABSENT` | `OPERATOR_CONFIRMATION_ABSENT` | Mint one (§5) |
| `EXPIRED` | `OPERATOR_CONFIRMATION_EXPIRED` | Re-run the ceremony; check the minting host's clock if it was minted minutes ago |
| `NOT_YET_VALID` | `OPERATOR_CONFIRMATION_NOT_YET_VALID` | Before `issuedAtMicros` — usually a clock on the host that minted it |
| `SCOPE_MISMATCH` | `OPERATOR_CONFIRMATION_SCOPE_MISMATCH` | Right ceremony, wrong order. `detail` names the axis: tenant, account, instance, exchange, symbol or order type |
| `UNVERIFIED` | `OPERATOR_CONFIRMATION_UNVERIFIED` | Digest mismatch, unparseable record, or a verifier that raised. Treat as hostile until proven otherwise: re-mint, and check which key signed it |
| `VALID` | `OPERATOR_CONFIRMATION_ACCEPTED` | In window, in scope, signature good |

How that is wired into the gate (`_confirmation_findings`, `placement_review.py:1331` onward):

* Findings exist only when `PlacementReviewPolicy.require_operator_confirmation` is set, which
  only `EXECUTION_REQUIRE_OPERATOR_CONFIRMATION` sets. Default off, so an untouched deployment
  gets byte-identical verdicts — pinned by
  `test_an_unrequired_passing_confirmation_adds_nothing_to_the_verdict`.
* A verifier that answers `NOT_REQUIRED` while the policy demands a check is a blocking
  `UNVERIFIED`: the flag and the wiring may disagree only in the direction that blocks. For the
  same reason, `PlacementReviewer` refuses to be constructed at all when the policy asks and no
  verifier was supplied (`"no ConfirmationVerifier was supplied"`).
* `PlacementReviewer.review()` still never raises. A verifier that throws becomes a blocking
  `UNVERIFIED` finding naming the exception **type** and not its message — a collaborator's
  error text is precisely where a path or a secret lands in an audit trail.
* Severity, and therefore whether the order is refused, continues to be decided by
  `requires_venue_attestation`, which comes from the **runtime mode** and never from the
  policy. So the flag can only ever *add* refusals, and defaults to not blocking in a simulated
  runtime. Since live is refused at boot (§8), what an operator sees today is a simulated engine
  reporting exactly which orders its confirmation would have refused — which is the rehearsal
  this feature exists to provide.
* `PlacementFacts.confirmation` and `.confirmation_detail` are **outside**
  `ATTESTATION_WIRE_FIELDS`, so the bytes a venue attestor signs are unchanged, and the detail
  string is bounded by `MAX_CONFIRMATION_DETAIL_LENGTH`.
* One intended consequence to know before comparing audit rows: the verdict's canonical form
  includes `policy.to_public_dict()`, so a verdict id computed from here on covers
  `requireOperatorConfirmation`. That is the point — two deployments with different policies must
  not produce colliding verdict ids — and it means verdict ids recorded before Part 19 are not
  comparable with ids recorded after.

Why boot refuses a *missing* confirmation but not an *expired* one: no record at all means the
deployment is misconfigured, and saying so at boot is cheaper than 100 % refusals later. An
expired record means the configuration is right and the ceremony lapsed; the process still has
cancellations, reconciliation and an audit trail to serve, and killing it over an
administrative slip turns an operator's missed date into an outage of the only path that can
close positions safely. So: boot continues, every order is refused, `/status` says which.

## 7. Reading the enablement picture

`build_runtime` grades the wiring it just built and keeps the result on
`EngineRuntime.live_enablement`. For the default simulated deployment with the in-process store:

```json
{
  "liveRefused": true,
  "missing": ["CREDENTIAL_SOURCE_CONFIGURED", "CREDENTIAL_FETCHER_WIRED",
              "VENUE_ATTESTOR_WIRED", "OPERATOR_CONFIRMATION_ACCEPTED",
              "DURABLE_STORE_WIRED", "DISTRIBUTED_LOCKS_WIRED", "SIGNED_TRANSPORT_WIRED"],
  "satisfied": ["IP_ALLOWLIST_ENFORCED"],
  "missingCodes": ["LIVE_CREDENTIAL_SOURCE_CONFIGURED", "LIVE_CREDENTIAL_FETCHER_WIRED",
                   "LIVE_VENUE_ATTESTOR_WIRED", "LIVE_OPERATOR_CONFIRMATION_ACCEPTED",
                   "LIVE_DURABLE_STORE_WIRED", "LIVE_DISTRIBUTED_LOCKS_WIRED",
                   "LIVE_SIGNED_TRANSPORT_WIRED"],
  "hardBlockersPresent": true,
  "credentialSource": "none"
}
```

`satisfied` moves as pieces are turned on; `liveRefused` and `hardBlockersPresent` do not.
`credentialSource` is echoed so a reader of the payload alone knows which provider the grading
was done against, without re-deriving it from anything.

The three renderings of one list, and why all three exist:

* `missing` / `satisfied` — the enum values, for a machine to diff.
* `missingCodes` — the `LIVE_*` refusal codes, for the taxonomy the rest of the platform speaks.
* `render_refusal(mode)` — prose, for the startup message, where `CREDENTIAL_FETCHER_WIRED`
  reads as "credential fetcher wired". A fourth spelling of the same list would be a fourth
  thing to keep in sync, so the sentence is generated from the same `LivePrerequisite` members
  rather than written beside them.

Where the facts are published:

| Surface | Fields | Notes |
| --- | --- | --- |
| `GET /internal/v1/status` (authenticated) | `liveEnablement` (the JSON above), `credentialSource`, `credentialFetcher`, `operatorConfirmation`, `placement.confirmationConfigured`, `placement.operatorConfirmation` | `credentialFetcher` is the wiring's `fetcher_source`: `null` when nothing is in the path, even though the *settings* view says `"none"` for the same state — one is "what is wired", the other is "what was configured", and collapsing them would hide a deployment whose settings and wiring disagree. |
| `GET /health/ready` (unauthenticated) | the same block, because the route spreads the wiring view and `describe()["placement"]` verbatim | Carries presence and shapes only. `operatorConfirmation` is `public_summary()`: `required`, `keyConfigured`, `recordPresent`, `expiresAtMicros`, `fingerprint` — 12 hex characters (`FINGERPRINT_LENGTH`) of the digest, a correlation handle and not the MAC. `test_ready_carries_the_same_block_unauthenticated_and_no_material` scans the payload for credential-shaped keys and for the words `api_secret`, `signing_key`, `private_key`, `nonce`. |
| Startup, when `EXECUTION_MODE=live` | the refusal text | The operator gets the missing list at the moment they were reaching for a mode switch. |
| `POST /internal/v1/placement/attest` | the per-order verdict, confirmation codes included | "would this order be refused", answered by the same code path the engine runs. |
| `GET /metrics` | `wlct_execution_placement_blocks_{area}_total` × 7, `wlct_execution_wiring{component="operator_confirmation"}`, `{component="live_credential_fetcher"}` | Derived, not hand-listed: Part 18 builds one counter family per `ExecutionCounters` field, so seven new areas needed no exporter change — `test_the_area_counters_are_derived_without_an_exporter_edit` proves the exposition with a value on it, because empty families are omitted by law. |

Two denominators that are deliberately different: `area_counts` counts *findings* (one order can
produce three credential findings), while `placement_blocks_{area}` counts *orders* refused. A
ratio between them is a fact; an equality would be a coincidence.

Part 20 note, added when this part's publication half finally gained a reader: every row of the
table above except the startup refusal is now consumed. The worker's client mirrors the whole
`/status` document instead of nine keys of it, and `GET /v1/observability/execution` renders an
`ENGINE POSTURE` section from it - which is what makes the `null`-versus-absent distinction in the
first row load-bearing rather than pedantic, because a panel row is a place a wrong reading can go
on display. See [`PART20_ENGINE_STATUS_EDGE.md`](PART20_ENGINE_STATUS_EDGE.md).

`PlacementVerdict.blocking_areas` is ordered by `ReviewArea` declaration order, not by which
finding arrived first, so the same refusal renders the same list in every log line and diff.

**A note on the two absent items that look similar and are not.** `SIGNED_TRANSPORT_WIRED` is
in `HARD_BLOCKERS` — `frozenset({LivePrerequisite.SIGNED_TRANSPORT_WIRED})` — because this
composition root never constructs a live venue adapter, and `VENUE_ATTESTOR_WIRED` is its
consequence: the attestor is injected *over* that adapter
(`app/placement.py:240`: "the gatherer needs the live trading adapter — the object this function
has no business creating, and which a simulated runtime must not have at all"). `DISTRIBUTED_LOCKS_WIRED` also reads `false` today, but for a
different reason: the core ships a working `RedisLockManager` (`execution/locks.py:291`, built
and tested in Part 11) and `app/composition.py:338` simply does not select it. That is one `if`
and one setting away from being satisfied, so it stays a *missing item* rather than a *hard
blocker* — which is the distinction `HARD_BLOCKERS` exists to draw: "nothing this deployment
could be configured into existing changes this" versus "the next composition change does".

## 8. What this part does not do

* **It does not make live possible.** `ExecutionSettings._assert_safe_combination`
  (`execution/config.py:159`) and the graded refusal at the end of `build_runtime` both stand.
  `HARD_BLOCKERS` is the explicit statement of why the refusal is unconditional rather than
  computed, and it is the constant a later part must change on purpose — not a boolean that
  quietly started meaning something else.
* **It does not sign requests, authenticate a transport, or talk to a venue.** Nothing in this
  part constructs an exchange client, and no live or testnet base URL is selected for one.
* **It does not put a ceiling inside the confirmation.** The window bound, the scope rule and
  the expiry are the limit. Maximum notional, order count and per-symbol exposure belong to
  `risk/`, which is a different component with a different owner and a different review path.
* **It does not touch `EXECUTION_DRY_RUN` or add its opposite.** Turning the confirmation on
  changes no mode at all; a simulated runtime with the requirement on is still simulated.
* **It does not verify the operator's identity against anything.** The HMAC key *is* the
  identity boundary: whoever holds it can mint records for this deployment. Rotating it is an
  operational act with a restart. If this platform later gains an approval system that signs
  records, `ConfirmationVerifier` is the seam — the states, the codes and the counters stay and
  the shared key goes away.

Predecessor note, for anyone reading the parts in order: `docs/PART16_PLACEMENT_REVIEW.md`
sec. 8 is the **Part 16 snapshot** of what live lacked — evidence the review could gather, six
items, written before the fetcher and the confirmation existed. Part 17 added the durable
incident trail, Part 18 the metrics and the wiring gauge, Part 19 this layer. For "what is
missing now", §2 and §7 of this document are authoritative and the old paragraph is history; for
"what Part 16 built", `docs/PART16_HANDOVER_FULL_SOURCE.md` is authoritative and this document is
only the summary.

## 9. Turning the pieces on, in order

Each step is safe alone, and none of them trades:

1. **Selection, dark.** `EXECUTION_CREDENTIAL_SOURCE=environment` (outside production) or
   `secret-manager` with `EXECUTION_CREDENTIAL_FETCHER=vault-kv2` and a paper account. Confirm
   `execution_engine.credentials_selected` in the log and `credentialSource` /
   `credentialFetcher` on `/status`. The simulated deployment now reads real key *metadata* for
   the review and still transmits nothing.
2. **Evidence.** `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true` (the default) keeps
   `IP_ALLOWLIST_ENFORCED` satisfied; `EXECUTION_PLACEMENT_ATTESTATION_TTL_MS` and
   `EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS` set how much staleness the review forgives. Watch
   `wlct_execution_placement_blocks_{provenance,credential,account,symbol,clock}_total` to learn
   which area is actually unhealthy before deciding what to fix.
3. **The confirmation.** Mint a record for one symbol and one order type (§5), set the key, then
   `EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=true`. Everything outside that scope starts being
   refused — which is the demonstration that scoping works, and it is worth watching one cycle
   on a paper account before it is ever relied on.
4. **Durability.** `EXECUTION_STORE_BACKEND=postgres` takes `DURABLE_STORE_WIRED` off the list.
   `DISTRIBUTED_LOCKS_WIRED` does not follow it, and cannot be made to by any setting: this
   service has no Redis configuration at all, and builds `InMemoryLockManager` unconditionally
   (`app/composition.py:338`). See §7's note on the two kinds of absence — the fix is a
   composition change selecting the core's `RedisLockManager`, not a deployment change.
5. **Live.** Not available, and now you can read the remaining list from the refusal instead of
   from this document. The item no configuration can supply is `SIGNED_TRANSPORT_WIRED`.

## 10. Refusal catalogue

Boot failures are the fast ones, because they happen before an order exists.

| What you see | Cause | Move |
| --- | --- | --- |
| `EXECUTION_CREDENTIAL_FETCHER=vault-kv2 with EXECUTION_CREDENTIAL_SOURCE='none': … a deployment that believes it has credential plumbing it does not use` | Fetcher named, source not selected | Point the source at `secret-manager`, or set the fetcher back to `none` |
| `secret-manager … needs a secret fetcher` | Source selected with no fetcher constructed | Set `EXECUTION_CREDENTIAL_FETCHER`, or drop the source |
| `EXECUTION_VAULT_ADDR must be https` / `must not embed credentials` | The address | Fix the URL. A `user:pass@host` authority is refused even over TLS |
| `EXECUTION_VAULT_MOUNT must be one safe path segment` | A nested mount | Move the nesting into the path template |
| `unknown placeholder(s)`, `unbalanced braces`, `must not contain a '..' segment`, `must not be blank` | `EXECUTION_VAULT_PATH_TEMPLATE` | Exactly `{tenant}`, `{account}`, `{exchange}`; repeating one is legal (both render the same value) and inventing one is not |
| `is not a safe path segment (expected [A-Za-z0-9._-]{1,64})` | A tenant, account or exchange id | Fix the caller, not the network: no request was made. Check for an id that has a slash, a colon or a percent-escape in it |
| `the rendered Vault path is N characters, outside the 1..512 bound` | A template that is legal in every part and absurd in total | Shorten it; the bound exists so this is a named refusal rather than a proxy error |
| `above the N byte bound for a KV secret` | The path holds more than a key pair | Point the template at the credential path |
| `EXECUTION_VAULT_TOKEN is not set or is blank` | The variable is not in the container | Inject it. Do not add a settings field for it — §3's fourth bullet is why |
| `the stored secret's api_secret is blank.` | A key pair written half-populated | Fix the stored secret; a half-written credential is not a usable one |
| `supplies no confirmation record` | Requirement on, nothing to require | Supply the record, or turn the requirement off |
| `both set` | JSON and FILE both configured | Keep one |
| `EXECUTION_CONFIRMATION_HMAC_KEY is not set or is blank` | Required confirmation with no key | Put the key in the named variable, or drop both settings |
| `names instance '…' but this process is '…'` | A record copied between deployments | Mint per deployment; `EXECUTION_INSTANCE_ID` is part of the scope |
| `could not be read` | `EXECUTION_OPERATOR_CONFIRMATION_FILE` path or mode | Fix the path. A missing file at boot is a refusal, not a silent "no confirmation" |
| `the confirmation window is N ms, above the … ms ceiling` | A record wider than 90 days | Re-run the ceremony on a shorter window |
| `no ConfirmationVerifier was supplied` | Policy demands a check the reviewer cannot perform | Set the key and the record, or turn the requirement off |
| Order refused, `OPERATOR_CONFIRMATION_SCOPE_MISMATCH` | The order is outside the record | Mint a wider record. Never edit the old one: the digest covers the scope, so editing is forgery even when you hold the key |
| Order refused, `OPERATOR_CONFIRMATION_EXPIRED`, process healthy | Ceremony lapsed | Re-mint. Staying up is deliberate: cancellations still have to work |
| Order refused, `OPERATOR_CONFIRMATION_UNVERIFIED` | The digest does not match, or the verifier raised | Check the key this process is holding against the key that signed the record, then re-mint |

If anything here and the code disagree, the code and its tests are authoritative. The Part 19
suite is five files:

```
PYTHONPATH=libs/trading-core python3 -m pytest -q \
  libs/trading-core/tests/test_part19_live_confirmation.py \
  libs/trading-core/tests/test_part19_review_areas.py \
  libs/trading-core/tests/test_part19_live_enablement.py
cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m pytest -q \
  tests/test_part19_vault_fetcher.py tests/test_part19_live_wiring.py
```

Related: `docs/PART16_PLACEMENT_REVIEW.md` (the review's laws, unchanged by this part),
`docs/PART18_METRICS_EXPOSITION.md` (where the counters and gauges in §7 are exposed),
`docs/SECURITY.md` (credential handling), `docs/ARCHITECTURE.md` (the layer map), and
`docs/GETTING_STARTED.md` (which of these settings a first deployment should set at all).
