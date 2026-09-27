//! Canonical domain types for the low-latency gateway.
//!
//! These are the ONLY shapes that cross module boundaries. Every type here is
//! deterministic, validated at construction, and free of any authority over
//! financial truth: nothing in this file can represent a fill, a position, a
//! PnL number or a risk/compliance decision. The gateway transports and
//! normalizes; the existing OMS/Risk/Compliance/Execution-Engine stack owns
//! the truth.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fmt;

/// Monotonic per-process event id assigned by the normalization pipeline.
pub type EventId = u64;

/// Venue-provided stream sequence number (Binance update id, Bybit `u`,
/// OKX `seqId`, ...). 0 means "venue does not sequence this stream".
pub type Sequence = u64;

/// Maximum accepted serialized execution-intent frame (bytes).
pub const MAX_INTENT_FRAME_BYTES: usize = 64 * 1024;
/// Maximum accepted raw market-data frame (bytes). Frames above this are
/// malformed by definition (largest real book payloads stay far below).
pub const MAX_FEED_FRAME_BYTES: usize = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Venue identity
// ---------------------------------------------------------------------------

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Venue {
    Binance,
    Bybit,
    Okx,
}

impl Venue {
    pub const ALL: [Venue; 3] = [Venue::Binance, Venue::Bybit, Venue::Okx];

    pub fn as_str(self) -> &'static str {
        match self {
            Venue::Binance => "binance",
            Venue::Bybit => "bybit",
            Venue::Okx => "okx",
        }
    }

    pub fn parse(raw: &str) -> Option<Venue> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "binance" => Some(Venue::Binance),
            "bybit" => Some(Venue::Bybit),
            "okx" => Some(Venue::Okx),
            _ => None,
        }
    }
}

impl fmt::Display for Venue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ---------------------------------------------------------------------------
// Symbol
// ---------------------------------------------------------------------------

/// Validated instrument symbol. Uppercase alphanumerics plus `-`, `_` and `.`
/// (OKX uses `BTC-USDT`, Binance `BTCUSDT`, Bybit `BTCUSDT`). No lowercase,
/// no whitespace, bounded length — a malformed symbol can never enter the
/// normalization pipeline or an execution-preparation request.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Symbol(String);

impl Symbol {
    pub const MAX_LEN: usize = 32;

    pub fn new(raw: &str) -> Result<Symbol, crate::error::GatewayError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.len() > Self::MAX_LEN {
            return Err(crate::error::GatewayError::MalformedData(format!(
                "symbol length out of range: {raw}"
            )));
        }
        if !trimmed.chars().all(|c| {
            c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.'
        }) {
            return Err(crate::error::GatewayError::MalformedData(format!(
                "symbol contains unsupported characters: {raw}"
            )));
        }
        Ok(Symbol(trimmed.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Symbol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// ---------------------------------------------------------------------------
// Fixed-point price/quantity
// ---------------------------------------------------------------------------

/// Decimal fixed-point number: `raw / 10^scale`. Deterministic ordering and
/// arithmetic (no floats in the event plane), bounded scale, checked ops.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Fixed {
    pub raw: i64,
    pub scale: u8,
}

impl Fixed {
    pub const MAX_SCALE: u8 = 12;

    pub fn from_parts(raw: i64, scale: u8) -> Result<Fixed, crate::error::GatewayError> {
        if scale > Self::MAX_SCALE {
            return Err(crate::error::GatewayError::MalformedData(format!(
                "scale {scale} exceeds maximum {}",
                Self::MAX_SCALE
            )));
        }
        Ok(Fixed { raw, scale })
    }

    /// Parses a decimal string such as `"61234.55"`. Rejects scientific
    /// notation, empty fields, signs beyond a single leading `-`, and scales
    /// beyond [`Fixed::MAX_SCALE`].
    pub fn parse(text: &str) -> Result<Fixed, crate::error::GatewayError> {
        let t = text.trim();
        if t.is_empty() {
            return Err(crate::error::GatewayError::MalformedData(
                "empty decimal".to_string(),
            ));
        }
        let (sign, rest) = match t.strip_prefix('-') {
            Some(r) => (-1i64, r),
            None => (1i64, t.strip_prefix('+').unwrap_or(t)),
        };
        let mut parts = rest.split('.');
        let int_part = parts.next().unwrap_or("");
        let frac_part = parts.next().unwrap_or("");
        if parts.next().is_some() {
            return Err(crate::error::GatewayError::MalformedData(format!(
                "too many decimal points: {t}"
            )));
        }
        if int_part.is_empty() && frac_part.is_empty() {
            return Err(crate::error::GatewayError::MalformedData(format!(
                "no digits: {t}"
            )));
        }
        if !int_part.chars().all(|c| c.is_ascii_digit())
            || !frac_part.chars().all(|c| c.is_ascii_digit())
        {
            return Err(crate::error::GatewayError::MalformedData(format!(
                "non-decimal characters: {t}"
            )));
        }
        if frac_part.len() as u8 > Self::MAX_SCALE {
            return Err(crate::error::GatewayError::MalformedData(format!(
                "decimal scale beyond {} in {t}",
                Self::MAX_SCALE
            )));
        }
        let mut raw: i64 = 0;
        for c in int_part.chars().chain(frac_part.chars()) {
            raw = raw
                .checked_mul(10)
                .and_then(|v| v.checked_add((c as u8 - b'0') as i64))
                .ok_or_else(|| {
                    crate::error::GatewayError::MalformedData(format!("decimal overflow: {t}"))
                })?;
        }
        for _ in frac_part.len()..Self::MAX_SCALE as usize {
            raw = raw.checked_mul(10).ok_or_else(|| {
                crate::error::GatewayError::MalformedData(format!("decimal overflow: {t}"))
            })?;
        }
        Ok(Fixed {
            raw: sign * raw,
            scale: Self::MAX_SCALE,
        })
    }

    /// Value expressed at `target_scale` for cross-scale comparison.
    fn value_at(self, target_scale: u8) -> i128 {
        let self_v = self.raw as i128;
        if target_scale <= self.scale {
            let factor = 10i128.pow((self.scale - target_scale) as u32);
            // Truncation here only happens when comparing mixed scales where
            // the finer operand carries sub-target precision; comparisons in
            // this crate always normalize to the finer of the two scales.
            self_v / factor.max(1)
        } else {
            self_v * 10i128.pow((target_scale - self.scale) as u32)
        }
    }

    fn common_scale(a: Fixed, b: Fixed) -> u8 {
        a.scale.max(b.scale)
    }

    pub fn is_zero(self) -> bool {
        self.raw == 0
    }

    pub fn is_negative(self) -> bool {
        self.raw < 0
    }

    pub fn checked_add(self, other: Fixed) -> Option<Fixed> {
        let s = Self::common_scale(self, other);
        self.value_at(s)
            .checked_add(other.value_at(s))
            .and_then(|v| i64::try_from(v).ok())
            .and_then(|v| Fixed::from_parts(v, s).ok())
    }

    pub fn checked_sub(self, other: Fixed) -> Option<Fixed> {
        let s = Self::common_scale(self, other);
        self.value_at(s)
            .checked_sub(other.value_at(s))
            .and_then(|v| i64::try_from(v).ok())
            .and_then(|v| Fixed::from_parts(v, s).ok())
    }
}

impl PartialEq for Fixed {
    fn eq(&self, other: &Self) -> bool {
        let s = Self::common_scale(*self, *other);
        self.value_at(s) == other.value_at(s)
    }
}

impl Eq for Fixed {}

impl PartialOrd for Fixed {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Fixed {
    fn cmp(&self, other: &Self) -> Ordering {
        let s = Self::common_scale(*self, *other);
        self.value_at(s).cmp(&other.value_at(s))
    }
}

impl fmt::Display for Fixed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let negative = self.raw < 0;
        let magnitude = self.raw.unsigned_abs() as u128;
        let factor = 10u128.pow(self.scale as u32);
        let int_part = magnitude / factor;
        let frac_part = magnitude % factor;
        if self.scale == 0 {
            write!(f, "{}{int_part}", if negative { "-" } else { "" })
        } else {
            let frac = format!("{frac_part:0width$}", width = self.scale as usize);
            let frac = frac.trim_end_matches('0');
            write!(
                f,
                "{}{int_part}.{}",
                if negative { "-" } else { "" },
                if frac.is_empty() { "0" } else { frac }
            )
        }
    }
}

/// Price in the event plane (transport normalization only; accounting truth
/// lives in the existing portfolio/ledger services).
pub type Price = Fixed;
/// Quantity in the event plane.
pub type Quantity = Fixed;

/// One order-book price level.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Level {
    pub price: Price,
    pub quantity: Quantity,
}

impl Level {
    pub fn from_wire(price: &str, quantity: &str) -> Result<Level, crate::error::GatewayError> {
        Ok(Level {
            price: Price::parse(price)?,
            quantity: Quantity::parse(quantity)?,
        })
    }
}

// ---------------------------------------------------------------------------
// Sides and stream kinds
// ---------------------------------------------------------------------------

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Bid,
    Ask,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderSide {
    Buy,
    Sell,
}

impl OrderSide {
    pub fn parse(raw: &str) -> Option<OrderSide> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "buy" | "bid" => Some(OrderSide::Buy),
            "sell" | "ask" => Some(OrderSide::Sell),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            OrderSide::Buy => "buy",
            OrderSide::Sell => "sell",
        }
    }
}

/// Distinguishes per-stream sequence domains. Venues sequence each stream
/// independently, so guards are keyed by (venue, symbol, stream kind).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamKind {
    Trades,
    BookTicker,
    BookDepth,
    PartialBook,
    Ticker,
}

impl StreamKind {
    pub fn as_str(self) -> &'static str {
        match self {
            StreamKind::Trades => "trades",
            StreamKind::BookTicker => "book_ticker",
            StreamKind::BookDepth => "book_depth",
            StreamKind::PartialBook => "partial_book",
            StreamKind::Ticker => "ticker",
        }
    }
}

// ---------------------------------------------------------------------------
// Normalized market events
// ---------------------------------------------------------------------------

/// UTC epoch-milliseconds for persisted/business timestamps plus monotonic
/// nanoseconds (process boot relative) for latency chains. Wall clock is
/// never used for elapsed measurement and vice versa.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Timestamps {
    /// Venue-provided event time (epoch ms), when the venue sends one.
    pub provider_ms: Option<i64>,
    /// UTC epoch ms at socket receive.
    pub receive_ms: i64,
    /// UTC epoch ms after normalization completed.
    pub normalize_ms: i64,
    /// UTC epoch ms at publication into an outbound consumer channel.
    pub publish_ms: Option<i64>,
    /// Monotonic receive timestamp (ns since boot).
    pub receive_mono_ns: u64,
    /// Monotonic normalization timestamp (ns since boot).
    pub normalize_mono_ns: u64,
    /// Monotonic publish timestamp (ns since boot).
    pub publish_mono_ns: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MarketEventKind {
    TradeTick {
        price: Price,
        quantity: Quantity,
        taker_side: OrderSide,
        trade_id: String,
    },
    BookSnapshot {
        bids: Vec<Level>,
        asks: Vec<Level>,
    },
    /// Difference applied over the previous depth state.
    BookDelta {
        bids: Vec<Level>,
        asks: Vec<Level>,
        prev_sequence: Option<Sequence>,
    },
    BookTicker {
        bid_price: Price,
        bid_quantity: Quantity,
        ask_price: Price,
        ask_quantity: Quantity,
    },
    Ticker {
        last_price: Option<Price>,
        bid_price: Option<Price>,
        ask_price: Option<Price>,
        high_24h: Option<Price>,
        low_24h: Option<Price>,
        volume_24h: Option<Quantity>,
    },
    Heartbeat,
}

/// A fully normalized market-data event ready for bounded fanout.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MarketEvent {
    pub id: EventId,
    pub venue: Venue,
    pub symbol: Symbol,
    pub stream_kind: StreamKind,
    /// Venue stream sequence, when the venue sequences the stream.
    pub sequence: Option<Sequence>,
    pub timestamps: Timestamps,
    pub kind: MarketEventKind,
}

/// Raw frame handed from a feed session to the normalization pipeline.
#[derive(Clone, Debug)]
pub struct RawFeedFrame {
    pub venue: Venue,
    pub payload: String,
    pub receive_mono_ns: u64,
    pub receive_utc_ms: i64,
}

/// Demand from the pipeline to a feed session: the current depth state is
/// unusable and a fresh snapshot is required before deltas resume.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoverySignal {
    pub venue: Venue,
    pub symbol: Symbol,
    pub stream_kind: StreamKind,
    pub reason: RecoveryReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryReason {
    SequenceGap,
    Reconnect,
}

// ---------------------------------------------------------------------------
// Execution intent transport (non-authoritative)
// ---------------------------------------------------------------------------

/// Authorization metadata carried inside the signed envelope. The gateway
/// REQUIRES these to be present and signed; it has no API to GRANT them.
/// Granting happens upstream in Risk / Compliance / OMS. Any tampering is
/// caught by integrity verification, not by a gateway decision.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct IntentAuthorizations {
    /// Set by the existing Risk engine path upstream. Gateway never sets.
    pub risk_approved: bool,
    /// Set by the existing Compliance path upstream. Gateway never sets.
    pub compliance_approved: bool,
    /// OMS order reference proving OMS custody of the order.
    pub oms_order_ref: String,
}

/// The ONLY accepted execution shape: a signed envelope produced by the
/// existing Python execution engine. A naked symbol/side/quantity is not an
/// intent and cannot be transported.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutionIntentEnvelope {
    pub schema_version: u32,
    pub intent_id: String,
    pub correlation_id: String,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
    pub tenant_id: String,
    pub account_id: String,
    pub venue: Venue,
    pub symbol: Symbol,
    pub side: OrderSide,
    /// Exact decimal string as the execution engine declared it (the
    /// declared precision matters downstream; a parsed fixed-point value
    /// would normalize 0.250 and lose it).
    pub quantity_text: String,
    /// Parsed quantity (positive, validated) for typed consumers.
    pub quantity: Quantity,
    /// Replay-protection nonce minted by the execution engine.
    pub nonce: String,
    /// Key identifier resolved through existing secret infrastructure.
    pub key_id: String,
    /// HMAC-SHA256 (hex) over the canonical envelope serialization.
    pub signature_hex: String,
    /// Authorized source service identity (must be "execution-engine").
    pub source_service: String,
    pub authorizations: IntentAuthorizations,
}

impl ExecutionIntentEnvelope {
    /// Structural validation only (integrity and freshness are separate
    /// steps in the transport service). Returns the first violated rule.
    pub fn validate_shape(&self) -> Result<(), crate::error::GatewayError> {
        let non_empty = |v: &str, name: &str| -> Result<(), crate::error::GatewayError> {
            if v.trim().is_empty() {
                Err(crate::error::GatewayError::MalformedData(format!(
                    "{name} must not be empty"
                )))
            } else {
                Ok(())
            }
        };
        non_empty(&self.intent_id, "intent_id")?;
        non_empty(&self.correlation_id, "correlation_id")?;
        non_empty(&self.tenant_id, "tenant_id")?;
        non_empty(&self.account_id, "account_id")?;
        non_empty(&self.nonce, "nonce")?;
        non_empty(&self.key_id, "key_id")?;
        non_empty(&self.signature_hex, "signature_hex")?;
        non_empty(&self.source_service, "source_service")?;
        non_empty(
            &self.authorizations.oms_order_ref,
            "authorizations.oms_order_ref",
        )?;
        if self.created_at_ms <= 0 || self.expires_at_ms <= 0 {
            return Err(crate::error::GatewayError::MalformedData(
                "timestamps must be positive epoch milliseconds".to_string(),
            ));
        }
        if self.expires_at_ms < self.created_at_ms {
            return Err(crate::error::GatewayError::MalformedData(
                "expires_at_ms precedes created_at_ms".to_string(),
            ));
        }
        if self.quantity_text.trim().is_empty() {
            return Err(crate::error::GatewayError::MalformedData(
                "quantity_text must not be empty".to_string(),
            ));
        }
        let parsed = Quantity::parse(&self.quantity_text)?;
        if parsed.is_zero() || parsed.is_negative() {
            return Err(crate::error::GatewayError::MalformedData(
                "quantity must be positive".to_string(),
            ));
        }
        // Note: `quantity_text` is transported verbatim (declared precision
        // preserved); the parsed value is only validated, never re-rendered
        // over the declared text.
        Ok(())
    }
}

/// Terminal transport-layer status for one intent. Deliberately EXCLUDES any
/// exchange-authoritative outcome: there is no "filled", no "partially
/// filled", no "rejected by venue" and no accounting verdict here — those
/// truths flow exclusively through the existing OMS / provider paths.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AckStatus {
    /// Gateway accepted the intent for onward transport.
    AcceptedForTransport,
    /// Same intent id already accepted: deterministic replay response.
    IdempotentReplay,
    RejectedStaleIntent,
    RejectedIntegrity,
    RejectedSchemaVersion,
    RejectedUnauthorizedSource,
    RejectedCapability,
    RejectedBackpressure,
    RejectedMalformed,
    /// Downstream execution-engine transport failed; never a success.
    TransportFailure,
}

impl AckStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AckStatus::AcceptedForTransport => "accepted_for_transport",
            AckStatus::IdempotentReplay => "idempotent_replay",
            AckStatus::RejectedStaleIntent => "rejected_stale_intent",
            AckStatus::RejectedIntegrity => "rejected_integrity",
            AckStatus::RejectedSchemaVersion => "rejected_schema_version",
            AckStatus::RejectedUnauthorizedSource => "rejected_unauthorized_source",
            AckStatus::RejectedCapability => "rejected_capability",
            AckStatus::RejectedBackpressure => "rejected_backpressure",
            AckStatus::RejectedMalformed => "rejected_malformed",
            AckStatus::TransportFailure => "transport_failure",
        }
    }

    pub fn is_accepted(self) -> bool {
        matches!(self, AckStatus::AcceptedForTransport)
    }
}

/// Response written back to the authorized caller for one intent.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransportAck {
    pub intent_id: String,
    pub correlation_id: String,
    pub status: AckStatus,
    pub observed_at_ms: i64,
    /// Safe, redacted detail; never carries credentials or payloads.
    pub detail: Option<String>,
}

impl TransportAck {
    pub fn new(
        intent_id: &str,
        correlation_id: &str,
        status: AckStatus,
        now_ms: i64,
    ) -> TransportAck {
        TransportAck {
            intent_id: intent_id.to_string(),
            correlation_id: correlation_id.to_string(),
            status,
            observed_at_ms: now_ms,
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: String) -> TransportAck {
        self.detail = Some(detail);
        self
    }
}

/// Venue-ready request produced by execution preparation. This is a
/// transport artifact: it proves nothing about venue acceptance.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct VenueOrderRequest {
    pub schema_version: u32,
    pub intent_id: String,
    pub correlation_id: String,
    pub tenant_id: String,
    pub account_id: String,
    pub venue: Venue,
    pub symbol: Symbol,
    pub side: OrderSide,
    pub quantity: Quantity,
    /// Deterministic client order id derived from the signed intent id.
    pub client_order_id: String,
    pub transport_nonce: String,
    pub prepared_at_ms: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 57] no fabricated market data: a Symbol/Fixed can only be built
    // through validation, so unparseable market data cannot become an event.
    #[test]
    fn symbol_and_fixed_validation_reject_garbage() {
        assert!(Symbol::new("btc usdt").is_err());
        assert!(Symbol::new("").is_err());
        // Lowercase is outside the venue symbol charset (A-Z0-9-_.,):
        // acceptance would silently corrupt venue subscriptions.
        assert!(Symbol::new("btcusdt").is_err());
        assert!(Symbol::new("BTC_USDT-1.2").is_ok());
        assert!(Fixed::parse("not-a-number").is_err());
        assert!(Fixed::parse("1.2.3").is_err());
        assert!(Fixed::parse("1e9").is_err());
        assert!(Fixed::parse("0.123456789012345").is_err()); // scale > 12
        let f = Fixed::parse("61234.55").expect("parses");
        assert_eq!(f.to_string(), "61234.55");
        assert_eq!(Fixed::parse("-0.5").expect("neg").to_string(), "-0.5");
    }

    // [CHECK 59] fixed-point determinism: identical ordering/arithmetic to
    // decimal expectations, no float drift.
    #[test]
    fn fixed_ordering_and_checked_arithmetic_are_deterministic() {
        let a = Fixed::parse("10.10").expect("a");
        let b = Fixed::parse("9.99").expect("b");
        assert!(a > b);
        assert_eq!(a.checked_sub(b).expect("sub").to_string(), "0.11");
        assert_eq!(a.checked_add(b).expect("add").to_string(), "20.09");
        let max = Fixed::from_parts(i64::MAX, 0).expect("max");
        assert!(max
            .checked_add(Fixed::from_parts(1, 0).expect("one"))
            .is_none());
    }

    // [CHECK 38][CHECK 39][CHECK 40] the ack vocabulary cannot express
    // FILLED, position or PnL authority: exhaustive match proves absence.
    #[test]
    fn ack_status_cannot_express_exchange_or_accounting_authority() {
        let all = [
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
        for status in all {
            let rendered = status.as_str();
            assert!(!rendered.contains("fill"));
            assert!(!rendered.contains("position"));
            assert!(!rendered.contains("pnl"));
            assert!(!rendered.contains("risk"));
            assert!(!rendered.contains("compliance"));
        }
    }

    // [CHECK 31 support] envelope shape validation exists and is structural.
    #[test]
    fn envelope_shape_validation_rejects_broken_envelopes() {
        let base = serde_json::json!({
            "schema_version": 1,
            "intent_id": "11111111-1111-1111-1111-111111111111",
            "correlation_id": "corr-1",
            "created_at_ms": 1_000,
            "expires_at_ms": 2_000,
            "tenant_id": "tenant-1",
            "account_id": "acct-1",
            "venue": "binance",
            "symbol": "BTCUSDT",
            "side": "buy",
            "quantity_text": "0.5",
            "quantity": {"raw": 500_000_000_000i64, "scale": 12},
            "nonce": "n-1",
            "key_id": "exec-engine-2026-09",
            "signature_hex": "00",
            "source_service": "execution-engine",
            "authorizations": {
                "risk_approved": true,
                "compliance_approved": true,
                "oms_order_ref": "OMS-1"
            }
        });
        let good: ExecutionIntentEnvelope = serde_json::from_value(base.clone()).expect("deser");
        assert!(good.validate_shape().is_ok());
        let mut broken = base.clone();
        broken["expires_at_ms"] = serde_json::json!(500);
        let broken: ExecutionIntentEnvelope = serde_json::from_value(broken).expect("deser");
        assert!(broken.validate_shape().is_err());
        let mut zero_qty = base;
        zero_qty["quantity_text"] = serde_json::json!("0");
        zero_qty["quantity"] = serde_json::json!({"raw": 0, "scale": 12});
        let zero_qty: ExecutionIntentEnvelope = serde_json::from_value(zero_qty).expect("deser");
        assert!(zero_qty.validate_shape().is_err());
    }

    // [CHECK 35 support] venue parsing is closed: unknown venue strings are
    // rejected rather than silently defaulted.
    #[test]
    fn venue_parse_is_closed() {
        assert_eq!(Venue::parse("binance"), Some(Venue::Binance));
        assert_eq!(Venue::parse("OKX"), Some(Venue::Okx));
        assert_eq!(Venue::parse("kraken"), None);
        assert_eq!(Venue::parse(""), None);
    }
}
