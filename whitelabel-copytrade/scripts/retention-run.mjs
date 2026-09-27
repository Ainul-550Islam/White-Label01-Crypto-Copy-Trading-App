#!/usr/bin/env node
/**
 * Retention runner for the durable execution store (Part 14).
 *
 * One command, one tenant, and a default that cannot delete:
 *
 *   EXECUTION_ENGINE_URL=http://execution-engine:8093 \
 *   EXECUTION_ENGINE_TOKEN=... \
 *     node scripts/retention-run.mjs --tenant <uuid>          # DRY RUN
 *     node scripts/retention-run.mjs --tenant <uuid> --apply  # prune
 *     node scripts/retention-run.mjs --tenant <uuid> --inspect
 *
 * Exit codes, cron-able exactly like `dr-manifest.mjs --due`:
 *   0  the run completed (dry, apply, or inspect) - summary on stdout
 *   1  the engine refused (disabled apply, no durable store) or failed
 *      (store error, ledger-lost) - the engine's code and message are echoed
 *   2  local misuse or no reachable engine (bad args, bad tenant id,
 *      connection error, timeout) - the engine was never asked
 *
 * What this script deliberately is NOT: a scheduler (deployment wires the
 * cadence, same stance as the DR ledger's --due), a fleet sweep (one
 * --tenant per call, because the store's own law refuses tenant-less
 * pruning and a script that looped tenants would just be that refusal
 * with more blast radius), or a new authority (every capability here is
 * the engine's endpoint's; flip nothing by wanting it - EXECUTION_RE-
 * TENTION_ENABLED lives in the engine's environment for a reason).
 *
 * The token is read from the environment, sent in a header, and scrubbed
 * from every line this script prints - including engine error bodies,
 * which are echoed for the operator's convenience and could echo anything.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class RetentionCliError extends Error {}

/** Remove the token from any text about to be printed. The engine never
 * echoes it back today; "today" is not a security property, so the scrub
 * stays even when the caller is well-behaved. */
export function scrubToken(text, token) {
  if (!token || token.length === 0) return String(text);
  return String(text).split(token).join('[REDACTED]');
}

export function parseArgs(argv, env = process.env) {
  const out = {
    tenant: null,
    mode: 'dry', // 'dry' | 'apply' | 'inspect'
    url: env.EXECUTION_ENGINE_URL ?? 'http://127.0.0.1:8093',
    token: env.EXECUTION_ENGINE_TOKEN ?? null,
    timeoutMs: 15_000,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      out.tenant = argv[(i += 1)];
    } else if (arg === '--apply') {
      if (out.mode !== 'dry') throw new RetentionCliError('modes are exclusive: --apply after --inspect');
      out.mode = 'apply';
    } else if (arg === '--inspect') {
      if (out.mode !== 'dry') throw new RetentionCliError('modes are exclusive: --inspect twice');
      out.mode = 'inspect';
    } else if (arg === '--url') {
      out.url = argv[(i += 1)];
    } else if (arg === '--timeout-ms') {
      const raw = argv[(i += 1)];
      const ms = Number(raw);
      if (!Number.isInteger(ms) || ms < 250 || ms > 600_000) {
        throw new RetentionCliError('--timeout-ms must be an integer in 250..600000');
      }
      out.timeoutMs = ms;
    } else if (arg === '--json') {
      out.json = true;
    } else {
      throw new RetentionCliError(`unknown argument: ${arg}`);
    }
  }
  if (!out.tenant) throw new RetentionCliError('--tenant <uuid> is required (one tenant per run, always)');
  if (!CANONICAL_UUID.test(out.tenant)) {
    throw new RetentionCliError(
      `--tenant must be a canonical lowercase UUID, got ${JSON.stringify(out.tenant)}`,
    );
  }
  if (!out.token) {
    throw new RetentionCliError(
      'EXECUTION_ENGINE_TOKEN is not set: this script will not ask an authenticated ' +
        'endpoint for a deletion while holding no credential',
    );
  }
  if (!/^https?:\/\//.test(out.url)) {
    throw new RetentionCliError('--url must be an http(s) URL');
  }
  return out;
}

/** The one request shape the engine accepts for these routes; tenantId in
 * the body AND x-tenant-id header (the engine 403s a mismatch - both are
 * sent from the same value here, so a refusal on match means an engine
 * with different wiring than this call assumed, which is worth seeing). */
export function requestFor(mode, tenant) {
  const path = mode === 'inspect' ? '/internal/v1/retention/inspect' : '/internal/v1/retention/run';
  const body = mode === 'inspect' ? { tenantId: tenant } : { tenantId: tenant, dryRun: mode !== 'apply' };
  return { path, body };
}

export function summarize(mode, payload) {
  if (mode === 'inspect') {
    const last = (payload.runs ?? [])[0];
    const lastText = last
      ? `last run: seq=${last.seq} ${last.dryRun ? 'dry ' : ''}rows=${last.rowsDeleted}`
      : 'no recorded runs yet';
    return `retention[inspect] prunable=${payload.prunableNow} cutoff=${payload.cutoffUs} (${lastText})`;
  }
  const verb = payload.dryRun ? 'prunable' : 'deleted';
  return (
    `retention[${payload.dryRun ? 'dry' : 'apply'}] rows=${payload.rowsReported} (${verb}) ` +
    `batches=${payload.batchesRun} exhausted=${payload.exhausted ? 'yes (more remain - schedule again)' : 'no'} ` +
    `ledger=${payload.ledgerWritten ? 'written' : 'LOST - reconcile against the log before scheduling more'}`
  );
}

async function callEngine({ url, token, tenant, mode, timeoutMs }, fetchImpl = globalThis.fetch) {
  const { path, body } = requestFor(mode, tenant);
  let response;
  try {
    response = await fetchImpl(url.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': token,
        'x-tenant-id': tenant,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new RetentionCliError(
      `cannot reach the engine at ${url}: ${scrubToken(error?.message ?? error, token)} - ` +
        'the engine was never asked to delete anything',
    );
  }
  let payload = null;
  const text = await response.text();
  try {
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    payload = { code: `HTTP_${response.status}`, message: text.slice(0, 400) };
  }
  return { status: response.status, payload };
}

export async function main(argv, { env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  let args;
  try {
    args = parseArgs(argv, env);
  } catch (error) {
    log(`usage error: ${error.message}`);
    return 2;
  }
  let status;
  let payload;
  try {
    ({ status, payload } = await callEngine(args, fetchImpl));
  } catch (error) {
    // callEngine wraps only UNREACHED-engine states (connect/timeout); by
    // definition nothing was asked, so 2 is the whole story.
    log(scrubToken(error.message, args.token));
    return 2;
  }
  if (status >= 200 && status < 300) {
    if (args.json) log(JSON.stringify(payload));
    else log(summarize(args.mode, payload));
    return 0;
  }
  // Engine answered - refusal or failure. Echo code+message (scrubbed),
  // exit 1 so the scheduler's alert path sees it.
  const code = payload?.code ?? `HTTP_${status}`;
  const message = scrubToken(payload?.message ?? '(no message)', args.token);
  log(`engine answered ${status}: ${code}: ${message}`);
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'rowsReported')) {
    // The ledger-lost 500 carries the counts the record is missing; the
    // operator reading stdout needs them more than the prettifying.
    log(
      `  counts from the refused-to-record run: rows=${payload.rowsReported} ` +
        `batches=${payload.batchesRun} exhausted=${payload.exhausted}`,
    );
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
