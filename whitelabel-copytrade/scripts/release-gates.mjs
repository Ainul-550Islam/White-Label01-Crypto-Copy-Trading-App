#!/usr/bin/env node
// # Responsibility: run every release gate in order with the memory each one needs, and report FAILED or BLOCKED per gate instead of a single ambiguous exit code.

/**
 * A buyer's diligence question is "does everything pass?", and today that question means running
 * the commands in the right directories with the right NODE_OPTIONS, knowing which ones need a
 * database, which need network, and which one silently needs more heap than the machine has. This
 * runs them in order and prints one line per gate.
 *
 * The distinction that matters is between three outcomes and not two:
 *
 *   PASS      the command ran and exited 0
 *   FAILED    the command ran and exited non-zero - a finding, act on it
 *   BLOCKED   the command could not run here: no network, no database, not enough memory, a missing
 *             binary. Never reported as a pass, and counted separately in the exit code, because
 *             "could not check" and "checked and fine" are different claims.
 *
 * Memory is the reason this exists rather than a list of commands in a README. The API typecheck
 * needs more heap than a 2 GB container has; it OOMs partway through and looks like a crash rather
 * than a result. A gate that OOMs is reported BLOCKED with the heap size that was tried, so the
 * reader knows the command is untested here rather than broken.
 *
 * Usage:
 *   node scripts/release-gates.mjs                     run everything that can run here
 *   node scripts/release-gates.mjs --only lint,scripts
 *   node scripts/release-gates.mjs --heap 4096         for the TypeScript gates
 *   node scripts/release-gates.mjs --json --report out.json
 *
 * Exit codes: 0 every gate passed · 1 at least one failed · 2 nothing failed but something was blocked.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
const MONOREPO_ROOT = resolve(REPO_ROOT, '..');

/** Substrings that mean "this did not have the resources to run", not "this found something". */
export const BLOCKED_PATTERNS = [
  /Reached heap limit/i,
  /JavaScript heap out of memory/i,
  /FATAL ERROR:.*OOM/i,
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i,
  /could not connect to server/i,
  /Can't reach database server/i,
  /not installed/i,
  /ENOENT/i,
  // A missing system library is a machine resource, not a finding: chromium refused to start for
  // want of `libnspr4.so` on the first machine this suite ran on.
  /error while loading shared libraries/i,
  /cannot open shared object file/i,
  /Executable doesn't exist at/i,
  /Please run the following command to download new browsers/i,
];

/**
 * Turn a finished child process into one of PASS / FAILED / BLOCKED.
 *
 * A clean exit is decided first, before the blocked vocabulary is consulted. That ordering is not
 * cosmetic: on the first real run of this runner the `scripts` gate passed - 196 tests, exit 0 -
 * and was reported BLOCKED because the secret-scan test asserts the phrase "not installed" inside
 * its own passing output. A phrase inside a suite that completed successfully is the suite's
 * subject matter, not this machine's resources. Resource failures always leave a non-zero exit or
 * a signal, so the vocabulary is only meaningful there. Nothing here turns a non-zero exit into a
 * pass: the fall-through is FAILED.
 */
export function classifyResult({ status, stdout = '', stderr = '', signal = null, error = null }) {
  if (status === 0) return { outcome: 'PASS', reason: null };
  if (signal) return { outcome: 'BLOCKED', reason: `killed by ${signal}` };
  const output = `${stdout}\n${stderr}\n${error ?? ''}`;
  for (const pattern of BLOCKED_PATTERNS) {
    const match = pattern.exec(output);
    if (match) return { outcome: 'BLOCKED', reason: match[0].slice(0, 120) };
  }
  return { outcome: 'FAILED', reason: `exit ${status === null ? 'never exited' : status}` };
}

/**
 * The gate list. `cwd` is relative to the monorepo root; `heap` is the V8 heap the command needs,
 * which is recorded rather than assumed so a small machine reports BLOCKED instead of swapping.
 */
export const GATES = [
  {
    name: 'packages',
    description: 'Build the shared packages the apps import',
    command: 'npm',
    args: ['run', 'build:packages'],
    cwd: 'whitelabel-copytrade',
    heap: 1024,
    needs: [],
  },
  {
    name: 'route-authorization',
    description: 'Every route is tenant-scoped and permission-decorated',
    command: 'npm',
    args: ['run', 'check:route-authorization'],
    cwd: 'whitelabel-copytrade',
    heap: 1024,
    needs: [],
  },
  {
    name: 'contracts',
    description: 'The web client and the API agree on the contract',
    command: 'npm',
    args: ['run', 'check:web-api-contract'],
    cwd: 'whitelabel-copytrade',
    heap: 1024,
    needs: [],
  },
  {
    name: 'di-and-prisma',
    description: 'Dependency-injection graph and Prisma literal checks',
    command: 'npm',
    args: ['run', 'check:api-di'],
    cwd: 'whitelabel-copytrade',
    heap: 1024,
    needs: [],
  },
  {
    name: 'scripts',
    description: 'The release tooling suite (SBOM, DR, secret policy, audit baseline)',
    command: 'node',
    args: ['--test', 'scripts/'],
    cwd: 'whitelabel-copytrade',
    heap: 2048,
    needs: [],
  },
  {
    name: 'sbom',
    description: 'Generate and validate the SBOM from the repository lockfiles',
    command: 'node',
    args: ['scripts/generate-sbom.mjs', '--out', 'whitelabel-sbom.spdx.json', '--quiet'],
    cwd: 'whitelabel-copytrade',
    heap: 1024,
    needs: [],
    check: (result) => {
      if (result.outcome !== 'PASS') return result;
      const verify = spawnSync('node', ['scripts/generate-sbom.mjs', '--check', 'whitelabel-sbom.spdx.json'], {
        cwd: join(MONOREPO_ROOT, 'whitelabel-copytrade'),
        encoding: 'utf8',
      });
      if (verify.status !== 0) return { outcome: 'FAILED', reason: 'the generated SBOM does not validate' };
      return { outcome: 'PASS', reason: null, detail: verify.stdout.trim() };
    },
  },
  {
    name: 'audit',
    description: 'Dependency audit against the reviewed baseline',
    command: 'npm',
    args: ['run', 'audit:deps'],
    cwd: 'whitelabel-copytrade',
    heap: 2048,
    needs: ['network'],
  },
  {
    name: 'secrets',
    description: 'Secret scan with the reviewed policy (binary must be present)',
    command: 'node',
    args: ['scripts/secret-scan.mjs', '--tree'],
    cwd: 'whitelabel-copytrade',
    heap: 1024,
    needs: ['gitleaks'],
  },
  {
    name: 'api-typecheck',
    description: 'TypeScript type check of the API (memory-hungry on this tree)',
    command: 'npm',
    args: ['run', 'typecheck', '--workspace', '@wlct/api'],
    cwd: 'whitelabel-copytrade',
    heap: 6144,
    needs: [],
  },
  {
    name: 'api-lint',
    description: 'ESLint over the API sources',
    command: 'npm',
    args: ['run', 'lint', '--workspace', '@wlct/api'],
    cwd: 'whitelabel-copytrade',
    heap: 4096,
    needs: [],
  },
  {
    name: 'api-tests',
    description: 'The API jest suite',
    command: 'npm',
    args: ['test', '--workspace', '@wlct/api', '--', '--ci'],
    cwd: 'whitelabel-copytrade',
    heap: 6144,
    needs: ['database'],
  },
  {
    name: 'e2e-stub',
    description: 'The browser suite’s stub upstream enforces its own contract',
    command: 'node',
    args: ['--test', 'tests/e2e/browser/support/stub-api.test.mjs'],
    cwd: 'whitelabel-copytrade',
    heap: 1024,
    needs: [],
  },
  {
    name: 'e2e-smoke',
    description: 'Cross-app component smoke specs (render-to-static-markup, no browser)',
    command: 'npm',
    args: ['run', 'test:smoke'],
    cwd: 'whitelabel-copytrade',
    heap: 1400,
    needs: [],
  },
  {
    name: 'e2e-browser',
    description: 'Playwright browser suite against the stub upstream, the web app and the console',
    command: 'npm',
    args: ['run', 'test:e2e:browser'],
    cwd: 'whitelabel-copytrade',
    heap: 2048,
    // A chromium build and its shared libraries. `npx playwright install --with-deps chromium`
    // provides both on a CI runner; a container without libnspr4 and friends reports BLOCKED here,
    // which is the truth about that machine.
    needs: ['browser'],
  },
  {
    name: 'trading-core',
    description: 'The Python trading-core suite',
    command: 'python3',
    args: ['-m', 'pytest', 'tests/', '-q'],
    cwd: 'whitelabel-copytrade/libs/trading-core',
    heap: null,
    needs: [],
    env: { PYTHONPATH: '.' },
  },
];

export function summarize(results) {
  const counts = { PASS: 0, FAILED: 0, BLOCKED: 0 };
  for (const result of results) counts[result.outcome] += 1;
  const verdict = counts.FAILED > 0 ? 'FAILED' : counts.BLOCKED > 0 ? 'BLOCKED' : 'PASS';
  return { counts, verdict, exitCode: counts.FAILED > 0 ? 1 : counts.BLOCKED > 0 ? 2 : 0 };
}

export function renderReport(results, summary) {
  const lines = ['Release gates', ''];
  for (const result of results) {
    const seconds = result.durationMs === null ? '' : ` (${(result.durationMs / 1000).toFixed(1)}s)`;
    lines.push(`  ${result.outcome.padEnd(7)} ${result.name.padEnd(20)} ${result.description}${seconds}`);
    if (result.reason) lines.push(`          ${result.reason}`);
  }
  lines.push('');
  lines.push(
    `  ${summary.counts.PASS} passed, ${summary.counts.FAILED} failed, ${summary.counts.BLOCKED} blocked -> ${summary.verdict}`,
  );
  if (summary.counts.BLOCKED > 0) {
    lines.push('  A blocked gate was not checked here. It is not a pass: run it where its requirement is met.');
  }
  return lines.join('\n');
}

export function runGate(gate, { heapOverride = null, timeoutMs = 20 * 60 * 1000 } = {}) {
  const cwd = join(MONOREPO_ROOT, gate.cwd);
  if (!existsSync(cwd)) {
    return { ...gate, outcome: 'BLOCKED', reason: `${gate.cwd} does not exist`, durationMs: null, output: '' };
  }
  const heap = heapOverride ?? gate.heap;
  const env = {
    ...process.env,
    ...(gate.env ?? {}),
    ...(heap ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${heap}`.trim() } : {}),
  };

  const started = Date.now();
  const result = spawnSync(gate.command, gate.args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  const durationMs = Date.now() - started;
  const classified = classifyResult({
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal,
    error: result.error ? String(result.error.message ?? result.error) : null,
  });
  const withDetail = gate.check ? gate.check(classified) : classified;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { ...gate, ...withDetail, durationMs, output: output.slice(-4000) };
}

function main(argv) {
  const options = { only: null, heap: null, json: false, report: null, timeoutMs: 20 * 60 * 1000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--only') options.only = argv[++index].split(',').map((name) => name.trim());
    else if (arg === '--heap') options.heap = Number(argv[++index]);
    else if (arg === '--timeout-seconds') options.timeoutMs = Number(argv[++index]) * 1000;
    else if (arg === '--json') options.json = true;
    else if (arg === '--report') options.report = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  const selected = options.only ? GATES.filter((gate) => options.only.includes(gate.name)) : GATES;
  if (selected.length === 0) throw new Error(`--only matched no gate; known gates: ${GATES.map((gate) => gate.name).join(', ')}`);

  const results = [];
  for (const gate of selected) {
    // Progress goes to stderr so that --json keeps stdout parseable: a consumer piping the report into
    // `jq` should not have to strip a progress log first.
    process.stderr.write(`  running ${gate.name} …\n`);
    results.push(runGate(gate, { heapOverride: options.heap, timeoutMs: options.timeoutMs }));
  }

  const summary = summarize(results);
  const report = { generatedAt: new Date().toISOString(), summary, results: results.map(({ output, ...rest }) => rest) };

  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${renderReport(results, summary)}\n`);

  if (options.report) writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  return summary.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    // A gate list that cannot even be built is not a passing result.
    process.stderr.write(`Release gates could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
