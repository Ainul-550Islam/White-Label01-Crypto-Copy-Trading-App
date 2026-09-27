/**
 * Tests for the DR schedule installer (run: `node --test scripts/`).
 *
 * Two layers, deliberately. Most tests drive the exported functions and the CLI against
 * `MemoryHost`, which is where the laws live: verification before trust, idempotence, foreign
 * entries preserved, every refusal refusing for the stated reason. One test - "the real
 * subprocess path" - drops a fake `crontab` executable into a temp directory on `PATH` and runs
 * the tool as a child process, because the argv/stdin plumbing and the "facility absent" answer
 * are exactly the parts a fake host cannot testify to.
 *
 * What these tests are NOT: evidence that any real host is scheduled. A `MemoryHost` install is
 * a unit test, and the CLI refuses to select it, so a green run here cannot be read as a green
 * run in a deployment. Same rule the rehearsal runner is built on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  BEGIN_MARKER,
  END_MARKER,
  MemoryHost,
  blockJobs,
  blockVars,
  checkInstall,
  loadArtifact,
  main,
  planInstall,
  planUninstall,
  renderBlock,
  splitBlock,
} from './dr-schedule-install.mjs';
import { MANIFEST_PATH, SCHEDULE_PATH, renderSchedule } from './dr-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TOOL = join(ROOT, 'scripts', 'dr-schedule-install.mjs');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const ARTIFACT = readFileSync(SCHEDULE_PATH, 'utf8');

const capture = () => {
  const lines = { out: [], error: [] };
  return {
    out: lines.out,
    error: lines.error,
    sink: { log: (m) => lines.out.push(String(m)), error: (m) => lines.error.push(String(m)) },
    text: () => `${lines.out.join('\n')}\n${lines.error.join('\n')}`,
  };
};

/** Edit exactly one scheduled job line, never a comment that mentions the same flag. */
const editJobLine = (text, predicate, replacement) =>
  text
    .split('\n')
    .map((line) => (/^\d/.test(line) && predicate(line) ? replacement(line) : line))
    .join('\n');

const artifactFor = (text) => {
  const digest = text === null ? null : `sha-${text.length}`;
  return {
    sourcePath: 'docs/dr/schedule/dr.cron',
    text,
    digest,
    block: text === null ? null : renderBlock(text, { sourcePath: 'docs/dr/schedule/dr.cron', digest }),
  };
};

/* ------------------------------------------------------------------ *
 * the artifact law: verify first, never generate
 * ------------------------------------------------------------------ */

test('the shipped artifact installs as-is: the block carries the generator bytes, unchanged', () => {
  const block = renderBlock(ARTIFACT, { sourcePath: 'docs/dr/schedule/dr.cron', digest: 'abc' });
  assert.ok(block.startsWith(`${BEGIN_MARKER}\n`));
  assert.ok(block.endsWith(`\n${END_MARKER}`));
  assert.deepEqual(blockJobs(block), blockJobs(ARTIFACT));
  assert.deepEqual(blockVars(block), blockVars(ARTIFACT));
  // Install must be replayable: a timestamp in the header would make every install "drifted".
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(block), 'the managed block carries a timestamp');
});

test('loadArtifact: the real manifest and the real schedule produce no findings', () => {
  const loaded = loadArtifact({ manifestPath: MANIFEST_PATH, schedulePath: SCHEDULE_PATH, root: ROOT });
  assert.deepEqual(loaded.findings, []);
  assert.ok(loaded.scheduleText.length > 0);
});

test('a missing artifact is a refusal naming the generator, not a generation', () => {
  const missing = join(ROOT, 'docs', 'dr', 'schedule', `absent-${process.pid}.cron`);
  const loaded = loadArtifact({ manifestPath: MANIFEST_PATH, schedulePath: missing, root: ROOT });
  assert.equal(loaded.scheduleText, null);
  assert.ok(
    loaded.findings.some((f) => f.includes('--emit-schedule') && f.includes('will not generate')),
    loaded.findings.join(' | '),
  );
});

test('a malformed manifest is refused with the validator reason attached', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-install-manifest-'));
  const badPath = join(dir, 'manifest.json');
  const schedulePath = join(dir, 'dr.cron');
  writeFileSync(badPath, JSON.stringify({ schema: 'nope' }));
  writeFileSync(schedulePath, renderSchedule(MANIFEST));
  const loaded = loadArtifact({ manifestPath: badPath, schedulePath, root: dir });
  assert.ok(loaded.findings.length > 0);
  assert.ok(
    loaded.findings.some((f) => f.startsWith('manifest: schema must be')),
    loaded.findings.join(' | '),
  );
});

test('drift against the manifest is refused: the installer cannot be talked into a hand-edited file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-install-drift-'));
  const schedulePath = join(dir, 'dr.cron');
  const handEdited = `${ARTIFACT}\n0 3 * * * node scripts/dr-manifest.mjs --due --extra-flag\n`;
  writeFileSync(schedulePath, handEdited);
  const loaded = loadArtifact({ manifestPath: MANIFEST_PATH, schedulePath, root: ROOT });
  assert.ok(loaded.findings.some((f) => f.startsWith('drift: ')), loaded.findings.join(' | '));
});

test('a schedule line that writes ledger evidence is refused on its own terms', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-install-ledger-'));
  const schedulePath = join(dir, 'dr.cron');
  const text = editJobLine(
    renderSchedule(MANIFEST),
    (line) => line.includes('--due'),
    () => '0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --record --component postgres --grade pass',
  );
  assert.notEqual(text, renderSchedule(MANIFEST), 'the test edit must have hit a job line');
  writeFileSync(schedulePath, text);
  const loaded = loadArtifact({ manifestPath: MANIFEST_PATH, schedulePath, root: ROOT });
  assert.ok(
    loaded.findings.some((f) => f.includes('writes ledger evidence')),
    loaded.findings.join(' | '),
  );
});

test('a secret-shaped schedule is refused before the host sees it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-install-secret-'));
  const schedulePath = join(dir, 'dr.cron');
  writeFileSync(schedulePath, `${ARTIFACT}\n# ENCRYPTION_MASTER_KEY_BASE64=c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0\n`);
  const loaded = loadArtifact({ manifestPath: MANIFEST_PATH, schedulePath, root: ROOT });
  assert.ok(loaded.findings.some((f) => f.startsWith('schedule: ')), loaded.findings.join(' | '));
});

/* ------------------------------------------------------------------ *
 * the managed block
 * ------------------------------------------------------------------ */

test('splitBlock: foreign entries and the managed block are told apart', () => {
  const text = [
    'MAILTO=ops@example.invalid',
    '@reboot /usr/local/bin/keep-an-eye.sh',
    BEGIN_MARKER,
    'SHELL=/bin/sh',
    '0 0 * * * node scripts/dr-manifest.mjs --due',
    END_MARKER,
    '15 6 * * 1 /usr/local/bin/other-team-backup.sh',
  ].join('\n');
  const { foreign, managed } = splitBlock(text);
  assert.ok(managed.includes('--due'));
  assert.ok(!managed.includes('other-team-backup'));
  assert.ok(foreign.includes('MAILTO=ops@example.invalid'));
  assert.ok(foreign.includes('other-team-backup.sh'), 'a foreign job must never be inside managed');
});

test('splitBlock: no markers is "not installed", and unbalanced markers are "malformed"', () => {
  assert.equal(splitBlock('0 0 * * * echo hi').managed, null);
  const onlyBegin = `${BEGIN_MARKER}\n0 0 * * * node scripts/dr-manifest.mjs --due`;
  assert.equal(splitBlock(onlyBegin).managed, undefined);
  const doubled = renderBlock(ARTIFACT, { sourcePath: 'x', digest: 'y' }) +
    `\n` +
    renderBlock(ARTIFACT, { sourcePath: 'x', digest: 'y' });
  assert.equal(splitBlock(doubled).managed, undefined);
});

test('blockJobs and blockVars ignore comments and blanks', () => {
  const block = renderBlock(ARTIFACT, { sourcePath: 'x', digest: 'y' });
  assert.ok(blockJobs(block).length >= 3, 'the real artifact has three or more jobs');
  assert.deepEqual(blockVars(block), ['wlctRoot=.', 'SHELL=/bin/sh']);
  for (const job of blockJobs(block)) {
    assert.ok(!job.startsWith('#'), `comment leaked into job lines: ${job}`);
  }
});

/* ------------------------------------------------------------------ *
 * plan: idempotence, foreign preservation, dry-run equivalence
 * ------------------------------------------------------------------ */

test('planInstall is idempotent: installing the same artifact twice reports no change', () => {
  const artifact = artifactFor(ARTIFACT);
  const first = planInstall({ hostText: '', artifact });
  assert.equal(first.changed, true);
  const second = planInstall({ hostText: first.text, artifact });
  assert.equal(second.changed, false, 'a second install must not rewrite a current table');
  assert.equal(second.text.replace(/\s+$/, ''), first.text.replace(/\s+$/, ''));
});

test('planInstall preserves unmanaged host entries byte for byte and stays append-at-end', () => {
  const artifact = artifactFor(ARTIFACT);
  const foreign = ['MAILTO=root', '# a comment with a --due inside it', '0 4 * * 0 /usr/local/bin/dba.sh'].join('\n');
  const plan = planInstall({ hostText: `${foreign}\n`, artifact });
  const { foreign: roundTripped, managed } = splitBlock(plan.text);
  assert.equal(roundTripped, foreign);
  assert.ok(managed.includes('--due'), 'the managed block is the one we generated');
});

test('planInstall refuses to overwrite a malformed block rather than guessing', () => {
  const artifact = artifactFor(ARTIFACT);
  const plan = planInstall({ hostText: `${BEGIN_MARKER}\n0 0 * * * broken`, artifact });
  assert.match(plan.refuse, /malformed/);
  assert.equal(plan.text, undefined);
});

test('planUninstall removes only the managed block, and says so when there is nothing to do', () => {
  const artifact = artifactFor(ARTIFACT);
  const installed = planInstall({ hostText: 'MAILTO=root\n', artifact }).text;
  const removed = planUninstall({ hostText: installed });
  assert.equal(removed.changed, true);
  assert.equal(removed.text, 'MAILTO=root\n');
  assert.equal(planUninstall({ hostText: 'MAILTO=root\n' }).changed, false);
  assert.match(planUninstall({ hostText: `${END_MARKER}\n` }).refuse ?? '', /malformed/);
});

/* ------------------------------------------------------------------ *
 * check: not installed, installed, drifted after install
 * ------------------------------------------------------------------ */

test('checkInstall: four states, each with its own exit code and reason', async () => {
  const artifact = artifactFor(ARTIFACT);

  const empty = new MemoryHost('');
  assert.equal((await checkInstall({ host: empty, artifact })).code, 1, 'not installed');
  assert.match((await checkInstall({ host: empty, artifact })).reason, /no managed block/);

  const installedText = planInstall({ hostText: '', artifact }).text;
  const installed = new MemoryHost(installedText);
  const ok = await checkInstall({ host: installed, artifact });
  assert.equal(ok.code, 0);
  assert.equal(ok.state, 'installed');

  const edited = new MemoryHost(installedText.replace('0 0 * * *', '30 5 * * *'));
  const drift = await checkInstall({ host: edited, artifact });
  assert.equal(drift.code, 2, 'a hand-edited host entry is drift, not a pass');
  assert.equal(drift.state, 'drift');
  assert.equal(drift.missing.length, 1);
  assert.equal(drift.extra.length, 1);

  const varDrift = new MemoryHost(installedText.replace('SHELL=/bin/sh', 'SHELL=/bin/bash'));
  const varResult = await checkInstall({ host: varDrift, artifact });
  assert.equal(varResult.code, 2, 'a changed variable line is drift too');
  assert.match(varResult.reason, /variable lines/);

  const noFacility = new MemoryHost('');
  noFacility.available = false;
  const missing = await checkInstall({ host: noFacility, artifact });
  assert.equal(missing.code, 4);
  assert.equal(missing.state, 'no-facility');
});

test('checkInstall flags a drifted SHELL line even when the jobs match', async () => {
  const artifact = artifactFor(ARTIFACT);
  const host = new MemoryHost(planInstall({ hostText: '', artifact }).text.replace('SHELL=/bin/sh', 'SHELL=/bin/bash'));
  assert.match((await checkInstall({ host, artifact })).reason, /installed variable lines differ/);
});

/* ------------------------------------------------------------------ *
 * the CLI, against a fake host
 * ------------------------------------------------------------------ */

test('CLI: --check then --install then --check, idempotent, then --uninstall', async () => {
  const artifact = artifactFor(ARTIFACT);
  const host = new MemoryHost('MAILTO=root\n');
  const seen = [];

  const run = async (argv) => {
    const cap = capture();
    const code = await main(argv, { host, out: cap.sink, root: ROOT });
    seen.push(`${argv.join(' ')} -> ${code}`);
    return { code, text: cap.text() };
  };

  const check0 = await run(['--check']);
  assert.equal(check0.code, 1, seen.join(' | '));
  assert.match(check0.text, /schedule not-installed/);

  const dry = await run(['--install', '--dry-run']);
  assert.equal(dry.code, 0);
  assert.equal(host.writes, 0, 'a dry run must not write');
  assert.match(dry.text, /dry run: would install/);
  assert.ok(dry.text.includes('--due'), 'the dry run shows the real content, not a summary');

  const install = await run(['--install']);
  assert.equal(install.code, 0);
  assert.equal(host.writes, 1);
  assert.match(install.text, /installed and re-read the managed block/);

  const check1 = await run(['--check']);
  assert.equal(check1.code, 0, seen.join(' | '));
  assert.match(check1.text, /schedule installed/);

  const again = await run(['--install']);
  assert.equal(again.code, 0);
  assert.equal(host.writes, 1, 'the second install must be a no-op');
  assert.match(again.text, /already installed and current/);

  assert.ok(host.table.startsWith('MAILTO=root\n'), 'foreign entry survives an install');

  const uninstallDry = await run(['--uninstall', '--dry-run']);
  assert.equal(uninstallDry.code, 0);
  assert.equal(host.writes, 1, 'a dry-run uninstall must not write either');

  const uninstall = await run(['--uninstall']);
  assert.equal(uninstall.code, 0);
  assert.equal(host.table, 'MAILTO=root\n');
  assert.equal((await run(['--uninstall'])).code, 0, 'uninstall is idempotent too');
});

test('CLI: a drifted host table fails --check after a successful install', async () => {
  const artifact = artifactFor(ARTIFACT);
  const drifted = editJobLine(
    planInstall({ hostText: '', artifact }).text,
    (line) => line.includes('--due'),
    (line) => `${line} --force`,
  );
  assert.notEqual(drifted, planInstall({ hostText: '', artifact }).text);
  const host = new MemoryHost(drifted);
  const cap = capture();
  const code = await main(['--check'], { host, out: cap.sink, root: ROOT });
  assert.equal(code, 2);
  assert.match(cap.text(), /schedule drift/);
});

test('CLI: no cron facility is a refusal for install and uninstall, not a silent success', async () => {
  for (const mode of ['--install', '--uninstall']) {
    const host = new MemoryHost('');
    host.available = false;
    const cap = capture();
    const code = await main([mode], { host, out: cap.sink, root: ROOT });
    assert.equal(code, 4, `${mode} must not report success without a facility`);
    assert.equal(host.writes, 0);
    assert.match(cap.text(), /no cron facility/);
  }
});

test('CLI: the in-memory test host cannot be selected, so a green install is always real', async () => {
  const cap = capture();
  const code = await main(['--install', '--host', 'memory'], { host: new MemoryHost(), out: cap.sink, root: ROOT });
  assert.equal(code, 3);
  assert.match(cap.text(), /only host is 'crontab'/);
});

test('CLI: artifact problems are refused for every mode with exit 2', async () => {
  const missing = join(ROOT, 'docs', 'dr', 'schedule', `absent-${process.pid}.cron`);
  for (const mode of ['--check', '--install', '--uninstall']) {
    const cap = capture();
    const code = await main([mode, '--schedule', missing], { host: new MemoryHost(), out: cap.sink, root: ROOT });
    assert.equal(code, 2, `${mode}: ${cap.text()}`);
    assert.match(cap.text(), /not installable|no schedule file/);
  }
});

test('CLI: paths outside the repository are refused, and so is a NUL byte', async () => {
  for (const candidate of ['../../etc/crontab', '/etc/cron.d/wlct', 'x\0y']) {
    const cap = capture();
    const code = await main(['--check', '--schedule', candidate], { host: new MemoryHost(), out: cap.sink, root: ROOT });
    assert.equal(code, 3, `${candidate}: ${cap.text()}`);
  }
});

test('CLI: argument mistakes are refusals, never partial installs', async () => {
  for (const argv of [['--install', '--check'], ['--frobnicate'], ['--install', '--schedule'], ['positional']]) {
    const cap = capture();
    const code = await main(argv, { host: new MemoryHost(), out: cap.sink, root: ROOT });
    assert.equal(code, 3, `${argv.join(' ')}: ${cap.text()}`);
  }
  const cap = capture();
  assert.equal(await main([], { host: new MemoryHost(), out: cap.sink, root: ROOT }), 0, 'bare run prints usage');
  assert.match(cap.text(), /usage:/);
});

/* ------------------------------------------------------------------ *
 * the real subprocess path: a fake `crontab` binary, nothing else on PATH
 * ------------------------------------------------------------------ */

/**
 * A stand-in for the host's `crontab`, written into a temp directory that becomes the child's whole
 * PATH. Shell builtins only, on purpose: the installer gives the child a deliberately minimal
 * environment (PATH, HOME, LC_ALL), so a fake that shelled out to `cat` would be testing whether
 * coreutils happens to be on PATH. The first version of this fake did exactly that, and "succeeded"
 * with an empty table while `cat` was missing - the incident that made verify-after-write a
 * requirement rather than a nicety, and which the "a host that answers 0 without changing the
 * table" test below pins.
 */
const writeFakeCrontab = (dir, statePath, { lie = false } = {}) => {
  const script = join(dir, 'crontab');
  const lines = [
    '#!/bin/sh',
    `STATE=${JSON.stringify(statePath)}`,
    'if [ "$1" = "-T" ]; then exit 0; fi',
    'if [ "$1" = "-l" ]; then',
    '  if [ -f "$STATE" ]; then',
    '    while IFS= read -r line || [ -n "$line" ]; do printf "%s\\n" "$line"; done < "$STATE"',
    '    exit 0',
    '  fi',
    '  printf "no crontab for wlct\\n" >&2; exit 1',
    'fi',
    'if [ "$1" = "-" ]; then',
    '  : > "$STATE"',
    lie
      ? '  while IFS= read -r line || [ -n "$line" ]; do :; done; exit 0'
      : '  while IFS= read -r line || [ -n "$line" ]; do printf "%s\\n" "$line" >> "$STATE"; done; exit 0',
    'fi',
    'printf "unsupported argument: %s\\n" "$*" >&2; exit 2',
    '',
  ];
  writeFileSync(script, lines.join('\n'));
  chmodSync(script, 0o755);
  return script;
};

test('the real subprocess path installs, detects drift, and uninstalls through argv arrays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-install-bin-'));
  const statePath = join(dir, 'state');
  writeFakeCrontab(dir, statePath);
  const env = { ...process.env, PATH: dir, HOME: dir, LC_ALL: 'C' };
  const run = (args) => {
    try {
      const stdout = execFileSync(process.execPath, [TOOL, ...args], {
        cwd: ROOT,
        env,
        encoding: 'utf8',
      });
      return { code: 0, stdout };
    } catch (error) {
      return { code: error.status, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  };

  assert.equal(run(['--check']).code, 1, 'no crontab file yet -> not installed');
  assert.equal(run(['--install']).code, 0);
  const installed = readFileSync(statePath, 'utf8');
  assert.ok(installed.includes(BEGIN_MARKER) && installed.includes(END_MARKER));
  assert.deepEqual(blockJobs(installed), blockJobs(ARTIFACT), 'the host received the artifact bytes');
  assert.equal(run(['--check']).code, 0);
  assert.equal(run(['--install']).code, 0, 'idempotent through the real path too');
  assert.equal(readFileSync(statePath, 'utf8'), installed, 'a no-op install rewrites nothing');

  const edited = editJobLine(installed, (line) => line.includes('--due'), (line) => `${line} --force`);
  assert.notEqual(edited, installed);
  writeFileSync(statePath, edited);
  const drift = run(['--check']);
  assert.equal(drift.code, 2);
  assert.match(drift.stdout, /schedule drift/);

  assert.equal(run(['--uninstall']).code, 0);
  assert.equal(readFileSync(statePath, 'utf8').trim(), '');

  // A host without the binary at all: absence must be reported as absence.
  const nowhere = { ...process.env, PATH: join(dir, 'does-not-exist'), HOME: dir };
  try {
    const stdout = execFileSync(process.execPath, [TOOL, '--check'], { cwd: ROOT, env: nowhere, encoding: 'utf8' });
    assert.fail(`expected a non-zero exit, got: ${stdout}`);
  } catch (error) {
    assert.equal(error.status, 4, `no facility must exit 4, got ${error.status}: ${error.stdout}`);
    assert.match(`${error.stdout}${error.stderr}`, /not on PATH/);
  }
});

test('a host that answers 0 without changing the table is reported as a failure, not an install', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-install-liar-'));
  const statePath = join(dir, 'state');
  writeFakeCrontab(dir, statePath, { lie: true });
  const env = { ...process.env, PATH: dir, HOME: dir, LC_ALL: 'C' };
  try {
    const stdout = execFileSync(process.execPath, [TOOL, '--install'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.fail(`the install should not have been claimed, got: ${stdout}`);
  } catch (error) {
    assert.equal(error.status, 2, `expected exit 2 (verified install failed), got ${error.status}`);
    assert.match(`${error.stdout}${error.stderr}`, /accepted the write but the installed schedule does not verify/);
  }
  // The artifact itself is untouched, and a check still says the honest thing.
  const check = (() => {
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [TOOL, '--check'], { cwd: ROOT, env, encoding: 'utf8' }) };
    } catch (error) {
      return { code: error.status, stdout: `${error.stdout}${error.stderr}` };
    }
  })();
  assert.equal(check.code, 1, check.stdout);
  assert.match(check.stdout, /not-installed/);
});

/* ------------------------------------------------------------------ *
 * the subprocess law, pinned statically (repo precedent: Part 14 execFile)
 * ------------------------------------------------------------------ */

test('the module executes nothing but an allowlisted argv array, with no shell', () => {
  const source = readFileSync(TOOL, 'utf8');
  assert.ok(source.includes("import { spawn } from 'node:child_process'"), 'no spawn import?');
  assert.ok(!/\bexecSync\s*\(/.test(source) && !/\bexec\s*\(/.test(source), 'a shell-executing call appeared');
  assert.ok(!/shell:\s*true/.test(source), 'a shell was enabled');
  assert.ok(!/new RegExp\(/.test(source), 'a caller-supplied string reaches RegExp');
  assert.match(source, /const COMMAND_ALLOWLIST = new Set\(\['crontab'\]\)/);
  assert.equal((source.match(/spawn\(/g) ?? []).length, 1, 'every spawn call must be inside the allowlisted runner');
});
