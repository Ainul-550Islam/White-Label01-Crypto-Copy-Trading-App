//! Execution-intent preparation: converts an ALREADY-APPROVED execution
//! intent into a venue-ready normalized transport request.
//!
//! This module validates NON-AUTHORITATIVE transport constraints only:
//! venue capability, symbol format per venue, quantity precision, venue
//! session connectivity, and the envelope's presence of upstream
//! authorizations. It NEVER makes a risk or compliance decision: a missing
//! or negative upstream authorization REFUSES transport (enforcement of an
//! upstream decision), and nothing in this crate can set those fields —
//! they are covered by the envelope HMAC.
//!
//! Precision/capability tables are explicit per venue. An unknown venue or
//! a precision violation is an explicit error, never a silent coercion.

use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::error::GatewayError;
use crate::session_manager::SessionManager;
use crate::transport_protocol::{SOURCE_SERVICE_EXECUTION_ENGINE, TRANSPORT_SCHEMA_VERSION};
use crate::types::{ExecutionIntentEnvelope, Fixed, Symbol, Venue, VenueOrderRequest};

#[derive(Clone, Copy, Debug)]
pub struct VenuePrecisionRule {
    pub venue: Venue,
    /// Maximum quantity decimal places the venue transport path accepts,
    /// measured on the DECLARED text (not the normalized fixed-point).
    pub max_quantity_decimals: u8,
    /// Symbol shape check (transport-level; instrument filters live in the
    /// execution engine, not here).
    pub symbol_style: SymbolStyle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SymbolStyle {
    /// Binance/Bybit spot: concatenated uppercase, no separators.
    Concatenated,
    /// OKX: BASE-QUOTE with a dash.
    DashSeparated,
}

impl VenuePrecisionRule {
    pub const fn for_venue(venue: Venue) -> VenuePrecisionRule {
        let symbol_style = match venue {
            Venue::Binance | Venue::Bybit => SymbolStyle::Concatenated,
            Venue::Okx => SymbolStyle::DashSeparated,
        };
        VenuePrecisionRule {
            venue,
            max_quantity_decimals: 8,
            symbol_style,
        }
    }

    pub fn check_symbol(&self, symbol: &Symbol) -> Result<(), GatewayError> {
        let text = symbol.as_str();
        match self.symbol_style {
            SymbolStyle::Concatenated => {
                if text.contains('-') || text.contains('.') {
                    return Err(GatewayError::UnsupportedCapability(format!(
                        "{}: symbol '{text}' must be concatenated form for this venue",
                        self.venue
                    )));
                }
            }
            SymbolStyle::DashSeparated => {
                let has_dash = text.contains('-');
                if !has_dash {
                    return Err(GatewayError::UnsupportedCapability(format!(
                        "{}: symbol '{text}' must be BASE-QUOTE form for this venue",
                        self.venue
                    )));
                }
            }
        }
        Ok(())
    }

    pub fn check_quantity_text(&self, quantity_text: &str) -> Result<(), GatewayError> {
        let trimmed = quantity_text.trim();
        let frac = trimmed.split('.').nth(1).unwrap_or("");
        let decimals = frac.len() as u8;
        if decimals > self.max_quantity_decimals {
            return Err(GatewayError::UnsupportedCapability(format!(
                "{}: quantity '{trimmed}' has {decimals} decimals, venue maximum is {}",
                self.venue, self.max_quantity_decimals
            )));
        }
        Ok(())
    }
}

pub struct ExecutionPreparer {
    sessions: Arc<SessionManager>,
    supported_venues: Vec<Venue>,
}

impl ExecutionPreparer {
    pub fn new(sessions: Arc<SessionManager>, supported_venues: Vec<Venue>) -> ExecutionPreparer {
        ExecutionPreparer {
            sessions,
            supported_venues,
        }
    }

    /// Deterministic client order id derived from the signed intent:
    /// venue operators can reconcile it back to the intent without the
    /// gateway inventing identifiers.
    pub fn client_order_id(intent_id: &str, nonce: &str) -> String {
        let digest = Sha256::digest(format!("{intent_id}|{nonce}").as_bytes());
        format!("LLE-{}", hex::encode(&digest[..8]))
    }

    /// Validates transport constraints and builds the venue-ready request.
    pub fn prepare(
        &self,
        envelope: &ExecutionIntentEnvelope,
    ) -> Result<VenueOrderRequest, GatewayError> {
        // Structural sanity (integrity/expiry already checked upstream in
        // the transport service; re-checked cheaply here).
        envelope.validate_shape()?;

        // Upstream authorization metadata must be present and positive.
        // This is ENFORCEMENT: the decision belongs to Risk/Compliance/OMS;
        // this code path has no ability to set these fields.
        if !envelope.authorizations.risk_approved || !envelope.authorizations.compliance_approved {
            return Err(GatewayError::AuthorizationFailure(
                "intent lacks upstream risk/compliance authorization; refusing transport"
                    .to_string(),
            ));
        }
        if envelope.authorizations.oms_order_ref.trim().is_empty() {
            return Err(GatewayError::AuthorizationFailure(
                "intent lacks an OMS order reference; refusing transport".to_string(),
            ));
        }
        if envelope.source_service != SOURCE_SERVICE_EXECUTION_ENGINE {
            return Err(GatewayError::AuthorizationFailure(format!(
                "intent source '{}' is not the authorized execution engine",
                envelope.source_service
            )));
        }

        // Venue capability: only configured, actively supported venues.
        if !self.supported_venues.contains(&envelope.venue) {
            return Err(GatewayError::UnsupportedCapability(format!(
                "venue {} is not configured on this gateway",
                envelope.venue
            )));
        }

        // Transport-level venue constraints.
        let rule = VenuePrecisionRule::for_venue(envelope.venue);
        rule.check_symbol(&envelope.symbol)?;
        rule.check_quantity_text(&envelope.quantity_text)?;

        // The venue session must actually be connected: fail closed when
        // the transport path to the venue is not live.
        if !self.sessions.all_required_connected(&[envelope.venue]) {
            return Err(GatewayError::ProviderFailure(format!(
                "venue {} session is not connected; refusing to prepare transport",
                envelope.venue
            )));
        }

        let quantity = Fixed::parse(envelope.quantity_text.trim())?;
        Ok(VenueOrderRequest {
            schema_version: TRANSPORT_SCHEMA_VERSION,
            intent_id: envelope.intent_id.clone(),
            correlation_id: envelope.correlation_id.clone(),
            tenant_id: envelope.tenant_id.clone(),
            account_id: envelope.account_id.clone(),
            venue: envelope.venue,
            symbol: envelope.symbol.clone(),
            side: envelope.side,
            quantity,
            client_order_id: Self::client_order_id(&envelope.intent_id, &envelope.nonce),
            transport_nonce: envelope.nonce.clone(),
            prepared_at_ms: crate::time::utc_now_ms(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backpressure::BackpressurePolicy;
    use crate::transport_protocol::sign_intent;
    use crate::types::{IntentAuthorizations, OrderSide};

    const KEY: &[u8] = b"deterministic-test-key-0123456789";

    fn envelope(venue: Venue, symbol: &str, quantity: &str) -> ExecutionIntentEnvelope {
        let mut env = ExecutionIntentEnvelope {
            schema_version: TRANSPORT_SCHEMA_VERSION,
            intent_id: "9f1c3b2a-0000-4000-8000-000000000009".to_string(),
            correlation_id: "corr-prepare-1".to_string(),
            created_at_ms: crate::time::utc_now_ms(),
            expires_at_ms: crate::time::utc_now_ms() + 5_000,
            tenant_id: "tenant-77".to_string(),
            account_id: "acct-42".to_string(),
            venue,
            symbol: Symbol::new(symbol).expect("sym"),
            side: OrderSide::Buy,
            quantity_text: quantity.to_string(),
            quantity: Fixed::parse(quantity).expect("qty"),
            nonce: "nonce-1".to_string(),
            key_id: "exec-engine-2026-09".to_string(),
            signature_hex: String::new(),
            source_service: SOURCE_SERVICE_EXECUTION_ENGINE.to_string(),
            authorizations: IntentAuthorizations {
                risk_approved: true,
                compliance_approved: true,
                oms_order_ref: "OMS-42".to_string(),
            },
        };
        env.signature_hex = sign_intent(KEY, &env);
        env
    }

    fn preparer(connected: &[Venue]) -> (Arc<SessionManager>, ExecutionPreparer) {
        let sessions = Arc::new(SessionManager::new(BackpressurePolicy::default()));
        for venue in Venue::ALL {
            sessions.register(venue, Vec::new());
            if connected.contains(&venue) {
                sessions.update_connected(venue);
            }
        }
        let venues = vec![Venue::Binance, Venue::Bybit, Venue::Okx];
        (
            Arc::clone(&sessions),
            ExecutionPreparer::new(sessions, venues),
        )
    }

    #[test]
    fn prepares_a_valid_binance_intent() {
        let (_sessions, prep) = preparer(&[Venue::Binance]);
        let request = prep
            .prepare(&envelope(Venue::Binance, "BTCUSDT", "0.250"))
            .expect("prepare");
        assert_eq!(request.venue, Venue::Binance);
        assert_eq!(request.symbol.as_str(), "BTCUSDT");
        assert_eq!(request.side, OrderSide::Buy);
        assert_eq!(request.tenant_id, "tenant-77");
        // Deterministic client order id.
        assert_eq!(
            request.client_order_id,
            ExecutionPreparer::client_order_id("9f1c3b2a-0000-4000-8000-000000000009", "nonce-1")
        );
        assert!(request.client_order_id.starts_with("LLE-"));
    }

    // [CHECK 54] unsupported capability is explicit, never a silent pass.
    #[test]
    fn unsupported_capability_fails_explicitly() {
        // Binance-only gateway: other venues are explicit capability errors.
        let binance_only = {
            let sessions = Arc::new(SessionManager::new(BackpressurePolicy::default()));
            sessions.register(Venue::Binance, Vec::new());
            sessions.update_connected(Venue::Binance);
            ExecutionPreparer::new(sessions, vec![Venue::Binance])
        };
        let err = binance_only
            .prepare(&envelope(Venue::Okx, "BTC-USDT", "1.0"))
            .expect_err("unsupported");
        assert!(matches!(err, GatewayError::UnsupportedCapability(_)));

        let (_sessions, prep) = preparer(&[Venue::Binance, Venue::Bybit, Venue::Okx]);
        // Wrong symbol shape for the venue.
        let err = prep
            .prepare(&envelope(Venue::Binance, "BTC-USDT", "1.0"))
            .expect_err("shape");
        assert!(matches!(err, GatewayError::UnsupportedCapability(_)));
        // Excess quantity precision (9 decimals > venue maximum 8).
        let err = prep
            .prepare(&envelope(Venue::Binance, "BTCUSDT", "0.123456789"))
            .expect_err("precision");
        assert!(matches!(err, GatewayError::UnsupportedCapability(_)));
        // Exactly 8 decimals is accepted.
        assert!(prep
            .prepare(&envelope(Venue::Binance, "BTCUSDT", "0.12345678"))
            .is_ok());
        assert!(matches!(
            prep.prepare(&envelope(Venue::Okx, "BTCUSDT", "1.0")),
            Err(GatewayError::UnsupportedCapability(_))
        ));
    }

    // [CHECK 36 support] Rust cannot approve risk: a negative upstream risk
    // authorization is refused and CANNOT be flipped by the gateway — the
    // field is inside the HMAC envelope.
    #[test]
    fn unapproved_intents_are_refused_and_cannot_be_blessed_by_the_gateway() {
        let (_sessions, prep) = preparer(&[Venue::Binance]);
        let mut env = envelope(Venue::Binance, "BTCUSDT", "1.0");
        // Without the execution engine's signature over the change, this
        // would also fail integrity; here we construct the variant directly
        // to prove the preparer enforces the metadata, not decides it.
        env.authorizations.risk_approved = false;
        env.signature_hex = sign_intent(KEY, &env);
        let err = prep.prepare(&env).expect_err("risk not approved");
        assert!(matches!(err, GatewayError::AuthorizationFailure(_)));

        let mut env = envelope(Venue::Binance, "BTCUSDT", "1.0");
        env.authorizations.compliance_approved = false;
        env.signature_hex = sign_intent(KEY, &env);
        assert!(matches!(
            prep.prepare(&env),
            Err(GatewayError::AuthorizationFailure(_))
        ));

        let mut env = envelope(Venue::Binance, "BTCUSDT", "1.0");
        env.authorizations.oms_order_ref = "  ".to_string();
        env.signature_hex = sign_intent(KEY, &env);
        // An empty OMS reference is a SHAPE violation caught first; the
        // preparer's own authorization check is defense in depth behind it.
        assert!(matches!(
            prep.prepare(&env),
            Err(GatewayError::MalformedData(_))
        ));
    }

    // [CHECK 35 support] wrong source service is refused.
    #[test]
    fn unauthorized_source_is_refused() {
        let (_sessions, prep) = preparer(&[Venue::Binance]);
        let mut env = envelope(Venue::Binance, "BTCUSDT", "1.0");
        env.source_service = "rogue-trader-script".to_string();
        env.signature_hex = sign_intent(KEY, &env);
        assert!(matches!(
            prep.prepare(&env),
            Err(GatewayError::AuthorizationFailure(_))
        ));
    }

    // Fail closed when the venue session is down.
    #[test]
    fn disconnected_venue_fails_closed() {
        let (_sessions, prep) = preparer(&[]); // nothing connected
        let err = prep
            .prepare(&envelope(Venue::Binance, "BTCUSDT", "1.0"))
            .expect_err("fail closed");
        assert!(matches!(err, GatewayError::ProviderFailure(_)));
    }
}
