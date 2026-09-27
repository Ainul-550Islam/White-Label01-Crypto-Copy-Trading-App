//! low-latency-gateway library surface.
//!
//! The crate is a real market-data + execution-transport plane:
//! - adapters: per-venue WebSocket protocols (Binance/Bybit/OKX);
//! - pipeline: bounded ingest, sequence integrity, normalization, books,
//!   tapes, backpressure, routing;
//! - execution: signed-intent admission, preparation, engine transport;
//! - observability & lifecycle: metrics, tracing, health, shutdown.
//!
//! Authority boundary: this crate NEVER grants risk/compliance approvals,
//! NEVER fabricates execution outcomes (FILL/position/PnL truth lives in
//! the trading engine), and NEVER exposes a customer-facing endpoint.

pub mod adapters {
    pub mod binance;
    pub mod bybit;
    pub mod exchange_ws;
    pub mod okx;
}
pub mod backpressure;
pub mod config;
pub mod error;
pub mod execution_prepare;
pub mod execution_transport;
pub mod feed_session;
pub mod health;
pub mod market_data;
pub mod metrics;
pub mod order_book;
pub mod parser;
pub mod ring_buffer;
pub mod sequence_guard;
pub mod session_manager;
pub mod shutdown;
pub mod time;
pub mod tracing;
pub mod trade_tape;
pub mod transport_protocol;
pub mod types;
pub mod venue_router;

// The integration client lives outside src/ by product layout; it is
// compiled INTO this crate so `crate::` paths resolve naturally.
#[path = "../integration/execution_engine.rs"]
pub mod execution_engine;
