#!/usr/bin/env node
/**
 * The deployment half of the DR schedule: install, verify, and remove the artifact that
 * `dr-manifest.mjs --emit-schedule` generates, against a host scheduler, without ever
 * becoming a second generator.
 *
 * Why this file exists (Part 21 audit, stated so the boundary is visible):
 * Part 20 shipped the schedule as a generated file with a drift gate, and stopped there on
 * purpose - `docs/DR.md` recorded installation as a host act. The gap that left is that
 * between "the file is correct" and "the host is running it" nothing was checkable: an
 * operator who installed it had no way to prove it a week later, and an operator who did not
 * had nothing to fail. This closes that middle. It does not generate, and it does not decide
 * what the schedule should contain; it reads what the generator wrote and asks the host to
 * agree with it.
 *
 * The laws this file is built on:
 *
 * 1. **The artifact is the source of truth, and it is verified before it is trusted.** Every
 *    install path runs `scheduleDrift` from `dr-manifest.mjs` - the same function
 *    `--check-schedule` runs - against the file on disk, and refuses on any finding. Importing
 *    the law rather than reimplementing it is the point: a copy of the schedule rules inside the
 *    installer is a second source of truth wearing a validation costume, and the two would
 *    drift exactly when it mattered.
 * 2. **Installation never generates.** If the artifact is missing, the answer is "run
 *    `--emit-schedule`", not "I will make one up". The installer writes the bytes it read,
 *    modulo the one explicit transform a `cron.d`-style target would need - and this host
 *    refuses that target instead of performing the transform (see `HOSTS`).
 * 3. **A host crontab is somebody else's file too.** Entries outside the managed block are
 *    preserved byte for byte, install is idempotent, and uninstall removes only the block. An
 *    installer that clobbers a host's other jobs to install a DR check would make the platform
 *    the cause of an outage it is meant to detect.
 * 4. **Ledger-writing jobs cannot be installed unless the manifest says so.** `--record` and
 *    `--record-rls` are human-only writes by Part 15's design, so a scheduled job containing
 *    one is a refusal here as well as in the generator - checked independently, because the
 *    installer is the last component that touches the bytes before a machine starts running
 *    them unattended.
 * 5. **External commands are an argv allowlist, never a shell.** `crontab` with argument arrays,
 *    `shell: false`, one binary name in the allowlist, a timeout on every call, and no string
 *    concatenation into a command line anywhere in this file. Anything an operator types
 *    (`--marker`, paths) is validated before it reaches an argv.
 * 6. **Test doubles stay test doubles.** The in-memory host is exported for tests and cannot be
 *    selected from the CLI, so no run of this tool can report an installation that happened only
 *    inside a unit test.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MANIFEST_PATH,
  SCHEDULE_PATH,
  findSecretShapes,
  scheduleDrift,
  validateManifest,
} from './dr-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The only binary this module will ever execute. A set, not a prefix rule: a prefix rule is how
 * "we only run `crontab`" quietly becomes "we run `crontab-thing`". */
const COMMAND_ALLOWLIST = new Set(['crontab']);

/** The managed region. The marker text is embedded in the host's file, so it is fixed here and
 * deliberately not a flag: a configurable marker is a way for one install to orphan another's. */
export const BEGIN_MARKER = '# BEGIN wlct-dr-schedule (managed by scripts/dr-schedule-install.mjs)';
export const END_MARKER = '# END wlct-dr-schedule';

/** Only `crontab` is offered. A `cron.d` drop-in needs a sixth (user) field that the generated
 * artifact deliberately does not carry - `/etc/cron.d` grammar is not user-crontab grammar - so
 * transforming the file to satisfy it would make this tool an author of schedule content, which
 * law 2 forbids. Refusing is cheaper than being quietly right about a host we cannot see. */
const HOSTS = new Set(['crontab']);

const EXIT = Object.freeze({
  OK: 0,
  NOT_INSTALLED: 1,
  DRIFT: 2,
  REFUSED: 3,
  NO_FACILITY: 4,
});

/* ------------------------------------------------------------------ *
 * the host abstraction
 * ------------------------------------------------------------------ */

/**
 * The real host: the user's crontab, via `crontab -l` and `crontab -`.
 *
 * Both calls go through one `run` method so the timeout, the allowlist and the "no shell" rule
 * exist in exactly one place. `PATH` is inherited (that is how the binary is found at all) and
 * nothing else about the environment is forwarded beyond `HOME`, because a cron write should not
 * be able to read a deployment's configuration.
 */
export class CrontabHost {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.pathOverride = options.path ?? null;
    this.env = options.env ?? null;
  }

  /** @returns {Promise<{available: boolean, reason: string | null}>} */
  async probe() {
    const result = await this.#run(['-T', 'crontab'], { allowFailure: true });
    if (result.spawnError === 'ENOENT') {
      return { available: false, reason: 'the `crontab` binary is not on PATH' };
    }
    if (result.code !== 0) {
      // Not every implementation supports -T; a refusal here is not proof of absence, so the
      // probe falls back to asking for the current table, which every one of them must answer.
      const list = await this.#run(['-l'], { allowFailure: true });
      if (list.spawnError === 'ENOENT') {
        return { available: false, reason: 'the `crontab` binary is not on PATH' };
      }
      if (list.spawnError !== null) {
        return { available: false, reason: `crontab could not be executed: ${list.spawnError}` };
      }
    }
    return { available: true, reason: null };
  }

  /** @returns {Promise<{ok: boolean, text: string, error: string | null}>} */
  async read() {
    const result = await this.#run(['-l'], { allowFailure: true });
    if (result.spawnError !== null) {
      return { ok: false, text: '', error: `crontab -l failed to start: ${result.spawnError}` };
    }
    if (result.code !== 0) {
      const text = `${result.stdout}${result.stderr}`;
      // "no crontab for user" is an empty table, not an error: the first install has to work.
      if (/no crontab for/i.test(text) || text.trim() === '') {
        return { ok: true, text: '' };
      }
      return { ok: false, text: '', error: `crontab -l exited ${result.code}: ${text.trim()}` };
    }
    return { ok: true, text: result.stdout };
  }

  async write(text) {
    const result = await this.#run(['-'], { stdin: text });
    if (result.spawnError !== null) {
      return { ok: false, error: `crontab - failed to start: ${result.spawnError}` };
    }
    if (result.code !== 0) {
      return { ok: false, error: `crontab - exited ${result.code}: ${(result.stdout + result.stderr).trim()}` };
    }
    return { ok: true, error: null };
  }

  async #run(args, { stdin = null, allowFailure = false } = {}) {
    const binary = 'crontab';
    if (!COMMAND_ALLOWLIST.has(binary)) {
      // Unreachable by construction, and kept because "the allowlist is checked somewhere" is
      // only worth what the check costs: nothing, and it is the thing that stays true when
      // somebody adds a second call site next month.
      throw new Error(`refusing to execute a command outside the allowlist: ${binary}`);
    }
    const env = this.env ?? {
      PATH: this.pathOverride ?? process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/root',
      // `-T crontab` on some implementations needs a POSIX locale to avoid translating the
      // "no crontab for" text this file pattern-matches.
      LC_ALL: 'C',
    };
    return new Promise((fulfill) => {
      let child;
      try {
        child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env, shell: false });
      } catch (error) {
        fulfill({ code: null, stdout: '', stderr: '', spawnError: String(error?.code ?? error) });
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fulfill(value);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ code: null, stdout, stderr, spawnError: `timeout after ${this.timeoutMs}ms` });
      }, this.timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        finish({ code: null, stdout, stderr, spawnError: String(error?.code ?? error) });
      });
      child.on('close', (code) => {
        finish({ code, stdout, stderr, spawnError: null });
      });
      if (stdin !== null) {
        child.stdin.on('error', () => {
          /* a closed stdin is reported by the exit code, not by a throw from a pipe */
        });
        child.stdin.end(stdin);
      }
    });
  }
}

/**
 * The test host: an in-memory table, no subprocess, no filesystem.
 *
 * Exported for tests and unreachable from the CLI - `--host` accepts `crontab` and nothing
 * else - so that no invocation of this tool can print a green install that only happened inside
 * a unit test (Part 20's rule about rehearsal evidence, applied one layer down).
 */
export class MemoryHost {
  constructor(initial = '') {
    this.table = initial;
    this.writes = 0;
    this.available = true;
  }

  async probe() {
    return this.available
      ? { available: true, reason: null }
      : { available: false, reason: 'test host has no cron facility' };
  }

  async read() {
    return { ok: true, text: this.table };
  }

  async write(text) {
    this.table = text;
    this.writes += 1;
    return { ok: true, error: null };
  }
}

/* ------------------------------------------------------------------ *
 * the managed block
 * ------------------------------------------------------------------ */

/** The block this tool owns, as bytes to be found between the markers. */
export const renderBlock = (artifactText, meta) => {
  const body = artifactText.replace(/\s+$/, '');
  const header = [
    BEGIN_MARKER,
    `# source: ${meta.sourcePath}`,
    `# sha256: ${meta.digest}`,
    `# installed: plan-only; this file is generated by dr-manifest.mjs --emit-schedule`,
  ];
  return `${header.join('\n')}\n${body}\n${END_MARKER}`;
};

/**
 * Split a host table into (foreign, managed, foreign) parts.
 *
 * Returns `null` for managed when the markers are unbalanced or duplicated: a half-installed
 * block is not something to overwrite silently, it is something to tell a human about, and the
 * exact same reasoning is why a corrupted ledger is refused rather than repaired.
 */
export const splitBlock = (text) => {
  const lines = String(text ?? '').split('\n');
  const begins = lines.map((l, i) => [l, i]).filter(([l]) => l.trim() === BEGIN_MARKER);
  const ends = lines.map((l, i) => [l, i]).filter(([l]) => l.trim() === END_MARKER);
  if (begins.length === 0 && ends.length === 0) {
    return { foreign: lines.join('\n').replace(/\s+$/, ''), managed: null };
  }
  if (begins.length !== 1 || ends.length !== 1) {
    return { foreign: lines.join('\n').replace(/\s+$/, ''), managed: undefined };
  }
  const [, beginIndex] = begins[0];
  const [, endIndex] = ends[0];
  if (endIndex <= beginIndex) {
    return { foreign: '', managed: undefined };
  }
  const foreign = [...lines.slice(0, beginIndex), ...lines.slice(endIndex + 1)]
    .join('\n')
    .replace(/\s+$/, '');
  return { foreign, managed: lines.slice(beginIndex, endIndex + 1).join('\n') };
};

/** The job lines inside a managed block, for comparison with the artifact. */
export const blockJobs = (block) =>
  String(block ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#') && !line.trim().startsWith('SHELL='))
    .map((line) => line.trim());

export const blockVars = (block) =>
  String(block ?? '')
    .split('\n')
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line.trim()))
    .map((line) => line.trim());

const digestOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/* ------------------------------------------------------------------ *
 * reading and validating what is about to be installed
 * ------------------------------------------------------------------ */

/** Resolve a path only inside the repository, so a flag cannot install from outside the tree. */
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
 * Load the artifact and run every law over it before the host is asked to do anything.
 *
 * The returned `findings` list is what an operator sees; the reasons are separate from the
 * schedule's own drift findings on purpose - one says "this file does not match the manifest",
 * the other says "this file is not installable", and merging them would hide which to fix.
 */
export const loadArtifact = ({ manifestPath = MANIFEST_PATH, schedulePath = SCHEDULE_PATH, root = ROOT } = {}) => {
  const findings = [];
  let manifest = null;
  let scheduleText = null;

  if (!existsSync(manifestPath)) {
    findings.push(`no manifest at ${relative(root, manifestPath)} - the schedule has nothing to be checked against`);
  } else {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      findings.push(`manifest is not readable JSON: ${error.message}`);
    }
    if (manifest !== null) {
      for (const problem of validateManifest(manifest, root)) {
        findings.push(`manifest: ${problem}`);
      }
    }
  }

  if (!existsSync(schedulePath)) {
    findings.push(
      `no schedule file at ${relative(root, schedulePath)} - run node scripts/dr-manifest.mjs --emit-schedule; ` +
        'this installer will not generate one',
    );
  } else {
    const stat = statSync(schedulePath);
    if (!stat.isFile()) {
      findings.push(`${relative(root, schedulePath)} is not a regular file`);
    } else {
      scheduleText = readFileSync(schedulePath, 'utf8');
      if (scheduleText.trim() === '') {
        findings.push('schedule file is empty or missing - run --emit-schedule');
      } else {
        for (const secret of findSecretShapes(scheduleText)) {
          findings.push(`schedule: ${secret}`);
        }
        if (manifest !== null) {
          for (const drift of scheduleDrift(manifest, scheduleText)) {
            findings.push(`drift: ${drift}`);
          }
        }
        // Independent re-check of law 4, not a reliance on the generator having done it.
        for (const line of scheduleText.split('\n')) {
          if (/\s--record(-rls)?(\s|$)/.test(line) && !line.trim().startsWith('#')) {
            findings.push(
              `schedule line writes ledger evidence and will not be installed unattended: ${line.trim()}`,
            );
          }
        }
      }
    }
  }

  return { manifest, scheduleText, findings };
}

/* ------------------------------------------------------------------ *
 * the three operations
 * ------------------------------------------------------------------ */

/**
 * `--check`: is the managed block installed, and does it still match the artifact?
 *
 * The drift question is answered against the CURRENT artifact, which is what makes this usable
 * as a CI or operator probe after the fact: a regenerated schedule that nobody reinstalled, and
 * a hand-edited host table, both land here.
 */
export const checkInstall = async ({ host, artifact }) => {
  const probe = await host.probe();
  if (!probe.available) {
    return {
      code: EXIT.NO_FACILITY,
      state: 'no-facility',
      reason: probe.reason ?? 'the host cron facility is unavailable',
      installed: null,
      expected: null,
    };
  }
  const read = await host.read();
  if (!read.ok) {
    return { code: EXIT.REFUSED, state: 'host-error', reason: read.error, installed: null, expected: null };
  }
  const { managed } = splitBlock(read.text);
  if (managed === null) {
    return {
      code: EXIT.NOT_INSTALLED,
      state: 'not-installed',
      reason: `no managed block in the host table; run --install (expected sha256 ${artifact.digest})`,
      installed: null,
      expected: artifact.digest,
    };
  }
  if (managed === undefined) {
    return {
      code: EXIT.DRIFT,
      state: 'malformed',
      reason: 'the managed block markers are unbalanced or duplicated; fix the host table by hand, this tool will not guess',
      installed: null,
      expected: artifact.digest,
    };
  }
  const installedJobs = blockJobs(managed);
  const expectedJobs = blockJobs(artifact.block);
  const installedVars = blockVars(managed);
  const expectedVars = blockVars(artifact.block);
  if (installedVars.join('\n') !== expectedVars.join('\n')) {
    return {
      code: EXIT.DRIFT,
      state: 'drift',
      reason: `the installed variable lines differ from the artifact: installed [${installedVars.join(' , ')}] expected [${expectedVars.join(' , ')}]`,
      installed: installedJobs,
      expected: expectedJobs,
    };
  }
  if (installedJobs.join('\n') !== expectedJobs.join('\n')) {
    const missing = expectedJobs.filter((job) => !installedJobs.includes(job));
    const extra = installedJobs.filter((job) => !expectedJobs.includes(job));
    return {
      code: EXIT.DRIFT,
      state: 'drift',
      reason: `the installed schedule differs from the artifact (missing ${missing.length}, unexpected ${extra.length})`,
      missing,
      extra,
      installed: installedJobs,
      expected: expectedJobs,
    };
  }
  return {
    code: EXIT.OK,
    state: 'installed',
    reason: null,
    installed: installedJobs,
    expected: expectedJobs,
    foreignPreserved: splitBlock(read.text).foreign.trim() !== '',
  };
};

/**
 * Build the install plan: the new host table, and whether anything would change.
 *
 * Pure on purpose - `apply: false` is how `--dry-run` runs the exact same code path, so the dry
 * run cannot describe an install the tool would not perform. That is the whole value of a dry
 * run; a second "preview" implementation would be free to disagree with the real one.
 */
export const planInstall = ({ hostText, artifact }) => {
  const { foreign, managed } = splitBlock(hostText);
  if (managed === undefined) {
    return { refuse: 'the host table already contains a malformed managed block; refusing to overwrite it' };
  }
  const block = artifact.block;
  if (managed === block) {
    return { changed: false, text: hostText.replace(/\s+$/, '') + '\n', block };
  }
  const head = foreign.trim() === '' ? [] : [foreign.replace(/\s+$/, '')];
  const text = [...head, block].join('\n') + '\n';
  return { changed: true, previous: managed, text, block };
};

export const planUninstall = ({ hostText }) => {
  const { foreign, managed } = splitBlock(hostText);
  if (managed === undefined) {
    return { refuse: 'the host table contains a malformed managed block; refusing to rewrite it' };
  }
  if (managed === null) {
    return { changed: false, text: hostText };
  }
  const trimmed = foreign.replace(/\s+$/, '');
  return { changed: true, text: trimmed === '' ? '' : `${trimmed}\n`, removed: managed };
};

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const parseArgs = (argv) => {
  const flags = {};
  const modes = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument ${JSON.stringify(arg)} (every argument must be a --flag)`);
    }
    const name = arg.slice(2);
    if (name === 'dry-run' || name === 'verbose') {
      flags[name] = true;
      continue;
    }
    if (name === 'check' || name === 'install' || name === 'uninstall') {
      modes.push(name);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} requires a value`);
    }
    flags[name] = value;
    i += 1;
  }
  if (modes.length !== 1) {
    throw new Error('exactly one of --check, --install, --uninstall is required');
  }
  return { mode: modes[0], flags };
};

const usage = () => [
  'usage:',
  '  node scripts/dr-schedule-install.mjs --check [--schedule PATH] [--manifest PATH]',
  '  node scripts/dr-schedule-install.mjs --install [--dry-run] [--schedule PATH] [--manifest PATH]',
  '  node scripts/dr-schedule-install.mjs --uninstall [--dry-run]',
  '',
  'installs, verifies and removes the generated DR schedule (`docs/dr/schedule/dr.cron`) in the',
  'user crontab, without generating it. Exit codes: 0 ok, 1 not installed, 2 drift, 3 refused,',
  '4 no cron facility on this host.',
].join('\n');

export async function main(argv, { host = null, out = console, root = ROOT } = {}) {
  if (argv.includes('--help') || argv.length === 0) {
    out.log(usage());
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    out.error(`dr-schedule-install: ${error.message}`);
    out.error(usage());
    return EXIT.REFUSED;
  }
  const { mode, flags } = parsed;
  if (flags.host !== undefined && !HOSTS.has(String(flags.host))) {
    out.error(
      `dr-schedule-install: unknown host ${JSON.stringify(flags.host)}; the only host is 'crontab' ` +
        '(the in-memory host exists for tests and cannot be selected, so a green install is always real)',
    );
    return EXIT.REFUSED;
  }

  let schedulePath;
  let manifestPath;
  try {
    schedulePath = repoPath(flags.schedule, SCHEDULE_PATH, '--schedule');
    manifestPath = repoPath(flags.manifest, MANIFEST_PATH, '--manifest');
  } catch (error) {
    out.error(`dr-schedule-install: ${error.message}`);
    return EXIT.REFUSED;
  }
  const loaded = loadArtifact({ manifestPath, schedulePath, root });
  const artifact = {
    sourcePath: relative(root, schedulePath),
    text: loaded.scheduleText,
    digest: loaded.scheduleText === null ? null : digestOf(loaded.scheduleText),
    block: loaded.scheduleText === null ? null : renderBlock(loaded.scheduleText, {
      sourcePath: relative(root, schedulePath),
      digest: digestOf(loaded.scheduleText),
    }),
  };

  if (loaded.findings.length > 0) {
    out.error(`dr-schedule-install: refusing to ${mode} - the artifact is not installable`);
    for (const finding of loaded.findings) {
      out.error(`  - ${finding}`);
    }
    if (mode === 'check') {
      out.error('  (--check reports the artifact problem rather than the host state; fix the file, then re-run)');
    }
    return EXIT.DRIFT;
  }

  const chosenHost = host ?? new CrontabHost();
  if (mode === 'check') {
    const result = await checkInstall({ host: chosenHost, artifact });
    out.log(
      `schedule ${result.state}` +
        (result.reason ? `: ${result.reason}` : ` (${(result.installed ?? []).length} job line(s) match the artifact)`) +
        (result.foreignPreserved ? '; unmanaged host entries left untouched' : ''),
    );
    return result.code;
  }

  // Probe before mutating. A check can tolerate a host it cannot reach by reporting `no-facility`,
  // but install and uninstall must not pretend: writing through a facility that is not there would
  // report success against a machine that will never run the schedule, which is worse than a
  // refusal - it is a green cell in a recovery plan.
  const probe = await chosenHost.probe();
  if (!probe.available) {
    out.error(
      `dr-schedule-install: refusing to ${mode}: this host has no cron facility (${probe.reason ?? 'unavailable'}). ` +
        'The artifact is valid; install it with whatever scheduler this platform actually has, and keep ' +
        'node scripts/dr-schedule-install.mjs --check out of the loop until then.',
    );
    return EXIT.NO_FACILITY;
  }

  const read = await chosenHost.read();
  if (!read.ok) {
    out.error(`dr-schedule-install: cannot read the host table: ${read.error}`);
    return EXIT.REFUSED;
  }

  if (mode === 'uninstall') {
    const plan = planUninstall({ hostText: read.text });
    if (plan.refuse) {
      out.error(`dr-schedule-install: ${plan.refuse}`);
      return EXIT.REFUSED;
    }
    if (!plan.changed) {
      out.log('nothing to remove: no managed block in the host table');
      return EXIT.OK;
    }
    if (flags['dry-run']) {
      out.log('dry run: would remove the managed block (host table shown below, unchanged on disk)');
      out.log(plan.text === '' ? '(the table would become empty)' : plan.text);
      return EXIT.OK;
    }
    const wrote = await chosenHost.write(plan.text);
    if (!wrote.ok) {
      out.error(`dr-schedule-install: the host refused the write: ${wrote.error}`);
      return EXIT.REFUSED;
    }
    const readBack = await chosenHost.read();
    if (readBack.ok && splitBlock(readBack.text).managed !== null) {
      out.error('dr-schedule-install: the host accepted the write but the managed block is still installed');
      return EXIT.DRIFT;
    }
    out.log(`removed the managed block (${plan.removed.split('\n').length - 2} line(s) of schedule), re-read and confirmed`);
    return EXIT.OK;
  }

  const plan = planInstall({ hostText: read.text, artifact });
  if (plan.refuse) {
    out.error(`dr-schedule-install: ${plan.refuse}`);
    return EXIT.REFUSED;
  }
  if (!plan.changed) {
    out.log(`already installed and current: sha256 ${artifact.digest.slice(0, 12)}…, nothing written`);
    return EXIT.OK;
  }
  const verb = plan.previous ? 'replace' : 'install';
  if (flags['dry-run']) {
    out.log(`dry run: would ${verb} the managed block; host table would become:`);
    out.log(plan.text);
    return EXIT.OK;
  }
  const wrote = await chosenHost.write(plan.text);
  if (!wrote.ok) {
    out.error(`dr-schedule-install: the host refused the write: ${wrote.error}`);
    return EXIT.REFUSED;
  }
  // Read the host back. An exit code says the command was willing, not that the table changed -
  // a host that truncates, or accepts the write under a different user, or ignores a line it does
  // not like, all answer 0. Verification is the only honest way to claim an install, and the same
  // reasoning is why the rehearsal runner re-runs its own probes after each step.
  const after = await checkInstall({ host: chosenHost, artifact });
  if (after.code !== EXIT.OK) {
    out.error(
      `dr-schedule-install: the host accepted the write but the installed schedule does not verify ` +
        `(state: ${after.state}${after.reason ? `: ${after.reason}` : ''}). Nothing is claimed installed.`,
    );
    return EXIT.DRIFT;
  }
  out.log(
    `${verb === 'install' ? 'installed' : 'replaced'} and re-read the managed block: ` +
      `${blockJobs(artifact.block).length} job line(s), source ${artifact.sourcePath} ` +
      `sha256 ${artifact.digest.slice(0, 12)}… verified against the host table` +
      (plan.previous ? ' (the previous block was replaced because it no longer matched)' : ''),
  );
  return EXIT.OK;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
