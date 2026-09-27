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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

  // --- Datastores -----------------------------------------------------------
  POSTGRES_PASSWORD: secret(24),
  POSTGRES_APP_PASSWORD: secret(24),
  REDIS_PASSWORD: secret(24),

  // --- Admin console --------------------------------------------------------
  SESSION_COOKIE_SECRET: keyBase64(32),
};

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
    const looksPlaceholder =
      current === '' || current.startsWith('change_me') || current.startsWith('changeme');

    if (!looksPlaceholder) {
      skipped.push(key);
      continue;
    }

    updated = updated.replace(pattern, `${key}=${value}`);
    applied.push(key);
  }

  writeFileSync(path, updated, { mode: 0o600 });

  console.log(`Updated ${writeTarget} (file mode set to 600).`);
  console.log(`  filled: ${applied.length > 0 ? applied.join(', ') : 'none'}`);

  if (skipped.length > 0) {
    console.log(`  left alone (already set or absent): ${skipped.join(', ')}`);
  }

  process.exit(0);
}

const lines = [
  '# Generated cryptographic material.',
  '# Copy into your .env. Use a different set per environment.',
  '# Treat this output as sensitive: do not paste it into a chat, a ticket or a commit.',
  '',
  ...Object.entries(generated).map(([key, value]) => `${key}=${value}`),
  '',
];

process.stdout.write(`${lines.join('\n')}`);
