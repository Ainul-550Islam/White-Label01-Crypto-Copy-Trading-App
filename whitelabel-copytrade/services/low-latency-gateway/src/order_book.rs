//! In-memory order-book state with deterministic delta application.
//!
//! Authority boundary: this book is the gateway's TRANSPORT-VIEW of one
//! venue stream. It is not portfolio position, not balance, not PnL and not
//! an execution decision input beyond downstream consumers reading
//! normalized state. On any sequence gap the book transitions to an
//! explicit unusable state and refuses further deltas until a fresh
//! snapshot re-anchors it — a possibly corrupt book never masquerades as
//! current.

use std::collections::BTreeMap;

use crate::error::GatewayError;
use crate::sequence_guard::{SequenceGuard, SequenceVerdict};
use crate::types::{Level, Price, Quantity, Sequence, Side, Symbol, Venue};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum BookState {
    /// Anchored by a snapshot and applying deltas cleanly.
    Live,
    /// A gap was detected; deltas are refused until a fresh snapshot.
    Gapped,
    /// Explicitly reset (startup, reconnect policy, operator action).
    AwaitingSnapshot,
}

pub struct OrderBook {
    pub venue: Venue,
    pub symbol: Symbol,
    bids: BTreeMap<i128, Quantity>,
    asks: BTreeMap<i128, Quantity>,
    scale: u8,
    guard: SequenceGuard,
    state: BookState,
    pub resets: u64,
    pub crossed_observations: u64,
    pub last_crossed: Option<(Price, Price)>,
    pub updates_applied: u64,
}

impl OrderBook {
    pub fn new(venue: Venue, symbol: Symbol) -> OrderBook {
        OrderBook {
            guard: SequenceGuard::new(format!("{venue}:{symbol}:book")),
            venue,
            symbol,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            scale: 0,
            state: BookState::AwaitingSnapshot,
            resets: 0,
            crossed_observations: 0,
            last_crossed: None,
            updates_applied: 0,
        }
    }

    pub fn state(&self) -> BookState {
        self.state
    }

    pub fn last_sequence(&self) -> Option<Sequence> {
        self.guard.last_sequence()
    }

    fn key(price: &Price) -> i128 {
        price.raw as i128
    }

    fn validate_side(map: &BTreeMap<i128, Quantity>, levels: &[Level]) -> Result<(), GatewayError> {
        for level in levels {
            if level.quantity.is_negative() {
                return Err(GatewayError::MalformedData(format!(
                    "negative level quantity {}",
                    level.quantity
                )));
            }
            if level.quantity.is_zero() && !map.contains_key(&Self::key(&level.price)) {
                // Deleting a level that does not exist is tolerated (venue
                // replays may remove concurrently) — nothing to do.
                continue;
            }
        }
        Ok(())
    }

    fn apply_side(map: &mut BTreeMap<i128, Quantity>, levels: &[Level]) {
        for level in levels {
            if level.quantity.is_zero() {
                map.remove(&Self::key(&level.price));
            } else {
                map.insert(Self::key(&level.price), level.quantity);
            }
        }
    }

    /// Applies a full snapshot. Snapshots re-anchor sequence continuity by
    /// definition (this is how gaps recover).
    pub fn apply_snapshot(
        &mut self,
        sequence: Sequence,
        bids: &[Level],
        asks: &[Level],
    ) -> Result<(), GatewayError> {
        if let Some(l) = bids.iter().chain(asks.iter()).next() {
            self.scale = l.price.scale;
        }
        self.bids.clear();
        self.asks.clear();
        Self::validate_side(&self.bids, bids)?;
        Self::validate_side(&self.asks, asks)?;
        Self::apply_side(&mut self.bids, bids);
        Self::apply_side(&mut self.asks, asks);
        self.guard.reset();
        let verdict = self.guard.verdict(sequence, true);
        debug_assert_eq!(verdict, SequenceVerdict::Accepted);
        // `resets` counts every return to Live from a non-live state
        // (initial anchor and every recovery re-anchor alike) — the same
        // observation the pipeline reports as lle_order_book_resets_total.
        if self.state != BookState::Live {
            self.resets += 1;
        }
        self.state = BookState::Live;
        self.crossed_check();
        Ok(())
    }

    /// Applies one delta. Gap / duplicate / out-of-order follow venue
    /// sequencing rules; a gap makes the book unusable until re-snapshot.
    pub fn apply_delta(
        &mut self,
        sequence: Sequence,
        prev_sequence: Option<Sequence>,
        bids: &[Level],
        asks: &[Level],
    ) -> Result<BookState, GatewayError> {
        if self.state != BookState::Live {
            return Err(GatewayError::BookUnusable(self.symbol.to_string()));
        }
        // Capture the continuity anchor BEFORE the verdict advances it.
        let continuity_last = self.guard.last_sequence();
        match self.guard.verdict(sequence, false) {
            SequenceVerdict::Accepted => {
                // Venue-declared predecessor must agree with our continuity.
                if let Some(prev) = prev_sequence {
                    if let Some(last) = continuity_last {
                        if prev != last {
                            self.state = BookState::Gapped;
                            return Err(GatewayError::SequenceGap {
                                stream: format!("{}:{}", self.venue, self.symbol),
                                expected: prev,
                                actual: last,
                            });
                        }
                    }
                }
                Self::validate_side(&self.bids, bids)?;
                Self::validate_side(&self.asks, asks)?;
                Self::apply_side(&mut self.bids, bids);
                Self::apply_side(&mut self.asks, asks);
                self.updates_applied += 1;
                self.crossed_check();
                Ok(self.state)
            }
            SequenceVerdict::Duplicate => Ok(self.state),
            SequenceVerdict::OutOfOrder { .. } => Ok(self.state),
            SequenceVerdict::Gap { expected, actual } => {
                self.state = BookState::Gapped;
                Err(GatewayError::SequenceGap {
                    stream: format!("{}:{}", self.venue, self.symbol),
                    expected,
                    actual,
                })
            }
        }
    }

    fn crossed_check(&mut self) {
        if let (Some((bid_price, _)), Some((ask_price, _))) = (self.best_bid(), self.best_ask()) {
            if bid_price >= ask_price {
                self.crossed_observations += 1;
                self.last_crossed = Some((bid_price, ask_price));
            }
        }
    }

    /// Explicit operator/recovery reset: drops state, requires a snapshot.
    pub fn reset(&mut self) -> BookState {
        self.bids.clear();
        self.asks.clear();
        self.guard.reset();
        self.state = BookState::AwaitingSnapshot;
        // `resets` counts RETURNS to Live, not the invalidation itself.
        self.state
    }

    pub fn best_bid(&self) -> Option<(Price, Quantity)> {
        self.bids.iter().next_back().and_then(|(k, q)| {
            Price::from_parts(*k as i64, self.scale)
                .ok()
                .map(|p| (p, *q))
        })
    }

    pub fn best_ask(&self) -> Option<(Price, Quantity)> {
        self.asks.iter().next().and_then(|(k, q)| {
            Price::from_parts(*k as i64, self.scale)
                .ok()
                .map(|p| (p, *q))
        })
    }

    pub fn spread(&self) -> Result<Option<Price>, GatewayError> {
        Ok(match (self.best_bid(), self.best_ask()) {
            (Some((bid, _)), Some((ask, _))) => Some(
                ask.checked_sub(bid)
                    .ok_or_else(|| GatewayError::MalformedData("spread overflow".into()))?,
            ),
            _ => None,
        })
    }

    pub fn is_crossed(&self) -> bool {
        matches!((self.best_bid(), self.best_ask()), (Some(b), Some(a)) if b.0 >= a.0)
    }

    pub fn depth(&self, side: Side) -> usize {
        match side {
            Side::Bid => self.bids.len(),
            Side::Ask => self.asks.len(),
        }
    }

    pub fn levels(&self, side: Side, limit: usize) -> Vec<Level> {
        let map = match side {
            Side::Bid => &self.bids,
            Side::Ask => &self.asks,
        };
        let iter: Box<dyn Iterator<Item = (&i128, &Quantity)>> = match side {
            Side::Bid => Box::new(map.iter().rev()),
            Side::Ask => Box::new(map.iter()),
        };
        iter.take(limit)
            .filter_map(|(k, q)| {
                Price::from_parts(*k as i64, self.scale)
                    .ok()
                    .map(|p| Level {
                        price: p,
                        quantity: *q,
                    })
            })
            .collect()
    }

    pub fn is_live(&self) -> bool {
        self.state == BookState::Live
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn level(price: &str, qty: &str) -> Level {
        Level::from_wire(price, qty).expect("level")
    }

    fn book() -> OrderBook {
        OrderBook::new(Venue::Binance, Symbol::new("BTCUSDT").expect("sym"))
    }

    fn snapshot_levels() -> (Vec<Level>, Vec<Level>) {
        (
            vec![level("100.10", "2.0"), level("100.05", "1.0")],
            vec![level("100.20", "1.5"), level("100.25", "3.0")],
        )
    }

    // [CHECK 9] snapshot applies correctly and anchors sequence state.
    #[test]
    fn snapshot_applies_and_anchors() {
        let mut b = book();
        assert_eq!(b.state(), BookState::AwaitingSnapshot);
        let (bids, asks) = snapshot_levels();
        b.apply_snapshot(100, &bids, &asks).expect("snap");
        assert_eq!(b.state(), BookState::Live);
        assert_eq!(
            b.best_bid().map(|(p, _)| p.to_string()),
            Some("100.1".into())
        );
        assert_eq!(
            b.best_ask().map(|(p, _)| p.to_string()),
            Some("100.2".into())
        );
        assert_eq!(b.last_sequence(), Some(100));
        assert_eq!(b.resets, 1);
    }

    // [CHECK 10] delta applies correctly on top of the snapshot.
    #[test]
    fn delta_applies_on_top_of_snapshot() {
        let mut b = book();
        let (bids, asks) = snapshot_levels();
        b.apply_snapshot(100, &bids, &asks).expect("snap");
        // Take the 100.10 level and add a new best 100.15.
        let d_bids = vec![level("100.10", "0"), level("100.15", "0.75")];
        b.apply_delta(101, None, &d_bids, &[]).expect("delta");
        assert_eq!(
            b.best_bid().map(|(p, q)| (p.to_string(), q.to_string())),
            Some(("100.15".into(), "0.75".into()))
        );
        assert_eq!(b.depth(Side::Bid), 2);
        // Zero-quantity delta removes the 100.20 ask.
        let d_asks = vec![level("100.20", "0")];
        b.apply_delta(102, None, &[], &d_asks).expect("delta");
        assert_eq!(
            b.best_ask().map(|(p, _)| p.to_string()),
            Some("100.25".into())
        );
    }

    // [CHECK 11] crossed book is detected.
    #[test]
    fn crossed_book_is_detected() {
        let mut b = book();
        let (bids, asks) = snapshot_levels();
        b.apply_snapshot(100, &bids, &asks).expect("snap");
        assert!(!b.is_crossed());
        // A delta that pushes a bid to the ask side crosses the book.
        let crossed_bids = vec![level("100.25", "5.0")];
        b.apply_delta(101, None, &crossed_bids, &[]).expect("delta");
        assert!(b.is_crossed());
        assert_eq!(b.crossed_observations, 1);
        assert!(b.last_crossed.is_some());
        // Spread becomes non-positive.
        let spread = b.spread().expect("spread").expect("some");
        assert!(spread.is_negative() || spread.is_zero());
    }

    // [CHECK 12] reset works: state cleared, snapshot required again.
    #[test]
    fn reset_requires_fresh_snapshot() {
        let mut b = book();
        let (bids, asks) = snapshot_levels();
        b.apply_snapshot(100, &bids, &asks).expect("snap");
        assert_eq!(b.reset(), BookState::AwaitingSnapshot);
        assert_eq!(b.best_bid(), None);
        assert_eq!(b.best_ask(), None);
        // Deltas are refused while unusable.
        assert!(matches!(
            b.apply_delta(101, None, &[], &[]),
            Err(GatewayError::BookUnusable(_))
        ));
        // And a snapshot re-anchors.
        b.apply_snapshot(200, &bids, &asks).expect("re-snap");
        assert!(b.is_live());
        assert_eq!(b.resets, 2);
    }

    // [CHECK 7 support] a sequence gap makes the book unusable and triggers
    // recovery rather than silently continuing with corrupt state.
    #[test]
    fn gap_marks_book_unusable_until_fresh_snapshot() {
        let mut b = book();
        let (bids, asks) = snapshot_levels();
        b.apply_snapshot(100, &bids, &asks).expect("snap");
        let err = b.apply_delta(103, None, &[], &[]).expect_err("gap");
        assert!(matches!(
            err,
            GatewayError::SequenceGap {
                expected: 101,
                actual: 103,
                ..
            }
        ));
        assert_eq!(b.state(), BookState::Gapped);
        assert!(matches!(
            b.apply_delta(104, None, &[], &[]),
            Err(GatewayError::BookUnusable(_))
        ));
        assert!(!b.is_live());
        // Recovery: fresh snapshot resets sequence and restores liveness.
        b.apply_snapshot(103, &bids, &asks)
            .expect("recovery snapshot");
        assert!(b.is_live());
        assert_eq!(b.last_sequence(), Some(103));
    }

    // Duplicates are idempotent: replayed deltas do not double-apply.
    #[test]
    fn duplicate_deltas_are_idempotent() {
        let mut b = book();
        let (bids, asks) = snapshot_levels();
        b.apply_snapshot(100, &bids, &asks).expect("snap");
        let d = vec![level("100.30", "9.9")];
        b.apply_delta(101, None, &[], &d).expect("first");
        let before = b.depth(Side::Ask);
        b.apply_delta(101, None, &[], &d).expect("dup ignored");
        assert_eq!(b.depth(Side::Ask), before);
    }

    #[test]
    fn spread_and_levels_are_deterministic() {
        let mut b = book();
        let (bids, asks) = snapshot_levels();
        b.apply_snapshot(1, &bids, &asks).expect("snap");
        assert_eq!(
            b.spread().expect("spread").map(|s| s.to_string()),
            Some("0.1".into())
        );
        let top_bids = b.levels(Side::Bid, 1);
        assert_eq!(top_bids.len(), 1);
        assert_eq!(top_bids[0].price.to_string(), "100.1");
        let top_asks = b.levels(Side::Ask, 5);
        assert_eq!(top_asks.len(), 2);
        assert_eq!(top_asks[0].price.to_string(), "100.2");
        assert_eq!(top_asks[1].price.to_string(), "100.25");
    }
}
