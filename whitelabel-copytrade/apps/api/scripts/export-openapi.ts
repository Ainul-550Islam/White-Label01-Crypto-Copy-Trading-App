// # NEW — Exports deterministic OpenAPI and Postman contracts without initializing Prisma or Redis

import 'reflect-metadata';

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';

const repositoryRoot = resolve(__dirname, '../../..');
const openApiPath = resolve(repositoryRoot, 'docs/openapi/openapi.json');
const postmanGeneratorPath = resolve(repositoryRoot, 'scripts/gen-postman-collection.mjs');
const checkOnly = process.argv.includes('--check');

function configureIsolatedExportEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://openapi:openapi@127.0.0.1:59999/openapi_export?schema=public';
  process.env.DIRECT_DATABASE_URL = process.env.DATABASE_URL;
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = '59998';
  process.env.REDIS_DB = '0';
  process.env.REDIS_TLS = 'false';
  process.env.WS_ENABLED = 'false';
  process.env.WS_REDIS_ADAPTER = 'false';
  process.env.QUEUE_RUN_INLINE_WORKERS = 'false';
  process.env.BULL_BOARD_ENABLED = 'false';
  process.env.DATABASE_SSL = 'false';
  process.env.DATABASE_LOG_QUERIES = 'false';
  process.env.LOG_LEVEL = 'silent';
  process.env.LOG_FORMAT = 'json';
  process.env.ENCRYPTION_MASTER_KEY_BASE64 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
  process.env.BLIND_INDEX_KEY_BASE64 = Buffer.from('abcdef0123456789abcdef0123456789').toString('base64');
  process.env.ENCRYPTION_KEY_ID = 'openapi-export-only';
  process.env.INTERNAL_SERVICE_TOKEN = 'openapi-export-only-internal-service-token-32';
  process.env.EXCHANGE_WEBHOOK_SIGNING_SECRET = 'openapi-export-only-webhook-signing-secret-32';
  process.env.JWT_ACCESS_SECRET = 'openapi-export-only-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET = 'openapi-export-only-refresh-secret-9876543210';
}

function sortForSerialization(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForSerialization);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortForSerialization(record[key]);
  }
  return sorted;
}

function writeOrCheck(path: string, generated: string, label: string): void {
  if (checkOnly) {
    let current: string;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      throw new Error(`${label} is missing; run npm run openapi:export --workspace @wlct/api`);
    }
    if (current !== generated) {
      throw new Error(`${label} is stale; run npm run openapi:export --workspace @wlct/api and commit the result`);
    }
    return;
  }
  writeFileSync(path, generated, 'utf8');
}

async function main(): Promise<void> {
  configureIsolatedExportEnvironment();

  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    const config = app.get(AppConfigService);

    app.setGlobalPrefix(config.globalPrefix, {
      exclude: [
        'health',
        'health/ready',
        'health/deep',
        'health/startup',
        'health/trading',
        'healthz',
        'readyz',
        'metrics',
      ],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: config.defaultApiVersion,
      prefix: 'v',
    });

    // Do not call app.init(), app.listen(), or setupSwagger(). NestFactory.create
    // scans and instantiates the route graph, while lifecycle hooks that connect
    // Prisma, Redis, queues, or realtime adapters are not started by this export.
    const document = createSwaggerDocument(app, config);
    const generated = `${JSON.stringify(sortForSerialization(document), null, 2)}\n`;
    writeOrCheck(openApiPath, generated, 'docs/openapi/openapi.json');
  } finally {
    if (app) await app.close();
  }

  const postmanArgs = [postmanGeneratorPath];
  if (checkOnly) postmanArgs.push('--check');
  const postman = spawnSync(process.execPath, postmanArgs, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (postman.error) throw postman.error;
  if (postman.status !== 0) throw new Error(`Postman generation failed with exit code ${postman.status ?? 1}`);
  process.stdout.write(`${checkOnly ? 'OpenAPI and Postman artifacts are current' : 'Exported OpenAPI and Postman artifacts'} without database or cache connections.\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
