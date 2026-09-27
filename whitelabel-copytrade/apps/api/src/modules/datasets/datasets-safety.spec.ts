import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEnv, EnvValidationError } from '@wlct/config';
import {
  DATASET_PERMISSIONS,
  NON_WILDCARD_PERMISSIONS,
  Permission,
  SYSTEM_ROLE_DEFINITIONS,
  SystemRole,
  hasPermission,
  permissionMatches,
} from '@wlct/shared-types';
import { AuditAction } from '@wlct/shared-types';
import { validate } from 'class-validator';

import {
  toDatasetFileView,
  toDatasetVersionView,
  toDatasetView,
  type HistoricalDatasetFileRow,
  type HistoricalDatasetRow,
  type HistoricalDatasetVersionRow,
} from './datasets.mapper';
import {
  DATASET_ARCHIVE_FROM,
  DATASET_QUARANTINE_FROM,
} from './datasets.constants';
import { RegisterDatasetVersionDto } from './dto/datasets.dto';
import { ARCHIVE_CONFIRMATION } from './datasets.constants';

/**
 * Part 7 safety tests.
 *
 * Four properties are guarded, all of them pure: the environment schema that
 * decides whether ingestion may run at all, the RBAC rules that decide who
 * may withdraw a dataset, the mapper that decides whether metadata crosses
 * the wire as exact integers rather than rounded doubles, and the credential
 * ban that keeps secrets out of manifests and logs.
 *
 * Plus one test with no analogue elsewhere in the repo: the TRANSITION
 * TABLE PARITY check reads the Python registry's allowed transitions and
 * asserts the TypeScript constants match. Two services enforcing one rule
 * from two hand-written tables is a rule that drifts; the drift is the bug,
 * and only a test like this catches it before production does.
 *
 * No credential, no database, no network, no venue.
 */

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
    DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
    REDIS_URL: 'redis://localhost:6379/0',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    ENCRYPTION_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    BLIND_INDEX_KEY_BASE64: Buffer.alloc(32, 9).toString('base64'),
    INTERNAL_SERVICE_TOKEN: 'c'.repeat(32),
    EXCHANGE_WEBHOOK_SIGNING_SECRET: 'd'.repeat(32),
    ...overrides,
  };
}

function expectFailureOn(env: Record<string, string>, path: string): EnvValidationError {
  try {
    validateEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    const failure = error as EnvValidationError;
    expect(failure.failures.map((entry) => entry.path)).toContain(path);
    return failure;
  }
  throw new Error(`Expected validation to fail on ${path}, but it succeeded.`);
}

describe('Part 7 - dataset environment safety', () => {
  it('leaves historical ingestion OFF by default and pins the safe defaults', () => {
    const env = validateEnv(baseEnv());

    expect(env.HISTORICAL_INGESTION_ENABLED).toBe(false);
    expect(env.BACKTEST_DATASET_REQUIRED).toBe(true);
    expect(env.DATASET_VALIDATION_ENABLED).toBe(true);
    expect(env.DATASET_STORAGE_BACKEND).toBe('local');
    expect(env.DATASET_LOCAL_ROOT).toBe('./data/datasets');
    expect(env.DATASET_TEMP_ROOT).toBe('./data/staging');
    expect(env.DATASET_RETENTION_POLICY).toBe('retain');
  });

  it('refuses an unknown storage backend outright, not by falling back', () => {
    expectFailureOn(baseEnv({ DATASET_STORAGE_BACKEND: 's3' }), 'DATASET_STORAGE_BACKEND');
  });

  it('refuses an unbounded partition size and an absurd buffer', () => {
    expectFailureOn(baseEnv({ DATASET_MAX_PARTITION_BYTES: '1024' }), 'DATASET_MAX_PARTITION_BYTES');
    expectFailureOn(
      baseEnv({ DATASET_MAX_PARTITION_BYTES: String(8 * 1024 * 1024 * 1024) }),
      'DATASET_MAX_PARTITION_BYTES',
    );
    expectFailureOn(baseEnv({ DATASET_READER_BUFFER_SIZE: '512' }), 'DATASET_READER_BUFFER_SIZE');
  });

  it('refuses relative dataset roots in production', () => {
    const failure = expectFailureOn(
      baseEnv({ NODE_ENV: 'production', DATASET_LOCAL_ROOT: './data/datasets' }),
      'DATASET_LOCAL_ROOT',
    );
    // Relative paths are legal for developers; production roots must be
    // absolute. Both roots are reported in one pass so the operator fixes
    // the configuration once, not one error per deploy attempt.
    expect(failure.failures.map((entry) => entry.path)).toContain('DATASET_TEMP_ROOT');
    const ok = validateEnv(
      baseEnv({
        NODE_ENV: 'production',
        DATASET_LOCAL_ROOT: '/srv/datasets',
        DATASET_TEMP_ROOT: '/srv/staging',
        // Unrelated production rules stay satisfied so this test measures
        // the dataset roots and nothing else.
        SWAGGER_PASSWORD: 'p'.repeat(24),
        // Part 9 joined the production guard set; satisfy it here so the
        // assertion below is about dataset roots only.
        METRICS_TOKEN: 'm'.repeat(32),
      }),
    );
    expect(ok.DATASET_LOCAL_ROOT).toBe('/srv/datasets');
  });

  it('refuses staging nested inside the dataset tree in any environment', () => {
    expectFailureOn(
      baseEnv({ DATASET_LOCAL_ROOT: '/srv/datasets', DATASET_TEMP_ROOT: '/srv/datasets/staging' }),
      'DATASET_TEMP_ROOT',
    );
    expectFailureOn(
      baseEnv({ DATASET_TEMP_ROOT: '/srv/staging', DATASET_LOCAL_ROOT: '/srv/staging/datasets' }),
      'DATASET_TEMP_ROOT',
    );
  });

  it('accepts disjoint roots and rejects identical ones', () => {
    expect(
      validateEnv(
        baseEnv({ DATASET_TEMP_ROOT: '/mnt/wlct/staging', DATASET_LOCAL_ROOT: '/mnt/wlct/datasets' }),
      ).DATASET_TEMP_ROOT,
    ).toBe('/mnt/wlct/staging');
    expectFailureOn(
      baseEnv({ DATASET_TEMP_ROOT: '/same/path', DATASET_LOCAL_ROOT: '/same/path' }),
      'DATASET_TEMP_ROOT',
    );
  });

  it('bounds the gap-warning cap so a report stays an artefact, not a flood', () => {
    expectFailureOn(baseEnv({ DATASET_MAX_GAP_WARNINGS: '999999' }), 'DATASET_MAX_GAP_WARNINGS');
  });
});

describe('Part 7 - dataset RBAC', () => {
  it('declares exactly the five dataset permissions', () => {
    expect([...DATASET_PERMISSIONS]).toEqual([
      Permission.DATASET_READ,
      Permission.DATASET_INGEST,
      Permission.DATASET_VALIDATE,
      Permission.DATASET_QUARANTINE,
      Permission.DATASET_ARCHIVE,
    ]);
  });

  it('excludes ingest and archive from wildcards but NOT quarantine', () => {
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.DATASET_INGEST)).toBe(true);
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.DATASET_ARCHIVE)).toBe(true);
    // Withdrawing a suspect dataset is a safety action; a wildcard must be
    // able to reach it, exactly like strategy_instance:disable.
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.DATASET_QUARANTINE)).toBe(false);
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.DATASET_READ)).toBe(false);
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.DATASET_VALIDATE)).toBe(false);

    expect(permissionMatches('dataset:*', Permission.DATASET_QUARANTINE)).toBe(true);
    expect(permissionMatches('dataset:*', Permission.DATASET_INGEST)).toBe(false);
    expect(permissionMatches('dataset:*', Permission.DATASET_ARCHIVE)).toBe(false);
    expect(permissionMatches('dataset:*', Permission.DATASET_READ)).toBe(true);
  });

  const role = (name: SystemRole): Permission[] =>
    SYSTEM_ROLE_DEFINITIONS.find((entry) => entry.key === name)?.permissions ?? [];

  it('gives the tenant administrator the full dataset surface', () => {
    const granted = role(SystemRole.TENANT_ADMIN);
    for (const permission of DATASET_PERMISSIONS) {
      expect(hasPermission(granted, permission)).toBe(true);
    }
  });

  it('gives traders, support and compliance reads, and compliance quarantine', () => {
    expect(hasPermission(role(SystemRole.TRADER), Permission.DATASET_READ)).toBe(true);
    expect(hasPermission(role(SystemRole.TRADER), Permission.DATASET_INGEST)).toBe(false);
    expect(hasPermission(role(SystemRole.SUPPORT), Permission.DATASET_READ)).toBe(true);
    expect(hasPermission(role(SystemRole.SUPPORT), Permission.DATASET_QUARANTINE)).toBe(false);
    expect(hasPermission(role(SystemRole.COMPLIANCE), Permission.DATASET_READ)).toBe(true);
    expect(hasPermission(role(SystemRole.COMPLIANCE), Permission.DATASET_QUARANTINE)).toBe(true);
    expect(hasPermission(role(SystemRole.COMPLIANCE), Permission.DATASET_ARCHIVE)).toBe(false);
  });

  it('keeps followers entirely off the dataset surface', () => {
    const granted = role(SystemRole.FOLLOWER);
    for (const permission of DATASET_PERMISSIONS) {
      expect(hasPermission(granted, permission)).toBe(false);
    }
  });
});

describe('Part 7 - dataset audit vocabulary', () => {
  it('names an audit action for every state change', () => {
    expect(AuditAction.DATASET_INGESTION_REQUESTED).toBe('DATASET_INGESTION_REQUESTED');
    expect(AuditAction.DATASET_VERSION_REGISTERED).toBe('DATASET_VERSION_REGISTERED');
    expect(AuditAction.DATASET_VALIDATION_REQUESTED).toBe('DATASET_VALIDATION_REQUESTED');
    expect(AuditAction.DATASET_VERSION_QUARANTINED).toBe('DATASET_VERSION_QUARANTINED');
    expect(AuditAction.DATASET_VERSION_ARCHIVED).toBe('DATASET_VERSION_ARCHIVED');
  });
});

describe('Part 7 - transition-table parity with the Python registry', () => {
  /**
   * The file-side registry (wlct_trading.datasets.registry) enforces its own
   * allowed-status table. This test parses that table from source and asserts
   * the API-side constants agree. A divergence would mean the API and the
   * storage disagree about whether a transition is legal, and each side
   * would confidently approve what the other refuses.
   */
  const pythonSource = readFileSync(
    join(
      __dirname,
      '..',
        '..',
        '..',
        '..',
        '..',
        'libs',
      'trading-core',
      'wlct_trading',
      'datasets',
      'registry.py',
    ),
    'utf-8',
  );

  it('quarantine accepts exactly VALID and INVALID on both sides', () => {
    // Parse the WHOLE file-side transition table: the set of statuses from
    // which a QUARANTINED transition is legal must equal the API's
    // DATASET_QUARANTINE_FROM, entry for entry. Reading one line and hoping
    // it is the whole rule is how parity tests lie.
    const entries = [...pythonSource.matchAll(/DatasetStatus\.(VALID|INVALID|QUARANTINED):\s*\{([^}]*)\}/gu)];
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const parsed = entries.map((match) => ({
      from: match[1],
      to: match[2]
        .split(',')
        .map((token) => token.trim().replace('DatasetStatus.', ''))
        .filter((token) => token.length > 0),
    }));
    const quarantineFrom = parsed
      .filter((entry) => entry.to.includes('QUARANTINED'))
      .map((entry) => entry.from)
      .sort();
    expect(quarantineFrom).toEqual(['INVALID', 'VALID']);
    expect([...DATASET_QUARANTINE_FROM].sort()).toEqual(quarantineFrom);
  });

  it('archive parity: every API-allowed archive transition exists file-side', () => {
    // Direction of the containment: the API may allow LESS than the file
    // layer, never more. If the API offered INVALID->ARCHIVED (which the
    // file table refuses - an invalid version must pass through quarantine),
    // a registration could land in a state two services disagree on.
    const entries = [...pythonSource.matchAll(/DatasetStatus\.(VALID|INVALID|QUARANTINED):\s*\{([^}]*)\}/gu)];
    const parsed = entries.map((match) => ({
      from: match[1],
      to: match[2]
        .split(',')
        .map((token) => token.trim().replace('DatasetStatus.', ''))
        .filter((token) => token.length > 0),
    }));
    const archiveFrom = new Set(
      parsed.filter((entry) => entry.to.includes('ARCHIVED')).map((entry) => entry.from),
    );
    for (const from of DATASET_ARCHIVE_FROM) {
      expect(archiveFrom.has(from)).toBe(true);
    }
    expect([...DATASET_ARCHIVE_FROM].sort()).toEqual(['QUARANTINED', 'VALID']);
  });
});

describe('Part 7 - metadata mapping precision', () => {
  const datasetRow = (): HistoricalDatasetRow => ({
    id: 'dataset-uuid',
    datasetKey: 'hst-' + 'a'.repeat(32),
    name: 'btc trades jan',
    venue: 'binance',
    marketType: 'SPOT',
    symbols: ['BTC-USDT'],
    eventKinds: ['TRADE'],
    granularity: 'event',
    startMicros: 1_700_000_000_000_000n,
    endMicros: 1_700_086_400_000_000n,
    status: 'VALID',
    latestVersion: 3,
    schemaVersion: 1,
    canonicalSchemaVersion: 1,
    createdAt: new Date('2026-09-11T00:00:00.000Z'),
    updatedAt: new Date('2026-09-11T00:00:00.000Z'),
  });

  it('stringifies microsecond timestamps rather than rounding them', () => {
    const view = toDatasetView(datasetRow());
    expect(view.startMicros).toBe('1700000000000000');
    expect(typeof view.startMicros).toBe('string');
  });

  it('maps a version without touching its manifest content', () => {
    const manifest = { datasetKey: datasetRow().datasetKey, identity: { symbols: 'BTC-USDT' } };
    const versionRow: HistoricalDatasetVersionRow = {
      id: 'v-uuid',
      datasetId: 'dataset-uuid',
      version: 3,
      status: 'VALID',
      contentChecksum: 'c'.repeat(64),
      manifestChecksum: 'm'.repeat(64),
      storageUri: 'hst-a/v3/manifest.json',
      compression: 'gzip',
      fileCount: 12,
      eventCount: 4_250_000,
      totalBytes: 1_234_567_890n,
      startMicros: 1n,
      endMicros: 2n,
      completeness: 'COMPLETE',
      sourceKind: 'BINANCE_PUBLIC_DATA',
      sourceLabel: 'data.binance.vision/spot/daily/aggTrades',
      manifestJson: manifest,
      qualityJson: null,
      validatedAt: null,
      finalizedAt: null,
      creatorJobId: 'ing-1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      dataset: { datasetKey: datasetRow().datasetKey },
    };
    const view = toDatasetVersionView(versionRow);
    expect(view.totalBytes).toBe('1234567890');
    expect(view.manifest).toEqual(manifest);
    expect(view.quality).toBeNull();
    expect(view.validatedAt).toBeNull();
  });

  it('keeps a file receipt exact where a number would drift', () => {
    const fileRow: HistoricalDatasetFileRow = {
      id: 'file-uuid',
      versionId: 'v-uuid',
      partitionPath: 'data/BTC-USDT/TRADE/2023-11-14/part0000.jsonl.gz',
      symbol: 'BTC-USDT',
      eventKind: 'TRADE',
      events: 123456,
      bytes: 4_294_967_297n,
      sha256: 'f'.repeat(64),
      firstTsMicros: 1_700_000_000_000_001n,
      lastTsMicros: 1_700_000_000_000_002n,
      compression: 'gzip',
    };
    const view = toDatasetFileView(fileRow);
    expect(view.bytes).toBe('4294967297'); // > Number.MAX_SAFE_INTEGER: only a string survives
  });
});

describe('Part 7 - credential ban at the DTO boundary', () => {
  const baseManifestDto = (): RegisterDatasetVersionDto => {
    const dto = new RegisterDatasetVersionDto();
    dto.datasetKey = 'hst-' + 'a'.repeat(32);
    dto.version = 1;
    dto.name = 'ok dataset';
    dto.venue = 'BINANCE';
    dto.marketType = 'SPOT';
    dto.symbols = ['BTC-USDT'];
    dto.eventKinds = ['TRADE'];
    dto.startMicros = 1_700_000_000_000_000;
    dto.endMicros = 1_700_000_000_001_000;
    dto.contentChecksum = 'c'.repeat(64);
    dto.storageUri = 'hst-a/v1/manifest.json';
    dto.eventCount = 2;
    dto.fileCount = 1;
    dto.totalBytes = '120';
    dto.completeness = 'COMPLETE';
    dto.sourceKind = 'BINANCE_PUBLIC_DATA';
    dto.sourceLabel = 'data.binance.vision';
    dto.manifest = { datasetKey: dto.datasetKey };
    dto.files = [
      {
        partitionPath: 'data/BTC-USDT/TRADE/2023-11-14/part0000.jsonl.gz',
        symbol: 'BTC-USDT',
        eventKind: 'TRADE',
        events: 2,
        bytes: '120',
        sha256: 'f'.repeat(64),
        firstTsMicros: 1,
        lastTsMicros: 2,
      },
    ];
    return dto;
  };

  it('accepts a clean registration', async () => {
    const errors = await validate(baseManifestDto());
    expect(errors).toEqual([]);
  });

  it('rejects a credential-shaped manifest KEY before it reaches the database', async () => {
    const dto = baseManifestDto();
    dto.manifest = { datasetKey: dto.datasetKey, api_key: 'AKIA....' } as Record<string, unknown>;
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('manifest');
  });

  it('rejects a credential-shaped manifest VALUE too', async () => {
    const dto = baseManifestDto();
    dto.manifest = {
      datasetKey: dto.datasetKey,
      note: 'rotate the passphrase monthly',
    } as Record<string, unknown>;
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('manifest');
  });

  it('requires the exact archive confirmation phrase', () => {
    // Constant-pinned rather than exercised through the service for the
    // reason the Part 6 spec gives: a typo here would silently relax a gate.
    expect(ARCHIVE_CONFIRMATION).toBe('ARCHIVE DATASET VERSION');
  });
});

describe('Part 7 - no dataset surface reaches execution', () => {
  const moduleDir = join(__dirname);

  it('imports neither execution, adapters, nor the signed transport', () => {
    for (const file of [
      'dataset-registry.service.ts',
      'dataset-ingestion.service.ts',
      'dataset-lifecycle.service.ts',
      'datasets.controller.ts',
      'datasets.mapper.ts',
      'datasets.types.ts',
      'datasets.constants.ts',
      'dto/datasets.dto.ts',
    ]) {
      const source = readFileSync(join(moduleDir, file), 'utf-8');
      expect({ file, hasExecution: /modules\/execution/.test(source) }).toEqual({
        file,
        hasExecution: false,
      });
      expect({ file, hasAdapters: /adapters\//.test(source) }).toEqual({
        file,
        hasAdapters: false,
      });
      expect({ file, hasQueueExec: /TRADE_EXECUTION/.test(source) }).toEqual({
        file,
        hasQueueExec: false,
      });
    }
  });

  it('offers no route that places an order or rewrites a payload', () => {
    const source = readFileSync(join(moduleDir, 'datasets.controller.ts'), 'utf-8');
    const posts = [...source.matchAll(/@Post\('([^']*)'\)/gu)].map((match) => match[1]);
    expect(posts).toEqual(
      expect.arrayContaining(['ingest', 'versions/register']),
    );
    for (const route of posts) {
      expect(route).not.toMatch(/order|trade-route|execute|submit-trade/u);
    }
    // No PUT/PATCH/DELETE verb anywhere in the module: state changes are
    // POST commands with typed bodies; mutating a published payload has no
    // verb at all.
    expect(source).not.toMatch(/@(Put|Patch)\(/u);
  });
});
