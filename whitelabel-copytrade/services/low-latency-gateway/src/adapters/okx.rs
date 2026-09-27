//! OKX v5 public market-data adapter.
//!
//! Real wire behavior of `wss://ws.okx.com:8443/ws/v5/public`:
//! - subscribe/unsubscribe via `{"op":"subscribe","args":[{"channel":..,
//!   "instId":..}, ...]}`;
//! - `books5` channel: complete top-5 snapshots per push, anchored by
//!   `seqId`;
//! - `books` channel: `action: "snapshot" | "update"` with
//!   `prevSeqId + 1 == seqId` continuity;
//! - `trades` channel with taker `side` and per-trade `tradeId`;
//! - `tickers` channel with best bid/ask and 24h statistics;
//! - application-level keepalive: the literal text frame `ping`, answered
//!   by the literal text frame `pong` (OKX does not use JSON here);
//! - subscribe acks `{"event":"subscribe",...}` are control frames;
//!   `{"event":"error","code":..,"msg":..}` is an explicit provider failure.
//!
//! Only these channels are subscribed; anything else fails explicitly.

use serde_json::Value;

use crate::adapters::exchange_ws::{
    parse_json, parse_level_matrix, AdapterEvent, Capability, MarketDataAdapter, RecoveryStrategy,
};
use crate::error::GatewayError;
use crate::types::{Fixed, MarketEventKind, OrderSide, Sequence, StreamKind, Symbol, Venue};

pub const OKX_WS_BASE: &str = "wss://ws.okx.com:8443/ws/v5/public";

#[derive(Default)]
pub struct OkxAdapter;

impl OkxAdapter {
    pub fn new() -> OkxAdapter {
        OkxAdapter
    }

    fn parse_entry_levels(
        entry: &Value,
    ) -> Result<(Vec<crate::types::Level>, Vec<crate::types::Level>), GatewayError> {
        let asks = parse_level_matrix(
            entry
                .get("asks")
                .and_then(Value::as_array)
                .ok_or_else(|| GatewayError::MalformedData("okx: data missing asks".into()))?,
            "okx",
        )?;
        let bids = parse_level_matrix(
            entry
                .get("bids")
                .and_then(Value::as_array)
                .ok_or_else(|| GatewayError::MalformedData("okx: data missing bids".into()))?,
            "okx",
        )?;
        Ok((bids, asks))
    }

    fn parse_books(
        frame: &Value,
        channel: &str,
        inst_id: &str,
    ) -> Result<Vec<AdapterEvent>, GatewayError> {
        let symbol = Symbol::new(inst_id)?;
        let rows = frame
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| GatewayError::MalformedData("okx: books data missing".into()))?;
        let mut events = Vec::with_capacity(rows.len());
        for entry in rows {
            let (bids, asks) = Self::parse_entry_levels(entry)?;
            let seq: Sequence = entry
                .get("seqId")
                .and_then(Value::as_u64)
                .ok_or_else(|| GatewayError::MalformedData("okx: books missing seqId".into()))?;
            let prev: Option<Sequence> = entry.get("prevSeqId").and_then(Value::as_u64);
            let (kind, is_anchor) = if channel == "books5" {
                (MarketEventKind::BookSnapshot { bids, asks }, true)
            } else {
                let action = frame.get("action").and_then(Value::as_str).ok_or_else(|| {
                    GatewayError::MalformedData("okx: books frame missing action".into())
                })?;
                match action {
                    "snapshot" => (MarketEventKind::BookSnapshot { bids, asks }, true),
                    "update" => (
                        MarketEventKind::BookDelta {
                            bids,
                            asks,
                            prev_sequence: prev,
                        },
                        false,
                    ),
                    other => {
                        return Err(GatewayError::MalformedData(format!(
                            "okx: unknown books action '{other}'"
                        )))
                    }
                }
            };
            events.push(AdapterEvent {
                symbol: symbol.clone(),
                stream_kind: if channel == "books5" {
                    StreamKind::PartialBook
                } else {
                    StreamKind::BookDepth
                },
                sequence: Some(seq),
                prev_sequence: prev,
                provider_ms: entry.get("ts").and_then(Value::as_i64),
                kind,
                is_anchor,
            });
        }
        Ok(events)
    }

    fn parse_trades(frame: &Value, inst_id: &str) -> Result<Vec<AdapterEvent>, GatewayError> {
        let symbol = Symbol::new(inst_id)?;
        let rows = frame
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| GatewayError::MalformedData("okx: trades data missing".into()))?;
        let mut events = Vec::with_capacity(rows.len());
        for row in rows {
            let side = match row
                .get("side")
                .and_then(Value::as_str)
                .ok_or_else(|| GatewayError::MalformedData("okx: trade missing side".into()))?
            {
                "buy" => OrderSide::Buy,
                "sell" => OrderSide::Sell,
                other => {
                    return Err(GatewayError::MalformedData(format!(
                        "okx: unknown trade side '{other}'"
                    )))
                }
            };
            events.push(AdapterEvent {
                symbol: symbol.clone(),
                stream_kind: StreamKind::Trades,
                sequence: None,
                prev_sequence: None,
                provider_ms: row.get("ts").and_then(Value::as_i64),
                kind: MarketEventKind::TradeTick {
                    price: Fixed::parse(row.get("px").and_then(Value::as_str).ok_or_else(
                        || GatewayError::MalformedData("okx: trade missing px".into()),
                    )?)?,
                    quantity: Fixed::parse(row.get("sz").and_then(Value::as_str).ok_or_else(
                        || GatewayError::MalformedData("okx: trade missing sz".into()),
                    )?)?,
                    taker_side: side,
                    trade_id: row
                        .get("tradeId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                },
                is_anchor: false,
            });
        }
        Ok(events)
    }

    fn parse_tickers(frame: &Value, inst_id: &str) -> Result<Vec<AdapterEvent>, GatewayError> {
        let symbol = Symbol::new(inst_id)?;
        let rows = frame
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| GatewayError::MalformedData("okx: tickers data missing".into()))?;
        let mut events = Vec::with_capacity(rows.len());
        for row in rows {
            let str_field = |key: &str| -> Result<Option<Fixed>, GatewayError> {
                match row.get(key) {
                    None | Some(Value::Null) => Ok(None),
                    Some(Value::String(s)) => Ok(Some(Fixed::parse(s)?)),
                    Some(_) => Err(GatewayError::MalformedData(format!(
                        "okx: tickers field '{key}' expected decimal string"
                    ))),
                }
            };
            events.push(AdapterEvent {
                symbol: symbol.clone(),
                stream_kind: StreamKind::Ticker,
                sequence: None,
                prev_sequence: None,
                provider_ms: row.get("ts").and_then(Value::as_i64),
                kind: MarketEventKind::Ticker {
                    last_price: str_field("last")?,
                    bid_price: str_field("bidPx")?,
                    ask_price: str_field("askPx")?,
                    high_24h: str_field("high24h")?,
                    low_24h: str_field("low24h")?,
                    volume_24h: str_field("vol24h")?,
                },
                is_anchor: false,
            });
        }
        Ok(events)
    }
}

impl MarketDataAdapter for OkxAdapter {
    fn venue(&self) -> Venue {
        Venue::Okx
    }

    fn ws_base_url(&self) -> &'static str {
        OKX_WS_BASE
    }

    fn heartbeat_interval(&self) -> std::time::Duration {
        // OKX drops idle connections after ~30s; ping at 15s.
        std::time::Duration::from_secs(15)
    }

    fn subscribe_frames(&self, symbols: &[Symbol]) -> Vec<String> {
        let mut args: Vec<Value> = Vec::new();
        for symbol in symbols {
            let inst = symbol.as_str();
            args.push(serde_json::json!({ "channel": "books5", "instId": inst }));
            args.push(serde_json::json!({ "channel": "books", "instId": inst }));
            args.push(serde_json::json!({ "channel": "trades", "instId": inst }));
            args.push(serde_json::json!({ "channel": "tickers", "instId": inst }));
        }
        vec![serde_json::json!({ "op": "subscribe", "args": args }).to_string()]
    }

    fn unsubscribe_frames(&self, symbols: &[Symbol]) -> Vec<String> {
        let mut args: Vec<Value> = Vec::new();
        for symbol in symbols {
            let inst = symbol.as_str();
            args.push(serde_json::json!({ "channel": "books5", "instId": inst }));
            args.push(serde_json::json!({ "channel": "books", "instId": inst }));
            args.push(serde_json::json!({ "channel": "trades", "instId": inst }));
            args.push(serde_json::json!({ "channel": "tickers", "instId": inst }));
        }
        vec![serde_json::json!({ "op": "unsubscribe", "args": args }).to_string()]
    }

    fn heartbeat_frame(&self) -> Option<String> {
        // OKX keepalive is the literal text "ping" (answered with "pong"),
        // NOT a JSON frame and NOT a WS protocol ping.
        Some("ping".to_string())
    }

    fn is_heartbeat_reply(&self, raw: &str) -> bool {
        raw.trim() == "pong"
    }

    fn is_control_frame(&self, raw: &str) -> bool {
        parse_json(raw)
            .ok()
            .and_then(|v| v.get("event").and_then(Value::as_str).map(str::to_string))
            .map(|event| event == "subscribe" || event == "unsubscribe")
            .unwrap_or(false)
    }

    fn parse_message(&self, raw: &str) -> Result<Vec<AdapterEvent>, GatewayError> {
        if self.is_heartbeat_reply(raw) {
            return Ok(Vec::new());
        }
        let frame = parse_json(raw)?;
        if let Some(event) = frame.get("event").and_then(Value::as_str) {
            return match event {
                "subscribe" | "unsubscribe" => Ok(Vec::new()),
                "error" => Err(GatewayError::ProviderFailure(format!(
                    "okx: {} (code {})",
                    frame
                        .get("msg")
                        .and_then(Value::as_str)
                        .unwrap_or("no detail"),
                    frame.get("code").and_then(Value::as_str).unwrap_or("?")
                ))),
                other => Err(GatewayError::UnsupportedCapability(format!(
                    "okx: event '{other}' is not handled by this gateway"
                ))),
            };
        }
        let arg = frame
            .get("arg")
            .and_then(Value::as_object)
            .ok_or_else(|| GatewayError::MalformedData("okx: frame missing arg".into()))?;
        let channel = arg
            .get("channel")
            .and_then(Value::as_str)
            .ok_or_else(|| GatewayError::MalformedData("okx: arg missing channel".into()))?;
        let inst_id = arg
            .get("instId")
            .and_then(Value::as_str)
            .ok_or_else(|| GatewayError::MalformedData("okx: arg missing instId".into()))?;
        match channel {
            "books5" | "books" => OkxAdapter::parse_books(&frame, channel, inst_id),
            "trades" => OkxAdapter::parse_trades(&frame, inst_id),
            "tickers" => OkxAdapter::parse_tickers(&frame, inst_id),
            other => Err(GatewayError::UnsupportedCapability(format!(
                "okx: channel '{other}' is not subscribed by this gateway"
            ))),
        }
    }

    fn supports(&self, capability: Capability) -> bool {
        matches!(
            capability,
            Capability::Trades
                | Capability::PartialBook
                | Capability::BookDepthDiff
                | Capability::Ticker
        )
    }

    fn recovery_strategy(&self) -> RecoveryStrategy {
        // The books channel opens with action:"snapshot" on re-subscribe.
        RecoveryStrategy::ResubscribeYieldsSnapshot
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOOKS5: &str = r#"{"arg":{"channel":"books5","instId":"BTC-USDT"},"data":[{"asks":[["27003.9","2.0","0","2"],["27004.0","3.0","0","1"]],"bids":[["27003.8","1.5","0","1"],["27003.7","2.5","0","2"]],"ts":1697026383085,"seqId":159772457}]}"#;
    const BOOKS_UPDATE: &str = r#"{"arg":{"channel":"books","instId":"BTC-USDT"},"action":"update","data":[{"asks":[["27004.0","0","0","0"],["27004.1","1.0","0","1"]],"bids":[["27003.8","2.0","0","1"]],"ts":1697026383200,"seqId":159772458,"prevSeqId":159772457}]}"#;
    const BOOKS_SNAPSHOT: &str = r#"{"arg":{"channel":"books","instId":"BTC-USDT"},"action":"snapshot","data":[{"asks":[["27004.0","3.0","0","1"]],"bids":[["27003.8","2.0","0","1"]],"ts":1697026383300,"seqId":159772459}]}"#;
    const TRADE: &str = r#"{"arg":{"channel":"trades","instId":"BTC-USDT"},"data":[{"instId":"BTC-USDT","tradeId":"13069379","px":"27003.9","sz":"0.120","side":"sell","ts":1697026383311}]}"#;
    const TICKERS: &str = r#"{"arg":{"channel":"tickers","instId":"BTC-USDT"},"data":[{"instId":"BTC-USDT","last":"27003.9","askPx":"27004.0","bidPx":"27003.8","open24h":"26800.0","high24h":"27100.0","low24h":"26700.0","vol24h":"12345.6","ts":1697026383400}]}"#;

    fn adapter() -> OkxAdapter {
        OkxAdapter::new()
    }

    // [CHECK 25] OKX adapter parses supported book events with sequence
    // continuity metadata intact.
    #[test]
    fn parses_books5_books_snapshot_and_update() {
        let events = adapter().parse_message(BOOKS5).expect("books5");
        assert_eq!(events.len(), 1);
        assert!(events[0].is_anchor);
        assert_eq!(events[0].sequence, Some(159_772_457));
        assert_eq!(events[0].stream_kind, StreamKind::PartialBook);
        match &events[0].kind {
            MarketEventKind::BookSnapshot { bids, asks } => {
                assert_eq!(bids.len(), 2);
                assert_eq!(asks.len(), 2);
            }
            other => panic!("expected snapshot, got {other:?}"),
        }

        let events = adapter().parse_message(BOOKS_UPDATE).expect("update");
        assert!(!events[0].is_anchor);
        assert_eq!(events[0].sequence, Some(159_772_458));
        assert_eq!(events[0].prev_sequence, Some(159_772_457));
        assert!(matches!(events[0].kind, MarketEventKind::BookDelta { .. }));

        let events = adapter()
            .parse_message(BOOKS_SNAPSHOT)
            .expect("action snapshot");
        assert!(events[0].is_anchor);
        assert!(matches!(
            events[0].kind,
            MarketEventKind::BookSnapshot { .. }
        ));
    }

    #[test]
    fn parses_trades_and_tickers() {
        let events = adapter().parse_message(TRADE).expect("trade");
        match &events[0].kind {
            MarketEventKind::TradeTick {
                price,
                quantity,
                taker_side,
                trade_id,
            } => {
                assert_eq!(price.to_string(), "27003.9");
                assert_eq!(quantity.to_string(), "0.12");
                assert_eq!(*taker_side, OrderSide::Sell);
                assert_eq!(trade_id, "13069379");
            }
            other => panic!("expected trade, got {other:?}"),
        }

        let events = adapter().parse_message(TICKERS).expect("tickers");
        match &events[0].kind {
            MarketEventKind::Ticker {
                last_price,
                bid_price,
                ask_price,
                high_24h,
                low_24h,
                volume_24h,
            } => {
                assert_eq!(
                    last_price.as_ref().map(|p| p.to_string()),
                    Some("27003.9".into())
                );
                assert_eq!(
                    bid_price.as_ref().map(|p| p.to_string()),
                    Some("27003.8".into())
                );
                assert_eq!(
                    ask_price.as_ref().map(|p| p.to_string()),
                    Some("27004.0".into())
                );
                assert_eq!(
                    high_24h.as_ref().map(|p| p.to_string()),
                    Some("27100.0".into())
                );
                assert_eq!(
                    low_24h.as_ref().map(|p| p.to_string()),
                    Some("26700.0".into())
                );
                assert_eq!(
                    volume_24h.as_ref().map(|p| p.to_string()),
                    Some("12345.6".into())
                );
            }
            other => panic!("expected ticker, got {other:?}"),
        }
    }

    // [CHECK 26] unsupported channels fail explicitly.
    #[test]
    fn unsupported_channel_fails_explicitly() {
        let option_frame = r#"{"arg":{"channel":"opt-summary","instId":"BTC-USD"},"data":[]}"#;
        let err = adapter()
            .parse_message(option_frame)
            .expect_err("unsupported");
        assert!(matches!(err, GatewayError::UnsupportedCapability(_)));
    }

    // Heartbeat is the literal ping/pong text protocol.
    #[test]
    fn literal_ping_pong_heartbeat() {
        assert_eq!(adapter().heartbeat_frame(), Some("ping".to_string()));
        assert!(adapter().is_heartbeat_reply("pong"));
        assert!(adapter().parse_message("pong").expect("pong").is_empty());
        assert!(!adapter().is_heartbeat_reply(r#"{"arg":{}}"#));
    }

    // Subscribe error events are provider failures, not silently ignored.
    #[test]
    fn subscribe_error_is_provider_failure() {
        let err_frame = r#"{"event":"error","code":"60013","msg":"Invalid Subscribe request"}"#;
        let err = adapter().parse_message(err_frame).expect_err("error event");
        assert!(matches!(err, GatewayError::ProviderFailure(_)));
        let ack =
            r#"{"event":"subscribe","arg":{"channel":"trades","instId":"BTC-USDT"},"connId":"1"}"#;
        assert!(adapter().parse_message(ack).expect("ack").is_empty());
        assert!(adapter().is_control_frame(ack));
    }

    #[test]
    fn subscription_frames_cover_required_channels() {
        let frames = adapter().subscribe_frames(&[Symbol::new("BTC-USDT").expect("s")]);
        assert_eq!(frames.len(), 1);
        for channel in ["\"books5\"", "\"books\"", "\"trades\"", "\"tickers\""] {
            assert!(frames[0].contains(channel));
        }
        assert!(frames[0].contains("BTC-USDT"));
        assert_eq!(adapter().venue(), Venue::Okx);
        assert!(adapter().supports(Capability::BookDepthDiff));
        assert_eq!(
            adapter().recovery_strategy(),
            RecoveryStrategy::ResubscribeYieldsSnapshot
        );
    }
}
