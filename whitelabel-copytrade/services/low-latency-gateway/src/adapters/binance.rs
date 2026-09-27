//! Binance spot public market-data adapter (combined-stream format).
//!
//! Implements the real wire behavior of `wss://stream.binance.com:9443`:
//! - combined stream envelope `{"stream": "<name>", "data": {...}}`;
//! - `<symbol>@trade` (aggressor side via maker flag `m`);
//! - `<symbol>@bookTicker` (best bid/ask with update id `u`);
//! - `<symbol>@depth@...` diff updates (`U`..`u` update-id ranges);
//! - `<symbol>@depth5@100ms` partial book (full top-N snapshots, anchored
//!   by `lastUpdateId`);
//! - `<symbol>@ticker` 24h statistics;
//! - `{"method":"SUBSCRIBE"/"UNSUBSCRIBE","params":[...],"id":n}` frames;
//! - protocol-level ping/pong handled by the WebSocket library (no
//!   application-level heartbeat frame).
//!
//! No other channel is parsed: unknown event types fail with an explicit
//! unsupported-capability error instead of being guessed into events.

use serde_json::Value;

use crate::adapters::exchange_ws::{
    parse_json, parse_level_matrix, AdapterEvent, Capability, MarketDataAdapter, RecoveryStrategy,
};
use crate::error::GatewayError;
use crate::types::{Fixed, MarketEventKind, OrderSide, Sequence, StreamKind, Symbol, Venue};

pub const BINANCE_WS_BASE: &str = "wss://stream.binance.com:9443/stream";

#[derive(Default)]
pub struct BinanceAdapter;

impl BinanceAdapter {
    pub fn new() -> BinanceAdapter {
        BinanceAdapter
    }

    /// Stream-name parser: `btcusdt@trade` -> (BTCUSDT, trade).
    fn split_stream(stream: &str) -> Result<(Symbol, StreamKind), GatewayError> {
        let mut parts = stream.splitn(2, '@');
        let raw_symbol = parts.next().ok_or_else(|| {
            GatewayError::MalformedData(format!("binance: stream without symbol: {stream}"))
        })?;
        let suffix = parts.next().ok_or_else(|| {
            GatewayError::MalformedData(format!("binance: stream without suffix: {stream}"))
        })?;
        let symbol = Symbol::new(&raw_symbol.to_ascii_uppercase())?;
        let kind = if suffix == "trade" {
            StreamKind::Trades
        } else if suffix == "bookTicker" {
            StreamKind::BookTicker
        } else if suffix == "depth" || suffix.starts_with("depth@") {
            // diff depth: depth@100ms / depth@100ms@500ms
            StreamKind::BookDepth
        } else if suffix.starts_with("depth") {
            // partial book depth: depth5 / depth10 / depth20 (+@100ms)
            StreamKind::PartialBook
        } else if suffix == "ticker" {
            StreamKind::Ticker
        } else {
            return Err(GatewayError::UnsupportedCapability(format!(
                "binance stream '{stream}' is not subscribed by this gateway"
            )));
        };
        Ok((symbol, kind))
    }

    fn parse_trade(data: &Value, symbol: Symbol) -> Result<AdapterEvent, GatewayError> {
        let price = Fixed::parse(str_field(data, "p")?)?;
        let quantity = Fixed::parse(str_field(data, "q")?)?;
        // m == true: buyer is the maker -> the taker side is Sell.
        let taker_side = if data.get("m").and_then(Value::as_bool).ok_or_else(|| {
            GatewayError::MalformedData("binance: trade missing maker flag m".into())
        })? {
            OrderSide::Sell
        } else {
            OrderSide::Buy
        };
        let trade_id = data
            .get("t")
            .and_then(Value::as_i64)
            .map(|id| id.to_string())
            .ok_or_else(|| GatewayError::MalformedData("binance: trade missing id t".into()))?;
        Ok(AdapterEvent {
            symbol,
            stream_kind: StreamKind::Trades,
            sequence: data.get("t").and_then(Value::as_u64),
            prev_sequence: None,
            provider_ms: data.get("T").and_then(Value::as_i64),
            kind: MarketEventKind::TradeTick {
                price,
                quantity,
                taker_side,
                trade_id,
            },
            is_anchor: false,
        })
    }

    fn parse_book_ticker(data: &Value, symbol: Symbol) -> Result<AdapterEvent, GatewayError> {
        let kind = MarketEventKind::BookTicker {
            bid_price: Fixed::parse(str_field(data, "b")?)?,
            bid_quantity: Fixed::parse(str_field(data, "B")?)?,
            ask_price: Fixed::parse(str_field(data, "a")?)?,
            ask_quantity: Fixed::parse(str_field(data, "A")?)?,
        };
        Ok(AdapterEvent {
            symbol,
            stream_kind: StreamKind::BookTicker,
            sequence: data.get("u").and_then(Value::as_u64),
            prev_sequence: None,
            provider_ms: data
                .get("E")
                .and_then(Value::as_i64)
                .or_else(|| data.get("T").and_then(Value::as_i64)),
            kind,
            is_anchor: false,
        })
    }

    fn parse_depth_diff(data: &Value, symbol: Symbol) -> Result<AdapterEvent, GatewayError> {
        let bids = parse_level_matrix(
            data.get("b").and_then(Value::as_array).ok_or_else(|| {
                GatewayError::MalformedData("binance: depthUpdate missing bids".into())
            })?,
            "binance",
        )?;
        let asks = parse_level_matrix(
            data.get("a").and_then(Value::as_array).ok_or_else(|| {
                GatewayError::MalformedData("binance: depthUpdate missing asks".into())
            })?,
            "binance",
        )?;
        // Venue rule: the update covers [U, u]; continuity is keyed on u,
        // with U the declared predecessor end. A gap in the id range is the
        // pipeline's signal to re-snapshot.
        let first: Sequence = data
            .get("U")
            .and_then(Value::as_u64)
            .ok_or_else(|| GatewayError::MalformedData("binance: depthUpdate missing U".into()))?;
        let last: Sequence = data
            .get("u")
            .and_then(Value::as_u64)
            .ok_or_else(|| GatewayError::MalformedData("binance: depthUpdate missing u".into()))?;
        if last < first {
            return Err(GatewayError::MalformedData(format!(
                "binance: depthUpdate range inverted U={first} u={last}"
            )));
        }
        Ok(AdapterEvent {
            symbol,
            stream_kind: StreamKind::BookDepth,
            sequence: Some(last),
            prev_sequence: (first > 0).then(|| first - 1),
            provider_ms: data.get("E").and_then(Value::as_i64),
            kind: MarketEventKind::BookDelta {
                bids,
                asks,
                prev_sequence: (first > 0).then(|| first - 1),
            },
            is_anchor: false,
        })
    }

    fn parse_partial_depth(data: &Value, symbol: Symbol) -> Result<AdapterEvent, GatewayError> {
        let bids = parse_level_matrix(
            data.get("bids").and_then(Value::as_array).ok_or_else(|| {
                GatewayError::MalformedData("binance: partial depth missing bids".into())
            })?,
            "binance",
        )?;
        let asks = parse_level_matrix(
            data.get("asks").and_then(Value::as_array).ok_or_else(|| {
                GatewayError::MalformedData("binance: partial depth missing asks".into())
            })?,
            "binance",
        )?;
        let last_update_id: Sequence = data
            .get("lastUpdateId")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                GatewayError::MalformedData("binance: partial depth missing lastUpdateId".into())
            })?;
        Ok(AdapterEvent {
            symbol,
            stream_kind: StreamKind::PartialBook,
            sequence: Some(last_update_id),
            prev_sequence: None,
            provider_ms: None,
            kind: MarketEventKind::BookSnapshot { bids, asks },
            // A partial book depth frame IS a full top-N snapshot: it
            // re-anchors continuity by definition.
            is_anchor: true,
        })
    }

    fn parse_ticker(data: &Value, symbol: Symbol) -> Result<AdapterEvent, GatewayError> {
        let kind = MarketEventKind::Ticker {
            last_price: opt_str_fixed(data, "c")?,
            bid_price: opt_str_fixed(data, "b")?,
            ask_price: opt_str_fixed(data, "a")?,
            high_24h: opt_str_fixed(data, "h")?,
            low_24h: opt_str_fixed(data, "l")?,
            volume_24h: opt_str_fixed(data, "v")?,
        };
        Ok(AdapterEvent {
            symbol,
            stream_kind: StreamKind::Ticker,
            sequence: None,
            prev_sequence: None,
            provider_ms: data.get("E").and_then(Value::as_i64),
            kind,
            is_anchor: false,
        })
    }
}

fn str_field<'a>(data: &'a Value, key: &str) -> Result<&'a str, GatewayError> {
    data.get(key).and_then(Value::as_str).ok_or_else(|| {
        GatewayError::MalformedData(format!("binance: field '{key}' missing or not a string"))
    })
}

fn opt_str_fixed(data: &Value, key: &str) -> Result<Option<Fixed>, GatewayError> {
    match data.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(Fixed::parse(s)?)),
        Some(_) => Err(GatewayError::MalformedData(format!(
            "binance: field '{key}' expected decimal string"
        ))),
    }
}

fn stream_and_data(frame: &Value) -> Result<(&str, &Value), GatewayError> {
    let stream = frame
        .get("stream")
        .and_then(Value::as_str)
        .ok_or_else(|| GatewayError::MalformedData("binance: frame missing stream name".into()))?;
    let data = frame.get("data").ok_or_else(|| {
        GatewayError::MalformedData("binance: combined frame missing data".into())
    })?;
    Ok((stream, data))
}

impl MarketDataAdapter for BinanceAdapter {
    fn venue(&self) -> Venue {
        Venue::Binance
    }

    fn ws_base_url(&self) -> &'static str {
        BINANCE_WS_BASE
    }

    fn heartbeat_interval(&self) -> std::time::Duration {
        // Binance sends protocol-level pings every ~3 minutes; we probe the
        // socket liveness on a faster cadence via receive timeouts.
        std::time::Duration::from_secs(60)
    }

    fn subscribe_frames(&self, symbols: &[Symbol]) -> Vec<String> {
        let mut params: Vec<String> = Vec::new();
        for symbol in symbols {
            let s = symbol.as_str().to_ascii_lowercase();
            params.push(format!("{s}@trade"));
            params.push(format!("{s}@bookTicker"));
            params.push(format!("{s}@depth5@100ms"));
            params.push(format!("{s}@ticker"));
        }
        vec![serde_json::json!({
            "method": "SUBSCRIBE",
            "params": params,
            "id": 1
        })
        .to_string()]
    }

    fn unsubscribe_frames(&self, symbols: &[Symbol]) -> Vec<String> {
        let mut params: Vec<String> = Vec::new();
        for symbol in symbols {
            let s = symbol.as_str().to_ascii_lowercase();
            params.push(format!("{s}@trade"));
            params.push(format!("{s}@bookTicker"));
            params.push(format!("{s}@depth5@100ms"));
            params.push(format!("{s}@ticker"));
        }
        vec![serde_json::json!({
            "method": "UNSUBSCRIBE",
            "params": params,
            "id": 2
        })
        .to_string()]
    }

    fn heartbeat_frame(&self) -> Option<String> {
        None
    }

    fn is_heartbeat_reply(&self, _raw: &str) -> bool {
        false
    }

    fn is_control_frame(&self, raw: &str) -> bool {
        // Subscription/ack frames: {"result":null,"id":1}
        parse_json(raw)
            .ok()
            .map(|v| {
                v.get("id").is_some() && v.get("result").is_some() && v.get("stream").is_none()
            })
            .unwrap_or(false)
    }

    fn parse_message(&self, raw: &str) -> Result<Vec<AdapterEvent>, GatewayError> {
        let frame = parse_json(raw)?;
        if self.is_control_frame(raw) {
            return Ok(Vec::new());
        }
        let (stream, data) = stream_and_data(&frame)?;
        let (symbol, kind) = BinanceAdapter::split_stream(stream)?;
        if !matches!(data, Value::Object(_)) {
            return Err(GatewayError::MalformedData(
                "binance: data is not an object".into(),
            ));
        }
        let event = match kind {
            StreamKind::Trades => BinanceAdapter::parse_trade(data, symbol)?,
            StreamKind::BookTicker => BinanceAdapter::parse_book_ticker(data, symbol)?,
            StreamKind::BookDepth => BinanceAdapter::parse_depth_diff(data, symbol)?,
            StreamKind::PartialBook => BinanceAdapter::parse_partial_depth(data, symbol)?,
            StreamKind::Ticker => BinanceAdapter::parse_ticker(data, symbol)?,
        };
        Ok(vec![event])
    }

    fn supports(&self, capability: Capability) -> bool {
        matches!(
            capability,
            Capability::Trades
                | Capability::BookTicker
                | Capability::PartialBook
                | Capability::Ticker
        )
    }

    fn recovery_strategy(&self) -> RecoveryStrategy {
        // @depth5@100ms delivers a complete top-5 snapshot per frame, so a
        // reconnect re-anchors continuity without a separate REST fetch.
        RecoveryStrategy::ResubscribeYieldsSnapshot
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MarketEventKind;

    const TRADE: &str = r#"{"stream":"btcusdt@trade","data":{"e":"trade","E":1672515782136,"s":"BTCUSDT","t":912345678,"p":"61234.55","q":"0.012","T":1672515782100,"m":true,"M":true}}"#;
    const BOOK_TICKER: &str = r#"{"stream":"ethusdt@bookTicker","data":{"u":400900217,"s":"ETHUSDT","b":"2281.15","B":"31.21000000","a":"2281.30","A":"40.66000000"}}"#;
    const DEPTH5: &str = r#"{"stream":"btcusdt@depth5@100ms","data":{"lastUpdateId":160318932,"bids":[["61234.00","0.500"],["61233.50","1.250"]],"asks":[["61234.50","0.750"],["61235.00","2.000"]]}}"#;
    const DEPTH_DIFF: &str = r#"{"stream":"btcusdt@depth@100ms","data":{"e":"depthUpdate","E":1672515782311,"s":"BTCUSDT","U":160318930,"u":160318933,"b":[["61234.00","0"],["61233.00","0.100"]],"a":[["61234.50","1.500"]]}}"#;
    const TICKER: &str = r#"{"stream":"btcusdt@ticker","data":{"e":"24hrTicker","E":1672515782400,"s":"BTCUSDT","c":"61240.10","b":"61234.00","B":"0.5","a":"61234.50","A":"1.0","h":"61900.00","l":"60100.00","v":"1234.5"}}"#;

    fn adapter() -> BinanceAdapter {
        BinanceAdapter::new()
    }

    // [CHECK 23] Binance adapter parses a supported trade event with all
    // venue metadata preserved.
    #[test]
    fn parses_trade_event() {
        let events = adapter().parse_message(TRADE).expect("trade parses");
        assert_eq!(events.len(), 1);
        let ev = &events[0];
        assert_eq!(ev.symbol.as_str(), "BTCUSDT");
        assert_eq!(ev.stream_kind, StreamKind::Trades);
        assert_eq!(ev.provider_ms, Some(1_672_515_782_100)); // T (trade time)
        match &ev.kind {
            MarketEventKind::TradeTick {
                price,
                quantity,
                taker_side,
                trade_id,
            } => {
                assert_eq!(price.to_string(), "61234.55");
                assert_eq!(quantity.to_string(), "0.012");
                // m=true: buyer is maker -> taker sold.
                assert_eq!(*taker_side, OrderSide::Sell);
                assert_eq!(trade_id, "912345678");
            }
            other => panic!("expected trade, got {other:?}"),
        }
    }

    #[test]
    fn parses_book_ticker_and_ticker() {
        let events = adapter().parse_message(BOOK_TICKER).expect("bookTicker");
        match &events[0].kind {
            MarketEventKind::BookTicker {
                bid_price,
                ask_price,
                bid_quantity,
                ask_quantity,
            } => {
                assert_eq!(bid_price.to_string(), "2281.15");
                assert_eq!(ask_price.to_string(), "2281.3");
                assert_eq!(bid_quantity.to_string(), "31.21");
                assert_eq!(ask_quantity.to_string(), "40.66");
            }
            other => panic!("expected bookTicker, got {other:?}"),
        }
        assert_eq!(events[0].sequence, Some(400_900_217));

        let events = adapter().parse_message(TICKER).expect("ticker");
        match &events[0].kind {
            MarketEventKind::Ticker {
                last_price,
                high_24h,
                low_24h,
                ..
            } => {
                assert_eq!(
                    last_price.as_ref().map(|p| p.to_string()),
                    Some("61240.1".into())
                );
                assert_eq!(
                    high_24h.as_ref().map(|p| p.to_string()),
                    Some("61900.0".into())
                );
                assert_eq!(
                    low_24h.as_ref().map(|p| p.to_string()),
                    Some("60100.0".into())
                );
            }
            other => panic!("expected ticker, got {other:?}"),
        }
    }

    #[test]
    fn parses_partial_depth_as_anchored_snapshot_and_diff_as_delta() {
        let events = adapter().parse_message(DEPTH5).expect("depth5");
        assert!(events[0].is_anchor);
        assert_eq!(events[0].sequence, Some(160_318_932));
        match &events[0].kind {
            MarketEventKind::BookSnapshot { bids, asks } => {
                assert_eq!(bids.len(), 2);
                assert_eq!(asks.len(), 2);
                let _ = parse_level_matrix(&[], "binance").expect("empty matrix ok");
            }
            other => panic!("expected snapshot, got {other:?}"),
        }

        let events = adapter().parse_message(DEPTH_DIFF).expect("depth diff");
        assert!(!events[0].is_anchor);
        assert_eq!(events[0].sequence, Some(160_318_933));
        assert_eq!(events[0].prev_sequence, Some(160_318_929));
        match &events[0].kind {
            MarketEventKind::BookDelta {
                bids,
                asks,
                prev_sequence,
            } => {
                assert_eq!(bids.len(), 2);
                assert_eq!(asks.len(), 1);
                assert_eq!(*prev_sequence, Some(160_318_929));
            }
            other => panic!("expected delta, got {other:?}"),
        }
    }

    // [CHECK 26] unsupported and malformed frames fail explicitly with no
    // fabricated events.
    #[test]
    fn unsupported_and_malformed_frames_fail_explicitly() {
        let kline = r#"{"stream":"btcusdt@kline_1m","data":{"e":"kline"}}"#;
        let err = adapter()
            .parse_message(kline)
            .expect_err("kline unsupported");
        assert!(matches!(err, GatewayError::UnsupportedCapability(_)));

        let garbage = "not json at all";
        assert!(matches!(
            adapter().parse_message(garbage),
            Err(GatewayError::MalformedData(_))
        ));

        let missing_field = r#"{"stream":"btcusdt@trade","data":{"e":"trade","s":"BTCUSDT"}}"#;
        assert!(matches!(
            adapter().parse_message(missing_field),
            Err(GatewayError::MalformedData(_))
        ));
        // A failure produces ZERO events: no fabricated fallback.
        assert!(adapter()
            .parse_message(missing_field)
            .unwrap_or_default()
            .is_empty());
    }

    #[test]
    fn control_frames_produce_no_events_and_subscriptions_are_correct() {
        let ack = r#"{"result":null,"id":1}"#;
        assert!(adapter().is_control_frame(ack));
        assert!(adapter().parse_message(ack).expect("control").is_empty());

        let frames = adapter().subscribe_frames(&[Symbol::new("BTCUSDT").expect("s")]);
        assert_eq!(frames.len(), 1);
        assert!(frames[0].contains("\"method\":\"SUBSCRIBE\""));
        assert!(frames[0].contains("btcusdt@trade"));
        assert!(frames[0].contains("btcusdt@bookTicker"));
        assert!(frames[0].contains("btcusdt@depth5@100ms"));
        assert!(frames[0].contains("btcusdt@ticker"));

        let unsubs = adapter().unsubscribe_frames(&[Symbol::new("BTCUSDT").expect("s")]);
        assert!(unsubs[0].contains("\"method\":\"UNSUBSCRIBE\""));
        assert_eq!(adapter().heartbeat_frame(), None);
        assert!(!adapter().is_heartbeat_reply("anything"));
        assert_eq!(adapter().venue(), Venue::Binance);
        assert!(!adapter().supports(Capability::BookDepthDiff));
        assert_eq!(
            adapter().recovery_strategy(),
            RecoveryStrategy::ResubscribeYieldsSnapshot
        );
    }
}
