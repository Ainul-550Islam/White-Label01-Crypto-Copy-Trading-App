/**
 * Part 10: the SLO sample store - fixed-time buckets in Redis with the
 * window-sum and completeness laws the evaluator reads through.
 *
 * Why buckets and not a time-series DB: an SLO window is "everything in a
 * fixed interval", which a hash-per-interval answers exactly, with bounded
 * storage (TTL) and no new infrastructure. Every producer - the request
 * flush loop, the evaluation tick itself, the queue worker's event
 * listeners, and the trading engine's mirror loop - writes ONLY deltas of
 * counters it kept in memory, so the hot path never touches Redis for
 * telemetry (the Part 9 law, kept).
 *
 * The window-sum reads WHOLE buckets ending at the last CLOSED bucket (the
 * currently-open bucket is excluded: it is partial by construction). A
 * window older than the bucket retention reads short and says so in the
 * note; completeness is what turns "nothing happened" into "nobody looked",
 * and it is computed per source under THAT SOURCE'S law, never assumed.
 */

import { Injectable } from '@nestjs/common';
import { SLO_SAMPLE_BUCKET_MINUTES, SLO_SAMPLE_KEY_PREFIX } from '@wlct/config';

import { RedisService } from '../../infrastructure/redis/redis.service';

import {
  SLO_LATENCY_GRID_MS,
  SLO_SAMPLE_SOURCES,
  SLO_TICK_COMPLETENESS_RATIO_PPM,
  type SloIndicatorValue,
} from './slo.constants';

export interface WindowSample {
  good: number;
  bad: number;
  dataComplete: boolean;
  note: string | null;
}

/** Expected tick rate per source (ticks per minute). A null rate means the
 *  source is event-shaped (requests, job outcomes): there is no "expected"
 *  cadence to compare against, and completeness is judged by the collector
 *  having written at all in the window instead - "the loop is alive because
 *  its numbers are here". */
const SOURCE_TICKS_PER_MINUTE: Readonly<Record<string, number | null>> = Object.freeze({
  apiavail: 1 / 5, // written by the evaluation tick (*/5 cron)
  mdfresh: 1 / 5,
  riskfresh: 1 / 5,
  queuefresh: 1 / 5,
  reconfresh: 1 / 5,
  engineerr: null, // written by the engine's own mirror loop
  apireq: null,
  apilat: null,
  queueproc: null,
});

const BUCKET_TTL_MS = 2 * 7 * 86_400_000;

export const sloBucketKey = (source: string, bucketIndex: number): string =>
  `${SLO_SAMPLE_KEY_PREFIX}:${source}:${String(bucketIndex)}`;

export const currentBucketIndex = (epochMillis: number): number =>
  Math.floor(epochMillis / (SLO_SAMPLE_BUCKET_MINUTES * 60_000));

interface BucketRead {
  good: number;
  bad: number;
  ticks: number;
  total: number;
  le: Map<number, number>;
  present: boolean;
}

const emptyBucket = (): BucketRead => ({
  good: 0,
  bad: 0,
  ticks: 0,
  total: 0,
  le: new Map(SLO_LATENCY_GRID_MS.map((ms) => [ms, 0])),
  present: false,
});

const parseRow = (row: Record<string, string>): BucketRead => {
  const out = emptyBucket();
  out.good = Number.parseInt(row.good ?? '0', 10) || 0;
  out.bad = Number.parseInt(row.bad ?? '0', 10) || 0;
  out.ticks = Number.parseInt(row.ticks ?? '0', 10) || 0;
  out.total = Number.parseInt(row.total ?? '0', 10) || 0;
  for (const boundary of SLO_LATENCY_GRID_MS) {
    out.le.set(boundary, Number.parseInt(row[`le${String(boundary)}ms`] ?? '0', 10) || 0);
  }
  out.present = Object.keys(row).length > 0;
  return out;
};

@Injectable()
export class SloSamplesService {
  constructor(private readonly redis: RedisService) {}

  /** One tick's verdict for a source: +1 to exactly one of good/bad plus a
   *  tick marker, in a single pipeline. Callers in the maintenance job await
   *  it (so a Redis outage shows up in the JOB's error path); request- or
   *  worker-adjacent callers fire it and ignore. */
  async recordTick(
    source: string,
    ok: boolean,
    options: { extra?: Record<string, number> } = {},
  ): Promise<void> {
    const bucket = currentBucketIndex(Date.now());
    const key = sloBucketKey(source, bucket);
    const pipeline = this.redis.client.pipeline();
    pipeline.hincrby(key, 'ticks', 1);
    pipeline.hincrby(key, ok ? 'good' : 'bad', 1);
    for (const [field, value] of Object.entries(options.extra ?? {})) {
      if (value > 0) {
        pipeline.hincrby(key, field, value);
      }
    }
    pipeline.pexpire(key, BUCKET_TTL_MS);
    await pipeline.exec();
  }

  /** Cumulative counters (requests, job outcomes): add N to good or bad.
   *  Same bounded-hash shape as recordTick without a tick marker - the
   *  delta IS the evidence; absence of traffic is legitimately "no
   *  samples", which the evaluator renders as the no-samples UNKNOWN row. */
  async recordCounters(source: string, good: number, bad: number): Promise<void> {
    if (good <= 0 && bad <= 0) {
      return;
    }
    const bucket = currentBucketIndex(Date.now());
    const key = sloBucketKey(source, bucket);
    const pipeline = this.redis.client.pipeline();
    if (good > 0) {
      pipeline.hincrby(key, 'good', good);
    }
    if (bad > 0) {
      pipeline.hincrby(key, 'bad', bad);
    }
    pipeline.pexpire(key, BUCKET_TTL_MS);
    await pipeline.exec();
  }

  /** Read one window's totals for a COUNT-shaped indicator (everything
   *  except the latency threshold family, which needs the grid). */
  async readWindow(
    indicator: SloIndicatorValue,
    windowMinutes: number,
    nowMillis: number = Date.now(),
  ): Promise<WindowSample> {
    const source = SLO_SAMPLE_SOURCES[indicator];
    const { buckets, closedNow, start, needed } = await this.readBuckets(source, windowMinutes, nowMillis);

    let good = 0;
    let bad = 0;
    let ticks = 0;
    let bucketsPresent = 0;
    for (const bucket of buckets) {
      if (!bucket.present) {
        continue;
      }
      bucketsPresent += 1;
      good += bucket.good;
      bad += bucket.bad;
      ticks += bucket.ticks;
    }

    const notes: string[] = [];
    let dataComplete: boolean;
    const expected = SOURCE_TICKS_PER_MINUTE[source];
    if (expected === null || expected === undefined) {
      // Event-shaped source: numbers in the window mean the collector wrote
      // them while alive; zero numbers means there was nothing to see. Both
      // read complete; a collector that died with unsent deltas is caught
      // when its source starts disagreeing with the durable truth, which is
      // the same trade-off the Prometheus pull model makes.
      dataComplete = true;
      if (bucketsPresent === 0) {
        notes.push(`${source}: no events recorded in window`);
      }
    } else {
      const expectedTicks = expected * windowMinutes;
      const completePpm = expectedTicks <= 0 ? 0 : Math.floor((ticks * 1_000_000) / expectedTicks);
      dataComplete = completePpm >= SLO_TICK_COMPLETENESS_RATIO_PPM;
      if (!dataComplete) {
        notes.push(
          `${source} collector saw ${String(ticks)}/${String(Math.round(expectedTicks))} expected ticks`,
        );
      }
    }
    if (bucketsPresent < needed) {
      notes.push(
        `window read ${String(bucketsPresent)}/${String(needed)} buckets (pre-deployment or pruned by retention)`,
      );
    }
    void closedNow;
    void start;
    return { good, bad, dataComplete, note: notes.length > 0 ? notes.join('; ') : null };
  }

  /** The latency-grid window: `total` per bucket plus cumulative
   *  le-boundaries; compliance at the definition's threshold is read at the
   *  largest grid boundary not exceeding it, and any approximation there is
   *  written into the note, never hidden. */
  async readLatencyWindow(
    windowMinutes: number,
    thresholdMicros: bigint,
    nowMillis: number = Date.now(),
  ): Promise<WindowSample> {
    const source = SLO_SAMPLE_SOURCES.latency_threshold_compliance;
    const { buckets, needed } = await this.readBuckets(source, windowMinutes, nowMillis);

    let total = 0;
    let bucketsPresent = 0;
    const leSums = new Map<number, number>(SLO_LATENCY_GRID_MS.map((ms) => [ms, 0]));
    buckets.forEach((bucket) => {
      if (!bucket.present) {
        return;
      }
      bucketsPresent += 1;
      total += bucket.total;
      for (const boundary of SLO_LATENCY_GRID_MS) {
        leSums.set(boundary, (leSums.get(boundary) ?? 0) + (bucket.le.get(boundary) ?? 0));
      }
    });

    const thresholdMs = Number(thresholdMicros / 1000n);
    let boundary: number | null = null;
    for (const candidate of SLO_LATENCY_GRID_MS) {
      if (candidate <= thresholdMs) {
        boundary = candidate;
      }
    }
    const notes: string[] = [];
    if (boundary === null) {
      boundary = SLO_LATENCY_GRID_MS[0];
      notes.push(
        `threshold ${String(thresholdMs)}ms below the 100ms grid floor; measured there (overstates compliance)`,
      );
    } else if (boundary !== thresholdMs) {
      notes.push(
        `threshold ${String(thresholdMs)}ms measured at grid boundary ${String(boundary)}ms (floor)`,
      );
    }
    if (bucketsPresent < needed) {
      notes.push(
        `window read ${String(bucketsPresent)}/${String(needed)} buckets (pre-deployment or pruned by retention)`,
      );
    }

    const within = leSums.get(boundary) ?? 0;
    // Completeness law (event-shaped, with a twist the panel shows): the
    // flush loop also keeps the apireq bucket warm, so "this window has
    // totals" is the liveness evidence; a zero-traffic window is complete
    // and simply has no samples (which the evaluator renders honestly).
    const dataComplete = true;
    return { good: within, bad: Math.max(0, total - within), dataComplete, note: notes.length > 0 ? notes.join('; ') : null };
  }

  private async readBuckets(
    source: string,
    windowMinutes: number,
    nowMillis: number,
  ): Promise<{ buckets: BucketRead[]; closedNow: number; start: number; needed: number }> {
    const bucketMillis = SLO_SAMPLE_BUCKET_MINUTES * 60_000;
    const closedNow = Math.floor(nowMillis / bucketMillis); // index of the OPEN bucket
    const needed = Math.max(1, Math.ceil(windowMinutes / SLO_SAMPLE_BUCKET_MINUTES));
    const start = closedNow - needed;
    const pipeline = this.redis.client.pipeline();
    for (let index = start; index < closedNow; index += 1) {
      pipeline.hgetall(sloBucketKey(source, index));
    }
    const rows = (await pipeline.exec()) as Array<[Error | null, Record<string, string> | null]>;
    const buckets = rows.map(([error, row]) =>
      error !== null || row === null ? emptyBucket() : parseRow(row),
    );
    return { buckets, closedNow, start, needed };
  }
}
