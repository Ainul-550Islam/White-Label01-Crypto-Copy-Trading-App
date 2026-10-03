/**
 * scripts/generate-keys.mjs is what scripts/bootstrap.sh uses to turn a copy of
 * .env.example into a working .env. Its --write mode only fills a key that
 * already has a `KEY=` line (it never invents lines, so comments and ordering
 * survive), which means a generated key without such a line is silently never
 * written. That is exactly how EXECUTION_INTERNAL_TOKEN - required by
 * docker-compose.yml - went missing until round 7. These tests hold the two
 * files together and check the --write contract end to end.
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = join(HERE, 'generate-keys.mjs');
const EXAMPLE = readFileSync(join(ROOT, '.env.example'), 'utf8');

function generated() {
  return JSON.parse(execFileSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8' }));
}

function assignment(text, key) {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  return match ? match[1] : null;
}

test('every generated key has an active KEY= line in .env.example for --write to fill', () => {
  const keys = Object.keys(generated());
  assert.ok(keys.length >= 14, `expected at least 14 generated keys, got ${keys.length}`);
  const missing = keys.filter((key) => assignment(EXAMPLE, key) === null);
  assert.deepEqual(missing, []);
});

test('EXECUTION_INTERNAL_TOKEN is generated as 64 hex characters, fresh on every run', () => {
  const first = generated().EXECUTION_INTERNAL_TOKEN;
  const second = generated().EXECUTION_INTERNAL_TOKEN;
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
});

test('docker-compose.yml requires the token that bootstrap now generates', () => {
  const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /EXECUTION_INTERNAL_TOKEN: \$\{EXECUTION_INTERNAL_TOKEN:\?/);
  assert.ok(Object.hasOwn(generated(), 'EXECUTION_INTERNAL_TOKEN'));
});

test('--write fills empty and change_me values, keeps configured ones, and sets mode 600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-keys-'));
  try {
    const target = join(dir, '.env');
    const kept = 'an-operator-chosen-value-that-must-survive-0123456789';
    const seeded = EXAMPLE.replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${kept}`).replace(
      /^REDIS_PASSWORD=.*$/m,
      'REDIS_PASSWORD=change_me_please',
    );
    writeFileSync(target, seeded, { mode: 0o644 });
    execFileSync(process.execPath, [SCRIPT, '--write', target], { encoding: 'utf8' });
    const written = readFileSync(target, 'utf8');

    assert.equal(assignment(written, 'JWT_ACCESS_SECRET'), kept);
    assert.match(assignment(written, 'EXECUTION_INTERNAL_TOKEN') ?? '', /^[0-9a-f]{64}$/);
    const redis = assignment(written, 'REDIS_PASSWORD') ?? '';
    assert.ok(redis.length >= 24 && !redis.startsWith('change_me'), 'change_me placeholder was not replaced');
    for (const key of Object.keys(generated())) {
      if (key === 'JWT_ACCESS_SECRET') continue;
      assert.ok((assignment(written, key) ?? '') !== '', `${key} left empty after --write`);
    }
    assert.equal(statSync(target).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function urlPassword(text, key) {
  const value = assignment(text, key);
  return value === null ? null : decodeURIComponent(new URL(value).password);
}

test('--write points the placeholder connection URLs at the passwords it generated', () => {
  // Round 8: the Docker stack initialises Postgres and Redis from POSTGRES_PASSWORD and
  // REDIS_PASSWORD, so a .env whose URLs kept change_me_postgres_password (or no Redis
  // password) left every host-side tool - db:seed first - failing authentication.
  const dir = mkdtempSync(join(tmpdir(), 'wlct-keys-'));
  try {
    const target = join(dir, '.env');
    writeFileSync(target, EXAMPLE, { mode: 0o644 });
    assert.ok(
      (urlPassword(EXAMPLE, 'DATABASE_URL') ?? '').startsWith('change_me'),
      '.env.example no longer ships a placeholder DATABASE_URL password - revisit this test',
    );
    execFileSync(process.execPath, [SCRIPT, '--write', target], { encoding: 'utf8' });
    const written = readFileSync(target, 'utf8');
    const postgres = assignment(written, 'POSTGRES_PASSWORD');
    const redis = assignment(written, 'REDIS_PASSWORD');
    assert.equal(urlPassword(written, 'DATABASE_URL'), postgres);
    assert.equal(urlPassword(written, 'DIRECT_DATABASE_URL'), postgres);
    assert.equal(urlPassword(written, 'REDIS_URL'), redis);
    // Everything else about the URLs survives: user, host, database, query string.
    const before = new URL(assignment(EXAMPLE, 'DATABASE_URL'));
    const after = new URL(assignment(written, 'DATABASE_URL'));
    assert.equal(after.username, before.username);
    assert.equal(after.host, before.host);
    assert.equal(after.pathname, before.pathname);
    assert.equal(after.search, before.search);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--write leaves an operator-configured connection URL alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-keys-'));
  try {
    const target = join(dir, '.env');
    const configured = 'postgresql://copytrade:operator-set-password@db.internal:5432/copytrade?schema=public';
    const seeded = EXAMPLE.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${configured}`);
    writeFileSync(target, seeded, { mode: 0o644 });
    execFileSync(process.execPath, [SCRIPT, '--write', target], { encoding: 'utf8' });
    const written = readFileSync(target, 'utf8');
    assert.equal(assignment(written, 'DATABASE_URL'), configured);
    // The untouched placeholder sibling is still rewritten.
    assert.equal(urlPassword(written, 'DIRECT_DATABASE_URL'), assignment(written, 'POSTGRES_PASSWORD'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--write does not rewrite URLs when the password itself was already configured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-keys-'));
  try {
    const target = join(dir, '.env');
    const seeded = EXAMPLE.replace(/^POSTGRES_PASSWORD=.*$/m, 'POSTGRES_PASSWORD=operator-chosen-postgres-pw');
    writeFileSync(target, seeded, { mode: 0o644 });
    execFileSync(process.execPath, [SCRIPT, '--write', target], { encoding: 'utf8' });
    const written = readFileSync(target, 'utf8');
    assert.equal(assignment(written, 'POSTGRES_PASSWORD'), 'operator-chosen-postgres-pw');
    assert.equal(assignment(written, 'DATABASE_URL'), assignment(EXAMPLE, 'DATABASE_URL'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
