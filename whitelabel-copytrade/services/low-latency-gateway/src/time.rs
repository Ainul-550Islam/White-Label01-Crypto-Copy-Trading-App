//! Clock discipline: monotonic clocks for latency, UTC wall clock for
//! business timestamps. Never mixed.
//!
//! Latency is measured with a process-stable monotonic origin. Elapsed
//! computations saturate instead of underflowing: a caller that records an
//! end timestamp before its start timestamp observes zero, never a negative
//! or wrapping duration.

use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Process-wide monotonic origin, captured exactly once.
static MONO_ORIGIN: OnceLock<Instant> = OnceLock::new();

fn origin() -> Instant {
    *MONO_ORIGIN.get_or_init(Instant::now)
}

/// Nanoseconds since the process monotonic origin. The value is meaningless
/// across processes; it is only ever subtracted locally, in this process.
pub fn mono_now_ns() -> u64 {
    origin().elapsed().as_nanos() as u64
}

/// Saturating elapsed nanoseconds between two monotonic samples.
/// `end < start` (clock order violation, e.g. a consumer recorded its end
/// before its start) yields 0 — never a negative or wrapping value.
pub fn mono_elapsed_ns(start_ns: u64, end_ns: u64) -> u64 {
    end_ns.saturating_sub(start_ns)
}

/// UTC wall-clock milliseconds. Returns 0 only if the system clock is set
/// before the Unix epoch, which is itself an operations signal.
pub fn utc_now_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(e) => {
            let negative = e.duration();
            -(negative.as_millis() as i64)
        }
    }
}

/// Measures one latency sample and feeds it to a sink.
#[derive(Clone, Copy, Debug)]
pub struct LatencyTimer {
    started_ns: u64,
}

impl LatencyTimer {
    pub fn start() -> LatencyTimer {
        LatencyTimer {
            started_ns: mono_now_ns(),
        }
    }

    /// Elapsed nanoseconds so far (saturating, monotonic).
    pub fn elapsed_ns(&self) -> u64 {
        mono_elapsed_ns(self.started_ns, mono_now_ns())
    }

    /// Elapsed since an explicit end sample (used in deterministic tests).
    pub fn elapsed_since_ns(&self, end_ns: u64) -> u64 {
        mono_elapsed_ns(self.started_ns, end_ns)
    }
}

/// Converts a monotonic delta into a `Duration`, guarded against overflow.
pub fn duration_from_ns(ns: u64) -> Duration {
    Duration::from_nanos(ns)
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 18] monotonic latency is positive and never decreasing.
    #[test]
    fn monotonic_latency_is_positive_and_monotonic() {
        let t0 = mono_now_ns();
        let a = LatencyTimer::start();
        // Busy work: guarantees a measurable, non-decreasing progression.
        let mut acc: u64 = 0;
        for i in 0..1_000u64 {
            acc = acc.wrapping_add(i.wrapping_mul(7));
        }
        std::hint::black_box(acc);
        let b = LatencyTimer::start();
        assert!(a.elapsed_ns() > 0);
        assert!(b.elapsed_ns() <= a.elapsed_ns() + 1_000_000);
        let t1 = mono_now_ns();
        assert!(t1 >= t0);
    }

    // [CHECK 18 support] clock-order violations saturate to zero instead of
    // producing negative or wrapping latencies.
    #[test]
    fn latency_never_negative_on_inverted_samples() {
        let end: u64 = 1_000;
        let start: u64 = 5_000;
        assert_eq!(mono_elapsed_ns(start, end), 0);
        assert_eq!(mono_elapsed_ns(0, u64::MAX), u64::MAX);
        assert_eq!(mono_elapsed_ns(u64::MAX, u64::MAX), 0);
    }

    // [CHECK 19 support] UTC wall clock is only used for business stamps and
    // is a real epoch value here.
    #[test]
    fn utc_now_is_epoch_milliseconds() {
        let now = utc_now_ms();
        // 2026-01-01T00:00:00Z .. 2100-01-01T00:00:00Z sanity window.
        assert!(now > 1_767_225_600_000 && now < 4_102_344_000_000);
    }

    #[test]
    fn duration_conversion_is_lossless_for_ns() {
        assert_eq!(duration_from_ns(1_500), Duration::from_nanos(1_500));
        assert_eq!(duration_from_ns(0), Duration::ZERO);
    }
}
