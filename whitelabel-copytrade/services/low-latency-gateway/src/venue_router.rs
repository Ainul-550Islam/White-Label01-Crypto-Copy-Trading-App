//! Venue/symbol routing of normalized events to bounded consumers.
//!
//! The router holds the configured subscription matrix and forwards each
//! normalized MarketEvent to every subscribed consumer through a bounded
//! channel under the central backpressure policy. It contains NO business
//! logic: no risk, no compliance, no order decisions — only transport
//! routing with explicit, counted shedding for non-critical consumers.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::mpsc;

use crate::backpressure::{
    admit_non_critical, evaluate, Admission, BackpressurePolicy, BackpressureState,
};
use crate::error::GatewayError;
use crate::types::{MarketEvent, Symbol, Venue};

/// One consumer endpoint with its subscription scope.
pub struct RouteConsumer {
    pub name: String,
    pub venues: Vec<Venue>,
    pub symbols: Option<Vec<Symbol>>,
    pub tx: mpsc::Sender<MarketEvent>,
    pub is_critical: bool,
}

pub struct VenueRouter {
    policy: BackpressurePolicy,
    consumers: Vec<RouteConsumer>,
    routed_total: AtomicU64,
    shed_total: AtomicU64,
    unroutable_total: AtomicU64,
}

impl VenueRouter {
    pub fn new(policy: BackpressurePolicy) -> VenueRouter {
        VenueRouter {
            policy,
            consumers: Vec::new(),
            routed_total: AtomicU64::new(0),
            shed_total: AtomicU64::new(0),
            unroutable_total: AtomicU64::new(0),
        }
    }

    pub fn add_consumer(&mut self, consumer: RouteConsumer) {
        self.consumers.push(consumer);
    }

    pub fn consumer_count(&self) -> usize {
        self.consumers.len()
    }

    fn subscribed(&self, consumer: &RouteConsumer, venue: Venue, symbol: &Symbol) -> bool {
        consumer.venues.contains(&venue)
            && consumer
                .symbols
                .as_ref()
                .map(|list| list.contains(symbol))
                .unwrap_or(true)
    }

    /// Routes one event to all subscribed consumers. Non-critical consumers
    /// may shed under the policy (counted); critical consumers refuse
    /// closed (error) rather than dropping.
    pub fn route(
        &self,
        event: &MarketEvent,
        queue_depth: i64,
    ) -> Result<RoutingOutcome, GatewayError> {
        let state = evaluate(&self.policy, queue_depth);
        let mut delivered: Vec<String> = Vec::new();
        let mut shed: Vec<String> = Vec::new();
        let mut matched = 0usize;
        for consumer in &self.consumers {
            if !self.subscribed(consumer, event.venue, &event.symbol) {
                continue;
            }
            matched += 1;
            if consumer.is_critical {
                // Critical consumers get a blocking-capable send: capacity
                // must exist because their admission policy is fail-closed
                // upstream; here we use try_send and surface failure.
                match consumer.tx.try_send(event.clone()) {
                    Ok(()) => delivered.push(consumer.name.clone()),
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        self.unroutable_total.fetch_add(1, Ordering::Relaxed);
                        return Err(GatewayError::BackpressureRefused { state });
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => {
                        self.unroutable_total.fetch_add(1, Ordering::Relaxed);
                        return Err(GatewayError::Transport(format!(
                            "critical consumer '{}' channel closed",
                            consumer.name
                        )));
                    }
                }
            } else {
                match admit_non_critical(&self.policy, state) {
                    Ok(Admission::Admitted) => match consumer.tx.try_send(event.clone()) {
                        Ok(()) => delivered.push(consumer.name.clone()),
                        Err(mpsc::error::TrySendError::Full(_)) => {
                            self.shed_total.fetch_add(1, Ordering::Relaxed);
                            shed.push(consumer.name.clone());
                        }
                        Err(mpsc::error::TrySendError::Closed(_)) => {
                            shed.push(consumer.name.clone());
                        }
                    },
                    Ok(Admission::Shed) => {
                        self.shed_total.fetch_add(1, Ordering::Relaxed);
                        shed.push(consumer.name.clone());
                    }
                    Err(e) => {
                        self.unroutable_total.fetch_add(1, Ordering::Relaxed);
                        return Err(e);
                    }
                }
            }
        }
        if matched == 0 {
            self.unroutable_total.fetch_add(1, Ordering::Relaxed);
        } else {
            self.routed_total
                .fetch_add(delivered.len() as u64, Ordering::Relaxed);
        }
        Ok(RoutingOutcome {
            delivered,
            shed,
            matched,
        })
    }

    pub fn routed_total(&self) -> u64 {
        self.routed_total.load(Ordering::Relaxed)
    }

    pub fn shed_total(&self) -> u64 {
        self.shed_total.load(Ordering::Relaxed)
    }

    pub fn unroutable_total(&self) -> u64 {
        self.unroutable_total.load(Ordering::Relaxed)
    }

    pub fn state_for(&self, queue_depth: i64) -> BackpressureState {
        evaluate(&self.policy, queue_depth)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoutingOutcome {
    pub delivered: Vec<String>,
    pub shed: Vec<String>,
    pub matched: usize,
}

/// Small helper for constructing a subscription map keyed by venue — used by
/// composition to validate that every configured venue has at least one
/// route or is explicitly unsubscribed.
pub fn group_symbols_by_venue(entries: &[(Venue, Symbol)]) -> HashMap<Venue, Vec<Symbol>> {
    let mut map: HashMap<Venue, Vec<Symbol>> = HashMap::new();
    for (venue, symbol) in entries {
        map.entry(*venue).or_default().push(symbol.clone());
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::utc_now_ms;
    use crate::types::{MarketEventKind, StreamKind, Timestamps};
    use std::sync::Arc;

    fn event(venue: Venue, symbol: &str) -> MarketEvent {
        MarketEvent {
            id: 1,
            venue,
            symbol: Symbol::new(symbol).expect("sym"),
            stream_kind: StreamKind::Trades,
            sequence: None,
            timestamps: Timestamps {
                provider_ms: None,
                receive_ms: utc_now_ms(),
                normalize_ms: utc_now_ms(),
                publish_ms: None,
                receive_mono_ns: 0,
                normalize_mono_ns: 0,
                publish_mono_ns: None,
            },
            kind: MarketEventKind::Heartbeat,
        }
    }

    fn consumer(
        name: &str,
        venues: Vec<Venue>,
        symbols: Option<Vec<Symbol>>,
        critical: bool,
    ) -> (RouteConsumer, Arc<std::sync::Mutex<Vec<MarketEvent>>>) {
        let (tx, mut rx) = mpsc::channel::<MarketEvent>(8);
        let seen: Arc<std::sync::Mutex<Vec<MarketEvent>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                sink.lock().expect("sink").push(event);
            }
        });
        (
            RouteConsumer {
                name: name.to_string(),
                venues,
                symbols,
                tx,
                is_critical: critical,
            },
            seen,
        )
    }

    #[tokio::test]
    async fn routes_only_to_subscribed_consumers() {
        let mut router = VenueRouter::new(BackpressurePolicy::default());
        let (all, all_sink) = consumer("all", vec![Venue::Binance, Venue::Okx], None, false);
        let (binance_only, bo_sink) = consumer(
            "binance-only",
            vec![Venue::Binance],
            Some(vec![Symbol::new("BTCUSDT").expect("s")]),
            false,
        );
        router.add_consumer(all);
        router.add_consumer(binance_only);

        let outcome = router
            .route(&event(Venue::Binance, "BTCUSDT"), 0)
            .expect("route");
        assert_eq!(outcome.matched, 2);
        let outcome = router
            .route(&event(Venue::Okx, "BTC-USDT"), 0)
            .expect("route");
        assert_eq!(outcome.matched, 1);
        let outcome = router
            .route(&event(Venue::Binance, "ETHUSDT"), 0)
            .expect("route");
        assert_eq!(outcome.matched, 1);
        assert_eq!(router.routed_total(), 4);
        // Give the sink tasks a beat to drain.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(all_sink.lock().expect("x").len(), 3);
        assert_eq!(bo_sink.lock().expect("x").len(), 1);
    }

    #[tokio::test]
    async fn unroutable_events_are_counted_not_silently_ignored() {
        let mut router = VenueRouter::new(BackpressurePolicy::default());
        let (only_okx, _sink) = consumer("okx-only", vec![Venue::Okx], None, false);
        router.add_consumer(only_okx);
        let outcome = router
            .route(&event(Venue::Binance, "BTCUSDT"), 0)
            .expect("no consumer is not an error");
        assert_eq!(outcome.matched, 0);
        assert_eq!(router.unroutable_total(), 1);
    }

    #[tokio::test]
    async fn critical_consumer_full_channel_is_fail_closed() {
        // Deliberately no draining task: the channel fills up.
        let (tx, rx) = mpsc::channel::<MarketEvent>(1);
        std::mem::forget(rx);
        let mut router = VenueRouter::new(BackpressurePolicy::default());
        router.add_consumer(RouteConsumer {
            name: "critical-sink".to_string(),
            venues: vec![Venue::Binance],
            symbols: None,
            tx,
            is_critical: true,
        });
        let first = router.route(&event(Venue::Binance, "BTCUSDT"), 0);
        assert!(first.is_ok());
        let second = router.route(&event(Venue::Binance, "BTCUSDT"), 0);
        assert!(matches!(
            second,
            Err(GatewayError::BackpressureRefused { .. })
        ));
    }

    #[test]
    fn grouping_helper_groups_by_venue() {
        let grouped = group_symbols_by_venue(&[
            (Venue::Binance, Symbol::new("BTCUSDT").expect("s")),
            (Venue::Binance, Symbol::new("ETHUSDT").expect("s")),
            (Venue::Okx, Symbol::new("BTC-USDT").expect("s")),
        ]);
        assert_eq!(grouped.get(&Venue::Binance).map(Vec::len), Some(2));
        assert_eq!(grouped.get(&Venue::Okx).map(Vec::len), Some(1));
    }
}
