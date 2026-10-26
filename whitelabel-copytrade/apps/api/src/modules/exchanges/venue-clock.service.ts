// # Estimates the venue clock offset from bounded round-trip samples (median of the last N), rejects slow samples, and marks the venue TIMESTAMP_UNSAFE - blocking signed requests - beyond the maximum allowed skew.
import { Injectable } from '@nestjs/common';

/**
 * Signed exchange requests carry a timestamp, and every venue rejects one that
 * is too far from its own clock (Binance: 5 s, Bybit: 5 s, OKX: 30 s, Kraken:
 * 60 s). A drifting container therefore does not degrade gracefully - every
 * order starts coming back as an authentication error, which reads like a
 * credential problem and sends support down the wrong path for an hour.
 *
 * The estimator here is deliberately the boring one:
 *
 *   offset_i = venueTime_i - (t0_i + rtt_i / 2)
 *
 * `t0` is taken with a monotonic clock, so a wall-clock jump during a sync
 * cannot move the measurement. Samples whose round trip is longer than the
 * bound are discarded (a 3-second RTT says nothing about the venue; it says the
 * network is unwell). The estimate is the MEDIAN of the last N accepted
 * samples, which is what makes a single outlier unable to move it, and the
 * result is integer milliseconds - no floats, because this number ends up
 * inside a signed string.
 *
 * Beyond `maxSkewMs` the venue is TIMESTAMP_UNSAFE and `allowsSignedRequest()`
 * returns false. It recovers by itself: one good sample after the drift is gone
 * clears the state. Nothing here is latched, because a latched clock failure is
 * an outage that outlives its cause.
 */

export type VenueClockSafety = 'UNSYNCED' | 'SYNCED' | 'TIMESTAMP_UNSAFE';

export interface VenueClockSample {
  /** Monotonic milliseconds at send. */
  sentAtMonotonicMs: number;
  /** Monotonic milliseconds at receive. */
  receivedAtMonotonicMs: number;
  /** The venue's server time, in milliseconds since epoch. */
  venueTimeMs: number;
  /** Wall-clock milliseconds at send, used only to anchor the offset to a date. */
  sentAtWallMs: number;
}

export interface VenueClockState {
  venue: string;
  safety: VenueClockSafety;
  /** Median offset in whole milliseconds: venue clock minus local clock. */
  offsetMs: number | null;
  /** Samples currently backing the estimate. */
  sampleCount: number;
  /** Samples discarded in the last evaluation (RTT above the bound). */
  rejectedSamples: number;
  lastSampleAt: string | null;
  reasonCode: string;
}

export const VENUE_CLOCK_WINDOW = 7;
export const VENUE_CLOCK_MAX_RTT_MS = 2_000;
export const VENUE_CLOCK_MAX_SKEW_MS = 2_000;
/** After this long without a good sample the estimate is not evidence any more. */
export const VENUE_CLOCK_STALE_MS = 5 * 60_000;

/** Integer median. Even counts take the lower of the two middle values. */
export function medianOffset(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].map((value) => Math.round(value)).sort((a, b) => a - b);
  const middle = Math.floor((sorted.length - 1) / 2);
  return sorted[middle];
}

/** Per-sample offset, or null when the sample is unusable. */
export function sampleOffsetMs(sample: VenueClockSample, maxRttMs: number = VENUE_CLOCK_MAX_RTT_MS): number | null {
  const rtt = sample.receivedAtMonotonicMs - sample.sentAtMonotonicMs;
  if (!Number.isFinite(rtt) || rtt < 0) return null;
  if (rtt > maxRttMs) return null;
  if (!Number.isFinite(sample.venueTimeMs) || !Number.isFinite(sample.sentAtWallMs)) return null;
  // Half the round trip is the one-way latency estimate; integer division, so
  // the offset never gains a fraction it cannot justify.
  const oneWay = Math.floor(rtt / 2);
  return Math.round(sample.venueTimeMs - (sample.sentAtWallMs + oneWay));
}

@Injectable()
export class VenueClockService {
  private readonly samples = new Map<string, VenueClockSample[]>();

  /** Record one observation. Returns the state after the observation. */
  record(venue: string, sample: VenueClockSample, now: Date = new Date()): VenueClockState {
    const offset = sampleOffsetMs(sample);
    const accepted = this.samples.get(venue) ?? [];
    let rejected = 0;
    if (offset === null) {
      rejected = 1;
    } else {
      accepted.push(sample);
      // Keep the newest N; the window is what bounds the median's inertia.
      while (accepted.length > VENUE_CLOCK_WINDOW) accepted.shift();
      this.samples.set(venue, accepted);
    }
    return this.state(venue, now, rejected);
  }

  /** Current state for a venue, without recording anything. */
  state(venue: string, now: Date = new Date(), rejectedSamples = 0): VenueClockState {
    const samples = this.samples.get(venue) ?? [];
    const offsets = samples
      .map((sample) => sampleOffsetMs(sample))
      .filter((value): value is number => value !== null);
    if (offsets.length === 0) {
      return {
        venue,
        safety: 'UNSYNCED',
        offsetMs: null,
        sampleCount: 0,
        rejectedSamples,
        lastSampleAt: null,
        reasonCode: 'NO_SAMPLES',
      };
    }
    const offsetMs = medianOffset(offsets);
    const lastSample = samples[samples.length - 1];
    // The sample is stamped with the WALL time at which it was taken. Using the
    // receive-side monotonic delta here would make "how old is this measurement"
    // depend on how slow the request was, which is the wrong question: the
    // measurement is as old as the moment it started.
    const lastSampleAt = new Date(Number.isFinite(lastSample.sentAtWallMs) ? lastSample.sentAtWallMs : now.getTime()).toISOString();
    const ageMs = now.getTime() - Date.parse(lastSampleAt);
    if (!Number.isFinite(ageMs) || ageMs > VENUE_CLOCK_STALE_MS) {
      return {
        venue,
        safety: 'UNSYNCED',
        offsetMs,
        sampleCount: offsets.length,
        rejectedSamples,
        lastSampleAt,
        reasonCode: 'SAMPLES_STALE',
      };
    }
    if (offsetMs === null || Math.abs(offsetMs) > VENUE_CLOCK_MAX_SKEW_MS) {
      return {
        venue,
        safety: 'TIMESTAMP_UNSAFE',
        offsetMs,
        sampleCount: offsets.length,
        rejectedSamples,
        lastSampleAt,
        reasonCode: 'OFFSET_BEYOND_MAX_SKEW',
      };
    }
    return {
      venue,
      safety: 'SYNCED',
      offsetMs,
      sampleCount: offsets.length,
      rejectedSamples,
      lastSampleAt,
      reasonCode: 'WITHIN_MAX_SKEW',
    };
  }

  /**
   * The gate a signed request passes through.
   *
   * Fails closed on UNSYNCED as well as TIMESTAMP_UNSAFE: "we have no recent
   * measurement" is not the same as "the clock is fine", and a signed request
   * with an unmeasured clock is exactly the request that comes back 401.
   */
  allowsSignedRequest(venue: string, now: Date = new Date()): boolean {
    return this.state(venue, now).safety === 'SYNCED';
  }

  /** The timestamp a signed request should carry: local time corrected by the median offset. */
  correctedTimestampMs(venue: string, localNowMs: number = Date.now(), now: Date = new Date()): number {
    const state = this.state(venue, now);
    if (state.safety !== 'SYNCED' || state.offsetMs === null) {
      throw new Error(`Venue clock is ${state.safety} for ${venue}; a signed request must not be built`);
    }
    return Math.round(localNowMs + state.offsetMs);
  }

  /** Test/ops helper: forget one venue's samples after a credential or region change. */
  reset(venue?: string): void {
    if (venue === undefined) this.samples.clear();
    else this.samples.delete(venue);
  }
}
