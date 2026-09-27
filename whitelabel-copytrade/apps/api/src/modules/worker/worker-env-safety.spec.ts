import { EnvValidationError, validateEnv } from '@wlct/config';

/**
 * Part 12: the worker-plane environment laws.
 *
 * The membership-mode rules are the substance: which source drives live
 * membership, and the two clocks that must not fight (heartbeat TTL vs
 * coordination tick, defer cadence vs claim renewal). These env laws had no
 * direct spec before Part 12 - the defer-vs-retry law bit real users of the
 * schema (its first shipped version contradicted its own defaults) - so the
 * regression joins the suite it should always have been in.
 *
 * Same baseEnv discipline as datasets-safety.spec.ts: no database, no
 * network, pure zod. Every refusal is asserted at its own path, because an
 * operator reading one error line must be told WHICH variable to touch.
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

describe('Part 12 - worker membership environment safety', () => {
  it('defaults to config mode with a registry-capable TTL already in place', () => {
    const env = validateEnv(baseEnv());
    expect(env.WORKER_MEMBERSHIP_MODE).toBe('config');
    expect(env.WORKER_MEMBERSHIP_TTL_MS).toBe(30_000);
    // The default must satisfy the REGISTRY cross-law too: flipping the
    // mode is then a safe one-variable change, not a re-tune of three.
    expect(env.WORKER_MEMBERSHIP_TTL_MS).toBeGreaterThanOrEqual(
      2 * env.WORKER_PARTITION_RETRY_MS,
    );
  });

  it('refuses an unknown mode by the enum, not by falling back', () => {
    expectFailureOn(baseEnv({ WORKER_MEMBERSHIP_MODE: 'auto' }), 'WORKER_MEMBERSHIP_MODE');
  });

  it('holds the one-second floor even in config mode', () => {
    // Deliberately mode-independent: a TTL set for a future flip is still a
    // promise being made, and promises below one second are noise promises.
    const failure = expectFailureOn(
      baseEnv({ WORKER_MEMBERSHIP_MODE: 'config', WORKER_MEMBERSHIP_TTL_MS: '999' }),
      'WORKER_MEMBERSHIP_TTL_MS',
    );
    expect(failure.failures[0]?.message).toMatch(/below 1000/);
  });

  it('refuses a registry TTL shorter than two coordination ticks', () => {
    const failure = expectFailureOn(
      baseEnv({ WORKER_MEMBERSHIP_MODE: 'registry', WORKER_MEMBERSHIP_TTL_MS: '4999' }),
      'WORKER_MEMBERSHIP_TTL_MS',
    );
    expect(failure.failures.map((entry) => entry.message).join(' ')).toMatch(
      /2 \* WORKER_PARTITION_RETRY_MS/,
    );
    // Exactly two ticks is lawful (the boundary is >=, tested so a future
    // "tightening" to > gets caught changing the law, not the operator's
    // working config).
    expect(() =>
      validateEnv(baseEnv({ WORKER_MEMBERSHIP_MODE: 'registry', WORKER_MEMBERSHIP_TTL_MS: '5000' })),
    ).not.toThrow();
  });

  it('the cross-law tracks the tick it guards, both directions', () => {
    // Raise the retry cadence and the same once-legal TTL becomes unlawful:
    // the rule is a ratio, not a constant wearing a name.
    expectFailureOn(
      baseEnv({
        WORKER_MEMBERSHIP_MODE: 'registry',
        WORKER_PARTITION_RETRY_MS: '20000',
        WORKER_MEMBERSHIP_TTL_MS: '30000',
      }),
      'WORKER_MEMBERSHIP_TTL_MS',
    );
    // And in config mode the same values are legal, because the law guards
    // the heartbeat loop that only registry mode runs.
    expect(() =>
      validateEnv(baseEnv({ WORKER_MEMBERSHIP_MODE: 'config' })),
    ).not.toThrow();
  });

  it('coerces numeric strings but refuses fractional clocks', () => {
    const env = validateEnv(
      baseEnv({ WORKER_MEMBERSHIP_MODE: 'registry', WORKER_MEMBERSHIP_TTL_MS: '31000' }),
    );
    expect(env.WORKER_MEMBERSHIP_TTL_MS).toBe(31_000);
    expectFailureOn(
      baseEnv({ WORKER_MEMBERSHIP_MODE: 'registry', WORKER_MEMBERSHIP_TTL_MS: '2500.5' }),
      'WORKER_MEMBERSHIP_TTL_MS',
    );
  });

  it('regression: defer cadence may never outpace claim renewal', () => {
    // Part 11's own defaults once violated this rule (2000 < 2500) and the
    // boot refusal it caused was the correct behaviour. Pinned so neither
    // side of the pair may drift back under the other.
    expectFailureOn(baseEnv({ WORKER_DEFER_DELAY_MS: '1000' }), 'WORKER_DEFER_DELAY_MS');
    const env = validateEnv(baseEnv());
    expect(env.WORKER_DEFER_DELAY_MS).toBeGreaterThanOrEqual(env.WORKER_PARTITION_RETRY_MS);
  });
});
