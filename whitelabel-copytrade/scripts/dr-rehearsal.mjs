#!/usr/bin/env node
/**
 * DR rehearsal runner: a deterministic, graded execution of the disaster-recovery plan in
 * `docs/dr/manifest.json`, with an append-only evidence artifact.
 *
 * What problem this solves (Part 21 audit): the manifest validator (Part 15) proves the plan is
 * well-formed, the schedule (Part 20) proves the obligations are aged on a host, and
 * `rls-enablement.mjs` proves one specific claim against a live database. None of them answers
 * "has the restore actually been rehearsed, recently, in order, and under time?" `docs/DR.md`
 * has a drill record table for that and the table has always been filled in by hand, which in
 * this repository's own words means it is "a hope, not a backup". This file turns the table into
 * a generated artifact: the same checks, run by a program, graded in public, and stored where the
 * schedule can age them.
 *
 * The laws, and why each one exists:
 *
 * 1. **PLANNED is not success.** A rehearsal with no restore behind it grades `PLANNED`; a step
 *    nobody could execute grades `UNVERIFIED`; only an executed probe with a real exit code
 *    grades `PASS` or `FAIL`. The grade vocabulary is closed and a `PLANNED` record can never
 *    carry a `PASS` verdict anywhere inside it - pinned by a test, because that single line is
 *    what stops this file from being an evidence-fabrication machine.
 * 2. **Nothing here touches an environment.** The repository has no live deployment in it, and the
 *    runner does not pretend otherwise: there is no SSH, no `psql`, no `aws`, no
 *    `docker compose down`. The destructive half of a drill stays operator-run and lands in the
 *    record as `OPERATOR` steps with the prose that has to be executed. A future deployment with
 *    real hooks adds probe names to `PROBES`; it does not add a general "run this command" field,
 *    because a rehearsal tool that accepts arbitrary commands from a JSON file is a remote
 *    execution tool wearing a clipboard.
 * 3. **Production is refused at the parse step.** `--target production` (and any target the
 *    repository cannot prove is non-production, including an ambiguous or missing one) is a refusal
 *    before anything is read. A destructive rehearsal is the one activity where a wrong guess is
 *    unrecoverable, so the answer to ambiguity is "no", the same shape as `EXECUTION_MODE=live`
 *    (Part 19) and `ENGINE_BASE_URL` production validation (Part 16).
 * 4. **Destructive execution needs a mirrored confirmation.** `--execute` additionally requires
 *    `--confirm <rehearsalId>` or `DR_REHEARSAL_CONFIRMATION=<rehearsalId>`, where the id is
 *    derived from the plan the operator is approving. A yes-flag is not a confirmation; echoing
 *    the identity of the thing you read is.
 * 5. **The evidence holds names and hashes, never values.** The same shape scan the manifest runs
 *    is run over the artifact before it is written, so a rehearsal note cannot smuggle a
 *    connection string into a file the DR schedule reads.
 * 6. **Elapsed time is measured; restore time is not inferred from it.** The runner times itself
 *    and reports that number. `rtoObserved` stays null unless a timed record exists - the runner
 *    finishing in 40 ms says nothing about how long a PITR takes, and reporting it as if it did
 *    would be the single most dangerous sentence this file could write.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MANIFEST_PATH,
  SCHEDULE_PATH,
  collectEnvNames,
  dueReport,
  findSecretShapes,
  parseLedger,
  parseRlsLedger,
  scheduleDrift,
  validateManifest,
  verifyRlsEvidence,
} from './dr-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TOOL_VERSION = 'dr-rehearsal/1 (part21)';
const EVIDENCE_PATH = join(ROOT, 'docs', 'dr', 'rehearsals.jsonl');
const DR_LEDGER_PATH = join(ROOT, 'docs', 'dr', 'backup-ledger.jsonl');

/** Closed vocabulary. `PLANNED` and `SKIPPED` are states of the plan, not grades of the world, and
 * the report keeps them in separate columns so nobody reads one as the other. */
const GRADES = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNVERIFIED: 'unverified',
  PLANNED: 'planned',
  SKIPPED: 'skipped',
});
const GRADE_VALUES = new Set(Object.values(GRADES));

/** The only targets this runner will rehearse against, and what each one is allowed to do. A
 * closed set: a free-text environment name is how "production-tmp" becomes a valid answer. */
const TARGETS = Object.freeze({
  local: { nonProduction: true, destructive: true },
  dev: { nonProduction: true, destructive: true },
  test: { nonProduction: true, destructive: true },
  ci: { nonProduction: true, destructive: false },
  staging: { nonProduction: true, destructive: true },
});

/**
 * The probe allowlist: the complete set of commands a rehearsal may run, each expressed as an argv
 * array. No entry reads from the manifest, from the environment, or from an operator string.
 *
 * Grades come from exit codes and parsed output, never from the absence of an exception.
 */
const PROBES = Object.freeze({
  'manifest-valid': {
    argv: [process.execPath, join(ROOT, 'scripts', 'dr-manifest.mjs'), '--check'],
    // `--check` refuses to run without a database, so it grades on its own exit code alone.
    grade: (result) => (result.error ? GRADES.UNVERIFIED : result.status === 0 ? GRADES.PASS : GRADES.FAIL),
    meaning: 'the DR manifest validates against its own laws',
  },
  'schedule-current': {
    argv: [process.execPath, join(ROOT, 'scripts', 'dr-manifest.mjs'), '--check-schedule'],
    grade: (result) => (result.error ? GRADES.UNVERIFIED : result.status === 0 ? GRADES.PASS : GRADES.FAIL),
    meaning: 'the generated schedule matches the manifest that produced it',
  },
  'schedule-installed': {
    argv: [
      process.execPath,
      join(ROOT, 'scripts', 'dr-schedule-install.mjs'),
      '--check',
    ],
    // Exit codes: 0 installed and current, 1 not installed, 2 drift, 3 refused, 4 no facility.
    // Only 0 and 2 grade the world; 1 and 4 are "this environment has no cron to look at", which
    // is an unverified claim, not a false one.
    grade: (result) => {
      if (result.error) return GRADES.UNVERIFIED;
      if (result.status === 0) return GRADES.PASS;
      if (result.status === 2) return GRADES.FAIL;
      if (result.status === 1 || result.status === 4) return GRADES.UNVERIFIED;
      return GRADES.UNVERIFIED;
    },
    meaning: 'the schedule is actually installed on this host and still matches the artifact',
  },
  'rls-audit': {
    argv: [
      process.execPath,
      join(ROOT, 'scripts', 'rls-enablement.mjs'),
      'audit',
      '--json',
    ],
    // The engine probe exits 2 when it cannot reach a database: that is "unverified", and the
    // distinction is the whole reason this probe is worth having.
    grade: (result) => {
      if (result.error) return GRADES.UNVERIFIED;
      if (result.status === 0) return GRADES.PASS;
      if (result.status === 1) return GRADES.FAIL;
      return GRADES.UNVERIFIED;
    },
    meaning: 'row-level-security isolation audited against a live database',
  },
});

const EXIT = Object.freeze({
  OK: 0,
  REHEARSAL_FAILED: 1,
  DRIFT: 2,
  REFUSED: 3,
});

/**
 * Compose the read-only operational picture: is the plan valid, is its generated schedule current,
 * is that schedule installed on this host, are the backup obligations within cadence, is the
 * row-level-security evidence verified, and is the drill within its own cadence.
 *
 * Every part is produced by the function that owns that law - `validateManifest`, `scheduleDrift`,
 * the installer's `checkInstall` behind the probe allowlist, `dueReport`, `verifyRlsEvidence`,
 * `drillDueReport` - because a status page that re-derives rules is a second source of truth with a
 * prettier layout. Nothing here writes, nothing here reaches a database, and the document keeps
 * the grades separate instead of averaging them into a single "looks fine".
 */
export function buildStatus({
  manifest,
  manifestText,
  scheduleFindings,
  ledgerEntries,
  ledgerProblems,
  rehearsalRecords,
  rehearsalProblems,
  installedProbe,
  rls,
  atMs,
  atIso,
}) {
  const parts = {};
  const worst = [];

  const manifestErrors = validateManifest(manifest, ROOT);
  parts.manifest = {
    grade: manifestErrors.length > 0 ? 'fail' : 'pass',
    detail:
      manifestErrors.length > 0
        ? `${manifestErrors.length} validation failure(s)`
        : `${(manifest.components ?? []).length} components, RPO ${manifest.rpoMinutes}m / RTO ${manifest.rtoHours}h, drill every ${manifest.drill?.cadenceDays ?? '?'}d`,
    findings: manifestErrors,
  };

  parts.schedule = {
    grade: scheduleFindings.length > 0 ? 'fail' : 'pass',
    detail:
      scheduleFindings.length > 0
        ? `the generated schedule disagrees with the manifest (${scheduleFindings.length} finding(s))`
        : `${SCHEDULE_REL} matches a fresh generation`,
    findings: scheduleFindings,
  };

  parts.installed = installedProbe
    ? {
        grade: installedProbe.grade,
        detail:
          installedProbe.grade === 'pass'
            ? 'the host crontab carries the managed block and matches the artifact'
            : installedProbe.grade === 'fail'
              ? 'the installed block differs from the artifact - re-install or re-generate'
              : 'this host has no cron facility, or no block, so installation is unproven here',
        exitStatus: installedProbe.status,
      }
    : { grade: 'skipped', detail: 'no probe ran', exitStatus: null };

  // An absent ledger is not "no obligations": the rows are still produced, every one of them
  // reading "never recorded", because the empty case is precisely what the board has to say out
  // loud. `dueReport` is the generator's own function, so the wording cannot drift from `--due`.
  const rows = dueReport(manifest, ledgerEntries ?? [], atMs);
  const due = rows.filter((row) => row.state === 'due');
  const waived = rows.filter((row) => row.state === 'waived');
  parts.backupLedger = {
    grade:
      ledgerProblems.length > 0
        ? 'fail'
        : rows.length === 0
          ? 'unverified'
          : due.length > 0
            ? 'fail'
            : waived.length === rows.length
              ? 'skipped'
              : 'pass',
    detail:
      ledgerProblems.length > 0
        ? `${ledgerProblems.length} malformed ledger line(s): ${ledgerProblems[0]}`
        : rows.length === 0
          ? 'no component declares an obligation or a waiver'
          : ledgerEntries === null
            ? `no backup ledger at ${DR_LEDGER_REL}: ${due.length} obligation(s) read as never recorded`
            : `${rows.length - due.length - waived.length}/${rows.length - waived.length} obligations current, ${due.length} due`,
    due: due.map((row) => row.component),
    rows: rows.map((row) => ({ component: row.component, state: row.state, line: row.line })),
  };

  parts.rls = rls
    ? {
        grade: rls.grade,
        detail: `${rls.checks.filter((check) => check.grade === 'pass').length}/${rls.checks.length} verification checks pass; ${rls.assertion}`,
        findings: rls.findings,
        scope: rls.scope,
        // Carried through verbatim rather than summarized: whoever reads a status page must not be
        // able to mistake it for the platform's enablement claim.
        enabled: rls.enabled,
      }
    : { grade: 'unverified', detail: 'the verifier could not run', enabled: null, findings: [] };

  const drill = drillDueReport({ manifest, records: rehearsalRecords, atMs });
  parts.drill = {
    grade:
      rehearsalProblems.length > 0
        ? 'fail'
        : drill.due.length > 0
          ? drill.latest === null
            ? 'unverified'
            : 'fail'
          : 'pass',
    detail:
      rehearsalProblems.length > 0
        ? `${rehearsalProblems.length} malformed rehearsal ledger line(s): ${rehearsalProblems[0]}`
        : drill.latest === null
          ? 'no rehearsal has ever been recorded; the plan is untested'
          : `last record ${drill.latest.rehearsalId} (${drill.latest.grade}, ${drill.latest.mode}) ${drill.ageHours}h ago of ${drill.cadenceHours}h`,
    findings: drill.findings,
    latest: drill.latest === null ? null : { rehearsalId: drill.latest.rehearsalId, grade: drill.latest.grade, mode: drill.latest.mode, generatedAt: drill.latest.generatedAt },
  };

  for (const part of Object.values(parts)) worst.push(part.grade);
  const grade = worst.includes('fail') ? 'fail' : worst.includes('unverified') ? 'unverified' : worst.every((value) => value === 'skipped') ? 'skipped' : 'pass';

  return {
    schema: 'wlct.dr.status/1',
    toolVersion: TOOL_VERSION,
    generatedAt: atIso,
    manifest: { path: MANIFEST_REL, sha256: digest(manifestText) },
    grade,
    parts,
    // The boundary of this document, printed rather than implied: nothing in here observed a
    // running system, so "all green" means "every repository-side artifact is consistent and in
    // cadence", and no more than that.
    boundary:
      'read-only repository-side verification; no database, queue, engine or cloud call was made, and no money-path behaviour is implied by any grade in this document',
  };
}

const MANIFEST_REL = relative(ROOT, MANIFEST_PATH).split('\\').join('/');
const SCHEDULE_REL = relative(ROOT, SCHEDULE_PATH).split('\\').join('/');
const DR_LEDGER_REL = relative(ROOT, DR_LEDGER_PATH).split('\\').join('/');

/* ------------------------------------------------------------------ *
 * ledgers: the rehearsal log, and the drill cadence that ages against it
 * ------------------------------------------------------------------ */

/**
 * Parse `rehearsals.jsonl`. Same shape rules as the DR ledger: a malformed line is a finding, not
 * a skip, because an evidence log you can quietly corrupt is an evidence log you cannot cite.
 */
export function parseRehearsals(text) {
  const records = [];
  const errors = [];
  const lines = String(text ?? '').split('\n');
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      errors.push(`line ${index + 1}: not JSON (${error.message})`);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      errors.push(`line ${index + 1}: must be a JSON object`);
      return;
    }
    if (!GRADE_VALUES.has(parsed.grade)) {
      errors.push(`line ${index + 1}: grade must be one of ${[...GRADE_VALUES].join(', ')}, got ${JSON.stringify(parsed.grade)}`);
    }
    if (typeof parsed.rehearsalId !== 'string' || parsed.rehearsalId === '') {
      errors.push(`line ${index + 1}: rehearsalId must be a non-empty string`);
    }
    if (typeof parsed.generatedAt !== 'string' || Number.isNaN(Date.parse(parsed.generatedAt))) {
      errors.push(`line ${index + 1}: generatedAt must be an ISO-8601 timestamp`);
    }
    // The law that keeps this log honest, enforced on read as well as on write: a rehearsal that
    // never ran cannot report success, whatever a later editor thinks it means.
    if (parsed.mode === 'dry-run' && parsed.grade === GRADES.PASS) {
      errors.push(`line ${index + 1}: a dry run cannot be recorded as pass`);
    }
    records.push(parsed);
  });
  return { records, errors };
}

/** The drill's own clock: the latest rehearsal of any kind, aged against `drill.cadenceDays`. */
export function drillDueReport({ manifest, records, atMs }) {
  const cadenceDays = manifest?.drill?.cadenceDays;
  if (!Number.isInteger(cadenceDays) || cadenceDays < 1) {
    return { findings: ['drill: cadenceDays missing or not a positive integer - the cadence cannot be aged'], due: [] };
  }
  const cadenceMs = cadenceDays * 24 * 60 * 60 * 1000;
  const latest = records
    .filter((r) => typeof r.generatedAt === 'string' && !Number.isNaN(Date.parse(r.generatedAt)))
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
  if (!latest) {
    return {
      cadenceHours: Math.round(cadenceMs / 3_600_000),
      findings: [`drill: never rehearsed (cadence ${cadenceDays}d) - run this tool; a plan with no rehearsal is the state the DR document calls a hope`],
      due: ['drill'],
      latest: null,
    };
  }
  const ageMs = atMs - Date.parse(latest.generatedAt);
  const base = { cadenceHours: Math.round(cadenceMs / 3_600_000), latest, ageHours: Math.round(ageMs / 3_600_000) };
  if (ageMs > cadenceMs) {
    return {
      ...base,
      findings: [`drill: last rehearsal ${base.ageHours}h ago exceeds the ${cadenceDays}d cadence (mode ${latest.mode}, grade ${latest.grade})`],
      due: ['drill'],
    };
  }
  return { ...base, findings: [], due: [] };
}

/* ------------------------------------------------------------------ *
 * preflight: everything that must be true before a plan is worth running
 * ------------------------------------------------------------------ */

const repoPath = (value, fallback, label) => {
  const candidate = value === undefined || value === null ? fallback : String(value);
  if (candidate.includes('\0')) {
    throw new Error(`${label}: path contains a NUL byte`);
  }
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(ROOT, candidate);
  const rel = relative(ROOT, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label}: refusing a path outside the repository (${candidate})`);
  }
  return absolute;
};

/**
 * Resolve one declared component path against the repository root, refusing anything that escapes
 * it. The manifest is trusted content, but "trusted" here means "a human reviewed it", not "safe
 * to hand to the filesystem": a `..` in a path field would let a rehearsal read outside the tree
 * and report on it as though it were part of the plan.
 */
const safeRepoPath = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return { error: 'not a non-empty string' };
  if (value.includes('\0')) return { error: 'contains a NUL byte' };
  if (isAbsolute(value)) return { error: 'absolute paths are not allowed in the manifest' };
  const absolute = resolve(ROOT, value);
  const rel = relative(ROOT, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) return { error: 'escapes the repository root' };
  return { absolute, relativePath: rel.split('\\').join('/') };
};

/**
 * The clock, and the only way to move it. `--at` (or an injected `now`) makes a rehearsal
 * reproducible - a test, a CI job replaying a failure, and a reviewer all need to be able to say
 * "grade this as of that instant". There is no other knob, because a rehearsal whose age can be
 * tuned after the fact is not evidence: the ledger keeps the instant it was run, and `--at` only
 * changes what the *aging* is measured against.
 */
const isoNow = (at) => {
  let ms;
  if (at === undefined || at === null) ms = Date.now();
  else if (typeof at === 'number') ms = at;
  else ms = Date.parse(String(at));
  if (!Number.isFinite(ms) || Number.isNaN(ms)) {
    throw new Error(`--at is not an ISO-8601 timestamp: ${JSON.stringify(String(at))}`);
  }
  return { atMs: ms, atIso: new Date(ms).toISOString() };
};

const canonicalJson = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};

const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Build the deterministic plan.
 *
 * Everything a rehearsal will do or check is decided here, from the manifest plus the host's
 * declared state, with no clock and no randomness: two runs at different times produce byte-identical
 * plans, which is what lets the plan's hash be the confirmation token. Steps are ordered by
 * `restoreOrder`, and the derived ordering law between `restoreProcedure` and the components is
 * checked here rather than in a validator, because an out-of-order restore is exactly the mistake
 * a rehearsal exists to catch.
 */
export function buildPlan({ manifest, root = ROOT, envNames = null, target = 'local' }) {
  const components = [...(manifest.components ?? [])].sort((a, b) => a.restoreOrder - b.restoreOrder);
  const byId = new Map(components.map((component) => [component.id, component]));
  const steps = [];
  const findings = [];

  const procedure = Array.isArray(manifest.restoreProcedure) ? manifest.restoreProcedure : [];
  const seenInProcedure = new Set();
  procedure.forEach((entry, index) => {
    if (typeof entry?.step !== 'number' || entry.step !== index + 1) {
      findings.push(`restoreProcedure[${index}]: step must be ${index + 1}, got ${JSON.stringify(entry?.step)}`);
    }
    const component = byId.get(entry?.component);
    if (entry?.component === null || entry?.component === undefined) {
      // The manifest's existing convention: a step with no component is a post-restore
      // instruction ("start the worker and confirm claims", "write the record down"). It belongs in
      // the rehearsal plan - it is part of what "the drill happened" means - but it has no paths
      // and no env names to check, so it is graded by whether a human says it happened, never by
      // anything this tool can observe.
      steps.push({
        id: `procedure-step:${entry.step}`,
        order: index + 1,
        component: null,
        title: 'Procedural step (no component of its own)',
        kind: 'procedure',
        action: entry.action ?? '',
        executor: 'operator',
        grade: GRADES.PLANNED,
        checks: [
          {
            type: 'procedure',
            name: `step ${entry.step}`,
            grade: GRADES.UNVERIFIED,
            detail: 'a post-restore instruction in the manifest; nothing in this repository can observe it',
          },
        ],
      });
      return;
    }
    if (!component) {
      findings.push(`restoreProcedure[${index}]: names unknown component ${JSON.stringify(entry?.component)}`);
      return;
    }
    if (seenInProcedure.has(component.id)) {
      findings.push(`restoreProcedure: component ${component.id} appears twice`);
      return;
    }
    seenInProcedure.add(component.id);
    if (component.restoreOrder !== entry.step) {
      findings.push(
        `restoreProcedure: step ${entry.step} restores ${component.id}, whose declared restoreOrder is ${component.restoreOrder}`,
      );
    }
    if (typeof entry.action !== 'string' || entry.action.trim() === '') {
      findings.push(`restoreProcedure step ${entry.step}: action must be a non-empty string`);
    }
  });
  for (const component of components) {
    if (!seenInProcedure.has(component.id)) {
      findings.push(`component ${component.id} has no restoreProcedure step - the plan cannot be rehearsed`);
    }
  }

  const dependencyBlocked = new Set();
  procedure.forEach((entry, index) => {
    const component = byId.get(entry?.component);
    if (!component) return;
    const step = {
      id: `restore:${component.id}`,
      order: index + 1,
      component: component.id,
      title: component.title ?? component.id,
      kind: component.kind ?? 'unknown',
      action: entry.action ?? '',
      // A restore step is an operator action by construction: this tool has no lever on an
      // environment, and says so instead of pretending to have pulled a trigger.
      executor: 'operator',
      grade: GRADES.PLANNED,
      checks: [],
    };

    for (const declared of component.paths ?? []) {
      const resolved = safeRepoPath(declared);
      if (resolved.error) {
        step.checks.push({
          type: 'path',
          name: declared,
          grade: GRADES.FAIL,
          detail: `path ${JSON.stringify(declared)} is not usable: ${resolved.error}`,
        });
        continue;
      }
      let present = false;
      let kind = null;
      try {
        present = existsSync(resolved.absolute);
        if (present) kind = statSync(resolved.absolute).isDirectory() ? 'directory' : 'file';
      } catch (error) {
        step.checks.push({ type: 'path', name: resolved.relativePath, grade: GRADES.UNVERIFIED, detail: `stat failed: ${error.message}` });
        continue;
      }
      step.checks.push({
        type: 'path',
        name: resolved.relativePath,
        grade: present ? GRADES.PASS : GRADES.FAIL,
        detail: present ? `declared artifact present (${kind})` : 'declared artifact missing from the repository',
      });
    }

    for (const ref of component.envRefs ?? []) {
      const declaredInTemplate = envNames === null ? null : envNames.has(ref);
      const setInEnvironment = process.env[ref] !== undefined && process.env[ref] !== '';
      step.checks.push({
        type: 'env',
        name: ref,
        // Only the name is reported, never a value, and never a length: "is it set" is what a
        // rehearsal can answer; "what is it" is what an evidence file must never answer.
        grade:
          declaredInTemplate === false
            ? GRADES.FAIL
            : setInEnvironment
              ? GRADES.PASS
              : GRADES.UNVERIFIED,
        detail:
          declaredInTemplate === false
            ? 'referenced by the manifest but absent from every .env.example template'
            : setInEnvironment
              ? 'name is set in this process environment (value not read, not recorded)'
              : 'name exists in the templates but is not set here; only the restored deployment can answer for it',
      });
    }

    if (typeof component.verification === 'string' && component.verification.trim() !== '') {
      step.checks.push({
        type: 'verification',
        name: `${component.id}:verification`,
        grade: GRADES.UNVERIFIED,
        detail: 'operator prose from the manifest; a rehearsal records that it is required, not that it succeeded',
      });
    }
    if (typeof component.backupMethod === 'string' && component.backupMethod.trim() !== '') {
      step.checks.push({
        type: 'backupMethod',
        name: `${component.id}:backupMethod`,
        grade: GRADES.UNVERIFIED,
        detail: 'the backup mechanism is external to this repository; the drill record is the only evidence',
      });
    }

    steps.push(step);
  });
  // One ordering, from the procedure: the component pass above runs over `components` (sorted by
  // restoreOrder) while the procedural steps came from the procedure walk, so the two would
  // otherwise interleave wrongly in a report. The manifest validator now refuses a disagreement
  // between those two representations, which makes this sort a display step rather than a repair -
  // if they diverge again, --check fails before a rehearsal can paper over it.
  steps.sort((a, b) => a.order - b.order);

  // Dependency law, stated as data rather than prose: key material before the database that needs
  // it, deployment config before anything that runs against a restored schema. A step whose
  // predecessors failed its own checks is marked blocked, which is how a rehearsal stops reporting
  // a clean plan while a later step depends on an artifact that is not there.
  const failedByComponent = new Map();
  for (const step of steps) {
    if (step.component === null) continue;
    const failed = step.checks.some((check) => check.grade === GRADES.FAIL);
    failedByComponent.set(step.component, failed);
  }
  for (const step of steps) {
    for (const earlier of steps.slice(0, step.order - 1)) {
      const earlierKeyMaterial = earlier.kind === 'sealed-secrets' || /key/i.test(earlier.component);
      if (earlierKeyMaterial && failedByComponent.get(earlier.component) && step.blockedBy === undefined) {
        if (step.component !== null) dependencyBlocked.add(step.component);
        step.blockedBy = earlier.component;
        step.warnings = step.warnings ?? [];
        step.warnings.push(
          `planned after ${earlier.component}, whose key-material checks failed; the manifest says stop the line rather than restore forward`,
        );
      }
    }
  }

  // The criteria are the drill's own words, kept verbatim, each with the reason it is still open.
  // A plan may never grant one: the grades here are `planned`, and `execute` re-grades them in
  // evaluateCriteria() from probe outcomes only.
  const criteria = (manifest.drill?.successCriteria ?? []).map((criterion, index) => ({
    id: `criterion:${index + 1}`,
    text: criterion,
    grade: GRADES.PLANNED,
    detail: 'stated in the manifest; only a rehearsal record with executed probes can move it',
  }));

  return {
    schema: 'wlct.dr.rehearsal-plan/1',
    toolVersion: TOOL_VERSION,
    target,
    // No clock, no host paths, no run-specific values anywhere in the plan: the plan's hash is the
    // confirmation token, and a token that changed between two views of the same manifest would
    // teach operators to copy whatever the tool printed instead of reading what it meant.
    environment: { declared: TARGETS[target]?.nonProduction === true, known: Object.keys(TARGETS) },
    rpoMinutes: manifest.rpoMinutes ?? null,
    rtoHours: manifest.rtoHours ?? null,
    order: steps.map((step) => step.component).filter((id) => id !== null),
    proceduralSteps: steps.filter((step) => step.component === null).map((step) => step.order),
    dependencyBlocked: [...dependencyBlocked].sort(),
    steps,
    criteria,
    findings,
  };
}

/** The rehearsal id: the plan's identity, which is also the confirmation token. */
export const rehearsalIdFor = (plan) => digest(canonicalJson(plan)).slice(0, 16);

/* ------------------------------------------------------------------ *
 * execution
 * ------------------------------------------------------------------ */

/** Run one allowlisted probe. Structured argv, no shell, bounded output, timeout. */
function runProbe(name, { timeoutMs = 120_000 } = {}) {
  const probe = PROBES[name];
  if (!probe) {
    throw new Error(`unknown probe ${JSON.stringify(name)}; the allowlist is closed`);
  }
  const result = spawnSync(probe.argv[0], probe.argv.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    env: {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME ?? '/root',
      LC_ALL: 'C',
      // The probes that need a database get it exactly the way the service does: by name, from
      // this process, never passed through the plan or the artifact.
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.ENGINE_INTERNAL_TOKEN ? { ENGINE_INTERNAL_TOKEN: process.env.ENGINE_INTERNAL_TOKEN } : {}),
    },
  });
  const stdout = (result.stdout ?? '').slice(0, 64 * 1024);
  const stderr = (result.stderr ?? '').slice(0, 16 * 1024);
  return {
    probe: name,
    argv: probe.argv.map((arg) => {
      if (arg === process.execPath) return 'node';
      if (arg === ROOT) return '.';
      if (typeof arg === 'string' && arg.startsWith(ROOT + '/')) return arg.slice(ROOT.length + 1);
      return arg;
    }),
    meaning: probe.meaning,
    status: result.status,
    error: result.error ? String(result.error.code ?? result.error.message) : null,
    timedOut: Boolean(result.error && /ETIMEDOUT|timeout/i.test(String(result.error.message ?? ''))),
    // The *shape* of the answer, not the answer: a rehearsal record that pasted probe output would
    // be a place for secrets to accumulate.
    outputDigest: stdout.trim() === '' ? null : digest(stdout).slice(0, 16),
    grade: probe.grade({ error: result.error ? String(result.error.code ?? result.error.message) : null, status: result.status }),
    stdout,
    stderr,
  };
}

/**
 * Grade the whole rehearsal from its parts.
 *
 * `pass` requires that at least one probe actually ran and nothing failed; a rehearsal made only of
 * planned steps is `planned`, never `pass`, however tidy the plan looks. This function is the
 * single place a grade is assigned, which is what makes the "no invented success" law testable.
 */
export function gradeRehearsal({ plan, probes, execute, confirmationValid, targetAllowed, rpoEvidence = [], scheduleFindings = [] }) {
  const failedChecks = [];
  const warnings = [];
  for (const step of plan.steps) {
    for (const check of step.checks) {
      if (check.grade === GRADES.FAIL) failedChecks.push(`${step.id}/${check.type}:${check.name}`);
      if (check.grade === GRADES.SKIPPED) warnings.push(`waived: ${step.id}/${check.type}:${check.name}`);
      if (check.grade === GRADES.UNVERIFIED) warnings.push(`unverified: ${step.id}/${check.type}:${check.name}`);
    }
    for (const warning of step.warnings ?? []) warnings.push(`blocked: ${step.component}: ${warning}`);
  }
  for (const finding of plan.findings) failedChecks.push(`plan:${finding}`);
  // Schedule drift is a rehearsal failure rather than a footnote: the plan being rehearsed and the
  // schedule the host is supposed to be ageing are the same data, and the moment they disagree the
  // rehearsal is describing a plan nobody runs.
  for (const finding of scheduleFindings) failedChecks.push(`schedule:${finding}`);

  const probeGrades = probes.map((probe) => probe.grade);
  for (const probe of probes) {
    if (probe.grade === GRADES.FAIL) failedChecks.push(`probe:${probe.probe}`);
    if (probe.grade === GRADES.UNVERIFIED) warnings.push(`probe unverified: ${probe.probe}${probe.error ? ` (${probe.error})` : ''}`);
  }

  for (const item of rpoEvidence ?? []) {
    if (item.grade === GRADES.FAIL) failedChecks.push(`rpo:${item.component}`);
    if (item.grade === GRADES.UNVERIFIED) warnings.push(`rpo evidence absent: ${item.component}`);
  }

  const anyExecuted = probeGrades.some((grade) => grade === GRADES.PASS || grade === GRADES.FAIL);
  let grade;
  if (!targetAllowed) {
    grade = GRADES.FAIL;
    failedChecks.push('target: the rehearsal target is not provably non-production');
  } else if (execute && !confirmationValid) {
    grade = GRADES.FAIL;
    failedChecks.push('confirmation: destructive execution was requested without mirroring the plan id');
  } else if (failedChecks.length > 0) {
    grade = GRADES.FAIL;
  } else if (!execute || !anyExecuted) {
    grade = GRADES.PLANNED;
  } else {
    grade = GRADES.PASS;
  }
  return { grade, failedChecks, warnings, anyExecuted };
}

/**
 * Grade the drill's success criteria from executed probes only.
 *
 * The mapping is deliberately narrow and is stated here rather than in a table someone can extend
 * by intuition: criterion 1 needs a timed restore, which no probe in the closed allowlist observes,
 * so it stays `unverified` *by construction* even on a fully successful run - the honest reading of
 * "the runner finished in 40 ms". Criterion 2 needs each component's verification prose executed,
 * which this tool cannot do, so it also stays `unverified`. Criterion 3 names the audit and the
 * schedule-side probes, all of which do exist in the allowlist, so it can pass.
 *
 * The one thing this function must never do is turn a `planned` step into a pass.
 */
export function evaluateCriteria({ plan, probes, grade }) {
  if (probes.length === 0) {
    // Nothing ran, so nothing moves: the criteria stay exactly as the plan built them (`planned`).
    // Marking them `unverified` here would be a small lie in the interesting direction - it would
    // read as "we looked and could not tell", when the truth is "this run did not look".
    return plan.criteria.map((criterion) => ({ ...criterion }));
  }
  const byProbe = new Map(probes.map((probe) => [probe.probe, probe]));
  const ran = (name) => byProbe.get(name)?.grade === GRADES.PASS;
  const attempted = probes.length > 0 && grade !== GRADES.FAIL;
  const criteria = plan.criteria.map((criterion) => ({ ...criterion }));
  const [timed, verifications, probes3] = criteria;
  if (timed) {
    timed.grade = GRADES.UNVERIFIED;
    timed.detail =
      'needs a timed restore of the real dataset; no probe in the closed allowlist observes a restore, ' +
      "and the runner's own elapsed time is not a restore time";
  }
  if (verifications) {
    const unresolved = plan.steps.filter(
      (step) =>
        step.component !== null &&
        !step.checks.some((check) => check.type === 'verification' && check.grade === GRADES.PASS),
    );
    verifications.grade = attempted && unresolved.length === 0 ? GRADES.PASS : GRADES.UNVERIFIED;
    verifications.detail =
      unresolved.length === 0
        ? 'every component carries a verification outcome in this record'
        : `${unresolved.length} component(s) have no recorded verification outcome: ${unresolved.map((s) => s.component).join(', ')}`;
  }
  if (probes3) {
    const needed = ['manifest-valid', 'schedule-current', 'schedule-installed', 'rls-audit'];
    const passed = needed.filter(ran);
    probes3.grade =
      passed.length === needed.length
        ? GRADES.PASS
        : attempted && passed.length > 0
          ? GRADES.UNVERIFIED
          : GRADES.PLANNED;
    probes3.detail = `${passed.length}/${needed.length} of the named probes passed${passed.length === needed.length ? '' : ` (${needed.filter((n) => !ran(n)).join(', ')} outstanding)`}`;
  }
  return criteria;
}

/* ------------------------------------------------------------------ *
 * the report: what a human reads, and what a schedule reads
 * ------------------------------------------------------------------ */

export function renderRehearsal({ record, evidencePath, wrote }) {
  const lines = [];
  lines.push(`DR rehearsal ${record.rehearsalId} - ${record.grade.toUpperCase()} (${record.mode})`);
  lines.push(
    `  target ${record.environment.target}; manifest ${record.manifest.sha256.slice(0, 12)}…; ` +
      `plan ${record.plan.sha256.slice(0, 12)}…; tool ${record.toolVersion}`,
  );
  lines.push(`  restore order: ${record.plan.order.join(' -> ')}`);
  if (record.plan.dependencyBlocked.length > 0) {
    lines.push(`  blocked by an earlier failure: ${record.plan.dependencyBlocked.join(', ')}`);
  }
  lines.push(
    `  RPO declared ${record.slo.rpoMinutes} min; RTO declared ${record.slo.rtoHours} h; ` +
      `observed RTO ${record.slo.rtoObservedHours === null ? 'UNVERIFIED (no timed restore behind this record)' : `${record.slo.rtoObservedHours} h`}`,
  );
  lines.push(`  runner elapsed ${(record.timing.runnerElapsedMs / 1000).toFixed(3)} s`);
  lines.push('  backup evidence (from the human ledger; "no backup ledger" is a state, not a pass):');
  for (const item of record.slo.rpoEvidence) {
    lines.push(`    [${item.grade === 'pass' ? '+' : item.grade === 'fail' ? 'x' : item.grade === 'skipped' ? 's' : '-'}] ${item.component.padEnd(18)} ${item.evidence}`);
  }
  lines.push('  steps:');
  for (const step of record.steps) {
    const marks = { pass: '+', fail: 'x', unverified: '?', planned: '-', skipped: 's' };
    const counts = step.checks.reduce(
      (acc, check) => {
        acc[check.grade] = (acc[check.grade] ?? 0) + 1;
        return acc;
      },
      {},
    );
    const tally = Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    lines.push(
      `    [${marks[step.grade] ?? '?'}] ${String(step.order).padStart(2)}. ${(step.component ?? '(procedural)').padEnd(18)} ` +
        `${step.grade.toUpperCase().padEnd(10)} ${tally}${step.blockedBy ? ` (after ${step.blockedBy})` : ''}`,
    );
  }
  lines.push('  probes:');
  if (record.probes.length === 0) {
    lines.push('    (none executed - this is a plan; --execute runs the allowlisted probes)');
  }
  for (const probe of record.probes) {
    lines.push(`    [${probe.grade === 'pass' ? '+' : probe.grade === 'fail' ? 'x' : '?'}] ${probe.probe.padEnd(20)} ${probe.grade.toUpperCase()} exit=${probe.status ?? 'n/a'}`);
  }
  lines.push('  drill criteria (a plan cannot grant these; the record is the evidence):');
  for (const criterion of record.criteria) {
    lines.push(`    [${criterion.grade === 'pass' ? '+' : criterion.grade === 'fail' ? 'x' : '-'}] ${criterion.id}: ${criterion.grade.toUpperCase()}`);
  }
  if (record.failedChecks.length > 0) {
    lines.push(`  failed checks (${record.failedChecks.length}):`);
    for (const failure of record.failedChecks) lines.push(`    - ${failure}`);
  }
  if (record.warnings.length > 0) {
    lines.push(`  warnings (${record.warnings.length}):`);
    for (const warning of record.warnings.slice(0, 12)) lines.push(`    - ${warning}`);
    if (record.warnings.length > 12) lines.push(`    … ${record.warnings.length - 12} more`);
  }
  lines.push(
    `  evidence: ${evidencePath === null ? 'not written' : wrote ? `appended to ${relative(ROOT, evidencePath)}` : 'not written (dry run)'}`,
  );
  lines.push(
    `  operator reference: ${record.operator === null ? 'none supplied' : record.operator} - ` +
      'a rehearsal is graded by what it ran, not by who ran it',
  );
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const usage = () =>
  [
    'usage:',
    '  node scripts/dr-rehearsal.mjs --target staging [--manifest PATH] [--schedule PATH] [--ledger PATH]',
    '                                     [--out PATH|none] [--at ISO] [--operator NAME] [--json]',
    '  node scripts/dr-rehearsal.mjs --target staging --execute --confirm <rehearsalId> [--emit-evidence]',
    '  node scripts/dr-rehearsal.mjs --due [--at ISO]',
    '  node scripts/dr-rehearsal.mjs --status [--at ISO] [--json] [--no-probe]',
    '',
    'default mode is a dry run: the plan is graded PLANNED, no probe runs, and nothing outside the',
    'repository is touched. --execute runs the probe allowlist (and only the allowlist) and still',
    'restores nothing; destructive steps stay operator-run. --target production is refused, and so',
    'is an unknown target: this tool will not guess that a name is harmless.',
    '',
    'status is a read-only board over the same laws - manifest, schedule, host installation, backup',
    'ledger, RLS verifier, drill cadence - with --json for a machine that has to decide something.',
    '--no-probe skips the one part that shells out (the installer check), for CI with no cron.',
    '',
    'evidence: a dry run prints the record and writes nothing; --emit-evidence appends it to',
    'docs/dr/rehearsals.jsonl, which is what --due ages the drill against.',
    '',
    'exit codes: 0 pass or planned-clean, 1 rehearsal failed (or --due says it is time), 2 manifest',
    'or schedule drift, 3 refused or unverified.',
  ].join('\n');

const parseArgs = (argv) => {
  const flags = {};
  const modes = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    const name = arg.slice(2);
    if (['json', 'plan-only', 'emit-evidence', 'no-probe'].includes(name)) {
      if (flags[name]) throw new Error(`--${name} given twice`);
      flags[name] = true;
      continue;
    }
    if (['execute', 'due', 'status'].includes(name)) {
      if (modes.length > 0) throw new Error(`--execute, --due and --status are mutually exclusive (got ${modes.join(', ')} and ${name})`);
      modes.push(name);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    if (name in flags) throw new Error(`--${name} given twice`);
    flags[name] = value;
    i += 1;
  }
  return { mode: modes[0] ?? 'rehearse', flags };
};

export function main(argv, { out = console, env = process.env, now = null } = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    out.error(`dr-rehearsal: ${error.message}`);
    out.error(usage());
    return EXIT.REFUSED;
  }
  const { mode, flags } = parsed;
  if (flags.help || argv.length === 0) {
    out.log(usage());
    return EXIT.OK;
  }

  let at;
  try {
    at = isoNow(flags.at !== undefined ? flags.at : now);
  } catch (error) {
    out.error(`dr-rehearsal: ${error.message}`);
    return EXIT.REFUSED;
  }

  let manifestPath;
  let schedulePath;
  let drLedgerPath;
  let evidencePath;
  try {
    manifestPath = repoPath(flags.manifest, MANIFEST_PATH, '--manifest');
    schedulePath = repoPath(flags.schedule, SCHEDULE_PATH, '--schedule');
    drLedgerPath = repoPath(flags.ledger, DR_LEDGER_PATH, '--ledger');
    evidencePath = flags.out === 'none' ? null : repoPath(flags.out, EVIDENCE_PATH, '--out');
  } catch (error) {
    out.error(`dr-rehearsal: ${error.message}`);
    return EXIT.REFUSED;
  }

  let manifestText;
  try {
    manifestText = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    out.error(`dr-rehearsal: cannot read the manifest: ${error.message}`);
    return EXIT.REFUSED;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    out.error(`dr-rehearsal: manifest is not readable JSON: ${error.message}`);
    return EXIT.REFUSED;
  }

  const manifestErrors = validateManifest(manifest, ROOT);
  if (manifestErrors.length > 0 && mode !== 'due') {
    out.error(`dr-rehearsal: the manifest does not validate; refusing to rehearse an invalid plan (${manifestErrors.length} finding(s))`);
    for (const error of manifestErrors) out.error(`  - ${error}`);
    return EXIT.REFUSED;
  }
  let scheduleFindings = [];
  try {
    scheduleFindings = scheduleDrift(manifest, readFileSync(schedulePath, 'utf8'));
  } catch (error) {
    scheduleFindings = [`the generated schedule could not be read: ${error.message}`];
  }

  if (mode === 'status') {
    const rehearsal = existsSync(evidencePath ?? EVIDENCE_PATH)
      ? parseRehearsals(readFileSync(evidencePath ?? EVIDENCE_PATH, 'utf8'))
      : { records: [], errors: [] };
    let ledgerEntries = [];
    let ledgerProblems = [];
    if (existsSync(drLedgerPath)) {
      const parsed = parseLedger(readFileSync(drLedgerPath, 'utf8'), new Set((manifest.components ?? []).map((c) => c.id)));
      ledgerEntries = parsed.entries;
      ledgerProblems = parsed.problems;
    } else {
      ledgerProblems = [];
      ledgerEntries = null;
    }
    const installedProbe = flags['no-probe'] ? null : (() => {
      const { stdout, stderr, ...probe } = runProbe('schedule-installed');
      return probe;
    })();
    const document = buildStatus({
      manifest,
      manifestText,
      scheduleFindings,
      ledgerEntries,
      ledgerProblems,
      rehearsalRecords: rehearsal.records,
      rehearsalProblems: rehearsal.errors,
      installedProbe,
      rls: manifestErrors.length > 0 ? null : verifyRlsEvidence(manifest, { nowMs: at.atMs }),
      atMs: at.atMs,
      atIso: at.atIso,
    });
    if (flags.json) {
      out.log(JSON.stringify(document));
      return document.grade === 'pass' ? EXIT.OK : document.grade === 'unverified' ? EXIT.REFUSED : EXIT.REHEARSAL_FAILED;
    }
    out.log(`operational verification as of ${document.generatedAt} - ${document.grade.toUpperCase()}`);
    out.log(`  manifest ${document.manifest.path} sha256 ${document.manifest.sha256.slice(0, 12)}…`);
    for (const [name, part] of Object.entries(document.parts)) {
      const mark = part.grade === 'pass' ? 'ok  ' : part.grade === 'fail' ? 'FAIL' : part.grade === 'skipped' ? 'skip ' : 'UNVER';
      out.log(`[${mark}] ${name.padEnd(14)} ${part.detail}`);
      for (const finding of (part.findings ?? []).slice(0, 4)) out.log(`         - ${finding}`);
    }
    out.log(`  boundary: ${document.boundary}`);
    return document.grade === 'pass' ? EXIT.OK : document.grade === 'unverified' ? EXIT.REFUSED : EXIT.REHEARSAL_FAILED;
  }

  if (mode === 'due') {
    const rehearsals = existsSync(evidencePath ?? EVIDENCE_PATH)
      ? parseRehearsals(readFileSync(evidencePath ?? EVIDENCE_PATH, 'utf8'))
      : { records: [], errors: [] };
    for (const error of rehearsals.errors) out.error(`rehearsals ledger: ${error}`);
    if (manifestErrors.length > 0) {
      for (const error of manifestErrors) out.error(`manifest: ${error}`);
      return EXIT.DRIFT;
    }
    const report = drillDueReport({ manifest, records: rehearsals.records, atMs: at.atMs });
    for (const finding of report.findings) out.log(`[DUE] ${finding}`);
    if (report.findings.length === 0) {
      out.log(
        `[ ok  ] drill within cadence: last record ${report.latest.rehearsalId} (${report.latest.grade}, ` +
          `${report.latest.mode}) at ${report.latest.generatedAt}, ${report.ageHours}h of ${report.cadenceHours}h used`,
      );
    }
    return rehearsals.errors.length > 0 || report.due.length > 0 ? EXIT.REHEARSAL_FAILED : EXIT.OK;
  }

  // Law 3, before any work: the target must be known and provably non-production.
  const target = flags.target === undefined ? null : String(flags.target);
  if (target === null || target.trim() === '') {
    out.error('dr-rehearsal: --target is required, and "whatever this is" is not a target');
    return EXIT.REFUSED;
  }
  if (target === 'production' || target === 'prod') {
    out.error(
      'dr-rehearsal: production is refused. A DR rehearsal is a deliberate outage; the platform\'s ' +
        'live-mode refusal (EXECUTION_MODE=live) has the same shape and the same reason: the moment a ' +
        'rehearsal is possible is the moment it is not needed.',
    );
    return EXIT.REFUSED;
  }
  const targetAllowed = Object.prototype.hasOwnProperty.call(TARGETS, target) && TARGETS[target].nonProduction === true;
  if (!targetAllowed) {
    out.error(
      `dr-rehearsal: unknown target ${JSON.stringify(target)}; this tool rehearses only environments it can ` +
        `prove are non-production (${Object.keys(TARGETS).join(', ')}). An ambiguous selection is a refusal, ` +
        'not a warning.',
    );
    return EXIT.REFUSED;
  }
  if (env.NODE_ENV === 'production') {
    out.error('dr-rehearsal: NODE_ENV=production - refusing to rehearse in a production process, whatever --target says');
    return EXIT.REFUSED;
  }

  const execute = mode === 'execute';
  if (execute && TARGETS[target].destructive !== true) {
    out.error(`dr-rehearsal: target ${JSON.stringify(target)} is declared non-destructive; run a dry rehearsal instead`);
    return EXIT.REFUSED;
  }

  const plan = buildPlan({ manifest, root: ROOT, envNames: collectEnvNames(ROOT), target });
  if (flags['plan-only']) {
    out.log(canonicalJson(plan));
    return EXIT.OK;
  }

  const rehearsalId = rehearsalIdFor(plan);
  const confirmation = flags.confirm ?? env.DR_REHEARSAL_CONFIRMATION ?? null;
  const confirmationValid = !execute || (confirmation !== null && String(confirmation) === rehearsalId);
  if (execute && !confirmationValid) {
    out.error(
      `dr-rehearsal: --execute requires --confirm ${rehearsalId} (or DR_REHEARSAL_CONFIRMATION). ` +
        'The id is the hash of the plan being approved, so the confirmation cannot be copy-pasted onto a ' +
        'different plan and cannot be set once and forgotten.',
    );
    return EXIT.REFUSED;
  }

  // Observed RPO: what the human ledger says about the last recorded success per component, aged
  // by the generator's own report function. No probing, no inference: an absent ledger is reported
  // as absent, which is the difference between a rehearsal and a wish.
  let rpoEvidence = [];
  let ledgerProblems = [];
  if (existsSync(drLedgerPath)) {
    const parsed = parseLedger(readFileSync(drLedgerPath, 'utf8'), new Set(plan.order));
    ledgerProblems = parsed.problems;
    rpoEvidence = dueReport(manifest, parsed.entries, at.atMs).map((row) => ({
      component: row.component,
      grade:
        row.state === 'ok'
          ? GRADES.PASS
          : row.state === 'due'
            ? GRADES.FAIL
            : GRADES.SKIPPED,
      evidence: row.line,
    }));
  } else {
    rpoEvidence = plan.order.map((component) => ({
      component,
      grade: GRADES.UNVERIFIED,
      evidence: `no backup ledger at ${relative(ROOT, drLedgerPath).split('\\').join('/')} - nothing has been recorded against it`,
    }));
  }

  const startedAt = new Date().toISOString();
  const startHr = process.hrtime.bigint();
  const probes = execute
    ? Object.keys(PROBES).map((name) => {
        const { stdout, stderr, ...record } = runProbe(name);
        return record;
      })
    : [];
  const runnerElapsedMs = Number(process.hrtime.bigint() - startHr) / 1e6;
  const completedAt = new Date().toISOString();

  const graded = gradeRehearsal({ plan, probes, execute, confirmationValid, targetAllowed, rpoEvidence, scheduleFindings });
  const criteria = evaluateCriteria({ plan, probes, grade: graded.grade });

  const record = {
    schema: 'wlct.dr.rehearsal/1',
    rehearsalId,
    generatedAt: at.atIso,
    startedAt,
    completedAt,
    mode: execute ? 'execute' : 'dry-run',
    grade: graded.grade,
    environment: { target, nodeEnv: env.NODE_ENV ?? null, nonProduction: true },
    toolVersion: TOOL_VERSION,
    operator: flags.operator === undefined ? null : String(flags.operator).slice(0, 64),
    manifest: { path: relative(ROOT, manifestPath).split('\\').join('/'), sha256: digest(manifestText) },
    plan: {
      sha256: digest(canonicalJson(plan)),
      order: plan.order,
      dependencyBlocked: plan.dependencyBlocked,
      componentCount: plan.order.length,
    },
    slo: {
      rpoMinutes: plan.rpoMinutes,
      rtoHours: plan.rtoHours,
      // Always null in this version, and pinned that way by a test. The closed probe allowlist
      // contains nothing that can observe a restore duration, so any number here would be the
      // runner inventing an infrastructure result - the one failure mode this file exists to avoid.
      rtoObservedHours: null,
      rpoEvidence,
    },
    timing: { runnerElapsedMs: Math.round(runnerElapsedMs * 1000) / 1000 },
    steps: plan.steps.map((step) => ({
      id: step.id,
      order: step.order,
      component: step.component,
      kind: step.kind,
      executor: step.executor,
      grade: step.grade,
      blockedBy: step.blockedBy ?? null,
      checks: step.checks.map(({ type, name, grade, detail }) => ({ type, name, grade, detail })),
      ...(step.warnings ? { warnings: step.warnings } : {}),
    })),
    probes,
    criteria,
    failedChecks: graded.failedChecks,
    warnings: graded.warnings,
    artifacts: {
      schedule: relative(ROOT, schedulePath).split('\\').join('/'),
      scheduleFindings,
      manifestErrors,
      drLedger: relative(ROOT, drLedgerPath).split('\\').join('/'),
      ledgerProblems,
      rehearsalLedger: evidencePath === null ? null : relative(ROOT, evidencePath).split('\\').join('/'),
    },
  };

  // The write decision is made before rendering so the screen and the ledger carry the same claim;
  // a report that said "not written" next to an appended line would be a small lie of exactly the
  // kind the rest of this file is careful about.
  // An executed rehearsal is written down only when the operator says "this is the record". The
  // alternative - writing on every execute - sounds safer and is not: it makes an ad-hoc probe run
  // in a scratch environment age the drill board, and it makes it impossible to test this tool
  // without appending to a ledger. The nudge below is what carries the obligation instead.
  const writeEvidence = evidencePath !== null && flags['emit-evidence'] === true;
  let wrote = false;
  if (writeEvidence) {
    const line = `${JSON.stringify(record)}\n`;
    const secretFindings = findSecretShapes(line);
    if (secretFindings.length > 0) {
      out.error(`dr-rehearsal: refusing to write evidence containing a secret shape: ${secretFindings[0]}`);
      return EXIT.REFUSED;
    }
    try {
      appendFileSync(evidencePath, line, 'utf8');
      wrote = true;
    } catch (error) {
      out.error(`dr-rehearsal: cannot append the record: ${error.message}`);
      return EXIT.REFUSED;
    }
  }

  if (flags.json) {
    out.log(JSON.stringify(record));
  } else {
    out.log(renderRehearsal({ record, evidencePath, wrote }));
  }

  // DRIFT outranks a failed rehearsal: "the artifact you are rehearsing against is not the current
  // one" is the more actionable sentence of the two, and the schedule job is the thing that has to
  // be re-emitted before anything else on this board means anything.
  if (execute && !writeEvidence) {
    // On stderr, and after the JSON: a machine reading stdout must not have its document followed by
    // a sentence meant for a person.
    out.error(
      'note: this executed rehearsal was not recorded. An executed restore with no record is what '
        + 'the DR document calls a hope - re-run with --emit-evidence when the run you just did is the one that counts.',
    );
  }
  if (scheduleFindings.length > 0) return EXIT.DRIFT;
  return graded.grade === GRADES.FAIL ? EXIT.REHEARSAL_FAILED : EXIT.OK;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
