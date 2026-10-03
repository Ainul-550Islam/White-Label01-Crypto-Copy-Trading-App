#!/usr/bin/env node
/**
 * Generates the cryptographic material the platform needs and prints it as
 * environment assignments.
 *
 * Why a script: every one of these values must be high-entropy and unique per
 * environment. Hand-typed secrets are the single most common cause of a
 * "secure" system that is not. Nothing is written to disk automatically -
 * output goes to stdout so you decide where it lands (a .env file, a secrets
 * manager, a CI variable store).
 *
 * Usage:
 *   node scripts/generate-keys.mjs             # print assignments
 *   node scripts/generate-keys.mjs --json      # machine-readable
 *   node scripts/generate-keys.mjs --write .env
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

/** A url-safe, high-entropy string. */
function secret(bytes = 48) {
  return randomBytes(bytes).toString('base64url');
}

/** A raw key, base64 encoded, for AES and HMAC use. */
function keyBase64(bytes = 32) {
  return randomBytes(bytes).toString('base64');
}

/** A hex string (2 characters per byte), the format the execution engine documents. */
function hex(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

const generated = {
  // --- Authentication -------------------------------------------------------
  JWT_ACCESS_SECRET: secret(48),
  JWT_REFRESH_SECRET: secret(48),

  // --- Encryption -----------------------------------------------------------
  // 256-bit KEK that wraps every per-record data key.
  ENCRYPTION_MASTER_KEY_BASE64: keyBase64(32),
  ENCRYPTION_KEY_ID: `local-${new Date().toISOString().slice(0, 10)}-v1`,
  // Deterministic HMAC key behind blind indexes and IP hashing.
  BLIND_INDEX_KEY_BASE64: keyBase64(32),

  // --- Service-to-service ---------------------------------------------------
  INTERNAL_SERVICE_TOKEN: secret(32),
  EXCHANGE_WEBHOOK_SIGNING_SECRET: secret(32),
  // Shared secret between the worker/API and the execution engine (64 hex
  // chars; the engine refuses < 32 chars or a placeholder). docker-compose.yml
  // marks it required (`:?`), so before round 7 a bootstrap-then-compose-up
  // run stopped with "EXECUTION_INTERNAL_TOKEN is required": nothing
  // generated it and .env.example had no line for --write to fill.
  EXECUTION_INTERNAL_TOKEN: hex(32),

  // --- Datastores -----------------------------------------------------------
  POSTGRES_PASSWORD: secret(24),
  POSTGRES_APP_PASSWORD: secret(24),
  REDIS_PASSWORD: secret(24),

  // --- Admin console --------------------------------------------------------
  SESSION_COOKIE_SECRET: keyBase64(32),

  // --- Customer web app -----------------------------------------------------
  // Separate from the console's on purpose: customer and operator sessions
  // must never be signed with the same key.
  WEB_SESSION_COOKIE_SECRET: keyBase64(32),

  // --- Developer platform ---------------------------------------------------
  // HMAC key behind developer credential and webhook-secret digests. The API
  // refuses to boot without it (>= 16 chars), so it is generated with the rest.
  DEVELOPER_SECRET_HMAC_KEY: secret(48),
};

/**
 * Connection URLs that embed one of the generated passwords.
 *
 * Round 8 (Docker run): --write filled POSTGRES_PASSWORD and REDIS_PASSWORD but left
 * DATABASE_URL / DIRECT_DATABASE_URL carrying .env.example's
 * `change_me_postgres_password` and REDIS_URL carrying no password at all. The
 * compose Postgres initialises its role from POSTGRES_PASSWORD and Redis starts with
 * --requirepass REDIS_PASSWORD, so every host-side tool reading the URLs (npm run
 * db:seed, a local `npm run dev` API, prisma studio) failed authentication against
 * the stack bootstrap had just generated. Containers never noticed: compose builds
 * their URLs from the passwords directly.
 *
 * The same rule as the keys above applies: only a placeholder is replaced. A URL
 * whose password an operator has set (anything not empty / change_me) is left alone,
 * and an empty Postgres password is left alone too, because that can be a deliberate
 * trust or peer-auth setup; Redis has no username, so an empty password there just
 * means "never filled".
 */
const URL_PASSWORDS = [
  { key: 'DATABASE_URL', secretKey: 'POSTGRES_PASSWORD', replaceEmpty: false },
  { key: 'DIRECT_DATABASE_URL', secretKey: 'POSTGRES_PASSWORD', replaceEmpty: false },
  { key: 'REDIS_URL', secretKey: 'REDIS_PASSWORD', replaceEmpty: true },
];

function isPlaceholder(value) {
  return value.startsWith('change_me') || value.startsWith('changeme');
}

const args = process.argv.slice(2);
const wantsJson = args.includes('--json');
const writeIndex = args.indexOf('--write');
const writeTarget = writeIndex === -1 ? null : args[writeIndex + 1];

if (wantsJson) {
  process.stdout.write(`${JSON.stringify(generated, null, 2)}\n`);
  process.exit(0);
}

if (writeTarget) {
  const path = resolve(process.cwd(), writeTarget);

  if (!existsSync(path)) {
    console.error(
      `Refusing to create ${writeTarget}: copy .env.example to it first so you keep the comments and the full variable list.`,
    );
    process.exit(1);
  }

  const original = readFileSync(path, 'utf8');
  let updated = original;
  const applied = [];
  const skipped = [];

  for (const [key, value] of Object.entries(generated)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');

    if (!pattern.test(updated)) {
      skipped.push(key);
      continue;
    }

    const current = updated.match(pattern)?.[0]?.slice(key.length + 1) ?? '';

    // Never silently overwrite a value that already looks configured: that is
    // how a working environment gets destroyed by a careless command.
    const looksPlaceholder = current === '' || isPlaceholder(current);

    if (!looksPlaceholder) {
      skipped.push(key);
      continue;
    }

    updated = updated.replace(pattern, `${key}=${value}`);
    applied.push(key);
  }

  const urlsUpdated = [];
  for (const { key, secretKey, replaceEmpty } of URL_PASSWORDS) {
    // Only follow a password this run actually wrote; a password that was
    // already configured is the operator's, and so is the URL built from it.
    if (!applied.includes(secretKey)) continue;
    const pattern = new RegExp(`^${key}=(.*)$`, 'm');
    const match = pattern.exec(updated);
    if (match === null) continue;
    let url;
    try {
      url = new URL(match[1].trim());
    } catch {
      continue;
    }
    const currentPassword = decodeURIComponent(url.password);
    const replace = isPlaceholder(currentPassword) || (replaceEmpty && currentPassword === '');
    if (!replace) continue;
    // The URL setter percent-encodes; the generated secrets are base64url, so
    // this is belt and braces rather than a transformation.
    url.password = generated[secretKey];
    updated = updated.replace(pattern, () => `${key}=${url.toString()}`);
    urlsUpdated.push(key);
  }

  writeFileSync(path, updated, { mode: 0o600 });
  // writeFileSync's `mode` only applies when it creates the file, and --write
  // always targets an existing one, so without this an existing 0644 .env full
  // of fresh secrets stayed world-readable while the message below claimed 600.
  chmodSync(path, 0o600);

  console.log(`Updated ${writeTarget} (file mode set to 600).`);
  console.log(`  filled: ${applied.length > 0 ? applied.join(', ') : 'none'}`);
  if (urlsUpdated.length > 0) {
    console.log(`  connection URLs now carry the generated password: ${urlsUpdated.join(', ')}`);
  }

  if (skipped.length > 0) {
    console.log(`  left alone (already set or absent): ${skipped.join(', ')}`);
  }

  process.exit(0);
}

const lines = [
  '# Generated cryptographic material.',
  '# Copy into your .env. Use a different set per environment.',
  '# Treat this output as sensitive: do not paste it into a chat, a ticket or a commit.',
  '# DATABASE_URL and DIRECT_DATABASE_URL embed POSTGRES_PASSWORD, and REDIS_URL embeds',
  '# REDIS_PASSWORD: update them to match (--write does this for placeholder URLs).',
  '',
  ...Object.entries(generated).map(([key, value]) => `${key}=${value}`),
  '',
];

process.stdout.write(`${lines.join('\n')}`);
