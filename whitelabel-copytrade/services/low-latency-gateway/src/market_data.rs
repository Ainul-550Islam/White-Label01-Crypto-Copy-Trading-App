//! Core market-data pipeline: raw feed frames in, normalized events out.
//!
//! Frame lifecycle (every stage observable):
//!   receive (stamped by the feed session)
//!     -> parse (adapter-specific; malformed => counted failure, ZERO events)
//!     -> sequence-guard per (venue, symbol, stream)
//!     -> normalize (event id + provider/receive/normalize timestamps)
//!     -> apply to order-book/tape state (gap => unusable + recovery signal)
//!     -> publish into bounded consumer routes under backpressure policy
//!        (stamped publish timestamp; shed items are counted).
//!
//! This module is the gateway's ONLY market-data authority: normalized
//! transport events, in-memory feed state, sequence integrity and feed
//! health. It holds no position, balance, PnL or order authority.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use crate::error::GatewayError;
use crate::metrics::MetricsRegistry;
use crate::order_book::{BookState, OrderBook};
use crate::parser::EventParser;
use crate::ring_buffer::RingBuffer;
use crate::sequence_guard::{SequenceGuard, SequenceVerdict};
use crate::time::{mono_now_ns, utc_now_ms};
use crate::trade_tape::{TradeTape, TradeTickRecord};
use crate::types::{
    EventId, MarketEvent, MarketEventKind, RawFeedFrame, RecoveryReason, RecoverySignal, Sequence,
    StreamKind, Symbol, Timestamps, Venue,
};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct StreamKey {
    pub venue: Venue,
    pub symbol: Symbol,
    pub stream_kind: StreamKind,
}

struct PipelineState {
    guards: HashMap<StreamKey, SequenceGuard>,
    books: HashMap<StreamKey, OrderBook>,
    tapes: HashMap<Symbol, TradeTape>,
}

pub struct MarketDataPipeline {
    parser: EventParser,
    metrics: Arc<MetricsRegistry>,
    state: Mutex<PipelineState>,
    tape_capacity: usize,
    next_event_id: AtomicU64,
    inbound_depth: AtomicI64,
    consumer_lag: AtomicI64,
    recovery_tx: mpsc::Sender<RecoverySignal>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct ProcessSummary {
    pub parsed_events: usize,
    pub normalized: usize,
    pub duplicates_skipped: usize,
    pub out_of_order_skipped: usize,
    pub gaps: usize,
    pub shed: usize,
    pub recoveries: usize,
}

impl MarketDataPipeline {
    pub fn new(
        venues: &[Venue],
        tape_capacity: usize,
        recovery_tx: mpsc::Sender<RecoverySignal>,
        metrics: Arc<MetricsRegistry>,
    ) -> MarketDataPipeline {
        MarketDataPipeline {
            parser: EventParser::for_venues(venues),
            metrics,
            state: Mutex::new(PipelineState {
                guards: HashMap::new(),
                books: HashMap::new(),
                tapes: HashMap::new(),
            }),
            tape_capacity,
            next_event_id: AtomicU64::new(1),
            inbound_depth: AtomicI64::new(0),
            consumer_lag: AtomicI64::new(0),
            recovery_tx,
        }
    }

    /// Live inbound queue depth observation, fed by the feed sessions.
    pub fn set_inbound_depth(&self, depth: i64) {
        self.inbound_depth.store(depth, Ordering::Relaxed);
    }

    pub fn inbound_depth(&self) -> i64 {
        self.inbound_depth.load(Ordering::Relaxed)
    }

    pub fn set_consumer_lag(&self, lag: i64) {
        self.consumer_lag.store(lag, Ordering::Relaxed);
        self.metrics.set_consumer_lag(lag);
    }

    fn key(venue: Venue, symbol: &Symbol, stream_kind: StreamKind) -> StreamKey {
        StreamKey {
            venue,
            symbol: symbol.clone(),
            stream_kind,
        }
    }

    /// Processes one raw frame through the full pipeline.
    pub fn process_frame(
        &self,
        frame: &RawFeedFrame,
        route: &dyn Fn(&MarketEvent) -> Result<usize, GatewayError>,
    ) -> Result<ProcessSummary, GatewayError> {
        self.metrics.inc_events_received();
        let parse_timer = crate::time::LatencyTimer::start();
        let parsed = match self.parser.parse_frame(frame.venue, &frame.payload) {
            Ok(events) => events,
            Err(e) => {
                self.metrics.inc_parse_failures();
                return Err(e);
            }
        };
        self.metrics
            .parse_latency_ns
            .record_ns(parse_timer.elapsed_ns());

        let mut summary = ProcessSummary {
            parsed_events: parsed.len(),
            ..Default::default()
        };
        let normalize_ms = utc_now_ms();
        let normalize_mono = mono_now_ns();

        for item in parsed {
            let stream_key = Self::key(frame.venue, &item.symbol, item.stream_kind);

            // ---- sequence integrity ------------------------------------
            if let Some(sequence) = item.sequence {
                let verdict = {
                    let mut state = self.state.lock().expect("pipeline mutex");
                    let guard = state.guards.entry(stream_key.clone()).or_insert_with(|| {
                        SequenceGuard::new(format!(
                            "{}:{}:{}",
                            frame.venue,
                            item.symbol,
                            item.stream_kind.as_str()
                        ))
                    });
                    guard.verdict(sequence, item.is_anchor)
                };
                match verdict {
                    SequenceVerdict::Accepted => {}
                    SequenceVerdict::Duplicate => {
                        self.metrics.inc_sequence_duplicates();
                        summary.duplicates_skipped += 1;
                        continue;
                    }
                    SequenceVerdict::OutOfOrder { .. } => {
                        self.metrics.inc_out_of_order();
                        summary.out_of_order_skipped += 1;
                        continue;
                    }
                    SequenceVerdict::Gap { .. } => {
                        self.metrics.inc_sequence_gaps();
                        summary.gaps += 1;
                        // Depth state is unusable on gap: mark the book and
                        // demand a fresh snapshot from the session.
                        let signal = RecoverySignal {
                            venue: frame.venue,
                            symbol: item.symbol.clone(),
                            stream_kind: item.stream_kind,
                            reason: RecoveryReason::SequenceGap,
                        };
                        if self.recovery_tx.try_send(signal).is_ok() {
                            summary.recoveries += 1;
                            self.metrics.inc_sequence_recoveries();
                        }
                        if matches!(
                            item.stream_kind,
                            StreamKind::BookDepth | StreamKind::PartialBook
                        ) {
                            let mut state = self.state.lock().expect("pipeline mutex");
                            if let Some(book) = state.books.get_mut(&stream_key) {
                                book.apply_delta(sequence, item.prev_sequence, &[], &[])
                                    .ok();
                            }
                        }
                        continue;
                    }
                }
            }

            // ---- normalize ----------------------------------------------
            let id: EventId = self.next_event_id.fetch_add(1, Ordering::Relaxed);
            let timestamps = Timestamps {
                provider_ms: item.provider_ms,
                receive_ms: frame.receive_utc_ms,
                normalize_ms,
                publish_ms: None,
                receive_mono_ns: frame.receive_mono_ns,
                normalize_mono_ns: normalize_mono,
                publish_mono_ns: None,
            };

            // ---- state application (book / tape) -------------------------
            match &item.kind {
                MarketEventKind::BookSnapshot { bids, asks } => {
                    let mut state = self.state.lock().expect("pipeline mutex");
                    let book = state
                        .books
                        .entry(stream_key)
                        .or_insert_with(|| OrderBook::new(frame.venue, item.symbol.clone()));
                    if book.state() == BookState::AwaitingSnapshot {
                        self.metrics.inc_order_book_resets();
                    }
                    let seq = item.sequence.unwrap_or(0);
                    book.apply_snapshot(seq, bids, asks)?;
                    if book.is_crossed() {
                        self.metrics.inc_crossed_books();
                    }
                }
                MarketEventKind::BookDelta {
                    bids,
                    asks,
                    prev_sequence,
                } => {
                    let mut state = self.state.lock().expect("pipeline mutex");
                    if let Some(book) = state.books.get_mut(&stream_key) {
                        let seq = item.sequence.unwrap_or(0);
                        match book.apply_delta(seq, *prev_sequence, bids, asks) {
                            Ok(_) => {
                                if book.is_crossed() {
                                    self.metrics.inc_crossed_books();
                                }
                            }
                            Err(GatewayError::SequenceGap { .. })
                            | Err(GatewayError::BookUnusable(_)) => {
                                // Continuity broke at the book level even if
                                // the stream guard passed (declared prev
                                // mismatch): demand recovery.
                                let signal = RecoverySignal {
                                    venue: frame.venue,
                                    symbol: item.symbol.clone(),
                                    stream_kind: item.stream_kind,
                                    reason: RecoveryReason::SequenceGap,
                                };
                                if self.recovery_tx.try_send(signal).is_ok() {
                                    summary.recoveries += 1;
                                    self.metrics.inc_sequence_recoveries();
                                }
                            }
                            Err(other) => return Err(other),
                        }
                    }
                    // Delta for a book we never snapshotted: ignored — the
                    // adapter's snapshot stream will anchor it.
                }
                MarketEventKind::TradeTick {
                    price,
                    quantity,
                    taker_side,
                    trade_id,
                } => {
                    let mut state = self.state.lock().expect("pipeline mutex");
                    let tape = state
                        .tapes
                        .entry(item.symbol.clone())
                        .or_insert_with(|| TradeTape::new(item.symbol.clone(), self.tape_capacity));
                    tape.record(TradeTickRecord {
                        sequence: item.sequence,
                        price: *price,
                        quantity: *quantity,
                        taker_side: *taker_side,
                        trade_id: trade_id.clone(),
                        provider_ms: item.provider_ms,
                        receive_ms: frame.receive_utc_ms,
                    })?;
                }
                _ => {}
            }

            // ---- publish --------------------------------------------------
            let publish_ms = utc_now_ms();
            let publish_mono = mono_now_ns();
            let event = MarketEvent {
                id,
                venue: frame.venue,
                symbol: item.symbol.clone(),
                stream_kind: item.stream_kind,
                sequence: item.sequence,
                timestamps: Timestamps {
                    publish_ms: Some(publish_ms),
                    publish_mono_ns: Some(publish_mono),
                    ..timestamps
                },
                kind: item.kind.clone(),
            };
            match route(&event) {
                Ok(_delivered) => {
                    // Normalization succeeded; delivery accounting belongs to
                    // the router.
                    summary.normalized += 1;
                    self.metrics.inc_events_normalized();
                }
                Err(GatewayError::BackpressureShed { .. }) => {
                    summary.shed += 1;
                    self.metrics.inc_noncritical_drops();
                }
                Err(e) => return Err(e),
            }
        }
        Ok(summary)
    }

    /// Book state snapshot for health and monitoring.
    pub fn book_states(&self) -> Vec<(StreamKey, BookState, Option<Sequence>)> {
        let state = self.state.lock().expect("pipeline mutex");
        let mut rows: Vec<(StreamKey, BookState, Option<Sequence>)> = state
            .books
            .iter()
            .map(|(key, book)| (key.clone(), book.state(), book.last_sequence()))
            .collect();
        rows.sort_by(|a, b| format!("{:?}", a.0).cmp(&format!("{:?}", b.0)));
        rows
    }

    /// Read-only access to one book's best bid/ask (health/monitoring).
    pub fn book_top(
        &self,
        venue: Venue,
        symbol: &Symbol,
    ) -> Option<(BookState, Option<String>, Option<String>)> {
        let state = self.state.lock().expect("pipeline mutex");
        let key = Self::key(venue, symbol, StreamKind::PartialBook);
        state.books.get(&key).map(|book| {
            (
                book.state(),
                book.best_bid().map(|(p, _)| p.to_string()),
                book.best_ask().map(|(p, _)| p.to_string()),
            )
        })
    }

    pub fn tape_len(&self, symbol: &Symbol) -> Option<usize> {
        let state = self.state.lock().expect("pipeline mutex");
        state.tapes.get(symbol).map(TradeTape::len)
    }

    /// In-memory ring of the most recent raw inbound depth observations —
    /// bounded by construction, used by diagnostics.
    pub fn summary_ring(capacity: usize) -> RingBuffer<ProcessSummary> {
        RingBuffer::bounded(capacity)
    }

    pub fn venues(&self) -> Vec<Venue> {
        self.parser.venues()
    }

    pub fn last_sequence_for(
        &self,
        venue: Venue,
        symbol: &Symbol,
        stream: StreamKind,
    ) -> Option<Sequence> {
        let state = self.state.lock().expect("pipeline mutex");
        state
            .guards
            .get(&Self::key(venue, symbol, stream))
            .and_then(SequenceGuard::last_sequence)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backpressure::BackpressurePolicy;
    use crate::venue_router::{RouteConsumer, VenueRouter};

    fn frame(venue: Venue, payload: &str) -> RawFeedFrame {
        RawFeedFrame {
            venue,
            payload: payload.to_string(),
            receive_mono_ns: mono_now_ns(),
            receive_utc_ms: utc_now_ms(),
        }
    }

    fn pipeline(recovery: mpsc::Sender<RecoverySignal>) -> MarketDataPipeline {
        MarketDataPipeline::new(
            &[Venue::Binance, Venue::Okx],
            16,
            recovery,
            Arc::new(MetricsRegistry::new()),
        )
    }

    fn ok_router() -> (VenueRouter, Arc<std::sync::Mutex<Vec<MarketEvent>>>) {
        let mut router = VenueRouter::new(BackpressurePolicy::default());
        let (tx, mut rx) = mpsc::channel::<MarketEvent>(64);
        let seen: Arc<std::sync::Mutex<Vec<MarketEvent>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                sink.lock().expect("sink").push(event);
            }
        });
        router.add_consumer(RouteConsumer {
            name: "test-all".into(),
            venues: vec![Venue::Binance, Venue::Okx],
            symbols: None,
            tx,
            is_critical: false,
        });
        (router, seen)
    }

    // [CHECK 19][CHECK 20][CHECK 21][CHECK 22] all four timestamp domains
    // are preserved end-to-end.
    #[tokio::test]
    async fn timestamps_are_preserved_through_the_pipeline() {
        let (recovery_tx, _recovery_rx) = mpsc::channel(8);
        let pipeline = pipeline(recovery_tx);
        let (_router, sink) = ok_router();
        let receive_ms = utc_now_ms();
        let payload = r#"{"stream":"btcusdt@trade","data":{"e":"trade","E":1672515782136,"s":"BTCUSDT","t":5,"p":"61234.55","q":"0.012","T":1672515782136,"m":false}}"#;
        let frame = RawFeedFrame {
            venue: Venue::Binance,
            payload: payload.to_string(),
            receive_mono_ns: mono_now_ns(),
            receive_utc_ms: receive_ms,
        };
        let summary = pipeline
            .process_frame(&frame, &|event: &MarketEvent| {
                let mut sink = sink.lock().expect("x");
                sink.push(event.clone());
                Ok(1)
            })
            .expect("process");
        assert_eq!(summary.normalized, 1);
        let stored = sink.lock().expect("x");
        assert_eq!(stored.len(), 1);
        let event = &stored[0];
        // [19] provider timestamp preserved from the venue payload.
        assert_eq!(event.timestamps.provider_ms, Some(1_672_515_782_136));
        // [20] receive timestamp preserved from the frame.
        assert_eq!(event.timestamps.receive_ms, receive_ms);
        // [21] normalize timestamp present and ordered after receive.
        assert!(event.timestamps.normalize_ms >= event.timestamps.receive_ms);
        // [22] publish timestamp present and ordered after normalize.
        assert!(event.timestamps.publish_ms.expect("publish") >= event.timestamps.normalize_ms);
        assert!(event.timestamps.publish_mono_ns.is_some());
    }

    // [CHECK 7/30 support] a sequence gap produces a recovery signal and
    // marks the book unusable.
    #[tokio::test]
    async fn sequence_gap_triggers_recovery_and_marks_book_stale() {
        let (recovery_tx, mut recovery_rx) = mpsc::channel(8);
        let pipeline = pipeline(recovery_tx);
        let noop = |_: &MarketEvent| Ok::<usize, GatewayError>(0);

        let snap = r#"{"arg":{"channel":"books","instId":"BTC-USDT"},"action":"snapshot","data":[{"asks":[["100.5","1"]],"bids":[["100.0","1"]],"ts":1,"seqId":10}]}"#;
        pipeline
            .process_frame(&frame(Venue::Okx, snap), &noop)
            .expect("snap");
        let delta_ok = r#"{"arg":{"channel":"books","instId":"BTC-USDT"},"action":"update","data":[{"asks":[],"bids":[],"ts":2,"seqId":11,"prevSeqId":10}]}"#;
        pipeline
            .process_frame(&frame(Venue::Okx, delta_ok), &noop)
            .expect("delta");
        let delta_gap = r#"{"arg":{"channel":"books","instId":"BTC-USDT"},"action":"update","data":[{"asks":[],"bids":[],"ts":3,"seqId":16,"prevSeqId":15}]}"#;
        pipeline
            .process_frame(&frame(Venue::Okx, delta_gap), &noop)
            .expect("gap frame processed");

        let signal = recovery_rx.try_recv().expect("recovery signal emitted");
        assert_eq!(signal.venue, Venue::Okx);
        assert_eq!(signal.symbol.as_str(), "BTC-USDT");
        assert_eq!(signal.reason, RecoveryReason::SequenceGap);
        assert_eq!(
            pipeline.metrics.sequence_gaps_total.load(Ordering::Relaxed),
            1
        );

        // The depth book is no longer live.
        let states = pipeline.book_states();
        assert!(states
            .iter()
            .any(|(key, state, _)| matches!(state, BookState::Gapped) && key.venue == Venue::Okx));
    }

    // [CHECK 5/57 support] malformed frames produce failures and ZERO
    // events: no fabricated market data.
    #[tokio::test]
    async fn malformed_frames_produce_no_events() {
        let (recovery_tx, _recovery_rx) = mpsc::channel(8);
        let pipeline = pipeline(recovery_tx);
        let delivered: Arc<std::sync::Mutex<Vec<MarketEvent>>> = Arc::default();
        let sink = Arc::clone(&delivered);
        let err = pipeline
            .process_frame(
                &frame(Venue::Binance, "{{broken"),
                &move |event: &MarketEvent| {
                    sink.lock().expect("x").push(event.clone());
                    Ok(1)
                },
            )
            .expect_err("malformed");
        assert!(matches!(err, GatewayError::MalformedData(_)));
        assert_eq!(
            pipeline
                .metrics
                .parse_failures_total
                .load(Ordering::Relaxed),
            1
        );
        assert_eq!(delivered.lock().expect("x").len(), 0);
        assert_eq!(
            pipeline
                .metrics
                .events_normalized_total
                .load(Ordering::Relaxed),
            0
        );
    }

    // Duplicates after reconnect replay are skipped idempotently.
    #[tokio::test]
    async fn replayed_sequences_are_skipped_not_republished() {
        let (recovery_tx, _recovery_rx) = mpsc::channel(8);
        let pipeline = pipeline(recovery_tx);
        let count = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let counter = Arc::clone(&count);
        let route = move |_: &MarketEvent| {
            counter.fetch_add(1, Ordering::Relaxed);
            Ok::<usize, GatewayError>(1)
        };
        let trade = r#"{"stream":"ethusdt@trade","data":{"e":"trade","E":1,"s":"ETHUSDT","t":9,"p":"1.0","q":"1.0","m":false}}"#;
        pipeline
            .process_frame(&frame(Venue::Binance, trade), &route)
            .expect("first");
        pipeline
            .process_frame(&frame(Venue::Binance, trade), &route)
            .expect("replay");
        assert_eq!(count.load(Ordering::Relaxed), 1);
        assert_eq!(
            pipeline
                .metrics
                .sequence_duplicates_total
                .load(Ordering::Relaxed),
            1
        );
    }

    // Crossed books are observed through the pipeline.
    #[tokio::test]
    async fn crossed_book_is_counted() {
        let (recovery_tx, _recovery_rx) = mpsc::channel(8);
        let pipeline = pipeline(recovery_tx);
        let noop = |_: &MarketEvent| Ok::<usize, GatewayError>(0);
        let snap = r#"{"stream":"okx-btc","data":{}}"#; // not used; use okx frames below
        let _ = snap;
        let books5 = r#"{"arg":{"channel":"books5","instId":"BTC-USDT"},"data":[{"asks":[["101.0","1"]],"bids":[["100.0","1"]],"ts":1,"seqId":10}]}"#;
        pipeline
            .process_frame(&frame(Venue::Okx, books5), &noop)
            .expect("snap");
        assert_eq!(
            pipeline.metrics.crossed_books_total.load(Ordering::Relaxed),
            0
        );
        // A push that crosses: books5 full snapshot with inverted levels.
        let crossed = r#"{"arg":{"channel":"books5","instId":"BTC-USDT"},"data":[{"asks":[["99.5","1"]],"bids":[["100.0","1"]],"ts":2,"seqId":11}]}"#;
        pipeline
            .process_frame(&frame(Venue::Okx, crossed), &noop)
            .expect("crossed snap");
        assert_eq!(
            pipeline.metrics.crossed_books_total.load(Ordering::Relaxed),
            1
        );
        let top = pipeline.book_top(Venue::Okx, &Symbol::new("BTC-USDT").expect("s"));
        assert!(top.is_some());
        assert_eq!(
            pipeline.tape_len(&Symbol::new("BTC-USDT").expect("s")),
            None
        );
    }

    #[tokio::test]
    async fn trade_tape_tracks_symbol_through_pipeline() {
        let (recovery_tx, _recovery_rx) = mpsc::channel(8);
        let pipeline = pipeline(recovery_tx);
        let noop = |_: &MarketEvent| Ok::<usize, GatewayError>(0);
        for t in 0..5 {
            let payload = format!(
                r#"{{"stream":"ethusdt@trade","data":{{"e":"trade","E":1,"s":"ETHUSDT","t":{t},"p":"2000.0","q":"0.1","m":false}}}}"#
            );
            pipeline
                .process_frame(&frame(Venue::Binance, &payload), &noop)
                .expect("trade");
        }
        assert_eq!(
            pipeline.tape_len(&Symbol::new("ETHUSDT").expect("s")),
            Some(5)
        );
        assert_eq!(
            pipeline.last_sequence_for(
                Venue::Binance,
                &Symbol::new("ETHUSDT").expect("s"),
                StreamKind::Trades
            ),
            Some(4)
        );
    }
}
