/**
 * apps/api/prisma/seed.ts creates the platform super administrator from
 * SEED_SUPER_ADMIN_PASSWORD. Until round 8 it only rejected the .env.example
 * placeholder, so any other non-empty value became the password - the Docker
 * run found it accepting six characters. That value came from the trap
 * .env.example warns about: an unquoted '#' makes dotenv-cli truncate the
 * value, the seed hashed the truncated password without complaint, and the
 * first login was a 401.
 *
 * The seed now applies the API's own password policy (evaluatePassword from
 * @wlct/validation, minimum length from PASSWORD_MIN_LENGTH) and does it before
 * the first database write. These tests run the real seed through ts-node
 * against a database URL nothing listens on:
 *   - a rejected password must fail with the policy message and must never
 *     reach the database (no connection error in the output);
 *   - an accepted password must get past the policy and fail only on the
 *     unreachable database, which proves the check runs first rather than
 *     being skipped.
 *
 * Prerequisites (the CI node job provides them before `node --test scripts/`):
 * npm ci, `prisma generate`, and `npm run build:packages`.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const API_DIR = join(ROOT, 'apps', 'api');
const TS_NODE = join(ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');

const POLICY_MESSAGE = 'does not meet the password policy the API enforces';
const PLACEHOLDER_MESSAGE = 'still holds the placeholder value from .env.example';
const QUOTING_HINT = 'wrap it in double quotes';

/** Port 1 on loopback: nothing listens there, so any connection attempt fails fast. */
const UNREACHABLE_DATABASE_URL = 'postgresql://seed_test:seed_test@127.0.0.1:1/seed_test?connect_timeout=2';

function runSeed(overrides) {
  assert.ok(
    existsSync(TS_NODE),
    `ts-node not found at ${TS_NODE}; run npm ci in whitelabel-copytrade/ first`,
  );

  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
    DATABASE_URL: UNREACHABLE_DATABASE_URL,
    DIRECT_DATABASE_URL: UNREACHABLE_DATABASE_URL,
    BLIND_INDEX_KEY_BASE64: randomBytes(32).toString('base64'),
    SEED_SUPER_ADMIN_EMAIL: 'operator@example.com',
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete env[key];
    }
  }

  const result = spawnSync(process.execPath, [TS_NODE, '--transpile-only', 'prisma/seed.ts'], {
    cwd: API_DIR,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  };
}

function assertRejectedBeforeDatabase(result, expectedMessage) {
  assert.equal(result.status, 1, `seed should exit 1, got ${result.status}\n${result.output}`);
  assert.ok(result.output.includes('Seed failed:'), result.output);
  assert.ok(result.output.includes(expectedMessage), result.output);
  // The permission catalogue is the first write; it must not have started.
  assert.ok(!result.output.includes('permissions ..'), result.output);
  assert.ok(!/Can't reach database|P1001|ECONNREFUSED/.test(result.output), result.output);
}

test('a password truncated by an unquoted # is rejected before any database access', () => {
  // `SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026` reaches the seed as "My_P4ss".
  const result = runSeed({ SEED_SUPER_ADMIN_PASSWORD: 'My_P4ss' });
  assertRejectedBeforeDatabase(result, POLICY_MESSAGE);
  assert.ok(result.output.includes('at least 12 characters'), result.output);
  assert.ok(result.output.includes(QUOTING_HINT), result.output);
});

test('a long password without the required character classes is rejected', () => {
  const result = runSeed({ SEED_SUPER_ADMIN_PASSWORD: 'onlylowercaseletters' });
  assertRejectedBeforeDatabase(result, POLICY_MESSAGE);
  assert.ok(result.output.includes('uppercase'), result.output);
  assert.ok(result.output.includes('digit'), result.output);
  assert.ok(result.output.includes('symbol'), result.output);
});

test('a password containing the administrator email is rejected, as the API rejects it', () => {
  const result = runSeed({
    SEED_SUPER_ADMIN_EMAIL: 'founder@example.com',
    SEED_SUPER_ADMIN_PASSWORD: 'Founder@Example.com-2026',
  });
  assertRejectedBeforeDatabase(result, POLICY_MESSAGE);
});

test('PASSWORD_MIN_LENGTH raises the minimum the seed enforces', () => {
  const result = runSeed({
    PASSWORD_MIN_LENGTH: '24',
    SEED_SUPER_ADMIN_PASSWORD: 'Kq7#vRm2-Tx9!wLp',
  });
  assertRejectedBeforeDatabase(result, POLICY_MESSAGE);
  assert.ok(result.output.includes('at least 24 characters'), result.output);
});

test('the .env.example placeholder is still rejected', () => {
  const result = runSeed({ SEED_SUPER_ADMIN_PASSWORD: 'ChangeMe_Str0ng!Pass' });
  assertRejectedBeforeDatabase(result, PLACEHOLDER_MESSAGE);
});

test('a password that satisfies the policy gets past the check and only then needs the database', () => {
  const result = runSeed({ SEED_SUPER_ADMIN_PASSWORD: 'Kq7#vRm2-Tx9!wLp' });
  assert.equal(result.status, 1, `seed should exit 1 on the unreachable database\n${result.output}`);
  assert.ok(result.output.includes('Seed failed:'), result.output);
  assert.ok(!result.output.includes(POLICY_MESSAGE), result.output);
  assert.ok(!result.output.includes(PLACEHOLDER_MESSAGE), result.output);
  assert.ok(/Can't reach database|P1001|ECONNREFUSED|connect/i.test(result.output), result.output);
});

test('an unset password skips the policy check (the seed generates one)', () => {
  const result = runSeed({ SEED_SUPER_ADMIN_PASSWORD: undefined });
  assert.equal(result.status, 1, `seed should exit 1 on the unreachable database\n${result.output}`);
  assert.ok(!result.output.includes(POLICY_MESSAGE), result.output);
  assert.ok(/Can't reach database|P1001|ECONNREFUSED|connect/i.test(result.output), result.output);
});
