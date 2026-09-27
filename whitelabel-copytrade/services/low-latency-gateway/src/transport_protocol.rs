//! Versioned internal wire contract between the existing Python/TypeScript
//! services and this Rust gateway.
//!
//! The envelope integrity scheme: HMAC-SHA256 over a canonical serialization
//! of every envelope field EXCEPT the signature itself. Canonical form is
//! serde's struct-order JSON (field order is declaration order and therefore
//! build-deterministic; no map iteration order participates). Signature
//! comparison is constant-time. Key material comes exclusively from
//! configuration (secret infrastructure), referenced by `key_id`.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::GatewayError;
use crate::types::{ExecutionIntentEnvelope, TransportAck};

type HmacSha256 = Hmac<Sha256>;

/// Current transport schema version. Bumping this is a coordinated change
/// with the execution engine (see integration::execution_engine
/// schema negotiation); the gateway accepts exactly the versions it knows.
pub const TRANSPORT_SCHEMA_VERSION: u32 = 1;
/// Lowest envelope schema version this build will still validate.
pub const MIN_SUPPORTED_SCHEMA_VERSION: u32 = 1;

/// The only authorized source service for execution intents.
pub const SOURCE_SERVICE_EXECUTION_ENGINE: &str = "execution-engine";

/// Canonical string that the HMAC covers: every envelope field except the
/// signature, serialized in declaration order. Excluding the signature from
/// its own coverage is what makes verification a pure recomputation.
pub fn canonical_intent_bytes(envelope: &ExecutionIntentEnvelope) -> Vec<u8> {
    let canonical = CanonicalIntent::from(envelope);
    serde_json::to_vec(&canonical).expect("canonical serialization cannot fail for owned types")
}

#[derive(Serialize)]
struct CanonicalIntent<'a> {
    schema_version: u32,
    intent_id: &'a str,
    correlation_id: &'a str,
    created_at_ms: i64,
    expires_at_ms: i64,
    tenant_id: &'a str,
    account_id: &'a str,
    venue: crate::types::Venue,
    symbol: &'a crate::types::Symbol,
    side: crate::types::OrderSide,
    quantity_text: &'a str,
    nonce: &'a str,
    key_id: &'a str,
    source_service: &'a str,
    authorizations: &'a crate::types::IntentAuthorizations,
}

impl<'a> CanonicalIntent<'a> {
    fn from(env: &'a ExecutionIntentEnvelope) -> CanonicalIntent<'a> {
        CanonicalIntent {
            schema_version: env.schema_version,
            intent_id: &env.intent_id,
            correlation_id: &env.correlation_id,
            created_at_ms: env.created_at_ms,
            expires_at_ms: env.expires_at_ms,
            tenant_id: &env.tenant_id,
            account_id: &env.account_id,
            venue: env.venue,
            symbol: &env.symbol,
            side: env.side,
            quantity_text: &env.quantity_text,
            nonce: &env.nonce,
            key_id: &env.key_id,
            source_service: &env.source_service,
            authorizations: &env.authorizations,
        }
    }
}

/// HMAC-SHA256 signature (hex) over the canonical intent bytes.
pub fn sign_intent(key: &[u8], envelope: &ExecutionIntentEnvelope) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(&canonical_intent_bytes(envelope));
    hex::encode(mac.finalize().into_bytes())
}

/// Constant-time byte equality over the decoded signature. Length mismatch
/// short-circuits (a length difference is not a secret).
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Verifies the envelope's integrity against the configured key. Any
/// mismatch (key rotation, tampered field, corrupted signature) is an
/// integrity failure — never a soft warning.
pub fn verify_intent(key: &[u8], envelope: &ExecutionIntentEnvelope) -> Result<(), GatewayError> {
    let expected = sign_intent(key, envelope);
    let provided = envelope.signature_hex.trim().to_ascii_lowercase();
    let provided_bytes = hex::decode(&provided)
        .map_err(|_| GatewayError::IntegrityFailure("signature is not valid hex".to_string()))?;
    let expected_bytes = hex::decode(&expected).expect("we produce valid hex");
    if constant_time_eq(&provided_bytes, &expected_bytes) {
        Ok(())
    } else {
        Err(GatewayError::IntegrityFailure(
            "envelope signature does not cover the presented intent".to_string(),
        ))
    }
}

/// Outer authenticated frame for the internal HTTP transport.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransportFrame {
    pub schema_version: u32,
    pub correlation_id: String,
    /// Free-form description of frame purpose ("intent", "schema", "health").
    pub frame_type: String,
    pub sent_at_ms: i64,
    pub payload: serde_json::Value,
}

/// Response frame.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AckFrame {
    pub schema_version: u32,
    pub ack: TransportAck,
}

/// Schema advertisement served by both sides of the integration for
/// version negotiation before any intent flows.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SchemaAdvertisement {
    pub service: String,
    pub schema_version: u32,
    pub min_supported_schema_version: u32,
}

impl SchemaAdvertisement {
    pub fn gateway() -> SchemaAdvertisement {
        SchemaAdvertisement {
            service: "low-latency-gateway".to_string(),
            schema_version: TRANSPORT_SCHEMA_VERSION,
            min_supported_schema_version: MIN_SUPPORTED_SCHEMA_VERSION,
        }
    }

    /// Negotiation rule: both sides must overlap on at least one version.
    pub fn negotiate(peer: &SchemaAdvertisement) -> Result<u32, GatewayError> {
        let lo = peer
            .min_supported_schema_version
            .max(MIN_SUPPORTED_SCHEMA_VERSION);
        let hi = peer.schema_version.min(TRANSPORT_SCHEMA_VERSION);
        if lo <= hi {
            Ok(hi)
        } else {
            Err(GatewayError::Configuration(format!(
                "schema negotiation failed: peer supports [{}, {}], gateway supports [{}, {}]",
                peer.min_supported_schema_version,
                peer.schema_version,
                MIN_SUPPORTED_SCHEMA_VERSION,
                TRANSPORT_SCHEMA_VERSION
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AckStatus;
    use crate::types::{Fixed, IntentAuthorizations, OrderSide, Symbol, Venue};

    pub(crate) fn envelope() -> ExecutionIntentEnvelope {
        ExecutionIntentEnvelope {
            schema_version: TRANSPORT_SCHEMA_VERSION,
            intent_id: "9f1c3b2a-0000-4000-8000-000000000001".to_string(),
            correlation_id: "corr-29-0001".to_string(),
            created_at_ms: 1_700_000_000_000,
            expires_at_ms: 1_700_000_005_000,
            tenant_id: "tenant-77".to_string(),
            account_id: "acct-42".to_string(),
            venue: Venue::Binance,
            symbol: Symbol::new("BTCUSDT").expect("sym"),
            side: OrderSide::Buy,
            quantity_text: "0.250".to_string(),
            quantity: Fixed::parse("0.250").expect("qty"),
            nonce: "nonce-a1".to_string(),
            key_id: "exec-engine-2026-09".to_string(),
            signature_hex: String::new(),
            source_service: SOURCE_SERVICE_EXECUTION_ENGINE.to_string(),
            authorizations: IntentAuthorizations {
                risk_approved: true,
                compliance_approved: true,
                oms_order_ref: "OMS-29-1".to_string(),
            },
        }
    }

    // [CHECK 34 support] canonical serialization is build-deterministic and
    // excludes the signature from its own coverage.
    #[test]
    fn canonical_bytes_are_deterministic_and_exclude_signature() {
        let mut a = envelope();
        let mut b = envelope();
        a.signature_hex = "aa".to_string();
        b.signature_hex = "bb".to_string();
        assert_eq!(canonical_intent_bytes(&a), canonical_intent_bytes(&b));
        let text = String::from_utf8(canonical_intent_bytes(&a)).expect("utf8");
        assert!(text.starts_with('{'));
        // Field order is declaration order: schema_version first.
        assert!(text.contains("\"schema_version\":1"));
        assert!(!text.contains("signature"));
    }

    // [CHECK 34] integrity metadata is required: tampering any covered field
    // breaks verification.
    #[test]
    fn verification_detects_tampering_of_any_covered_field() {
        let key = b"test-key-material-0123456789abcdef";
        let mut env = envelope();
        env.signature_hex = sign_intent(key, &env);
        assert!(verify_intent(key, &env).is_ok());

        // Tamper quantity (the covered declared text).
        let mut tampered = env.clone();
        tampered.quantity_text = "9.999".to_string();
        tampered.quantity = Fixed::parse("9.999").expect("qty");
        assert!(verify_intent(key, &tampered).is_err());

        // Tamper tenant scope.
        let mut tampered = env.clone();
        tampered.tenant_id = "tenant-OTHER".to_string();
        assert!(verify_intent(key, &tampered).is_err());

        // Tamper authorizations (the field Rust must never be able to grant).
        let mut tampered = env.clone();
        tampered.authorizations.risk_approved = false;
        assert!(verify_intent(key, &tampered).is_err());

        // Corrupt signature text.
        let mut tampered = env.clone();
        tampered.signature_hex = "00".repeat(32);
        assert!(verify_intent(key, &tampered).is_err());

        // Wrong key (rotation).
        assert!(verify_intent(b"another-key-0123456789abcdef", &env).is_err());
    }

    // Constant-time comparison: equal contents equal, differing contents
    // unequal, and length mismatches never panic.
    #[test]
    fn constant_time_eq_behaves() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(constant_time_eq(b"", b""));
    }

    // [CHECK 51 support] schema negotiation overlaps and fails closed.
    #[test]
    fn schema_negotiation_overlaps_or_fails() {
        let gateway = SchemaAdvertisement::gateway();
        let peer_same = SchemaAdvertisement {
            service: "execution-engine".to_string(),
            schema_version: 1,
            min_supported_schema_version: 1,
        };
        assert_eq!(
            SchemaAdvertisement::negotiate(&peer_same).expect("negotiate"),
            1
        );
        let peer_newer = SchemaAdvertisement {
            service: "execution-engine".to_string(),
            schema_version: 2,
            min_supported_schema_version: 2,
        };
        assert!(SchemaAdvertisement::negotiate(&peer_newer).is_err());
        let peer_older = SchemaAdvertisement {
            service: "execution-engine".to_string(),
            schema_version: 1,
            min_supported_schema_version: 1,
        };
        let _ = gateway; // gateway advertisement is informational
        assert_eq!(
            SchemaAdvertisement::negotiate(&peer_older).expect("older peer ok"),
            1
        );
    }

    // Frames round-trip through serde with correlation preserved.
    #[test]
    fn frames_round_trip_and_preserve_correlation() {
        let frame = TransportFrame {
            schema_version: TRANSPORT_SCHEMA_VERSION,
            correlation_id: "corr-rt-1".to_string(),
            frame_type: "intent".to_string(),
            sent_at_ms: 1_700_000_000_123,
            payload: serde_json::to_value(envelope()).expect("payload"),
        };
        let encoded = serde_json::to_vec(&frame).expect("encode");
        let decoded: TransportFrame = serde_json::from_slice(&encoded).expect("decode");
        assert_eq!(decoded.correlation_id, "corr-rt-1");
        assert_eq!(decoded.schema_version, TRANSPORT_SCHEMA_VERSION);

        let ack_frame = AckFrame {
            schema_version: TRANSPORT_SCHEMA_VERSION,
            ack: TransportAck::new("i", "corr-rt-1", AckStatus::AcceptedForTransport, 1),
        };
        let encoded = serde_json::to_string(&ack_frame).expect("encode");
        assert!(encoded.contains("\"status\":\"accepted_for_transport\""));
    }
}
