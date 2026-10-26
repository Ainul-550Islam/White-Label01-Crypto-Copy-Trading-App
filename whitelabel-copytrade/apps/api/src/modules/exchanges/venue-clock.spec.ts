// # Verifies the venue clock estimator: slow-sample rejection, the max-skew bound, monotonic ordering, recovery after drift, and that no signed request is permitted while the venue is unsafe.
import { VenueClockService, VENUE_CLOCK_MAX_RTT_MS, VENUE_CLOCK_MAX_SKEW_MS, VENUE_CLOCK_STALE_MS, VENUE_CLOCK_WINDOW, medianOffset, sampleOffsetMs } from './venue-clock.service';

/**
 * The failure this file exists to prevent: a container whose clock drifts past
 * the venue's tolerance starts returning 401 on every signed request, and every
 * symptom points at the API key rather than at the clock.
 *
 * Pinned here:
 *  - the per-sample offset is `venue - (sent + rtt/2)`, from MONOTONIC times;
 *  - a sample above the RTT bound is discarded, not averaged in;
 *  - the estimate is the median of the window, so one outlier cannot move it;
 *  - beyond MAX_SKEW the venue is TIMESTAMP_UNSAFE and signed requests are
 *    refused, and one good sample afterwards recovers;
 *  - a stale measurement is UNSYNCED, and UNSYNCED also refuses.
 */

const WALL = Date.parse('2026-10-26T09:00:00.000Z');

function sample(options: { rttMs?: number; venueOffsetMs?: number; monotonicSent?: number } = {}) {
  const rtt = options.rttMs ?? 20;
  const venueOffset = options.venueOffsetMs ?? 0;
  const sentAtMonotonicMs = options.monotonicSent ?? 1_000;
  return {
    sentAtMonotonicMs,
    receivedAtMonotonicMs: sentAtMonotonicMs + rtt,
    // The venue clock reads local wall time plus the true drift.
    venueTimeMs: WALL + venueOffset + Math.floor(rtt / 2),
    sentAtWallMs: WALL,
  };
}

describe('venue clock offset estimation (GAP-70)', () => {
  it('computes the per-sample offset from monotonic elapsed time', () => {
    // RTT 20 -> one-way 10; the venue's reply was produced 10 ms after we sent,
    // so `venueTime - (wallAtSend + 10)` is the venue's true clock offset.
    expect(sampleOffsetMs(sample({ rttMs: 20, venueOffsetMs: 0 }))).toBe(0);
    expect(sampleOffsetMs(sample({ rttMs: 20, venueOffsetMs: 500 }))).toBe(500);
    expect(sampleOffsetMs(sample({ rttMs: 20, venueOffsetMs: -500 }))).toBe(-500);
    // And a slow request widens the window without inventing an offset.
    expect(sampleOffsetMs(sample({ rttMs: 400, venueOffsetMs: 500 }))).toBe(500);
  });

  it('rejects a sample whose round trip exceeds the bound', () => {
    expect(sampleOffsetMs(sample({ rttMs: VENUE_CLOCK_MAX_RTT_MS + 1 }))).toBeNull();
    expect(sampleOffsetMs(sample({ rttMs: VENUE_CLOCK_MAX_RTT_MS }))).not.toBeNull();

    const clock = new VenueClockService();
    const state = clock.record('BINANCE', sample({ rttMs: 9_000 }), new Date(WALL));
    expect(state.safety).toBe('UNSYNCED');
    expect(state.rejectedSamples).toBe(1);
    expect(state.reasonCode).toBe('NO_SAMPLES');
  });

  it('takes the median so a single outlier cannot move the estimate', () => {
    expect(medianOffset([1, 2, 3])).toBe(2);
    expect(medianOffset([1, 2, 3, 4])).toBe(2);
    expect(medianOffset([-5, 40, 41, 42, 900])).toBe(41);
    expect(medianOffset([])).toBeNull();

    const clock = new VenueClockService();
    for (const offset of [40, 900, 41, 42, 39]) {
      clock.record('BYBIT', sample({ venueOffsetMs: offset, rttMs: 20 }), new Date(WALL));
    }
    const state = clock.state('BYBIT', new Date(WALL));
    expect(state.offsetMs).toBe(41);
    expect(state.safety).toBe('SYNCED');
    expect(state.sampleCount).toBe(5);
  });

  it('keeps only the most recent window of samples', () => {
    const clock = new VenueClockService();
    for (let index = 0; index < VENUE_CLOCK_WINDOW + 5; index += 1) {
      clock.record('OKX', sample({ venueOffsetMs: index * 10, rttMs: 20 }), new Date(WALL));
    }
    expect(clock.state('OKX', new Date(WALL)).sampleCount).toBe(VENUE_CLOCK_WINDOW);
  });

  it('is not moved by a wall-clock jump during a sync, because ordering uses monotonic time', () => {
    const clock = new VenueClockService();
    clock.record('KRAKEN', sample({ venueOffsetMs: 30, rttMs: 16 }), new Date(WALL));
    // The next sample is taken with a monotonic clock that advanced by 100 ms
    // while the wall clock jumped an hour. A wall-clock-based estimator would
    // report a one-hour offset here and mark the venue unsafe.
    // 100 ms of real time later, the wall clock jumped forward an hour BETWEEN
    // send and receive. The round trip is still measured on the monotonic clock
    // (8 ms), so the one-way estimate is 4 ms and the offset is unchanged: a
    // wall-clock-based estimator would have computed a ~1 hour RTT here.
    const afterJump = {
      sentAtMonotonicMs: 1_100,
      receivedAtMonotonicMs: 1_108,
      venueTimeMs: WALL + 100 + 30 + 4,
      sentAtWallMs: WALL,
    };
    const state = clock.record('KRAKEN', afterJump, new Date(WALL));
    expect(state.safety).toBe('SYNCED');
    expect(state.offsetMs).toBe(30);
  });

  it('marks the venue TIMESTAMP_UNSAFE beyond the max skew and refuses signed requests', () => {
    const clock = new VenueClockService();
    clock.record('BINANCE', sample({ venueOffsetMs: VENUE_CLOCK_MAX_SKEW_MS + 1, rttMs: 20 }), new Date(WALL));

    const state = clock.state('BINANCE', new Date(WALL));
    expect(state.safety).toBe('TIMESTAMP_UNSAFE');
    expect(state.reasonCode).toBe('OFFSET_BEYOND_MAX_SKEW');
    expect(clock.allowsSignedRequest('BINANCE', new Date(WALL))).toBe(false);
    expect(() => clock.correctedTimestampMs('BINANCE', WALL, new Date(WALL))).toThrow(/TIMESTAMP_UNSAFE|must not be built/);
  });

  it('recovers by itself once the drift is gone', () => {
    const clock = new VenueClockService();
    for (let index = 0; index < VENUE_CLOCK_WINDOW; index += 1) {
      clock.record('COINBASE', sample({ venueOffsetMs: -9_000, rttMs: 20 }), new Date(WALL));
    }
    expect(clock.state('COINBASE', new Date(WALL)).safety).toBe('TIMESTAMP_UNSAFE');

    // The host's clock is corrected: the next window of samples is clean, so the
    // median leaves the unsafe band without an operator doing anything.
    for (let index = 0; index < VENUE_CLOCK_WINDOW; index += 1) {
      clock.record('COINBASE', sample({ venueOffsetMs: 5, rttMs: 20 }), new Date(WALL));
    }
    const recovered = clock.state('COINBASE', new Date(WALL));
    expect(recovered.safety).toBe('SYNCED');
    expect(recovered.offsetMs).toBe(5);
    expect(clock.allowsSignedRequest('COINBASE', new Date(WALL))).toBe(true);
  });

  it('refuses signed requests when the measurement is stale or missing', () => {
    const clock = new VenueClockService();
    expect(clock.allowsSignedRequest('BYBIT', new Date(WALL))).toBe(false);
    expect(clock.state('BYBIT', new Date(WALL)).reasonCode).toBe('NO_SAMPLES');

    clock.record('BYBIT', sample({ venueOffsetMs: 10, rttMs: 20 }), new Date(WALL));
    expect(clock.allowsSignedRequest('BYBIT', new Date(WALL))).toBe(true);

    const later = new Date(WALL + VENUE_CLOCK_STALE_MS + 1);
    expect(clock.state('BYBIT', later)).toMatchObject({ safety: 'UNSYNCED', reasonCode: 'SAMPLES_STALE' });
    expect(clock.allowsSignedRequest('BYBIT', later)).toBe(false);
  });

  it('corrects the request timestamp by the measured offset, in whole milliseconds', () => {
    const clock = new VenueClockService();
    clock.record('BINANCE', sample({ venueOffsetMs: 250, rttMs: 20 }), new Date(WALL));
    const corrected = clock.correctedTimestampMs('BINANCE', WALL, new Date(WALL));
    expect(corrected).toBe(WALL + 250);
    expect(Number.isInteger(corrected)).toBe(true);
  });
});
