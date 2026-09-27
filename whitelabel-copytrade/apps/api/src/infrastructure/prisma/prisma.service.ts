import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../config/app-config.service';
import {
  routeRead,
  type ReadClass,
  type ReplicaFacts,
  type RoutedRead,
} from '../database/read-policy';

/**
 * Prisma client wrapper.
 *
 * Responsibilities:
 *   - lifecycle management tied to the Nest container (connect/disconnect);
 *   - query logging that never prints bound parameters (they can contain
 *     credentials or personal data);
 *   - slow-query surfacing so index regressions are caught in staging;
 *   - a health probe used by the readiness endpoint.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query' | 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly SLOW_QUERY_THRESHOLD_MS = 500;
  private static readonly TENANT_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    super({
      datasources: { db: { url: config.databaseUrl } },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: config.isProduction ? 'minimal' : 'pretty',
    });
    this.replicaClient =
      config.databaseReadEnabled && config.databaseReadUrl !== undefined
        ? new PrismaClient<Prisma.PrismaClientOptions, 'query' | 'error'>({
            datasources: { db: { url: config.databaseReadUrl } },
            // Same log-event discipline as the primary: parameters are never
            // printed, warnings and errors propagate, and the replica is
            // nobody's second-class citizen in the logs.
            log: [
              { emit: 'event', level: 'query' },
              { emit: 'event', level: 'error' },
            ],
            errorFormat: config.isProduction ? 'minimal' : 'pretty',
          })
        : null;
    // A configured replica also gets the slow-query surface; a replica that
    // is quietly 10x slower than the primary is a routing bug, and it should
    // show up in the SAME log stream that already carries primary warnings.
    this.replicaClient?.$on('query', (event: Prisma.QueryEvent) => {
      if (event.duration >= PrismaService.SLOW_QUERY_THRESHOLD_MS) {
        this.logger.warn(
          {
            event: 'database.slow_query',
            durationMs: event.duration,
            query: event.query,
            target: 'replica',
          },
          'Slow database query detected on the read replica',
        );
      }
    });
  }

  async onModuleInit(): Promise<void> {
    this.$on('query', (event: Prisma.QueryEvent) => {
      if (event.duration >= PrismaService.SLOW_QUERY_THRESHOLD_MS) {
        this.logger.warn(
          { event: 'database.slow_query', durationMs: event.duration, query: event.query },
          'Slow database query detected',
        );
        return;
      }
      if (this.config.databaseLogQueries) {
        // `event.params` is deliberately omitted: it may contain secrets.
        this.logger.debug(
          { event: 'database.query', durationMs: event.duration, query: event.query },
          'Database query',
        );
      }
    });

    this.$on('warn', (event: Prisma.LogEvent) => {
      this.logger.warn({ event: 'database.warning', target: event.target }, event.message);
    });

    this.$on('error', (event: Prisma.LogEvent) => {
      this.logger.error({ event: 'database.error', target: event.target }, event.message);
    });

    await this.$connect();
    this.logger.info({ event: 'database.connected' }, 'Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    if (this.replicaClient !== null) {
      await this.replicaClient.$disconnect();
    }
    this.logger.info({ event: 'database.disconnected' }, 'Prisma disconnected');
  }

  // --- Part 11: read-replica plumbing --------------------------------------
  //
  // The replica client EXISTS here because the connection lifecycle must
  // live where the primary's does; the ROUTING DECISION does not, and is not
  // even consulted by anything in this file. That split is deliberate:
  // infrastructure knows what is configured, policy knows what a read
  // deserves, and neither quietly borrows the other's authority. The schema
  // already refuses half-configured deployments; the null below is what a
  // not-configured one looks like, and every path through this service
  // treats it the same way: primary, always.

  /** The replica client, or null when routing is off/unconfigured. Frozen
   * at construction on purpose - flipping DATABASE_READ_ENABLED under a
   * running process would create clients mid-request. */
  private readonly replicaClient: PrismaClient<Prisma.PrismaClientOptions, 'query' | 'error'> | null;

  /** Last probe result; `lagMs: null` means "measured and cannot assert
   * freshness" (replica error, NULL replay timestamp, stale sample) and is
   * exactly the arm the fail-closed policy is written for. */
  private replicaProbe: ReplicaProbe = { healthy: false, lagMs: null, probedAtMs: 0 };
  private probeInFlight: Promise<ReplicaProbe> | null = null;

  /** The probe sample is trusted for this long, then treated as unknown.
   * 10s is a constant, not a knob: shorter than the replication systems it
   * watches it measures nothing; longer and stale data decides routing -
   * the precise failure this module exists to refuse. */
  private static readonly PROBE_TTL_MS = 10_000;

  /** Policy-driven read execution. Callers classify their read and supply
   * both arms; the decision layer picks. Replica-path FAILURES are not
   * retried on the primary here: a read that hit a dying replica returning
   * an error is information, and silently re-firing it turns one slow
   * replica into two overloaded databases during the incident that proved
   * why the policy exists. */
  async routeRead<T>(input: {
    readonly readClass: ReadClass;
    readonly onPrimary: (client: PrismaService) => Promise<T>;
    readonly onReplica: (client: PrismaClient<Prisma.PrismaClientOptions, 'query' | 'error'>) => Promise<T>;
    readonly onDecision?: (routed: RoutedRead) => void;
  }): Promise<T> {
    const facts = await this.replicaFacts();
    const routed = routeRead({
      ...facts,
      readClass: input.readClass,
    });
    input.onDecision?.(routed);
    if (routed.decision === 'replica' && this.replicaClient !== null) {
      return input.onReplica(this.replicaClient);
    }
    return input.onPrimary(this);
  }

  /** Fresh-probe facts: the replica client's existence, liveness and lag as
   * of a sample no older than PROBE_TTL_MS. Concurrent callers share one
   * in-flight probe (stampede protection against their own staleness). */
  async replicaFacts(): Promise<
    Pick<ReplicaFacts, 'enabled' | 'clientConfigured' | 'healthy' | 'lagMs' | 'maxLagMs'>
  > {
    const now = Date.now();
    if (this.replicaClient !== null && now - this.replicaProbe.probedAtMs >= PrismaService.PROBE_TTL_MS) {
      this.probeInFlight ??= this.probeReplica().finally(() => {
        this.probeInFlight = null;
      });
      await this.probeInFlight;
    }
    return {
      enabled: this.config.databaseReadEnabled,
      clientConfigured: this.replicaClient !== null,
      healthy: this.replicaProbe.healthy,
      lagMs: this.replicaProbe.lagMs,
      maxLagMs: this.config.databaseReadMaxLagMs,
    };
  }

  private async probeReplica(): Promise<ReplicaProbe> {
    const replica = this.replicaClient;
    if (replica === null) {
      this.replicaProbe = { healthy: false, lagMs: null, probedAtMs: Date.now() };
      return this.replicaProbe;
    }
    try {
      // pg_last_xact_replay_timestamp() is NULL on a primary (and on a
      // replica that has replayed nothing): treating NULL as 0 would call
      // "DATABASE_READ_URL pointed at the primary" perfectly fresh, which
      // is precisely the misconfiguration this probe should catch.
      const rows = await replica.$queryRawUnsafe<
        Array<{ lag_ms: number | null }>
      >('SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS lag_ms');
      const first = rows[0]?.lag_ms;
      const lagMs = typeof first === 'number' && Number.isFinite(first) && first >= 0 ? first : null;
      this.replicaProbe = { healthy: true, lagMs, probedAtMs: Date.now() };
    } catch (error) {
      this.replicaProbe = { healthy: false, lagMs: null, probedAtMs: Date.now() };
      this.logger.warn(
        {
          event: 'database.replica_probe_failed',
          message: error instanceof Error ? error.message.slice(0, 200) : 'probe error',
        },
        'read-replica probe failed; routing fails closed to the primary',
      );
    }
    return this.replicaProbe;
  }

  /**
   * Run `work` inside a transaction whose LOCAL GUC carries the tenant for
   * the database's row-level-security policies (Part 11).
   *
   * Three facts, each load-bearing:
   *  - `set_config(..., true)` is SET LOCAL: the setting dies with the
   *    transaction, so a pooled connection can never carry one tenant's
   *    context into another tenant's next query - the failure mode that
   *    makes connection-level `SET` the wrong tool in a pooler;
   *  - the tenant id is validated as a canonical UUID BEFORE it is passed
   *    anywhere: the policy casts the GUC to uuid, and a junk value would
   *    either error mid-query or (worse on some cast paths) coerce -
   *    refusing here keeps the failure a programming error with a name;
   *  - the value is a BIND PARAMETER of the set_config call (Prisma's
   *    tagged-template interpolation), never string-concatenated SQL.
   *
   * Until prisma/rls/enable.sql has run, this sets a GUC that INERT policies
   * ignore - deliberately shippable before enablement, so the deployment
   * order is "app first, DBA flips RLS when every path adopts this".
   */
  async withTenantRls<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!PrismaService.TENANT_UUID.test(tenantId)) {
      throw new Error(
        'withTenantRls requires a canonical tenant UUID; refusing to place a ' +
          'non-UUID value into the row-level-security GUC',
      );
    }
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return work(tx);
    });
  }

  /** Round-trip used by the readiness health indicator. */
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    await this.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  }

  /**
   * Runs a callback inside a serialisable transaction with sensible defaults
   * for financial workloads (short timeouts, explicit isolation level).
   */
  async runInTransaction<T>(
    handler: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { timeoutMs?: number; maxWaitMs?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {},
  ): Promise<T> {
    return this.$transaction(handler, {
      timeout: options.timeoutMs ?? 10_000,
      maxWait: options.maxWaitMs ?? 5_000,
      isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }
}

interface ReplicaProbe {
  readonly healthy: boolean;
  readonly lagMs: number | null;
  readonly probedAtMs: number;
}
