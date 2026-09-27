/**
 * Partition coordination for the trading worker.
 *
 * The law this service enforces, stated once: an execution job may only be
 * processed while THIS process verifiably holds the claim for the partition
 * its account maps to. Not "while the config says it should" - membership,
 * from whatever source, computes WHO WANTS the partition; the claims decide
 * who HAS it, and the gap between those two is exactly where a split-brain
 * restart lives.
 *
 * Membership has two sources (WORKER_MEMBERSHIP_MODE), and this is the only
 * place that knows both:
 * - 'config' (Part 11): WORKER_MEMBERSHIP, identical on every replica.
 * - 'registry' (Part 12): each worker heartbeats its id into one shared
 *   zset; the live set is that zset pruned by the clock. The config list
 *   survives as the documented fallback - the fleet view before the first
 *   successful ping, and the view held during registry outages (last known
 *   live set if there is one). Neither mode changes the authority law: a
 *   worker in neither list finds nothing wanted, holds nothing, and defers
 *   everything - enforced by Redis, not by politeness.
 *
 * Failure model, in one paragraph because the code below must not deviate:
 * a failed reconcile tick keeps the LAST held set but ages it; once the
 * snapshot is older than twice the tick interval, `holds()` answers false -
 * fail closed. Jobs deferred on staleness are re-delivered after the defer
 * delay and re-checked; if Redis comes back inside that window the worker
 * never loses a claim it still actually has, and if it does not, the ceiling
 * (WORKER_MAX_DEFERS) fails the job visibly. A failed MEMBERSHIP read in
 * registry mode is one rung softer and handled inside the same tick: it
 * substitutes the fallback view and counts `membership_fallback`; the
 * claims calls that follow still decide what this worker may hold, so the
 * worst outcome of a lying membership answer is one tick of wanting the
 * wrong set. Coordination failure is a slowed and loudly-answered pipeline,
 * never a fast uncoordinated one.
 */

import { Injectable, Optional } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import type { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';

import { WORKER_COORDINATION_GROUP } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { IoredisCoordinationClient } from '../../infrastructure/coordination/ioredis-adapter';
import { PartitionClaims } from '../../infrastructure/coordination/lease';
import { MembershipRegistry } from '../../infrastructure/coordination/membership';
import { partitionFor, partitionOwner } from '../../infrastructure/coordination/partitions';

export interface WorkerCoordinationSnapshot {
  readonly memberId: string;
  readonly membership: readonly string[];
  readonly membershipSource: 'config' | 'registry';
  readonly partitionCount: number;
  readonly group: string;
  readonly heldPartitions: readonly number[];
  readonly lastReconcileAtMs: number;
  readonly snapshotStale: boolean;
  readonly reconcileFailures: number;
  readonly deferrals: number;
}

@Injectable()
export class WorkerCoordinationService implements OnModuleDestroy {

  private readonly claims: PartitionClaims;
  /** Null in config mode - the ONLY branch point; every other line here is
   * mode-agnostic because resolveMembership() answers one way or the
   * other. Constructed eagerly (boot-time config reads may throw loudly
   * at boot; they must not throw inside the hot loop). */
  private readonly registry: MembershipRegistry | null;
  private readonly membershipMode: 'config' | 'registry';
  private readonly tickTimer: NodeJS.Timeout;
  private held: ReadonlySet<number> = new Set<number>();
  /** Cached fleet view, written by successful reconciles ONLY. snapshot()
   * never reads live config: a diagnostic that can throw while the config
   * source is broken turns an incident into a crash loop. `snapshotStale`
   * already tells the reader the view may lag; the cached arms tell them
   * WHICH view it lags with. */
  private lastMembership: readonly string[] = [];
  /** The last registry-confirmed live set (Part 12). Null until the first
   * successful ping; a later ping failure falls back to it rather than to
   * config, because "who was here 3 seconds ago" beats "who the YAML
   * guessed" during an outage blip. */
  private lastKnownMembers: readonly string[] | null = null;
  private lastPartitionCount = 0;
  private lastReconcileAtMs = 0;
  private reconcileFailures = 0;
  private deferrals = 0;
  private stopping = false;
  private tickInFlight: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfigService,
    redis: RedisService,
    @InjectPinoLogger(WorkerCoordinationService.name) private readonly logger: PinoLogger,
    // Optional exactly as the redaction module does it: the worker wires the
    // real registry, a bare harness (unit specs) runs without one, and
    // "telemetry missing" must never be a reason coordination cannot work.
    @Optional() private readonly metrics?: MetricsRegistry,
  ) {
    const port = new IoredisCoordinationClient(redis.duplicate());
    this.claims = new PartitionClaims(port, {
      group: WORKER_COORDINATION_GROUP,
      member: config.workerId,
      ttlMillis: config.workerPartitionLeaseTtlMs,
    });
    this.membershipMode = config.workerMembershipMode;
    this.registry =
      this.membershipMode === 'registry'
        ? new MembershipRegistry(port, {
            group: WORKER_COORDINATION_GROUP,
            member: config.workerId,
            ttlMillis: config.workerMembershipTtlMs,
          })
        : null;
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, config.workerPartitionRetryMs);
    // The interval must not hold the event loop open by itself; Nest's
    // shutdown path calls onModuleDestroy, which clears it deliberately.
    this.tickTimer.unref();
    // First tick immediately: waiting one full interval to know your
    // partitions while jobs are arriving is choosing the defer path.
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearInterval(this.tickTimer);
    if (this.tickInFlight !== null) {
      await this.tickInFlight;
    }
    // Leave the fleet first (registry mode only): every surviving peer's
    // next ping reassigns this worker's partitions immediately instead of
    // at TTL. Best-effort by contract - `resign` answers false rather than
    // throwing, and the expiry law catches whatever the ZREM missed.
    if (this.registry !== null) {
      try {
        const resigned = await this.registry.resign();
        this.logger.info(
          JSON.stringify({
            event: 'worker.coordination.resign',
            memberId: this.config.workerId,
            resigned,
          }),
        );
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'worker.coordination.resign_failed',
            memberId: this.config.workerId,
            message: error instanceof Error ? error.message : 'resign threw',
          }),
        );
      }
    }
    // Graceful: release what we hold so the next owner does not wait a TTL.
    // A crash skips this line and the TTL IS the release - both paths leave
    // exactly one holder, which is the only promise anyone needs.
    for (const partition of [...this.held].sort((a, b) => a - b)) {
      this.metrics?.inc('wlct_worker_coordination_events_total', { result: 'released' });
      await this.claims.release(partition);
    }
    this.held = new Set<number>();
  }

  /** The routing key for a job: account-scoped, both languages identical.
   * `${tenantId}:${accountId}` composes the SAME string the Python side
   * hashes (docs/fixtures pin the vectors), so a worker and the engine
   * never disagree about which partition a money path belongs to. */
  partitionForAccount(tenantId: string, accountId: string): number {
    return partitionFor(`${tenantId}:${accountId}`, this.config.workerPartitionCount);
  }

  /** Verdict for the processor. Synchronous by design - the job path must
   * not await Redis; the tick keeps this answer fresh, staleness makes it
   * conservatively false. */
  holds(partition: number): boolean {
    if (!this.held.has(partition)) {
      return false;
    }
    const stalenessMs = Date.now() - this.lastReconcileAtMs;
    return stalenessMs <= 2 * this.config.workerPartitionRetryMs;
  }

  /** One defer accounted: the metric exists so "everything is being
   * deferred" is a number an operator can alert on, not a vibe. The label
   * is the constant queue name - never a tenant or job id. */
  noteDeferral(): void {
    this.deferrals += 1;
    this.metrics?.inc('wlct_worker_deferred_jobs_total', { queue: 'trade-execution' });
  }

  async tick(): Promise<void> {
    if (this.stopping) {
      return;
    }
    if (this.tickInFlight !== null) {
      // A slow Redis must not stack ticks - but callers of tick() await an
      // ANSWER, not merely "a tick exists": join the in-flight reconcile
      // rather than returning a verdict that has not been written yet.
      await this.tickInFlight;
      return;
    }
    this.tickInFlight = this.reconcile().finally(() => {
      this.tickInFlight = null;
    });
    return this.tickInFlight;
  }

  /** The fleet view for this tick. NEVER throws: in registry mode any ping
   * failure (transport, malformed reply, a ping that did not even list us)
   * is converted into the fallback view plus one counted, logged
   * `membership_fallback`. That is the whole Point of putting the law in
   * one method: reconcile() cannot half-apply a membership answer, so the
   * claim calls that follow always run against a membership someone believed
   * at SOME point this tick. */
  private async resolveMembership(): Promise<string[]> {
    const fromConfig = [...this.config.workerMembership];
    if (this.membershipMode !== 'registry' || this.registry === null) {
      return fromConfig;
    }
    let live: readonly string[];
    try {
      live = await this.registry.ping(Date.now());
      if (!live.includes(this.config.workerId)) {
        // Self-registration that does not register you is a protocol bug,
        // not an outage fact: trust it for nothing, fall back loudly.
        throw new Error('registry ping omitted this member');
      }
    } catch (error) {
      this.metrics?.inc('wlct_worker_coordination_events_total', {
        result: 'membership_fallback',
      });
      this.logger.warn(
        JSON.stringify({
          event: 'worker.coordination.membership_fallback',
          memberId: this.config.workerId,
          using: this.lastKnownMembers === null ? 'config' : 'last-known',
          message: error instanceof Error ? error.message : 'membership ping failed',
        }),
      );
      return this.lastKnownMembers === null ? fromConfig : [...this.lastKnownMembers];
    }
    const previous = this.lastKnownMembers;
    this.lastKnownMembers = live;
    // Sorted arrays compare element-wise; the registry guarantees sorted,
    // so inequality here really is a fleet change, not an ordering flake.
    const changed =
      previous === null ||
      previous.length !== live.length ||
      previous.some((member, index) => member !== live[index]);
    if (changed) {
      this.metrics?.inc('wlct_worker_coordination_events_total', {
        result: 'membership_updated',
      });
      this.logger.info(
        JSON.stringify({
          event: 'worker.coordination.membership_updated',
          memberId: this.config.workerId,
          from: previous === null ? null : [...previous],
          to: [...live],
        }),
      );
    }
    return [...live];
  }

  private async reconcile(): Promise<void> {
    const wanted: number[] = [];
    try {
      // EVERY failure source in here - a throwing config getter, a bad
      // membership grammar, Redis itself - lands in the same counted,
      // verdict-preserving arm. The setInterval caller cannot survive an
      // escaping rejection any more than the awaiting caller deserves one.
      // resolveMembership() deliberately sits INSIDE this guard even though
      // it cannot throw: a defensive belt for the day someone edits it, at
      // zero cost.
      const members = await this.resolveMembership();
      const count = this.config.workerPartitionCount;
      for (let partition = 0; partition < count; partition += 1) {
        if (partitionOwner(members, partition) === this.config.workerId) {
          wanted.push(partition);
        }
      }
      const held = await this.claims.reconcile(wanted);
      const gained = [...held].filter((p) => !this.held.has(p));
      const lost = [...this.held].filter((p) => !held.has(p));
      this.held = held;
      this.lastMembership = members;
      this.lastPartitionCount = count;
      this.lastReconcileAtMs = Date.now();
      this.reconcileFailures = 0;
      if (gained.length > 0) {
        this.metrics?.inc('wlct_worker_coordination_events_total', { result: 'claim_gained' }, gained.length);
      }
      if (lost.length > 0) {
        this.metrics?.inc('wlct_worker_coordination_events_total', { result: 'claim_lost' }, lost.length);
      }
      if (gained.length > 0 || lost.length > 0) {
        this.logger.info(
          JSON.stringify({
            event: 'worker.coordination.assignment_changed',
            memberId: this.config.workerId,
            gained,
            lost,
            heldCount: held.size,
          }),
        );
      }
    } catch (error) {
      this.reconcileFailures += 1;
      this.metrics?.inc('wlct_worker_coordination_events_total', { result: 'reconcile_failed' });
      // The held set is KEPT (aging) and the failures counted: a Redis
      // blip must not instantly evict a worker from partitions it almost
      // certainly still owns. Only STALENESS (above) turns blips into
      // deferrals, and deferrals are safe by construction.
      this.logger.warn(
        JSON.stringify({
          event: 'worker.coordination.reconcile_failed',
          memberId: this.config.workerId,
          failures: this.reconcileFailures,
          message: error instanceof Error ? error.message : 'coordination transport failure',
        }),
      );
    }
  }

  /** For the worker's structured health log (and any future read-only
   * admin surface). No secrets, no claim tokens - just the shape. */
  snapshot(): WorkerCoordinationSnapshot {
    return {
      memberId: this.config.workerId,
      membership: [...this.lastMembership],
      membershipSource: this.membershipMode,
      partitionCount: this.lastPartitionCount,
      group: WORKER_COORDINATION_GROUP,
      heldPartitions: [...this.held].sort((a, b) => a - b),
      lastReconcileAtMs: this.lastReconcileAtMs,
      snapshotStale:
        this.lastReconcileAtMs === 0 ||
        Date.now() - this.lastReconcileAtMs > 2 * this.config.workerPartitionRetryMs,
      reconcileFailures: this.reconcileFailures,
      deferrals: this.deferrals,
    };
  }
}
