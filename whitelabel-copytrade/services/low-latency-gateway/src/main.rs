//! low-latency-gateway binary: wires the full service together.
//!
//! Composition:
//! - two internal listeners: /healthz /readyz /metrics /schema (health bind)
//!   and POST /internal/v1/transport/intents (transport bind);
//! - one real WebSocket feed session per configured venue, feeding a bounded
//!   inbound channel;
//! - one pipeline task normalizing frames through sequence guards, books and
//!   tapes, routing events through the backpressure-aware router;
//! - a recovery task wiring pipeline sequence gaps into feed-session
//!   resubscription;
//! - a supervision loop ticking liveness, gauges and recovery supervision;
//! - the execution-engine HTTP client, schema-negotiated at boot.
//!
//! Shutdown follows the deterministic phase sequence from
//! [`low_latency_gateway::shutdown`].

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use low_latency_gateway::adapters::exchange_ws::MarketDataAdapter;
use low_latency_gateway::adapters::{
    binance::BinanceAdapter, bybit::BybitAdapter, okx::OkxAdapter,
};
use low_latency_gateway::config::GatewayConfig;
use low_latency_gateway::error::GatewayError;
use low_latency_gateway::execution_engine::ExecutionEngineClient;
use low_latency_gateway::execution_prepare::ExecutionPreparer;
use low_latency_gateway::execution_transport::ExecutionTransportService;
use low_latency_gateway::feed_session::spawn_feed_session;
use low_latency_gateway::health::{route_internal_get, HealthService};
use low_latency_gateway::market_data::MarketDataPipeline;
use low_latency_gateway::metrics::MetricsRegistry;
use low_latency_gateway::session_manager::SessionManager;
use low_latency_gateway::shutdown::{ShutdownCoordinator, ShutdownPhase};
use low_latency_gateway::time::utc_now_ms;
use low_latency_gateway::tracing::init_tracing;
use low_latency_gateway::transport_protocol::TRANSPORT_SCHEMA_VERSION;
use low_latency_gateway::types::{RawFeedFrame, RecoverySignal, Venue};
use low_latency_gateway::venue_router::{RouteConsumer, VenueRouter};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const ENGINE_TIMEOUT: Duration = Duration::from_secs(5);
const ENGINE_MAX_ATTEMPTS: u32 = 3;

fn main() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime builds");
    let code = runtime.block_on(run());
    runtime.shutdown_timeout(Duration::from_secs(2));
    std::process::exit(code);
}

async fn run() -> i32 {
    // rustls needs exactly one process-level CryptoProvider when multiple
    // provider features are in the tree; install ring deterministically
    // BEFORE any venue WSS or HTTPS connection exists.
    let _ = rustls::crypto::ring::default_provider().install_default();
    init_tracing("info");
    tracing::info!(
        schema = TRANSPORT_SCHEMA_VERSION,
        "low-latency-gateway starting"
    );

    // ---- configuration (strict; no defaults that mask mistakes) ----------
    let config = match GatewayConfig::load_from_env() {
        Ok(config) => config,
        Err(e) => {
            tracing::error!(error = %e, "configuration invalid; refusing to start");
            return 2;
        }
    };
    let environment = config.environment.as_str().to_string();
    let venues: Vec<Venue> = config.venues.iter().map(|vc| vc.venue).collect();
    let policy = config.backpressure;
    tracing::info!(venues = ?venues, environment, "configuration loaded");

    // ---- shared state ------------------------------------------------------
    let metrics = Arc::new(MetricsRegistry::new());
    let sessions = Arc::new(SessionManager::new(policy));
    let health = Arc::new(HealthService::new(
        Arc::clone(&sessions),
        venues.clone(),
        policy,
        Arc::clone(&metrics),
    ));
    health.mark_config_loaded();
    let shutdown = ShutdownCoordinator::new();

    // Signing key comes from secret infrastructure only; never logged.
    // Configuration load already validated its length, so a loaded config
    // implies a usable key.
    let intent_key: Vec<u8> = config.intent_hmac_key().to_vec();
    health.mark_signing_key_present();

    // ---- market-data plane -------------------------------------------------
    let (recovery_tx, mut recovery_rx) = mpsc::channel::<RecoverySignal>(256);
    let pipeline = Arc::new(MarketDataPipeline::new(
        &venues,
        config.ring_capacity,
        recovery_tx,
        Arc::clone(&metrics),
    ));

    // Inbound bounded channel: sessions shed when full (market data is
    // non-critical, counted shedding).
    let (inbound_tx, mut inbound_rx) = mpsc::channel::<RawFeedFrame>(config.ring_capacity);

    // Router with one internal observation consumer (bounded).
    let mut router = VenueRouter::new(policy);
    let (obs_tx, mut obs_rx) =
        mpsc::channel::<low_latency_gateway::types::MarketEvent>(config.ring_capacity);
    router.add_consumer(RouteConsumer {
        name: "internal-observation".to_string(),
        venues: venues.clone(),
        symbols: None,
        tx: obs_tx,
        is_critical: false,
    });
    let router = Arc::new(router);
    {
        let metrics = Arc::clone(&metrics);
        let pipeline = Arc::clone(&pipeline);
        tokio::spawn(async move {
            // Observation consumer: keeps the pipeline's lag gauge honest.
            let mut seen: u64 = 0;
            while obs_rx.recv().await.is_some() {
                seen = seen.saturating_add(1);
                if seen % 1024 == 0 {
                    metrics.set_consumer_lag(pipeline.inbound_depth());
                }
            }
        });
    }

    // Feed sessions: one real WebSocket per venue + per-venue control.
    let mut adapters: HashMap<Venue, Arc<dyn MarketDataAdapter>> = HashMap::new();
    let mut controls: Vec<mpsc::Sender<RecoverySignal>> = Vec::new();
    for venue in &venues {
        let adapter: Arc<dyn MarketDataAdapter> = match venue {
            Venue::Binance => Arc::new(BinanceAdapter::new()),
            Venue::Bybit => Arc::new(BybitAdapter::new()),
            Venue::Okx => Arc::new(OkxAdapter::new()),
        };
        let venue_config = match config.venues.iter().find(|vc| vc.venue == *venue) {
            Some(vc) => vc,
            None => {
                tracing::error!(venue = %venue, "venue configuration missing; refusing to start");
                return 2;
            }
        };
        let symbols = venue_config.symbols.clone();
        if symbols.is_empty() {
            tracing::error!(venue = %venue, "no symbols configured; refusing to start");
            return 2;
        }
        let ws_base_override = venue_config
            .ws_base_override
            .as_ref()
            .map(|base| base.as_str().to_string());
        sessions.register(*venue, symbols.clone());
        let (control_tx, control_rx) = mpsc::channel::<RecoverySignal>(32);
        controls.push(control_tx);
        spawn_feed_session(
            Arc::clone(&adapter),
            symbols,
            ws_base_override,
            inbound_tx.clone(),
            control_rx,
            Arc::clone(&metrics),
            Arc::clone(&sessions),
            shutdown.clone(),
            CONNECT_TIMEOUT,
        );
        adapters.insert(*venue, adapter);
    }
    drop(inbound_tx); // sessions own the remaining senders

    // Pipeline consumer: frames in, normalized events routed out.
    {
        let pipeline = Arc::clone(&pipeline);
        let router = Arc::clone(&router);
        tokio::spawn(async move {
            while let Some(frame) = inbound_rx.recv().await {
                let route = |event: &low_latency_gateway::types::MarketEvent| {
                    router
                        .route(event, pipeline.inbound_depth())
                        .map(|outcome| outcome.delivered.len())
                };
                if let Err(e) = pipeline.process_frame(&frame, &route) {
                    match &e {
                        GatewayError::BackpressureShed { .. }
                        | GatewayError::BackpressureRefused { .. } => {
                            // Counted shedding under pressure; sessions keep
                            // feeding so the newest data wins.
                        }
                        other => {
                            tracing::debug!(error = other.kind(), venue = %frame.venue, "frame not normalized");
                        }
                    }
                }
            }
        });
    }

    // Recovery wiring: pipeline sequence gaps -> session resubscription.
    {
        let sessions = Arc::clone(&sessions);
        let venues = venues.clone();
        tokio::spawn(async move {
            while let Some(signal) = recovery_rx.recv().await {
                sessions.mark_pending_resnapshot(signal.venue, true);
                if let Some(control) = controls.get(venue_index(&venues, signal.venue)) {
                    if control.send(signal).await.is_err() {
                        tracing::warn!("recovery control channel closed for venue");
                    }
                }
            }
        });
    }

    // ---- execution plane ---------------------------------------------------
    let preparer = ExecutionPreparer::new(Arc::clone(&sessions), venues.clone());
    let transport = Arc::new(ExecutionTransportService::new(
        preparer,
        config.intent_hmac_key_id.clone(),
        intent_key,
        config.intent_expiry_margin_ms,
        config.intent_replay_cache_capacity,
        policy,
        Arc::clone(&metrics),
    ));
    let engine = Arc::new(ExecutionEngineClient::new(
        config.execution_engine_base_url.clone(),
        ENGINE_TIMEOUT,
        ENGINE_MAX_ATTEMPTS,
        Duration::from_millis(100),
        Arc::clone(&metrics),
    ));

    // ---- internal listeners -------------------------------------------------
    let health_listener = match TcpListener::bind(&config.health_bind).await {
        Ok(listener) => listener,
        Err(e) => {
            tracing::error!(bind = %config.health_bind, error = %e, "health bind failed");
            return 2;
        }
    };
    let transport_listener = match TcpListener::bind(&config.transport_bind).await {
        Ok(listener) => listener,
        Err(e) => {
            tracing::error!(bind = %config.transport_bind, error = %e, "transport bind failed");
            return 2;
        }
    };
    tracing::info!(health = %config.health_bind, transport = %config.transport_bind, "internal listeners bound");

    // Health/observability endpoints.
    {
        let health = Arc::clone(&health);
        let environment = environment.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = health_listener.accept().await else {
                    break;
                };
                let health = Arc::clone(&health);
                let environment = environment.clone();
                tokio::spawn(async move {
                    serve_health_connection(&mut stream, &health, &environment).await;
                });
            }
        });
    }

    // Execution transport endpoint: admits only signed intent frames.
    let in_flight = transport.in_flight_depth_gauge();
    {
        let transport = Arc::clone(&transport);
        let engine = Arc::clone(&engine);
        let shutdown = shutdown.clone();
        let in_flight = Arc::clone(&in_flight);
        tokio::spawn(async move {
            let mut shutdown_rx = shutdown.subscribe();
            loop {
                let accepted = tokio::select! {
                    accepted = transport_listener.accept() => accepted,
                    _ = shutdown_rx.wait_for(|phase| phase.is_stopping()) => {
                        tracing::info!("transport listener draining: no new intents accepted");
                        break;
                    }
                };
                match accepted {
                    Ok((mut stream, _)) => {
                        let transport = Arc::clone(&transport);
                        let engine = Arc::clone(&engine);
                        let in_flight = Arc::clone(&in_flight);
                        tokio::spawn(async move {
                            in_flight.fetch_add(1, Ordering::Relaxed);
                            serve_transport_connection(&mut stream, &transport, &engine).await;
                            in_flight.fetch_sub(1, Ordering::Relaxed);
                        });
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "transport accept failed");
                    }
                }
            }
            // Let in-flight intents finish before the next phase.
            while in_flight.load(Ordering::Relaxed) > 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            tracing::info!("transport in-flight drained");
        });
    }

    // ---- boot-time engine schema negotiation -------------------------------
    match engine.negotiate_schema().await {
        Ok(_) => health.mark_engine_schema_negotiated(),
        Err(e) => {
            // Honest unavailability: process runs, readiness stays false.
            tracing::error!(error = e.kind(), "execution-engine schema negotiation failed; readiness will stay false until it succeeds");
        }
    }

    // ---- supervision loop ----------------------------------------------------
    {
        let health = Arc::clone(&health);
        let sessions = Arc::clone(&sessions);
        let pipeline = Arc::clone(&pipeline);
        let metrics = Arc::clone(&metrics);
        let inbound_capacity = config.ring_capacity as i64;
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tick.tick().await;
                health.record_supervision_tick();
                metrics.set_sessions_connected(sessions.connected_count() as i64);
                metrics.set_queue_depth(pipeline.inbound_depth().min(inbound_capacity));
                pipeline.set_consumer_lag(metrics.consumer_lag());
                let anchored = sessions.supervise_recovery(&pipeline);
                if anchored > 0 {
                    tracing::info!(anchored, "recovery supervision re-anchored venue depth");
                }
            }
        });
    }

    // ---- signals -------------------------------------------------------------
    {
        let shutdown = shutdown.clone();
        tokio::spawn(async move {
            let sigterm = async {
                let mut term =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("SIGTERM handler");
                term.recv().await;
            };
            tokio::select! {
                _ = tokio::signal::ctrl_c() => { "SIGINT" }
                _ = sigterm => { "SIGTERM" }
            };
            tracing::warn!("shutdown signal received; beginning deterministic drain");
            shutdown.begin("signal").await;
            shutdown.drain_feeds().await;
            shutdown.flush_and_exit().await;
        });
    }

    // ---- run until shutdown completes -----------------------------------------
    let mut phase_rx: watch::Receiver<ShutdownPhase> = shutdown.subscribe();
    loop {
        tokio::select! {
            _ = phase_rx.wait_for(|phase| *phase == ShutdownPhase::Exiting) => break,
            _ = tokio::time::sleep(config.shutdown_drain) => {
                // Safety valve: signals advanced the phases; if the watch
                // loop somehow lags, exit deterministically after the drain
                // budget.
                if shutdown.current().is_stopping() {
                    break;
                }
            }
        }
    }
    tracing::info!(
        intents_accepted = metrics
            .execution_intents_accepted_total
            .load(Ordering::Relaxed),
        intents_rejected = metrics
            .execution_intent_rejections_total
            .load(Ordering::Relaxed),
        reconnects = metrics.reconnect_total.load(Ordering::Relaxed),
        observed_at = utc_now_ms(),
        "low-latency-gateway stopped"
    );
    0
}

fn venue_index(venues: &[Venue], venue: Venue) -> usize {
    venues.iter().position(|v| *v == venue).unwrap_or(0)
}

/// Reads one HTTP request (small, one-shot) from an internal connection.
/// `body_prefix` carries the bytes that arrived in the SAME read as the
/// headers: small requests (the normal case for intents) arrive as a
/// single TCP segment, and dropping those bytes would deadlock the handler
/// waiting for a body that already came in.
#[derive(Debug)]
struct InternalRequest {
    method: String,
    path: String,
    content_length: usize,
    body_prefix: Vec<u8>,
}

async fn read_request(stream: &mut TcpStream) -> Result<InternalRequest, GatewayError> {
    let mut buffer: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    let header_end;
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err(GatewayError::Transport(
                "connection closed before request".into(),
            ));
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
        if buffer.len() > 64 * 1024 {
            return Err(GatewayError::Transport("request headers too large".into()));
        }
    }
    let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut content_length = 0usize;
    for line in lines {
        let mut pair = line.splitn(2, ':');
        if let Some(name) = pair.next() {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = pair
                    .next()
                    .and_then(|v| v.trim().parse().ok())
                    .ok_or_else(|| GatewayError::Transport("bad content-length".into()))?;
            }
        }
    }
    if content_length > 8 * 1024 * 1024 {
        return Err(GatewayError::Transport("request body too large".into()));
    }
    Ok(InternalRequest {
        method,
        path,
        content_length,
        body_prefix: buffer[header_end..].to_vec(),
    })
}

async fn write_response(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = if status == 200 {
        "OK"
    } else if status == 404 {
        "Not Found"
    } else {
        "Rejected"
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

async fn serve_health_connection(
    stream: &mut TcpStream,
    health: &HealthService,
    environment: &str,
) {
    let _ = stream.set_nodelay(true);
    let Ok(request) = read_request(stream).await else {
        return;
    };
    if request.method != "GET" {
        let (code, body) = (404, "{\"error\":\"not found\"}".to_string());
        write_response(stream, code, &body).await;
        return;
    }
    match route_internal_get(&request.path, health, health.metrics_ref(), environment) {
        Ok((code, body)) => write_response(stream, code, &body).await,
        Err(_) => write_response(stream, 404, "{\"error\":\"unknown path\"}").await,
    }
}

async fn serve_transport_connection(
    stream: &mut TcpStream,
    transport: &ExecutionTransportService,
    engine: &ExecutionEngineClient,
) {
    let _ = stream.set_nodelay(true);
    let request = match read_request(stream).await {
        Ok(parts) => parts,
        Err(_) => return,
    };
    if request.method != "POST" || request.path != "/internal/v1/transport/intents" {
        write_response(stream, 404, "{\"error\":\"not found\"}").await;
        return;
    }
    let mut body = request.body_prefix;
    if body.len() < request.content_length {
        let mut remainder = vec![0u8; request.content_length - body.len()];
        if stream.read_exact(&mut remainder).await.is_err() {
            return;
        }
        body.extend_from_slice(&remainder);
    }
    let ack = transport.admit_frame(engine, &body).await;
    let payload = serde_json::to_string(&ack).unwrap_or_else(|_| {
        // Serialization of a plain struct cannot fail in practice; still, a
        // failure must NEVER look like acceptance.
        serde_json::json!({
            "intent_id": ack.intent_id,
            "correlation_id": ack.correlation_id,
            "status": "transport_failure",
            "observed_at_ms": utc_now_ms(),
            "detail": "ack serialization failed"
        })
        .to_string()
    });
    let code = if matches!(
        ack.status,
        low_latency_gateway::types::AckStatus::AcceptedForTransport
    ) {
        200
    } else {
        422
    };
    write_response(stream, code, &payload).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use low_latency_gateway::backpressure::BackpressurePolicy;
    use low_latency_gateway::execution_prepare::ExecutionPreparer;
    use low_latency_gateway::metrics::MetricsRegistry;
    use low_latency_gateway::session_manager::SessionManager;
    use tokio::net::TcpListener;

    fn transport_service() -> ExecutionTransportService {
        let sessions = Arc::new(SessionManager::new(BackpressurePolicy::default()));
        ExecutionTransportService::new(
            ExecutionPreparer::new(sessions, Vec::new()),
            "test-key-id".to_string(),
            b"test-key-material-0123456789".to_vec(),
            0,
            64,
            BackpressurePolicy::default(),
            Arc::new(MetricsRegistry::new()),
        )
    }

    // Regression: headers and body of a small intent arrive in ONE TCP
    // segment. A reader that discards the pre-read body bytes deadlocks
    // the transport handler waiting for a body that already arrived (the
    // client sees a silent hang instead of an ack). This test pins the
    // single-segment path end to end through the real handler.
    #[tokio::test]
    async fn single_segment_post_is_served_without_deadlock() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let service = transport_service();
        let engine = ExecutionEngineClient::new(
            url::Url::parse("http://127.0.0.1:1").expect("url"),
            Duration::from_millis(100),
            1,
            Duration::from_millis(1),
            Arc::new(MetricsRegistry::new()),
        );
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            serve_transport_connection(&mut stream, &service, &engine).await;
        });
        let mut client = TcpStream::connect(addr).await.expect("connect");
        // Deliberately ONE write: headers + body in a single segment.
        let request = "POST /internal/v1/transport/intents HTTP/1.1\r\n\
                       Host: test\r\n\
                       Content-Type: application/json\r\n\
                       Content-Length: 7\r\n\
                       Connection: close\r\n\
                       \r\n\
                       {\"x\":1}";
        client.write_all(request.as_bytes()).await.expect("write");
        let mut response = Vec::new();
        let read =
            tokio::time::timeout(Duration::from_secs(5), client.read_to_end(&mut response)).await;
        assert!(
            read.is_ok(),
            "transport handler deadlocked on a single-segment request"
        );
        let text = String::from_utf8_lossy(&response).to_string();
        assert!(
            text.starts_with("HTTP/1.1 422"),
            "naked payload must be rejected, got: {text}"
        );
        assert!(text.contains("rejected_malformed"), "got: {text}");
        let _ = server.await;
    }

    // A GET to the transport plane never reaches intent admission: paths
    // other than the intent route are a plain 404, even with a body.
    #[tokio::test]
    async fn non_intent_paths_are_404_before_body_handling() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let service = transport_service();
        let engine = ExecutionEngineClient::new(
            url::Url::parse("http://127.0.0.1:1").expect("url"),
            Duration::from_millis(100),
            1,
            Duration::from_millis(1),
            Arc::new(MetricsRegistry::new()),
        );
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            serve_transport_connection(&mut stream, &service, &engine).await;
        });
        let mut client = TcpStream::connect(addr).await.expect("connect");
        let request = "POST /somewhere/else HTTP/1.1\r\nHost: test\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";
        client.write_all(request.as_bytes()).await.expect("write");
        let mut response = Vec::new();
        let read =
            tokio::time::timeout(Duration::from_secs(5), client.read_to_end(&mut response)).await;
        assert!(read.is_ok(), "404 path must not wait for anything");
        let text = String::from_utf8_lossy(&response).to_string();
        assert!(text.starts_with("HTTP/1.1 404"), "got: {text}");
        let _ = server.await;
    }
}
