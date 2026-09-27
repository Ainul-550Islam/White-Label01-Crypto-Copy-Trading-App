/**
 * The read-replica policy is one function with eight arms - so every arm is
 * a test, and this file IS the policy's specification. What is being pinned
 * is not "replica routing works" but the fail-closed LAW: uncertainty about
 * the replica never silently buys speed with correctness.
 *
 * The boundary at lag == maxLagMs is asserted explicitly (replica ALLOWED
 * at exactly the ceiling) because both readings of "must not exceed" are
 * defensible in review and only one is documented. An undocumented boundary
 * is a boundary that changes during the refactor nobody thought to re-test.
 */

import {
  routeRead,
  UNCLASSIFIED_READ_CLASS,
  type ReplicaFacts,
} from './read-policy';

function facts(overrides: Partial<ReplicaFacts> = {}): ReplicaFacts {
  return {
    enabled: true,
    clientConfigured: true,
    healthy: true,
    lagMs: 100,
    maxLagMs: 1500,
    readClass: 'analytical',
    ...overrides,
  };
}

describe('Part 11 read-replica policy', () => {
  it('routes a fully-healthy replica read', () => {
    const routed = routeRead(facts());
    expect(routed.decision).toBe('replica');
    expect(routed.metricLabel).toBe('replica');
  });

  it('execution-critical reads never see the replica, healthy or not', () => {
    for (const override of [
      {},
      { enabled: true, healthy: true, lagMs: 0 },
    ] as const) {
      const routed = routeRead(facts({ readClass: 'execution-critical', ...override }));
      expect(routed.decision).toBe('primary');
      expect(routed.reason).toBe('class:execution-critical');
    }
  });

  it('the unclassified default IS execution-critical (forgetting routes safe)', () => {
    expect(UNCLASSIFIED_READ_CLASS).toBe('execution-critical');
  });

  it('disabled routing goes to primary with the disabled reason', () => {
    const routed = routeRead(facts({ enabled: false }));
    expect(routed.decision).toBe('primary');
    expect(routed.reason).toBe('disabled');
  });

  it('flag on but no client configured stays on the primary', () => {
    const routed = routeRead(facts({ clientConfigured: false }));
    expect(routed.decision).toBe('primary');
    expect(routed.reason).toBe('unconfigured');
  });

  it('an unhealthy replica never carries reads', () => {
    const routed = routeRead(facts({ healthy: false }));
    expect(routed.decision).toBe('primary');
    expect(routed.reason).toBe('unhealthy');
  });

  it('maxLagMs of zero is a policy statement, not "any lag is fine"', () => {
    const routed = routeRead(facts({ maxLagMs: 0, lagMs: 0 }));
    expect(routed.decision).toBe('primary');
    expect(routed.reason).toBe('max-lag:0');
  });

  it('unknown lag fails closed to the primary as a STALE fallback', () => {
    for (const lagMs of [null, Number.NaN, -1] as const) {
      const routed = routeRead(facts({ lagMs }));
      expect(routed.decision).toBe('stale-fallback-primary');
      expect(routed.metricLabel).toBe('stale_fallback');
      expect(routed.reason).toBe('lag:unknown');
    }
  });

  it('excess lag falls back; the exact boundary passes', () => {
    const over = routeRead(facts({ lagMs: 1501 }));
    expect(over.decision).toBe('stale-fallback-primary');
    expect(over.reason).toBe('lag:1501');
    const boundary = routeRead(facts({ lagMs: 1500 }));
    expect(boundary.decision).toBe('replica');
    expect(boundary.reason).toBe('lag:1500');
  });

  it('the metric label universe is the three registered values', () => {
    const seen = new Set<string>();
    for (const variant of [
      facts(),
      facts({ readClass: 'execution-critical' }),
      facts({ lagMs: null }),
      facts({ enabled: false }),
    ]) {
      seen.add(routeRead(variant).metricLabel);
    }
    expect([...seen].sort()).toEqual(['primary', 'replica', 'stale_fallback']);
  });

  it('reasons carry shapes, never identifiers (log-safe by construction)', () => {
    const routed = routeRead(facts({ lagMs: 1600.4 }));
    expect(routed.reason).toBe('lag:1600');
    expect(routed.reason).not.toMatch(/tenant|account|user/i);
  });
});
