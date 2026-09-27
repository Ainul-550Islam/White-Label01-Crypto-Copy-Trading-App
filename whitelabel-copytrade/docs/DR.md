# Disaster recovery - the drill, not the binder

The machine-readable plan is `docs/dr/manifest.json` (validated and rendered
by `scripts/dr-manifest.mjs`; `--check` runs in CI, `--plan` produces the
operator runbook, and Part 12's `--due`/`--record` grade and log backup
freshness against `docs/dr/backup-ledger.jsonl`). This file is the human
half: why the manifest says what it says, the post-restore probes, the
ledger's rules, and the drill record every rehearsal must fill in before it
counts.

## The three rules everything else follows from

1. **Keys before ciphertext.** `encryption-keys` restores before `postgres`
   because a database whose credential columns cannot be decrypted is not a
   degraded system, it is a deleted one - and the confusion costs hours
   arguing with the restore. The validator refuses the inverted order
   outright, so nobody relearns this at 3am.
2. **Redis is rebuilt, not restored.** Its queues, claims, leases and rate
   windows are coordination state with TTLs; a snapshot replays the dead
   past as fresh truth. The manifest's redis verification is therefore about
   proving the EMPTY state behaves, not about proving the snapshot loaded.
   (This is the same reasoning as the Part 9 "no publisher reported is never
   'all clear'": stale operational state must announce itself.)
3. **A restore is timed or it didn't happen.** `drill.timed: true` is a
   validator requirement for exactly the reason the platform refuses false
   latency claims everywhere else: the number in the binder that nobody has
   re-measured is marketing.

## Post-restore probe queries (run as the operator role, then as the app role)

```sql
-- Migration ledger: no failures, and the count must equal the repository's
-- prisma/migrations directories for this deployment's schema stamp.
SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS incomplete,
       count(*) AS applied
FROM "_prisma_migrations";

-- Tenant isolation spot check (works WITH or WITHOUT RLS enabled; with the
-- Part 11 policies ENABLED these MUST read zero from a context without the
-- app.tenant_id GUC, and only-own-tenant with it):
BEGIN;
SELECT count(*) FROM orders;                                    -- no GUC
SELECT count(*) FROM orders, (SELECT set_config('app.tenant_id', '<probe-tenant-uuid>', true)) s;
ROLLBACK;

-- Audit ledger head exists (audit is append-only by policy, not by trust):
SELECT count(*) FROM audit_logs WHERE created_at > now() - interval '10 minutes';
```

The `tenant-scoped` app-role check belongs to whoever runs the enablement
(`apps/api/prisma/rls/enable.sql`'s checklist) - the probes above work from
`psql`; the API-level assertion is `withTenantRls`'s spec plus a staged
cross-tenant read attempt.

## Drill record (copy per rehearsal; a restore without this filled in is not a drill)

| Field | Value |
| --- | --- |
| Date / duration (against RTO `<manifest>.rtoHours` h) | |
| Manifest stamp reviewed (schema + paths verified current) | |
| Components restored, in order, with each verification outcome | |
| Deliberate failure injected (per `drill.successCriteria` - e.g. wrong master key) and the stop-the-line result | |
| Data-loss window actually observed (against RPO) | |
| Follow-up issues filed (every deviation, including "it worked too well") | |
| Sign-off (operator + one engineer not involved in the restore) | |

## The backup-freshness ledger (Part 12)

Manifest v2 states each component's obligation as data: `cadenceHours` -
the maximum age of the last recorded SUCCESS - or `cadenceHours: null` with
a written `cadenceWaiver` (redis is rebuildable; scheduling its copy would
manufacture an obligation the component's contract denies). Postgres' 24h
dump cadence under a 60m RPO is legal only because the component names the
`rpoMechanism` that closes the gap - the validator refuses the silence, not
the number.

The evidence is one JSON line per event in `docs/dr/backup-ledger.jsonl`:

    {"at":"2026-09-14T06:00:00.000Z","component":"postgres","outcome":"ok","note":"pg_dump + scratch restore verified"}

and two commands touch it:

* `node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed
  [--note TEXT] [--at ISO]` - refuses unknown components, broken ledgers
  (no appending onto unreadable evidence), non-ISO stamps, and any
  secret-shaped content in the note, scanning the RAW text because JSON
  escaping is not a laundering licence.
* `node scripts/dr-manifest.mjs --due [--now ISO]` - every component in
  restore order: current, overdue (measured from the last `ok`; a `failed`
  record does not stop the clock), never-recorded, or waived. Exit code 1
  iff something is due - which makes this exact command the cron entry
  point: alerting on it is the scheduler, and the scheduler is wiring, not
  design.

The ledger ships EMPTY on purpose. "No backup recorded" must read as four
`never recorded` alarms, not as fabricated green ticks - a platform that
refuses simulated fills does not seed its own evidence trail with
simulated backups.

Part 14 raised what a fresh `postgres` entry is WORTH: journal retention
deletes settled event rows, and a prune followed by a failed restore is
indistinguishable from a data-losing outage. The rule is therefore one
line of the retention runbook (docs/PART14_RETENTION.md §10, move 1):
`--due` green for `postgres` before the FIRST apply on any deployment,
and the cadence itself is now load-bearing evidence, not hygiene. The
deletion ledger (`engine_retention_runs`) rides the same dump as every
other table - "what was pruned when" must survive the restore that
replays the backup.

Part 15 made the other half of that sentence checkable. The manifest now
carries `rlsEvidence`: a cadence (168h), a required grade (`pass`, not a
knob), the engine endpoint that verifies the engine plane, and its own
append-only evidence ledger, `docs/dr/rls-evidence.jsonl`. `node
scripts/dr-manifest.mjs --check-rls` answers "is there a recent PASSING
row-level-security audit" with an exit code, and `--record-rls` is the only
writer of the ledger. The same ordering as the backups applies, in the
stronger direction: `--check-rls` green is a prerequisite for Part 14's FIRST
apply, because a prune on a database whose partitioning is believed-but-
unverified is a deletion whose blast radius is assumed. Both ledgers refuse to
read each other's file, so an RLS line never parses as a backup line and vice
versa.

## Installation and rehearsal (Part 21)

Two commands sit between "the plan is correct" and "the plan ran". They do not replace the sections
above; they make them checkable.

**`node scripts/dr-schedule-install.mjs`** owns the host half of the generated schedule. It verifies
`docs/dr/schedule/dr.cron` with the same `scheduleDrift` function `--check-schedule` runs - imported,
not reimplemented - and refuses to install anything it would have to author. It manages a marked
block and leaves every unmanaged crontab entry alone, byte for byte; installing twice is a no-op;
`--uninstall` removes only the block; `--check` distinguishes installed, not-installed, drifted and
malformed, and `--install` re-reads the host table after writing, because an exit code proves the
command was willing, not that the schedule exists. A host without `crontab` is told so and exits 4:

```
$ node scripts/dr-schedule-install.mjs --check
schedule not-installed: no managed block in the host table; run --install (expected sha256 d15556e0340334206b20d6d80ae824cad8f31e946e7368c4474f1089c4afe760)
$ echo $?
1
```

**`node scripts/dr-rehearsal.mjs`** is the drill's clipboard. Default mode is a dry run: it builds
the plan from `restoreProcedure`, checks each component's declared paths and environment names,
ages the backup ledger and the rehearsal ledger, and grades `PLANNED`. `--execute` runs a closed
allowlist of four probes (`manifest-valid`, `schedule-current`, `schedule-installed`, `rls-audit`)
and still restores nothing; a destructive step stays `OPERATOR` because this repository has no lever
on an environment. Production and unknown targets are refused before anything is read, and
`--execute` additionally requires `--confirm <rehearsalId>`, the hash of the plan being approved.
Evidence is written only with `--emit-evidence`, and a PLANNED record can never read as a pass - the
ledger refuses to parse a line that claims otherwise.

`--status` is the read-only board over the same laws, with an exit code a job can use:

```
$ node scripts/dr-rehearsal.mjs --status            # exit 1
[ok  ] manifest       5 components, RPO 60m / RTO 4h, drill every 90d
[ok  ] schedule       docs/dr/schedule/dr.cron matches a fresh generation
[UNVER] installed      this host has no cron facility, or no block, so installation is unproven here
[FAIL] backupLedger   no backup ledger at docs/dr/backup-ledger.jsonl: 4 obligation(s) read as never recorded
[UNVER] rls            7/8 verification checks pass; not asserted here: ...
[UNVER] drill          no rehearsal has ever been recorded; the plan is untested
  boundary: read-only repository-side verification; no database, queue, engine or cloud call was made,
  and no money-path behaviour is implied by any grade in this document
```

That output is the correct answer for a fresh checkout, and its red cells are the point: four backup
obligations have no evidence and nobody has rehearsed. The first rehearsal this tool ran found a real
defect in the manifest it was checking - `restoreProcedure` restored `deployment-config`, `redis`,
`dataset-objects` at steps 3, 4, 5 while those components declared `restoreOrder` 5, 3, 4. Two
representations of one plan had never been compared to each other. The data was corrected to follow
the procedure (the procedure is what an operator executes, and step 3's "run migrations only if the
image's schema is older than the restored DB" only holds in that order), and `--check` now refuses a
disagreement between the two, including a component that is declared restorable but never restored by
any step.

## What is NOT yet automated, plainly

Part 20 wired the scheduler half, and the heading above is kept rather than
renamed so that the cross-reference in `docs/PART15_RLS_ENABLEMENT.md` sec. 8
still lands. What it now covers:

* `--emit-schedule` derives `docs/dr/schedule/dr.cron` from the manifest's own
  cadences - the check interval is `min(tightest declared cadence, 24h)`, so an
  obligation that tightens moves the schedule by itself, and a `cadenceHours:
  null` component is echoed as a comment with no job line, because a waiver that
  silently became a schedule would be a fake obligation.
* `--check-schedule` compares that file against a fresh derivation and exits 1 on
  any byte difference, which is what turns "the deployment runs it" from a habit
  into something a CI job can hold. It also refuses `--record` / `--record-rls`
  appearing in the schedule as its own finding, reported ahead of the byte
  comparison: the schedule may ask questions, never answer them.
* `--check-rls` is no longer "still unwired" - it is a job line in that generated
  file, at the manifest's own RLS cadence.

Part 21 took the "installing the file is a host act" clause off this list - not by
becoming the host, but by making the host state checkable and reversible
(`scripts/dr-schedule-install.mjs`, above) and by refusing where a host has no cron
facility instead of reporting a green install it did not perform. What is still open,
and deliberately so: the drill calendar, which is a dated human ceremony no generator
may schedule on an operator's behalf; the restore itself, which stays operator-run -
the rehearsal runner grades its own probes and marks the destructive steps
`PLANNED`/`OPERATOR`, because a tool that fabricated an infrastructure result would be
worse than a tool that admits it cannot see one; the real failover matrix, which is now
specified as ten probes with invariants and timeouts
(`python3 -m wlct_trading.observability.chaos`, all ten `UNVERIFIED` here and exiting 2,
by law never `PASS` without a harness check); and the first real
`--record` / `--record-rls`, since the ledgers refuse to seed themselves and an
empty board reporting four `never recorded` alarms is the correct answer until a
human runs a backup. Part 12 moved the judgement (what is due, when, evidenced how)
into the validator so the scheduled half is one command and one exit code; Part 20
supplied the timer, and left the answers where they belong.
