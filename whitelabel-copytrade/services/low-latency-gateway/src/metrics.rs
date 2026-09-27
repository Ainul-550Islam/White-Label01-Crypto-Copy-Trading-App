//! Low-latency metrics: fixed-schema counters, gauges and bucketed
//! histograms built on atomics. No dynamic labels exist in this registry by
//! construction, so no API key, customer identity or payload fragment can
//! ever become a metric label. Rendering is a plain text snapshot consumed
//! by the internal health listener.

use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};

/// Log-scale latency histogram with static bucket boundaries (nanoseconds).
/// Boundaries are a compile-time constant shared by every histogram; bucket
/// counters are allocated in `init`.
pub const HISTO_BOUNDARIES_NS: [u64; 36] = {
    let mut b = [0u64; 36];
    let mut v: u64 = 100;
    let mut i = 0;
    while i < 36 {
        b[i] = v;
        v = v.saturating_mul(2);
        i += 1;
    }
    b
};

pub struct Histogram {
    name: &'static str,
    buckets: Vec<AtomicU64>,
    count: AtomicU64,
    sum_ns: AtomicU64,
}

impl Histogram {
    pub const fn new(name: &'static str) -> Histogram {
        Histogram {
            name,
            buckets: Vec::new(),
            count: AtomicU64::new(0),
            sum_ns: AtomicU64::new(0),
        }
    }

    /// Allocates the bucket slots (one more than boundaries: overflow
    /// bucket). Must be called once before recording.
    pub fn init(&mut self) {
        if self.buckets.is_empty() {
            self.buckets = (0..HISTO_BOUNDARIES_NS.len() + 1)
                .map(|_| AtomicU64::new(0))
                .collect();
        }
    }

    pub fn record_ns(&self, ns: u64) {
        debug_assert!(!self.buckets.is_empty(), "histogram not initialized");
        let mut idx = self.buckets.len() - 1;
        for (i, b) in HISTO_BOUNDARIES_NS.iter().enumerate() {
            if ns <= *b {
                idx = i;
                break;
            }
        }
        if let Some(slot) = self.buckets.get(idx) {
            slot.fetch_add(1, Ordering::Relaxed);
        }
        self.count.fetch_add(1, Ordering::Relaxed);
        self.sum_ns
            .fetch_add(ns.min(u64::MAX / 2), Ordering::Relaxed);
    }

    pub fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }

    pub fn sum_ns(&self) -> u64 {
        self.sum_ns.load(Ordering::Relaxed)
    }

    pub fn name(&self) -> &'static str {
        self.name
    }

    /// Snapshot of (upper_bound_label, count) pairs. Labels are static range
    /// strings derived from the fixed boundaries.
    pub fn snapshot(&self) -> Vec<(String, u64)> {
        let mut out = Vec::with_capacity(self.buckets.len());
        for (i, slot) in self.buckets.iter().enumerate() {
            let label = match HISTO_BOUNDARIES_NS.get(i) {
                Some(b) => format!("le_{}", b),
                None => "le_inf".to_string(),
            };
            out.push((label, slot.load(Ordering::Relaxed)));
        }
        out
    }
}

/// The gateway's complete fixed metric surface. Field names are the metric
/// names; nothing else can be recorded.
pub struct MetricsRegistry {
    pub events_received_total: AtomicU64,
    pub events_normalized_total: AtomicU64,
    pub parse_failures_total: AtomicU64,
    pub sequence_gaps_total: AtomicU64,
    pub sequence_duplicates_total: AtomicU64,
    pub out_of_order_total: AtomicU64,
    pub reconnect_total: AtomicU64,
    pub order_book_resets_total: AtomicU64,
    pub ring_buffer_overflow_total: AtomicU64,
    pub noncritical_drop_total: AtomicU64,
    pub execution_intents_accepted_total: AtomicU64,
    pub execution_intent_rejections_total: AtomicU64,
    pub execution_intent_replays_total: AtomicU64,
    pub heartbeats_missed_total: AtomicU64,
    pub provider_failures_total: AtomicU64,
    pub transport_timeouts_total: AtomicU64,
    pub sequence_recoveries_total: AtomicU64,
    pub crossed_books_total: AtomicU64,

    queue_depth: AtomicI64,
    consumer_lag: AtomicI64,
    sessions_connected: AtomicI64,

    pub transport_latency_ns: Histogram,
    pub prepare_latency_ns: Histogram,
    pub provider_latency_ns: Histogram,
    pub parse_latency_ns: Histogram,
}

impl MetricsRegistry {
    /// Creates and initializes all histograms (single call site).
    pub fn new() -> MetricsRegistry {
        let mut transport = Histogram::new("lle_transport_latency_ns");
        transport.init();
        let mut prepare = Histogram::new("lle_prepare_latency_ns");
        prepare.init();
        let mut provider = Histogram::new("lle_provider_latency_ns");
        provider.init();
        let mut parse = Histogram::new("lle_parse_latency_ns");
        parse.init();
        MetricsRegistry {
            events_received_total: AtomicU64::new(0),
            events_normalized_total: AtomicU64::new(0),
            parse_failures_total: AtomicU64::new(0),
            sequence_gaps_total: AtomicU64::new(0),
            sequence_duplicates_total: AtomicU64::new(0),
            out_of_order_total: AtomicU64::new(0),
            reconnect_total: AtomicU64::new(0),
            order_book_resets_total: AtomicU64::new(0),
            ring_buffer_overflow_total: AtomicU64::new(0),
            noncritical_drop_total: AtomicU64::new(0),
            execution_intents_accepted_total: AtomicU64::new(0),
            execution_intent_rejections_total: AtomicU64::new(0),
            execution_intent_replays_total: AtomicU64::new(0),
            heartbeats_missed_total: AtomicU64::new(0),
            provider_failures_total: AtomicU64::new(0),
            transport_timeouts_total: AtomicU64::new(0),
            sequence_recoveries_total: AtomicU64::new(0),
            crossed_books_total: AtomicU64::new(0),
            queue_depth: AtomicI64::new(0),
            consumer_lag: AtomicI64::new(0),
            sessions_connected: AtomicI64::new(0),
            transport_latency_ns: transport,
            prepare_latency_ns: prepare,
            provider_latency_ns: provider,
            parse_latency_ns: parse,
        }
    }

    // Gauge setters (bounded ranges; gauges are observations, not labels).
    pub fn set_queue_depth(&self, depth: i64) {
        self.queue_depth.store(depth, Ordering::Relaxed);
    }

    pub fn queue_depth(&self) -> i64 {
        self.queue_depth.load(Ordering::Relaxed)
    }

    pub fn set_consumer_lag(&self, lag: i64) {
        self.consumer_lag.store(lag, Ordering::Relaxed);
    }

    pub fn consumer_lag(&self) -> i64 {
        self.consumer_lag.load(Ordering::Relaxed)
    }

    pub fn set_sessions_connected(&self, connected: i64) {
        self.sessions_connected.store(connected, Ordering::Relaxed);
    }

    pub fn sessions_connected(&self) -> i64 {
        self.sessions_connected.load(Ordering::Relaxed)
    }

    fn bump(counter: &AtomicU64) -> u64 {
        counter.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn inc_events_received(&self) -> u64 {
        Self::bump(&self.events_received_total)
    }
    pub fn inc_events_normalized(&self) -> u64 {
        Self::bump(&self.events_normalized_total)
    }
    pub fn inc_parse_failures(&self) -> u64 {
        Self::bump(&self.parse_failures_total)
    }
    pub fn inc_sequence_gaps(&self) -> u64 {
        Self::bump(&self.sequence_gaps_total)
    }
    pub fn inc_sequence_duplicates(&self) -> u64 {
        Self::bump(&self.sequence_duplicates_total)
    }
    pub fn inc_out_of_order(&self) -> u64 {
        Self::bump(&self.out_of_order_total)
    }
    pub fn inc_reconnects(&self) -> u64 {
        Self::bump(&self.reconnect_total)
    }
    pub fn inc_order_book_resets(&self) -> u64 {
        Self::bump(&self.order_book_resets_total)
    }
    pub fn inc_ring_overflow(&self) -> u64 {
        Self::bump(&self.ring_buffer_overflow_total)
    }
    pub fn add_noncritical_drops(&self, n: u64) -> u64 {
        self.noncritical_drop_total.fetch_add(n, Ordering::Relaxed) + n
    }
    pub fn inc_noncritical_drops(&self) -> u64 {
        Self::bump(&self.noncritical_drop_total)
    }
    pub fn inc_intents_accepted(&self) -> u64 {
        Self::bump(&self.execution_intents_accepted_total)
    }
    pub fn inc_intent_rejections(&self) -> u64 {
        Self::bump(&self.execution_intent_rejections_total)
    }
    pub fn inc_intent_replays(&self) -> u64 {
        Self::bump(&self.execution_intent_replays_total)
    }
    pub fn inc_heartbeats_missed(&self) -> u64 {
        Self::bump(&self.heartbeats_missed_total)
    }
    pub fn inc_provider_failures(&self) -> u64 {
        Self::bump(&self.provider_failures_total)
    }
    pub fn inc_transport_timeouts(&self) -> u64 {
        Self::bump(&self.transport_timeouts_total)
    }
    pub fn inc_sequence_recoveries(&self) -> u64 {
        Self::bump(&self.sequence_recoveries_total)
    }
    pub fn inc_crossed_books(&self) -> u64 {
        Self::bump(&self.crossed_books_total)
    }

    /// Plain-text snapshot for the internal metrics endpoint. Only the fixed
    /// metric names above can appear; histograms render with static range
    /// labels. There is no mechanism by which payload data becomes a label.
    pub fn render_text(&self) -> String {
        let mut out = String::with_capacity(2048);
        let mut line = |name: &str, value: i128| {
            out.push_str(name);
            out.push(' ');
            out.push_str(&value.to_string());
            out.push('\n');
        };
        line(
            "lle_events_received_total",
            self.events_received_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_events_normalized_total",
            self.events_normalized_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_parse_failures_total",
            self.parse_failures_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_sequence_gaps_total",
            self.sequence_gaps_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_sequence_duplicates_total",
            self.sequence_duplicates_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_out_of_order_total",
            self.out_of_order_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_reconnect_total",
            self.reconnect_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_order_book_resets_total",
            self.order_book_resets_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_ring_buffer_overflow_total",
            self.ring_buffer_overflow_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_noncritical_drop_total",
            self.noncritical_drop_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_execution_intents_accepted_total",
            self.execution_intents_accepted_total
                .load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_execution_intent_rejections_total",
            self.execution_intent_rejections_total
                .load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_execution_intent_replays_total",
            self.execution_intent_replays_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_heartbeats_missed_total",
            self.heartbeats_missed_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_provider_failures_total",
            self.provider_failures_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_transport_timeouts_total",
            self.transport_timeouts_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_sequence_recoveries_total",
            self.sequence_recoveries_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_crossed_books_total",
            self.crossed_books_total.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_queue_depth",
            self.queue_depth.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_consumer_lag",
            self.consumer_lag.load(Ordering::Relaxed) as i128,
        );
        line(
            "lle_sessions_connected",
            self.sessions_connected.load(Ordering::Relaxed) as i128,
        );
        for hist in [
            &self.transport_latency_ns,
            &self.prepare_latency_ns,
            &self.provider_latency_ns,
            &self.parse_latency_ns,
        ] {
            out.push_str(hist.name());
            out.push_str("_count ");
            out.push_str(&hist.count().to_string());
            out.push('\n');
            out.push_str(hist.name());
            out.push_str("_sum_ns ");
            out.push_str(&hist.sum_ns().to_string());
            out.push('\n');
        }
        out
    }
}

impl Default for MetricsRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 45] queue depth measured.
    #[test]
    fn queue_depth_gauge_round_trips() {
        let m = MetricsRegistry::new();
        assert_eq!(m.queue_depth(), 0);
        m.set_queue_depth(42);
        assert_eq!(m.queue_depth(), 42);
        m.set_queue_depth(0);
        assert_eq!(m.queue_depth(), 0);
    }

    // [CHECK 46] consumer lag measured.
    #[test]
    fn consumer_lag_gauge_round_trips() {
        let m = MetricsRegistry::new();
        m.set_consumer_lag(9);
        assert_eq!(m.consumer_lag(), 9);
    }

    // [CHECK 47] reconnect metric recorded.
    #[test]
    fn reconnect_counter_increments() {
        let m = MetricsRegistry::new();
        assert_eq!(m.inc_reconnects(), 1);
        assert_eq!(m.inc_reconnects(), 2);
        assert!(m.render_text().contains("lle_reconnect_total 2"));
    }

    // [CHECK 48] sequence-gap metric recorded.
    #[test]
    fn sequence_gap_counter_increments() {
        let m = MetricsRegistry::new();
        m.inc_sequence_gaps();
        m.inc_sequence_gaps();
        m.inc_sequence_gaps();
        assert!(m.render_text().contains("lle_sequence_gaps_total 3"));
    }

    // [CHECK 49] error/metric labels contain no secrets: the rendered
    // surface is a fixed schema, and injecting hostile content through any
    // recorded value cannot produce a label.
    #[test]
    fn rendered_metrics_contain_no_secret_material() {
        let m = MetricsRegistry::new();
        // Simulate hostile values flowing through counters/histograms: the
        // registry records only numbers, so nothing can leak into labels.
        m.inc_parse_failures();
        m.transport_latency_ns.record_ns(123_456);
        let text = m.render_text();
        assert!(!text.contains("AKIA"));
        assert!(!text.contains("eyJ"));
        assert!(!text.contains("BEGIN"));
        assert!(!text.contains("password"));
        for rendered_line in text.lines() {
            let name = rendered_line.split(' ').next().unwrap_or("");
            assert!(
                name.starts_with("lle_"),
                "unexpected metric line: {rendered_line}"
            );
        }
    }

    #[test]
    fn histogram_buckets_are_monotonic_and_counted() {
        let mut h = Histogram::new("lle_test_latency_ns");
        h.init();
        h.record_ns(50); // bucket 0 (<=100)
        h.record_ns(5_000); // <=6400 range
        h.record_ns(10_000_000_000); // high bucket
        assert_eq!(h.count(), 3);
        let snap = h.snapshot();
        let total: u64 = snap.iter().map(|(_, c)| c).sum();
        assert_eq!(total, 3);
        assert_eq!(snap[0].0, "le_100");
        assert_eq!(snap[snap.len() - 1].0, "le_inf");
        assert!(h.sum_ns() >= 50 + 5_000 + 10_000_000_000);
    }
}
