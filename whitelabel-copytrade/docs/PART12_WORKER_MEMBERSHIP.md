# Part 12 - worker self-registration and the backup-freshness ledger

Part 11 shipped the coordination plane with one hand-brake left on:
membership was config-declared, so growing the fleet by one worker meant
editing `WORKER_MEMBERSHIP` on every replica at once. Part 12 removes the
edit, not the law. It also takes the Part 11 DR manifest from "a contract
automation must satisfy" to "a contract automation can BE `--due`".

## 1. The law, restated so nothing in this part can dilute it

**Membership says who WANTS a partition. Claims decide who HAS one.**

Everything below changes only the SOURCE of membership. A registry entry is
a statement of intent with an expiry; it grants nothing. A worker listed
twice, zero times, or by a lying operator still cannot take a partition
whose claim it cannot acquire, and still cannot process without acquiring
it. `holds()` (worker-coordination.service.ts) remains the only admission
question the job path asks.

## 2. The registry: one zset, three scripts, one unit

`wlct:trading:coord:members:<group>` - a Redis sorted set per coordinated
group whose members are worker ids and whose scores are heartbeat-expiry
EPOCH MILLISECONDS. Not tenant-scoped: fleet topology is deployment state,
shared across tenants by necessity (SECURITY.md records this trade).

| script | does | does NOT |
| --- | --- | --- |
| `MEMBERSHIP_PING_SCRIPT` | prune `score <= now`, `ZADD GT` self, read back `ZRANGE WITHSCORES` | let a stale replay shorten a fresher expiry (GT) |
| `MEMBERSHIP_SNAPSHOT_SCRIPT` | `EXISTS`-guarded pure read | mutate, prune, or decide staleness |
| `MEMBERSHIP_RESIGN_SCRIPT` | `ZREM` self, return `ZCARD` | promise anything (expiry is the net) |

The scripts are byte-identical across the two languages and pinned by
sha256 in `docs/fixtures/coordination_fixtures.json` (schema
`part11-coordination-v1`, `membership.scripts` section). Both test suites
execute them by TEXT IDENTITY against fakes that interpret exactly what the
Lua says - a rewritten script that changes semantics stops matching and
fails loudly, on both sides, in CI.

Millisecond units, deliberately: the zset score domain is Redis's own
(PTTL world), shared with claim TTLs. The one place micros still live is
the leader-lease renewal law next door, and this module keeps that law
untouched. `heartbeat_expiry` is `now + ttl` - the generator-side
verification caught a `ttl * 1000` unit slip on the very first fixture run;
that is what pinning rows through the generating implementation is for.

## 3. Staleness is library law, not Lua luck

`live_members(pairs, now)` (Python) / `liveMembers(entries, nowMillis)`
(TypeScript) is the single place the expiry rule lives:

* live iff `expiry > now` - STRICTLY; expiring exactly at the sampling
  instant is expired, the conservative reading, fixture-row-pinned;
* a malformed entry (wrong pair shape, a name outside the member-token
  grammar - the SAME grammar claims use, imported, never re-declared) is a
  LOUD ValueError/throw, never a silently-shrunken fleet;
* duplicates resolve to the maximum expiry (a replica read mid-propagation
  sees a superset, never a subset);
* the result is sorted, because the assignment math must be
  order-insensitive.

A caller can `ZRANGE` the key through `redis-cli`, apply this pure
function, and get the platform's exact answer. Nothing about correctness
is locked inside a script interpreter.

## 4. The failure taxonomy (three severities, on purpose)

| call | transport failure means | why |
| --- | --- | --- |
| `ping()` | PROPAGATES | it runs inside the coordination tick; "registry down" must reach the caller's fallback branch and its log line. Swallowing it would convert an outage into "I appear to be the only member" - the one misreading the design must never enable. |
| `members()` | `None` / `null` | read-only diagnostic paths must degrade: UNKNOWN, distinct from the empty fleet `()` / `[]`. Callers keep their last known set. |
| `resign()` | `False` | leaving is best-effort; the TTL already committed to handling a lost `ZREM`. |

`MembershipRegistry` talks to a structural eval-only port
(`MembershipEvalClient` / `MembershipEvalRedis`), so the module imports no
Redis client and no execution-plane code - the Part 11 boundary AST scans
pass with zero exemptions, and the Node side gets raw replies through
`IoredisCoordinationClient.evalFlat` (the pre-existing `eval` coerces to
`Number`, which would turn a membership array into `NaN`; adding a second,
reply-honest method was the fix that touched nothing else).

## 5. Config surface and its cross-laws

| variable | default | law |
| --- | --- | --- |
| `WORKER_MEMBERSHIP_MODE` | `config` | enum `config\|registry`; `config` is byte-for-byte Part 11 behaviour |
| `WORKER_MEMBERSHIP_TTL_MS` | `30000` | floor 1000 in BOTH modes (a promise set for a future flip is still a promise); `registry` additionally requires `>= 2 * WORKER_PARTITION_RETRY_MS` or the boot refuses |
| `WORKER_MEMBERSHIP` | `""` | demoted to the documented FALLBACK list in registry mode; still the fleet in config mode |

The ratio law has one job: a TTL shorter than two ticks lets one lost ping
age a live worker out of membership while its claims are fresh - pure
churn, zero safety. `worker-env-safety.spec.ts` pins defaults satisfying
it, the boundary at exactly `2 * retry` passing, both directions of the
ratio, and the regression that started Part 11 (`defer < retry` boot
refusal) now lives in the same file.

Compose ships the `worker` service with `WORKER_MEMBERSHIP_MODE=registry`
explicitly (TTL via env interpolation), and every value stays overridable.

## 6. The tick, end to end

`WorkerCoordinationService.reconcile()` now sources membership through one
private method, `resolveMembership()`, which CANNOT throw:

1. config mode: the config list. Full stop - Part 11 behaviour.
2. registry mode: `ping(now)`. Success → the live set is the fleet view;
   `lastKnownMembers` updates; a change emits `membership_updated` (metric
   + structured log with from/to).
3. ping threw (transport, garbage reply, or a ping that did not even list
   this worker - a protocol bug is refused loudly): `membership_fallback`
   is counted and logged, and the view is `lastKnownMembers` if one exists,
   else the config list.
4. Either way the tick continues to `claims.reconcile(wanted)`: the claims
   calls are the authority, and they run against whatever membership this
   tick believed - which is exactly the Part 11 shape when Redis is down
   (their failure lands in the pre-existing `reconcile_failed` arm, held
   sets age, `holds()` fails closed after 2 ticks; nothing moved).

Shutdown: `onModuleDestroy` resigns from the registry (before the
claim-release loop) so peers' next ping reassigns this worker's partitions
immediately instead of at TTL; the resign call is logged either way
(`worker.coordination.resign{, _failed}`) and cannot block shutdown -
expiry remains the net.

`snapshot()` gains `membershipSource` and reports the fleet view the last
SUCCESSFUL tick believed; like everything else in it, it never touches
live config or Redis, so the diagnostics path cannot become the second
failure.

## 7. What an operator sees

* `GET observability/worker-coordination` (operations-read) now includes
  the registry read in the SAME pipeline: `registryKey`, raw
  `registryMembers` (`[{memberId, expiryEpochMs}]` - reads never prune, so
  an entry may linger past its expiry), and `registryLiveMembers`, computed
  at read time with the workers' OWN `liveMembers` function (one law, zero
  copies). An absent zset reads as `[]` ("nobody home"), an unreadable one
  as `null` ("the data lies outside the protocol") - deliberately
  different, and pinned by specs.
* Metrics: `wlct_worker_coordination_events_total{result}` gained
  `membership_updated` and `membership_fallback`, inside the closed label
  universe (the Part 9 lesson: bounded `result`, never a new label name).
  Sustained `membership_fallback` on any replica is "the registry is being
  leaned on" and alerts as such.

## 8. The backup-freshness ledger (the other half of this part)

The Part 11 manifest described how to restore; it stated no obligation for
HOW OFTEN each component must be backed up, and the ROADMAP honestly
recorded "cadence automation" as open. Part 12 makes the obligation data
and the checking mechanical:

* manifest schema bumps to `wlct-dr-manifest-v2`: every component carries
  `cadenceHours` (integer 1..8760) or `cadenceHours: null` PLUS a
  `cadenceWaiver` explaining the exemption (redis: rebuildable, forensic
  snapshot only). A waiver for a component that also has a cadence is a
  contradiction and refused.
* `postgres` has 24h dump cadence under a 60m RPO - only legal because it
  names `rpoMechanism` (continuous WAL/PITR closes the gap the dump
  cadence would imply). The validator refuses that gap silently: name the
  mechanism or back up faster.
* `docs/dr/backup-ledger.jsonl`, one JSON line per event
  `{at, component, outcome: ok|failed, note?}`. `--record` appends one,
  after refusing: unknown components, non-ISO timestamps, multi-line or
  >500-char notes, malformed existing ledgers (no appending onto
  unreadable evidence), and secret-shaped content - the note scan runs on
  the RAW note because JSON escaping is not a laundering licence (the
  Part 12 smoke test found exactly that hole and closed it).
* `--due [--now ISO] [--ledger PATH]` grades every component in restore
  order: `[ ok ]` with time-to-next-due, `[DUE ]` overdue or never
  recorded, `[waive]` quoting the waiver text. Exit 1 when anything is due
  - which makes `node scripts/dr-manifest.mjs --due` itself the cron
  entry point: the scheduler automation reduces to wiring this exit code
  into the alerting that already exists. `--check` reads the ledger too
  (line-numbered parse errors, note-level secret scan).
* A failed record does not stop the clock: deadlines advance from the last
  `ok` only. And no ledger ships pre-seeded: a backup nobody has run yet
  must produce four `never recorded` alarms on day one, not four fabricated
  green ticks. Recording history we do not have is the kind of fake this
  platform has refused since part 1.

## 9. Parity machinery, reused not re-invented

Everything the registry law promises is pinned through the EXISTING
fixture pipeline: `libs/trading-core/scripts/gen_part11_fixtures.py`
gained `_membership_vectors()` (generator-side verification first - rows
are replayed through the Python implementation during generation, so a
wrong row fails the generator, not two test suites later), the JSON
carries `heartbeatExpiry`, both reject tables, `liveMembers` rows, script
texts with sha256, and the `defaults` key vector. The TS specs replay it
row-for-row; the Python tests replay the same file; reject-message
comparisons use the Part 11 convention (language-neutral prefix before
`, got <repr>`, because `True` reprs differently and that is not drift in
a law). The `--plan` renderer and fixture regen are byte-deterministic
across runs.

## 10. Test ledger (what is actually proven, where)

* Python: 18 tests in `tests/test_part12_membership.py` - fixture replay,
  construction laws, GT-law via the fake SERVER, three-way failure
  taxonomy, reply-shape tolerance (flat strings AND typed ints), the
  two-worker join/silent-death/reassignment scenario through the REAL
  assignment functions. Suite total 1342, mypy 143 files, ruff clean.
* Node: 14 tests in `coordination-membership.spec.ts` (same fixture, same
  scenario) + 6 in `worker.spec.ts`'s registry describe - the flagship
  being two workers with DIFFERENT config lists reaching a correct split
  with no coordinated edit, and a silent peer aging out of MEMBERSHIP but
  not out of its live claims (wanting ≠ having, executed, timed by
  faked-clock steps, not slept). Read view +2, env laws +7.
  API suites 17/383, tsc 0, eslint clean (via `npm run lint`).
* Node: `node --test scripts/` 26/26, including ledger parse/grade/record
  round-trips through the real CLI against temp ledgers.

## 11. Still open after this part (unchanged from the honest list)

Durable execution-engine store and its live-wiring review, time-series
retention, the RLS staging enablement flip, and wiring `--due` into an
actual scheduler (the ledger is now the thing to schedule; the scheduling
itself stays deployment-side). Fault injection, live venue trading, and
anything-against-real-infrastructure remain the Part 8+ standing refusals.
