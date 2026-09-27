import { validateEnv, EnvValidationError } from '@wlct/config';
import {
  NON_WILDCARD_PERMISSIONS,
  Permission,
  SYSTEM_ROLE_DEFINITIONS,
  SystemRole,
  describePermissions,
  hasPermission,
  permissionMatches,
} from '@wlct/shared-types';

/**
 * Part 5 safety tests.
 *
 * These cover the two places where a configuration mistake or an over-broad
 * role grant turns into real money moving: the environment schema that decides
 * whether orders are transmitted at all, and the RBAC wildcard rule that
 * decides who can arm live trading.
 *
 * Not one of them needs a credential, a database or a network. They are pure
 * functions of their inputs, which is the only kind of test worth having
 * guarding a money path - a test that needs a live venue is a test that gets
 * skipped in CI and then deleted.
 */

/**
 * The smallest environment that validates, with every dangerous switch at its
 * safe default. Individual tests override single keys so a failure names one
 * variable rather than a whole config.
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

describe('Part 5 - execution environment safety', () => {
  it('defaults to the safe mode when nothing is configured', () => {
    const env = validateEnv(baseEnv());

    // The single most important assertion in this file. An operator who sets
    // nothing gets a platform that cannot move money.
    expect(env.LIVE_TRADING_ENABLED).toBe(false);
    expect(env.DRY_RUN).toBe(true);
    expect(env.PAPER_TRADING).toBe(true);
    expect(env.EXECUTION_ENABLED).toBe(false);
    expect(env.EXCHANGE_SANDBOX_MODE).toBe(true);
  });

  it('treats an absent live-trading flag as false rather than unset', () => {
    const env = validateEnv(baseEnv());
    expect(env.LIVE_TRADING_ENABLED).not.toBeUndefined();
    expect(env.LIVE_TRADING_ENABLED).toBe(false);
  });

  it('only accepts explicit truthy spellings for the live-trading flag', () => {
    for (const spelling of ['true', 'TRUE', '1', 'yes', 'on']) {
      const env = validateEnv(
        baseEnv({
          LIVE_TRADING_ENABLED: spelling,
          DRY_RUN: 'false',
          PAPER_TRADING: 'false',
          EXECUTION_ENABLED: 'true',
          EXCHANGE_SANDBOX_MODE: 'false',
        }),
      );
      expect(env.LIVE_TRADING_ENABLED).toBe(true);
    }

    for (const spelling of ['false', 'no', '0', '', 'maybe', 'enabled', 'y']) {
      const env = validateEnv(baseEnv({ LIVE_TRADING_ENABLED: spelling }));
      expect(env.LIVE_TRADING_ENABLED).toBe(false);
    }

    // Surrounding whitespace is trimmed before the comparison. A value pasted
    // from a spreadsheet with a trailing space should mean what it says, not
    // silently fall back to the safe default and leave an operator wondering
    // why live trading never armed.
    const padded = validateEnv(
      baseEnv({
        LIVE_TRADING_ENABLED: ' TRUE ',
        DRY_RUN: 'false',
        PAPER_TRADING: 'false',
        EXECUTION_ENABLED: 'true',
        EXCHANGE_SANDBOX_MODE: 'false',
      }),
    );
    expect(padded.LIVE_TRADING_ENABLED).toBe(true);
  });

  it('refuses to boot when live trading is combined with dry run', () => {
    // The dangerous combination: one switch says "send real orders", the other
    // says "send nothing". Resolving it silently in either direction is how a
    // deployment ends up doing the opposite of what its operator believed.
    const failure = expectFailureOn(
      baseEnv({
        LIVE_TRADING_ENABLED: 'true',
        DRY_RUN: 'true',
        PAPER_TRADING: 'false',
        EXECUTION_ENABLED: 'true',
        EXCHANGE_SANDBOX_MODE: 'false',
      }),
      'DRY_RUN',
    );
    expect(failure.message).toContain('conflicts');
  });

  it('refuses to boot when live trading is combined with paper trading', () => {
    expectFailureOn(
      baseEnv({
        LIVE_TRADING_ENABLED: 'true',
        DRY_RUN: 'false',
        PAPER_TRADING: 'true',
        EXECUTION_ENABLED: 'true',
        EXCHANGE_SANDBOX_MODE: 'false',
      }),
      'PAPER_TRADING',
    );
  });

  it('refuses live trading without the execution pipeline', () => {
    expectFailureOn(
      baseEnv({
        LIVE_TRADING_ENABLED: 'true',
        DRY_RUN: 'false',
        PAPER_TRADING: 'false',
        EXECUTION_ENABLED: 'false',
        EXCHANGE_SANDBOX_MODE: 'false',
      }),
      'EXECUTION_ENABLED',
    );
  });

  it('refuses live trading while the adapters point at a sandbox', () => {
    expectFailureOn(
      baseEnv({
        LIVE_TRADING_ENABLED: 'true',
        DRY_RUN: 'false',
        PAPER_TRADING: 'false',
        EXECUTION_ENABLED: 'true',
        EXCHANGE_SANDBOX_MODE: 'true',
      }),
      'EXCHANGE_SANDBOX_MODE',
    );
  });

  it('accepts a fully coherent live configuration', () => {
    const env = validateEnv(
      baseEnv({
        LIVE_TRADING_ENABLED: 'true',
        DRY_RUN: 'false',
        PAPER_TRADING: 'false',
        EXECUTION_ENABLED: 'true',
        EXCHANGE_SANDBOX_MODE: 'false',
      }),
    );
    expect(env.LIVE_TRADING_ENABLED).toBe(true);
    expect(env.DRY_RUN).toBe(false);
  });

  it('requires venue credentials to be supplied as a pair', () => {
    expectFailureOn(baseEnv({ BINANCE_API_KEY: 'public-key-material' }), 'BINANCE_API_SECRET');
    expectFailureOn(baseEnv({ BINANCE_API_SECRET: 'secret-material' }), 'BINANCE_API_KEY');

    const env = validateEnv(
      baseEnv({ BINANCE_API_KEY: 'public-key-material', BINANCE_API_SECRET: 'secret-material' }),
    );
    expect(env.BINANCE_API_KEY).toBe('public-key-material');
  });

  it('rejects an idempotency TTL that expires before reconciliation runs', () => {
    // A key that expires first stops recognising a retry as a duplicate, and
    // the duplicate becomes a second real position.
    expectFailureOn(
      baseEnv({
        EXECUTION_IDEMPOTENCY_TTL_SECONDS: '10',
        ORDER_RECONCILIATION_INTERVAL_MS: '30000',
      }),
      'EXECUTION_IDEMPOTENCY_TTL_SECONDS',
    );
  });

  it('rejects an unknown-order delay longer than the reconciliation interval', () => {
    expectFailureOn(
      baseEnv({
        ORDER_UNKNOWN_RECONCILIATION_DELAY_MS: '60000',
        ORDER_RECONCILIATION_INTERVAL_MS: '30000',
      }),
      'ORDER_UNKNOWN_RECONCILIATION_DELAY_MS',
    );
  });

  it('rejects an order timeout short enough to manufacture unknown results', () => {
    expectFailureOn(
      baseEnv({
        LIVE_TRADING_ENABLED: 'true',
        DRY_RUN: 'false',
        PAPER_TRADING: 'false',
        EXECUTION_ENABLED: 'true',
        EXCHANGE_SANDBOX_MODE: 'false',
        ORDER_REQUEST_TIMEOUT_MS: '250',
      }),
      'ORDER_REQUEST_TIMEOUT_MS',
    );
  });

  it('reports every configuration problem in one pass', () => {
    // An operator fixing one variable per restart is an operator who eventually
    // disables things at random to make the error go away.
    let captured: EnvValidationError | null = null;
    try {
      validateEnv(
        baseEnv({
          LIVE_TRADING_ENABLED: 'true',
          DRY_RUN: 'true',
          PAPER_TRADING: 'true',
          EXECUTION_ENABLED: 'false',
        }),
      );
    } catch (error) {
      captured = error as EnvValidationError;
    }

    expect(captured).not.toBeNull();
    const paths = (captured as EnvValidationError).failures.map((entry) => entry.path);
    expect(paths).toEqual(expect.arrayContaining(['DRY_RUN', 'PAPER_TRADING', 'EXECUTION_ENABLED']));
  });
});

describe('Part 5 - RBAC for the execution surface', () => {
  it('registers every execution permission in the catalogue', () => {
    const catalogue = describePermissions().map((entry) => entry.key);

    for (const permission of [
      Permission.EXECUTION_READ,
      Permission.EXECUTION_SUBMIT,
      Permission.EXECUTION_CANCEL,
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.BALANCE_REFRESH,
      Permission.EXCHANGE_ACCOUNT_VERIFY,
      Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
      Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
      Permission.PRIVATE_STREAM_READ,
      Permission.PRIVATE_STREAM_MANAGE,
      Permission.RECONCILIATION_READ,
      Permission.RECONCILIATION_TRIGGER,
      Permission.RECONCILIATION_RESOLVE,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.EXECUTION_INCIDENT_RESOLVE,
      Permission.KILL_SWITCH_READ,
      Permission.KILL_SWITCH_OPERATE,
    ]) {
      expect(catalogue).toContain(permission);
    }
  });

  it('grants ordinary permissions through a resource wildcard', () => {
    expect(permissionMatches('order:*', Permission.ORDER_READ)).toBe(true);
    expect(permissionMatches('reconciliation:*', Permission.RECONCILIATION_READ)).toBe(true);
    expect(permissionMatches('reconciliation:*', Permission.RECONCILIATION_TRIGGER)).toBe(true);
  });

  it('never grants a dangerous permission through a resource wildcard', () => {
    // The scenario this prevents: an admin grants `exchange_account:*` meaning
    // "let support fix API keys" and hands out the ability to arm live trading.
    expect(permissionMatches('exchange_account:*', Permission.EXCHANGE_ACCOUNT_READ)).toBe(true);
    expect(permissionMatches('exchange_account:*', Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE)).toBe(
      false,
    );
    expect(
      permissionMatches('exchange_account:*', Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS),
    ).toBe(false);
    expect(permissionMatches('kill_switch:*', Permission.KILL_SWITCH_READ)).toBe(true);
    expect(permissionMatches('kill_switch:*', Permission.KILL_SWITCH_OPERATE)).toBe(false);
    expect(permissionMatches('reconciliation:*', Permission.RECONCILIATION_RESOLVE)).toBe(false);
    expect(permissionMatches('execution:*', Permission.EXECUTION_SUBMIT)).toBe(false);
  });

  it('still grants a dangerous permission when listed explicitly', () => {
    expect(
      hasPermission(
        [Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE],
        Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
      ),
    ).toBe(true);
  });

  it('lets the platform super admin wildcard reach everything', () => {
    // The break-glass identity. Restricting it produces a platform nobody can
    // operate during the incident where it matters.
    for (const permission of NON_WILDCARD_PERMISSIONS) {
      expect(permissionMatches(Permission.ALL, permission)).toBe(true);
    }
  });

  it('marks dangerous permissions as requiring an explicit grant in the catalogue', () => {
    const catalogue = describePermissions();
    const enableLive = catalogue.find(
      (entry) => entry.key === Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
    );
    const orderRead = catalogue.find((entry) => entry.key === Permission.ORDER_READ);

    expect(enableLive?.requiresExplicitGrant).toBe(true);
    expect(orderRead?.requiresExplicitGrant).toBe(false);
  });

  it('keeps live-trading and kill-switch control away from read-only roles', () => {
    const dangerous = [
      Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
      Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
      Permission.EXECUTION_SUBMIT,
    ];

    for (const roleKey of [SystemRole.SUPPORT, SystemRole.FINANCE, SystemRole.COMPLIANCE]) {
      const role = SYSTEM_ROLE_DEFINITIONS.find((entry) => entry.key === roleKey);
      expect(role).toBeDefined();
      for (const permission of dangerous) {
        expect(role?.permissions).not.toContain(permission);
      }
    }
  });

  it('does not let a follower submit orders but does let them cancel', () => {
    // A follower's orders come from a copy subscription, not a button. Cancel
    // is present because a user must always be able to stop something that is
    // already working against them.
    const follower = SYSTEM_ROLE_DEFINITIONS.find((entry) => entry.key === SystemRole.FOLLOWER);
    expect(follower?.permissions).not.toContain(Permission.EXECUTION_SUBMIT);
    expect(follower?.permissions).toContain(Permission.EXECUTION_CANCEL);
  });

  it('gives the tenant administrator the safety controls but not the trading ones', () => {
    const admin = SYSTEM_ROLE_DEFINITIONS.find((entry) => entry.key === SystemRole.TENANT_ADMIN);
    expect(admin?.permissions).toContain(Permission.KILL_SWITCH_OPERATE);
    expect(admin?.permissions).toContain(Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE);
    expect(admin?.permissions).not.toContain(Permission.EXECUTION_SUBMIT);
  });

  it('allows compliance to stop trading', () => {
    const compliance = SYSTEM_ROLE_DEFINITIONS.find((entry) => entry.key === SystemRole.COMPLIANCE);
    expect(compliance?.permissions).toContain(Permission.KILL_SWITCH_OPERATE);
  });
});
