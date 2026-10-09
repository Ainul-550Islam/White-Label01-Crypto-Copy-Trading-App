#!/usr/bin/env node
// # Responsibility: run gitleaks against the working tree or the full history with the reviewed policy, and refuse to report "clean" when the scanner is absent.

/**
 * The supply-chain workflow used the gitleaks action without a config, which means it reported the
 * 160 history matches on every run: documentation examples, unit-test fixtures, and one explicit
 * `replace-me-...` placeholder. A red scan that is always red gets ignored, and the run that matters -
 * the one where somebody pastes a real key into a handover document - gets ignored with it.
 *
 * `.gitleaks.toml` at the repository root carries the review: exact synthetic values, nothing
 * suppressed by path or by rule. This runner is the gate around it.
 *
 * The rule that matters most here is the exit code for a missing scanner. "gitleaks is not installed"
 * must never be reported as "no leaks found": the platform's own rule is that unknown is not clean,
 * and a secret scan that passes because it did not run is the exact shape of a false assurance.
 *
 * Usage:
 *   node scripts/secret-scan.mjs                       scan the working tree (default)
 *   node scripts/secret-scan.mjs --history             scan every commit in the repository
 *   node scripts/secret-scan.mjs --json                machine-readable summary
 *   node scripts/secret-scan.mjs --binary /path/to/gitleaks
 *
 * Binary resolution: --binary, then $GITLEAKS_BINARY, then `gitleaks` on PATH.
 *
 * Exit codes: 0 clean · 1 findings · 2 the scan could not run (blocked, not clean).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const CONFIG_PATH = resolve(REPO_ROOT, '..', '.gitleaks.toml');

/** Where the scanner is, or null. A returned null is why this script has an exit code 2. */
export function findScanner({ binary = null } = {}) {
  const candidates = [];
  if (binary) candidates.push(binary);
  if (process.env.GITLEAKS_BINARY) candidates.push(process.env.GITLEAKS_BINARY);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    const which = execFileSync('which', ['gitleaks'], { encoding: 'utf8' }).trim();
    if (which && existsSync(which)) return which;
  } catch {
    // `which` exits non-zero when the binary is absent, which is a normal outcome here.
  }
  return null;
}

/** gitleaks exits 1 when it finds something and still writes the report, so the report is the result. */
export function runScan({ scanner, configPath = CONFIG_PATH, root = REPO_ROOT, history = false, cwd = REPO_ROOT }) {
  const reportDir = mkdtempSync(join(tmpdir(), 'gitleaks-report-'));
  const reportPath = join(reportDir, 'report.json');
  const args = history
    ? ['detect', '--source', root, '--config', configPath, '--report-format', 'json', '--report-path', reportPath, '--redact', '--no-banner']
    : ['dir', root, '--config', configPath, '--report-format', 'json', '--report-path', reportPath, '--redact', '--no-banner'];

  let exitCode = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(scanner, args, { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    exitCode = typeof error.status === 'number' ? error.status : 2;
    stdout = error.stdout ?? '';
    stderr = error.stderr ?? '';
  }

  let findings = [];
  if (existsSync(reportPath)) {
    const raw = readFileSync(reportPath, 'utf8').trim();
    findings = raw === '' ? [] : JSON.parse(raw);
  }
  rmSync(reportDir, { recursive: true, force: true });

  if (exitCode !== 0 && exitCode !== 1) {
    return { ran: false, exitCode, stdout, stderr, findings: [], reason: stderr.trim() || stdout.trim() || `exit ${exitCode}` };
  }
  return { ran: true, exitCode, stdout, stderr, findings };
}

export function summarize(findings) {
  const byRule = {};
  const byFile = {};
  for (const finding of findings) {
    byRule[finding.RuleID] = (byRule[finding.RuleID] ?? 0) + 1;
    byFile[finding.File] = (byFile[finding.File] ?? 0) + 1;
  }
  return {
    total: findings.length,
    byRule,
    byFile,
    fingerprints: findings.map((finding) => finding.Fingerprint ?? `${finding.File}:${finding.RuleID}:${finding.StartLine}`),
  };
}

function main(argv) {
  const options = { history: false, json: false, binary: null, root: REPO_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--history' || arg === '--all') options.history = true;
    else if (arg === '--tree' || arg === '--no-git') options.history = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--binary') options.binary = argv[++index];
    else if (arg === '--root') options.root = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  const scanner = findScanner({ binary: options.binary });
  if (!scanner) {
    const message =
      'BLOCKED: gitleaks is not installed, so nothing was scanned. A scan that did not run is not a clean scan. ' +
      'Install it (https://github.com/gitleaks/gitleaks/releases) or set GITLEAKS_BINARY.';
    if (options.json) process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', reason: message }, null, 2)}\n`);
    else process.stderr.write(`${message}\n`);
    return 2;
  }

  const result = runScan({ scanner, root: options.root, history: options.history });
  if (!result.ran) {
    const message = `BLOCKED: gitleaks exited ${result.exitCode} without producing a report: ${result.reason}`;
    if (options.json) process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', reason: message }, null, 2)}\n`);
    else process.stderr.write(`${message}\n`);
    return 2;
  }

  const summary = summarize(result.findings);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ status: summary.total === 0 ? 'CLEAN' : 'FINDINGS', mode: options.history ? 'history' : 'working-tree', ...summary }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Secret scan (${options.history ? 'full history' : 'working tree'}): ${summary.total} finding(s) with the reviewed policy in .gitleaks.toml.\n`,
    );
    if (summary.total > 0) {
      process.stdout.write('  Expected by rule: the reviewed allowlist covers specific synthetic values only; anything here is unreviewed.\n');
      for (const [rule, count] of Object.entries(summary.byRule)) process.stdout.write(`  rule ${rule}: ${count}\n`);
      for (const fingerprint of summary.fingerprints.slice(0, 20)) process.stdout.write(`  ${fingerprint}\n`);
    }
  }
  return summary.total === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Secret scan failed to run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
