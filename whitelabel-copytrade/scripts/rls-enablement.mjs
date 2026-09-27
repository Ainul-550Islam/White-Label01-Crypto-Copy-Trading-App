#!/usr/bin/env node
/**
 * RLS enablement verification entry point (Part 15).
 *
 * One sentence, honestly stated: THIS SCRIPT NEVER CONNECTS TO A DATABASE.
 * It is a thin, credential-free caller of the engine's read-only audit
 * endpoint, plus a recorder that turns the answer into repository evidence
 * (`docs/dr/rls-evidence.jsonl`) with the same append-only discipline the
 * backup ledger uses. A tool that "audits security" and also holds the
 * database password is the tool an operator is least able to trust: it can
 * make the finding as well as report it. Here the finding comes from the
 * engine (which holds the connection because it must serve traffic) and the
 * judgement comes from the core law inside it (`wlct_trading.enablement`);
 * this file only moves bytes.
 *
 *   node scripts/rls-enablement.mjs audit
 *     [--base-url URL] [--token TOKEN] [--tenant UUID]
 *     [--seed engine_orders=3,...] [--covered-expected N]
 *     [--record] [--note TEXT] [--at ISO] [--ledger PATH] [--json]
 *
 *     Calls POST /internal/v1/enablement/audit on the INTERNAL plane and
 *     prints the graded answer. Exit code: 0 pass, 1 fail, 2 unverified or
 *     transport refusal. `--record` appends one evidence line (grade, probed
 *     count, role, note) - and refuses to record anything it did not receive.
 *
 *   node scripts/rls-enablement.mjs check [--now ISO] [--ledger PATH]
 *
 *     Delegates to `node scripts/dr-manifest.mjs --check-rls`: is there a
 *     PASSING audit young enough to believe? (Cadence lives in the DR
 *     manifest's rlsEvidence block, so the answer is one policy, not two.)
 *
 *   node scripts/rls-enablement.mjs print-sql
 *
 *     The exact SQL the engine will run, straight out of the shipped Python
 *     module, so a DBA can do with psql what the endpoint does - and see that
 *     there is nothing in it but SELECTs. Parsing the module here (rather
 *     than restating the statements) is what keeps this help text from
 *     becoming the second, wrong copy of the truth.
 *
 * Why the token is a flag or an env var and never a default: the engine's
 * internal token is a credential like any other, and a helper that quietly
 * reads it out of a compose file would be the one place in the repository
 * where a "security tool" holds production keys.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE_MODULE = join(ROOT, 'services', 'execution-engine', 'app', 'rls_probe.py');
// Resolved by dr-manifest against the manifest's own rlsEvidence block when
// unset, so this helper cannot point evidence at a file the policy does not
// read - and must not invent a default the validator would refuse.
const DEFAULT_LEDGER = 'docs/dr/rls-evidence.jsonl';
const GRADES = new Set(['pass', 'fail', 'unverified']);

/* ---------------------------------- args --------------------------------- */

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, flags: {}, positionals: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      options.positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const eq = name.indexOf('=');
    if (eq !== -1) {
      options.flags[name.slice(0, eq)] = name.slice(eq + 1);
      continue;
    }
    if (['record', 'json'].includes(name)) {
      options.flags[name] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`flag --${name} requires a value`);
    }
    options.flags[name] = value;
    i += 1;
  }
  return options;
}

function fail(message) {
  console.error(`rls-enablement: ${message}`);
  process.exit(2);
}

function usage() {
  console.error(
    [
      'usage:',
      '  node scripts/rls-enablement.mjs audit [--base-url URL] [--token TOKEN] --tenant UUID',
      '                                        [--seed TABLE=N,...] [--covered-expected N] [--record] [--note TEXT] [--at ISO] [--ledger PATH] [--json]',
      '  node scripts/rls-enablement.mjs check [--now ISO] [--ledger PATH]',
      '  node scripts/rls-enablement.mjs print-sql',
    ].join('\n'),
  );
  return 2;
}

/* --------------------------------- audit --------------------------------- */

function audit(options) {
  const { flags } = options;
  const baseUrl = flags['base-url'] ?? process.env.EXECUTION_ENGINE_URL;
  const token = flags.token ?? process.env.EXECUTION_INTERNAL_TOKEN;
  const tenant = flags.tenant ?? process.env.WLCT_RLS_PROBE_TENANT;
  if (!baseUrl || !token || !tenant) {
    fail(
      'audit needs --base-url, --token and --tenant (or EXECUTION_ENGINE_URL / ' +
        'EXECUTION_INTERNAL_TOKEN / WLCT_RLS_PROBE_TENANT). There is no default on ' +
        'purpose: a helper that guesses an internal endpoint can audit the wrong cluster.',
    );
  }
  if (token.length < 32) {
    fail('--token is too short to be a real internal token (the engine requires >= 32 chars)');
  }
  const body = { tenantId: tenant };
  if (flags.seed !== undefined) {
    body.seedCounts = parseSeed(flags.seed);
  }
  if (flags['covered-expected'] !== undefined) {
    const n = Number(flags['covered-expected']);
    if (!Number.isInteger(n) || n < 1 || n > 4096) {
      fail('--covered-expected must be an integer 1..4096 (the coverage manifest\'s table count)');
    }
    body.coveredExpected = n;
  }
  const url = `${String(baseUrl).replace(/\/$/, '')}/internal/v1/enablement/audit`;
  let response;
  try {
    const raw = execFileSync(
      'curl',
      [
        '--silent',
        '--show-error',
        '--fail-with-body',
        '--max-time',
        String(Number(flags.timeout ?? 60)),
        '--request',
        'POST',
        url,
        '--header',
        `x-internal-token: ${token}`,
        '--header',
        `x-tenant-id: ${tenant}`,
        '--header',
        'content-type: application/json',
        '--data',
        JSON.stringify(body),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    response = JSON.parse(raw);
  } catch (error) {
    // A refusal from the endpoint (409 no durable store, 400 bad request) is
    // INFORMATION the operator asked for; do not flatten it into "curl
    // failed", and never echo the token while explaining.
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.replaceAll(String(token), '[redacted]');
    console.error(`rls-enablement: the audit did not complete:\n${detail}`);
    console.error('no evidence was recorded - a run that did not happen is not a pass');
    return 2;
  }
  const grade = response.grade;
  if (!GRADES.has(grade)) {
    console.error(`rls-enablement: the engine answered with an unknown grade ${JSON.stringify(grade)}`);
    return 2;
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } else {
    printAudit(response);
  }
  if (flags.record) {
    // A recording failure changes nothing about the FINDING: the audit ran
    // and its grade is on the screen. Distinguishing them is the difference
    // between "the database is not isolated" and "we cannot prove whether it
    // is", and an operator who merges the two stops trusting both.
    const recorded = record(response, { ...flags, token });
    if (!recorded && grade === 'pass') {
      return 2;
    }
  }
  return grade === 'pass' ? 0 : grade === 'fail' ? 1 : 2;
}

function parseSeed(raw) {
  const seeds = {};
  for (const part of String(raw).split(',')) {
    if (part.trim() === '') {
      continue;
    }
    const [table, value] = part.split('=');
    const count = Number(value);
    if (!table || value === undefined || !Number.isInteger(count) || count < 0) {
      fail(`--seed expects TABLE=COUNT pairs (got ${JSON.stringify(part)})`);
    }
    seeds[table.trim()] = count;
  }
  return seeds;
}

function printAudit(response) {
  const banner = {
    pass: 'PASS  - every probed table is enabled, forced, and isolated as far as this run could see',
    fail: 'FAIL  - at least one table is NOT proving isolation; treat as a security finding, not a lint',
    unverified: 'UNVERIFIED - the run was incomplete or skipped tables; this is NOT a pass',
  }[response.grade];
  console.log(`\n${banner}`);
  console.log(`role: ${response.role.rolname} (bypassrls=${response.role.bypassrls}, superuser=${response.role.superuser})`);
  console.log(
    `probed: ${response.probed}, fullPlatform=${response.fullPlatform}, ` +
      `enginePlaneComplete=${response.enginePlaneComplete}, at ${new Date(Number(response.ranAtUs) / 1000).toISOString()}`,
  );
  for (const probe of response.probes) {
    console.log(
      `  [${probe.grade.toUpperCase().padEnd(3)}] ${probe.table.padEnd(24)} ` +
        `policy=${probe.policyExists} enable=${probe.rlsEnabled} force=${probe.rlsForced} ` +
        `scoped=${probe.scopedRows}/${probe.seededExpectedRows} bare=${probe.bareRows}` +
        `${probe.absent ? ' ABSENT' : ''}${probe.skipReason ? ` skipped: ${probe.skipReason}` : ''}`,
    );
  }
  if (response.summary?.veto !== undefined) {
    console.log(`  veto: ${JSON.stringify(response.summary.veto)}`);
  }
  console.log('');
}

/* --------------------------------- record -------------------------------- */

/** Record the audit's outcome as repository evidence.
 *
 * There is exactly ONE writer of `rls-evidence.jsonl`: dr-manifest's
 * `--record-rls`, which owns the shape rules (closed grade vocabulary,
 * single-line fields, secret scan, corrupt-ledger refusal). Re-implementing
 * them here would be the classic second copy of a policy: the copy that
 * drifts, and the one an operator follows when the first is inconvenient.
 * So this function assembles flags, shells out, and reports - it does not
 * open the file.
 */
function record(response, flags) {
  const args = [join(ROOT, 'scripts', 'dr-manifest.mjs'), '--record-rls', '--grade', response.grade];
  if (Number.isInteger(response.probed)) {
    args.push('--probed', String(response.probed));
  }
  if (typeof response.role?.rolname === 'string') {
    args.push('--role', response.role.rolname.slice(0, 200));
  }
  if (flags.note !== undefined) {
    if (/[[\r\n]/.test(flags.note) || flags.note.length > 500) {
      fail('--note must be one line of at most 500 characters');
    }
    args.push('--note', flags.note);
  }
  if (flags.at !== undefined) {
    args.push('--at', flags.at);
  }
  const ledger = flags.ledger ?? DEFAULT_LEDGER;
  if (String(ledger).includes('..')) {
    fail('--ledger must not traverse outside the repository');
  }
  // Absolute for the CHILD only: dr-manifest resolves a relative --ledger as
  // process.cwd()-relative, so handing it the resolved path is what makes
  // `cd somewhere/else && ... --record` still record against THIS checkout.
  args.push('--ledger', resolve(ledger));
  try {
    process.stdout.write(execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    return true;
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.replaceAll(
      String(flags.token ?? process.env.EXECUTION_INTERNAL_TOKEN ?? ''),
      '[redacted]',
    );
    console.error(`rls-enablement: the evidence line was NOT recorded:\n${detail.trim()}`);
    console.error('the audit answer above stands; the ledger is what says it happened');
    return false;
  }
}

/* --------------------------------- print-sql ----------------------------- */

const SQL_ASSIGNMENT = /^(\w+_SQL): Final = \(?[\s\S]*?\n\)|^(\w+_SQL): Final = "([^"]*)"/gm;

function printSql() {
  const source = readFileSync(PROBE_MODULE, 'utf8');
  const statements = extractSql(source);
  if (statements.length === 0) {
    fail(`no SQL constants found in ${PROBE_MODULE} - the executor moved, so did this helper`);
  }
  for (const [name, sql] of statements) {
    console.log(`-- ${name}`);
    console.log(`${sql};\n`);
  }
  console.log(
    [
      '-- The scoped count runs inside a transaction that begins with:',
      "--   SELECT set_config('app.tenant_id', $1, true);",
      "--   SET TRANSACTION READ ONLY",
      '-- The bare count runs on a separate acquisition with NO tenant GUC.',
      '-- Verification of that ordering is automated: the engine test suite pins',
      '-- it in tests/test_part15_enablement.py, and the parity file pins this',
      '-- SQL against apps/api/prisma/rls/.',
    ].join('\n'),
  );
  return 0;
}

/** The module's SQL constants, read out of the shipped Python source. Kept
 * regex-simple on purpose: this is documentation help, not a parser, and a
 * change to the module's spelling is a change the parity tests must notice
 * first. */
export function extractSql(source) {
  const out = [];
  const re = /^(\w+_SQL): Final = \(\n([\s\S]*?)\n\)|^(\w+_SQL): Final = "([^"]*)"$/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match[1] !== undefined) {
      const text = match[2]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('"') || line.startsWith("'"))
        .map((line) => line.replace(/^["']|["'],?$/g, ''))
        .join(' ');
      out.push([match[1], text]);
    } else {
      out.push([match[3], match[4]]);
    }
  }
  return out;
}

/* ---------------------------------- main --------------------------------- */

function main(argv) {
  const options = parseArgs(argv);
  if (options.command === undefined) {
    return usage();
  }
  if (options.command === 'audit') {
    return audit(options);
  }
  if (options.command === 'check') {
    const args = [join(ROOT, 'scripts', 'dr-manifest.mjs'), '--check-rls'];
    if (options.flags.now !== undefined) {
      args.push('--now', options.flags.now);
    }
    if (options.flags.ledger !== undefined) {
      args.push('--ledger', options.flags.ledger);
    }
    try {
      process.stdout.write(execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] }));
      return 0;
    } catch (error) {
      return typeof error.status === 'number' ? error.status : 1;
    }
  }
  if (options.command === 'print-sql') {
    return printSql();
  }
  return usage();
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
