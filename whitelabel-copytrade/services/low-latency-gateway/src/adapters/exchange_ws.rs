//! Provider-neutral WebSocket adapter boundary.
//!
//! Every venue adapter is a concrete implementation of this contract: how to
//! build the endpoint, subscribe, keep the session alive, parse wire frames
//! into normalized events, and what recovery requires when continuity is
//! lost. The feed-session engine (see feed_session.rs) drives any adapter
//! through this trait and nothing else, so venue-specific wire behavior
//! cannot leak into shared machinery — and unsupported capabilities fail
//! explicitly instead of degrading silently.

use crate::error::GatewayError;
use crate::types::{MarketEventKind, Sequence, StreamKind, Symbol, Venue};

/// A single venue event as parsed off the wire, pre-normalization (the
/// pipeline assigns ids and timestamps).
#[derive(Clone, Debug)]
pub struct AdapterEvent {
    pub symbol: Symbol,
    pub stream_kind: StreamKind,
    pub sequence: Option<Sequence>,
    /// For depth deltas: the venue-declared predecessor sequence.
    pub prev_sequence: Option<Sequence>,
    pub provider_ms: Option<i64>,
    pub kind: MarketEventKind,
    /// True when this event legitimately re-anchors sequence continuity
    /// (snapshots). Deltas after a gap stay refused until one arrives.
    pub is_anchor: bool,
}

/// What a reconnect requires before deltas can flow again.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RecoveryStrategy {
    /// Re-subscribing delivers a fresh snapshot first (Bybit snapshot/delta
    /// streams, OKX books with action=snapshot, Binance partial depth).
    ResubscribeYieldsSnapshot,
}

/// Capabilities an adapter can explicitly support or refuse.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Capability {
    Trades,
    BookTicker,
    BookDepthDiff,
    PartialBook,
    Ticker,
}

pub trait MarketDataAdapter: Send + Sync {
    fn venue(&self) -> Venue;

    /// Public market-data endpoint (wss).
    fn ws_base_url(&self) -> &'static str;

    /// Application-level heartbeat cadence; protocol-level pings are handled
    /// by the WebSocket library itself.
    fn heartbeat_interval(&self) -> std::time::Duration;

    /// Frames to send when (re-)subscribing the symbol set. Adapters MUST
    /// return the snapshot-capable subscription first where the venue has
    /// such a notion.
    fn subscribe_frames(&self, symbols: &[Symbol]) -> Vec<String>;

    /// Frames to send when unsubscribing (graceful drain).
    fn unsubscribe_frames(&self, symbols: &[Symbol]) -> Vec<String>;

    /// Application-level keepalive frame, when the venue uses one (OKX sends
    /// literal "ping"; Bybit an op:ping; Binance none at app level).
    fn heartbeat_frame(&self) -> Option<String>;

    /// True when the frame is this venue's heartbeat reply.
    fn is_heartbeat_reply(&self, raw: &str) -> bool;

    /// True when the frame is a control ack (subscription confirmation and
    /// friends) and carries no market events.
    fn is_control_frame(&self, raw: &str) -> bool;

    /// Parses one wire frame into zero or more normalized events. Zero
    /// events with Ok(()) is valid (control frames); there is NEVER a
    /// fabricated fallback event on failure — failures are errors.
    fn parse_message(&self, raw: &str) -> Result<Vec<AdapterEvent>, GatewayError>;

    fn supports(&self, capability: Capability) -> bool;

    fn recovery_strategy(&self) -> RecoveryStrategy;
}

/// Shared JSON helper for wire decoding: serde_json with byte-limited input.
pub(crate) fn parse_json(raw: &str) -> Result<serde_json::Value, GatewayError> {
    if raw.len() > crate::types::MAX_FEED_FRAME_BYTES {
        return Err(GatewayError::MalformedData(format!(
            "frame of {} bytes exceeds limit",
            raw.len()
        )));
    }
    serde_json::from_str(raw).map_err(|e| GatewayError::MalformedData(format!("json: {e}")))
}

/// Shared helper: parses a `[price, quantity]` wire pair.
pub(crate) fn parse_level_pair(
    pair: &[serde_json::Value],
    venue: &str,
) -> Result<crate::types::Level, GatewayError> {
    let mut it = pair.iter();
    let price = it
        .next()
        .and_then(|v| v.as_str().map(str::to_string))
        .ok_or_else(|| GatewayError::MalformedData(format!("{venue}: level price missing")))?;
    let qty = it
        .next()
        .and_then(|v| v.as_str().map(str::to_string))
        .ok_or_else(|| GatewayError::MalformedData(format!("{venue}: level quantity missing")))?;
    crate::types::Level::from_wire(&price, &qty)
}

/// Shared helper: parses a whole side's level matrix.
pub(crate) fn parse_level_matrix(
    raw: &[serde_json::Value],
    venue: &str,
) -> Result<Vec<crate::types::Level>, GatewayError> {
    raw.iter()
        .map(|entry| {
            entry
                .as_array()
                .ok_or_else(|| GatewayError::MalformedData(format!("{venue}: level not an array")))
                .and_then(|pair| parse_level_pair(pair, venue))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 26 support] the shared wire helpers reject malformed structures
    // explicitly instead of inventing defaults.
    #[test]
    fn level_helpers_reject_malformed_wire_shapes() {
        let bad_json = parse_json("{not json");
        assert!(matches!(bad_json, Err(GatewayError::MalformedData(_))));

        let empty_pair = parse_level_pair(&[], "binance");
        assert!(matches!(empty_pair, Err(GatewayError::MalformedData(_))));

        let one_sided = parse_level_pair(&[serde_json::json!("100.5")], "bybit");
        assert!(matches!(one_sided, Err(GatewayError::MalformedData(_))));

        let numeric_price =
            parse_level_pair(&[serde_json::json!(100.5), serde_json::json!("1")], "okx");
        assert!(matches!(numeric_price, Err(GatewayError::MalformedData(_))));

        let good = parse_level_pair(
            &[serde_json::json!("100.5"), serde_json::json!("0.25")],
            "binance",
        )
        .expect("good level");
        assert_eq!(good.price.to_string(), "100.5");
        assert_eq!(good.quantity.to_string(), "0.25");

        let bad_matrix = parse_level_matrix(
            &[serde_json::json!(["1", "2"]), serde_json::json!(3)],
            "okx",
        );
        assert!(bad_matrix.is_err());
    }

    // [CHECK 26] oversized frames are refused, never truncated into events.
    #[test]
    fn oversized_frames_are_refused() {
        let big = "x".repeat(crate::types::MAX_FEED_FRAME_BYTES + 1);
        assert!(matches!(
            parse_json(&big),
            Err(GatewayError::MalformedData(_))
        ));
    }
}
