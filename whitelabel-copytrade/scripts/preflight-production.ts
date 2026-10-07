// # NEW — TypeScript preflight validator for API/Web/Worker/Database/Redis/Vault readiness
import { validateEnv, type ValidatedEnv } from '../packages/config/src/env.schema';

export interface PreflightCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ProductionPreflightReport {
  ready: boolean;
  environment: string;
  checks: PreflightCheckResult[];
}

const PLACEHOLDER_TOKENS = new Set([
  'changeme',
  'change-me',
  'replace_me',
  'replace-me',
  'secret',
  'todo',
  'example',
]);

export function runProductionPreflight(
  rawEnv: Record<string, string | undefined> = process.env,
): ProductionPreflightReport {
  const checks: PreflightCheckResult[] = [];
  let parsed: ValidatedEnv | null = null;

  try {
    parsed = validateEnv(rawEnv);
    checks.push({
      name: 'config.schema_validation',
      passed: true,
      detail: `Validated environment schema for NODE_ENV=${parsed.NODE_ENV}`,
    });
  } catch (err) {
    checks.push({
      name: 'config.schema_validation',
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Database URL check
  const dbUrl = rawEnv.DATABASE_URL ?? '';
  const dbOk = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');
  checks.push({
    name: 'database.connection_string',
    passed: dbOk,
    detail: dbOk
      ? 'DATABASE_URL uses PostgreSQL protocol'
      : 'DATABASE_URL is missing or not a valid PostgreSQL URL',
  });

  // Redis URL check
  const redisHost = rawEnv.REDIS_HOST ?? '';
  const redisUrl = rawEnv.REDIS_URL ?? '';
  const redisOk = Boolean(redisHost.trim() || redisUrl.startsWith('redis'));
  checks.push({
    name: 'redis.configuration',
    passed: redisOk,
    detail: redisOk
      ? 'Redis endpoint configured'
      : 'REDIS_HOST or REDIS_URL must be configured',
  });

  // Secret hygiene check
  const secretKeys = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_MASTER_KEY',
    'COOKIE_SECRET',
    'CSRF_SECRET',
  ];
  const badSecrets = secretKeys.filter((k) => {
    const val = (rawEnv[k] ?? '').trim().toLowerCase();
    return !val || PLACEHOLDER_TOKENS.has(val) || val.startsWith('changeme');
  });
  checks.push({
    name: 'security.secret_hygiene',
    passed: badSecrets.length === 0,
    detail:
      badSecrets.length === 0
        ? 'All cryptographic secrets present and non-placeholder'
        : `Missing or placeholder secrets: ${badSecrets.join(', ')}`,
  });

  // Live trading safety gate check
  const tradingMode = rawEnv.TRADING_MODE ?? 'PAPER';
  const liveEnabled = rawEnv.LIVE_TRADING_ENABLED === 'true';
  const dryRun = rawEnv.DRY_RUN !== 'false';
  const safetyConsistent =
    tradingMode !== 'LIVE' || (liveEnabled && !dryRun && rawEnv.PAPER_TRADING === 'false');
  checks.push({
    name: 'execution.safety_gate_consistency',
    passed: safetyConsistent,
    detail: safetyConsistent
      ? `Trading safety gate consistent (TRADING_MODE=${tradingMode})`
      : 'Inconsistent LIVE trading flags',
  });

  const ready = checks.every((c) => c.passed);
  return {
    ready,
    environment: rawEnv.NODE_ENV ?? 'development',
    checks,
  };
}

if (require.main === module) {
  const report = runProductionPreflight(process.env);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ready ? 0 : 1);
}
