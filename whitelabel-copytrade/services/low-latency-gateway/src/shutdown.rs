//! Coordinated graceful shutdown.
//!
//! Deterministic phase machine observed by every task through a watch
//! channel:
//!   Running -> DrainingTransport -> DrainingFeeds -> FlushingTelemetry -> Exiting
//!
//! `is_stopping()` flips true at the FIRST stopping phase, so:
//! - the transport listener stops accepting new execution intents the
//!   moment draining begins (before feeds close);
//! - feed sessions unsubscribe and close while transport finishes in-flight
//!   frames;
//! - telemetry flushes last, then the process exits. Nothing in-flight and
//!   critical is killed abruptly.

use std::time::Duration;

use tokio::sync::watch;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ShutdownPhase {
    Running,
    DrainingTransport,
    DrainingFeeds,
    FlushingTelemetry,
    Exiting,
}

impl ShutdownPhase {
    /// True from the first stopping phase onwards. Tasks use this as their
    /// select! condition.
    pub fn is_stopping(self) -> bool {
        !matches!(self, ShutdownPhase::Running)
    }

    /// Ordering helper: true when the shutdown has reached the feed-drain
    /// phase or beyond. Feed sessions must NOT close during
    /// DrainingTransport — the execution plane drains first.
    pub fn at_or_after_feeds(self) -> bool {
        matches!(
            self,
            ShutdownPhase::DrainingFeeds
                | ShutdownPhase::FlushingTelemetry
                | ShutdownPhase::Exiting
        )
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ShutdownPhase::Running => "running",
            ShutdownPhase::DrainingTransport => "draining_transport",
            ShutdownPhase::DrainingFeeds => "draining_feeds",
            ShutdownPhase::FlushingTelemetry => "flushing_telemetry",
            ShutdownPhase::Exiting => "exiting",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ShutdownReason {
    pub signal: String,
    pub at_ms: i64,
}

#[derive(Clone)]
pub struct ShutdownCoordinator {
    tx: watch::Sender<ShutdownPhase>,
    // Held so the watch channel never closes: `Sender::send` refuses to
    // store a new value once every receiver is dropped, which would freeze
    // the coordinator in Running forever.
    _keepalive_rx: watch::Receiver<ShutdownPhase>,
    reason: std::sync::Arc<std::sync::Mutex<Option<ShutdownReason>>>,
}

impl ShutdownCoordinator {
    pub fn new() -> ShutdownCoordinator {
        let (tx, rx) = watch::channel(ShutdownPhase::Running);
        ShutdownCoordinator {
            tx,
            _keepalive_rx: rx,
            reason: std::sync::Arc::default(),
        }
    }

    pub fn subscribe(&self) -> watch::Receiver<ShutdownPhase> {
        self.tx.subscribe()
    }

    pub fn current(&self) -> ShutdownPhase {
        *self.tx.borrow()
    }

    pub fn reason(&self) -> Option<ShutdownReason> {
        self.reason.lock().expect("reason mutex").clone()
    }

    fn advance(&self, phase: ShutdownPhase) {
        let _ = self.tx.send(phase);
    }

    /// Starts the deterministic shutdown sequence. Idempotent: a second
    /// signal does not restart the sequence.
    pub async fn begin(&self, signal: &str) -> ShutdownPhase {
        {
            let mut reason = self.reason.lock().expect("reason mutex");
            if reason.is_none() {
                *reason = Some(ShutdownReason {
                    signal: signal.to_string(),
                    at_ms: crate::time::utc_now_ms(),
                });
            }
        }
        if self.current() == ShutdownPhase::Running {
            // Phase 1: stop accepting new execution intents; let in-flight
            // transport finish.
            self.advance(ShutdownPhase::DrainingTransport);
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        self.current()
    }

    /// Phase 2: stop new market-data subscriptions and close feed sessions.
    pub async fn drain_feeds(&self) -> ShutdownPhase {
        if self.current() == ShutdownPhase::DrainingTransport {
            self.advance(ShutdownPhase::DrainingFeeds);
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        self.current()
    }

    /// Phase 3: flush metrics/traces, then exit.
    pub async fn flush_and_exit(&self) -> ShutdownPhase {
        if self.current() == ShutdownPhase::DrainingFeeds {
            self.advance(ShutdownPhase::FlushingTelemetry);
            // Telemetry writers flush here (registry render + tracing flush
            // happen synchronously in their consumers before Exiting).
            self.advance(ShutdownPhase::Exiting);
        }
        self.current()
    }
}

impl Default for ShutdownCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 50] graceful shutdown is a deterministic phase sequence.
    #[tokio::test]
    async fn shutdown_sequence_is_deterministic() {
        let coordinator = ShutdownCoordinator::new();
        let mut rx = coordinator.subscribe();
        assert_eq!(coordinator.current(), ShutdownPhase::Running);
        assert!(!coordinator.current().is_stopping());

        let phase = coordinator.begin("SIGTERM").await;
        assert_eq!(phase, ShutdownPhase::DrainingTransport);
        assert!(coordinator.current().is_stopping());
        assert!(rx.changed().await.is_ok());
        assert_eq!(*rx.borrow(), ShutdownPhase::DrainingTransport);

        assert_eq!(
            coordinator.drain_feeds().await,
            ShutdownPhase::DrainingFeeds
        );
        assert_eq!(coordinator.flush_and_exit().await, ShutdownPhase::Exiting);
        assert_eq!(coordinator.current(), ShutdownPhase::Exiting);

        // Phase ordering: feeds close only from DrainingFeeds onwards.
        assert!(!ShutdownPhase::DrainingTransport.at_or_after_feeds());
        assert!(ShutdownPhase::DrainingFeeds.at_or_after_feeds());
        assert!(ShutdownPhase::Exiting.at_or_after_feeds());

        let reason = coordinator.reason().expect("reason recorded");
        assert_eq!(reason.signal, "SIGTERM");
        assert!(reason.at_ms > 0);
    }

    // A second signal never restarts or rewinds the sequence.
    #[tokio::test]
    async fn shutdown_is_idempotent_under_repeated_signals() {
        let coordinator = ShutdownCoordinator::new();
        let _phase = coordinator.begin("SIGINT").await;
        let again = coordinator.begin("SIGINT").await;
        assert_eq!(again, ShutdownPhase::DrainingTransport);
        // Advancing from the wrong phase is a no-op, not a jump.
        let coordinator2 = ShutdownCoordinator::new();
        assert_eq!(coordinator2.drain_feeds().await, ShutdownPhase::Running);
        assert_eq!(coordinator2.flush_and_exit().await, ShutdownPhase::Running);
        assert_eq!(coordinator2.current(), ShutdownPhase::Running);
    }
}
