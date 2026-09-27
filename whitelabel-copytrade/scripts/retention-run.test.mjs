/**
 * Tests for the retention CLI (run: `node --test scripts/`).
 *
 * Two layers: the pure parts (arg law, request shape, summarization, the
 * token scrub) are unit-called; the CLI itself runs as a real process
 * against a real localhost HTTP fake of the engine, asserting exit codes
 * the scheduler will key on, header/body correctness the engine will key
 * on, and the one property an echo-happy CLI most easily breaks: nothing
 * prints the token, not even an error body that contains it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { parseArgs, requestFor, scrubToken, summarize } from './retention-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'retention-run.mjs');
const TENANT = '4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TOKEN = 'tok-cli-test-0123456789abcdef0123456789abcdef';

const execFileAsync = promisify(execFile);

// ASYNC on purpose: the fake engine listens on THIS process's event loop,
// and a synchronous child spawn would freeze the loop the server needs to
// answer - the test would "hang" exactly like a wedged deployment.
async function runCli(args, env = {}) {
  const full = { ...process.env, EXECUTION_ENGINE_TOKEN: TOKEN, ...env };
  try {
    const { stdout } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
      env: full,
      encoding: 'utf8',
    });
    return { code: 0, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    return {
      code: error.code,
      stdout: (error.stdout ?? '').toString().trim(),
      stderr: (error.stderr ?? '').toString().trim(),
    };
  }
}

function withServer(handler, fn) {
  return new Promise((resolvePromise, reject) => {
    const seen = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body.length > 0 ? JSON.parse(body) : null,
        });
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        await fn({ url, seen });
        resolvePromise();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test('the dry-run default is not negotiable by omission', () => {
  const args = parseArgs(['--tenant', TENANT], { EXECUTION_ENGINE_TOKEN: TOKEN });
  assert.equal(args.mode, 'dry');
  const { path, body } = requestFor(args.mode, args.tenant);
  assert.equal(path, '/internal/v1/retention/run');
  assert.equal(body.dryRun, true);
});

test('--apply and --inspect cannot coexist and the tenant must be canonical', () => {
  assert.throws(
    () => parseArgs(['--tenant', TENANT, '--apply', '--inspect'], { EXECUTION_ENGINE_TOKEN: TOKEN }),
    /exclusive/,
  );
  assert.throws(
    () => parseArgs(['--tenant', 'Tenant-1', '--apply'], { EXECUTION_ENGINE_TOKEN: TOKEN }),
    /canonical lowercase UUID/,
  );
  assert.throws(() => parseArgs(['--apply'], { EXECUTION_ENGINE_TOKEN: TOKEN }), /--tenant/);
});

test('no token in the environment is a usage error, not an anonymous ask', () => {
  assert.throws(
    () => parseArgs(['--tenant', TENANT], {}),
    /will not ask an authenticated endpoint/,
  );
});

test('scrubToken removes every occurrence of a reflected credential', () => {
  const evil = `engine exploded on ${TOKEN} while inserting`;
  const clean = scrubToken(evil, TOKEN);
  assert.ok(!clean.includes(TOKEN));
  assert.ok(clean.includes('[REDACTED]'));
});

test('summarize speaks both modes and both ledger fates', () => {
  const line = summarize('dry', {
    dryRun: true,
    rowsReported: 5,
    batchesRun: 0,
    exhausted: false,
    ledgerWritten: true,
  });
  assert.match(line, /retention\[dry\] rows=5 \(prunable\)/);
  assert.match(line, /ledger=written/);
  const lost = summarize('apply', {
    dryRun: false,
    rowsReported: 9,
    batchesRun: 2,
    exhausted: true,
    ledgerWritten: false,
  });
  assert.match(lost, /ledger=LOST/);
  assert.match(lost, /more remain - schedule again/);
  const inspect = summarize('inspect', {
    prunableNow: 42,
    cutoffUs: 1,
    runs: [{ seq: 7, dryRun: true, rowsDeleted: 42 }],
  });
  assert.match(inspect, /prunable=42/);
  assert.match(inspect, /last run: seq=7 dry rows=42/);
});

test('a successful dry run exits 0 and the engine sees a matching tenant pair', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          dryRun: true,
          cutoffUs: 1750000000000000,
          rowsReported: 5,
          batchesRun: 0,
          exhausted: false,
          ledgerWritten: true,
        }),
      );
    },
    async ({ url, seen }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url], { EXECUTION_ENGINE_URL: url });
      assert.equal(result.code, 0);
      assert.match(result.stdout, /retention\[dry\] rows=5 \(prunable\)/);
      assert.equal(seen[0].headers['x-internal-token'], TOKEN);
      assert.equal(seen[0].headers['x-tenant-id'], TENANT);
      assert.deepEqual(seen[0].body, { tenantId: TENANT, dryRun: true });
    },
  );
});

test('--apply flips exactly the one field the engine gates on', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          dryRun: false,
          cutoffUs: 1,
          rowsReported: 12,
          batchesRun: 2,
          exhausted: false,
          ledgerWritten: true,
        }),
      );
    },
    async ({ url }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url, '--apply']);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /retention\[apply\] rows=12 \(deleted\)/);
    },
  );
});

test('an engine refusal exits 1 with its code and message echoed', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'RETENTION_APPLY_DISABLED', message: 'this deployment is dry-run only' }));
    },
    async ({ url }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url, '--apply']);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /409: RETENTION_APPLY_DISABLED/);
      assert.match(result.stdout, /dry-run only/);
    },
  );
});

test('the ledger-lost 500 surfaces the counts stdout is now the only copy of', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          code: 'RETENTION_LEDGER_LOST',
          message: `failed writing while ${TOKEN}`, // evil echo: must not print
          rowsReported: 3,
          batchesRun: 1,
          exhausted: false,
        }),
      );
    },
    async ({ url }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url, '--apply']);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /rows=3/);
      assert.ok(!result.stdout.includes(TOKEN));
      assert.ok(!result.stderr.includes(TOKEN));
    },
  );
});

test('an unreachable engine is exit 2 and asks nothing of nobody', async () => {
  // Port 1 refuses instantly on loopback; no server needed.
  const result = await runCli(['--tenant', TENANT, '--url', 'http://127.0.0.1:1']);
  assert.equal(result.code, 2);
  assert.match(result.stdout + result.stderr, /cannot reach the engine/);
});

test('--url and body tenant arrive at the engine together', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ prunableNow: 0, cutoffUs: 9, runs: [] }));
    },
    async ({ url, seen }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url, '--inspect']);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /prunable=0/);
      assert.equal(seen[0].url, '/internal/v1/retention/inspect');
      assert.equal(seen[0].body.tenantId, TENANT);
      assert.ok(!('dryRun' in seen[0].body)); // inspect has no such field; extra=forbid would 422 it
    },
  );
});
