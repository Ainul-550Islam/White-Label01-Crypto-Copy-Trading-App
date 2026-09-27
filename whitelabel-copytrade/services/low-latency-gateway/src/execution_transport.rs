//! Execution transport admission service.
//!
//! The gateway's execution plane: accepts ONLY canonical, HMAC-signed
//! `ExecutionIntentEnvelope` frames from the execution engine and converts
//! them into venue-ready transport requests.
//!
//! Admission order is deterministic and fail-closed:
//!   1. size limit          -> RejectedMalformed
//!   2. envelope parse      -> RejectedMalformed
//!   3. schema version      -> RejectedSchemaVersion
//!   4. frame type          -> RejectedMalformed
//!   5. intent shape        -> RejectedMalformed
//!   6. source service      -> RejectedUnauthorizedSource
//!   7. key id              -> RejectedUnauthorizedSource
//!   8. HMAC integrity      -> RejectedIntegrity
//!   9. expiry              -> RejectedStaleIntent
//!  10. replay check        -> IdempotentReplay (deterministic re-answer)
//!  11. authorization meta  -> RejectedUnauthorizedSource (enforcement)
//!  12. backpressure        -> RejectedBackpressure (critical admission)
//!  13. venue preparation   -> RejectedCapability / RejectedUnauthorizedSource
//!  14. engine submission   -> TransportFailure or acceptance
//!
//! Authority boundary (hard): this plane NEVER approves risk, NEVER marks
//! an order FILLED, NEVER mutates position/PnL truth, and NEVER bypasses
//! the OMS/Risk/Compliance/Live Gate. It only validates presented
//! authorization metadata and moves the signed intent across the transport
//! boundary. Every rejection is counted and idempotently cached per intent.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use crate::backpressure::{admit_critical, evaluate, BackpressurePolicy, BackpressureState};
use crate::error::GatewayError;
use crate::execution_prepare::ExecutionPreparer;
use crate::metrics::MetricsRegistry;
use crate::time::{mono_elapsed_ns, mono_now_ns, utc_now_ms};
use crate::transport_protocol::{
    verify_intent, TransportFrame, SOURCE_SERVICE_EXECUTION_ENGINE, TRANSPORT_SCHEMA_VERSION,
};
use crate::types::{
    AckStatus, ExecutionIntentEnvelope, TransportAck, VenueOrderRequest, MAX_INTENT_FRAME_BYTES,
};

/// Replay/idempotency cache: intent_id -> (status given, when). Bounded by
/// capacity; oldest entries evicted FIFO (newest intents matter most for
/// dedup under retry storms).
pub struct ReplayCache {
    map: HashMap<String, (AckStatus, i64)>,
    order: VecDeque<String>,
    capacity: usize,
}

impl ReplayCache {
    pub fn new(capacity: usize) -> ReplayCache {
        ReplayCache {
            map: HashMap::new(),
            order: VecDeque::new(),
            capacity: capacity.max(1),
        }
    }

    pub fn get(&self, intent_id: &str) -> Option<&AckStatus> {
        self.map.get(intent_id).map(|(status, _)| status)
    }

    pub fn remember(&mut self, intent_id: &str, status: AckStatus) {
        if self.map.contains_key(intent_id) {
            return;
        }
        while self.order.len() >= self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
        self.order.push_back(intent_id.to_string());
        self.map
            .insert(intent_id.to_string(), (status, utc_now_ms()));
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

pub struct ExecutionTransportService {
    preparer: ExecutionPreparer,
    key_id: String,
    intent_hmac_key: Vec<u8>,
    ttl_margin_ms: i64,
    policy: BackpressurePolicy,
    metrics: Arc<MetricsRegistry>,
    replay: Mutex<ReplayCache>,
    /// Current in-flight execution-connection depth, observed from the
    /// listener; drives backpressure admission for CRITICAL traffic.
    in_flight_depth: Arc<AtomicI64>,
    /// Latency ring for observe-only admission histograms.
    admission_ring: crate::ring_buffer::RingBuffer<u64>,
}

impl ExecutionTransportService {
    pub fn new(
        preparer: ExecutionPreparer,
        key_id: String,
        intent_hmac_key: Vec<u8>,
        ttl_margin_ms: i64,
        replay_capacity: usize,
        policy: BackpressurePolicy,
        metrics: Arc<MetricsRegistry>,
    ) -> ExecutionTransportService {
        ExecutionTransportService {
            preparer,
            key_id,
            intent_hmac_key,
            ttl_margin_ms,
            policy,
            metrics,
            replay: Mutex::new(ReplayCache::new(replay_capacity)),
            in_flight_depth: Arc::new(AtomicI64::new(0)),
            admission_ring: crate::ring_buffer::RingBuffer::bounded(4096),
        }
    }

    pub fn in_flight_depth_gauge(&self) -> Arc<AtomicI64> {
        Arc::clone(&self.in_flight_depth)
    }

    pub fn replay_cache_len(&self) -> usize {
        self.replay.lock().expect("replay mutex").len()
    }

    fn reject(
        &self,
        intent_id: &str,
        correlation_id: &str,
        status: AckStatus,
        detail: String,
        cache_it: bool,
    ) -> TransportAck {
        self.metrics.inc_intent_rejections();
        if cache_it {
            self.replay
                .lock()
                .expect("replay mutex")
                .remember(intent_id, status);
        }
        tracing::warn!(intent = %intent_id, status = status.as_str(), detail = %detail, "intent rejected");
        TransportAck::new(intent_id, correlation_id, status, utc_now_ms()).with_detail(detail)
    }

    /// Validation up to (and including) venue preparation. Deterministic
    /// and unit-testable without any network.
    pub fn validate_and_prepare(
        &self,
        body: &[u8],
    ) -> Result<(TransportFrame, ExecutionIntentEnvelope, VenueOrderRequest), TransportAck> {
        // 1. size limit.
        if body.len() > MAX_INTENT_FRAME_BYTES {
            return Err(self.reject(
                "unknown",
                "unknown",
                AckStatus::RejectedMalformed,
                format!(
                    "frame of {} bytes exceeds the {} byte limit",
                    body.len(),
                    MAX_INTENT_FRAME_BYTES
                ),
                false,
            ));
        }

        // 2. envelope parse.
        let text = std::str::from_utf8(body).map_err(|_| {
            self.reject(
                "unknown",
                "unknown",
                AckStatus::RejectedMalformed,
                "frame is not UTF-8".to_string(),
                false,
            )
        })?;
        let frame: TransportFrame = match serde_json::from_str(text) {
            Ok(frame) => frame,
            Err(e) => {
                return Err(self.reject(
                    "unknown",
                    "unknown",
                    AckStatus::RejectedMalformed,
                    format!("frame does not parse: {e}"),
                    false,
                ));
            }
        };

        // 3. schema version.
        if frame.schema_version != TRANSPORT_SCHEMA_VERSION {
            return Err(self.reject(
                "unknown",
                &frame.correlation_id,
                AckStatus::RejectedSchemaVersion,
                format!(
                    "frame schema {} != supported {}",
                    frame.schema_version, TRANSPORT_SCHEMA_VERSION
                ),
                false,
            ));
        }

        // 4. frame type.
        if frame.frame_type != "intent" {
            return Err(self.reject(
                "unknown",
                &frame.correlation_id,
                AckStatus::RejectedMalformed,
                format!("unsupported frame_type '{}'", frame.frame_type),
                false,
            ));
        }

        // 5. intent parse + shape.
        let envelope: ExecutionIntentEnvelope = match serde_json::from_value(frame.payload.clone())
        {
            Ok(envelope) => envelope,
            Err(e) => {
                return Err(self.reject(
                    "unknown",
                    &frame.correlation_id,
                    AckStatus::RejectedMalformed,
                    format!("intent does not parse: {e}"),
                    false,
                ));
            }
        };
        if let Err(e) = envelope.validate_shape() {
            return Err(self.reject(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::RejectedMalformed,
                format!("intent shape invalid: {}", e.kind()),
                false,
            ));
        }

        // 6. source service.
        if envelope.source_service != SOURCE_SERVICE_EXECUTION_ENGINE {
            return Err(self.reject(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::RejectedUnauthorizedSource,
                format!(
                    "source_service '{}' is not authorized",
                    envelope.source_service
                ),
                false,
            ));
        }

        // 7. key id.
        if envelope.key_id != self.key_id {
            return Err(self.reject(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::RejectedUnauthorizedSource,
                format!(
                    "key_id '{}' is not the active transport key",
                    envelope.key_id
                ),
                false,
            ));
        }

        // 8. HMAC integrity (constant-time compare inside).
        if let Err(e) = verify_intent(&self.intent_hmac_key, &envelope) {
            return Err(self.reject(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::RejectedIntegrity,
                format!("signature verification failed: {}", e.kind()),
                false,
            ));
        }

        // 9. replay check — deterministic idempotent answer. A cached
        // decision is replayed VERBATIM (even for an intent that has since
        // expired): same intent id in, same answer out, every time.
        if let Some(previous) = self
            .replay
            .lock()
            .expect("replay mutex")
            .get(&envelope.intent_id)
        {
            self.metrics.inc_intent_replays();
            return Err(TransportAck::new(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::IdempotentReplay,
                utc_now_ms(),
            )
            .with_detail(format!(
                "intent already answered with {}",
                previous.as_str()
            )));
        }

        // 10. expiry: reject when the usable window is gone (creation time
        // and margin define the window; margin covers transport latency).
        let now = utc_now_ms();
        if envelope.expires_at_ms - self.ttl_margin_ms <= now {
            return Err(self.reject(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::RejectedStaleIntent,
                format!(
                    "intent expires_at {} (+ margin {}) is not in the future (now {now})",
                    envelope.expires_at_ms, self.ttl_margin_ms
                ),
                true,
            ));
        }

        // 11. authorization metadata (enforcement, not decision).
        if !envelope.authorizations.risk_approved || !envelope.authorizations.compliance_approved {
            return Err(self.reject(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::RejectedUnauthorizedSource,
                "intent is missing upstream risk/compliance authorization".to_string(),
                true,
            ));
        }
        if envelope.authorizations.oms_order_ref.trim().is_empty() {
            return Err(self.reject(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::RejectedUnauthorizedSource,
                "intent is missing an OMS order reference".to_string(),
                true,
            ));
        }

        // 12. backpressure admission for critical traffic.
        let depth = self.in_flight_depth.load(Ordering::Relaxed);
        let state: BackpressureState = evaluate(&self.policy, depth);
        if admit_critical(&self.policy, state).is_err() {
            return Err(self.reject(
                &envelope.intent_id,
                &frame.correlation_id,
                AckStatus::RejectedBackpressure,
                format!("execution admission refused at depth {depth}"),
                false,
            ));
        }

        // 13. venue preparation.
        let started = mono_now_ns();
        let request = match self.preparer.prepare(&envelope) {
            Ok(request) => request,
            Err(GatewayError::UnsupportedCapability(detail)) => {
                return Err(self.reject(
                    &envelope.intent_id,
                    &frame.correlation_id,
                    AckStatus::RejectedCapability,
                    detail,
                    false,
                ));
            }
            Err(GatewayError::AuthorizationFailure(detail)) => {
                return Err(self.reject(
                    &envelope.intent_id,
                    &frame.correlation_id,
                    AckStatus::RejectedUnauthorizedSource,
                    detail,
                    false,
                ));
            }
            Err(e) => {
                return Err(self.reject(
                    &envelope.intent_id,
                    &frame.correlation_id,
                    AckStatus::RejectedMalformed,
                    format!("preparation failed: {}", e.kind()),
                    false,
                ));
            }
        };
        self.admission_ring
            .try_push(mono_elapsed_ns(started, mono_now_ns()))
            .ok();

        Ok((frame, envelope, request))
    }

    /// Full admission: validation + onward submission to the execution
    /// engine. The returned ack is the authoritative transport answer.
    pub async fn admit_frame(
        &self,
        engine: &crate::execution_engine::ExecutionEngineClient,
        body: &[u8],
    ) -> TransportAck {
        let started = mono_now_ns();
        match self.validate_and_prepare(body) {
            Err(ack) => ack,
            Ok((frame, envelope, request)) => match engine
                .submit_prepared(&request, &frame.correlation_id)
                .await
            {
                Ok(ack) => {
                    self.metrics.inc_intents_accepted();
                    self.replay
                        .lock()
                        .expect("replay mutex")
                        .remember(&envelope.intent_id, ack.status);
                    let _ = mono_elapsed_ns(started, mono_now_ns());
                    tracing::info!(intent = %envelope.intent_id, status = ack.status.as_str(), "intent transported");
                    ack
                }
                Err(e) => {
                    // Engine failure is NOT cached: the same intent may be
                    // retried legitimately. It is also NEVER a success.
                    self.metrics.inc_intent_rejections();
                    tracing::error!(intent = %envelope.intent_id, error = e.kind(), "engine transport failed");
                    TransportAck::new(
                        &envelope.intent_id,
                        &frame.correlation_id,
                        AckStatus::TransportFailure,
                        utc_now_ms(),
                    )
                    .with_detail(format!("execution-engine transport failed: {}", e.kind()))
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backpressure::BackpressurePolicy;
    use crate::execution_prepare::{ExecutionPreparer, VenuePrecisionRule};
    use crate::session_manager::SessionManager;
    use crate::transport_protocol::sign_intent;
    use crate::types::{Fixed, IntentAuthorizations, OrderSide, Symbol, Venue};

    const KEY: &[u8] = b"transport-test-key-0123456789abcdef";

    fn service() -> ExecutionTransportService {
        let sessions = Arc::new(SessionManager::new(BackpressurePolicy::default()));
        for venue in Venue::ALL {
            sessions.register(venue, Vec::new());
            sessions.update_connected(venue);
        }
        let preparer = ExecutionPreparer::new(
            Arc::clone(&sessions),
            vec![Venue::Binance, Venue::Bybit, Venue::Okx],
        );
        ExecutionTransportService::new(
            preparer,
            "exec-engine-2026-09".to_string(),
            KEY.to_vec(),
            0,
            128,
            BackpressurePolicy::default(),
            Arc::new(MetricsRegistry::new()),
        )
    }

    fn signed_intent() -> ExecutionIntentEnvelope {
        let mut envelope = ExecutionIntentEnvelope {
            schema_version: TRANSPORT_SCHEMA_VERSION,
            intent_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7".to_string(),
            correlation_id: "corr-admission-1".to_string(),
            created_at_ms: utc_now_ms(),
            expires_at_ms: utc_now_ms() + 10_000,
            tenant_id: "tenant-77".to_string(),
            account_id: "acct-42".to_string(),
            venue: Venue::Binance,
            symbol: Symbol::new("BTCUSDT").expect("sym"),
            side: OrderSide::Buy,
            quantity_text: "0.250".to_string(),
            quantity: Fixed::parse("0.250").expect("qty"),
            nonce: "nonce-admission-1".to_string(),
            key_id: "exec-engine-2026-09".to_string(),
            signature_hex: String::new(),
            source_service: SOURCE_SERVICE_EXECUTION_ENGINE.to_string(),
            authorizations: IntentAuthorizations {
                risk_approved: true,
                compliance_approved: true,
                oms_order_ref: "OMS-1001".to_string(),
            },
        };
        envelope.signature_hex = sign_intent(KEY, &envelope);
        envelope
    }

    fn frame_json(
        envelope: &ExecutionIntentEnvelope,
        frame_type: &str,
        schema_version: u32,
    ) -> String {
        let frame = TransportFrame {
            schema_version,
            correlation_id: envelope.correlation_id.clone(),
            frame_type: frame_type.to_string(),
            sent_at_ms: utc_now_ms(),
            payload: serde_json::to_value(envelope).expect("envelope json"),
        };
        serde_json::to_string(&frame).expect("frame json")
    }

    // [CHECK 31] accepted signed envelope passes validation into a venue
    // request.
    #[test]
    fn signed_envelope_is_accepted_for_transport() {
        let service = service();
        let (frame, envelope, request) = service
            .validate_and_prepare(
                frame_json(&signed_intent(), "intent", TRANSPORT_SCHEMA_VERSION).as_bytes(),
            )
            .expect("accepted");
        assert_eq!(frame.frame_type, "intent");
        assert_eq!(envelope.correlation_id, "corr-admission-1");
        assert_eq!(request.venue, Venue::Binance);
        assert!(request.client_order_id.starts_with("LLE-"));
        assert_eq!(
            service.replay_cache_len(),
            0,
            "validation alone caches nothing"
        );
    }

    // [CHECK 51 support] wrong schema version -> RejectedSchemaVersion.
    #[test]
    fn schema_version_mismatch_is_rejected() {
        let service = service();
        let ack = service
            .validate_and_prepare(
                frame_json(&signed_intent(), "intent", TRANSPORT_SCHEMA_VERSION + 1).as_bytes(),
            )
            .expect_err("schema mismatch");
        assert_eq!(ack.status, AckStatus::RejectedSchemaVersion);
    }

    // [CHECK 32] replayed intent -> IdempotentReplay, deterministic.
    #[test]
    fn duplicate_intent_is_idempotent_replay() {
        let service = service();
        let body = frame_json(&signed_intent(), "intent", TRANSPORT_SCHEMA_VERSION);
        // First pass caches a decision (simulate an acceptance).
        service
            .replay
            .lock()
            .expect("m")
            .remember(&signed_intent().intent_id, AckStatus::AcceptedForTransport);
        let ack = service
            .validate_and_prepare(body.as_bytes())
            .expect_err("replayed");
        assert_eq!(ack.status, AckStatus::IdempotentReplay);
        assert!(ack
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("accepted_for_transport"));
        assert_eq!(
            service
                .metrics
                .execution_intent_replays_total
                .load(Ordering::Relaxed),
            1
        );
    }

    // [CHECK 33] expired intent -> RejectedStaleIntent, counted, cached.
    #[test]
    fn expired_intent_is_rejected_stale() {
        let service = service();
        let mut stale = signed_intent();
        stale.created_at_ms = utc_now_ms() - 5_000;
        stale.expires_at_ms = utc_now_ms() - 1_000;
        stale.signature_hex = sign_intent(KEY, &stale);
        let body = frame_json(&stale, "intent", TRANSPORT_SCHEMA_VERSION);
        let ack = service
            .validate_and_prepare(body.as_bytes())
            .expect_err("stale");
        assert_eq!(ack.status, AckStatus::RejectedStaleIntent);
        assert!(
            service
                .metrics
                .execution_intent_rejections_total
                .load(Ordering::Relaxed)
                >= 1
        );
        assert_eq!(
            service.replay_cache_len(),
            1,
            "stale decision cached idempotently"
        );
        // Replay answers deterministically without re-verification.
        let ack = service
            .validate_and_prepare(body.as_bytes())
            .expect_err("replay");
        assert_eq!(ack.status, AckStatus::IdempotentReplay);
    }

    // [CHECK 31 support] integrity failure -> RejectedIntegrity.
    #[test]
    fn tampered_intent_is_rejected_integrity() {
        let service = service();
        let mut tampered = signed_intent();
        tampered.quantity_text = "9.999".to_string();
        tampered.quantity = Fixed::parse("9.999").expect("qty");
        // Re-sign with a DIFFERENT key: receiver-side mismatch.
        tampered.signature_hex = sign_intent(b"a-totally-different-key-material!", &tampered);
        let body = frame_json(&tampered, "intent", TRANSPORT_SCHEMA_VERSION);
        let ack = service
            .validate_and_prepare(body.as_bytes())
            .expect_err("integrity");
        assert_eq!(ack.status, AckStatus::RejectedIntegrity);
    }

    // [CHECK 34] malformed frames -> RejectedMalformed (parse failures with
    // no fabricated events).
    #[test]
    fn malformed_frames_are_rejected() {
        let service = service();
        for bad in [
            "not json".to_string(),
            "{}".to_string(),
            serde_json::json!({"schema_version": TRANSPORT_SCHEMA_VERSION, "correlation_id": "c", "frame_type": "intent", "sent_at_ms": 1, "payload": {}}).to_string(),
            frame_json(&signed_intent(), "heartbeats", TRANSPORT_SCHEMA_VERSION),
        ] {
            let ack = service
                .validate_and_prepare(bad.as_bytes())
                .expect_err("must reject");
            assert_eq!(ack.status, AckStatus::RejectedMalformed, "for body {bad}");
        }
        // Oversized frame.
        let oversized = vec![b'x'; MAX_INTENT_FRAME_BYTES + 1];
        let ack = service
            .validate_and_prepare(&oversized)
            .expect_err("oversized");
        assert_eq!(ack.status, AckStatus::RejectedMalformed);
    }

    // [CHECK 56 support] risk/compliance cannot be bypassed: negative
    // upstream authorization -> RejectedUnauthorizedSource; the gateway has
    // no API to approve.
    #[test]
    fn unapproved_intents_cannot_reach_the_venue_path() {
        let service = service();
        let mut unapproved = signed_intent();
        unapproved.authorizations.risk_approved = false;
        unapproved.signature_hex = sign_intent(KEY, &unapproved);
        let ack = service
            .validate_and_prepare(
                frame_json(&unapproved, "intent", TRANSPORT_SCHEMA_VERSION).as_bytes(),
            )
            .expect_err("unapproved");
        assert_eq!(ack.status, AckStatus::RejectedUnauthorizedSource);

        // An empty OMS reference is a SHAPE violation (rejected malformed
        // before the authorization stage; both layers refuse transport).
        let mut no_oms = signed_intent();
        no_oms.authorizations.oms_order_ref = String::new();
        no_oms.signature_hex = sign_intent(KEY, &no_oms);
        let ack = service
            .validate_and_prepare(
                frame_json(&no_oms, "intent", TRANSPORT_SCHEMA_VERSION).as_bytes(),
            )
            .expect_err("no oms ref");
        assert_eq!(ack.status, AckStatus::RejectedMalformed);
    }

    // [CHECK 52][CHECK 53 support] correlation + tenant/account scope carry
    // through into the venue request.
    #[test]
    fn correlation_and_scope_carry_through() {
        let service = service();
        let (_, envelope, request) = service
            .validate_and_prepare(
                frame_json(&signed_intent(), "intent", TRANSPORT_SCHEMA_VERSION).as_bytes(),
            )
            .expect("ok");
        assert_eq!(envelope.correlation_id, "corr-admission-1");
        assert_eq!(request.correlation_id, envelope.correlation_id);
        assert_eq!(request.tenant_id, "tenant-77");
        assert_eq!(request.account_id, "acct-42");
    }

    // [CHECK 36 support] the transport plane can NEVER emit an execution
    // outcome: enumerate every status this service can produce and prove
    // none is a fill/position/PnL authority.
    #[test]
    fn transport_never_produces_execution_outcomes() {
        let statuses = vec![
            AckStatus::AcceptedForTransport,
            AckStatus::IdempotentReplay,
            AckStatus::RejectedStaleIntent,
            AckStatus::RejectedIntegrity,
            AckStatus::RejectedSchemaVersion,
            AckStatus::RejectedUnauthorizedSource,
            AckStatus::RejectedCapability,
            AckStatus::RejectedBackpressure,
            AckStatus::RejectedMalformed,
            AckStatus::TransportFailure,
        ];
        for status in statuses {
            match status {
                AckStatus::AcceptedForTransport
                | AckStatus::IdempotentReplay
                | AckStatus::RejectedStaleIntent
                | AckStatus::RejectedIntegrity
                | AckStatus::RejectedSchemaVersion
                | AckStatus::RejectedUnauthorizedSource
                | AckStatus::RejectedCapability
                | AckStatus::RejectedBackpressure
                | AckStatus::RejectedMalformed
                | AckStatus::TransportFailure => {}
            }
        }
        // Venue precision capability is explicit transport metadata only.
        assert_eq!(
            VenuePrecisionRule::for_venue(Venue::Okx).symbol_style,
            crate::execution_prepare::SymbolStyle::DashSeparated
        );
    }

    // [CHECK 37] a NAKED symbol/side/quantity payload is never accepted:
    // the transport plane accepts only the complete signed envelope. A bare
    // venue-order-looking object without the envelope, HMAC and upstream
    // authorization metadata is RejectedMalformed — there is no path where
    // an unsigned order-like object crosses this boundary.
    #[test]
    fn naked_order_payloads_are_never_accepted() {
        let service = service();
        let naked = serde_json::json!({
            "venue": "binance",
            "symbol": "BTCUSDT",
            "side": "buy",
            "quantity_text": "0.250",
            "quantity": {"raw": 250_000_000_000i64, "scale": 12},
            "client_order_id": "LLE-rogue"
        })
        .to_string();
        let ack = service
            .validate_and_prepare(naked.as_bytes())
            .expect_err("naked payload must not cross the boundary");
        assert_eq!(ack.status, AckStatus::RejectedMalformed);

        // Even a well-formed TransportFrame whose payload is a naked order
        // (no envelope fields, no signature) is rejected.
        let framed_naked = serde_json::json!({
            "schema_version": TRANSPORT_SCHEMA_VERSION,
            "correlation_id": "corr-naked",
            "frame_type": "intent",
            "sent_at_ms": utc_now_ms(),
            "payload": {
                "symbol": "BTCUSDT",
                "side": "buy",
                "quantity_text": "0.250"
            }
        })
        .to_string();
        let ack = service
            .validate_and_prepare(framed_naked.as_bytes())
            .expect_err("naked payload inside a frame");
        assert_eq!(ack.status, AckStatus::RejectedMalformed);

        // And the acceptance path PROVEN in signed_envelope_is_accepted_
        // for_transport requires the full signed envelope — nothing else.
        assert_eq!(service.replay_cache_len(), 0);
    }

    // [CHECK 33 support] replay cache eviction is bounded.
    #[test]
    fn replay_cache_is_bounded_and_fifo() {
        let mut cache = ReplayCache::new(2);
        cache.remember("a", AckStatus::AcceptedForTransport);
        cache.remember("b", AckStatus::RejectedStaleIntent);
        cache.remember("c", AckStatus::RejectedIntegrity);
        assert_eq!(cache.len(), 2);
        assert!(cache.get("a").is_none(), "oldest evicted");
        assert!(cache.get("b").is_some() && cache.get("c").is_some());
        assert!(!cache.is_empty());
    }
}
