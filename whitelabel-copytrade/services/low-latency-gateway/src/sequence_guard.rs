//! Sequence-integrity guard for venue event streams.
//!
//! Venues sequence each stream independently (Binance update ids, Bybit `u`,
//! OKX `seqId`). This guard classifies every incoming sequence against the
//! stream's continuity rules: accepted, duplicate, out-of-order or gap. A
//! gap is never absorbed: it is reported so the order book goes stale and a
//! recovery (fresh snapshot) is triggered. Silence here would be how a
//! corrupt book ends up looking healthy.

use crate::types::Sequence;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SequenceVerdict {
    /// Contiguous next sequence (or the first sequence of a fresh stream).
    Accepted,
    /// Same sequence as the last accepted event: venue redelivery or
    /// reconnect replay. Idempotent handling upstream.
    Duplicate,
    /// Sequence older than the last accepted (not a duplicate).
    OutOfOrder { last: Sequence },
    /// A hole in the stream: `actual > expected`.
    Gap {
        expected: Sequence,
        actual: Sequence,
    },
}

/// Tracks continuity for exactly one stream. Not thread-safe by design: the
/// owning pipeline stage is single-threaded per stream, keeping the hot path
/// lock-free.
#[derive(Debug)]
pub struct SequenceGuard {
    stream: String,
    last: Option<Sequence>,
    pub duplicates_seen: u64,
    pub gaps_seen: u64,
    pub out_of_order_seen: u64,
    pub accepted_seen: u64,
    /// After a reset the guard requires the venue to re-anchor continuity
    /// with a snapshot before deltas can be accepted again.
    awaiting_anchor: bool,
}

impl SequenceGuard {
    pub fn new(stream: impl Into<String>) -> SequenceGuard {
        SequenceGuard {
            stream: stream.into(),
            last: None,
            duplicates_seen: 0,
            gaps_seen: 0,
            out_of_order_seen: 0,
            accepted_seen: 0,
            awaiting_anchor: false,
        }
    }

    /// Classifies one sequence without mutating continuity. `is_anchor`
    /// marks events that legitimately re-anchor a stream (snapshots).
    pub fn verdict(&mut self, sequence: Sequence, is_anchor: bool) -> SequenceVerdict {
        // A snapshot resets the sequence domain: accept it unconditionally
        // and clear any stale/gapped state.
        if is_anchor {
            self.last = Some(sequence);
            self.accepted_seen += 1;
            self.awaiting_anchor = false;
            return SequenceVerdict::Accepted;
        }

        // After a gap or reset the stream MUST be re-anchored by a snapshot
        // before deltas mean anything again.
        if self.awaiting_anchor {
            self.out_of_order_seen += 1;
            return SequenceVerdict::OutOfOrder {
                last: self.last.unwrap_or(0),
            };
        }

        match self.last {
            None => {
                self.last = Some(sequence);
                self.accepted_seen += 1;
                SequenceVerdict::Accepted
            }
            Some(last) => {
                if sequence == last {
                    self.duplicates_seen += 1;
                    SequenceVerdict::Duplicate
                } else if sequence == last + 1 {
                    self.last = Some(sequence);
                    self.accepted_seen += 1;
                    SequenceVerdict::Accepted
                } else if sequence > last + 1 {
                    self.gaps_seen += 1;
                    // Enter the recovery state: deltas are refused until a
                    // fresh snapshot anchors the stream again.
                    self.awaiting_anchor = true;
                    SequenceVerdict::Gap {
                        expected: last + 1,
                        actual: sequence,
                    }
                } else {
                    self.out_of_order_seen += 1;
                    SequenceVerdict::OutOfOrder { last }
                }
            }
        }
    }

    /// Explicit operator/recovery reset: forget continuity entirely. The
    /// next delta will be accepted as a fresh anchor (venues re-anchor via
    /// snapshot; this path exists for reconnect-time recovery orchestration).
    pub fn reset(&mut self) {
        self.last = None;
        self.awaiting_anchor = false;
    }

    pub fn last_sequence(&self) -> Option<Sequence> {
        self.last
    }

    pub fn is_awaiting_anchor(&self) -> bool {
        self.awaiting_anchor
    }

    pub fn stream_name(&self) -> &str {
        &self.stream
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 6] duplicate sequence detected.
    #[test]
    fn duplicates_are_detected() {
        let mut g = SequenceGuard::new("binance:btcusdt:depth");
        assert_eq!(g.verdict(7, false), SequenceVerdict::Accepted);
        assert_eq!(g.verdict(7, false), SequenceVerdict::Duplicate);
        assert_eq!(g.duplicates_seen, 1);
        assert_eq!(g.last_sequence(), Some(7));
    }

    // [CHECK 7] sequence gap detected and recovery required.
    #[test]
    fn gaps_are_detected_and_block_until_anchor() {
        let mut g = SequenceGuard::new("bybit:btcusdt:orderbook");
        assert_eq!(g.verdict(10, false), SequenceVerdict::Accepted);
        assert_eq!(
            g.verdict(13, false),
            SequenceVerdict::Gap {
                expected: 11,
                actual: 13
            }
        );
        assert_eq!(g.gaps_seen, 1);
        assert!(g.is_awaiting_anchor());
        // Deltas keep failing while unanchored...
        assert!(matches!(
            g.verdict(14, false),
            SequenceVerdict::OutOfOrder { .. }
        ));
        // ...until a snapshot anchors the stream again.
        assert_eq!(g.verdict(14, true), SequenceVerdict::Accepted);
        assert!(!g.is_awaiting_anchor());
        assert_eq!(g.verdict(15, false), SequenceVerdict::Accepted);
    }

    // [CHECK 8] out-of-order detected according to venue sequencing rules.
    #[test]
    fn out_of_order_is_detected() {
        let mut g = SequenceGuard::new("okx:btc-usdt:books");
        assert_eq!(g.verdict(5, false), SequenceVerdict::Accepted);
        assert_eq!(g.verdict(6, false), SequenceVerdict::Accepted);
        assert!(matches!(
            g.verdict(4, false),
            SequenceVerdict::OutOfOrder { last: 6 }
        ));
        assert_eq!(g.out_of_order_seen, 1);
        // The guard stays healthy: an old frame does not corrupt continuity.
        assert_eq!(g.verdict(7, false), SequenceVerdict::Accepted);
    }

    // [CHECK 55/56 support] reconnect replay: the same last event is a
    // duplicate (idempotent), not a new event.
    #[test]
    fn replay_after_reconnect_is_a_duplicate_not_new_state() {
        let mut g = SequenceGuard::new("binance:ethusdt:depth");
        for s in 1..=5 {
            assert_eq!(g.verdict(s, false), SequenceVerdict::Accepted);
        }
        // Venue resends the final pre-disconnect update.
        assert_eq!(g.verdict(5, false), SequenceVerdict::Duplicate);
        assert_eq!(g.accepted_seen, 5);
    }

    #[test]
    fn reset_forgets_continuity() {
        let mut g = SequenceGuard::new("s");
        let _ = g.verdict(100, false);
        g.reset();
        assert_eq!(g.last_sequence(), None);
        assert_eq!(g.verdict(1, false), SequenceVerdict::Accepted);
    }
}
