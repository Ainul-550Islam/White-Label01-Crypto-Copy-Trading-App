/**
 * Read-only view of the trading worker's partition coordination.
 *
 * This service reads ONLY what the worker already wrote to Redis (the claim
 * keys) and what deployment config already declares (the membership list).
 * It writes nothing, claims nothing, and releases nothing - the same
 * "speedometer, not brakes" boundary every other operations read sits
 * behind. Its authority is exactly: "here is who last said they hold
 * partition N, and when that claim expires."
 *
 * Why read the claims rather than ask the workers: the workers have no
 * server (src/worker.ts opens no HTTP port, by design). Redis is the shared
 * truth they all write, so it is also the honest place to observe them.
 * A claim that has expired is INDISTINGUISHABLE from a worker that died a
 * moment ago - which is precisely the fact an operator needs, and precisely
 * the reason `claimExists: false` is reported rather than a worker being
 * declared dead.
 */

import { Injectable } from '@nestjs/common';
import { WORKER_COORDINATION_GROUP } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { membershipRegistryKey, partitionClaimKey } from '../../infrastructure/coordination/lease';
import { liveMembers } from '../../infrastructure/coordination/membership';
import { partitionOwner } from '../../infrastructure/coordination/partitions';

export interface PartitionClaimView {
  readonly partition: number;
  readonly claimKey: string;
  readonly claimExists: boolean;
  readonly holderMemberId: string | null;
  readonly remainingTtlMs: number;
  readonly expectedOwnerMemberId: string | null;
  readonly holderMatchesExpectation: boolean | null;
}

/** One entry of the raw registry zset: who self-registered and when their
 * heartbeat stops counting. Expired entries appear until the next worker
 * ping prunes them (a read never mutates) - which is why `live` below is
 * the answer and this list is the evidence. */
export interface RegisteredMemberView {
  readonly memberId: string;
  readonly expiryEpochMs: number;
}

export interface WorkerCoordinationView {
  readonly coordinationGroup: string;
  readonly partitionCount: number;
  readonly leaseTtlMs: number;
  readonly membershipConfigured: readonly string[];
  readonly registryKey: string;
  /** Raw registry contents, or null when the reply was unreadable (a
   * pre-Part-12 deployment has no zset and reads as `[]`, never null -
   * null means "the data exists and lies outside the protocol", which an
   * operator should notice in a way that empty never should). */
  readonly registryMembers: readonly RegisteredMemberView[] | null;
  /** The registry answer under the SAME staleness law the workers apply
   * (`liveMembers`, expiry strictly in the future), not a second reading
   * of it. Null mirrors registryMembers' unreadability. */
  readonly registryLiveMembers: readonly string[] | null;
  readonly partitions: readonly PartitionClaimView[];
  readonly claimedCount: number;
  readonly misalignedCount: number;
  readonly note: string;
}

@Injectable()
export class WorkerCoordinationReadService {
  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  /** One read pass, no mutation. ioredis pipeline so a 4096-partition
   * deployment costs one round trip, not 8192 - the operations panel must
   * not itself become a load generator during the incident it is open for. */
  async readState(): Promise<WorkerCoordinationView> {
    const count = this.config.workerPartitionCount;
    const membership = [...this.config.workerMembership];
    const leaseTtlMs = this.config.workerPartitionLeaseTtlMs;

    const client = this.redis.client;
    const pipeline = client.pipeline();
    for (let partition = 0; partition < count; partition += 1) {
      const key = partitionClaimKey(WORKER_COORDINATION_GROUP, partition);
      pipeline.get(key);
      pipeline.pttl(key);
    }
    // Registry zset read LAST so the index math above stays untouched by
    // this addition (and so a future per-partition verb keeps doing the
    // same): the flat WITHSCORES reply is parsed, not pattern-matched,
    // below.
    const registryKey = membershipRegistryKey(WORKER_COORDINATION_GROUP);
    pipeline.zrange(registryKey, 0, -1, 'WITHSCORES');
    const replies = (await pipeline.exec()) ?? [];

    let registryMembers: RegisteredMemberView[] | null = null;
    let registryLiveMembers: readonly string[] | null = null;
    try {
      const raw = replies[count * 2]?.[1];
      if (!Array.isArray(raw)) {
        throw new Error('registry reply was not an array');
      }
      if (raw.length % 2 !== 0) {
        throw new Error('registry reply had an odd number of elements');
      }
      const pairs: Array<readonly [string, number]> = [];
      const entries: RegisteredMemberView[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        const name = raw[i];
        const score = Number(raw[i + 1]);
        if (typeof name !== 'string' || !Number.isSafeInteger(score)) {
          throw new Error('registry entry was outside the (member, expiry) shape');
        }
        entries.push({ memberId: name, expiryEpochMs: score });
        pairs.push([name, score] as const);
      }
      registryMembers = entries;
      registryLiveMembers = liveMembers(pairs, Date.now());
    } catch {
      registryMembers = null;
      registryLiveMembers = null;
    }

    const partitions: PartitionClaimView[] = [];
    let claimedCount = 0;
    let misalignedCount = 0;
    for (let partition = 0; partition < count; partition += 1) {
      const holder = replies[partition * 2]?.[1] ?? null;
      const pttl = replies[partition * 2 + 1]?.[1] ?? -2;
      const claimExists = typeof holder === 'string';
      const holderMemberId = claimExists ? String(holder) : null;
      const expected =
        membership.length > 0 ? partitionOwner(membership, partition) : null;
      let matches: boolean | null = null;
      if (claimExists && expected !== null) {
        matches = holderMemberId === expected;
      }
      if (claimExists) {
        claimedCount += 1;
      }
      // Misalignment is only meaningful when BOTH a holder and an expected
      // owner exist; a claim with no membership configured is not
      // "misaligned", it is a deployment that has not declared its fleet,
      // and conflating the two sends operators chasing the wrong thing.
      if (matches === false) {
        misalignedCount += 1;
      }
      partitions.push({
        partition,
        claimKey: partitionClaimKey(WORKER_COORDINATION_GROUP, partition),
        claimExists,
        holderMemberId,
        // pttl: -2 no key, -1 key w/o expiry (never for a claim), else ms.
        remainingTtlMs: typeof pttl === 'number' ? pttl : -2,
        expectedOwnerMemberId: expected,
        holderMatchesExpectation: matches,
      });
    }

    return {
      coordinationGroup: WORKER_COORDINATION_GROUP,
      partitionCount: count,
      leaseTtlMs,
      membershipConfigured: membership,
      registryKey,
      registryMembers,
      registryLiveMembers,
      partitions,
      claimedCount,
      misalignedCount,
      note:
        'Observation only: claims and the membership zset are written by the ' +
        'worker processes. An expired or absent claim does not prove a ' +
        'worker died, only that no claim is live now. The registry list is ' +
        'RAW (entries linger until the next ping prunes them); ' +
        'registryLiveMembers applies the workers\' staleness law at read ' +
        'time - compare expectations against THAT list, not the raw one.',
    };
  }
}
