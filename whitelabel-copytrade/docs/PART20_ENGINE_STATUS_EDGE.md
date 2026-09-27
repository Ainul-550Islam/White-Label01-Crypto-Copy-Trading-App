# Part 20 — the engine's own account, read; and the checker, run

Scope: the operational tail's two remaining code-able gaps. Everything planned here is
display and derivation, and no gate, verdict, credential, order path or refusal threshold
moved: live mode still refuses at startup exactly as Part 19 left it.

One thing changed behaviour, and it is stated here rather than left for the reader to
discover in the diff. Checking that the pieces actually compose turned up a live defect:
the worker's startup gate could not get an answer out of the engine at all, so a
deployment built from `docker-compose.yml` exited 1 before consuming a job. Fixing it put
Python under `services/execution-engine/` in scope - an auth *scope*, described in
section 7, with the command law itself unchanged to the byte. Everything else in this
document is still read-only.

Read with [`PART19_LIVE_ENABLEMENT.md`](PART19_LIVE_ENABLEMENT.md), which is where the
facts published on this surface come from. This document is about who reads them.

---

## 1. What the audit found, in the tree as it stood

The execution engine answers `GET /internal/v1/status` from a Pydantic model
(`services/execution-engine/app/schemas.py::StatusResponse`) declared `extra="forbid"`.
Its field set therefore cannot grow in silence on the producing side. That document is
20 fields wide:

```
instanceId  mode  dryRun  adapter  store  storeDurable  storeBackend  retentionEnabled
retentionEventDays  enablementMaxAgeDays  credentialSource  credentialFetcher
operatorConfirmation  liveEnablement  placement  incidents  metricsConfigured
locksDistributed  commands  simulated
```

It had exactly one reader in the repository: the worker's client
(`apps/api/src/modules/worker/engine-internal.client.ts`), which picked nine of those
twenty keys out of the parsed body and read each one as `body.X ?? ''`, `?? []`, or
`=== true`. The gate then judged `mode` and `storeBackend` on values that could be
invented by the reader itself, and the other eleven keys were transported, validated by
the engine, and dropped at the boundary. `getStatus()` was called once, at worker startup
(`src/worker.ts:69`), and its 10-second cache was documented as existing "only for the
periodic health view" — a view that was never built.

So the platform had a service that answered questions nobody asked it, and an operations
panel whose execution section was assembled from other people's data: the readiness gate
`execution_adapter`, whose evidence the TRADING engine publishes about its own view of
whether it can reach an adapter, plus a 24-hour order-status mix from the API's database.
Nothing on that panel said what the process doing the placing is wired with.

That is the whole finding for this section: eleven published facts and an uninstalled
checker, not a security hole and not a money-path bug. A second finding appeared later, in
section 7, once the composition was run rather than reasoned about - the single reader in
the paragraph above could not in fact read, which made the gate that is supposed to refuse
forwarding an unbootable control in the reference deployment.

## 2. The mirror: one table, and two laws about absence

`apps/api/src/modules/worker/engine-status-contract.ts` is now the only description of
that wire in TypeScript. It is a table of 20 field descriptors plus one per
sub-document (`placement`, `liveEnablement`, `incidents`), and the table IS the parser —
there is no second list of keys to keep in step with the first.

**Law one: a required key that arrives missing is a refusal, naming the key.**

```
execution engine /status declares "instanceId" as required and the reply did not carry it
- this engine is older than the contract this worker was built against
```

Required means what `StatusResponse` says it means, not what this file prefers: the eight
fields declared without a default (`instanceId`, `mode`, `dryRun`, `adapter`, `store`,
`storeDurable`, `locksDistributed`, `commands`). Before this part, `String(body.mode ??
'')` turned "the engine is not there, a proxy answered with HTML" into `mode: ''`, which
the gate then reported as *the engine is in the wrong mode* — a refusal that blamed the
engine for the transport's failure. A wrong type is a refusal for the same reason; the
contract spec pins that `instanceId: null` is a refusal rather than a comfortable empty
string.

**Law two: an optional key that arrives missing means what the engine's own default means.**

Twelve of the twenty fields carry a default in Python, and each default is a *statement*:
`storeBackend = "unknown"` so a pre-Part-13 reply reads as unproven instead of as
`memory`; `credentialSource = "none"`; `placement = None` so "no review wired" stays
distinguishable from "an engine that has never heard of reviews"; `simulated = True`.
The mirror copies those values rather than inventing replacements, and the parity spec
below compares them one by one. A field whose Python annotation is `X | None` is marked
`nullable` in the table, because an explicit null and an absent key are two different
answers — `credentialFetcher: null` means "the source in use needs no reader", while a
reply with no such key means "an engine from before Part 19". Conflating them is how a
wire contract quietly loses its meaning.

**Unknown keys are tolerated and reported.** The parsed object carries
`unmappedKeys`, the panel prints the count as a row, and the parity spec fails. The
asymmetry is the argument: a missing required key means the engine is older than this
worker's contract, which invalidates an assert; an extra key means it is newer, which
invalidates none. Newer is not a 03:00 problem, it is a CI problem, and CI is where it
now lands.

## 3. The parity law: three sides, all checked

Three documents describe one contract:

1. `EngineRuntime.describe()` publishes the facts;
2. `StatusResponse` declares which are required and what the absence of an optional one
   means;
3. `ENGINE_STATUS_FIELDS` reads them.

Side 1 against side 2 was already pinned by the service's own suite — that is why the
status route may write `wiring["metricsConfigured"]` with brackets instead of `.get()`,
and `PlacementStatusView`'s docstring in `schemas.py` says the counterpart test asserts
the two key sets agree. Side 3 was pinned by nobody, which is precisely how nine became
the answer to what is twenty.

`apps/api/src/modules/worker/engine-status-parity.spec.ts` closes it by parsing
`schemas.py` with the same live-source technique the alert catalogue parity uses
(`modules/observability/alert.constants.ts`) and the dataset transition table uses
(`modules/datasets/datasets-safety.spec.ts`): it reads the file rather than a fixture,
because the drift it prevents is "somebody edited one side" and a checked-in copy of the
schema would be a fourth side to disagree with. It asserts, per field: name after the
`_to_camel` aliasing rule restated in the spec, kind, requiredness, nullability, and the
default value. An annotation the spec cannot classify is a hard failure with a message
refusing to guess — "silently classifying a new wire type as a string is how a contract
mirror starts lying about a field it never looked at".

It also pins the historical gap by name, listing the eleven dropped keys and asserting
each is mirrored. That test exists because a mirror "simplified" back to nine keys would
otherwise pass every comparison of both sides of a change made together.

## 4. The panel: `ENGINE POSTURE`, with a tone law

`apps/api/src/modules/observability/engine-posture.service.ts` reads the engine through
the worker's own client — the same instance, the same parser, the same cache — and renders
a section that `executionPanel` appends after its own rows:

```
GET /v1/observability/execution  ->  { sections: [ EXECUTION, ENGINE POSTURE ] }
```

Two sections rather than rows merged into one, because the rows above are the API's
database describing what went through it and the rows below are another process's account
of itself. A derived fact and a self-reported one never share a row on this platform.

The **tone law** is stated in the service and asserted for every state in
`engine-posture.service.spec.ts`: `ok` is reserved for a fact the engine reported about a
component doing what it was configured to do; a missing answer is `warn`; a reported
contradiction is `bad`; a fact with nothing right or wrong about it (which mode this is,
which store class, how long the retention window is) is `neutral`. There is no path in
that file that renders absence as `ok`, and the test walks the states to prove it rather
than trusting the switch.

The rows, and what each is for:

| Row | Reads | Notes |
|-----|-------|-------|
| engine instance | `instanceId`, `mode`, `dryRun`, `commands.length` | identity, not verdict |
| durable store | `storeDurable`, `storeBackend`, `store` | `bad` on the contradiction the worker already refuses to forward into |
| distributed locks | `locksDistributed` | single-instance by configuration is `neutral`, not `warn` |
| credential source | `credentialSource`, `credentialFetcher` | names the reader when one exists; never a value |
| operator confirmation | `operatorConfirmation`, `placement.confirmationConfigured`, `placement.policy.requireOperatorConfirmation` | "asked for and absent" is `bad`, "not wired" is `neutral` — Part 19's two halves kept apart |
| live enablement | `liveEnablement` | a refusal with a hard blocker is `neutral` (it is the designed state); no answer at all is `warn` |
| incident sink | `incidents` | `durable (postgres)` is the only `ok` there |
| instrumented | `metricsConfigured` | `warn` when nothing is measuring this process |
| journal retention | `retentionEnabled`, `retentionEventDays`, `enablementMaxAgeDays` | |
| placement review | `placement.label`, `placement.attestorSource` | label and provenance only |
| keys this build does not mirror | `unmappedKeys` | appears only when non-empty |
| engine last answered | the client's own cache stamp | see below |

**Age is the engine's answer time, not this read's.** The service reports
`statusFetchedAtMs()`, added to the client for exactly this purpose: an age computed from
when the panel ran is a tautology wearing the word "age". On the failure paths the last
good answer's timestamp still rides along, because "unknown for 60 seconds" and "never
known" are different incidents and an operator reads them differently.

Two more decisions worth their keep:

* **The panel budget is 2 seconds, and a slow read is not cancelled.** The client's own
  30-second timeout is the queue-hop guard, sized against a venue round trip; an
  operations page must not be able to wait that long on a service it is asking "how are
  you". A read that exceeds the budget renders `unverified` / `PANEL_BUDGET` with the
  words "the read is still running and the next refresh will show it", because it is.
* **Nothing is imported from the worker module.** The engine client is built by a factory
  bound in `ObservabilityModule` (`createEnginePostureClient`, exported so the spec tests
  the decision rather than describing it) and the binding is `null` when the deployment
  has no engine token. `WorkerModule` is not imported, because that module also provides
  the queue processor and this module's standing guarantee is that no execution
  dependency points back at the trading plane. The service's own `wired` getter reports
  only whether a client is bound: the configuration question was asked once, by the
  factory, and asking it again on the read path would put a second copy of that law where
  it could disagree with the binding and print "not wired" next to live data.

**The scan for secret shapes covers this surface too.** The engine publishes
`placement.operatorConfirmation.fingerprint`, a 12-character digest prefix meant for
correlation. It is on the wire and deliberately not on the page; the spec asserts the
rendered JSON of a section contains neither that fixture value nor any long base64-ish
run, so a future row that dumps a sub-document whole fails here first.

## 5. What this part refused to do

* **Make the engine a health-mirror publisher.** `OBS_PUBLISHER_SERVICES`
  (`packages/config/src/constants.ts:155`) is the Redis channel that
  `market-data` and `trading-engine` write to, and it is the reason the panel can show
  those services at all. Adding `execution-engine` to it would need a Redis client in a
  service that owns none and a background task it does not run — two new things to copy
  facts the process already answers on request. The reader goes to the author. This is
  also why the age of the answer is a first-class field here: this view is only as fresh
  as its last read, and the file says so rather than implying a push.
* **Give the worker a placement gate.** The engine publishes enough to build one
  (`placement.policy.requireOperatorConfirmation`, `requiresVenueAttestation`,
  `liveEnablement.missing`), and it would be a mistake: the ack law
  (`engine-internal.client.ts`, the Part 13 re-review block) counts a business rejection
  as DONE precisely so the durable order record and its refusal reason survive. Refusing
  before forwarding would turn a recorded, tenant-visible refusal into a queue retry with
  no record at all. A gate belongs on the engine, where Part 16 through Part 19 put it.
* **Publish the engine's own readiness gates.** `RedisKeys.ops_readiness_mirror`
  (`wlct_trading/redis_keys.py:355`) explicitly leaves room: "only the trading engine
  writes this today; the shape is per-service so an execution worker can later publish
  its own gates". Untaken by choice. A published gate that the API merge honours turns a
  displayed fact into a blocking one, and that is a behaviour change in the money path
  disguised as an observability feature. The seam stays where it is, named, so the next
  reader finds the decision instead of re-deriving it.
* **Touch the admin console.** The console renders `overview`, `trading-readiness`,
  `alerts` and `incidents` (`apps/admin-web/src/app/(console)/observability/page.tsx:146`)
  and does not render per-plane `sections` at all. The section added here is the
  documented API-side operations surface, exactly as Parts 9 and 18 left theirs; a bespoke
  table for one service's wiring would be a second rendering path for the same rows.
* **Restate the four open ROADMAP rows as finished.** Time-series retention behind the
  exposition, RED dashboards beyond the panel, the chaos/failover matrix against real
  infrastructure, and the `--record-rls` staging audit all need a deployment rather than a
  commit. `docs/ROADMAP.md` keeps its wording so the deliberate non-absorption stays
  readable as a decision.
* **Generate Prometheus or Alertmanager rule files from `ALERT_RULES`.** `AlertRule`
  (`libs/trading-core/wlct_trading/observability/alerts.py`) carries `condition` as prose and
  `threshold: float | None`; for the ratio and boolean rules the threshold is `None`, so any
  `expr:` a generator emitted would be arithmetic this tree does not have. There is also no
  `infrastructure/observability/` to write it into - `infrastructure/` is `docker/` plus
  `database/` - so the open ROADMAP rows are unimplemented, not merely unwired, and a file
  full of invented thresholds would read as the difference.
  (Superseded in part by Part 22: `infrastructure/observability/` exists now, and a generator does
  derive rule files - for the four rules whose thresholds exist. The arithmetic objection was the one
  that held, and it is why 20 of the 24 rules are printed as refusals rather than as expressions
  (docs/PART22_SCRAPE_SIDE.md sec. 3).
* **Add a cron container to `docker-compose.yml`.** The compose file carries 10 services and
  no host-cron equivalent; a container that runs `--due` needs the repository mounted into it,
  an entrypoint override, and a service whose job is to sleep. The generated schedule is
  installable with two documented commands, and owning the artefact plus the instructions is
  the smaller true claim.
* **Change `/health/ready`'s authentication.** It answers unauthenticated and publishes a
  superset of `/status`'s keys - a relation the new test holds as an invariant. Narrowing it
  would be a deployment-visible behaviour change well outside this part, and its openness is
  precisely the argument section 7's exemption rests on: the right move is to document the
  relation and test it, not to edit either side of the equation to make a paragraph read
  better.
* **Add a configuration knob for the exempted read.** No new `EXECUTION_*` variable exists for
  it: the exemption is a property of one route that acts on no tenant, not an operator
  preference, and a knob would make the reach of a security law depend on a deployment
  remembering to set it. The only new option introduced anywhere in this part is `--manifest`,
  an argument to a read-only command, added so a hypothetical board can be exercised at all
  (sec. 6).

## 6. The scheduler wiring

`node scripts/dr-manifest.mjs --due` answers "what is overdue" and exits 1 when something
is. Until now it ran when a human remembered it, which makes it a claim rather than a
control — the same distinction the manifest draws about backups. The ROADMAP said so
directly: the open item is the *wiring* of that command into a scheduler.

`docs/dr/schedule/dr.cron` is that wiring, generated:

```
wlctRoot=.
SHELL=/bin/sh
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --due
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --check
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --check-rls
```

Two modes drive it: `--emit-schedule [--root PATH] [--out PATH] [--manifest PATH]` writes
it, and `--check-schedule` compares the committed file against a fresh generation and
exits 1 on any difference. `--manifest` exists because a mode that can only read the
repository's own manifest cannot be tested against a broken input without breaking the
repository.

The rules the emitter keeps, all of them tested in `scripts/dr-manifest.test.mjs`:

* **It may ask questions, never answer them.** Only `--due`, `--check` and `--check-rls`
  are emitted. `--record` and `--record-rls` are the ledger's two write modes, and a job
  that writes evidence on a timer records an outcome nobody observed — the faked seed data
  the ledger refuses to contain. `--check-schedule` fails on a file containing either,
  and reports it as its own finding rather than as a byte mismatch, so a tampering cannot
  hide inside an accepted rewrite. Until the first real `--record`, `[DUE]` on every
  component is the correct reading of this board, and the file says that in its header.
* **Intervals are derived and capped**: `min(tightest declared cadence, 24h)` for `--due`,
  24h for `--check` (manifest validity is a deployment invariant, not an obligation, so it
  does not follow the cadences), and `rlsEvidence.cadenceHours` capped the same way for
  `--check-rls`. Checking more often than an obligation is free; less often is how a
  breach waits out the gap.
* **A step that does not divide the day is honoured, not approximated.** `*/7` in the hour
  field fires at 0, 7, 14, 21 because the field restarts at 0, so the longest gap is 7
  hours. The comment in the renderer carries that arithmetic, because the reader who
  "fixes" it to weekly needs the argument, not just the line.
* **Waivers are rendered, not omitted.** A component with `cadenceHours: null` gets a
  comment naming its waiver, and if every component is waived the file still schedules
  `--check` daily — a manifest that has stopped parsing would otherwise be the reason no
  job reports anything at all.
* **The file is deterministic**: no timestamps, no host names, no ordering that depends on
  the ledger, and two renders are byte-identical. Re-emitting prints `(content unchanged)`
  instead of pretending to change something.
* **The root line is the deployment's**: `wlctRoot=.` is substituted at install time
  (`--emit-schedule --root /srv/whitelabel-copytrade`), and `--check-schedule` reads the
  value out of the file rather than assuming it, so the gate stays byte-exact on
  everything else. It is lower-case because this repository scans every generated file for
  `NAME=literal` assignments in the shape an env file uses, and the right answer when a
  secret scanner objects to a line is to stop writing a value that looks like a secret —
  not to teach the scanner to look the other way. A path is not a secret and should not be
  shaped like one.
* **The exit code is the alarm.** How a non-zero cron exit reaches a human — `MAILTO`, a
  log shipper, an init that maps exits to alerts — is deployment knowledge this file
  refuses to guess at, and says so.

Install, for a deployment that wants it:

```bash
node scripts/dr-manifest.mjs --emit-schedule --root /srv/whitelabel-copytrade \
  --out /tmp/dr.cron && crontab /tmp/dr.cron
# /etc/cron.d entries take a sixth user field; a user crontab does not.
```

Three documents still said this half did not exist, and a control that is shipped while being
described as missing is a control nobody goes looking for - so they were brought in line rather
than left as history:

* `docs/DR.md`'s "What is NOT yet automated, plainly" section now states the wiring and reduces
  the open items to installing the file, the drill calendar, and the first real `--record`. Its
  *heading* is kept on purpose, because `docs/PART15_RLS_ENABLEMENT.md` sec. 8 cross-references
  that exact heading, and a renamed section turns a live document into a broken link.
* `docs/PART15_RLS_ENABLEMENT.md` carries a "SUPERSEDED BY PART 20" note in the style Part 11
  and Part 13 established for exactly this situation: it says what Part 15 did and what Part 20
  closed, without rewriting either.
* `.env.example` - the file an operator reads when deciding whether to set a variable - names
  both consumers of `EXECUTION_ENGINE_URL` / `EXECUTION_ENGINE_TOKEN` (the worker's gate and the
  panel), states what absence does (the API boots; the section says `unconfigured`), and warns
  that its own `127.0.0.1` URL is a developer's loopback that compose overrides.

Two of these are also the reason the compose comment no longer cites line numbers. It quoted
`worker:`'s token translation at "line 349", and Part 20's own insertion above it had already
made that false on the day it was written - which is what a positional citation in a file the
same commit edits is worth, so the reference is now by service name.

## 7. The defect section 1 turned into, and the live check that found it

Section 1 said the contract had one reader. It had, more precisely, no *working* reader.
`apps/api/src/worker.ts` calls `GET /internal/v1/status` at startup with the internal
token and no tenant header - correct, because a process-level read has no tenant to name -
and `app/security.py::require_internal_auth` required a tenant header on *every* internal
route, so the engine answered:

```
400 {"code":"TENANT_HEADER_REQUIRED","message":"Every execution command must name its
      tenant via the x-tenant-id header; tenantless money operations are refused."}
```

400 is not in that client's terminal set, so `assertEngineCompatible()` re-raised,
`src/worker.ts` logged "execution engine gate failed" and exited 1: in the reference
deployment the worker could not start, and had not been able to since the gate shipped in
Part 11. Nine parts of green suites sat on top of it because every test of that client
stubs `fetch`, which is the whole reason this part's engine-side tests drive an HTTP
client and the real route table instead.

The fix is a second auth scope, not a loosened law:

* `require_internal_auth_readonly` shares both halves of the real requirement with the
  command scope - one `_authenticate` (so there is exactly one constant-time comparison
  to get wrong) and one `_tenant_or_none` (so `required=False` tolerates absence and
  still refuses a malformed header) - and the scope's *order* is pinned: no token, an
  empty token, a same-length wrong token and a truncated token are all 401, so nobody can
  reach the tenant branch without the secret.
* It is used by exactly one route, asserted by walking `app.routes` and inspecting each
  route's dependant callables, and separately by sweeping every other internal route over
  HTTP to confirm a tenantless POST still gets `TENANT_HEADER_REQUIRED`. A future route
  cannot inherit the exemption quietly, in either direction.
* The command scope's refusal code and message are unchanged to the byte, and a test
  compares the two status payloads - tenantless and tenant-bearing - as *text*, so the
  nine parts of existing callers see a byte-identical document.
* `require_internal_auth_readonly` returns `tenant_id == ""` rather than a sentinel like
  `"system"`, because an invented identifier in the one object whose purpose is to name a
  real tenant is a fact that will eventually be compared to one; the status route never
  reads the field, which is why an empty string is honest here.
* The disclosure question - why this is not a new exposure - is an invariant, not a
  paragraph: a test asserts `/health/ready`'s key set is a superset of `/status`'s, so if
  readiness is ever narrowed the exemption's justification fails in CI and has to be
  re-argued out loud.

Why the client could not fix it. `getStatus()` has no tenant to send: the worker's
startup gate runs before any job payload exists, so naming one would mean inventing one
and teaching the engine to accept invented tenants on a money surface - a worse
trade than the one made above. The other option, pointing the gate at the
unauthenticated `/health/ready`, would base an assert-before-forward decision on a
document any peer on the network can answer.

Measured against a booted engine (`uvicorn --factory app.main:create_app`, `NODE_ENV=test`
composition, port 8094), both before and after:

| Check | Before | After |
|-------|--------|-------|
| `GET /internal/v1/status`, token only | 400 `TENANT_HEADER_REQUIRED` | 200, 20 keys |
| same, token + `x-tenant-id: t-verify` | 200, 20 keys | 200, byte-identical text |
| `GET /internal/v1/status`, no token | 401 | 401 |
| same, `x-tenant-id: ../etc` | 400 `TENANT_HEADER_INVALID` | 400, same |
| `POST /internal/v1/orders/cancel`, token only | 400 `TENANT_HEADER_REQUIRED` | 400, same |
| the live 20-key payload through the TS mirror | n/a (would 400) | parses; `instance=exec-test-1 mode=simulated creds=none fetcher=null confirmation=false`, enablement `missing=7 satisfied=1 hardBlockers=true`, `unmappedKeys=[]` |
| dropping `instanceId` from the live payload | — | `EngineStatusShapeError`, `field="instanceId"` |

## 8. Verification

Every number below was transcribed from the run, on this tree, in this order.

| Gate | Command | Result |
|------|---------|--------|
| API suite | `cd apps/api && npx jest --silent` | 425 passed, 20 suites |
| API types | `npx tsc -p tsconfig.json --noEmit` | 0 errors |
| API lint | `npx eslint src --max-warnings 0` | clean |
| Admin types | `cd apps/admin-web && npx tsc --noEmit` | 0 errors |
| Script tests | `node --test scripts/` | 65 passed, 0 failed |
| Schedule gate | `node scripts/dr-manifest.mjs --check-schedule` | exit 0, "schedule valid: 3 job line(s) (--due, --check, --check-rls), derived from 5 components, no ledger-writing mode present" |
| Manifest gate | `node scripts/dr-manifest.mjs --check` | exit 0, "manifest valid: 5 components (4 with cadence), RPO 60m / RTO 4h, drill every 90d (timed: true), ledger entries: 0" |
| Due board | `node scripts/dr-manifest.mjs --due` | exit 1, 4 obligations DUE (`encryption-keys`, `postgres`, `dataset-objects`, `deployment-config`), `redis` printed as `[waive]` |
| Core | `cd libs/trading-core && python3 -m pytest -q` | 1656 passed |
| Core lint/types | `ruff check wlct_trading tests` / `mypy wlct_trading` | green / clean, 150 files |
| Engine service | `cd services/execution-engine && python3 -m pytest -q` | 428 passed, 12 skipped |
| Engine lint/types | `ruff check app tests` / `mypy app` | green / clean, 24 files |
| New engine tests | `pytest -q tests/test_part20_status_read.py` | 19 passed |
| Doc sweep | `grep -rn "still unwired\|remaining automation\|not yet automated" docs/*.md \| grep -v HANDOVER` | two hits, both the corrections themselves quoting the phrase they retire - no live claim that the scheduler is missing |
| Compose parse | `python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))"` | parses; `api:` and `worker:` carry identical `EXECUTION_ENGINE_URL` (`http://execution-engine:8093`) and `EXECUTION_ENGINE_TOKEN` (`${EXECUTION_INTERNAL_TOKEN:-}`); 10 services |
| Sibling services | `services/trading-engine`, `services/market-data` pytest | 43 / 19 passed |
| Live engine | `uvicorn --factory app.main:create_app --port 8094` + curl, section 7 | tenantless 200 with 20 keys, 401 without token, 400 on malformed tenant, 400 on tenantless POST |
| New test file, typed | `mypy tests/test_part20_status_read.py` | clean (the service gate covers `app` only, as since Part 11) |
| Handovers reproducible | `python3 scripts/gen_part{n}_handover.py --check`, n = 16..20 | `OK: ... byte-identical to a fresh generation` for all five |
| Source dump | `node scripts/generate-source-dump.mjs`, twice, hashed | 11 sections, 844 files, 546,571 lines; `sha256` of the concatenated tree identical across runs |

The dump row is phrased that way because it is true: `generate-source-dump.mjs` has no
`--check` mode - it takes no arguments at all and always writes - so its reproducibility is
proved by running it twice and comparing bytes rather than by a flag this part could have
invented and quoted. The handover row is the one that costs real time, and it carries the
ordering lesson this part learned the hard way: a part's own new files move the whole-tree
counts quoted inside every earlier handover, so the ancestors must be regenerated AFTER the new
files exist and BEFORE any `--check` is believed. Part 20's first chain reported
`STALE: PART16 ... (22,828 generated lines vs 22,828 committed)` - equal line counts, different
content - which is what a stale number looks like, and why the check compares bytes instead of
sizes.

Two of those rows are the audit's point, not decoration. The `--due` row shows exit 1 on a
board with four unrecorded obligations: the scheduler now asks questions the deployment has
not answered, which is the intended steady state until a human runs `--record`. And the
live-engine row is what no suite could have told me: 428 engine tests, 425 API tests and 65
script tests were all green while the reference worker could not start.

The claim "display and derivation only" is checked by the diff rather than asserted: the
Python under `services/execution-engine/` is `app/security.py` (two scopes over one law),
`app/routers/internal.py` (one `Depends` line), `tests/conftest.py` (a fixture whose
`-> TestClient` lied about a generator, typed honestly while section 7's tests came to
depend on it), and the new `tests/test_part20_status_read.py`. `libs/trading-core` - every
gate, verdict and refusal threshold - is untouched, which is why the core's 1656 and the
siblings' 43 and 19 are quoted above rather than skipped as unchanged.

New tests by file: `engine-status-contract.spec.ts` (16), `engine-status-parity.spec.ts`
(5), `engine-posture.service.spec.ts` (18), 13 added to `dr-manifest.test.mjs`,
`tests/test_part20_status_read.py` (19).

## 9. What an operator does with this

* "Why is every order this engine took refused?" — `ENGINE POSTURE` → the
  `operator confirmation` row (`asked for and absent` names the outage Part 19 predicted)
  and the `live enablement` row, without shell-ing into the container.
* "Is this deployment instrumented?" — the `instrumented` row and the `durable store`
  row's contradiction case, both from `/status`, not from the absence of a graph.
* "Is anything actually watching the backups?" — `node scripts/dr-manifest.mjs
  --check-schedule` says whether the watcher is installed and matches the manifest, and
  `--due` says what is overdue.
* "The panel says `unconfigured`." — this process was never pointed at the engine:
  `EXECUTION_ENGINE_URL` and a 32-character `EXECUTION_ENGINE_TOKEN` are absent, so no
  client was constructed (the observability module asks before building one, and the
  refusal to build an unusable client is the engine client's own law). Set both and the
  row lights up; `docker-compose.yml` sets both for `api:` since Part 20, which is why a
  reference deployment is expected to show posture rather than this word.
* "The panel says `unverified`." — that is the answer, not a fault: the engine did not
  answer within 2 seconds, did not answer at all, or answered with something that is not
  the contract. The `code` in the row says which, and the row names the key for the last
  case.

Predecessor note, for anyone reading the parts in order: the facts published on this surface
are Part 19's, and §2 and §7 of `docs/PART19_LIVE_ENABLEMENT.md` stay authoritative for what a
live deployment lacks - this document is about who reads those facts, not about producing them.
The gate that consumes the same document is Part 11's, and §7 of
`docs/PART11_WORKER_SCALING.md` now carries both its policy and the record that the policy
could not run. For "what Part 20 built", `docs/PART20_HANDOVER_FULL_SOURCE.md` is
authoritative: it embeds the complete current content of all 27 files (9 created, 18 modified)
and its generator re-proves that byte for byte. One asymmetry to know before diffing: Parts 16 through 19 embed the *current*
tree, so a later part's edit to a shared document appears inside those handovers too, which is
why a regenerated ancestor's ledger deltas shrink and why this part's ledger prints its measured
delta beside the pre-regeneration one instead of choosing the larger number.
