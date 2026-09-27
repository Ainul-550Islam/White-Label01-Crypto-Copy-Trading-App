/**
 * Part 10 sample-bucket behaviour: the Redis key/tick/window arithmetic
 * the evaluator stands on. Everything here is clock-deterministic - the
 * helpers take `nowMillis` explicitly precisely so the tests can pin the
 * open-bucket exclusion the production path depends on.
 */

import {
  SloSamplesService,
  currentBucketIndex,
  sloBucketKey,
} from './slo-samples';
import { SloIndicator } from '@wlct/shared-types';

class FakePipeline {
  constructor(
    private readonly store: Map<string, Map<string, number>>,
    private readonly ops: Array<() => void | Promise<unknown>>,
    private readonly reads: Array<() => unknown>,
  ) {}

  hincrby(key: string, field: string, by: number): void {
    this.ops.push(() => {
      const hash = this.store.get(key) ?? new Map<string, number>();
      hash.set(field, (hash.get(field) ?? 0) + by);
      this.store.set(key, hash);
    });
  }

  pexpire(key: string, ms: number): void {
    this.ops.push(() => {
      this.ttls.set(key, ms);
    });
  }

  hgetall(key: string): void {
    this.reads.push(() => {
      const hash = this.store.get(key);
      if (hash === undefined) {
        return [null, null];
      }
      const row: Record<string, string> = {};
      for (const [field, value] of hash) {
        row[field] = String(value);
      }
      return [null, row];
    });
  }

  readonly ttls = new Map<string, number>();

  async exec(): Promise<Array<[Error | null, unknown]>> {
    for (const op of this.ops) {
      op();
    }
    return this.reads.map((read) => read() as [Error | null, unknown]);
  }
}

class FakeRedisService {
  readonly store = new Map<string, Map<string, number>>();
  readonly pipelines: FakePipeline[] = [];
  failWrites = false;

  readonly client = {
    pipeline: () => {
      const ops: Array<() => void> = [];
      const reads: Array<() => unknown> = [];
      const pipe = new FakePipeline(this.store, ops, reads);
      if (this.failWrites) {
        pipe.exec = async () => {
          throw new Error('redis down');
        };
      }
      this.pipelines.push(pipe);
      return pipe;
    },
  };
}

const NOW = 1_700_000_400_000; // bucket-aligned-ish fixed clock
const bucketOf = (offsetMillis = 0) => currentBucketIndex(NOW + offsetMillis);

const serviceWith = (): { service: SloSamplesService; redis: FakeRedisService } => {
  const redis = new FakeRedisService();
  const service = new SloSamplesService(redis as unknown as never);
  return { service, redis };
};

describe('bucket addressing', () => {
  it('floor-aligns ten-minute buckets with the shared prefix', () => {
    const index = bucketOf();
    const key = sloBucketKey('apiavail', index);
    expect(key.split(':')[4]).toBe('apiavail');
    expect(Number(key.split(':')[5])).toBe(Math.floor(NOW / 600_000));
    // Bucket index is floor division, so any instant inside a bucket maps
    // to the same key, and the NEXT bucket is exactly one step away.
    expect(currentBucketIndex(NOW + 599_999)).toBe(index);
    expect(currentBucketIndex(NOW + 600_000)).toBe(index + 1);
  });
});

describe('recordTick / recordCounters', () => {
  it('writes ticks + one verdict + TTL in one pipeline', async () => {
    const { service, redis } = serviceWith();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      await service.recordTick('apiavail', true);
      const pipe = redis.pipelines[0];
      const key = sloBucketKey('apiavail', bucketOf());
      const hash = redis.store.get(key);
      expect(hash?.get('ticks')).toBe(1);
      expect(hash?.get('good')).toBe(1);
      expect(hash?.get('bad')).toBeUndefined();
      expect(pipe.ttls.get(key)).toBe(2 * 7 * 86_400_000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('carries latency extras as parallel increments on the same bucket', async () => {
    const { service, redis } = serviceWith();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      await service.recordTick('apilat', false, {
        extra: { total: 1, le250ms: 0, le500ms: 1 },
      });
      const hash = redis.store.get(sloBucketKey('apilat', bucketOf()));
      expect(hash?.get('bad')).toBe(1);
      expect(hash?.get('total')).toBe(1);
      // Zero-valued grid boundaries are NOT written: cumulative histogram
      // fields only ever grow, and a hash full of zeros is 6x the memory
      // for information parseRow already infers from absence.
      expect(hash?.get('le250ms')).toBeUndefined();
      expect(hash?.get('le500ms')).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('recordCounters folds batched deltas without touching ticks', async () => {
    const { service, redis } = serviceWith();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      await service.recordCounters('engineerr', 7, 2);
      const hash = redis.store.get(sloBucketKey('engineerr', bucketOf()));
      expect(hash?.get('good')).toBe(7);
      expect(hash?.get('bad')).toBe(2);
      expect(hash?.get('ticks')).toBeUndefined(); // event-shaped sources
    } finally {
      jest.useRealTimers();
    }
  });

  it('a Redis write failure propagates to the awaiting collector', async () => {
    const { service, redis } = serviceWith();
    redis.failWrites = true;
    await expect(service.recordTick('apiavail', true)).rejects.toThrow('redis down');
  });
});

describe('window reading', () => {
  const seed = (
    redis: FakeRedisService,
    source: string,
    indexes: number[],
    fields: Record<string, number>,
  ): void => {
    for (const index of indexes) {
      const key = sloBucketKey(source, index);
      const hash = redis.store.get(key) ?? new Map<string, number>();
      for (const [field, value] of Object.entries(fields)) {
        hash.set(field, (hash.get(field) ?? 0) + value);
      }
      redis.store.set(key, hash);
    }
  };

  it('excludes the open bucket from a complete window', async () => {
    const { service, redis } = serviceWith();
    const now = bucketOf() * 600_000 + 5; // five ms into the OPEN bucket
    // The six CLOSED buckets hold a perfect tick record; the open bucket
    // holds a burst that must NOT leak into the window read.
    seed(redis, 'apiavail', [0, 1, 2, 3, 4, 5].map((k) => bucketOf() - 6 + k), {
      ticks: 2,
      good: 2,
    });
    seed(redis, 'apiavail', [bucketOf()], { ticks: 500, bad: 500 });
    const window = await service.readWindow(SloIndicator.AVAILABILITY, 60, now);
    expect(window.good).toBe(12);
    expect(window.bad).toBe(0);
    expect(window.dataComplete).toBe(true);
  });

  it('short windows report incompleteness instead of optimism', async () => {
    const { service, redis } = serviceWith();
    const now = bucketOf() * 600_000;
    seed(redis, 'apiavail', [bucketOf() - 6, bucketOf() - 5], { ticks: 1, good: 1 });
    const window = await service.readWindow(SloIndicator.AVAILABILITY, 60, now);
    expect(window.dataComplete).toBe(false);
    expect(window.note).toContain('collector saw 2/12 expected ticks');
    expect(window.note).toContain('window read 2/6 buckets');
  });

  it('event-shaped sources read complete, and say so when silent', async () => {
    const { service, redis } = serviceWith();
    const now = bucketOf() * 600_000;
    const empty = await service.readWindow(SloIndicator.ERROR_RATE_COMPLIANCE, 30, now);
    expect(empty.dataComplete).toBe(true);
    expect(empty.note).toContain('no events recorded in window');

    seed(redis, 'engineerr', [bucketOf() - 3, bucketOf() - 2, bucketOf() - 1], {
      good: 9,
      bad: 1,
    });
    const filled = await service.readWindow(SloIndicator.ERROR_RATE_COMPLIANCE, 30, now);
    expect(filled.good).toBe(27);
    expect(filled.bad).toBe(3);
    expect(filled.note).toBeNull();
  });

  it('latency compliance snaps to the largest grid boundary at or below the threshold', async () => {
    const { service, redis } = serviceWith();
    const now = bucketOf() * 600_000;
    seed(
      redis,
      'apilat',
      [bucketOf() - 3, bucketOf() - 2, bucketOf() - 1],
      { total: 10, le250ms: 4, le500ms: 7, le1000ms: 9 },
    );
    // A 750ms threshold has no bucket: compliance is READ AT 500ms, and
    // the note must own up to the resulting overstatement.
    const snapped = await service.readLatencyWindow(30, 750_000n, now);
    expect(snapped.good).toBe(21);
    expect(snapped.bad).toBe(9);
    expect(snapped.note).toContain('(floor)');
    // An exact boundary (500ms) reads clean with no apology.
    const exact = await service.readLatencyWindow(30, 500_000n, now);
    expect(exact.good).toBe(21);
    expect(exact.note ?? '').not.toContain('(floor)');
  });
});
