/**
 * Tests for the release-gate runner (run: `node --test scripts/`).
 *
 * The runner's only real job is to not lie about three states. These tests pin the classification
 * (an OOM is BLOCKED, not FAILED and certainly not PASS), the exit codes (2 for blocked, distinct
 * from 1 for failed), and the report text a reader acts on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { BLOCKED_PATTERNS, GATES, classifyResult, renderReport, summarize, runGate, REPO_ROOT } from './release-gates.mjs';

const SCRIPT = join(REPO_ROOT, 'scripts', 'release-gates.mjs');

test('a clean exit is a pass, and a non-zero exit with findings is a failure', () => {
  assert.equal(classifyResult({ status: 0 }).outcome, 'PASS');
  assert.deepEqual(classifyResult({ status: 1, stderr: '3 tests failed' }), { outcome: 'FAILED', reason: 'exit 1' });
});

test('a heap limit is blocked, not failed: the gate did not run', () => {
  const oom = classifyResult({
    status: 134,
    stderr: '<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
  });
  assert.equal(oom.outcome, 'BLOCKED');
  assert.match(oom.reason, /heap limit|heap out of memory/i);
});

test('missing network, a missing binary and a missing database are all blocked', () => {
  assert.equal(classifyResult({ status: 1, stderr: 'getaddrinfo EAI_AGAIN registry.npmjs.org' }).outcome, 'BLOCKED');
  assert.equal(classifyResult({ status: 2, stderr: 'BLOCKED: gitleaks is not installed' }).outcome, 'BLOCKED');
  assert.equal(classifyResult({ status: 1, stderr: "Can't reach database server at localhost:5432" }).outcome, 'BLOCKED');
  assert.equal(classifyResult({ status: null, signal: 'SIGKILL' }).outcome, 'BLOCKED');
  assert.ok(BLOCKED_PATTERNS.length >= 5, 'the blocked vocabulary is what keeps a resource failure out of the pass column');
});

test('a browser that cannot start for want of a system library is blocked, not failed', () => {
  const missingLib = classifyResult({
    status: 1,
    stderr:
      '/home/user/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell: error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory',
  });
  assert.equal(missingLib.outcome, 'BLOCKED');
  assert.match(missingLib.reason, /shared librar/i);
});

test('a passing suite that prints a blocked phrase is a pass, not a block', () => {
  // The real false positive: scripts/secret-scan.test.mjs asserts the message the scanner prints
  // when its binary is absent, so the passing suite's own output contains "not installed".
  const real = classifyResult({
    status: 0,
    stdout: 'ok 1 - a missing binary exits 2 with BLOCKED: secret scanning is not installed',
    stderr: '(node:1) tests 196\npass 196\nfail 0',
  });
  assert.deepEqual(real, { outcome: 'PASS', reason: null });

  // The same words on a run that did not complete are still a block.
  assert.equal(classifyResult({ status: 2, stderr: 'BLOCKED: secret scanning is not installed' }).outcome, 'BLOCKED');
  assert.equal(classifyResult({ status: 1, stderr: 'not installed' }).outcome, 'BLOCKED');
});

test('a run that never exited is never a pass', () => {
  assert.equal(classifyResult({ status: null }).outcome, 'FAILED');
  assert.match(classifyResult({ status: null }).reason, /never exited/);
});

test('the exit code separates failed from blocked, and blocked never looks like success', () => {
  const pass = [{ outcome: 'PASS' }, { outcome: 'PASS' }];
  const failed = [{ outcome: 'PASS' }, { outcome: 'FAILED' }];
  const blocked = [{ outcome: 'PASS' }, { outcome: 'BLOCKED' }];
  const both = [{ outcome: 'BLOCKED' }, { outcome: 'FAILED' }];

  assert.equal(summarize(pass).exitCode, 0);
  assert.equal(summarize(failed).exitCode, 1);
  assert.equal(summarize(blocked).exitCode, 2);
  assert.equal(summarize(both).exitCode, 1, 'a failure outranks a block');
  assert.equal(summarize(blocked).verdict, 'BLOCKED');
});

test('the report says a blocked gate was not checked rather than leaving it ambiguous', () => {
  const results = [
    { name: 'scripts', description: 'tooling suite', outcome: 'PASS', durationMs: 12000, reason: null },
    { name: 'api-typecheck', description: 'type check', outcome: 'BLOCKED', durationMs: 33000, reason: 'Reached heap limit' },
  ];
  const text = renderReport(results, summarize(results));
  assert.match(text, /PASS {4}scripts/, 'an outcome and a name in the same column as the other rows');
  assert.match(text, /BLOCKED api-typecheck/);
  assert.match(text, /Reached heap limit/);
  assert.match(text, /not a pass/);
});

test('every gate names a directory that exists, a command, and the memory it needs', () => {
  assert.ok(GATES.length >= 10, `expected the full gate list, saw ${GATES.length}`);
  const names = new Set();
  for (const gate of GATES) {
    assert.ok(!names.has(gate.name), `duplicate gate name ${gate.name}`);
    names.add(gate.name);
    assert.ok(gate.description && gate.description.length > 10, `${gate.name} needs a description a reader understands`);
    assert.ok(Array.isArray(gate.args) && gate.args.length > 0);
    assert.ok(typeof gate.cwd === 'string');
    assert.ok(gate.heap === null || typeof gate.heap === 'number');
  }
  for (const required of ['api-typecheck', 'api-lint', 'api-tests', 'scripts', 'secrets', 'audit', 'sbom', 'trading-core']) {
    assert.ok(names.has(required), `${required} is missing from the gate list`);
  }
});

test('a gate whose directory is absent is blocked, not skipped silently', () => {
  const result = runGate({ name: 'ghost', description: 'nowhere', command: 'node', args: [], cwd: 'no/such/dir', heap: null }, {});
  assert.equal(result.outcome, 'BLOCKED');
  assert.match(result.reason, /does not exist/);
});

test('the CLI runs a single gate and reports it as JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'gates-'));
  try {
    const reportPath = join(root, 'report.json');
    const run = spawnSync(process.execPath, [SCRIPT, '--only', 'scripts', '--json', '--report', reportPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 300000,
    });
    const report = JSON.parse(run.stdout);
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0].name, 'scripts');
    assert.ok(['PASS', 'FAILED', 'BLOCKED'].includes(report.results[0].outcome));
    // The JSON report and the file must agree, and the summary must match the results.
    assert.equal(report.summary.counts[report.results[0].outcome], 1);
    assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')).summary, report.summary);
    assert.equal(run.status, report.summary.exitCode, 'the process exit code is the summary exit code');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown gate name is an error rather than an empty run that looks green', () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--only', 'nope'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /matched no gate/);
});
