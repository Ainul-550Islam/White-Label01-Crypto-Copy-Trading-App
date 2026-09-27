/**
 * The read-only worker-coordination view. Two things this pins:
 *
 *  1. KEY COMPOSITION - the view reads `wlct:trading:lock:partition:
 *     <group>:<n>`, the same builder the worker's claims use (and the
 *     fixture pins from the Python side). An ops view that reads the wrong
 *     keys is worse than no ops view: it shows a healthy-looking table of
 *     nobody.
 *  2. READ-ONLY TOTALITY - the fake Redis exposes no write verbs at all.
 *     If this file ever needs one to pass, the service broke its contract.
 */

import { WorkerCoordinationReadService } from './worker-coordination-read.service';

interface PipelinedCall {
  readonly verb: 'get' | 'pttl' | 'zrange';
  readonly key: string;
  /** WITHSCORES markers are recorded so a test can pin the exact wire
   * call the membership zset read uses, not just the key. */
  readonly extra?: readonly string[];
}

class RecordingPipeline {
  readonly calls: PipelinedCall[] = [];

  constructor(private readonly replies: Array<[Error | null, unknown]>) {}

  get(key: string): this {
    this.calls.push({ verb: 'get', key });
    return this;
  }

  pttl(key: string): this {
    this.calls.push({ verb: 'pttl', key });
    return this;
  }

  // zrange is a READ - adding it does not breach the fake's write-verb ban.
  zrange(key: string, start: number, stop: number, ...rest: string[]): this {
    expect(start).toBe(0);
    expect(stop).toBe(-1);
    this.calls.push({ verb: 'zrange', key, extra: rest });
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    return this.replies;
  }
}

function harness(options: {
  partitionCount: number;
  membership: string[];
  replies: Array<[Error | null, unknown]>;
  /** Appended after the per-partition replies: the registry zrange's
   * WITHSCORES flat reply, exactly as ioredis answers it. */
  registry?: unknown[];
}) {
  const registryReply: [Error | null, unknown] = [null, options.registry ?? []];
  const replies = [...options.replies, registryReply];
  const pipeline = new RecordingPipeline(replies);
  const redis = {
    client: {
      pipeline: () => pipeline,
    },
  } as never;
  const config = {
    workerPartitionCount: options.partitionCount,
    workerMembership: options.membership,
    workerPartitionLeaseTtlMs: 15_000,
  } as never;
  return { service: new WorkerCoordinationReadService(config, redis), pipeline };
}

const KEY_PREFIX = 'wlct:trading:lock:partition:trade-execution';

describe('WorkerCoordinationReadService', () => {
  it('reads the exact claim keys the worker writes, in partition order', async () => {
    const { service, pipeline } = harness({
      partitionCount: 2,
      membership: ['worker-alpha'],
      replies: [
        [null, 'worker-alpha'],
        [null, 12_000],
        [null, 'worker-alpha'],
        [null, 9_000],
      ],
    });
    const view = await service.readState();
    expect(pipeline.calls).toEqual([
      { verb: 'get', key: `${KEY_PREFIX}:0` },
      { verb: 'pttl', key: `${KEY_PREFIX}:0` },
      { verb: 'get', key: `${KEY_PREFIX}:1` },
      { verb: 'pttl', key: `${KEY_PREFIX}:1` },
      // Part 12 appended the membership read, LAST, so the per-partition
      // reply indices above never shifted - and it is still just a read.
      {
        verb: 'zrange',
        key: 'wlct:trading:coord:members:trade-execution',
        extra: ['WITHSCORES'],
      },
    ]);
    expect(view.claimedCount).toBe(2);
    expect(view.partitions[0]?.remainingTtlMs).toBe(12_000);
    expect(view.coordinationGroup).toBe('trade-execution');
  });

  it('flags a holder that is not the config-expected owner', async () => {
    const { service } = harness({
      partitionCount: 2,
      membership: ['worker-alpha', 'worker-beta'],
      replies: [
        [null, 'worker-stray'], // whatever partition 0 expects, this is not it
        [null, 500],
        [null, null], // expired / never claimed
        [null, -2],
      ],
    });
    const view = await service.readState();
    expect(view.misalignedCount).toBe(1);
    expect(view.claimedCount).toBe(1);
    const first = view.partitions[0];
    expect(first?.holderMatchesExpectation).toBe(false);
    expect(first?.holderMemberId).toBe('worker-stray');
  });

  it('an unclaimed partition is reported as absent, never as a dead worker', async () => {
    const { service } = harness({
      partitionCount: 1,
      membership: ['worker-alpha'],
      replies: [[null, null], [null, -2]],
    });
    const view = await service.readState();
    const only = view.partitions[0];
    expect(only?.claimExists).toBe(false);
    expect(only?.holderMemberId).toBeNull();
    expect(only?.holderMatchesExpectation).toBeNull();
    expect(view.note).toMatch(/does not prove a worker died/);
  });

  it('reads the membership zset and applies the workers\' staleness law', async () => {
    const future = Date.now() + 30_000;
    const past = Date.now() - 1;
    const { service, pipeline } = harness({
      partitionCount: 1,
      membership: ['worker-alpha'],
      replies: [[null, 'worker-alpha'], [null, 14_000]],
      registry: ['worker-alpha', String(future), 'worker-gone', String(past)],
    });
    const view = await service.readState();
    expect(pipeline.calls.at(-1)).toEqual({
      verb: 'zrange',
      key: 'wlct:trading:coord:members:trade-execution',
      extra: ['WITHSCORES'],
    });
    expect(view.registryKey).toBe('wlct:trading:coord:members:trade-execution');
    // RAW list keeps the expired entry (the read never prunes - the next
    // ping does); the live list is the law applied at read time.
    expect(view.registryMembers).toEqual([
      { memberId: 'worker-alpha', expiryEpochMs: future },
      { memberId: 'worker-gone', expiryEpochMs: past },
    ]);
    expect(view.registryLiveMembers).toEqual(['worker-alpha']);
  });

  it('reads an absent registry as empty-but-known, and garbage as unreadable', async () => {
    const garbage = harness({
      partitionCount: 1,
      membership: ['worker-alpha'],
      replies: [[null, null], [null, -2]],
      registry: ['worker-alpha'], // odd length: the protocol says pairs
    });
    const garbageView = await garbage.service.readState();
    // Null, not empty: "unreadable protocol garbage" and "nobody home"
    // are different facts and must never render the same way.
    expect(garbageView.registryMembers).toBeNull();
    expect(garbageView.registryLiveMembers).toBeNull();

    const emptyView = await harness({
      partitionCount: 1,
      membership: ['worker-alpha'],
      replies: [[null, null], [null, -2]],
    }).service.readState();
    expect(emptyView.registryMembers).toEqual([]);
    expect(emptyView.registryLiveMembers).toEqual([]);
  });

  it('a null pipeline reply array degrades to all-absent instead of throwing', async () => {
    const redis = {
      client: {
        pipeline: () => ({
          get: () => undefined,
          pttl: () => undefined,
          zrange: () => undefined,
          exec: async () => null,
        }),
      },
    } as never;
    const config = {
      workerPartitionCount: 2,
      workerMembership: ['worker-alpha'],
      workerPartitionLeaseTtlMs: 15_000,
    } as never;
    const service = new WorkerCoordinationReadService(config, redis);
    const view = await service.readState();
    expect(view.claimedCount).toBe(0);
    expect(view.partitions).toHaveLength(2);
  });

  it('the empty-membership deployment reports no expectations rather than false alarms', async () => {
    const { service } = harness({
      partitionCount: 1,
      membership: [],
      replies: [
        [null, 'worker-alpha'],
        [null, 1000],
      ],
    });
    const view = await service.readState();
    expect(view.membershipConfigured).toEqual([]);
    const only = view.partitions[0];
    expect(only?.expectedOwnerMemberId).toBeNull();
    expect(only?.holderMatchesExpectation).toBeNull();
    expect(view.misalignedCount).toBe(0);
  });
});
