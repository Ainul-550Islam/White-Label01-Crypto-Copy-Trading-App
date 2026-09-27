//! Production event parser facade.
//!
//! Dispatches raw venue frames to the concrete adapter for that venue and
//! guarantees the normalization contract: malformed input yields an error
//! and ZERO events — there is no fabricated fallback event anywhere in this
//! path. Counting happens at the call site (pipeline), keeping this module
//! pure and deterministic.

use std::collections::HashMap;
use std::sync::Arc;

use crate::adapters::binance::BinanceAdapter;
use crate::adapters::bybit::BybitAdapter;
use crate::adapters::exchange_ws::{AdapterEvent, MarketDataAdapter};
use crate::adapters::okx::OkxAdapter;
use crate::error::GatewayError;
use crate::types::Venue;

pub struct EventParser {
    adapters: HashMap<Venue, Arc<dyn MarketDataAdapter>>,
}

impl EventParser {
    /// Builds adapters for exactly the configured venues. Unknown venues are
    /// refused at configuration time, so this map is total for boot.
    pub fn for_venues(venues: &[Venue]) -> EventParser {
        let mut adapters: HashMap<Venue, Arc<dyn MarketDataAdapter>> = HashMap::new();
        for venue in venues {
            let adapter: Arc<dyn MarketDataAdapter> = match venue {
                Venue::Binance => Arc::new(BinanceAdapter::new()),
                Venue::Bybit => Arc::new(BybitAdapter::new()),
                Venue::Okx => Arc::new(OkxAdapter::new()),
            };
            adapters.insert(*venue, adapter);
        }
        EventParser { adapters }
    }

    pub fn adapter(&self, venue: Venue) -> Option<Arc<dyn MarketDataAdapter>> {
        self.adapters.get(&venue).cloned()
    }

    pub fn venues(&self) -> Vec<Venue> {
        let mut v: Vec<Venue> = self.adapters.keys().copied().collect();
        v.sort();
        v
    }

    /// Parses one raw venue frame. Ok(vec![]) for control frames; Err on
    /// any malformed/unsupported input with zero events emitted.
    pub fn parse_frame(&self, venue: Venue, raw: &str) -> Result<Vec<AdapterEvent>, GatewayError> {
        let adapter = self.adapters.get(&venue).ok_or_else(|| {
            GatewayError::UnsupportedCapability(format!("no adapter for venue {venue}"))
        })?;
        adapter.parse_message(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 4] parser accepts a valid message and produces exactly the
    // normalized events the frame describes.
    #[test]
    fn parser_accepts_valid_messages() {
        let parser = EventParser::for_venues(&[Venue::Binance, Venue::Bybit, Venue::Okx]);
        let trade = r#"{"stream":"btcusdt@trade","data":{"e":"trade","E":1672515782136,"s":"BTCUSDT","t":1,"p":"61234.55","q":"0.012","m":false}}"#;
        let events = parser.parse_frame(Venue::Binance, trade).expect("parses");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].symbol.as_str(), "BTCUSDT");

        let tape = r#"{"topic":"publicTrade.BTCUSDT","type":"snapshot","ts":1,"data":[{"T":1,"s":"BTCUSDT","S":"Buy","v":"0.01","p":"26000.0","i":"t1"}]}"#;
        let events = parser.parse_frame(Venue::Bybit, tape).expect("parses");
        assert_eq!(events.len(), 1);
        assert_eq!(parser.venues().len(), 3);
        assert!(parser.adapter(Venue::Okx).is_some());
    }

    // [CHECK 5] malformed events are rejected; zero events are produced;
    // there is no fabricated fallback market data.
    #[test]
    fn parser_rejects_malformed_with_zero_events() {
        let parser = EventParser::for_venues(&[Venue::Binance, Venue::Okx]);
        for bad in [
            "not json",
            "{}",
            r#"{"stream":"btcusdt@trade"}"#,
            r#"{"stream":"btcusdt@trade","data":{}}"#,
            r#"{"stream":"btcusdt@madeup","data":{}}"#,
        ] {
            let result = parser.parse_frame(Venue::Binance, bad);
            assert!(result.is_err(), "expected rejection for {bad}");
            assert!(
                result.unwrap_or_default().is_empty(),
                "no fabricated events for {bad}"
            );
        }
        // A venue without an adapter is an explicit capability error.
        let bybit_free = EventParser::for_venues(&[Venue::Binance]);
        let err = bybit_free
            .parse_frame(Venue::Bybit, "{}")
            .expect_err("no adapter");
        assert!(matches!(err, GatewayError::UnsupportedCapability(_)));
    }
}
