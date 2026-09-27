//! Bybit v5 public market-data adapter (spot).
//!
//! Real wire behavior of `wss://stream.bybit.com/v5/public/spot`:
//! - subscribe/unsubscribe via `{"op":"subscribe","args":["orderbook.50.X", ...]}`;
//! - `orderbook.50.<SYMBOL>` frames with `type: "snapshot" | "delta"`, the
//!   symbol-local update id in `data.u` and the cross-stream `data.seq`;
//! - `publicTrade.<SYMBOL>` with taker side in `data[].S`;
//! - `tickers.<SYMBOL>` spot best bid/ask + last;
//! - application-level heartbeat `{"op":"ping"}` answered by `{"op":"pong"}`;
//! - subscribe ack `{"op":"subscribe","success":true,...}` is a control
//!   frame; a `success:false` ack is an explicit provider failure.
//!
//! Only these channels are subscribed; unknown topics fail with an explicit
//! unsupported-capability error.

use serde_json::Value;

use crate::adapters::exchange_ws::{
    parse_json, parse_level_matrix, AdapterEvent, Capability, MarketDataAdapter, RecoveryStrategy,
};
use crate::error::GatewayError;
use crate::types::{Fixed, MarketEventKind, OrderSide, Sequence, StreamKind, Symbol, Venue};

pub const BYBIT_WS_BASE: &str = "wss://stream.bybit.com/v5/public/spot";

#[derive(Default)]
pub struct BybitAdapter;

impl BybitAdapter {
    pub fn new() -> BybitAdapter {
        BybitAdapter
    }

    /// Topic parser: `orderbook.50.BTCUSDT` -> (BTCUSDT, OrderBook).
    fn split_topic(topic: &str) -> Result<(Symbol, StreamKind), GatewayError> {
        let segments: Vec<&str> = topic.split('.').collect();
        let (raw_symbol, kind) =
            match segments.first().copied() {
                Some("orderbook") => (
                    segments.last().copied().ok_or_else(|| {
                        GatewayError::MalformedData(format!("bybit: topic {topic}"))
                    })?,
                    StreamKind::BookDepth,
                ),
                Some("publicTrade") => (
                    segments.last().copied().ok_or_else(|| {
                        GatewayError::MalformedData(format!("bybit: topic {topic}"))
                    })?,
                    StreamKind::Trades,
                ),
                Some("tickers") => (
                    segments.last().copied().ok_or_else(|| {
                        GatewayError::MalformedData(format!("bybit: topic {topic}"))
                    })?,
                    StreamKind::Ticker,
                ),
                Some(other) => {
                    return Err(GatewayError::UnsupportedCapability(format!(
                        "bybit channel '{other}' is not subscribed by this gateway"
                    )))
                }
                None => {
                    return Err(GatewayError::MalformedData(format!(
                        "bybit: empty topic '{topic}'"
                    )))
                }
            };
        Ok((Symbol::new(raw_symbol)?, kind))
    }

    fn parse_orderbook(frame: &Value, topic: &str) -> Result<Vec<AdapterEvent>, GatewayError> {
        let msg_type = frame
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| GatewayError::MalformedData("bybit: orderbook missing type".into()))?;
        let ts = frame.get("ts").and_then(Value::as_i64);
        // data may be a single object (orderbook) — arrays are malformed here.
        let data = frame
            .get("data")
            .and_then(Value::as_object)
            .ok_or_else(|| GatewayError::MalformedData("bybit: orderbook data missing".into()))?;
        let symbol_str = data.get("s").and_then(Value::as_str).ok_or_else(|| {
            GatewayError::MalformedData("bybit: orderbook missing symbol s".into())
        })?;
        let symbol = Symbol::new(symbol_str)?;
        let bids = parse_level_matrix(
            data.get("b").and_then(Value::as_array).ok_or_else(|| {
                GatewayError::MalformedData("bybit: orderbook missing bids".into())
            })?,
            "bybit",
        )?;
        let asks = parse_level_matrix(
            data.get("a").and_then(Value::as_array).ok_or_else(|| {
                GatewayError::MalformedData("bybit: orderbook missing asks".into())
            })?,
            "bybit",
        )?;
        let seq: Sequence = data.get("u").and_then(Value::as_u64).ok_or_else(|| {
            GatewayError::MalformedData("bybit: orderbook missing update id u".into())
        })?;

        let is_snapshot = msg_type == "snapshot";
        let kind = if is_snapshot {
            MarketEventKind::BookSnapshot { bids, asks }
        } else if msg_type == "delta" {
            MarketEventKind::BookDelta {
                bids,
                asks,
                prev_sequence: None,
            }
        } else {
            return Err(GatewayError::MalformedData(format!(
                "bybit: unknown orderbook type '{msg_type}' on {topic}"
            )));
        };
        Ok(vec![AdapterEvent {
            symbol,
            stream_kind: StreamKind::BookDepth,
            sequence: Some(seq),
            prev_sequence: None,
            provider_ms: ts,
            kind,
            is_anchor: is_snapshot,
        }])
    }

    fn parse_public_trade(frame: &Value) -> Result<Vec<AdapterEvent>, GatewayError> {
        let ts = frame.get("ts").and_then(Value::as_i64);
        let rows = frame
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| GatewayError::MalformedData("bybit: publicTrade data missing".into()))?;
        let mut events = Vec::with_capacity(rows.len());
        for row in rows {
            let symbol = Symbol::new(row.get("s").and_then(Value::as_str).ok_or_else(|| {
                GatewayError::MalformedData("bybit: trade missing symbol".into())
            })?)?;
            let taker_side =
                match row.get("S").and_then(Value::as_str).ok_or_else(|| {
                    GatewayError::MalformedData("bybit: trade missing side S".into())
                })? {
                    "Buy" => OrderSide::Buy,
                    "Sell" => OrderSide::Sell,
                    other => {
                        return Err(GatewayError::MalformedData(format!(
                            "bybit: unknown trade side '{other}'"
                        )))
                    }
                };
            events.push(AdapterEvent {
                symbol,
                stream_kind: StreamKind::Trades,
                // Bybit trades are unsequenced per trade id; sequence stays
                // None and identity is the trade id.
                sequence: None,
                prev_sequence: None,
                provider_ms: row.get("T").and_then(Value::as_i64).or(ts),
                kind: MarketEventKind::TradeTick {
                    price: Fixed::parse(row.get("p").and_then(Value::as_str).ok_or_else(
                        || GatewayError::MalformedData("bybit: trade missing price".into()),
                    )?)?,
                    quantity: Fixed::parse(row.get("v").and_then(Value::as_str).ok_or_else(
                        || GatewayError::MalformedData("bybit: trade missing size".into()),
                    )?)?,
                    taker_side,
                    trade_id: row
                        .get("i")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                },
                is_anchor: false,
            });
        }
        Ok(events)
    }

    fn parse_tickers(frame: &Value) -> Result<Vec<AdapterEvent>, GatewayError> {
        let ts = frame.get("ts").and_then(Value::as_i64);
        let data = frame
            .get("data")
            .and_then(Value::as_object)
            .ok_or_else(|| GatewayError::MalformedData("bybit: tickers data missing".into()))?;
        let symbol =
            Symbol::new(data.get("symbol").and_then(Value::as_str).ok_or_else(|| {
                GatewayError::MalformedData("bybit: tickers missing symbol".into())
            })?)?;
        let str_field = |key: &str| -> Result<Option<Fixed>, GatewayError> {
            match data.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(s)) => Ok(Some(Fixed::parse(s)?)),
                Some(_) => Err(GatewayError::MalformedData(format!(
                    "bybit: tickers field '{key}' expected decimal string"
                ))),
            }
        };
        let kind = MarketEventKind::Ticker {
            last_price: str_field("lastPrice")?,
            bid_price: str_field("bid1Price")?,
            ask_price: str_field("ask1Price")?,
            high_24h: str_field("highPrice_24h")?,
            low_24h: str_field("lowPrice_24h")?,
            volume_24h: str_field("volume_24h")?,
        };
        Ok(vec![AdapterEvent {
            symbol,
            stream_kind: StreamKind::Ticker,
            sequence: None,
            prev_sequence: None,
            provider_ms: ts,
            kind,
            is_anchor: false,
        }])
    }
}

impl MarketDataAdapter for BybitAdapter {
    fn venue(&self) -> Venue {
        Venue::Bybit
    }

    fn ws_base_url(&self) -> &'static str {
        BYBIT_WS_BASE
    }

    fn heartbeat_interval(&self) -> std::time::Duration {
        // Bybit requires an application ping every <=20s.
        std::time::Duration::from_secs(15)
    }

    fn subscribe_frames(&self, symbols: &[Symbol]) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();
        for symbol in symbols {
            let s = symbol.as_str();
            args.push(format!("orderbook.50.{s}"));
            args.push(format!("publicTrade.{s}"));
            args.push(format!("tickers.{s}"));
        }
        vec![serde_json::json!({ "op": "subscribe", "args": args }).to_string()]
    }

    fn unsubscribe_frames(&self, symbols: &[Symbol]) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();
        for symbol in symbols {
            let s = symbol.as_str();
            args.push(format!("orderbook.50.{s}"));
            args.push(format!("publicTrade.{s}"));
            args.push(format!("tickers.{s}"));
        }
        vec![serde_json::json!({ "op": "unsubscribe", "args": args }).to_string()]
    }

    fn heartbeat_frame(&self) -> Option<String> {
        Some(serde_json::json!({ "op": "ping" }).to_string())
    }

    fn is_heartbeat_reply(&self, raw: &str) -> bool {
        raw.contains("\"op\":\"pong\"")
    }

    fn is_control_frame(&self, raw: &str) -> bool {
        let value = match parse_json(raw) {
            Ok(v) => v,
            Err(_) => return false,
        };
        value.get("op").and_then(Value::as_str).is_some()
    }

    fn parse_message(&self, raw: &str) -> Result<Vec<AdapterEvent>, GatewayError> {
        let frame = parse_json(raw)?;
        if self.is_heartbeat_reply(raw) {
            return Ok(Vec::new());
        }
        if let Some(op) = frame.get("op").and_then(Value::as_str) {
            return match op {
                "subscribe" | "unsubscribe" | "auth" | "pong" => {
                    if frame.get("success").and_then(Value::as_bool) == Some(false) {
                        Err(GatewayError::ProviderFailure(format!(
                            "bybit: {} op failed: {}",
                            op,
                            frame
                                .get("ret_msg")
                                .and_then(Value::as_str)
                                .unwrap_or("no detail")
                        )))
                    } else {
                        Ok(Vec::new())
                    }
                }
                other => Err(GatewayError::UnsupportedCapability(format!(
                    "bybit: op '{other}' is not handled by this gateway"
                ))),
            };
        }
        let topic = frame
            .get("topic")
            .and_then(Value::as_str)
            .ok_or_else(|| GatewayError::MalformedData("bybit: frame missing topic".into()))?;
        let (_symbol, kind) = BybitAdapter::split_topic(topic)?;
        match kind {
            StreamKind::BookDepth => BybitAdapter::parse_orderbook(&frame, topic),
            StreamKind::Trades => BybitAdapter::parse_public_trade(&frame),
            StreamKind::Ticker => BybitAdapter::parse_tickers(&frame),
            StreamKind::BookTicker | StreamKind::PartialBook => {
                Err(GatewayError::UnsupportedCapability(format!(
                    "bybit: stream kind {kind:?} is not subscribed"
                )))
            }
        }
    }

    fn supports(&self, capability: Capability) -> bool {
        matches!(
            capability,
            Capability::Trades | Capability::BookDepthDiff | Capability::Ticker
        )
    }

    fn recovery_strategy(&self) -> RecoveryStrategy {
        // Re-subscription always starts with type:"snapshot" before deltas.
        RecoveryStrategy::ResubscribeYieldsSnapshot
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SNAPSHOT: &str = r#"{"topic":"orderbook.50.BTCUSDT","type":"snapshot","ts":1672304489723,"data":{"s":"BTCUSDT","b":[["16649.5","2.000"],["16649.0","1.000"]],"a":[["16650.0","1.500"],["16650.5","3.000"]],"u":10251086,"seq":7969023127}}"#;
    const DELTA: &str = r#"{"topic":"orderbook.50.BTCUSDT","type":"delta","ts":1672304489997,"data":{"s":"BTCUSDT","b":[["16649.5","0"]],"a":[["16650.5","4.000"]],"u":10251088,"seq":7969023311}}"#;
    const TRADE: &str = r#"{"topic":"publicTrade.BTCUSDT","type":"snapshot","ts":1672304489431,"data":[{"T":1672304489429,"s":"BTCUSDT","S":"Sell","v":"0.001","p":"16649.0","i":"trade-1","BT":false,"LT":false},{"T":1672304489430,"s":"BTCUSDT","S":"Buy","v":"0.010","p":"16649.5","i":"trade-2","BT":false,"LT":false}]}"#;
    const TICKER: &str = r#"{"topic":"tickers.BTCUSDT","type":"snapshot","ts":1672304489123,"data":{"symbol":"BTCUSDT","lastPrice":"16649.5","bid1Price":"16649.0","bid1Size":"2.0","ask1Price":"16650.0","ask1Size":"1.5","highPrice_24h":"16900.0","lowPrice_24h":"16400.0","volume_24h":"12345.6"}}"#;

    fn adapter() -> BybitAdapter {
        BybitAdapter::new()
    }

    // [CHECK 24] Bybit adapter parses a supported orderbook frame pair.
    #[test]
    fn parses_orderbook_snapshot_and_delta() {
        let events = adapter().parse_message(SNAPSHOT).expect("snapshot");
        assert_eq!(events.len(), 1);
        assert!(events[0].is_anchor);
        assert_eq!(events[0].sequence, Some(10_251_086));
        assert_eq!(events[0].provider_ms, Some(1_672_304_489_723));
        assert!(matches!(
            events[0].kind,
            MarketEventKind::BookSnapshot { .. }
        ));

        let events = adapter().parse_message(DELTA).expect("delta");
        assert!(!events[0].is_anchor);
        assert_eq!(events[0].sequence, Some(10_251_088));
        assert!(matches!(events[0].kind, MarketEventKind::BookDelta { .. }));
    }

    #[test]
    fn parses_trades_with_taker_side() {
        let events = adapter().parse_message(TRADE).expect("trades");
        assert_eq!(events.len(), 2);
        match &events[0].kind {
            MarketEventKind::TradeTick {
                price,
                quantity,
                taker_side,
                trade_id,
            } => {
                assert_eq!(price.to_string(), "16649.0");
                assert_eq!(quantity.to_string(), "0.001");
                assert_eq!(*taker_side, OrderSide::Sell);
                assert_eq!(trade_id, "trade-1");
            }
            other => panic!("expected trade, got {other:?}"),
        }
        match &events[1].kind {
            MarketEventKind::TradeTick { taker_side, .. } => {
                assert_eq!(*taker_side, OrderSide::Buy)
            }
            other => panic!("expected trade, got {other:?}"),
        }
    }

    #[test]
    fn parses_tickers() {
        let events = adapter().parse_message(TICKER).expect("tickers");
        match &events[0].kind {
            MarketEventKind::Ticker {
                last_price,
                bid_price,
                ask_price,
                volume_24h,
                ..
            } => {
                assert_eq!(
                    last_price.as_ref().map(|p| p.to_string()),
                    Some("16649.5".into())
                );
                assert_eq!(
                    bid_price.as_ref().map(|p| p.to_string()),
                    Some("16649.0".into())
                );
                assert_eq!(
                    ask_price.as_ref().map(|p| p.to_string()),
                    Some("16650.0".into())
                );
                assert_eq!(
                    volume_24h.as_ref().map(|p| p.to_string()),
                    Some("12345.6".into())
                );
            }
            other => panic!("expected ticker, got {other:?}"),
        }
    }

    // [CHECK 26] unsupported channels and malformed frames fail explicitly.
    #[test]
    fn unsupported_and_malformed_fail_explicitly() {
        let kline = r#"{"topic":"kline.1.BTCUSDT","ts":1,"type":"snapshot","data":{}}"#;
        let err = adapter()
            .parse_message(kline)
            .expect_err("kline unsupported");
        assert!(matches!(err, GatewayError::UnsupportedCapability(_)));

        let no_topic = r#"{"ts":1}"#;
        assert!(matches!(
            adapter().parse_message(no_topic),
            Err(GatewayError::MalformedData(_))
        ));

        let bad_type = r#"{"topic":"orderbook.50.BTCUSDT","type":"mystery","data":{"s":"BTCUSDT","b":[],"a":[],"u":1}}"#;
        assert!(matches!(
            adapter().parse_message(bad_type),
            Err(GatewayError::MalformedData(_))
        ));
    }

    // [CHECK 27/29 support] subscribe failure is an explicit provider
    // failure; successful acks are silent control frames.
    #[test]
    fn subscribe_acks_and_failures() {
        let ack =
            r#"{"op":"subscribe","success":true,"conn_id":"co1","data":["orderbook.50.BTCUSDT"]}"#;
        assert!(adapter().parse_message(ack).expect("ack").is_empty());
        let nack =
            r#"{"op":"subscribe","success":false,"conn_id":"co1","ret_msg":"invalid symbol"}"#;
        let err = adapter().parse_message(nack).expect_err("nack");
        assert!(matches!(err, GatewayError::ProviderFailure(_)));
    }

    // Heartbeat: application ping every 15s, pong recognized.
    #[test]
    fn heartbeat_behavior() {
        assert_eq!(
            adapter().heartbeat_frame(),
            Some(r#"{"op":"ping"}"#.to_string())
        );
        assert!(adapter().is_heartbeat_reply(r#"{"op":"pong","ts":1672304489999}"#));
        assert!(adapter()
            .parse_message(r#"{"op":"pong","ts":1}"#)
            .expect("pong")
            .is_empty());
        assert!(!adapter().is_heartbeat_reply(r#"{"topic":"publicTrade.BTCUSDT"}"#));
    }

    #[test]
    fn subscription_frames_cover_required_channels() {
        let frames = adapter().subscribe_frames(&[Symbol::new("BTCUSDT").expect("s")]);
        assert_eq!(frames.len(), 1);
        for channel in [
            "orderbook.50.BTCUSDT",
            "publicTrade.BTCUSDT",
            "tickers.BTCUSDT",
        ] {
            assert!(frames[0].contains(channel));
        }
        assert_eq!(adapter().venue(), Venue::Bybit);
        assert!(!adapter().supports(Capability::PartialBook));
        assert_eq!(
            adapter().recovery_strategy(),
            RecoveryStrategy::ResubscribeYieldsSnapshot
        );
    }
}
