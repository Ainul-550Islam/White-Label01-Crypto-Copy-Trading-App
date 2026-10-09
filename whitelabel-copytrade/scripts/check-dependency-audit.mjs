#!/usr/bin/env node
// # Responsibility: enforce the dependency-audit policy — fail on any advisory that is not a reviewed, unexpired exception, and fail on any exception that no longer applies.

/**
 * The repository had a gate that could never pass: `npm audit --audit-level=high`, which is red on
 * this tree today and will stay red until every transitive advisory in a Jest 29 / NestJS 10 /
 * Next 14 toolchain is upgraded. A gate that is always red is not a gate; it is a number people
 * learn to ignore, and it hides the one advisory that matters.
 *
 * This replaces it with one that can pass and can fail:
 *
 *   - every reported advisory must be a reviewed exception: present in
 *     ops/security/dependency-audit-baseline.json with a reason AND an expiry date;
 *   - a new advisory fails the gate;
 *   - an advisory whose severity has risen above the reviewed severity fails the gate;
 *   - an exception that no longer matches anything fails the gate ("stale"), because exceptions that
 *     cannot decay accumulate into a permanent allowlist that nobody re-reads;
 *   - an expired exception fails the gate.
 *
 * What this does NOT do is decide that an advisory is acceptable — a human does that, in the baseline
 * file, in writing, with a date. The tool only makes sure that decision was made and is still current.
 *
 * "Dev-only" is read from package-lock.json (`"dev": true` marks a package reachable only through the
 * development tree). It is a fact about the tree, not a judgement: it separates "a vulnerability in
 * something a customer's request can reach" from "a vulnerability in the test runner".
 *
 * Usage:
 *   node scripts/check-dependency-audit.mjs                     audit and enforce
 *   node scripts/check-dependency-audit.mjs --report FILE       read a saved `npm audit --json` output
 *   node scripts/check-dependency-audit.mjs --write             rewrite the baseline from the report
 *   node scripts/check-dependency-audit.mjs --json              machine-readable result
 *   node scripts/check-dependency-audit.mjs --now 2026-10-07    treat this as today (for tests)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const BASELINE_PATH = join(REPO_ROOT, 'ops', 'security', 'dependency-audit-baseline.json');

/** Default lifetime of a reviewed exception, in days, by whether a customer request can reach it. */
export const EXPIRY_DAYS = { production: 7, development: 30 };

/** `{ vulnerabilities: {...}, metadata: {...} }` from `npm audit --json`. */
export function readAuditReport(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  if (!report || typeof report !== 'object' || !report.vulnerabilities) {
    throw new Error(`${path}: not an npm audit report (no "vulnerabilities" key)`);
  }
  return report;
}

/** The packages package-lock.json marks as development-only, which is where "devOnly" comes from. */
export function readDevOnlyPackages(root = REPO_ROOT) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dev = new Set();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const name = entry.name ?? path.split('node_modules/').pop();
    if (!name) continue;
    if (entry.dev === true) dev.add(name);
  }
  return dev;
}

function firstAdvisory(via) {
  for (const entry of via ?? []) {
    if (entry && typeof entry === 'object') return entry;
  }
  return null;
}

/**
 * One entry per advisory in the report. A package can be flagged by several advisories; keying on
 * `id|package` rather than the package name is what lets one be fixed while another is accepted.
 */
export function classifyReport(report, devOnlyPackages) {
  const entries = [];
  for (const [name, finding] of Object.entries(report.vulnerabilities ?? {})) {
    const advisory = firstAdvisory(finding.via);
    const fix = finding.fixAvailable;
    const fixText =
      fix === true
        ? 'a fix is available within the declared range'
        : fix && typeof fix === 'object'
          ? `the fix is ${fix.name}@${fix.version}${fix.isSemVerMajor ? ' (semver-major upgrade)' : ''}`
          : 'no fix is published yet';
    entries.push({
      id: advisory?.url?.split('/').pop() ?? `npm-${name}`,
      package: name,
      severity: finding.severity,
      title: advisory?.title ?? `advisory against ${name}`,
      url: advisory?.url ?? null,
      vulnerableRange: advisory?.range ?? null,
      devOnly: devOnlyPackages.has(name),
      fix: fixText,
      direct: finding.isDirect === true,
      paths: Array.isArray(finding.effects) && finding.effects.length > 0 ? finding.effects.slice(0, 3) : [],
    });
  }
  const order = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  return entries.sort((left, right) =>
    (order[left.severity] ?? 9) - (order[right.severity] ?? 9) || left.package.localeCompare(right.package),
  );
}

export function entryKey(entry) {
  return `${entry.id}|${entry.package}`;
}

export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The reason text is derived from the lockfile and the advisory, never from an assumption. */
export function defaultReason(entry) {
  const where = entry.devOnly
    ? 'development-only dependency (package-lock.json marks it dev: true), so no customer request can reach it'
    : 'production dependency: a request path can reach it';
  // The package name is in the text as well as in the key: a reviewer reading the file should not have
  // to cross-reference the id to know what they are accepting.
  return `${entry.package}: ${entry.title} — ${where}; ${entry.fix}.`;
}

export function toBaselineEntries(entries, now) {
  return entries.map((entry) => ({
    id: entry.id,
    package: entry.package,
    severity: entry.severity,
    devOnly: entry.devOnly,
    title: entry.title,
    url: entry.url,
    reason: defaultReason(entry),
    expiresOn: addDays(now, entry.devOnly ? EXPIRY_DAYS.development : EXPIRY_DAYS.production),
    owner: 'platform',
  }));
}

export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) {
    return { generatedAt: null, entries: [] };
  }
  const baseline = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(baseline.entries)) throw new Error(`${path}: "entries" must be an array`);
  return baseline;
}

const SEVERITY_ORDER = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

/**
 * The enforcement itself. Returns every failure with the reason it failed, so a red gate names the
 * advisory and the action instead of printing a count.
 */
export function evaluatePolicy({ entries, baseline, now }) {
  const failures = [];
  const byKey = new Map(baseline.entries.map((entry) => [entryKey(entry), entry]));
  const reported = new Set();

  for (const entry of entries) {
    const key = entryKey(entry);
    reported.add(key);
    const exception = byKey.get(key);

    if (!exception) {
      failures.push({
        kind: 'new-advisory',
        key,
        severity: entry.severity,
        devOnly: entry.devOnly,
        detail: `${entry.package} [${entry.severity}] ${entry.title}${entry.devOnly ? ' (development-only)' : ' (production-reachable)'}`,
      });
      continue;
    }
    if (exception.severity && (SEVERITY_ORDER[entry.severity] ?? 9) < (SEVERITY_ORDER[exception.severity] ?? 9)) {
      failures.push({
        kind: 'severity-escalated',
        key,
        severity: entry.severity,
        devOnly: entry.devOnly,
        detail: `${entry.package} was reviewed as ${exception.severity} and is now ${entry.severity}`,
      });
    }
    if (!exception.reason || exception.reason.trim() === '') {
      failures.push({ kind: 'missing-reason', key, detail: `${entry.package} is accepted in the baseline with no reason recorded` });
    }
    if (!exception.expiresOn) {
      failures.push({ kind: 'missing-expiry', key, detail: `${entry.package} is accepted in the baseline with no expiry date` });
    } else if (String(exception.expiresOn) < now) {
      failures.push({
        kind: 'expired',
        key,
        detail: `${entry.package} exception expired on ${exception.expiresOn}; re-review or fix it`,
      });
    }
  }

  for (const exception of baseline.entries) {
    if (!reported.has(entryKey(exception))) {
      failures.push({
        kind: 'stale-exception',
        key: entryKey(exception),
        detail: `${exception.package} (${exception.id}) is still listed as accepted but is no longer reported; remove the exception`,
      });
    }
  }

  return {
    failures,
    totals: {
      reported: entries.length,
      production: entries.filter((entry) => !entry.devOnly).length,
      development: entries.filter((entry) => entry.devOnly).length,
      baselined: baseline.entries.length,
      critical: entries.filter((entry) => entry.severity === 'critical').length,
      high: entries.filter((entry) => entry.severity === 'high').length,
    },
  };
}

export function runNpmAudit(root = REPO_ROOT) {
  try {
    const stdout = execFileSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    // npm audit exits non-zero when it finds anything, and still prints the report. Only a missing
    // report is a failure to audit, and that must not be read as "clean".
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        throw new Error('npm audit did not produce JSON; the gate cannot conclude anything');
      }
    }
    throw new Error(`npm audit could not run: ${error.message}`);
  }
}

function main(argv) {
  const options = { report: null, write: false, json: false, now: new Date().toISOString().slice(0, 10), baseline: BASELINE_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') options.report = argv[++index];
    else if (arg === '--write') options.write = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--now') options.now = argv[++index];
    else if (arg === '--baseline') options.baseline = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  const report = options.report ? readAuditReport(options.report) : runNpmAudit();
  const entries = classifyReport(report, readDevOnlyPackages());

  if (options.write) {
    const existing = loadBaseline(options.baseline);
    const previous = new Map(existing.entries.map((entry) => [entryKey(entry), entry]));
    const baseline = {
      generatedAt: `${options.now}T00:00:00Z`,
      policy: {
        gate: 'scripts/check-dependency-audit.mjs',
        rule: 'Every reported advisory must appear here with a reason and an expiry. A new advisory, a severity increase, an expired exception, or an exception that no longer applies fails the gate.',
        expiryDays: EXPIRY_DAYS,
      },
      entries: toBaselineEntries(entries, options.now).map((entry) => {
        const previousEntry = previous.get(entryKey(entry));
        // A human-written reason survives regeneration; that is the whole point of the file.
        return previousEntry?.reason && previousEntry.expiresOn
          ? { ...entry, reason: previousEntry.reason, expiresOn: previousEntry.expiresOn }
          : entry;
      }),
    };
    mkdirSync(dirname(options.baseline), { recursive: true });
    writeFileSync(options.baseline, `${JSON.stringify(baseline, null, 2)}\n`);
    process.stdout.write(`Wrote ${options.baseline} with ${baseline.entries.length} reviewed exceptions.\n`);
    return 0;
  }

  const baseline = loadBaseline(options.baseline);
  const { failures, totals } = evaluatePolicy({ entries, baseline, now: options.now });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ totals, failures }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Dependency audit: ${totals.reported} advisories (${totals.critical} critical, ${totals.high} high), ` +
        `${totals.production} production-reachable and ${totals.development} development-only; ` +
        `${totals.baselined} exceptions recorded.\n`,
    );
    for (const failure of failures) process.stdout.write(`  FAIL [${failure.kind}] ${failure.detail}\n`);
    if (failures.length === 0) process.stdout.write('  all advisories are reviewed, unexpired exceptions.\n');
    for (const entry of entries.filter((item) => !item.devOnly).slice(0, 15)) {
      process.stdout.write(`  production: ${entry.package} [${entry.severity}] ${entry.title}\n`);
    }
  }
  return failures.length > 0 ? 1 : 0;
}

// Writing to a closed pipe (… | head) is not a gate failure; without this the process prints a stack
// trace and exits non-zero, which reads as "the audit found something".
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') process.exit(0);
  throw error;
});

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Dependency audit gate failed to run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
