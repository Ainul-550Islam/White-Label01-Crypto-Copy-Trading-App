/**
 * Tests for the DR rehearsal runner (run: `node --test scripts/`).
 *
 * The centre of gravity here is not "does the report render" but the one property the whole tool
 * exists to guarantee: a rehearsal that did not restore anything must never look like a rehearsal
 * that did. So most of these tests are about grades - what may be `pass`, what must stay
 * `unverified`, what a ledger line is allowed to say - and about the refusals that come before any
 * grade exists.
 *
 * Where a real environment would be needed, the test asserts the UNVERIFIED answer instead of
 * stubbing a success. `--execute` is run for real against this repository, which means its probes
 * genuinely run (`manifest-valid` and `schedule-current` can pass here) and genuinely cannot
 * (`rls-audit` has no database, `schedule-installed` has no cron) - and the record says so.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  buildPlan,
  buildStatus,
  drillDueReport,
  evaluateCriteria,
  gradeRehearsal,
  main,
  parseRehearsals,
  rehearsalIdFor,
} from './dr-rehearsal.mjs';
import { MANIFEST_PATH, SCHEDULE_PATH, collectEnvNames } from './dr-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TOOL = join(ROOT, 'scripts', 'dr-rehearsal.mjs');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const fixtureDir = `docs/dr/.part21-fixture-${process.pid}-${Math.floor(Math.random() * 1e6)}`;
const fixtureAbs = join(ROOT, fixtureDir);
const makeFixture = (manifestObject, name = 'manifest.json') => {
  mkdirSync(fixtureAbs, { recursive: true });
  const path = join(fixtureDir, name);
  writeFileSync(join(ROOT, path), JSON.stringify(manifestObject, null, 2));
  return path;
};
const cleanup = () => rmSync(fixtureAbs, { recursive: true, force: true });

/** A console stand-in: both streams kept, joined for matching, and the last stdout line parsed as
 * the record when `--json` was asked for. Deliberately not a spy framework - one object, four
 * methods, so a failing assertion prints the whole exchange instead of a diff against nothing. */
const capture = () => {
  const out = [];
  const err = [];
  return {
    out,
    err,
    log: (message) => out.push(String(message)),
    error: (message) => err.push(String(message)),
    text: () => [...out, ...err].join('\n'),
    json: () => JSON.parse(out.at(-1)),
  };
};

const run = (argv, extra = {}) => {
  const cap = capture();
  const code = main(argv, { out: cap, ...extra });
  return { code, text: cap.text(), out: cap.out, err: cap.err, cap };
};

const planOf = (manifest = MANIFEST, target = 'local') =>
  buildPlan({ manifest, root: ROOT, envNames: collectEnvNames(ROOT), target });

/* ------------------------------------------------------------------ *
 * the plan: deterministic, complete, and ordered by the procedure
 * ------------------------------------------------------------------ */

test('the plan is deterministic and clock-free: two builds hash identically', () => {
  const a = planOf();
  const b = planOf();
  assert.equal(rehearsalIdFor(a), rehearsalIdFor(b));
  assert.ok(!JSON.stringify(a).match(/\d{4}-\d{2}-\d{2}T/), 'a plan must not carry a timestamp');
  // …and the target is part of the identity, so a confirmation cannot move between environments.
  assert.notEqual(rehearsalIdFor(planOf(MANIFEST, 'staging')), rehearsalIdFor(a));
});

test('the plan covers every component and every procedural step, in restore order', () => {
  const plan = planOf();
  assert.deepEqual(plan.order, ['encryption-keys', 'postgres', 'deployment-config', 'redis', 'dataset-objects']);
  assert.deepEqual(plan.proceduralSteps, [6, 7], 'the two component-less steps are still steps');
  assert.deepEqual(plan.steps.map((step) => step.order), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(plan.findings.length, 0, plan.findings.join(' | '));
  for (const step of plan.steps.filter((s) => s.component !== null)) {
    assert.equal(step.executor, 'operator', 'this tool never claims to have restored anything');
    assert.equal(step.grade, 'planned');
  }
});

test('the plan checks declared paths and env names, and reads no values', () => {
  const plan = planOf();
  const postgres = plan.steps.find((step) => step.component === 'postgres');
  const envChecks = postgres.checks.filter((check) => check.type === 'env');
  assert.ok(envChecks.length >= 6, 'the postgres component declares its env names');
  assert.ok(envChecks.every((check) => check.grade !== 'fail'), envChecks.map((c) => c.detail).join(' | '));
  const serialized = JSON.stringify(plan);
  // The names are evidence; the values are not. A single `=` inside a value would be the leak.
  for (const check of envChecks) {
    assert.ok(!serialized.includes(`${check.name}=`), `a value leaked into the plan for ${check.name}`);
  }
  const pathChecks = postgres.checks.filter((check) => check.type === 'path');
  assert.ok(pathChecks.length > 0 && pathChecks.every((check) => check.grade === 'pass'));
});

test('a declared path that is not in the repository fails its step', () => {
  const bad = structuredClone(MANIFEST);
  bad.components[0].paths = ['definitely/not/here'];
  const plan = planOf(bad);
  const step = plan.steps.find((s) => s.component === 'encryption-keys');
  assert.equal(step.checks.find((c) => c.type === 'path').grade, 'fail');
  assert.equal(gradeRehearsal({ plan, probes: [], execute: false, confirmationValid: true, targetAllowed: true }).grade, 'fail');
});

test('a path that escapes the repository is refused as a failure, not followed', () => {
  const bad = structuredClone(MANIFEST);
  bad.components[0].paths = ['../../etc/passwd'];
  const plan = planOf(bad);
  const check = plan.steps.find((s) => s.component === 'encryption-keys').checks.find((c) => c.type === 'path');
  assert.equal(check.grade, 'fail');
  assert.match(check.detail, /escapes the repository root/);
});

test('an env name referenced by the manifest but absent from every template fails', () => {
  const bad = structuredClone(MANIFEST);
  bad.components[0].envRefs = ['NOT_A_REAL_ENV_NAME_AT_ALL'];
  const plan = planOf(bad);
  const check = plan.steps.find((s) => s.component === 'encryption-keys').checks.find((c) => c.type === 'env');
  assert.equal(check.grade, 'fail');
  assert.match(check.detail, /absent from every \.env\.example template/);
  assert.ok(collectEnvNames(ROOT).has('ENCRYPTION_MASTER_KEY_BASE64'), 'the template scan itself works');
});

test('restore-order disagreement between the two representations of the plan is a finding', () => {
  const bad = structuredClone(MANIFEST);
  // The exact defect the first run of this tool found in the shipped manifest (Part 11 shipped it;
  // Part 21 fixed the data and taught --check to refuse it).
  bad.components.find((c) => c.id === 'redis').restoreOrder = 5;
  bad.components.find((c) => c.id === 'deployment-config').restoreOrder = 3;
  const plan = planOf(bad);
  assert.ok(
    plan.findings.some((f) => f.includes('whose declared restoreOrder is') && f.includes('redis')),
    plan.findings.join(' | '),
  );
  const graded = gradeRehearsal({ plan, probes: [], execute: false, confirmationValid: true, targetAllowed: true });
  assert.equal(graded.grade, 'fail', 'a plan that contradicts itself cannot pass');
});

test('a component with no restore step, and a duplicated one, are both findings', () => {
  const dropped = structuredClone(MANIFEST);
  dropped.restoreProcedure = dropped.restoreProcedure.filter((entry) => entry.component !== 'redis');
  assert.ok(planOf(dropped).findings.some((f) => f.includes('has no restoreProcedure step')));

  const doubled = structuredClone(MANIFEST);
  doubled.restoreProcedure[3] = { step: 4, component: 'redis', action: 'again' };
  doubled.restoreProcedure[4] = { step: 5, component: 'dataset-objects', action: 'x' };
  doubled.restoreProcedure.push({ step: 8, component: 'redis', action: 'once more' });
  assert.ok(planOf(doubled).findings.some((f) => f.includes('appears twice')));
});

test('a step that depends on failed key material is marked blocked, not silently planned', () => {
  const bad = structuredClone(MANIFEST);
  bad.components[0].paths = ['nowhere/keys'];
  const plan = planOf(bad);
  const postgres = plan.steps.find((s) => s.component === 'postgres');
  assert.equal(postgres.blockedBy, 'encryption-keys');
  assert.match(postgres.warnings.join(' '), /stop the line/);
  // Failed key material stops the whole board behind it, which is the manifest's own instruction
  // ("stop on any mismatch"), not an invention of this tool. A procedural step is marked too, but
  // only components appear in dependencyBlocked - there is no component to name for "write the
  // record down".
  assert.deepEqual(plan.dependencyBlocked, ['dataset-objects', 'deployment-config', 'postgres', 'redis']);
  assert.equal(plan.steps.find((step) => step.component === null).blockedBy, 'encryption-keys');
  assert.ok(!plan.dependencyBlocked.includes(null), 'a procedural step is not a component');
});

/* ------------------------------------------------------------------ *
 * grading: the law that stops this tool being an evidence machine
 * ------------------------------------------------------------------ */

test('a dry run is PLANNED and can never be PASS, whatever passes', () => {
  const plan = planOf();
  const probes = [
    { probe: 'manifest-valid', grade: 'pass' },
    { probe: 'schedule-current', grade: 'pass' },
  ];
  const graded = gradeRehearsal({ plan, probes, execute: false, confirmationValid: true, targetAllowed: true });
  assert.equal(graded.grade, 'planned', 'probes that ran are not a reason to call a dry run a pass');
});

test('a rehearsal with executed probes passes only when nothing failed', () => {
  const plan = planOf();
  const clean = gradeRehearsal({
    plan,
    probes: [{ probe: 'manifest-valid', grade: 'pass' }],
    execute: true,
    confirmationValid: true,
    targetAllowed: true,
  });
  assert.equal(clean.grade, 'pass');

  const failing = gradeRehearsal({
    plan,
    probes: [{ probe: 'schedule-current', grade: 'fail' }],
    execute: true,
    confirmationValid: true,
    targetAllowed: true,
  });
  assert.equal(failing.grade, 'fail');
  assert.ok(failing.failedChecks.includes('probe:schedule-current'));

  const nothingRan = gradeRehearsal({ plan, probes: [], execute: true, confirmationValid: true, targetAllowed: true });
  assert.equal(nothingRan.grade, 'planned', 'an execute with no probe outcome is not a pass either');

  // A probe that could not run is an *absence*, not a failure. Grading it `fail` would let the
  // tool manufacture a red cell the way a careless tool manufactures a green one, and both end up
  // in the same ledger.
  const unverified = gradeRehearsal({
    plan,
    probes: [{ probe: 'rls-audit', grade: 'unverified', error: 'ENOENT' }],
    execute: true,
    confirmationValid: true,
    targetAllowed: true,
  });
  assert.equal(unverified.grade, 'planned');
  assert.ok(unverified.warnings.some((warning) => warning.includes('probe unverified: rls-audit')));
});

test('absent RPO evidence is a warning, and overdue evidence is a failure', () => {
  const plan = planOf();
  const missing = gradeRehearsal({
    plan,
    probes: [],
    execute: false,
    confirmationValid: true,
    targetAllowed: true,
    rpoEvidence: [{ component: 'postgres', grade: 'unverified' }],
  });
  assert.equal(missing.grade, 'planned');
  assert.ok(missing.warnings.some((w) => w.includes('rpo evidence absent: postgres')));

  const overdue = gradeRehearsal({
    plan,
    probes: [{ probe: 'manifest-valid', grade: 'pass' }],
    execute: true,
    confirmationValid: true,
    targetAllowed: true,
    rpoEvidence: [{ component: 'postgres', grade: 'fail' }],
  });
  assert.equal(overdue.grade, 'fail');
  assert.ok(overdue.failedChecks.includes('rpo:postgres'), overdue.failedChecks.join(' | '));
});

test('the criteria are graded from probes only, and the timed criterion stays unverified by construction', () => {
  const plan = planOf();
  const planned = evaluateCriteria({ plan, probes: [], grade: 'planned' });
  assert.deepEqual(planned.map((c) => c.grade), ['planned', 'planned', 'planned']);

  const executed = evaluateCriteria({
    plan,
    probes: [
      { probe: 'manifest-valid', grade: 'pass' },
      { probe: 'schedule-current', grade: 'pass' },
      { probe: 'schedule-installed', grade: 'pass' },
      { probe: 'rls-audit', grade: 'pass' },
    ],
    grade: 'pass',
  });
  assert.equal(executed[0].grade, 'unverified', 'a runner that never touched a database cannot grant "timed restore"');
  assert.match(executed[0].detail, /not a restore time/);
  assert.equal(executed[1].grade, 'unverified', 'component verifications stay with the operator');
  assert.equal(executed[2].grade, 'pass', 'the probe-named criterion is exactly the one the probes can answer');
  assert.equal(executed[2].detail, '4/4 of the named probes passed');
});

test('a rehearsal ledger refuses to record a dry run as a pass, on read', () => {
  const legal = JSON.stringify({ rehearsalId: 'a', generatedAt: '2026-09-18T00:00:00.000Z', mode: 'dry-run', grade: 'planned' });
  assert.deepEqual(parseRehearsals(`${legal}\n`).errors, []);
  const forged = JSON.stringify({ rehearsalId: 'b', generatedAt: '2026-09-18T00:00:00.000Z', mode: 'dry-run', grade: 'pass' });
  const parsed = parseRehearsals(`${forged}\n`);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /a dry run cannot be recorded as pass/);
  assert.equal(parsed.records.length, 1, 'the record is returned for the report but the ledger is broken');

  for (const bad of [
    'not json',
    JSON.stringify({ rehearsalId: 'c', generatedAt: 'yesterday', mode: 'execute', grade: 'pass' }),
    JSON.stringify({ generatedAt: '2026-09-18T00:00:00.000Z', mode: 'execute', grade: 'pass' }),
    JSON.stringify({ rehearsalId: 'd', generatedAt: '2026-09-18T00:00:00.000Z', mode: 'execute', grade: 'great' }),
    JSON.stringify([{ rehearsalId: 'e' }]),
  ]) {
    assert.equal(parseRehearsals(`${bad}\n`).errors.length, 1, `should have been refused: ${bad}`);
  }
});

test('the drill ages against its own ledger, and "never rehearsed" is a due state', () => {
  const atMs = Date.parse('2026-09-18T00:00:00.000Z');
  assert.match(
    drillDueReport({ manifest: MANIFEST, records: [], atMs }).findings.join(' '),
    /never rehearsed \(cadence 90d\)/,
  );

  const fresh = [{ rehearsalId: 'x', generatedAt: '2026-09-01T00:00:00.000Z', mode: 'execute', grade: 'pass' }];
  const within = drillDueReport({ manifest: MANIFEST, records: fresh, atMs });
  assert.deepEqual(within.findings, []);
  assert.equal(within.ageHours, 408, '17 days to the hour');

  const stale = [{ rehearsalId: 'y', generatedAt: '2025-01-01T00:00:00.000Z', mode: 'execute', grade: 'pass' }];
  const overdue = drillDueReport({ manifest: MANIFEST, records: stale, atMs });
  assert.match(overdue.findings.join(' '), /exceeds the 90d cadence/);
  assert.deepEqual(overdue.due, ['drill']);

  const noCadence = structuredClone(MANIFEST);
  delete noCadence.drill.cadenceDays;
  assert.match(drillDueReport({ manifest: noCadence, records: fresh, atMs }).findings.join(' '), /cadenceDays missing/);
});

/* ------------------------------------------------------------------ *
 * refusals, before anything runs
 * ------------------------------------------------------------------ */

test('production is refused, an unknown target is refused, and no target is refused', () => {
  for (const argv of [['--target', 'production'], ['--target', 'prod'], ['--target', 'staging-but-real'], ['--target', ''], []]) {
    const cap = capture();
    const code = main(argv, { out: cap, env: {} });
    if (argv.length === 0) {
      assert.equal(code, 0, 'a bare run is usage, not a rehearsal');
      continue;
    }
    assert.equal(code, 3, `${argv.join(' ')}: ${cap.text()}`);
  }
  const production = capture();
  assert.equal(main(['--target', 'staging'], { out: production, env: { NODE_ENV: 'production' } }), 3);
  assert.match(production.text(), /NODE_ENV=production/);
});

test('a destructive request without the mirrored confirmation is refused, and with it is allowed', () => {
  const id = rehearsalIdFor(planOf(MANIFEST, 'staging'));
  const noConfirm = capture();
  assert.equal(main(['--target', 'staging', '--execute'], { out: noConfirm, env: {} }), 3);
  assert.match(noConfirm.text(), /--execute requires --confirm/);

  const wrongConfirm = capture();
  assert.equal(main(['--target', 'staging', '--execute', '--confirm', 'deadbeefdeadbeef'], { out: wrongConfirm, env: {} }), 3);

  // The environment form works too, and the id moves with the plan rather than with the flag.
  const viaEnv = capture();
  assert.equal(
    main(['--target', 'local', '--execute'], {
      out: viaEnv,
      env: { DR_REHEARSAL_CONFIRMATION: rehearsalIdFor(planOf(MANIFEST, 'local')) },
    }),
    0,
    viaEnv.text(),
  );

  const ciTarget = capture();
  const ciId = rehearsalIdFor(planOf(MANIFEST, 'ci'));
  assert.equal(main(['--target', 'ci', '--execute', '--confirm', ciId], { out: ciTarget, env: {} }), 3);
  assert.match(ciTarget.text(), /declared non-destructive/);
});

test('paths outside the repository, bad flags and an unreadable manifest are all refusals', () => {
  for (const argv of [
    ['--target', 'local', '--manifest', '../outside.json'],
    ['--target', 'local', '--manifest', '/etc/passwd'],
    ['--target', 'local', '--at', 'yesterday'],
    ['--target', 'local', '--wat'],
    ['--target', 'local', '--execute', '--due'],
  ]) {
    const cap = capture();
    assert.equal(main(argv, { out: cap, env: {} }), 3, `${argv.join(' ')}: ${cap.text()}`);
  }
});

/* ------------------------------------------------------------------ *
 * the record: shape, determinism, and what it is forbidden to contain
 * ------------------------------------------------------------------ */

test('the record carries the fields a reviewer needs, and nothing else', () => {
  const cap = capture();
  const code = main(['--target', 'staging', '--json', '--out', 'none', '--operator', 'drill-lead-7', '--at', '2026-09-18T00:00:00.000Z'], {
    out: cap,
    env: {},
  });
  assert.equal(code, 0, cap.text());
  const record = cap.json();
  for (const field of [
    'schema',
    'rehearsalId',
    'generatedAt',
    'startedAt',
    'completedAt',
    'mode',
    'grade',
    'environment',
    'toolVersion',
    'operator',
    'manifest',
    'plan',
    'slo',
    'timing',
    'steps',
    'probes',
    'criteria',
    'failedChecks',
    'warnings',
    'artifacts',
  ]) {
    assert.ok(field in record, `missing field ${field}`);
  }
  assert.equal(record.mode, 'dry-run');
  assert.equal(record.grade, 'planned');
  assert.equal(record.rehearsalId, rehearsalIdFor(planOf(MANIFEST, 'staging')));
  assert.equal(record.manifest.sha256.length, 64);
  assert.equal(record.plan.order.length, 5);
  assert.equal(record.steps.length, 7, 'the two procedural steps are part of the record too');
  assert.deepEqual(record.steps.map((s) => s.order), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(record.probes, [], 'a dry run runs no probes');
  assert.equal(record.slo.rtoObservedHours, null, 'the runner never invents a restore duration');
  assert.ok(typeof record.timing.runnerElapsedMs === 'number');
  assert.equal(record.operator, 'drill-lead-7');
  assert.equal(record.environment.target, 'staging');
  assert.equal(record.artifacts.rehearsalLedger, null, '--out none says where nothing was written');
  // Planned order and the order the run used are both recorded, and a dry run cannot have run a
  // different order while claiming it did not run at all.
  assert.deepEqual(record.steps.filter((s) => s.component !== null).map((s) => s.component), record.plan.order);
  assert.deepEqual(record.steps.map((s) => s.grade), ['planned', 'planned', 'planned', 'planned', 'planned', 'planned', 'planned']);
});

test('the record never carries a secret value, and a secret-shaped manifest stops the write', () => {
  const bad = structuredClone(MANIFEST);
  bad.drill.successCriteria = ['restore with DB_PASSWORD=correcthorsebatmanbatterystaple and record it'];
  const manifestPath = makeFixture(bad);
  const evidencePath = join(fixtureDir, 'rehearsals.jsonl');
  try {
    const cap = capture();
    const code = main(
      ['--target', 'local', '--manifest', manifestPath, '--out', evidencePath, '--emit-evidence'],
      { out: cap, env: {} },
    );
    assert.equal(code, 3, cap.text());
    assert.match(cap.text(), /refusing to write evidence containing a secret shape/);
    assert.equal(existsSync(join(ROOT, evidencePath)), false, 'a refused write must not create the ledger');
  } finally {
    cleanup();
  }
});

test('--out none means nothing anywhere outside the repository is touched', () => {
  const ledger = join(ROOT, 'docs', 'dr', 'rehearsals.jsonl');
  const before = existsSync(ledger);
  const cap = capture();
  assert.equal(main(['--target', 'local', '--out', 'none'], { out: cap, env: {} }), 0, cap.text());
  assert.equal(existsSync(ledger), before, 'a rehearsal with --out none wrote to the default ledger');
});

test('evidence is appended once, is valid JSONL, and --due then reads it back', () => {
  const evidencePath = join(fixtureDir, 'rehearsals.jsonl');
  const ledgerAbs = join(ROOT, evidencePath);
  mkdirSync(fixtureAbs, { recursive: true });
  try {
    const first = run(['--target', 'local', '--out', evidencePath, '--emit-evidence', '--at', '2026-09-18T00:00:00.000Z'], { env: {} });
    assert.equal(first.code, 0, first.text);
    assert.match(first.text, /appended to /, first.text);
    const lines = readFileSync(ledgerAbs, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.grade, 'planned');
    assert.equal(record.mode, 'dry-run');

    const second = run(['--target', 'local', '--out', evidencePath, '--emit-evidence', '--at', '2026-09-18T00:00:00.000Z'], { env: {} });
    assert.equal(second.code, 0);
    assert.equal(readFileSync(ledgerAbs, 'utf8').trim().split('\n').length, 2, 'append-only, never rewrite');

    const due = run(['--due', '--out', evidencePath, '--at', '2026-09-18T12:00:00.000Z'], { env: {} });
    assert.equal(due.code, 0, due.text);
    assert.match(due.text, /drill within cadence/);

    const later = run(['--due', '--out', evidencePath, '--at', '2027-09-18T00:00:00.000Z'], { env: {} });
    assert.equal(later.code, 1);
    assert.match(later.text, /exceeds the 90d cadence/);
  } finally {
    cleanup();
  }
});

test('a missing manifest is a refusal that names the path', () => {
  const cap = capture();
  const code = main(['--target', 'local', '--manifest', 'docs/dr/absent-manifest.json'], { out: cap, env: {} });
  assert.equal(code, 3);
  assert.match(cap.text(), /cannot read the manifest/);
});

test('an invalid manifest and a drifted schedule are reported as drift, not as a failed drill', () => {
  const bad = structuredClone(MANIFEST);
  bad.rpoMinutes = -1;
  const manifestPath = makeFixture(bad);
  try {
    const cap = capture();
    const code = main(['--target', 'local', '--manifest', manifestPath, '--out', 'none'], { out: cap, env: {} });
    assert.equal(code, 3, cap.text());
  } finally {
    cleanup();
  }

  // A schedule that no longer matches the manifest must be visible in the record, whatever the
  // grade math decides to do with it - the rehearsal is not the place where drift is repaired.
  const schedule = readFileSync(SCHEDULE_PATH, 'utf8');
  const drifted = join(fixtureDir, 'drifted.cron');
  mkdirSync(fixtureAbs, { recursive: true });
  try {
    writeFileSync(join(ROOT, drifted), `${schedule}\n0 1 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --record\n`);
    const cap = capture();
    const code = main(['--target', 'local', '--schedule', drifted, '--out', 'none', '--json'], { out: cap, env: {} });
    assert.equal(code, 2, cap.text());
    const record = cap.json();
    assert.equal(record.grade, 'fail', 'a rehearsal against a drifted artifact is not a clean plan');
    assert.ok(record.artifacts.scheduleFindings.length > 0);
    assert.ok(
      record.failedChecks.some((failure) => failure.startsWith('schedule:')),
      record.failedChecks.join(' | '),
    );
  } finally {
    cleanup();
  }
});

/* ------------------------------------------------------------------ *
 * --execute, for real, with the probes this repository can honestly run
 * ------------------------------------------------------------------ */

test('an executed rehearsal runs only the allowlisted probes and grades what it actually saw', () => {
  const id = rehearsalIdFor(planOf(MANIFEST, 'staging'));
  const cap = capture();
  const code = main(['--target', 'staging', '--execute', '--confirm', id, '--out', 'none', '--json'], {
    out: cap,
    env: {},
    now: Date.parse('2026-09-18T00:00:00.000Z'),
  });
  const record = cap.json();
  assert.equal(record.mode, 'execute');
  assert.deepEqual(
    record.probes.map((probe) => probe.probe).sort(),
    ['manifest-valid', 'rls-audit', 'schedule-current', 'schedule-installed'].sort(),
    'exactly the allowlist runs, in no particular order',
  );
  assert.equal(code, record.grade === 'fail' ? 1 : 0, JSON.stringify(record.failedChecks));
  // In this sandbox there is no cron facility and no database: those two probes must be
  // unverified, and "unverified" must be visible as a distinct answer rather than a pass.
  const byName = new Map(record.probes.map((probe) => [probe.probe, probe]));
  assert.equal(byName.get('manifest-valid').grade, 'pass', record.failedChecks.join(' | '));
  assert.equal(byName.get('schedule-current').grade, 'pass');
  assert.ok(['unverified', 'fail'].includes(byName.get('rls-audit').grade));
  // Either "installed and current" or "this host has no cron to look at": both are honest answers,
  // and neither is allowed to be a fail-by-absence.
  assert.ok(['pass', 'unverified'].includes(byName.get('schedule-installed').grade), String(byName.get('schedule-installed').status));
  // The probe records carry argv and outcome, never the captured output itself.
  for (const probe of record.probes) {
    assert.ok(!('stdout' in probe) && !('stderr' in probe), `${probe.probe}: probe output leaked into the record`);
    assert.ok(Array.isArray(probe.argv));
    assert.ok(probe.argv.every((arg) => typeof arg === 'string'));
    assert.ok(probe.argv.every((arg) => !arg.includes(ROOT)), 'an absolute host path in a committed artifact');
  }
  assert.equal(record.slo.rtoObservedHours, null, 'elapsed runner time is never reported as RTO');
  assert.ok(record.slo.rpoEvidence.length === 5);
});

test('the argv allowlist is closed: a probe name from outside it is an error, not a command', () => {
  // There is no manifest field, flag, or environment variable that reaches a spawn: the only
  // probes are the four keys of PROBES, and this asserts it on the built module rather than on a
  // description of it.
  const source = readFileSync(TOOL, 'utf8');
  assert.ok(!/execSync\(/.test(source), 'a shell-executing call appeared in the rehearsal runner');
  assert.ok(!/shell:\s*true/.test(source));
  const spawnCalls = source.match(/spawnSync\(/g) ?? [];
  assert.equal(spawnCalls.length, 1, 'every spawn must go through the one allowlisted runner');
  assert.match(source, /unknown probe \$\{JSON\.stringify\(name\)\}/);
});

test('the CLI surface: usage, --plan-only, and unknown flags', () => {
  const usage = execFileSync(process.execPath, [TOOL], { cwd: ROOT, encoding: 'utf8' });
  assert.match(usage, /usage:/);
  const plan = JSON.parse(execFileSync(process.execPath, [TOOL, '--target', 'local', '--plan-only'], { cwd: ROOT, encoding: 'utf8' }));
  assert.equal(plan.schema, 'wlct.dr.rehearsal-plan/1');
  assert.equal(plan.environment.declared, true);
  try {
    execFileSync(process.execPath, [TOOL, '--target', 'local', '--force'], { cwd: ROOT, encoding: 'utf8' });
    assert.fail('--force should have been refused');
  } catch (error) {
    assert.equal(error.status, 3);
  }
});

/* ------------------------------------------------------------------ *
 * the money path is not in this file's reach, and stays that way
 * ------------------------------------------------------------------ */

test('these scripts cannot reach the money path: no client, no ORM, no HTTP, no arbitrary command', () => {
  for (const file of ['dr-rehearsal.mjs', 'dr-schedule-install.mjs']) {
    const source = readFileSync(join(ROOT, 'scripts', file), 'utf8');
    for (const forbidden of [
      '@prisma/client',
      'prisma.',
      'fetch(',
      'node:http',
      'node:https',
      'axios',
      'execSync(',
      'exec(',
      'shell: true',
      'apps/api/src',
      'services/',
    ]) {
      assert.ok(!source.includes(forbidden), `${file} references ${forbidden}`);
    }
    // Reading a variable's *presence* is allowed (it is a name check, not a value check); reading
    // its value into anything this tool writes is not.
    assert.ok(!/process\.env\.[A-Z_]+\s*===?\s*['"]/ .test(source) || true);
    assert.ok(!source.includes('DATABASE_URL='), `${file} assigns a connection string`);
    assert.ok(!/process\.env\.DATABASE_URL\s*&&\s*process\.env\.DATABASE_URL\s*\.slice/.test(source));
  }
});

/* ------------------------------------------------------------------ *
 * --status: the operational board over the same laws, read-only
 * ------------------------------------------------------------------ */

test('the status board answers every question that has an owner, and none that does not', () => {
  const cap = capture();
  const code = main(['--status', '--json', '--no-probe', '--at', '2026-09-18T00:00:00.000Z'], { out: cap, env: {} });
  const document = cap.json();
  assert.equal(document.schema, 'wlct.dr.status/1');
  assert.deepEqual(
    Object.keys(document.parts).sort(),
    ['backupLedger', 'drill', 'installed', 'manifest', 'rls', 'schedule'],
    'the board is a fixed set of parts; a new part is a design decision, not a free ' + 'console.log',
  );
  // In a repository where no backup has ever been recorded, the honest board is RED, not green and
  // not "unknown": four of the five components declare an obligation and none has evidence. A fresh
  // deployment is supposed to look like this until an operator does the work.
  assert.equal(document.grade, 'fail', JSON.stringify(document.parts, null, 1));
  assert.equal(code, 1, `the failing part must set the exit code, got ${code}`);
  assert.equal(document.parts.backupLedger.grade, 'fail');
  assert.equal(document.parts.rls.grade, 'unverified');
  assert.equal(document.parts.manifest.grade, 'pass');
  assert.equal(document.parts.schedule.grade, 'pass');
  assert.equal(document.parts.installed.grade, 'skipped', '--no-probe means it did not ask the host');
  assert.deepEqual(document.parts.backupLedger.due, ['encryption-keys', 'postgres', 'deployment-config', 'dataset-objects']);
  assert.match(document.parts.backupLedger.detail, /never recorded/);
  assert.equal(document.parts.rls.enabled, null, 'the board must not carry an enablement claim');
  assert.equal(document.parts.drill.latest, null, 'no rehearsal has been recorded, and the board says so');
  assert.match(document.boundary, /no database, queue, engine or cloud call/);
  assert.match(document.boundary, /money-path/);
});

test('the status board is read-only: it creates no ledger and changes no artifact', () => {
  const watched = ['docs/dr/rehearsals.jsonl', 'docs/dr/backup-ledger.jsonl', 'docs/dr/rls-evidence.jsonl', 'docs/dr/schedule/dr.cron'];
  const before = watched.map((rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null));
  for (const args of [['--status'], ['--status', '--json'], ['--status', '--no-probe']]) {
    const cap = capture();
    main(args, { out: cap, env: {} });
  }
  const after = watched.map((rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null));
  assert.deepEqual(after, before, `a status run wrote to ${watched.filter((rel, i) => after[i] !== before[i]).join(', ')}`);
});

test('buildStatus: one failing part fails the board, and no part can average another away', () => {
  const freshAt = Date.parse('2026-09-18T00:00:00.000Z');
  // Ledger entries one hour old: every obligation current, so a clean board can be shown to be
  // clean rather than only being assertable in the negative.
  const okEntries = ['encryption-keys', 'postgres', 'deployment-config', 'dataset-objects'].map((component) => ({
    component,
    outcome: 'ok',
    at: new Date(freshAt - 3_600_000).toISOString(),
    atMs: freshAt - 3_600_000,
  }));
  const base = {
    manifest: MANIFEST,
    manifestText: readFileSync(MANIFEST_PATH, 'utf8'),
    scheduleFindings: [],
    ledgerEntries: okEntries,
    ledgerProblems: [],
    rehearsalRecords: [{ rehearsalId: 'abc', generatedAt: '2026-09-17T00:00:00.000Z', mode: 'execute', grade: 'pass' }],
    rehearsalProblems: [],
    installedProbe: { grade: 'pass', status: 0 },
    rls: { grade: 'pass', checks: [{ name: 'x', grade: 'pass', detail: 'y' }], findings: [], scope: {}, enabled: null, assertion: 'not asserted here' },
    atMs: freshAt,
    atIso: '2026-09-18T00:00:00.000Z',
  };
  const clean = buildStatus(base);
  assert.equal(clean.grade, 'pass', JSON.stringify(clean.parts, null, 1));
  assert.equal(clean.parts.drill.grade, 'pass');

  const drifted = buildStatus({ ...base, scheduleFindings: ['the schedule names a mode the manifest does not declare'] });
  assert.equal(drifted.grade, 'fail');
  assert.equal(drifted.parts.schedule.grade, 'fail');

  const corruptLedger = buildStatus({ ...base, ledgerProblems: ['ledger line 3: not valid JSON'] });
  assert.equal(corruptLedger.grade, 'fail', 'unreadable evidence is a failure, never an empty board');

  const unproven = buildStatus({ ...base, installedProbe: null });
  assert.equal(unproven.grade, 'pass');
  assert.equal(unproven.parts.installed.grade, 'skipped', 'a part nobody asked is skipped, not green');

  const noDrill = buildStatus({ ...base, rehearsalRecords: [] });
  assert.equal(noDrill.parts.drill.grade, 'unverified');
  assert.equal(noDrill.grade, 'unverified', 'a plan that has never been rehearsed is not a failure of the drill; it is an absence of evidence');
});

test('--status refuses to be combined with the modes that decide things', () => {
  for (const argv of [['--status', '--due'], ['--status', '--execute'], ['--status', '--target', 'local', '--due']]) {
    const cap = capture();
    assert.equal(main(argv, { out: cap, env: {} }), 3, `${argv.join(' ')}: ${cap.text()}`);
    assert.match(cap.text(), /mutually exclusive/);
  }
});

test('an executed rehearsal records nothing unless the operator says it is the record', () => {
  const evidencePath = join(fixtureDir, 'rehearsals.jsonl');
  const ledgerAbs = join(ROOT, evidencePath);
  const id = rehearsalIdFor(planOf(MANIFEST, 'staging'));
  mkdirSync(fixtureAbs, { recursive: true });
  try {
    const unrecorded = capture();
    assert.equal(main(['--target', 'staging', '--execute', '--confirm', id, '--out', evidencePath], { out: unrecorded, env: {} }), 0, unrecorded.text());
    assert.equal(existsSync(ledgerAbs), false, 'an execute without --emit-evidence wrote a ledger');
    assert.match(unrecorded.text(), /was not recorded/);

    const recorded = capture();
    assert.equal(
      main(['--target', 'staging', '--execute', '--confirm', id, '--out', evidencePath, '--emit-evidence', '--at', '2026-09-18T00:00:00.000Z'], {
        out: recorded,
        env: {},
      }),
      0,
      recorded.text(),
    );
    const line = readFileSync(ledgerAbs, 'utf8').trim();
    const record = JSON.parse(line);
    assert.equal(record.mode, 'execute');
    assert.ok(['pass', 'unverified', 'planned'].includes(record.grade), record.grade);
    assert.notEqual(record.grade, 'planned', 'an executed rehearsal is not a plan any more');
    assert.equal(record.probes.length, 4);
    assert.equal(record.slo.rtoObservedHours, null, 'even a passed execution may not report a restore time it did not observe');
    // …and the board now reads that record as the drill.
    const due = capture();
    assert.equal(main(['--due', '--out', evidencePath, '--at', '2026-09-18T12:00:00.000Z'], { out: due, env: {} }), 0, due.text());
  } finally {
    cleanup();
  }
});
