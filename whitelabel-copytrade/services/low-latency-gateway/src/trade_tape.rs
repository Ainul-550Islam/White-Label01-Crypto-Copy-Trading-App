//! High-throughput normalized trade-tick storage: a bounded ring-buffer view
//! of recent trades per symbol with sequence/timestamp integrity.
//!
//! Bounded memory: the tape holds at most `capacity` ticks; older ticks are
//! displaced (counted), because a tape is a derived view of public market
//! data, never trading-critical state. Sequence integrity is enforced with
//! the same guard discipline as the order book so replays and gaps are
//! visible in the tape view too.

use crate::error::GatewayError;
use crate::ring_buffer::RingBuffer;
use crate::sequence_guard::{SequenceGuard, SequenceVerdict};
use crate::types::{OrderSide, Price, Quantity, Sequence, Symbol};

/// One normalized trade tick as stored in the tape.
#[derive(Clone, Debug)]
pub struct TradeTickRecord {
    pub sequence: Option<Sequence>,
    pub price: Price,
    pub quantity: Quantity,
    pub taker_side: OrderSide,
    pub trade_id: String,
    pub provider_ms: Option<i64>,
    pub receive_ms: i64,
}

pub struct TradeTape {
    symbol: Symbol,
    ring: RingBuffer<TradeTickRecord>,
    guard: SequenceGuard,
    pub displaced: u64,
}

impl TradeTape {
    pub fn new(symbol: Symbol, capacity: usize) -> TradeTape {
        TradeTape {
            guard: SequenceGuard::new(format!("{symbol}:trades")),
            symbol,
            ring: RingBuffer::bounded(capacity.max(1)),
            displaced: 0,
        }
    }

    pub fn symbol(&self) -> &Symbol {
        &self.symbol
    }

    pub fn capacity(&self) -> usize {
        self.ring.capacity()
    }

    /// Appends one tick. Venue-sequenced tapes enforce continuity: a gap is
    /// surfaced (and counted upstream) instead of silently accepted.
    pub fn record(&mut self, tick: TradeTickRecord) -> Result<(), GatewayError> {
        if let Some(seq) = tick.sequence {
            match self.guard.verdict(seq, false) {
                SequenceVerdict::Accepted => {}
                SequenceVerdict::Duplicate => return Ok(()),
                SequenceVerdict::OutOfOrder { .. } => return Ok(()),
                SequenceVerdict::Gap { expected, actual } => {
                    return Err(GatewayError::SequenceGap {
                        stream: self.guard.stream_name().to_string(),
                        expected,
                        actual,
                    });
                }
            }
        }
        if self.ring.len() == self.ring.capacity() {
            // Displacement is deterministic: the oldest tick leaves first,
            // making room so the newest is always stored.
            self.displaced += 1;
            let _ = self.ring.try_pop();
        }
        let _ = self.ring.try_push(tick);
        Ok(())
    }

    /// Most recent ticks, newest first, bounded by `limit`.
    pub fn recent(&self, limit: usize) -> Vec<TradeTickRecord> {
        let mut out = Vec::with_capacity(limit.min(self.ring.len()));
        let mut collected: Vec<TradeTickRecord> = Vec::with_capacity(self.ring.len());
        while let Some(tick) = self.ring_try_pop_view() {
            collected.push(tick);
        }
        for tick in collected.iter().rev().take(limit) {
            out.push(tick.clone());
        }
        // Put everything back in original order.
        for tick in collected {
            let _ = self.ring.try_push(tick);
        }
        out
    }

    // Interior read via pop/push cycle (bounded, single consumer view).
    fn ring_try_pop_view(&self) -> Option<TradeTickRecord> {
        self.ring.try_pop()
    }

    pub fn len(&self) -> usize {
        self.ring.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ring.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tick(seq: Option<u64>, price: &str, qty: &str) -> TradeTickRecord {
        TradeTickRecord {
            sequence: seq,
            price: Price::parse(price).expect("price"),
            quantity: Quantity::parse(qty).expect("qty"),
            taker_side: OrderSide::Buy,
            trade_id: format!("t-{}", seq.unwrap_or(0)),
            provider_ms: Some(1_700_000_000_000),
            receive_ms: 1_700_000_000_001,
        }
    }

    // Bounded memory: capacity never grows, oldest ticks are displaced.
    #[test]
    fn tape_is_bounded_and_displaces_oldest() {
        let mut tape = TradeTape::new(Symbol::new("BTCUSDT").expect("sym"), 4);
        for i in 0..6 {
            tape.record(tick(Some(i), "100.0", "0.1")).expect("record");
        }
        assert_eq!(tape.len(), 4);
        assert_eq!(tape.displaced, 2);
        let recent = tape.recent(10);
        assert_eq!(recent.len(), 4);
        assert_eq!(recent[0].trade_id, "t-5"); // newest first
        assert_eq!(recent[3].trade_id, "t-2"); // oldest retained
    }

    // Sequence integrity: gaps surface, duplicates are idempotent.
    #[test]
    fn tape_enforces_sequence_integrity() {
        let mut tape = TradeTape::new(Symbol::new("ETHUSDT").expect("sym"), 8);
        tape.record(tick(Some(1), "2000", "0.2")).expect("1");
        tape.record(tick(Some(2), "2001", "0.2")).expect("2");
        // Duplicate: ignored, not double-counted.
        tape.record(tick(Some(2), "2001", "0.2")).expect("dup");
        assert_eq!(tape.len(), 2);
        // Gap: explicit error.
        let err = tape.record(tick(Some(5), "2002", "0.2")).expect_err("gap");
        assert!(matches!(err, GatewayError::SequenceGap { .. }));
    }

    #[test]
    fn recent_respects_limit_and_leaves_tape_intact() {
        let mut tape = TradeTape::new(Symbol::new("SOLUSDT").expect("sym"), 8);
        for i in 0..5 {
            tape.record(tick(Some(i), "50.0", "1.0")).expect("rec");
        }
        let recent = tape.recent(2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].trade_id, "t-4");
        assert_eq!(tape.len(), 5);
    }
}
