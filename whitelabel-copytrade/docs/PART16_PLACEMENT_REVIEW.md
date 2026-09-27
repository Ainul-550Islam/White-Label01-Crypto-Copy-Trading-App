# Part 16 — the credential source and the authenticated placement review

> Status: shipped, dark. Live mode remains refused, and this document says exactly
> which sentence refuses it and what has to be true before that sentence goes away.

## 1. What this part was asked to close

`services/execution-engine/app/composition.py` named its own gaps before this part
existed:

> *the live credential provider and the authenticated order-placement review are
> unfinished*

Everything else in the execution path — order lifecycle, events, incidents,
reconciliation, the Binance adapters, the risk gate, the safety-tier gates — was
already implemented and tested (the audit that established this is
[`PART16_CORE_LAYER_GAP_AUDIT.md`](PART16_CORE_LAYER_GAP_AUDIT.md)). So Part 16
built the two missing layers and nothing else. No order that previously reached a
venue now takes a different path, because no order reached a venue before this
part and none does after it: `ExecutionRuntime` still refuses live mode.

Two properties were required of the result:

* **Dark launch.** The review runs on every order a runtime *could* transmit, and
  on a simulated runtime it records findings without changing outcomes. Adding it
  must not be able to alter a paper deployment's behaviour, because a behaviour
  change in the money path is what a part like this is most likely to get wrong and
  least likely to notice.
* **No new failure vocabulary.** The review is one more safety gate, not a second
  rejection mechanism. One code path produces blocked-gate incidents, audit events
  and typed results for every gate; the review joins it.

## 2. The gate

`SafetyGate.PLACEMENT_ATTESTED` is gate **11** of 11 in
`wlct_trading/execution/safety.py`, evaluated in
`ExecutionPreconditions.placement(...)`. Its contract:

| state | gate result |
| --- | --- |
| no reviewer wired | `passed=True`, `applicable=False`, detail names the fact that a runtime which transmits refuses to start in this state |
| reviewer wired, verdict allowed | `passed=True`, detail carries the verdict id and the venue-backed flag |
| reviewer wired, verdict refused | `passed=False`, detail is the verdict's first blocking finding |

A blocked gate maps through the engine's existing `_GATE_ERROR_CODES` table to
`ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED`. **No new error code was added**,
deliberately: the worker's taxonomy, the API's failure surface and the admin
console's rendering all key off that enum, and the useful detail — *why* the
review refused — travels in the verdict codes inside the audit payload and the
incident, where a human reads it. A `PLACEMENT_REVIEW_BLOCKED` code would have
been a second place to look for the same fact.

Because a blocked review is a fault and not an operating mode, the gate is in
`_maybe_record_gate_incident`'s `faulty` set: it produces an
`IncidentType.SAFETY_GATE_BLOCK` at `WARNING`, while a kill switch stays silent
(the system working as intended) and a credential failure stays `CRITICAL`.

The review also runs *before* the gates rather than inside gate evaluation: the
verdict is gathered once, then handed to the preconditions as one more input. The
`2a. Placement review` block in `ExecutionEngine.submit` is the only place the
reviewer is called, and one order means exactly one review.

## 3. The law

`wlct_trading/execution/placement_review.py` is pure by construction — no clock,
no entropy, no I/O, no `await`, and `now_micros` is a required argument wherever
time is needed. It is asserted structurally (`TestPurity` parses the module's own
AST), because "this file is a function of its inputs" is the property that makes an
audit record re-derivable, and a file can acquire a default clock in one line
without anyone intending it.

Six rules, in the order they matter:

1. **Absence outranks everything.** No attestation is `NO_ATTESTATION`, not an
   empty `PlacementFacts`. "We never asked" and "the venue says no" are different
   facts about the world, and a review that conflates them cannot tell an operator
   whether to wire something or to change a key.
2. **The review can only tighten.** Every policy knob is a duration or a bound;
   none is a permission. There is no `allow_withdrawals`, no
   `skip_ip_allowlist_check`, no `require_venue_attestation=False` on the policy
   (that flag exists on the *reviewer*, where it means "this runtime cannot
   transmit", which is a statement about the runtime and not about an entitlement).
3. **Staleness is a finding.** `age_ms = (now_micros - attested_at_micros) // 1_000`
   against `max_attestation_age_ms`; a negative age is `FUTURE_ATTESTATION`. Both
   ends are bounded (`1_000..3_600_000` ms) at construction, so a TTL that would
   make every attestation stale — or make a day-old one look fresh — cannot boot.
4. **`requires_venue_attestation` decides the consequence of a missing answer.** A
   runtime that may transmit and has only local facts is refused
   (`VENUE_ATTESTATION_REQUIRED`, BLOCKING). A runtime that cannot transmit records
   the same gap as `INFO`. In the transmitting case, *every* evidence-absence code
   blocks, including ones the severity table ranks as a warning: "the venue is
   rate-limiting us" is not a licence to place an order. In the simulated case a
   code the table already ranks as a warning keeps its rank, so
   `ATTESTATION_RATE_LIMITED` stays `WARNING` rather than being flattened to `INFO`
   — an operator should still see that the venue is throttling us.
5. **An unattested field is a finding only when a source that could answer was
   consulted** (`facts.venue_backed`). A venue-backed attestation that does not
   say whether the key may withdraw is `WITHDRAW_ENABLED`-adjacent and blocks; the
   same silence from an in-process gatherer is not a finding at all.
6. **Findings are ordered severity → code → field**, and the verdict id is a digest
   over canonical JSON of the findings, the policy, the attestation and the mode.
   So a verdict id is comparable across processes and platforms, and it changes
   when the *evidence* changes — not when the moment does. Two processes that
   looked at the same key in the same minute produce the same id; two that saw
   different entitlements do not. `retryable` is true only when every blocking
   finding is retryable (`RETRYABLE_REVIEW_CODES`), which is what lets a worker
   re-queue one order and page a human about another.

## 4. The gatherers

| class | answers | used by |
| --- | --- | --- |
| `UnattestedPlacementAttestor` | nothing; `source = "unattested"`, the configured reason travels in `collection_detail` | the default wiring, so "forgot to configure" is never shaped like "configured permissive" |
| `LocalPlacementAttestor` | the credential provider's declared permissions, an injected symbol table, measured skew | a simulated runtime that wants real findings in its audit without a venue call |
| `CachingPlacementAttestor` | wraps another, keyed by the full question | every composed runtime |
| `BinancePlacementAttestor` | `/sapi/v1/account/apiRestrictions`, optionally `/api/v3/account` flags, optionally `exchangeInfo` | a live runtime, injected by the service that owns the adapter |

The gatherer that reaches Binance reuses the deployment's
`BinanceTradingAdapter` rather than constructing a signed client of its own. That
is not a shortcut: the adapter owns the credential provider, the synchronised
`ExchangeClock` and — critically — the `RateLimitRegistry`. A second client would
spend request weight the deployment never accounted for, and the venue's `429`
would then land as a review failure on the way to an order that never went out.
`test_part16_binance_attestation.py::TestThroughTheSignedClient` asserts this
against the real client: the path, `signature=`, the API-key header,
`method="GET"`, and that the weight charged is
`BINANCE_REST_WEIGHTS["api_restrictions"] == 1`.

Field reading, and the two unit traps it exists to avoid:

* `tradingAuthorityExpirationTime: 0` means "no expiry", not "expired in 1970".
  `_optional_millis` maps `0` and negatives to `None`. Read literally, every
  non-expiring key on the platform would have been refused.
* `HttpResponse.json()` decodes numbers as **strings** to protect precision, so a
  millis field must accept `str` (and reject `True`, which is `1` to Python).
* `enableWithdrawals` must be `False` for a non-custodial platform, and only ever
  `True` alongside an IP filter. An absent field is `None` — and law 5 turns that
  silence into a refusal for a venue-backed attestation, because "unknown" is not
  "cannot".
* Spot `exchangeInfo` publishes per-symbol `orderTypes` and **no** per-symbol
  time-in-force list. The TIF slot is therefore always empty, which the reducer
  maps to `None` ("not attested") and never to `False`. Inventing a rule here
  would put a claim in the audit record that the venue never made.
* `exchangeInfo` with no `symbols` has *not loaded* — the lookup returns `None` and
  the review asserts nothing. A loaded catalog that lacks the symbol returns
  "not attached" and the order is refused (`SYMBOL_UNATTACHED`). Collapsing those
  two turns a cold start into a venue-side denial; a whitespace-only `symbol` in a
  payload is skipped rather than registered, so a malformed catalog cannot pose as
  a loaded one.

## 5. The cache, and the fail-open that was found here

`CachingPlacementAttestor` is keyed by
`(tenant_id, account_id, symbol, order_type, time_in_force)`. The first draft used
`(tenant_id, account_id, symbol)` on the theory that one gather per account-per-
symbol is one gather per order. That theory was wrong, and the shape of the wrongness
is worth recording because it is the classic shape: an attestation stores the
symbol's capability lists **already reduced to booleans for the shape asked about**.
Reuse it for a different shape and you assert support the venue never granted —
a `LIMIT`/`GTC` gather authorising a `STOP_LIMIT`/`IOC` order. Sharding the key by
order shape is not a performance choice; a coarse key here is a hole.

A failure entry lives `max(ttl // 5, MIN_ATTESTER_TTL_MS)`: caching the failure is
what stops an outage becoming a stampede, shrinking the window is what stops the
outage being remembered after the venue recovers. `stats()` (entries, hits,
misses, failuresCached, both TTLs, maxEntries) is what `/status` publishes, because
"the review costs nothing per order" and "the review is why we are out of weight"
are otherwise indistinguishable. `PlacementReviewer.describe()` reports the cache
only when the attestor has one — a status surface that prints zeros for a component
that does not exist reads as "wired and idle" to whoever is on call.

Two other fixes that came out of writing the tests rather than out of a plan:

* `evaluate_placement_attestation` raised `UnboundLocalError` on the collection
  branch for a non-transmitting runtime. The reviewer's never-raises wrapper turned
  that into `ATTESTATION_UNREACHABLE` — a wrong code, correctly formatted, in a
  durable record. The severity is now read from the table before the mode adjusts
  it, and the test asserts the *code*, which is what caught it.
* `PlacementReviewRequest.__post_init__` blank-checked the *unnormalised* value, so
  `tenant_id="   "` passed while `symbol="   "` did not. A whitespace tenant id
  would have shared one cache key and one audit line reading `tenant: `. Both
  identity fields are refused now; only `symbol`, `order_type` and
  `time_in_force` are upper-cased, because tenant and account ids are opaque ids
  owned by another service and case-folding them would miss a lookup rather than
  fix a spelling.

## 6. Configuration

`services/execution-engine/app/config.py` gained eight fields and one validator
(`_validate_placement`) - the table below has seven rows because the tenant and
account identifiers are one decision, not two knobs. There is deliberately **no** `EXECUTION_PLACEMENT_REVIEW_ENABLED`
switch: a key that lets a deployment trade without asking the venue whether the key
may trade is the same as no review at all. What is configurable is where key
material comes from and how expensive the review may be.

Every one of the eight is written into **both** inventories:
`services/execution-engine/.env.example`, which is the file
`scripts/dr-manifest.mjs` enumerates when it asks whether a deployment's
environment can be described from something committed, and the root
`.env.example`, which is the file an operator actually copies. One of the two is a
variable somebody will not find, and a refused-at-boot default is worth a sentence
beside the variable that triggers it rather than a pointer to this document.

| variable | default | law |
| --- | --- | --- |
| `EXECUTION_CREDENTIAL_SOURCE` | `none` | `none` wires a provider that refuses every authenticated lookup — correct for a paper process, where needing a key is a bug. `environment` is development-only and is **refused outright** when `NODE_ENV=production`. `secret-manager` requires a fetcher injected in code: key custody lives with the service that owns the encrypted store, and no HTTP surface of this engine may install one. |
| `EXECUTION_CREDENTIAL_ENV_PREFIX` | `WLCT_BINANCE` | The core appends `_API_KEY` / `_API_SECRET`. A trailing underscore is refused at boot rather than normalised, because a check that quietly disagrees with the code it guards turns a missing variable into a passing startup. |
| `EXECUTION_CREDENTIAL_TENANT_ID` / `_ACCOUNT_ID` | `tenant-1` / `account-1` | The single pair an environment can serve. More than one tenant requires `secret-manager`; an environment cannot scope a secret per customer, which is the whole reason `environment` is development-only. |
| `EXECUTION_CREDENTIAL_CACHE_SECONDS` | `300` | Not a security window. Rotation and revocation are the venue's and the operator's; this is the difference between one vault call per order and one per burst. |
| `EXECUTION_PLACEMENT_ATTESTATION_TTL_MS` | `300000` | Both the cache TTL and the freshness bound, on purpose: a cache that outlived the freshness window would be the reason a stale attestation passes. Bounds `1000..3600000`, imported from the core and never retyped, so the two cannot drift. |
| `EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS` | `90` | `1..36500`; a key older than this may not trade until it is rotated. |
| `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST` | `true` | Default true; `false` is accepted for simulated runtimes and refused for live ones, because the allowlist is the one control on a leaked key that the venue enforces for us. |

A simulated runtime gets `mode="local"` and `requires_venue_attestation=False`, so
the review runs on every paper order, records one `INFO` finding, and changes no
outcome.

Nothing here needs a migration: the review adds no table and no column. The
verdict rides in the existing `SUBMITTED` event payload
(`OrderEvent.payload` is `dict[str, str]`, so booleans arrive as `"true"`/`"false"`
and timestamps as digits — never `str(True)`, which a consumer reads as a
different word for yes).

### What the part made measurable

Three counters in the core's engine metrics snapshot, all incremented from one
place (`ExecutionEngine._record_placement_review`, which is the only path that
knows a verdict and an outcome at the same time): `placementReviews` (every review
run, allowed or not), `placementReviewBlocks` (the subset the review refused) and
`placementAttestationFailures` (the subset refused because the venue could not be
asked, which is the number that separates "our keys are wrong" from "the network
is down"). The review is also a timed stage: `EXECUTION_STAGES` gained
`placement_review`, and the engine observes it around the gatherer call, so the
cost of asking the venue is a histogram rather than a guess.

Two honest limits, both measured rather than assumed, both pinned by
`test_the_engines_observed_stages_are_declared_and_placement_review_is_live` in
`tests/test_observability_metrics.py`:

* The engine recorded exactly the stage this part added. *Amended by Part 18:*
  twelve of the thirteen declared names had no call site when this was written,
  and the engine now times four more - `validation`, `safety_gates`, `risk` and
  `total_submit` - so eight remain, each belonging to a layer across a boundary
  (the adapter, the stream, the reconciliation service, and `persistence` spread
  over six store writes). The test guards the direction that matters (an observed
  name must be declared, or the sample is computed and thrown away) and pins the
  13/8 figures so this paragraph cannot go stale quietly: wiring a new stage means
  updating the test and this section together.
* The execution engine service mounted no metrics exposition route at all, so
  these counters lived in a library snapshot with no reader. *Amended by Part 18,
  which also corrects what this sentence claimed when it was written:* it said the
  numbers were "scraped by whichever process renders one", naming
  `services/trading-engine`'s observability module - and that is false, because
  Part 9's hub renders a registry in *its own* process and has never seen this
  service's `ExecutionMetrics`. Two services do not share a counter object across
  a process boundary, so nothing was scraping anything; the honest state was
  "measured, kept in the process that measured it, and unreadable from outside".
  Part 18 shipped the `/metrics` route on the merits rather than to make this
  paragraph true, and this note is here because a dated correction is cheaper
  than a stale claim that reads as a design decision.

## 7. The internal endpoint

`POST /internal/v1/placement/attest` (`app/routers/placement.py`), internal prefix
only, bearer token required, never forwarded by the worker client:

* `409 PLACEMENT_REVIEW_UNWIRED` when the runtime has no reviewer.
* `400 PLACEMENT_REQUEST_REFUSED` when the core's request validation refuses the
  identifiers — the refusal is the core's own message, so the API and the engine
  cannot disagree about what a valid symbol is.
* `200` otherwise, **including when the review refuses the order**. A refusal is
  data: the caller asked what the venue says, and the answer arrived. `500` for a
  refusal is how an operator ends up unable to see why their own console cannot
  place a test order.
* `transmitted: false` is a constant on the response model, not a computed field.
  The day this endpoint can transmit, that line has to change and a test has to
  change with it.
* The response model has no field a credential could fit into, and the test suite
  asserts that rather than asserting the intent.

### `GET /internal/v1/status` gained the posture

The review's *answer* is on one surface and its *posture* on another, and before
this part the second one was silent: `EngineRuntime.describe()` published
`credentialSource` and the `placement` block, and `/status` mapped every other
describe() field but dropped those two. A line of
`services/execution-engine/.env.example` saying the findings are "published by
/status (placement block)" - while the response model had no such field -
is the kind of sentence a repository grows when nobody reads it back.

`StatusResponse` therefore gained `credentialSource` and a typed
`PlacementStatusView` (`label`, `mode`, `requiresVenueAttestation`,
`cacheTtlMillis`, `attestorSource`, `policy`, optional `cache`). Three decisions
inside one small model:

* **typed, not a passthrough dict**, and the wire base's `extra="forbid"` applies.
  A `describe()` that grows a key without a decision here fails in CI (a drift test
  compares the two key sets in both directions) rather than 500-ing on the surface
  the worker asserts against before it forwards anything - and rather than quietly
  publishing an unreviewed field on an authenticated internal route.
* **`policy` and `cache` are mappings of numbers, not declared fields**, which is
  what makes passing them through safe: those blocks hold bounds, counters and one
  boolean, and nothing string-shaped, so a credential cannot be smuggled inside
  them. The only strings are the three labels, and a test asserts the body carries
  no credential-shaped key or substring at any depth.
* **`placement is null` and `attestorSource == "unattested"` are different
  statements.** The first is "this engine did not answer the question" - the same
  convention `storeBackend`'s `"unknown"` and `enablementMaxAgeDays`'s default set
  - and the second is "the question was answered: the review is wired and no venue
  stands behind it". Collapsing the two would let a pre-Part-16 deployment be
  reported as a reviewed one.

One asymmetry is worth stating rather than leaving for a reader to find: the
typing rule binds `/status`, not every surface that can see the wiring.
`/health/ready` spreads the same `describe()` dict with no token (Part 13
established it for `storeBackend`, because a probe cannot be handed credentials),
so an added key reaches that route whether or not anyone declares it. What keeps
that safe is not a response model - it is that `describe()` is built from labels,
booleans, integers and one nested dict, and the suite scans both bodies for a
credential-shaped key or substring at any depth. A guard on the projection would
have been theatre; the guard is on the source. That
interface is the projection the worker's compatibility gate reads, and it omits
Part 14's retention fields and Part 15's evidence window for the same reason the
placement block is absent from it: the worker must not forward anything into a
process that could reach a venue, and a review the worker cannot trigger is not its
business in this build. A test holds that the client never even names the attest
path.

## 8. What is not wired in this build

`build_runtime` still raises before constructing an engine in live mode. The
refusal sentence in `app/composition.py` is the operator-facing explanation of this
whole part, and it no longer calls this part's two deliverables missing. It says
`EXECUTION_MODE=live is not wired in this build`, then what exists now - "the
durable store and its verification (Part 13), distributed locks (core), the
credential provider selection and its boot refusals, and the authenticated
order-placement review the engine requires before it will transmit (Part 16)" -
then what does not: "this service never constructs a venue trading adapter - no
signed HTTP transport is wired here, no live or testnet base URL is selected, and
there is no operator runbook for the enablement evidence a live account must
present". `test_live_still_refuses_and_says_what_is_actually_missing` asserts the
message names all of it, because a refusal sentence that still called the review
unfinished after this part shipped would be a lie with a test behind it.

So the list below is the whole of what is left, not a summary of it. What remains genuinely unwired, and
what the next operator must supply, in order:

1. A venue attestor instance. `BinancePlacementAttestor(adapter=..., account_reader=..., symbol_facts=...)`,
   built from the *same* adapter the orders use, passed as
   `build_placement_reviewer(..., venue_attestor=...)` with
   `will_transmit_orders=True`.
2. A key source that can answer per tenant. `EXECUTION_CREDENTIAL_SOURCE=secret-manager`
   plus a fetcher injected in code at the composition root; the environment source
   cannot serve more than one account and is refused in production regardless.
3. A signed HTTP transport bound to the venue's hostname and port, and an
   egress IP allowlist registered at the venue for the key that will sign.
4. A durable store and a distributed lock manager — the pre-existing live-mode
   requirements, unchanged by this part.

Until all four exist, `EXECUTION_MODE=live` is refused at boot with that sentence,
and this part's review runs on paper orders only, where it is visible in
`/status`, in `placement.attestation.*` log lines and in the audit payload — which
is the point of a dark launch: the wiring is exercised, and the money path is not.

## 9. Deliberate omissions

* No domain event bus, no Redis Streams plane. `BullMQ` plus `engine_order_events`
  plus the Socket.IO gateway already fan out; a second plane would be a second
  source of truth.
* No re-implementation of the order lifecycle, the event store, the incident
  recorder or the Binance adapters. The review joins them.
* No service-side re-implementation of the venue's answers. `binance/__init__.py`
  now re-exports the gatherer's surface under one stated rule - a name is public
  when a deployment needs it to configure the venue, and stays module-path-local
  when importing it from the package root would drag the transport vocabulary in -
  which is why `BinancePlacementAttestor`, `KeyEvidence`, `SymbolRegistry` and
  `AccountFlagReader` are exported and `BinanceTradingAdapter`, `HttpResponse`,
  `SignedRequestSender` and `ExchangeClock` are not. The rule is a test
  (`TestPackageSurface`), not a comment, and it caught one real omission while
  being written: `AccountFlagReader`, the protocol every account-flag reader must
  satisfy, was defined but undeclared.
* No suppression comments in any file this part added — tests included, and
  including the comments that would have been no-ops: the lint ruleset here is
  `["E4", "E7", "E9", "F"]` and mypy runs on the packages, not the tests, so a
  marker of that kind annotates a rule nobody enabled. Where a type needed
  naming instead, it was named (the `SymbolRegistry` protocol, `dataclasses.replace`
  in the law's own test helper).

## 10. Verification

```sh
# core (law + gatherers + engine wiring + venue mapping)
cd libs/trading-core
python3 -m ruff check wlct_trading/ tests/
python3 -m mypy wlct_trading
python3 -m pytest -q

# service (settings, builders, composition, endpoint, drift parity)
cd services/execution-engine
python3 -m ruff check app/ tests/
python3 -m mypy app/
python3 -m pytest -q

# handover generator is deterministic
python3 scripts/gen_part16_handover.py --check
```

Expected at the time of writing (as Part 16 left the tree: core `1559 passed`,
service `235 passed, 12 skipped`, mypy clean over 148 and 19 source files
respectively). These counts are historical, and the current ones - which Parts 17
and 18 moved by adding files of their own - are in `docs/PART17_DURABLE_INCIDENTS.md`
and `docs/PART18_METRICS_EXPOSITION.md` rather than quietly re-based here, because
a verification section that is re-measured by a later part stops being evidence of
anything.
`node --test scripts/` 52/0 with `dr-manifest.mjs --check` valid and
`--check-rls` exit 1 (the shipped posture, unchanged by this part); apps/api
386 tests over 17 suites with `tsc` and `eslint` clean and `prisma validate`
valid; admin-web `tsc` clean; trading-engine 43 and market-data 19.

The Part-16 tests are `libs/trading-core/tests/test_part16_placement_review.py`
(40, the law alone), `test_part16_placement_attestor.py` (49, gatherers, cache,
engine wiring and the umbrella package's export parity),
`test_part16_binance_attestation.py` (44, the venue mapping, its unit traps and the
venue package's export rule) and
`services/execution-engine/tests/test_part16_placement.py` (40) - 173 tests, plus
one in `libs/trading-core/tests/test_observability_metrics.py` that keeps this
part's metric stage and the vocabulary it lives in from drifting apart.

Nine documents carry the part outside this file, and the list is here because a
control the permanent documents still describe as missing does not exist:

* `README.md` and `docs/ARCHITECTURE.md` section 9 - the platform's execution-safety
  list went from three independent gates to four, in both copies, with the engine
  plane's own final gate named rather than implied. The architecture document's
  execution-engine paragraph also carries the new route, gate 11, the `/status`
  posture block, the unauthenticated `/health/ready` mirror of the same wiring
  dict, and the prerequisite list corrected to what actually remains.
* `docs/SECURITY.md` section 4 (runtime credential sources), section 11 (the review
  as the fourth independent gate), section 14 (what live mode still lacks) and
  section 15 (what the review cannot do).
* `docs/ROADMAP.md` - the delivery-log row.
* `docs/PART5_EXECUTION.md` (the gate count ten to eleven, plus a dated note beside
  its own "still not built" list), `docs/PART11_WORKER_SCALING.md`,
  `docs/PART13_DURABLE_STORE.md` and `docs/PART14_RETENTION.md` - each carried a
  present-tense sentence naming the credential provider or this review as still
  open. Every one is dated in place rather than rewritten: those parts' accounts of
  what they declined to do are still accurate about those parts, and a reader
  needs to know which of the two statements they are reading.
