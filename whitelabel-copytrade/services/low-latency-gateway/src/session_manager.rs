//! Venue session supervision: connection state, reconnect counts, heartbeat
//! recency, capability state and safe restart coordination.
//!
//! The manager is the single observation point used by health/readiness and
//! by the operator-facing metrics: it reads REAL session state recorded by
//! the feed tasks — a session is connected only when the session task said
//! so after a successful socket upgrade.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::backpressure::BackpressurePolicy;
use crate::feed_session::{SessionPhase, SessionStateMachine};
use crate::market_data::{MarketDataPipeline, StreamKey};
use crate::types::{Symbol, Venue};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionEntry {
    pub venue: Venue,
    pub phase: SessionPhase,
    pub reconnects: u64,
    pub last_error: Option<String>,
    pub last_receive_ms: Option<i64>,
    pub pending_resnapshot: bool,
    pub symbols: Vec<Symbol>,
}

pub struct SessionManager {
    entries: Mutex<HashMap<Venue, SessionEntry>>,
    policy: BackpressurePolicy,
}

impl SessionManager {
    pub fn new(policy: BackpressurePolicy) -> SessionManager {
        SessionManager {
            entries: Mutex::new(HashMap::new()),
            policy,
        }
    }

    pub fn register(&self, venue: Venue, symbols: Vec<Symbol>) {
        let mut entries = self.entries.lock().expect("session mutex");
        entries.entry(venue).or_insert_with(|| SessionEntry {
            venue,
            phase: SessionPhase::Idle,
            reconnects: 0,
            last_error: None,
            last_receive_ms: None,
            pending_resnapshot: false,
            symbols,
        });
    }

    pub fn backpressure_policy(&self) -> BackpressurePolicy {
        self.policy
    }

    fn mutate<F: FnOnce(&mut SessionEntry)>(&self, venue: Venue, f: F) {
        let mut entries = self.entries.lock().expect("session mutex");
        if let Some(entry) = entries.get_mut(&venue) {
            f(entry);
        }
    }

    // --- callbacks from the feed task -------------------------------------
    pub fn update_connecting(&self, venue: Venue) {
        self.mutate(venue, |e| e.phase = SessionPhase::Connecting);
    }

    pub fn update_connected(&self, venue: Venue) {
        self.mutate(venue, |e| {
            e.phase = SessionPhase::Connected;
            e.last_error = None;
        });
    }

    pub fn update_disconnected(&self, venue: Venue, error: Option<String>, reconnects: u64) {
        self.mutate(venue, |e| {
            if e.phase != SessionPhase::Draining {
                e.phase = SessionPhase::Reconnecting;
            }
            e.last_error = error;
            e.reconnects = reconnects;
        });
    }

    pub fn update_closed(&self, venue: Venue) {
        self.mutate(venue, |e| e.phase = SessionPhase::Closed);
    }

    /// Recovery request from the pipeline: a sequence gap marks the venue's
    /// depth state untrustworthy until a fresh snapshot anchors it.
    pub fn mark_pending_resnapshot(&self, venue: Venue, pending: bool) {
        self.mutate(venue, |e| e.pending_resnapshot = pending);
    }

    pub fn record_state_snapshot(&self, state: &SessionStateMachine) {
        self.mutate(state.venue, |e| {
            e.phase = state.phase;
            e.reconnects = state.reconnects;
            e.last_error = state.last_error.clone();
            e.last_receive_ms = state.last_successful_receive_ms;
            e.pending_resnapshot = state.pending_resnapshot;
        });
    }

    // --- observations for health/operations -------------------------------
    pub fn snapshot(&self) -> Vec<SessionEntry> {
        let mut rows: Vec<SessionEntry> = self
            .entries
            .lock()
            .expect("session mutex")
            .values()
            .cloned()
            .collect();
        rows.sort_by_key(|e| e.venue);
        rows
    }

    pub fn connected_count(&self) -> usize {
        self.snapshot()
            .iter()
            .filter(|e| e.phase == SessionPhase::Connected)
            .count()
    }

    /// True only when every REQUIRED venue session is actually connected.
    pub fn all_required_connected(&self, required: &[Venue]) -> bool {
        let entries = self.entries.lock().expect("session mutex");
        required.iter().all(|venue| {
            entries
                .get(venue)
                .map(|e| e.phase == SessionPhase::Connected)
                .unwrap_or(false)
        })
    }

    pub fn total_reconnects(&self) -> u64 {
        self.snapshot().iter().map(|e| e.reconnects).sum()
    }

    /// Recovery supervision: when a venue's depth state returned to Live in
    /// the pipeline, the session's pending-resnapshot flag clears. This is
    /// how reconnect/sequence recovery closes its loop deterministically.
    pub fn supervise_recovery(&self, pipeline: &MarketDataPipeline) -> usize {
        let live: Vec<StreamKey> = pipeline
            .book_states()
            .into_iter()
            .filter(|(_, state, _)| matches!(state, crate::order_book::BookState::Live))
            .map(|(key, _, _)| key)
            .collect();
        let target: Option<Venue> = {
            let entries = self.entries.lock().expect("session mutex");
            entries.iter().find_map(|(venue, entry)| {
                if entry.pending_resnapshot && live.iter().any(|key| key.venue == *venue) {
                    Some(*venue)
                } else {
                    None
                }
            })
        };
        match target {
            Some(venue) => {
                self.mutate(venue, |e| e.pending_resnapshot = false);
                1
            }
            None => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> SessionManager {
        SessionManager::new(BackpressurePolicy::default())
    }

    // [CHECK 27 support] manager reflects real updates from session tasks.
    #[test]
    fn manager_tracks_real_session_updates() {
        let m = manager();
        m.register(Venue::Binance, vec![Symbol::new("BTCUSDT").expect("s")]);
        assert_eq!(m.connected_count(), 0);
        m.update_connecting(Venue::Binance);
        assert!(!m.all_required_connected(&[Venue::Binance]));
        m.update_connected(Venue::Binance);
        assert_eq!(m.connected_count(), 1);
        assert!(m.all_required_connected(&[Venue::Binance]));
        m.update_disconnected(Venue::Binance, Some("socket reset".into()), 3);
        assert_eq!(m.connected_count(), 0);
        assert_eq!(m.total_reconnects(), 3);
        let snapshot = m.snapshot();
        assert_eq!(snapshot[0].last_error.as_deref(), Some("socket reset"));
        m.update_closed(Venue::Binance);
        assert_eq!(m.snapshot()[0].phase, SessionPhase::Closed);
    }

    #[test]
    fn unregistered_venues_are_never_connected() {
        let m = manager();
        assert!(!m.all_required_connected(&[Venue::Bybit]));
        assert_eq!(m.snapshot().len(), 0);
    }

    #[test]
    fn state_snapshot_records_from_state_machine() {
        let m = manager();
        m.register(Venue::Okx, vec![Symbol::new("BTC-USDT").expect("s")]);
        let mut sm = crate::feed_session::SessionStateMachine::new(
            Venue::Okx,
            vec![Symbol::new("BTC-USDT").expect("s")],
            Default::default(),
        );
        sm.on_connected(123, 456);
        sm.on_disconnected("lost".into(), 789);
        m.record_state_snapshot(&sm);
        let entry = &m.snapshot()[0];
        assert_eq!(entry.phase, SessionPhase::Reconnecting);
        assert!(entry.pending_resnapshot);
        assert_eq!(entry.last_error.as_deref(), Some("lost"));
        sm.on_snapshot_anchored();
        m.record_state_snapshot(&sm);
        assert!(!m.snapshot()[0].pending_resnapshot);
    }
}
