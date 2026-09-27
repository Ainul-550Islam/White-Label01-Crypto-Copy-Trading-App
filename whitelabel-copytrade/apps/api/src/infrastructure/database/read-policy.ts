/**
 * Read-replica routing policy - the decision half, pure.
 *
 * The law, in one sentence: a read goes to a replica ONLY when every fact
 * about the replica is presently known-good, and every unknown routes to
 * the primary. This is fail-closed in the only direction that matters: a
 * wrong "primary" costs microseconds; a wrong "replica" serves a user their
 * own write from yesterday, and in this platform "yesterday" can contain a
 * fill.
 *
 * Two properties the rest of the file exists to keep true:
 *
 *  1. The query's CLASS is supplied by the caller per read, defaulting to
 *     execution-critical (primary-forced). Forgetting to classify reads
 *     safe, which is the correct outcome of forgetting.
 *  2. Replica LAG is data, not a boolean. `lagMs: null` (probe never ran,
 *     probe timed out, replica mid-promotion) is its own arm - not folded
 *     into "healthy". A topology where lag is unknown and reads flow is a
 *     topology where freshness is a rumor.
 *
 * What this module deliberately is NOT: it is not a Prisma concern and not
 * a Nest provider. PrismaService answers "which client exists"; callers
 * decide "which the query deserves"; the composition happens one level up
 * where metrics can be recorded honestly. Keeping the decision pure is what
 * lets every arm be table-tested here instead of being discovered in a
 * failover drill at 3am.
 */

export type ReadClass = 'execution-critical' | 'operational' | 'analytical';

export type ReadDecision = 'primary' | 'replica' | 'stale-fallback-primary';

export interface ReplicaFacts {
  /** DATABASE_READ_ENABLED - the deployment's opt-in. */
  readonly enabled: boolean;
  /** A replica client was actually constructed (URL present and valid). */
  readonly clientConfigured: boolean;
  /** Liveness as last PROBED (connection reachable). Unknown = false. */
  readonly healthy: boolean;
  /** Replication lag from the last successful probe, or null when no fresh
   * measurement exists. Freshness of the PROBE is the caller's burden:
   * a lag sample older than the probe interval is `null`, not "small". */
  readonly lagMs: number | null;
  /** DATABASE_READ_MAX_LAG_MS; 0 means "never read replica", not "any lag". */
  readonly maxLagMs: number;
  /** The classification of THIS read. */
  readonly readClass: ReadClass;
}

export interface RoutedRead {
  readonly decision: ReadDecision;
  /** Bounded label for wlct_read_routing_decisions_total - 'replica',
   * 'primary', or 'stale_fallback' - mapped HERE so a caller cannot
   * mislabel its own metric. */
  readonly metricLabel: 'primary' | 'replica' | 'stale_fallback';
  /** Machine-readable reason, e.g. 'class:execution-critical', 'lag:1200',
   * 'lag:unknown', 'disabled', 'unconfigured', 'unhealthy'. Safe to log
   * and to alert on; carries no identifiers. */
  readonly reason: string;
}

/** Decide. Pure, total, and every branch answers a question an operator
 * would ask: "why didn't this read use the replica?" */
export function routeRead(facts: ReplicaFacts): RoutedRead {
  if (facts.readClass === 'execution-critical') {
    return {
      decision: 'primary',
      metricLabel: 'primary',
      reason: 'class:execution-critical',
    };
  }
  if (!facts.enabled) {
    return { decision: 'primary', metricLabel: 'primary', reason: 'disabled' };
  }
  if (!facts.clientConfigured) {
    return { decision: 'primary', metricLabel: 'primary', reason: 'unconfigured' };
  }
  if (!facts.healthy) {
    return { decision: 'primary', metricLabel: 'primary', reason: 'unhealthy' };
  }
  if (facts.maxLagMs <= 0) {
    // Explicit zero is a policy statement: "I have a replica and I refuse
    // to read it stale at any lag". Not an accident to paper over.
    return { decision: 'primary', metricLabel: 'primary', reason: 'max-lag:0' };
  }
  if (facts.lagMs === null || !Number.isFinite(facts.lagMs) || facts.lagMs < 0) {
    // Unknowable, NaN (probe returned junk), or negative (replica clock
    // skew lies about being ahead): all are "cannot assert freshness".
    return {
      decision: 'stale-fallback-primary',
      metricLabel: 'stale_fallback',
      reason: 'lag:unknown',
    };
  }
  if (facts.lagMs > facts.maxLagMs) {
    return {
      decision: 'stale-fallback-primary',
      metricLabel: 'stale_fallback',
      reason: `lag:${Math.round(facts.lagMs)}`,
    };
  }
  // lagMs exactly AT the ceiling passes: the ceiling means "this much is
  // tolerable", and a boundary that rejects its own value is a boundary
  // nobody can reason about at 3am.
  return { decision: 'replica', metricLabel: 'replica', reason: `lag:${Math.round(facts.lagMs)}` };
}

/** Default classification when a call site has not stated one - and the
 * default is the expensive direction ON PURPOSE. */
export const UNCLASSIFIED_READ_CLASS: ReadClass = 'execution-critical';
