/**
 * Tests for the dependency-audit gate (run: `node --test scripts/`).
 *
 * The gate's value is entirely in what it refuses. Each test below is a case a reviewer would want to
 * see fail: a new advisory, a quiet severity increase, an exception nobody re-reviewed, an exception
 * left behind after the advisory was fixed, and a baseline entry with no reason. The tests use fixture
 * reports, so they never depend on the network or on today's advisory database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  addDays,
  classifyReport,
  defaultReason,
  entryKey,
  evaluatePolicy,
  readAuditReport,
  toBaselineEntries,
  BASELINE_PATH,
} from './check-dependency-audit.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-dependency-audit.mjs');
const NOW = '2026-10-07';

function report(vulnerabilities) {
  return { vulnerabilities, metadata: { vulnerabilities: {} } };
}

function finding({ severity, title, url, fix = true, isDirect = false }) {
  return {
    name: title,
    severity,
    isDirect,
    via: [{ title, url, range: '>=1.0.0 <2.0.0' }],
    effects: [],
    fixAvailable: fix,
  };
}

const devOnly = new Set(['jest', 'eslint']);

test('an advisory in the report and in the baseline passes, and the totals separate production from dev', () => {
  const entries = classifyReport(
    report({ next: finding({ severity: 'critical', title: 'Next.js DoS', url: 'https://github.com/advisories/GHSA-7m27-7ghc-44w9' }) }),
    devOnly,
  );
  const baseline = { entries: toBaselineEntries(entries, NOW) };
  const { failures, totals } = evaluatePolicy({ entries, baseline, now: NOW });

  assert.deepEqual(failures, []);
  assert.equal(totals.reported, 1);
  assert.equal(totals.production, 1, 'next is a production dependency');
  assert.equal(totals.critical, 1);
  assert.equal(entries[0].devOnly, false);
  assert.match(baseline.entries[0].reason, /production dependency/);
});

test('an advisory nobody reviewed fails the gate', () => {
  const entries = classifyReport(
    report({ lodash: finding({ severity: 'high', title: 'Prototype pollution', url: 'https://github.com/advisories/GHSA-aaaa' }) }),
    devOnly,
  );
  const { failures } = evaluatePolicy({ entries, baseline: { entries: [] }, now: NOW });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'new-advisory');
  assert.match(failures[0].detail, /lodash \[high\]/);
  assert.match(failures[0].detail, /production-reachable/);
});

test('a severity increase fails even when the advisory itself was reviewed', () => {
  const reviewed = toBaselineEntries(
    classifyReport(report({ lodash: finding({ severity: 'moderate', title: 'Prototype pollution' }) }), devOnly),
    NOW,
  );
  const entries = classifyReport(report({ lodash: finding({ severity: 'critical', title: 'Prototype pollution' }) }), devOnly);
  const { failures } = evaluatePolicy({ entries, baseline: { entries: reviewed }, now: NOW });

  assert.deepEqual(
    failures.map((failure) => failure.kind),
    ['severity-escalated'],
  );
  assert.match(failures[0].detail, /reviewed as moderate and is now critical/);
});

test('an expired exception fails, and expiry is shorter for production than for development', () => {
  const production = classifyReport(report({ next: finding({ severity: 'high', title: 'x' }) }), devOnly);
  const development = classifyReport(report({ jest: finding({ severity: 'high', title: 'y' }) }), devOnly);
  const baseline = { entries: toBaselineEntries([...production, ...development], NOW) };

  assert.equal(baseline.entries.find((entry) => entry.package === 'next').expiresOn, addDays(NOW, 7));
  assert.equal(baseline.entries.find((entry) => entry.package === 'jest').expiresOn, addDays(NOW, 30));

  const justExpired = evaluatePolicy({ entries: production, baseline, now: addDays(NOW, 8) });
  assert.deepEqual(justExpired.failures.map((failure) => failure.kind).sort(), ['expired', 'stale-exception']);
});

test('an exception that no longer applies fails, so the file cannot grow into a permanent allowlist', () => {
  const entries = classifyReport(report({ lodash: finding({ severity: 'low', title: 'fixed already' }) }), devOnly);
  const baseline = { entries: [{ ...toBaselineEntries(entries, NOW)[0], id: 'GHSA-stale', package: 'left-pad' }] };
  const { failures } = evaluatePolicy({ entries, baseline, now: NOW });

  const kinds = failures.map((failure) => failure.kind).sort();
  assert.deepEqual(kinds, ['new-advisory', 'stale-exception']);
});

test('a baseline entry without a reason or without an expiry is not an exception', () => {
  const entries = classifyReport(report({ lodash: finding({ severity: 'high', title: 'x' }) }), devOnly);
  const noReason = { entries: [{ ...toBaselineEntries(entries, NOW)[0], reason: '   ' }] };
  const noExpiry = { entries: [{ ...toBaselineEntries(entries, NOW)[0], expiresOn: null }] };

  assert.deepEqual(
    evaluatePolicy({ entries, baseline: noReason, now: NOW }).failures.map((failure) => failure.kind),
    ['missing-reason'],
  );
  assert.deepEqual(
    evaluatePolicy({ entries, baseline: noExpiry, now: NOW }).failures.map((failure) => failure.kind),
    ['missing-expiry'],
  );
});

test('the key is advisory plus package, so one package can carry two independently reviewed advisories', () => {
  const first = { id: 'GHSA-1', package: 'tar' };
  const second = { id: 'GHSA-2', package: 'tar' };
  assert.notEqual(entryKey(first), entryKey(second));

  const entries = classifyReport(
    report({ tar: finding({ severity: 'high', title: 'x', url: 'https://github.com/advisories/GHSA-1' }) }),
    devOnly,
  );
  const baseline = {
    entries: [toBaselineEntries(entries, NOW)[0], { id: 'GHSA-2', package: 'tar', severity: 'high', reason: 'reviewed', expiresOn: addDays(NOW, 5) }],
  };
  const { failures } = evaluatePolicy({ entries, baseline, now: NOW });
  assert.deepEqual(
    failures.map((failure) => failure.kind),
    ['stale-exception'],
    'the unreported sibling advisory is stale; the reported one passes',
  );
});

test('a missing or unreadable report is an error, never an empty result', () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-test-'));
  try {
    const bad = join(root, 'not-a-report.json');
    writeFileSync(bad, JSON.stringify({ metadata: {} }));
    assert.throws(() => readAuditReport(bad), /not an npm audit report/);
    assert.throws(() => readAuditReport(join(root, 'missing.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the committed baseline explains every advisory it accepts, and is not expired', () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  assert.ok(baseline.entries.length > 0, 'the baseline must list the exceptions this tree actually carries');
  for (const entry of baseline.entries) {
    assert.ok(entry.id && entry.package, 'every entry names its advisory and package');
    assert.ok(entry.reason && entry.reason.length > 20, `${entry.package} needs a real reason, not a placeholder`);
    assert.match(entry.expiresOn, /^\d{4}-\d{2}-\d{2}$/, `${entry.package} needs an expiry date`);
    assert.equal(typeof entry.devOnly, 'boolean');
  }
  const critical = baseline.entries.filter((entry) => entry.severity === 'critical');
  assert.ok(critical.length <= 1, 'a second critical advisory must be re-reviewed, not accepted in bulk');
});

test('the CLI reports the gate result and exits non-zero when the baseline does not cover the report', () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-cli-'));
  try {
    const reportPath = join(root, 'audit.json');
    writeFileSync(
      reportPath,
      JSON.stringify(report({ 'left-pad': finding({ severity: 'critical', title: 'Unreviewed', url: 'https://github.com/advisories/GHSA-zzzz' }) })),
    );
    const emptyBaseline = join(root, 'baseline.json');
    writeFileSync(emptyBaseline, JSON.stringify({ entries: [] }));

    // The gate exits non-zero here on purpose, so the child's status and stdout are the evidence:
    // spawnSync reports both, where execFileSync would only throw.
    const jsonRun = spawnSync(process.execPath, [SCRIPT, '--report', reportPath, '--baseline', emptyBaseline, '--json', '--now', NOW], {
      encoding: 'utf8',
    });
    assert.equal(jsonRun.status, 1);
    const parsed = JSON.parse(jsonRun.stdout);
    assert.equal(parsed.totals.reported, 1);
    assert.equal(parsed.failures[0].kind, 'new-advisory');

    let status = 0;
    try {
      execFileSync(process.execPath, [SCRIPT, '--report', reportPath, '--baseline', emptyBaseline, '--now', NOW], { encoding: 'utf8' });
    } catch (error) {
      status = error.status;
    }
    assert.equal(status, 1, 'an unreviewed critical advisory must fail the gate');

    // --write turns the report into a reviewed baseline with reasons and expiry dates attached.
    execFileSync(process.execPath, [SCRIPT, '--report', reportPath, '--baseline', emptyBaseline, '--write', '--now', NOW], { encoding: 'utf8' });
    const written = JSON.parse(readFileSync(emptyBaseline, 'utf8'));
    assert.equal(written.entries.length, 1);
    assert.match(written.entries[0].reason, /left-pad/);
    assert.ok(defaultReason(classifyReport(readAuditReport(reportPath), new Set())[0]).includes('left-pad'));

    const enforced = execFileSync(process.execPath, [SCRIPT, '--report', reportPath, '--baseline', emptyBaseline, '--now', NOW], { encoding: 'utf8' });
    assert.match(enforced, /all advisories are reviewed, unexpired exceptions/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
