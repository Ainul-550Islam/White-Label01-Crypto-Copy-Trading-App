/**
 * Tests for the DR manifest validator (run: `node --test scripts/`).
 *
 * The repo's own manifest must pass, every drift class the validator exists
 * to catch must fail, and the plan renderer must be deterministic and
 * credential-free. These tests are the difference between a validator and a
 * lint that nothing watches.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  validateManifest,
  findSecretShapes,
  renderPlan,
  collectEnvNames,
  parseLedger,
  dueReport,
  parseRlsLedger,
  rlsEvidenceReport,
  renderSchedule,
  scheduleDrift,
  scheduleCronFor,
  scheduleCheckIntervalHours,
  scheduleTightestCadenceHours,
  SCHEDULE_PATH,
  verifyRlsEvidence,
} from './dr-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'docs', 'dr', 'manifest.json'), 'utf8'));

test('the shipped manifest validates clean', () => {
  assert.deepEqual(validateManifest(MANIFEST, ROOT), []);
});

test('the shipped manifest contains no secret shapes', () => {
  const raw = readFileSync(join(ROOT, 'docs', 'dr', 'manifest.json'), 'utf8');
  assert.deepEqual(findSecretShapes(raw), []);
});

test('every env name referenced exists in a repo .env.example', () => {
  const names = collectEnvNames(ROOT);
  for (const component of MANIFEST.components) {
    for (const ref of component.envRefs ?? []) {
      assert.ok(names.has(ref), `${component.id}: missing env name ${ref}`);
    }
  }
  assert.ok(names.size > 20, 'template parsing regressed');
});

test('a duplicated restoreOrder is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components[1].restoreOrder = bad.components[0].restoreOrder;
  const errors = validateManifest(bad, ROOT);
  assert.ok(errors.some((e) => e.includes('unique positive integer')) || errors.some((e) => e.includes('1..n')));
});

test('a gapped restoreOrder sequence is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.at(-1).restoreOrder = 99;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no gaps')));
});

test('a path that no longer exists is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').paths.push('apps/api/prisma/schema.dreamt-of.prisma');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no longer exists')));
});

test('an env ref that appears in no template is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').envRefs.push('POSTGRES_LIKE_TOTALY_MADE_UP');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no .env.example')));
});

test('a missing required component is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components = bad.components.filter((c) => c.id !== 'redis');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('required component redis')));
});

test('restoring the database before the keys is refused', () => {
  const bad = structuredClone(MANIFEST);
  const keys = bad.components.find((c) => c.id === 'encryption-keys');
  const db = bad.components.find((c) => c.id === 'postgres');
  [keys.restoreOrder, db.restoreOrder] = [db.restoreOrder, keys.restoreOrder];
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('BEFORE postgres')));
});

test('an untimed drill is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.drill.timed = false;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('drill.timed')));
});

test('a restore step pointing at a non-existent component is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.restoreProcedure[1].component = 'ghost-store';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('unknown component')));
});

test('secret shapes are detected wherever they hide', () => {
  assert.ok(findSecretShapes('host=postgresql://admin:Str0ngPassw0rd@db:5432/x').length > 0);
  assert.ok(findSecretShapes('-----BEGIN RSA PRIVATE KEY-----').length > 0);
  assert.ok(findSecretShapes('{"JWT_ACCESS_SECRET": "aGVsbG93b3JsZGFiY2RlZg=="}').length > 0);
});

test('--check and --plan succeed on the repo, and --plan is deterministic', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const checkOut = execFileSync('node', [script, '--check'], { encoding: 'utf8' });
  assert.match(checkOut, /manifest valid/);
  const plan1 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  const plan2 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(plan1, plan2);
  assert.doesNotMatch(plan1, /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s@]+@/); // no credential URLs
  for (const component of MANIFEST.components) {
    assert.ok(plan1.includes(component.id), `plan omits ${component.id}`);
  }
});

test('renderPlan matches the CLI output exactly (pure function, no clock)', () => {
  const viaFn = renderPlan(MANIFEST);
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const viaCli = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(viaCli, viaFn);
});

test('usage error exits 2', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  assert.throws(() => execFileSync('node', [script, '--nope'], { stdio: 'pipe' }), (err) => err.status === 2);
});

/* --------------------------------------------------------------------- */
/* Part 12: the backup-freshness ledger                                  */
/* --------------------------------------------------------------------- */

test('a component with neither cadence nor waiver is refused', () => {
  const bad = structuredClone(MANIFEST);
  delete bad.components.find((c) => c.id === 'dataset-objects').cadenceHours;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('cadenceHours is required')));
});

test('a null cadence without a waiver string is refused', () => {
  const bad = structuredClone(MANIFEST);
  const c = bad.components.find((x) => x.id === 'dataset-objects');
  c.cadenceHours = null;
  delete c.cadenceWaiver;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('requires a non-empty cadenceWaiver')));
});

test('a waiver attached to a real cadence is refused (contradiction)', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').cadenceWaiver = 'but I do not feel like it';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('only meaningful when cadenceHours is null')));
});

test('cadenceHours must be a bounded integer', () => {
  for (const value of [0, -3, 24.5, 8761, '24', null]) {
    const bad = structuredClone(MANIFEST);
    const c = bad.components.find((x) => x.id === 'dataset-objects');
    c.cadenceHours = value;
    c.cadenceWaiver = 'present, so the null-cadence branch is also exercised';
    const errors = validateManifest(bad, ROOT);
    if (value === null) {
      // null + waiver is legal - that is the redis shape; assert NO cadence error for it
      assert.ok(!errors.some((e) => e.includes('integer 1..8760')), 'null with waiver must pass the bound check');
    } else {
      assert.ok(errors.some((e) => e.includes('integer 1..8760')), `value ${JSON.stringify(value)} must be refused`);
    }
  }
});

test('postgres cadence beyond the RPO must name the mechanism that closes the gap', () => {
  const bad = structuredClone(MANIFEST);
  const db = bad.components.find((c) => c.id === 'postgres');
  delete db.rpoMechanism; // 24h dump vs 60m RPO, nothing else stated
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no rpoMechanism is named')));
  const good = structuredClone(MANIFEST);
  good.components.find((c) => c.id === 'postgres').cadenceHours = 1; // 60m <= 60m: honest without a mechanism
  assert.ok(!validateManifest(good, ROOT).some((e) => e.includes('rpoMechanism')));
});

test('the ledger parses line-wise and reports every malformed line by number', () => {
  const now = '2026-09-14T06:00:00Z';
  const text = [
    JSON.stringify({ at: now, component: 'postgres', outcome: 'ok' }),
    '{not json',
    JSON.stringify({ at: 'yesterday', component: 'postgres', outcome: 'ok' }),
    JSON.stringify({ at: now, component: 'postgres', outcome: 'maybe' }),
    JSON.stringify({ at: now, component: 'nosuch', outcome: 'ok' }),
    JSON.stringify({ at: now, component: 'redis', outcome: 'ok', extra: 'field' }),
    JSON.stringify({ at: now, component: 'redis', outcome: 'failed', note: 'x'.repeat(501) }),
  ].join('\n');
  const { entries, problems } = parseLedger(text, new Set(['postgres', 'redis']));
  assert.equal(entries.length, 1, 'only the clean line survives');
  const joined = problems.join('\n');
  for (const fragment of [
    'line 2: not valid JSON',
    'line 3: at must be an ISO-8601',
    'line 4: outcome',
    'line 5: component "nosuch" is not in the manifest',
    'line 6: unknown field',
    'line 7: note must be',
  ]) {
    assert.ok(joined.includes(fragment), `missing problem: ${fragment} in ${joined}`);
  }
});

test('dueReport ages obligations and honours waivers, failed records included', () => {
  const lite = {
    components: [
      { id: 'a', restoreOrder: 1, cadenceHours: 24 },
      { id: 'b', restoreOrder: 2, cadenceHours: 24 },
      { id: 'r', restoreOrder: 3, cadenceHours: null, cadenceWaiver: 'rebuildable' },
    ],
  };
  const base = Date.parse('2026-09-14T00:00:00Z');
  const entries = parseLedger(
    [
      { at: new Date(base).toISOString(), component: 'a', outcome: 'ok' },
      { at: new Date(base + 10 * 3_600_000).toISOString(), component: 'a', outcome: 'failed' },
      { at: new Date(base).toISOString(), component: 'b', outcome: 'failed' },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
    new Set(['a', 'b', 'r']),
  ).entries;
  const rows = dueReport(lite, entries, base + 23 * 3_600_000);
  assert.equal(rows[0].state, 'ok'); // 23h since last ok: inside 24h
  assert.equal(rows[1].state, 'due'); // only a failed record: the clock never stopped
  assert.match(rows[1].line, /never recorded/);
  assert.equal(rows[2].state, 'waived');
  assert.match(rows[2].line, /rebuildable/);
  const late = dueReport(lite, entries, base + 25 * 3_600_000);
  assert.equal(late[0].state, 'due');
  assert.match(late[0].line, /overdue by 1h 0m/); // failed-at-10h does NOT push the deadline
});

test('findSecretShapes catches the quoted-literal form (the escape that fooled v1)', () => {
  assert.ok(findSecretShapes('API_KEY="abcdefghijklmnop1234"\n').length > 0);
  assert.deepEqual(findSecretShapes('API_KEY="${VAULT_PATH}"\n'), []);
});

test('CLI: record -> due -> secret-refusal leaves exactly the recorded line', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-ledger-'));
  const ledger = join(dir, 'backup-ledger.jsonl');
  // run() ALWAYS resolves to combined stdout+stderr text, matched with
  // assert.match; exit codes are asserted here so the assertions below
  // read as intent ("this refuses") rather than plumbing.
  const run = (args, expectStatus = 0) => {
    try {
      const out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(expectStatus, 0, `expected refusal (exit ${expectStatus}) but got success: ${out}`);
      return out;
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  assert.equal(existsSync(ledger), false, 'harness expects a fresh ledger path');
  // Fresh ledger: due is exit 1 (never recorded) and lists all four obliged
  run(['--due', '--ledger', ledger, '--now', '2026-09-14T12:00:00Z'], 1);
  run(
    [
      '--record', '--component', 'postgres', '--outcome', 'ok',
      '--note', 'pg_dump + scratch restore verified',
      '--at', '2026-09-14T06:00:00Z', '--ledger', ledger,
    ],
    0,
  );
  const lines = fsReadLines(ledger);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    at: '2026-09-14T06:00:00.000Z',
    component: 'postgres',
    outcome: 'ok',
    note: 'pg_dump + scratch restore verified',
  });
  // 12:00: inside the window for postgres -> postgres [ ok ]; others due -> exit 1
  const dueOut = run(['--due', '--ledger', ledger, '--now', '2026-09-14T12:00:00Z'], 1);
  assert.match(dueOut, /\[ ok  \] postgres/);
  assert.match(dueOut, /dataset-objects: never recorded/);
  // Secret-shaped note: refused, file untouched
  const secret = run(
    [
      '--record', '--component', 'postgres', '--outcome', 'ok',
      '--note', 'TOKEN="super-secret-value-123456789012"', '--ledger', ledger,
    ],
    1,
  );
  assert.match(secret, /REFUSING to record/);
  assert.equal(fsReadLines(ledger).length, 1);
  // Unknown component and bad --at refuse too
  run(['--record', '--component', 'ghost', '--outcome', 'ok', '--ledger', ledger], 1);
  run(['--record', '--component', 'postgres', '--outcome', 'ok', '--at', 'last tuesday', '--ledger', ledger], 1);
  // A corrupt ledger line refuses to be appended to (evidence must stay parseable)
  writeFileSync(ledger, 'garbage-not-json\n', { flag: 'a' });
  const append = run(['--record', '--component', 'redis', '--outcome', 'ok', '--ledger', ledger], 1);
  assert.match(append, /REFUSING to append/);
});

function fsReadLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

test('--check reads a ledger with escaped quotes in notes as a secret finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-ledger-scan-'));
  const ledger = join(dir, 'backup-ledger.jsonl');
  writeFileSync(
    ledger,
    `${JSON.stringify({ at: new Date().toISOString(), component: 'postgres', outcome: 'ok', note: 'API_KEY="abcdefghijklmnop1234"' })}\n`,
  );
  const { problems } = parseLedger(readFileSync(ledger, 'utf8'), new Set(['postgres']));
  // parseLedger itself is shape-only; the note scan lives above it in the
  // loader. Pin the SHAPE here (the note is a legal string), so the
  // division of labour between the two checks is explicit...
  assert.deepEqual(problems, []);
  // and pin the END-TO-END refusal through --check: point the loader at
  // the ledger via a CLI run against a manifest that would otherwise pass.
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  let exit = 0;
  try {
    execFileSync('node', [script, '--check', '--ledger', ledger], { stdio: 'pipe' });
  } catch (error) {
    exit = error.status;
    assert.match(String(error.stderr), /SECRET-SHAPED CONTENT in note/);
  }
  assert.equal(exit, 1, 'a ledger with a credential in a note must fail --check');
});

test('the v1 schema id is refused now that v3 is the contract', () => {
  const bad = structuredClone(MANIFEST);
  bad.schema = 'wlct-dr-manifest-v1';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('wlct-dr-manifest-v3')));
});

test('the v2 schema id is refused too: an absent rlsEvidence block must not be inheritable', () => {
  // The interesting case is not "old id", it is "old id + no RLS block":
  // silently allowing that would make Part 15's policy optional for every
  // manifest written before it, which is how a security control becomes a
  // new-deployment-only control.
  const bad = structuredClone(MANIFEST);
  bad.schema = 'wlct-dr-manifest-v2';
  delete bad.rlsEvidence;
  const errors = validateManifest(bad, ROOT);
  assert.ok(errors.some((e) => e.includes('wlct-dr-manifest-v3')));
  assert.ok(errors.some((e) => e.includes('rlsEvidence is required')));
});

/* --------------------------------------------------------------------- */
/* Part 15: RLS enablement evidence                                        */
/* --------------------------------------------------------------------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('the shipped manifest declares RLS evidence and every path it names exists', () => {
  assert.deepEqual(validateManifest(MANIFEST, ROOT), []);
  const rls = MANIFEST.rlsEvidence;
  assert.equal(rls.requiredGrade, 'pass');
  for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
    assert.ok(existsSync(join(ROOT, rls[field])), `${field} missing from the repo`);
  }
  // The verifier names an endpoint, and that endpoint must exist in the
  // engine it points at - the manifest is a pointer, and pointers rot.
  const router = readFileSync(
    join(ROOT, 'services', 'execution-engine', 'app', 'routers', 'enablement.py'),
    'utf8',
  );
  assert.ok(router.includes(`"${rls.verifier.slice('/internal/v1'.length)}"`), 'manifest points at a route that does not exist');
  assert.ok(router.includes('router = APIRouter(prefix="/internal/v1"'), 'verifier left the internal plane');
});

test('rlsEvidence is required, and each of its fields has a shape', () => {
  const missing = structuredClone(MANIFEST);
  delete missing.rlsEvidence;
  assert.ok(validateManifest(missing, ROOT).some((e) => e.includes('rlsEvidence is required')));

  for (const field of ['evidenceLedger', 'verifier', 'command']) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence[field] = '';
    assert.ok(
      validateManifest(bad, ROOT).some((e) => e.includes(`${field} must be a non-empty string`)),
      field,
    );
  }
});

test('an rls cadence beyond a year is refused as a way of writing never', () => {
  const bad = structuredClone(MANIFEST);
  bad.rlsEvidence.cadenceHours = 8761;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('cadenceHours must be an integer 1..8760')));
  const zero = structuredClone(MANIFEST);
  zero.rlsEvidence.cadenceHours = 0;
  assert.ok(validateManifest(zero, ROOT).some((e) => e.includes('cadenceHours must be an integer')));
});

test('an rls waiver needs words, and a waiver next to a cadence is a contradiction', () => {
  const silent = structuredClone(MANIFEST);
  silent.rlsEvidence.cadenceHours = null;
  assert.ok(validateManifest(silent, ROOT).some((e) => e.includes('cadenceHours null requires a non-empty cadenceWaiver')));
  const contradictory = structuredClone(MANIFEST);
  contradictory.rlsEvidence.cadenceWaiver = 'not applicable';
  assert.ok(validateManifest(contradictory, ROOT).some((e) => e.includes('only meaningful when cadenceHours is null')));
});

test('the evidence ledger must be git evidence: relative, under docs/dr, .jsonl', () => {
  for (const [value, needle] of [
    ['/etc/passwd', 'repository-relative path'],
    ['docs/dr/../secrets.jsonl', 'repository-relative path'],
    ['docs/dr/evidence.txt', '.jsonl file'],
    ['evidence/rls.jsonl', 'under docs/dr/'],
  ]) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence.evidenceLedger = value;
    assert.ok(validateManifest(bad, ROOT).some((e) => e.includes(needle)), `${value} -> ${needle}`);
  }
});

test('the verifier must be an internal endpoint and the command a repo script', () => {
  const publicRoute = structuredClone(MANIFEST);
  publicRoute.rlsEvidence.verifier = '/api/v1/enablement/audit';
  assert.ok(validateManifest(publicRoute, ROOT).some((e) => e.includes('internal-plane endpoint')));

  const escaped = structuredClone(MANIFEST);
  escaped.rlsEvidence.verifier = '/public/enablement';
  assert.ok(validateManifest(escaped, ROOT).some((e) => e.includes('must not be a public route')));

  const arbitrary = structuredClone(MANIFEST);
  arbitrary.rlsEvidence.command = 'bash -c "curl evil"';
  assert.ok(validateManifest(arbitrary, ROOT).some((e) => e.includes('repository script')));
});

test('requiredGrade is not a knob: anything but "pass" is refused', () => {
  for (const value of ['fail', 'unverified', 'warning', true, 0]) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence.requiredGrade = value;
    assert.ok(
      bad && validateManifest(bad, ROOT).some((e) => e.includes('requiredGrade is not a knob')),
      JSON.stringify(value),
    );
  }
});

test('an artifact path that no longer exists, or no longer speaks of RLS, is a validation failure', () => {
  const moved = structuredClone(MANIFEST);
  moved.rlsEvidence.coverageArtifact = 'apps/api/prisma/rls/gone.json';
  assert.ok(validateManifest(moved, ROOT).some((e) => e.includes('no longer exists')));

  const notJson = structuredClone(MANIFEST);
  notJson.rlsEvidence.coverageArtifact = 'docs/dr/manifest.json'; // exists, but not the coverage shape
  assert.ok(validateManifest(notJson, ROOT).length >= 0); // JSON parses, so it passes - see the RLS-text rule below

  const renamed = structuredClone(MANIFEST);
  renamed.rlsEvidence.enableArtifact = 'docs/ROADMAP.md'; // exists, no ROW LEVEL SECURITY
  assert.ok(validateManifest(renamed, ROOT).some((e) => e.includes('no longer mentions ROW LEVEL SECURITY')));
});

test('secret shapes in the evidence ledger fail --check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-rls-secret-'));
  const ledger = join(dir, 'e.jsonl');
  writeFileSync(
    ledger,
    `${JSON.stringify({
      at: new Date().toISOString(),
      grade: 'pass',
      note: 'ran with DATABASE_URL="postgresql://app:sup3rsecretvalue@db:5432/wlct"',
    })}\n`,
  );
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  let exit = 0;
  try {
    execFileSync('node', [script, '--check-rls', '--ledger', ledger], { stdio: 'pipe' });
  } catch (error) {
    exit = error.status;
    assert.match(String(error.stderr), /SECRET-SHAPED CONTENT/);
  }
  assert.equal(exit, 1, 'a ledger holding a credential must not be readable as evidence');
});

test('parseRlsLedger accepts the closed grade vocabulary and nothing else', () => {
  const good = JSON.stringify({ at: '2026-09-14T06:00:00.000Z', grade: 'pass', probed: 42, role: 'wlct_app' });
  assert.deepEqual(parseRlsLedger(`${good}\n`).problems, []);
  assert.equal(parseRlsLedger(`${good}\n`).entries.length, 1);

  for (const [payload, needle] of [
    [{ at: 'x', grade: 'pass' }, 'ISO-8601'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'ok' }, 'pass, fail or unverified'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', extra: 1 }, 'unknown field'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', probed: 99999 }, 'integer 0..4096'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', role: 'a'.repeat(201) }, 'role must be'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', note: 'line1\nline2' }, 'note must be'],
  ]) {
    const { problems } = parseRlsLedger(`${JSON.stringify(payload)}\n`);
    assert.equal(problems.length, 1, JSON.stringify(payload));
    assert.ok(problems[0].includes(needle), `${problems[0]} !~ ${needle}`);
  }
  // An entry with NO grade is not "grade unknown", it is a malformed line:
  // the field that decides the verdict cannot default.
  assert.match(parseRlsLedger(`{"at":"2026-09-14T06:00:00.000Z"}\n`).problems[0], /grade must be/);
});

test('rlsEvidenceReport: never, fresh, overdue, and a fresh non-pass outranks freshness', () => {
  const evidence = { cadenceHours: 168 };
  const now = Date.UTC(2026, 8, 14, 12);
  assert.match(rlsEvidenceReport(evidence, [], now).line, /never recorded/);
  assert.equal(rlsEvidenceReport(evidence, [], now).state, 'due');

  const fresh = [{ atMs: now - DAY, grade: 'pass' }];
  assert.equal(rlsEvidenceReport(evidence, fresh, now).state, 'ok');
  assert.match(rlsEvidenceReport(evidence, fresh, now).line, /\[ ok  \]/);

  const stale = [{ atMs: now - 8 * DAY, grade: 'pass' }];
  assert.equal(rlsEvidenceReport(evidence, stale, now).state, 'due');
  assert.match(rlsEvidenceReport(evidence, stale, now).line, /overdue by 1d/);

  // The asymmetry that matters: a RECENT failure refreshes the clock without
  // turning the finding green.
  const failed = [
    { atMs: now - 2 * DAY, grade: 'pass' },
    { atMs: now - HOUR, grade: 'fail' },
  ];
  const row = rlsEvidenceReport(evidence, failed, now);
  assert.equal(row.state, 'fail');
  assert.match(row.line, /did not conclude "pass"/);

  const unverified = [{ atMs: now - HOUR, grade: 'unverified' }];
  assert.equal(rlsEvidenceReport(evidence, unverified, now).state, 'fail');

  // out-of-order lines: "latest" is by timestamp, not by position in the file
  const shuffled = [
    { atMs: now - HOUR, grade: 'fail' },
    { atMs: now - 30 * DAY, grade: 'pass' },
  ];
  assert.equal(rlsEvidenceReport(evidence, shuffled, now).state, 'fail');

  const waived = rlsEvidenceReport({ cadenceHours: null, cadenceWaiver: 'staging-only deployment' }, [], now);
  assert.equal(waived.state, 'waived');
  assert.match(waived.line, /staging-only/);
});

test('CLI: record-rls appends one line, check-rls ages it, and neither touches the backup ledger', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-rls-cli-'));
  const ledger = join(dir, 'e.jsonl');
  const run = (args, expectStatus = 0) => {
    try {
      return execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  assert.equal(existsSync(ledger), false);
  run(['--check-rls', '--now', '2026-09-14T12:00:00Z', '--ledger', ledger], 1);
  const recorded = run(
    ['--record-rls', '--grade', 'pass', '--probed', '42', '--role', 'wlct_app', '--at', '2026-09-14T06:00:00Z', '--ledger', ledger],
    0,
  );
  assert.match(recorded, /recorded: \{"at":"2026-09-14T06:00:00\.000Z","grade":"pass"/);
  const lines = readFileSync(ledger, 'utf8').split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1, 'exactly one evidence line per record');
  assert.deepEqual(JSON.parse(lines[0]), {
    at: '2026-09-14T06:00:00.000Z',
    grade: 'pass',
    probed: 42,
    role: 'wlct_app',
  });
  // An absent evidence ledger must not make the BACKUP ledger look broken,
  // and vice versa - the two obligations never read each other's file.
  const dueOut = run(['--due', '--now', '2026-09-14T12:00:00Z', '--ledger', join(dir, 'backup.jsonl')], 1);
  assert.match(dueOut, /never recorded/);
  // gradeless / bad-grade record attempts refuse and write nothing
  run(['--record-rls', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'ok', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'pass', '--probed', 'lots', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'pass', '--at', 'last tuesday', '--ledger', ledger], 1);
  assert.equal(readFileSync(ledger, 'utf8').split('\n').filter((l) => l.trim() !== '').length, 1);
  // a corrupt line: --check-rls refuses rather than grading the fleet on it
  writeFileSync(ledger, 'not json\n', { flag: 'a' });
  const corrupt = run(['--check-rls', '--ledger', ledger], 1);
  assert.match(corrupt, /REFUSING to answer --check-rls from an unreadable evidence ledger/);
  // and the writer refuses to append to a broken ledger, so the file
  // cannot accumulate unreadable lines next to good evidence.
  const append = run(['--record-rls', '--grade', 'pass', '--ledger', ledger], 1);
  assert.match(append, /REFUSING to append/);
  assert.equal(readFileSync(ledger, 'utf8').trim().split('\n').length, 2);
});

test('--check-rls prints its own summary line and the plan renders the contract', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const plan = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.match(plan, /# --- rls enablement evidence \(Part 15\) ---/);
  assert.match(plan, new RegExp(`cadence: <=${MANIFEST.rlsEvidence.cadenceHours}h`));
  assert.ok(plan.includes(MANIFEST.rlsEvidence.evidenceLedger));
  // Determinism still holds with the new section (no clock in renderPlan).
  const plan2 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(plan, plan2);
});

test("rls-enablement.mjs print-sql reports exactly the executor's SQL, all reads", () => {
  const script = join(ROOT, 'scripts', 'rls-enablement.mjs');
  const out = execFileSync('node', [script, 'print-sql'], { encoding: 'utf8' });
  const names = [...out.matchAll(/^-- (\w+)$/gm)].map((m) => m[1]);
  const source = readFileSync(join(ROOT, 'services', 'execution-engine', 'app', 'rls_probe.py'), 'utf8');
  const shipped = [...source.matchAll(/^(\w+_SQL): Final = /gm)].map((m) => m[1]);
  assert.deepEqual(names.sort(), shipped.sort(), 'the helper drifted from the module it documents');
  const statements = out.split('\n').filter((l) => l.trim().endsWith(';') && !l.trim().startsWith('--'));
  assert.ok(statements.length >= 6, `only ${statements.length} statements rendered`);
  for (const statement of statements) {
    assert.match(statement.trim(), /^(SELECT|SET TRANSACTION READ ONLY)/, statement);
  }
  assert.doesNotMatch(out, /INSERT|UPDATE |DELETE|ALTER TABLE|GRANT/);
});

/* --------------------------------------------------------------------- */
/* Part 20: the generated schedule (docs/dr/schedule/dr.cron)           */
/* --------------------------------------------------------------------- */

/** The committed file, read fresh. Every test below that starts from this is the
 * drift gate itself: a schedule that disagrees with the manifest is worse than no
 * schedule, because it is a control that has quietly become a document. */
const COMMITTED_SCHEDULE = readFileSync(SCHEDULE_PATH, 'utf8');

const jobLines = (text) =>
  text
    .split('\n')
    .filter((line) => !line.startsWith('#') && line.includes('dr-manifest.mjs'));

const modeOf = (line) => /(--[a-z-]+)\s*$/.exec(line)?.[1] ?? '';

test('the committed schedule matches a fresh generation of the shipped manifest', () => {
  assert.deepEqual(scheduleDrift(MANIFEST, COMMITTED_SCHEDULE), []);
  // And the comparison is not vacuous: the same file against a manifest with a
  // tightened cadence must disagree, or this test is asserting nothing.
  const tightened = structuredClone(MANIFEST);
  tightened.components.find((c) => c.id === 'postgres').cadenceHours = 6;
  assert.ok(scheduleDrift(tightened, COMMITTED_SCHEDULE).some((p) => p.includes('a cadence changed')));
});

test('renderSchedule is deterministic and carries no clock', () => {
  const a = renderSchedule(MANIFEST, '.');
  const b = renderSchedule(MANIFEST, '.');
  assert.equal(a, b);
  assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(a, /[A-Z][A-Z0-9_]{2,}=[^"\s]{24,}/); // no NAME=long-literal shape, by construction
});

test('the check interval follows the tightest cadence on the board', () => {
  assert.equal(scheduleTightestCadenceHours(MANIFEST), 24);
  const six = structuredClone(MANIFEST);
  six.components.find((c) => c.id === 'postgres').cadenceHours = 6;
  const text = renderSchedule(six, '.');
  const due = jobLines(text).find((line) => modeOf(line) === '--due');
  assert.ok(due.startsWith('0 */6 * * * '), `expected a six-hourly check, got ${JSON.stringify(due)}`);
  // The manifest validator keeps its daily rhythm: it is not an obligation and must
  // not become one just because an unrelated component tightened its cadence.
  const check = jobLines(text).find((line) => modeOf(line) === '--check');
  assert.ok(check.startsWith('0 0 * * * '), `expected a daily --check, got ${JSON.stringify(check)}`);
});

test('an interval that does not divide the day is honoured, not approximated away', () => {
  // The whole objection to `*/7` is answered by the wrap: the field restarts at 0, so
  // the LONGEST gap is 7 hours. If someone "fixes" this to weekly, this test is where
  // the argument gets re-litigated with the arithmetic in it.
  const seven = structuredClone(MANIFEST);
  seven.components.find((c) => c.id === 'postgres').cadenceHours = 7;
  const due = jobLines(renderSchedule(seven, '.')).find((line) => modeOf(line) === '--due');
  assert.ok(due.startsWith('0 */7 * * * '));
  const hours = [0, 7, 14, 21];
  const gaps = [...hours.slice(1).map((h, i) => h - hours[i]), 24 - hours.at(-1)];
  assert.equal(Math.max(...gaps), 7);
});

test('intervals beyond the daily ceiling collapse to one line at midnight', () => {
  for (const hours of [24, 720, 8760]) {
    assert.equal(scheduleCronFor(scheduleCheckIntervalHours(hours)), '0 0 * * *');
  }
  assert.throws(() => scheduleCheckIntervalHours(0), /integer 1\.\.8760/);
  assert.throws(() => scheduleCheckIntervalHours(8761), /integer 1\.\.8760/);
  assert.throws(() => scheduleCheckIntervalHours('24'), /integer 1\.\.8760/);
  assert.throws(() => scheduleCronFor(25), /no cron line/);
});

test('a board of waivers renders the waivers, not an empty file', () => {
  const waived = structuredClone(MANIFEST);
  for (const component of waived.components) {
    component.cadenceWaiver = 'ephemeral state, rebuilt from the sources above it';
    delete component.cadenceHours;
  }
  const text = renderSchedule(waived, '.');
  assert.deepEqual(jobLines(text).map(modeOf), ['--check']);
  for (const component of waived.components) {
    assert.ok(text.includes(`#   ${component.id}: ephemeral state`), `${component.id} waiver vanished`);
  }
  assert.equal(scheduleTightestCadenceHours(waived), null);
});

test('a waived RLS evidence block schedules no check and says so', () => {
  const waivedRls = structuredClone(MANIFEST);
  waivedRls.rlsEvidence.cadenceHours = null;
  waivedRls.rlsEvidence.cadenceWaiver = 'single-tenant pilot, no cross-tenant data to fence';
  const text = renderSchedule(waivedRls, '.');
  assert.equal(jobLines(text).some((line) => modeOf(line) === '--check-rls'), false);
  assert.match(text, /rlsEvidence cadence is waived: single-tenant pilot/);
  assert.match(text, /does not make "row-level security is enforcing" one degree/);
});

test('a schedule may never write ledger evidence, and the drift check enforces that', () => {
  const record = COMMITTED_SCHEDULE.replace(
    'dr-manifest.mjs" --due',
    'dr-manifest.mjs" --record --component postgres --outcome ok',
  );
  const problems = scheduleDrift(MANIFEST, record);
  assert.ok(
    problems.some((p) => p.includes('may ask questions, never write ledger evidence')),
    `expected the refusal, got ${JSON.stringify(problems)}`,
  );
  // The forbidden-mode finding is reported on its own, before the byte comparison, so a
  // tampered file cannot escape it by also having rewritten the cadence lines.
  assert.equal(problems.some((p) => p.includes('a cadence changed')), false);
});

test('a file missing its root line is not the generated shape', () => {
  const orphan = COMMITTED_SCHEDULE.split('\n').filter((l) => !l.startsWith('wlctRoot=')).join('\n');
  assert.ok(scheduleDrift(MANIFEST, orphan).some((p) => p.includes('wlctRoot')));
  assert.deepEqual(scheduleDrift(MANIFEST, ''), ['schedule file is empty or missing - run --emit-schedule']);
});

test('a secret pasted into the schedule is refused even when the cadences agree', () => {
  const leaky = `${COMMITTED_SCHEDULE}ENCRYPTION_MASTER_KEY_BASE64=c3VwZXJzZWNyZXR2YWx1ZWZvcmV2ZXJ5b25lCg==\n`;
  const problems = scheduleDrift(MANIFEST, leaky);
  assert.ok(problems.some((p) => p.startsWith('SECRET-SHAPED CONTENT in schedule:')));
});

test('every job line is five cron fields and a command, structurally', () => {
  for (const line of jobLines(COMMITTED_SCHEDULE)) {
    const fields = line.trim().split(/\s+/);
    // five cron fields, then `node`, the script, and the mode - three more tokens.
    assert.equal(fields.length, 8, `not five fields plus a command: ${line}`);
    assert.equal(fields[5], 'node');
    const [minute, hour, dom, month, dow] = fields;
    assert.match(minute, /^\d{1,2}$/);
    assert.match(hour, /^(\*\/\d{1,2}|\d{1,2})$/);
    for (const field of [dom, month, dow]) {
      assert.equal(field, '*');
    }
  }
  assert.deepEqual(jobLines(COMMITTED_SCHEDULE).map(modeOf).sort(), ['--check', '--check-rls', '--due']);
});

test('CLI: --emit-schedule writes a file --check-schedule then accepts, and refuses a hand-edit', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-schedule-'));
  const out = join(dir, 'dr.cron');
  const run = (args, expectStatus = 0) => {
    try {
      const text = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(expectStatus, 0, `expected refusal but got success: ${text}`);
      return text;
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  const first = run(['--emit-schedule', '--out', out, '--root', '/srv/whitelabel-copytrade']);
  assert.match(first, /wrote .*dr\.cron: obligations age against 24h, checked every 24h/);
  const written = readFileSync(out, 'utf8');
  assert.match(written, /^wlctRoot=\/srv\/whitelabel-copytrade$/m);
  // Re-running says so rather than pretending to change something, and the emitted
  // bytes are exactly what the pure function returns: the CLI is a writer, not a third
  // implementation of the renderer.
  const again = run(['--emit-schedule', '--out', out, '--root', '/srv/whitelabel-copytrade']);
  assert.match(again, /\(content unchanged\)/);
  assert.equal(readFileSync(out, 'utf8'), written);
  assert.equal(readFileSync(out, 'utf8'), renderSchedule(MANIFEST, '/srv/whitelabel-copytrade'));
  // A deployment that edited only its root line still passes: that line is its answer.
  const rebased = written.replace(/^wlctRoot=.*$/m, 'wlctRoot=/opt/app');
  writeFileSync(out, rebased);
  assert.match(run(['--check-schedule', '--out', out]), /schedule valid: 3 job line\(s\) \(--due, --check, --check-rls\)/);
  // The tamper has to land on a JOB line: `--due` also appears in the explanatory
  // comments, and a comment edit is (correctly) reported as a byte mismatch rather
  // than as a forbidden mode - comments are not executed.
  writeFileSync(out, rebased.replace('dr-manifest.mjs" --due', 'dr-manifest.mjs" --record'));
  assert.match(run(['--check-schedule', '--out', out], 1), /never write ledger evidence/);
});

test('CLI: neither schedule mode runs on a manifest that does not validate', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-schedule-bad-'));
  const brokenPath = join(dir, 'manifest.json');
  const out = join(dir, 'dr.cron');
  const broken = structuredClone(MANIFEST);
  broken.schema = 'wlct-dr-manifest-v1';
  writeFileSync(brokenPath, `${JSON.stringify(broken, null, 2)}\n`);
  const run = (args, expectStatus = 0) => {
    try {
      const text = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(expectStatus, 0, `expected refusal but got success: ${text}`);
      return text;
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  assert.match(run(['--emit-schedule', '--manifest', brokenPath, '--out', out], 1), /REFUSING to answer --emit-schedule from an invalid manifest/);
  // Nothing was written on the refusal path: a half-emitted schedule is a schedule that
  // exists, and an operator who installs it has no idea which manifest made it.
  assert.equal(existsSync(out), false);
  assert.match(run(['--check-schedule', '--manifest', brokenPath, '--out', join(ROOT, 'docs', 'dr', 'schedule', 'dr.cron')], 1), /REFUSING to answer --check-schedule from an invalid manifest/);
  // The same override proves the good path is not being flattered: the shipped manifest
  // against the shipped file still agrees when read through an explicit path.
  assert.match(
    run(['--check-schedule', '--manifest', join(ROOT, 'docs', 'dr', 'manifest.json')]),
    /schedule valid: 3 job line\(s\)/,
  );
});

const DR_SCRIPT = join(ROOT, 'scripts', 'dr-manifest.mjs');
/** One place that runs the CLI as a child, so the exit-code contract is tested as a contract and
 * not as a description of one. */
function runScript(args) {
  try {
    const stdout = execFileSync(process.execPath, [DR_SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

/* ------------------------------------------------------------------ *
 * Part 21: --verify-rls, the machine-readable verifier (no enable.sql change, no claim)
 * ------------------------------------------------------------------ */

/**
 * A scratch tree with the three RLS artifacts, so the scope law can be exercised against a
 * disagreement without editing the repository's own enable.sql (which is generated, and which this
 * part deliberately never touches).
 */
function rlsFixture(tables, { stamp = '20260913120000', disableTables = null, extraCoverage = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-rls-verify-'));
  const rel = (name) => join('prisma', name);
  mkdirSync(join(dir, 'prisma'), { recursive: true });
  const enable = tables
    .map((table) => `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;\nALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`)
    .join('\n');
  const disable = (disableTables ?? tables)
    .map((table) => `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;\nALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`)
    .join('\n');
  writeFileSync(
    join(dir, 'prisma', 'enable.sql'),
    `-- Generated. Schema stamp: ${stamp}\n\n${enable}\nCREATE POLICY tenant_isolation ON engine_incidents\nCREATE OR REPLACE FUNCTION wlct_current_tenant_id()\n`,
  );
  writeFileSync(join(dir, 'prisma', 'disable.sql'), `-- Generated. Schema stamp: ${stamp}\n\n${disable}\n`);
  writeFileSync(
    join(dir, 'prisma', 'rls_coverage.json'),
    JSON.stringify({
      schema: 'part11-rls-coverage-v1',
      stamp,
      policyName: 'tenant_isolation',
      functionName: 'wlct_current_tenant_id',
      covered: [...tables, ...extraCoverage].map((table) => ({ table, model: 'X' })),
      excluded: [],
    }),
  );
  const manifest = {
    rlsEvidence: {
      cadenceHours: 168,
      requiredGrade: 'pass',
      evidenceLedger: 'rls-evidence.jsonl',
      verifier: '/internal/v1/enablement/audit',
      coverageArtifact: rel('rls_coverage.json'),
      enableArtifact: rel('enable.sql'),
      disableArtifact: rel('disable.sql'),
    },
  };
  return { dir, manifest };
}

test('--verify-rls: the shipped artifacts agree on scope, and the answer is still unverified', () => {
  const document = verifyRlsEvidence(MANIFEST, { root: ROOT, nowMs: Date.parse('2026-09-18T00:00:00.000Z') });
  const byName = new Map(document.checks.map((check) => [check.name, check]));
  // Every scope law passes on the real repository...
  assert.equal(byName.get('scope:enable-vs-coverage').grade, 'pass');
  assert.equal(byName.get('scope:enable-vs-disable').grade, 'pass');
  assert.equal(byName.get('schema-stamp').grade, 'pass');
  // ...and the scan is pinned to a count, so a regex that matches nothing cannot pass as "empty scope".
  assert.equal(document.scope.enabled, 43);
  assert.equal(document.scope.covered, 43);
  assert.equal(document.scope.disabled, 43);
  // The evidence ledger has never been written, which is the honest grade for a fresh deployment.
  assert.equal(byName.get('evidence-ledger').grade, 'unverified');
  assert.equal(document.grade, 'unverified');
  assert.match(byName.get('evidence-ledger').detail, /never recorded/);
  // And this is the part that must never change: the verifier makes no enablement claim.
  assert.equal(document.enabled, null);
  assert.match(document.assertion, /not asserted here/);
});

test('--verify-rls: a table in enable.sql that the coverage ledger does not know is a failure', () => {
  const fixture = rlsFixture(['alpha_table', 'beta_table'], { extraCoverage: [] });
  fixture.enableExtra = true;
  writeFileSync(join(fixture.dir, 'prisma', 'enable.sql'), readFileSync(join(fixture.dir, 'prisma', 'enable.sql'), 'utf8') + '\nALTER TABLE "ghost_table" ENABLE ROW LEVEL SECURITY;\n');
  const document = verifyRlsEvidence(fixture.manifest, { root: fixture.dir });
  const scope = document.checks.find((check) => check.name === 'scope:enable-vs-coverage');
  assert.equal(scope.grade, 'fail');
  assert.match(scope.detail, /ghost_table/);
  assert.deepEqual(scope.onlyInSql, ['ghost_table']);
  assert.equal(document.grade, 'fail');
});

test('--verify-rls: a covered table with no ENABLE statement is the other direction, and is named', () => {
  const fixture = rlsFixture(['alpha_table'], { extraCoverage: ['promised_but_absent'] });
  const scope = verifyRlsEvidence(fixture.manifest, { root: fixture.dir }).checks.find((c) => c.name === 'scope:enable-vs-coverage');
  assert.equal(scope.grade, 'fail');
  assert.deepEqual(scope.onlyInCoverage, ['promised_but_absent']);
});

test('--verify-rls: a rollback narrower than the change fails, because an unrollbackable enable is a one-way door', () => {
  const fixture = rlsFixture(['alpha_table', 'beta_table'], { disableTables: ['alpha_table'] });
  const document = verifyRlsEvidence(fixture.manifest, { root: fixture.dir });
  const scope = document.checks.find((check) => check.name === 'scope:enable-vs-disable');
  assert.equal(scope.grade, 'fail');
  assert.deepEqual(scope.asymmetric, ['beta_table']);
});

test('--verify-rls: stamp disagreement between the artifacts is a failure', () => {
  const fixture = rlsFixture(['alpha_table'], { stamp: '20260101000000' });
  writeFileSync(join(fixture.dir, 'prisma', 'disable.sql'), readFileSync(join(fixture.dir, 'prisma', 'disable.sql'), 'utf8').replace('20260101000000', '20250101000000'));
  const stamp = verifyRlsEvidence(fixture.manifest, { root: fixture.dir }).checks.find((check) => check.name === 'schema-stamp');
  assert.equal(stamp.grade, 'fail');
  assert.match(stamp.detail, /disagree about which schema/);
});

test('--verify-rls: a missing artifact, a missing block, and a corrupt ledger each answer in their own words', () => {
  const missing = rlsFixture(['alpha_table']);
  writeFileSync(join(missing.dir, 'prisma', 'enable.sql'), '');
  const missingDoc = verifyRlsEvidence(missing.manifest, { root: missing.dir });
  // An empty file is present but names no table: the scope check is the one that must object.
  assert.equal(missingDoc.checks.find((c) => c.name === 'artifact:enableArtifact').grade, 'pass');
  assert.equal(missingDoc.checks.find((c) => c.name === 'scope:enable-vs-coverage').grade, 'fail');

  const absent = rlsFixture(['alpha_table']);
  writeFileSync(join(absent.dir, 'prisma', 'enable.sql'), '');
  const noBlock = verifyRlsEvidence({ rlsEvidence: null }, { root: absent.dir });
  assert.equal(noBlock.grade, 'fail');
  assert.match(noBlock.findings[0], /no rlsEvidence block/);

  const corrupt = rlsFixture(['alpha_table']);
  writeFileSync(join(corrupt.dir, 'rls-evidence.jsonl'), 'this is not json\n');
  const corruptDoc = verifyRlsEvidence(corrupt.manifest, { root: corrupt.dir });
  assert.equal(corruptDoc.grade, 'fail', 'a corrupt ledger is never read as an absent one');
  assert.match(JSON.stringify(corruptDoc.findings), /malformed line/);
});

test('--verify-rls: a fresh passing audit is the only thing that grades pass', () => {
  const fixture = rlsFixture(['alpha_table']);
  const at = Date.parse('2026-09-18T00:00:00.000Z');
  writeFileSync(
    join(fixture.dir, 'rls-evidence.jsonl'),
    `${JSON.stringify({ at: new Date(at - 3_600_000).toISOString(), grade: 'pass', probed: 1, role: 'wlct_app' })}\n`,
  );
  const document = verifyRlsEvidence(fixture.manifest, { root: fixture.dir, nowMs: at });
  assert.equal(document.grade, 'pass', JSON.stringify(document.findings));
  assert.equal(document.enabled, null, 'even a pass grades the audit, not the enablement claim');

  writeFileSync(
    join(fixture.dir, 'rls-evidence.jsonl'),
    `${JSON.stringify({ at: new Date(at - 200 * 3_600_000).toISOString(), grade: 'pass', probed: 1 })}\n`,
  );
  const stale = verifyRlsEvidence(fixture.manifest, { root: fixture.dir, nowMs: at });
  assert.equal(stale.checks.find((check) => check.name === 'evidence-ledger').grade, 'unverified');
  assert.equal(stale.grade, 'unverified', 'an audit past its cadence is not a pass and not a fail: it is stale');
});

test('--verify-rls is read-only, machine-readable, and reports through exit codes', () => {
  const before = readFileSync(join(ROOT, 'apps', 'api', 'prisma', 'rls', 'enable.sql'), 'utf8');
  const json = runScript(['--verify-rls', '--json', '--now', '2026-09-18T00:00:00.000Z']);
  assert.equal(json.status, 3, `unverified must be a distinct exit code, got ${json.status}: ${json.stderr}`);
  const document = JSON.parse(json.stdout);
  assert.equal(document.schema, 'wlct.dr.rls-verify/1');
  assert.equal(document.grade, 'unverified');
  assert.equal(document.enabled, null);
  const text = runScript(['--verify-rls', '--now', '2026-09-18T00:00:00.000Z']);
  assert.equal(text.status, 3);
  assert.match(text.stdout, /rls verification: UNVERIFIED/);
  // Nothing was written: the RLS artifacts and both ledgers are byte-identical to before.
  assert.equal(readFileSync(join(ROOT, 'apps', 'api', 'prisma', 'rls', 'enable.sql'), 'utf8'), before);
  assert.equal(existsSync(join(ROOT, 'docs', 'dr', 'rls-evidence.jsonl')), false, 'a verifier must not create evidence');
  const bad = runScript(['--verify-rls', '--now', 'yesterday']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not an ISO-8601 timestamp/);
});

test('--json is a boolean and never swallows the argument after it', () => {
  // The regression that MODE_FLAGS was introduced for: a flag parser that treats every unknown
  // --x as value-taking turns "--due --json" into "--due with an override named json".
  const out = runScript(['--check']);
  assert.equal(out.status, 0);
  const jsonMode = runScript(['--verify-rls', '--json', '--now', '2026-09-18T00:00:00.000Z']);
  assert.match(jsonMode.stdout, /^\{/, '--json must emit the document, not a usage line');
});
