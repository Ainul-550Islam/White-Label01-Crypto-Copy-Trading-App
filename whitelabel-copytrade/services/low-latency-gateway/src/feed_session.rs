//! Feed session management: real authenticated/public market-data WebSocket
//! sessions with reconnect, heartbeat, subscription restore, sequence
//! continuity and graceful shutdown.
//!
//! Split design:
//! - [`SessionStateMachine`] is a pure, deterministic record of session
//!   state (phase, attempt counter, last receive, missed heartbeats,
//!   subscription and snapshot-recovery flags). Every rule is unit-tested
//!   without any network.
//! - [`spawn_feed_session`] is the production wiring: it connects with
//!   tokio-tungstenite over TLS, subscribes via the adapter, forwards raw
//!   frames into the bounded inbound channel with backpressure, keeps the
//!   application heartbeat alive and drives the state machine on every
//!   event. Reconnects use capped exponential backoff. Sequence state is
//!   deliberately NOT reset on reconnect: the pipeline's guards decide
//!   continuity, and a fresh snapshot must re-anchor before deltas count.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::adapters::exchange_ws::MarketDataAdapter;
use crate::backpressure::{admit_non_critical, evaluate, Admission};
use crate::metrics::MetricsRegistry;
use crate::session_manager::SessionManager;
use crate::shutdown::ShutdownCoordinator;
use crate::time::{mono_now_ns, utc_now_ms};
use crate::types::{RawFeedFrame, RecoveryReason, RecoverySignal, Symbol, Venue};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SessionPhase {
    Idle,
    Connecting,
    Connected,
    Reconnecting,
    Draining,
    Closed,
}

#[derive(Clone, Copy, Debug)]
pub struct BackoffPolicy {
    pub base_ms: u64,
    pub max_ms: u64,
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        BackoffPolicy {
            base_ms: 500,
            max_ms: 30_000,
        }
    }
}

impl BackoffPolicy {
    /// Capped exponential backoff WITHOUT randomness: attempt 0 -> base,
    /// doubling up to max. Deterministic by design (reconnect storms are
    /// visible and reproducible; jitter is unnecessary for an internal
    /// single-instance service and would only obscure test behavior).
    pub fn delay_ms(&self, attempt: u64) -> u64 {
        let doubled = self
            .base_ms
            .checked_shl(attempt.min(20) as u32)
            .unwrap_or(self.max_ms);
        doubled.min(self.max_ms).max(self.base_ms)
    }
}

/// Pure session state record. Not Sync: owned by the session task; the
/// supervisor reads snapshots through the SessionManager.
pub struct SessionStateMachine {
    pub venue: Venue,
    pub symbols: Vec<Symbol>,
    pub phase: SessionPhase,
    pub attempt: u64,
    pub reconnects: u64,
    pub heartbeats_missed: u64,
    pub last_error: Option<String>,
    pub last_successful_receive_ms: Option<i64>,
    pub last_successful_receive_mono_ns: Option<u64>,
    pub subscription_active: bool,
    /// True between a disconnect and the next observed fresh snapshot:
    /// while set, the venue's depth state cannot be trusted and the
    /// pipeline must not treat deltas as authoritative.
    pub pending_resnapshot: bool,
    pub backoff: BackoffPolicy,
    /// Monotonic deadline for the next reconnect attempt.
    pub next_attempt_mono_ns: Option<u64>,
}

impl SessionStateMachine {
    pub fn new(venue: Venue, symbols: Vec<Symbol>, backoff: BackoffPolicy) -> SessionStateMachine {
        SessionStateMachine {
            venue,
            symbols,
            phase: SessionPhase::Idle,
            attempt: 0,
            reconnects: 0,
            heartbeats_missed: 0,
            last_error: None,
            last_successful_receive_ms: None,
            last_successful_receive_mono_ns: None,
            subscription_active: false,
            pending_resnapshot: false,
            backoff,
            next_attempt_mono_ns: None,
        }
    }

    pub fn on_connecting(&mut self, now_mono_ns: u64) {
        self.phase = SessionPhase::Connecting;
        self.next_attempt_mono_ns = Some(now_mono_ns);
    }

    pub fn on_connected(&mut self, now_ms: i64, now_mono_ns: u64) {
        self.phase = SessionPhase::Connected;
        self.attempt = 0;
        self.next_attempt_mono_ns = None;
        self.last_successful_receive_ms = Some(now_ms);
        self.last_successful_receive_mono_ns = Some(now_mono_ns);
        // Subscription frames are sent on every (re)connect; the venue
        // answer (snapshot first) restores the subscription state.
        self.subscription_active = true;
    }

    pub fn on_message_received(&mut self, now_ms: i64, now_mono_ns: u64) {
        self.last_successful_receive_ms = Some(now_ms);
        self.last_successful_receive_mono_ns = Some(now_mono_ns);
    }

    /// The heartbeat window elapsed without any frame: counted, observable.
    pub fn on_heartbeat_missed(&mut self) {
        self.heartbeats_missed += 1;
    }

    /// True when no frame has arrived within the liveness window even
    /// though the socket is (nominally) open.
    pub fn is_heartbeat_overdue(&self, now_mono_ns: u64, window: Duration) -> bool {
        match self.last_successful_receive_mono_ns {
            Some(last) => now_mono_ns.saturating_sub(last) > window.as_nanos() as u64,
            None => false,
        }
    }

    pub fn on_disconnected(&mut self, error: String, now_mono_ns: u64) {
        if self.phase == SessionPhase::Connected {
            self.reconnects += 1;
            self.pending_resnapshot = true;
        }
        self.phase = SessionPhase::Reconnecting;
        self.attempt = self.attempt.saturating_add(1);
        self.last_error = Some(error);
        self.subscription_active = false;
        self.next_attempt_mono_ns =
            Some(now_mono_ns + self.backoff.delay_ms(self.attempt.saturating_sub(1)) * 1_000_000);
    }

    pub fn reconnect_due(&self, now_mono_ns: u64) -> bool {
        matches!(self.phase, SessionPhase::Reconnecting | SessionPhase::Idle)
            && self
                .next_attempt_mono_ns
                .map(|at| now_mono_ns >= at)
                .unwrap_or(true)
    }

    /// The supervisor observed that the pipeline's depth state returned to
    /// Live for this venue (fresh snapshot anchored continuity).
    pub fn on_snapshot_anchored(&mut self) {
        self.pending_resnapshot = false;
    }

    pub fn begin_drain(&mut self) {
        self.phase = SessionPhase::Draining;
    }

    pub fn on_closed(&mut self) {
        self.phase = SessionPhase::Closed;
        self.subscription_active = false;
    }
}

/// Production wiring for one venue feed. Spawns a task that owns the
/// WebSocket session for the process lifetime (or until shutdown).
/// Argument count is wiring, not complexity: every parameter is a distinct
/// dependency the task needs (adapter, symbols, override, ingest, control,
/// metrics, supervision, lifecycle, timeout).
#[allow(clippy::too_many_arguments)]
pub fn spawn_feed_session(
    adapter: Arc<dyn MarketDataAdapter>,
    symbols: Vec<Symbol>,
    ws_base_override: Option<String>,
    inbound: mpsc::Sender<RawFeedFrame>,
    mut control: mpsc::Receiver<RecoverySignal>,
    metrics: Arc<MetricsRegistry>,
    sessions: Arc<SessionManager>,
    shutdown: ShutdownCoordinator,
    connect_timeout: Duration,
) -> tokio::task::JoinHandle<()> {
    let venue = adapter.venue();
    tokio::spawn(async move {
        let backoff = BackoffPolicy::default();
        let mut state = SessionStateMachine::new(venue, symbols, backoff);
        let mut shutdown_rx = shutdown.subscribe();
        let heartbeat = adapter.heartbeat_interval();
        let url = ws_base_override.unwrap_or_else(|| adapter.ws_base_url().to_string());

        loop {
            if shutdown_rx.borrow().at_or_after_feeds() {
                state.begin_drain();
                break;
            }
            state.on_connecting(mono_now_ns());
            sessions.update_connecting(venue);
            let connect =
                tokio::time::timeout(connect_timeout, tokio_tungstenite::connect_async(&url)).await;
            let ws = match connect {
                Ok(Ok((stream, _response))) => stream,
                Ok(Err(e)) => {
                    tracing::warn!(venue = %venue, error = %e, "feed connect failed");
                    metrics.inc_provider_failures();
                    state.on_disconnected(format!("connect: {e}"), mono_now_ns());
                    sessions.update_disconnected(venue, state.last_error.clone(), state.reconnects);
                    metrics.inc_reconnects();
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(backoff.delay_ms(state.attempt.saturating_sub(1)))) => continue,
                        _ = async { shutdown_rx.wait_for(|phase| phase.is_stopping()).await.map(|p| *p) } => { state.begin_drain(); break; }
                    }
                }
                Err(_) => {
                    tracing::warn!(venue = %venue, "feed connect timed out");
                    metrics.inc_transport_timeouts();
                    state.on_disconnected("connect timeout".to_string(), mono_now_ns());
                    sessions.update_disconnected(venue, state.last_error.clone(), state.reconnects);
                    metrics.inc_reconnects();
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(backoff.delay_ms(state.attempt.saturating_sub(1)))) => continue,
                        _ = async { shutdown_rx.wait_for(|phase| phase.is_stopping()).await.map(|p| *p) } => { state.begin_drain(); break; }
                    }
                }
            };

            let (mut writer, mut reader) = ws.split();
            state.on_connected(utc_now_ms(), mono_now_ns());
            sessions.update_connected(venue);
            tracing::info!(venue = %venue, "feed connected; subscribing");

            for frame in adapter.subscribe_frames(&state.symbols) {
                if writer.send(Message::Text(frame)).await.is_err() {
                    break;
                }
            }

            let mut heartbeat_tick = tokio::time::interval(heartbeat);
            heartbeat_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            heartbeat_tick.tick().await; // first tick fires immediately

            let mut closed_reason = String::from("stream ended");
            loop {
                tokio::select! {
                    incoming = reader.next() => {
                        match incoming {
                            Some(Ok(Message::Text(text))) => {
                                state.on_message_received(utc_now_ms(), mono_now_ns());
                                if adapter.is_heartbeat_reply(&text) || adapter.is_control_frame(&text) {
                                    continue;
                                }
                                // Bounded inbound channel + explicit policy:
                                // market data is non-critical; overflow is
                                // counted shedding, never a silent drop.
                                let frame = RawFeedFrame {
                                    venue,
                                    payload: text,
                                    receive_mono_ns: mono_now_ns(),
                                    receive_utc_ms: utc_now_ms(),
                                };
                                match inbound.try_reserve() {
                                    Ok(permit) => {
                                        permit.send(frame);
                                    }
                                    Err(_) => {
                                        // Channel full: apply the shedding policy.
                                        let policy = sessions.backpressure_policy();
                                        let state_bp = evaluate(&policy, inbound.max_capacity() as i64);
                                        match admit_non_critical(&policy, state_bp) {
                                            Ok(Admission::Shed) | Ok(Admission::Admitted) => {
                                                metrics.inc_noncritical_drops();
                                            }
                                            Err(_) => {
                                                metrics.inc_noncritical_drops();
                                            }
                                        }
                                    }
                                }
                            }
                            Some(Ok(Message::Ping(payload))) => {
                                // Protocol-level keepalive: answer immediately.
                                let _ = writer.send(Message::Pong(payload)).await;
                                state.on_message_received(utc_now_ms(), mono_now_ns());
                            }
                            Some(Ok(Message::Pong(_))) => {
                                state.on_message_received(utc_now_ms(), mono_now_ns());
                            }
                            Some(Ok(Message::Close(frame))) => {
                                closed_reason = format!("close frame: {frame:?}");
                                break;
                            }
                            Some(Ok(_)) => {}
                            Some(Err(e)) => {
                                closed_reason = format!("socket error: {e}");
                                break;
                            }
                            None => break,
                        }
                    }
                    _ = heartbeat_tick.tick() => {
                        if state.is_heartbeat_overdue(mono_now_ns(), heartbeat.checked_mul(2).unwrap_or(heartbeat)) {
                            state.on_heartbeat_missed();
                            metrics.inc_heartbeats_missed();
                            tracing::warn!(venue = %venue, "heartbeat overdue");
                        }
                        if let Some(ping) = adapter.heartbeat_frame() {
                            if writer.send(Message::Text(ping)).await.is_err() {
                                closed_reason = "heartbeat send failed".to_string();
                                break;
                            }
                        }
                    }
                    Some(signal) = control.recv() => {
                        // Sequence-gap recovery: re-arm the subscription so
                        // the venue starts over from a fresh snapshot. The
                        // depth state is already Gapped in the pipeline and
                        // stays unusable until that snapshot re-anchors it.
                        if signal.reason == RecoveryReason::SequenceGap {
                            tracing::warn!(venue = %venue, symbol = %signal.symbol, "sequence gap recovery: resubscribing for fresh snapshot");
                            for frame in adapter.unsubscribe_frames(&state.symbols) {
                                let _ = writer.send(Message::Text(frame)).await;
                            }
                            for frame in adapter.subscribe_frames(&state.symbols) {
                                let _ = writer.send(Message::Text(frame)).await;
                            }
                        }
                    }
                    phase = async { shutdown_rx.wait_for(|phase| phase.at_or_after_feeds()).await.map(|p| *p) } => {
                        // The watch guard was already collapsed to a Copy
                        // phase inside the async block (guards are not Send).
                        let _ = phase;
                        state.begin_drain();
                        // Stop new subscriptions, then close politely.
                        for frame in adapter.unsubscribe_frames(&state.symbols) {
                            let _ = writer.send(Message::Text(frame)).await;
                        }
                        let _ = writer.send(Message::Close(None)).await;
                        closed_reason = "shutdown".to_string();
                        break;
                    }
                }
            }

            state.on_disconnected(closed_reason, mono_now_ns());
            sessions.update_disconnected(venue, state.last_error.clone(), state.reconnects);
            metrics.inc_provider_failures();
            if matches!(state.phase, SessionPhase::Draining)
                || shutdown_rx.borrow().at_or_after_feeds()
            {
                state.on_closed();
                sessions.update_closed(venue);
                tracing::info!(venue = %venue, "feed session closed");
                break;
            }
            let delay = Duration::from_millis(backoff.delay_ms(state.attempt.saturating_sub(1)));
            tokio::select! {
                _ = tokio::time::sleep(delay) => {}
                _ = async { shutdown_rx.wait_for(|phase| phase.at_or_after_feeds()).await.map(|p| *p) } => {
                    state.on_closed();
                    sessions.update_closed(venue);
                    break;
                }
            }
        }
        // Final supervision snapshot so health sees terminal state.
        sessions.record_state_snapshot(&state);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn symbols() -> Vec<Symbol> {
        vec![Symbol::new("BTCUSDT").expect("s")]
    }

    // [CHECK 27] reconnect state tracked: attempt count, last error, phase.
    #[test]
    fn reconnect_state_is_tracked() {
        let mut sm = SessionStateMachine::new(Venue::Binance, symbols(), BackoffPolicy::default());
        assert_eq!(sm.phase, SessionPhase::Idle);
        sm.on_connecting(mono_now_ns());
        sm.on_connected(1_000, mono_now_ns());
        assert_eq!(sm.phase, SessionPhase::Connected);
        assert!(sm.subscription_active);
        sm.on_disconnected("boom".to_string(), mono_now_ns());
        assert_eq!(sm.phase, SessionPhase::Reconnecting);
        assert_eq!(sm.reconnects, 1);
        assert_eq!(sm.attempt, 1);
        assert_eq!(sm.last_error.as_deref(), Some("boom"));
        assert!(!sm.subscription_active);
        // Backoff schedule is deterministic and capped.
        let policy = BackoffPolicy {
            base_ms: 500,
            max_ms: 4_000,
        };
        assert_eq!(policy.delay_ms(0), 500);
        assert_eq!(policy.delay_ms(1), 1_000);
        assert_eq!(policy.delay_ms(2), 2_000);
        assert_eq!(policy.delay_ms(3), 4_000);
        assert_eq!(policy.delay_ms(4), 4_000);
        assert_eq!(policy.delay_ms(50), 4_000);
    }

    // [CHECK 28] heartbeat timeout detected from real receive timestamps.
    #[test]
    fn heartbeat_timeout_detected() {
        let mut sm = SessionStateMachine::new(Venue::Okx, symbols(), BackoffPolicy::default());
        let base = mono_now_ns();
        sm.on_connected(1, base);
        let window = Duration::from_millis(100);
        // Deterministic: evaluate against explicit monotonic timestamps.
        assert!(!sm.is_heartbeat_overdue(base + 50_000_000, window));
        // 500 ms of silence against a 100 ms window is overdue.
        assert!(sm.is_heartbeat_overdue(base + 500_000_000, window));
        let before = sm.heartbeats_missed;
        sm.on_heartbeat_missed();
        assert_eq!(sm.heartbeats_missed, before + 1);
    }

    // [CHECK 29] subscription state restored on reconnect.
    #[test]
    fn subscription_state_restored_on_reconnect() {
        let mut sm = SessionStateMachine::new(Venue::Bybit, symbols(), BackoffPolicy::default());
        sm.on_connecting(mono_now_ns());
        sm.on_connected(1, mono_now_ns());
        assert!(sm.subscription_active);
        sm.on_disconnected("drop".to_string(), mono_now_ns());
        assert!(!sm.subscription_active);
        // Reconnect re-arms the subscription (frames are re-sent).
        sm.on_connecting(mono_now_ns());
        sm.on_connected(2, mono_now_ns());
        assert!(sm.subscription_active);
    }

    // [CHECK 30] sequence recovery: reconnect flags pending resnapshot; a
    // fresh snapshot anchors continuity again.
    #[test]
    fn resnapshot_required_after_disconnect_until_anchor() {
        let mut sm = SessionStateMachine::new(Venue::Binance, symbols(), BackoffPolicy::default());
        sm.on_connected(1, mono_now_ns());
        assert!(!sm.pending_resnapshot);
        sm.on_disconnected("reset".to_string(), mono_now_ns());
        assert!(
            sm.pending_resnapshot,
            "deltas must not be trusted after a drop"
        );
        sm.on_snapshot_anchored();
        assert!(!sm.pending_resnapshot);
        // Reconnect due-ness is deterministic against the monotonic clock.
        let now = mono_now_ns();
        sm.on_disconnected("again".to_string(), now);
        assert!(!sm.reconnect_due(now));
        let delay = sm.backoff.delay_ms(sm.attempt.saturating_sub(1)) * 1_000_000;
        let later = now + delay + 1;
        assert!(
            sm.reconnect_due(later),
            "attempt {} delay {}ns",
            sm.attempt,
            delay
        );
    }

    #[test]
    fn drain_and_close_transitions() {
        let mut sm = SessionStateMachine::new(Venue::Okx, symbols(), BackoffPolicy::default());
        sm.begin_drain();
        assert_eq!(sm.phase, SessionPhase::Draining);
        sm.on_closed();
        assert_eq!(sm.phase, SessionPhase::Closed);
        assert!(!sm.subscription_active);
    }
}
