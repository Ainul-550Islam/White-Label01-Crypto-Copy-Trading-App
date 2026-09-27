//! Internal health/readiness/liveness.
//!
//! Readiness is EARNED from real conditions — configuration loaded, signing
//! key present, execution-engine schema negotiated, every required venue
//! session actually connected, and backpressure below CRITICAL. Liveness
//! tracks the supervision loop's heartbeat only. Process alive is never
//! equivalent to service ready: a fresh boot is live and NOT ready.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;

use serde::Serialize;

use crate::backpressure::{evaluate, BackpressurePolicy, BackpressureState};
use crate::error::GatewayError;
use crate::metrics::MetricsRegistry;
use crate::session_manager::SessionManager;
use crate::time::{mono_now_ns, utc_now_ms};
use crate::types::Venue;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ReadinessCheck {
    pub name: &'static str,
    pub ok: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReadinessReport {
    pub ready: bool,
    pub environment: String,
    pub checks: Vec<ReadinessCheck>,
    pub observed_at_ms: i64,
}

pub struct HealthService {
    started_ms: i64,
    config_loaded: AtomicBool,
    signing_key_present: AtomicBool,
    engine_schema_negotiated: AtomicBool,
    sessions: Arc<SessionManager>,
    required_venues: Vec<Venue>,
    policy: BackpressurePolicy,
    /// Monotonic timestamp of the last supervision-loop tick (liveness).
    last_tick_mono_ns: AtomicI64,
    metrics: Arc<MetricsRegistry>,
}

/// Liveness window: if the supervision loop has not ticked for this long,
/// the process may still be alive but its control loop is not — report it.
pub const LIVENESS_WINDOW: std::time::Duration = std::time::Duration::from_secs(30);

impl HealthService {
    pub fn new(
        sessions: Arc<SessionManager>,
        required_venues: Vec<Venue>,
        policy: BackpressurePolicy,
        metrics: Arc<MetricsRegistry>,
    ) -> HealthService {
        HealthService {
            started_ms: utc_now_ms(),
            config_loaded: AtomicBool::new(false),
            signing_key_present: AtomicBool::new(false),
            engine_schema_negotiated: AtomicBool::new(false),
            sessions,
            required_venues,
            policy,
            last_tick_mono_ns: AtomicI64::new(mono_now_ns() as i64),
            metrics,
        }
    }

    pub fn mark_config_loaded(&self) {
        self.config_loaded.store(true, Ordering::Relaxed);
    }

    pub fn mark_signing_key_present(&self) {
        self.signing_key_present.store(true, Ordering::Relaxed);
    }

    pub fn mark_engine_schema_negotiated(&self) {
        self.engine_schema_negotiated.store(true, Ordering::Relaxed);
    }

    /// The supervision loop calls this on every pass.
    pub fn record_supervision_tick(&self) {
        self.last_tick_mono_ns
            .store(mono_now_ns() as i64, Ordering::Relaxed);
    }

    /// Liveness: the process and its supervision loop are functioning.
    /// Deliberately weak — it is NOT readiness.
    pub fn liveness(&self) -> bool {
        let last = self.last_tick_mono_ns.load(Ordering::Relaxed);
        last >= 0
            && (mono_now_ns() as i64).saturating_sub(last) <= LIVENESS_WINDOW.as_nanos() as i64
    }

    /// Readiness: earned from real subsystem state, checked fresh on every
    /// call. No caching, no "healthy because booted".
    pub fn readiness(&self, environment: &str) -> ReadinessReport {
        let mut checks = Vec::with_capacity(5);

        checks.push(ReadinessCheck {
            name: "configuration_loaded",
            ok: self.config_loaded.load(Ordering::Relaxed),
            detail: "gateway configuration passed strict validation at boot".to_string(),
        });
        checks.push(ReadinessCheck {
            name: "signing_key_present",
            ok: self.signing_key_present.load(Ordering::Relaxed),
            detail: "intent HMAC key resolved from secret infrastructure (value never logged)"
                .to_string(),
        });
        checks.push(ReadinessCheck {
            name: "execution_engine_schema_negotiated",
            ok: self.engine_schema_negotiated.load(Ordering::Relaxed),
            detail: "transport schema negotiated with the execution engine".to_string(),
        });

        let connected = self
            .required_venues
            .iter()
            .filter(|v| {
                self.sessions
                    .all_required_connected(std::slice::from_ref(v))
            })
            .count();
        checks.push(ReadinessCheck {
            name: "required_feed_sessions_connected",
            ok: connected == self.required_venues.len(),
            detail: format!(
                "{connected}/{} required venue sessions connected",
                self.required_venues.len()
            ),
        });

        let depth = self.metrics.queue_depth();
        let state = evaluate(&self.policy, depth);
        checks.push(ReadinessCheck {
            name: "backpressure_below_critical",
            ok: state < BackpressureState::Critical,
            detail: format!("queue depth {depth} in state {:?}", state),
        });

        let ready = checks.iter().all(|c| c.ok);
        ReadinessReport {
            ready,
            environment: environment.to_string(),
            checks,
            observed_at_ms: utc_now_ms(),
        }
    }

    pub fn started_ms(&self) -> i64 {
        self.started_ms
    }

    /// Accessor for route handlers that need the metrics registry too.
    pub fn metrics_ref(&self) -> &MetricsRegistry {
        &self.metrics
    }
}

/// Tiny JSON/HTTP responder used by the internal listener. Request parsing
/// is deliberately minimal: method + path, no bodies, internal only.
pub fn route_internal_get(
    path: &str,
    health: &HealthService,
    metrics: &MetricsRegistry,
    environment: &str,
) -> Result<(u16, String), GatewayError> {
    match path {
        "/healthz" => {
            let live = health.liveness();
            Ok((
                if live { 200 } else { 503 },
                serde_json::json!({
                    "service": "low-latency-gateway",
                    "liveness": live,
                    "started_at_ms": health.started_ms(),
                    "observed_at_ms": utc_now_ms(),
                })
                .to_string(),
            ))
        }
        "/readyz" => {
            let report = health.readiness(environment);
            Ok((
                if report.ready { 200 } else { 503 },
                serde_json::to_string(&report).expect("readiness serializes"),
            ))
        }
        "/metrics" => Ok((200, metrics.render_text())),
        "/schema" => Ok((
            200,
            serde_json::to_string(&crate::transport_protocol::SchemaAdvertisement::gateway())
                .expect("schema advertisement serializes"),
        )),
        other => Err(GatewayError::MalformedData(format!(
            "unknown internal path '{other}'"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Symbol;

    fn health() -> (HealthService, Arc<SessionManager>) {
        let sessions = Arc::new(SessionManager::new(BackpressurePolicy::default()));
        for venue in Venue::ALL {
            sessions.register(venue, vec![Symbol::new("BTCUSDT").expect("s")]);
        }
        let svc = HealthService::new(
            Arc::clone(&sessions),
            vec![Venue::Binance],
            BackpressurePolicy::default(),
            Arc::new(MetricsRegistry::new()),
        );
        svc.record_supervision_tick();
        (svc, sessions)
    }

    // [CHECK 44] readiness differs from process liveness.
    #[test]
    fn fresh_boot_is_live_but_not_ready() {
        let (svc, _sessions) = health();
        assert!(svc.liveness(), "supervision loop ticked; process is live");
        let report = svc.readiness("development");
        assert!(!report.ready, "nothing is wired yet; must not claim ready");
        let names: Vec<&str> = report.checks.iter().map(|c| c.name).collect();
        assert!(names.contains(&"configuration_loaded"));
        assert!(names.contains(&"required_feed_sessions_connected"));
        assert!(report.checks.iter().any(|c| !c.ok));
    }

    // [CHECK 43] readiness uses REAL session state, not self-declaration.
    #[test]
    fn readiness_tracks_real_session_state() {
        let (svc, sessions) = health();
        svc.mark_config_loaded();
        svc.mark_signing_key_present();
        svc.mark_engine_schema_negotiated();
        // Sessions not connected yet.
        assert!(!svc.readiness("development").ready);
        sessions.update_connected(Venue::Binance);
        let report = svc.readiness("development");
        assert!(report.ready, "all real conditions met: {report:?}");

        // A drop in the session flips readiness back without any restart.
        sessions.update_disconnected(Venue::Binance, Some("reset".into()), 1);
        assert!(!svc.readiness("development").ready);
    }

    // Critical backpressure flips readiness off (fail closed surface).
    #[test]
    fn critical_backpressure_blocks_readiness() {
        let (svc, sessions) = health();
        svc.mark_config_loaded();
        svc.mark_signing_key_present();
        svc.mark_engine_schema_negotiated();
        sessions.update_connected(Venue::Binance);
        svc.metrics.set_queue_depth(4_096);
        let report = svc.readiness("development");
        assert!(!report.ready);
        svc.metrics.set_queue_depth(4_095);
        assert!(svc.readiness("development").ready);
    }

    // Liveness decays when the supervision loop stops ticking.
    #[test]
    fn liveness_requires_a_fresh_supervision_tick() {
        let (svc, _sessions) = health();
        assert!(svc.liveness());
        // Date the last tick 31s in the past of the current monotonic
        // reading: no matter how fast the test runs, the window (30s) is
        // exceeded deterministically.
        svc.last_tick_mono_ns
            .store(mono_now_ns() as i64 - 31_000_000_000, Ordering::Relaxed);
        assert!(
            !svc.liveness(),
            "supervision loop silent for 31s+; not live"
        );
    }

    // Internal routes: health/readiness/metrics/schema only.
    #[test]
    fn internal_routes_are_exhaustive_and_safe() {
        let (svc, sessions) = health();
        svc.mark_config_loaded();
        svc.mark_signing_key_present();
        svc.mark_engine_schema_negotiated();
        sessions.update_connected(Venue::Binance);
        let (code, body) = route_internal_get("/healthz", &svc, svc.metrics_ref(), "development")
            .expect("healthz");
        assert_eq!(code, 200);
        assert!(body.contains("\"liveness\":true"));
        let (code, body) =
            route_internal_get("/readyz", &svc, svc.metrics_ref(), "development").expect("readyz");
        assert_eq!(code, 200);
        assert!(body.contains("\"ready\":true"));
        let (code, body) = route_internal_get("/metrics", &svc, svc.metrics_ref(), "development")
            .expect("metrics");
        assert_eq!(code, 200);
        assert!(body.contains("lle_events_received_total"));
        let (code, _) =
            route_internal_get("/schema", &svc, svc.metrics_ref(), "development").expect("schema");
        assert_eq!(code, 200);

        // [CHECK 60] the gateway is an INTERNAL-ONLY service: its entire
        // HTTP surface is {/healthz, /readyz, /metrics, /schema} plus the
        // execution POST route. Customer-facing or order-style paths do not
        // exist here — every other path is an error, never a handler.
        for forbidden in [
            "/orders",
            "/intents",
            "/internal/v1/transport/intents",
            "/api/v1/account",
            "/positions",
            "/ws",
        ] {
            assert!(matches!(
                route_internal_get(forbidden, &svc, svc.metrics_ref(), "development"),
                Err(GatewayError::MalformedData(_))
            ));
        }
        assert!(matches!(
            route_internal_get("/executeme", &svc, svc.metrics_ref(), "development"),
            Err(GatewayError::MalformedData(_))
        ));
    }
}
