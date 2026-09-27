//! Internal integration client for the EXISTING Python execution engine.
//!
//! Contract: the gateway forwards only validated, signed, prepared intents
//! to the engine's internal transport endpoint; the engine owns the actual
//! exchange/provider execution path. This client:
//! - negotiates the transport schema version before any intent flows;
//! - posts prepared intents with the correlation id preserved end-to-end;
//! - classifies failures (timeout / 5xx => retryable, 4xx => permanent);
//! - NEVER fabricates a successful execution result: success exists only as
//!   an explicit 2xx response whose correlation matches and whose ack status
//!   says accepted. Anything else is an error.
//!
//! HTTP/1.1 is implemented directly over tokio TcpStream (the internal
//! plane is plain http inside the trust boundary; external TLS termination
//! is the platform ingress's job). Requests are small, one-shot and
//! connection-close — ideal for a low-latency, low-dependency client.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::error::GatewayError;
use crate::metrics::MetricsRegistry;
use crate::time::utc_now_ms;
use crate::transport_protocol::{SchemaAdvertisement, TransportFrame, TRANSPORT_SCHEMA_VERSION};
use crate::types::{TransportAck, VenueOrderRequest};

const SCHEMA_PATH: &str = "/internal/v1/transport/schema";
const INTENT_PATH: &str = "/internal/v1/transport/intents";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EngineHealth {
    pub service: String,
    pub status: String,
    pub schema_version: u32,
}

pub struct ExecutionEngineClient {
    base: url::Url,
    timeout: Duration,
    max_attempts: u32,
    retry_backoff: Duration,
    metrics: Arc<MetricsRegistry>,
    pub schema_negotiations: Arc<AtomicU64>,
    pub provider_failures: Arc<AtomicU64>,
}

impl ExecutionEngineClient {
    pub fn new(
        base: url::Url,
        timeout: Duration,
        max_attempts: u32,
        retry_backoff: Duration,
        metrics: Arc<MetricsRegistry>,
    ) -> ExecutionEngineClient {
        ExecutionEngineClient {
            base,
            timeout,
            max_attempts: max_attempts.max(1),
            retry_backoff,
            metrics,
            schema_negotiations: Arc::new(AtomicU64::new(0)),
            provider_failures: Arc::new(AtomicU64::new(0)),
        }
    }

    fn authority_and_path(&self, path: &str) -> Result<(String, u16, String), GatewayError> {
        if self.base.scheme() != "http" {
            return Err(GatewayError::Configuration(format!(
                "execution engine url must be internal http (got '{}')",
                self.base.scheme()
            )));
        }
        let host = self
            .base
            .host_str()
            .ok_or_else(|| GatewayError::Configuration("engine url missing host".into()))?
            .to_string();
        let port = self.base.port_or_known_default().unwrap_or(80);
        let base_path = self.base.path().trim_end_matches('/');
        let full_path = format!("{base_path}{path}");
        Ok((host, port, full_path))
    }

    async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        correlation: &str,
    ) -> Result<(u16, String), GatewayError> {
        let (host, port, full_path) = self.authority_and_path(path)?;
        let body = body.unwrap_or("");
        let request = format!(
            "{method} {full_path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nX-Correlation-Id: {correlation}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );

        let mut last_error = GatewayError::Transport("no attempt made".to_string());
        for attempt in 0..self.max_attempts {
            if attempt > 0 {
                tokio::time::sleep(self.retry_backoff).await;
            }
            let connect =
                tokio::time::timeout(self.timeout, TcpStream::connect((host.as_str(), port))).await;
            let mut stream = match connect {
                Ok(Ok(stream)) => stream,
                Ok(Err(e)) => {
                    last_error = GatewayError::ProviderFailure(format!("connect: {e}"));
                    self.provider_failures.fetch_add(1, Ordering::Relaxed);
                    self.metrics.inc_provider_failures();
                    continue;
                }
                Err(_) => {
                    last_error = GatewayError::Timeout(format!("connect timeout to {host}:{port}"));
                    self.metrics.inc_transport_timeouts();
                    continue;
                }
            };
            let write = stream.write_all(request.as_bytes()).await;
            if let Err(e) = write {
                last_error = GatewayError::Transport(format!("write: {e}"));
                continue;
            }
            let read = tokio::time::timeout(self.timeout, read_http_response(&mut stream)).await;
            match read {
                Ok(Ok((status, body))) => return Ok((status, body)),
                Ok(Err(e)) => {
                    last_error = e;
                    continue;
                }
                Err(_) => {
                    last_error = GatewayError::Timeout("response timeout".to_string());
                    self.metrics.inc_transport_timeouts();
                    continue;
                }
            }
        }
        Err(last_error)
    }

    /// Schema negotiation before any intent is transported. The gateway and
    /// the engine must overlap on a supported schema version or the
    /// integration is DOWN (fail closed), not "compatible by hope".
    pub async fn negotiate_schema(&self) -> Result<SchemaAdvertisement, GatewayError> {
        let (status, body) = self
            .request("GET", SCHEMA_PATH, None, "schema-negotiation")
            .await?;
        if status != 200 {
            return Err(GatewayError::ProviderFailure(format!(
                "schema negotiation returned HTTP {status}"
            )));
        }
        let advertisement: SchemaAdvertisement = serde_json::from_str(&body)
            .map_err(|e| GatewayError::MalformedData(format!("schema advertisement: {e}")))?;
        let agreed = SchemaAdvertisement::negotiate(&advertisement)?;
        self.schema_negotiations.fetch_add(1, Ordering::Relaxed);
        tracing::info!(agreed_schema = agreed, peer = %advertisement.service, "engine schema negotiated");
        Ok(advertisement)
    }

    /// Submits one prepared intent. Success requires: HTTP 2xx, a parseable
    /// ack frame at the negotiated schema, a MATCHING correlation id, and a
    /// gateway-side acceptance status. Everything else is a normalized
    /// failure — never an invented acceptance.
    pub async fn submit_prepared(
        &self,
        request: &VenueOrderRequest,
        correlation: &str,
    ) -> Result<TransportAck, GatewayError> {
        let frame = TransportFrame {
            schema_version: TRANSPORT_SCHEMA_VERSION,
            correlation_id: correlation.to_string(),
            frame_type: "intent".to_string(),
            sent_at_ms: utc_now_ms(),
            payload: serde_json::to_value(request)
                .map_err(|e| GatewayError::Transport(format!("payload serialize: {e}")))?,
        };
        let body = serde_json::to_string(&frame)
            .map_err(|e| GatewayError::Transport(format!("frame serialize: {e}")))?;
        // Retry budget: transport errors retry inside `request`; 5xx
        // retries here; 4xx is permanent and never retried.
        let mut last: (u16, String) = (0, String::new());
        let mut status = 0u16;
        let mut response_body = String::new();
        for attempt in 0..self.max_attempts.max(1) {
            if attempt > 0 {
                tokio::time::sleep(self.retry_backoff).await;
            }
            let result = self
                .request("POST", INTENT_PATH, Some(&body), correlation)
                .await?;
            status = result.0;
            response_body = result.1;
            if (500..600).contains(&status) {
                last = (status, response_body.clone());
                self.provider_failures.fetch_add(1, Ordering::Relaxed);
                self.metrics.inc_provider_failures();
                continue;
            }
            last = (status, response_body.clone());
            break;
        }
        if !(200..300).contains(&status) {
            // 4xx: our frame is wrong (permanent contract violation);
            // 5xx: provider trouble after retries. Neither is ever a
            // success, and neither is ever reported as one.
            let kind = if (400..500).contains(&status) {
                GatewayError::MalformedData(format!("engine rejected frame with HTTP {status}"))
            } else {
                GatewayError::ProviderFailure(format!(
                    "engine returned HTTP {} after retries",
                    last.0
                ))
            };
            return Err(kind);
        }
        let ack_frame: crate::transport_protocol::AckFrame =
            serde_json::from_str(&response_body)
                .map_err(|e| GatewayError::MalformedData(format!("ack frame: {e}")))?;
        if ack_frame.ack.correlation_id != correlation {
            return Err(GatewayError::Transport(format!(
                "ack correlation '{}' does not match request '{correlation}'",
                ack_frame.ack.correlation_id
            )));
        }
        Ok(ack_frame.ack)
    }
}

/// Reads one HTTP/1.1 response: status line, headers, Content-Length body.
async fn read_http_response(stream: &mut TcpStream) -> Result<(u16, String), GatewayError> {
    let mut buffer: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let header_end;
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err(GatewayError::Transport(
                "connection closed before headers".into(),
            ));
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_subslice(&buffer, b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
        if buffer.len() > 64 * 1024 {
            return Err(GatewayError::Transport("response headers too large".into()));
        }
    }
    let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let status_line = headers.lines().next().unwrap_or("");
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| GatewayError::Transport(format!("bad status line '{status_line}'")))?;
    let mut content_length: usize = 0;
    for line in headers.lines().skip(1) {
        let mut parts = line.splitn(2, ':');
        if let Some(name) = parts.next() {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = parts
                    .next()
                    .and_then(|v| v.trim().parse().ok())
                    .ok_or_else(|| GatewayError::Transport("bad content-length".into()))?;
            }
        }
    }
    while buffer.len() < header_end + content_length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..n]);
        if buffer.len() > 2 * 1024 * 1024 {
            return Err(GatewayError::Transport("response body too large".into()));
        }
    }
    let body = String::from_utf8_lossy(&buffer[header_end..]).to_string();
    Ok((status, body))
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

// ---------------------------------------------------------------------------
// Deterministic tests over a real in-process TCP server.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::MetricsRegistry;
    use crate::types::{AckStatus, Fixed, OrderSide, Symbol, Venue};
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    fn prepared() -> VenueOrderRequest {
        VenueOrderRequest {
            schema_version: TRANSPORT_SCHEMA_VERSION,
            intent_id: "intent-1".to_string(),
            correlation_id: "corr-engine-1".to_string(),
            tenant_id: "tenant-77".to_string(),
            account_id: "acct-42".to_string(),
            venue: Venue::Binance,
            symbol: Symbol::new("BTCUSDT").expect("sym"),
            side: OrderSide::Buy,
            quantity: Fixed::parse("0.250").expect("qty"),
            client_order_id: "LLE-abc123".to_string(),
            transport_nonce: "nonce-1".to_string(),
            prepared_at_ms: utc_now_ms(),
        }
    }

    fn engine_client(port: u16, timeout_ms: u64, attempts: u32) -> ExecutionEngineClient {
        ExecutionEngineClient::new(
            url::Url::parse(&format!("http://127.0.0.1:{port}")).expect("url"),
            Duration::from_millis(timeout_ms),
            attempts,
            Duration::from_millis(10),
            Arc::new(MetricsRegistry::new()),
        )
    }

    /// Spawns a canned HTTP server: for each connection, runs `responder`
    /// with the received request bytes and produces (status, body).
    async fn canned_server(
        responder: impl Fn(String) -> (u16, String) + Send + Sync + 'static,
    ) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let responder = Arc::new(responder);
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let responder = Arc::clone(&responder);
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let mut received = Vec::new();
                    // Read until end of headers (requests are small, close
                    // after one response).
                    loop {
                        let n = socket.read(&mut buf).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        received.extend_from_slice(&buf[..n]);
                        if received.windows(4).any(|w| w == b"\r\n\r\n") {
                            // Headers complete; for POST with a body, try to
                            // also have the body (Content-Length present).
                            break;
                        }
                    }
                    let request_text = String::from_utf8_lossy(&received).to_string();
                    let (status, body) = responder(request_text);
                    let response = format!(
                        "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.flush().await;
                });
            }
        });
        port
    }

    // [CHECK 51] schema negotiation agrees on the overlapping version.
    #[tokio::test]
    async fn schema_negotiation_agrees_and_fails_closed() {
        let ok_body = serde_json::json!({
            "service": "execution-engine",
            "schema_version": TRANSPORT_SCHEMA_VERSION,
            "min_supported_schema_version": TRANSPORT_SCHEMA_VERSION,
        });
        let port = canned_server(move |_| (200, ok_body.to_string())).await;
        let client = engine_client(port, 1_000, 1);
        let ad = client.negotiate_schema().await.expect("negotiated");
        assert_eq!(ad.service, "execution-engine");

        // Incompatible peer => fail closed.
        let bad_body = serde_json::json!({
            "service": "execution-engine",
            "schema_version": TRANSPORT_SCHEMA_VERSION + 5,
            "min_supported_schema_version": TRANSPORT_SCHEMA_VERSION + 5,
        });
        let port = canned_server(move |_| (200, bad_body.to_string())).await;
        let client = engine_client(port, 1_000, 1);
        assert!(client.negotiate_schema().await.is_err());
    }

    // [CHECK 52] correlation id is preserved end to end.
    #[tokio::test]
    async fn correlation_is_preserved_and_mismatch_is_an_error() {
        let port = canned_server(|request| {
            // Echo the request correlation into the ack.
            let corr = request
                .lines()
                .find(|l| l.starts_with("X-Correlation-Id:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("missing")
                .to_string();
            let ack = serde_json::json!({
                "schema_version": TRANSPORT_SCHEMA_VERSION,
                "ack": {
                    "intent_id": "intent-1",
                    "correlation_id": corr,
                    "status": "accepted_for_transport",
                    "observed_at_ms": utc_now_ms(),
                    "detail": null
                }
            });
            (200, ack.to_string())
        })
        .await;
        let client = engine_client(port, 1_000, 1);
        let ack = client
            .submit_prepared(&prepared(), "corr-engine-1")
            .await
            .expect("accepted");
        assert_eq!(ack.status, AckStatus::AcceptedForTransport);
        assert_eq!(ack.correlation_id, "corr-engine-1");

        // Server answers with the WRONG correlation: error, never success.
        let wrong_port = canned_server(|_| {
            let ack = serde_json::json!({
                "schema_version": TRANSPORT_SCHEMA_VERSION,
                "ack": {
                    "intent_id": "intent-1",
                    "correlation_id": "something-else",
                    "status": "accepted_for_transport",
                    "observed_at_ms": utc_now_ms(),
                    "detail": null
                }
            });
            (200, ack.to_string())
        })
        .await;
        let client = engine_client(wrong_port, 1_000, 1);
        assert!(client
            .submit_prepared(&prepared(), "corr-engine-1")
            .await
            .is_err());
    }

    // [CHECK 41] transport timeout is normalized to the Timeout error and
    // counted.
    #[tokio::test]
    async fn transport_timeout_is_normalized_and_counted() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            // Accept and then stay silent: the client times out.
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    break;
                };
                std::mem::forget(socket);
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
        let client = engine_client(port, 80, 1);
        let err = client
            .submit_prepared(&prepared(), "corr-timeout")
            .await
            .expect_err("timeout");
        assert!(matches!(err, GatewayError::Timeout(_)));
        assert!(err.is_retryable());
        assert!(
            client
                .metrics
                .transport_timeouts_total
                .load(Ordering::Relaxed)
                + client
                    .metrics
                    .provider_failures_total
                    .load(Ordering::Relaxed)
                >= 1
        );
    }

    // [CHECK 42][CHECK 58] provider failure is normalized; a failure is
    // NEVER reported as a successful transport.
    #[tokio::test]
    async fn provider_failure_is_normalized_never_success() {
        let port = canned_server(|_| (503, "{\"error\":\"engine unavailable\"}".to_string())).await;
        let client = engine_client(port, 1_000, 1);
        let err = client
            .submit_prepared(&prepared(), "corr-fail")
            .await
            .expect_err("503");
        assert!(matches!(err, GatewayError::ProviderFailure(_)));

        let port = canned_server(|_| (422, "{\"error\":\"unsupported symbol\"}".to_string())).await;
        let client = engine_client(port, 1_000, 1);
        let err = client
            .submit_prepared(&prepared(), "corr-422")
            .await
            .expect_err("422");
        // A 4xx is a permanent contract violation: non-retryable by design.
        assert!(matches!(err, GatewayError::MalformedData(_)));
        assert!(!err.is_retryable());

        // Garbage 200 body: malformed ack, not a fabricated success.
        let port = canned_server(|_| (200, "not-json".to_string())).await;
        let client = engine_client(port, 1_000, 1);
        assert!(client
            .submit_prepared(&prepared(), "corr-garbage")
            .await
            .is_err());
    }

    // Retry classification: 5xx is retried up to max_attempts, 4xx is not.
    #[tokio::test]
    async fn retry_classification_matches_transport_rules() {
        use std::sync::atomic::AtomicUsize;
        let hits = Arc::new(AtomicUsize::new(0));
        let hits_writer = Arc::clone(&hits);
        let port = canned_server(move |_| {
            hits_writer.fetch_add(1, Ordering::Relaxed);
            (503, "{\"error\":\"try again\"}".to_string())
        })
        .await;
        let client = engine_client(port, 1_000, 3);
        assert!(client
            .submit_prepared(&prepared(), "corr-retry")
            .await
            .is_err());
        assert_eq!(
            hits.load(Ordering::Relaxed),
            3,
            "5xx retried max_attempts times"
        );

        let hits2 = Arc::new(AtomicUsize::new(0));
        let hits2_writer = Arc::clone(&hits2);
        let port = canned_server(move |_| {
            hits2_writer.fetch_add(1, Ordering::Relaxed);
            (400, "{\"error\":\"bad request\"}".to_string())
        })
        .await;
        let client = engine_client(port, 1_000, 5);
        assert!(client
            .submit_prepared(&prepared(), "corr-4xx")
            .await
            .is_err());
        assert_eq!(hits2.load(Ordering::Relaxed), 1, "4xx must not be retried");
    }

    // [CHECK 53 support] tenant scope travels inside the prepared payload.
    #[tokio::test]
    async fn tenant_scope_travels_in_payload() {
        let seen_tenant: Arc<std::sync::Mutex<Option<String>>> = Arc::default();
        let sink = Arc::clone(&seen_tenant);
        let port = canned_server(move |request| {
            let body = request.split("\r\n\r\n").nth(1).unwrap_or("");
            if let Ok(frame) = serde_json::from_str::<serde_json::Value>(body) {
                *sink.lock().expect("lock") =
                    frame["payload"]["tenant_id"].as_str().map(str::to_string);
            }
            let ack = serde_json::json!({
                "schema_version": TRANSPORT_SCHEMA_VERSION,
                "ack": {
                    "intent_id": "intent-1",
                    "correlation_id": "corr-scope",
                    "status": "accepted_for_transport",
                    "observed_at_ms": utc_now_ms(),
                    "detail": null
                }
            });
            (200, ack.to_string())
        })
        .await;
        let client = engine_client(port, 1_000, 1);
        client
            .submit_prepared(&prepared(), "corr-scope")
            .await
            .expect("ok");
        assert_eq!(seen_tenant.lock().expect("l").as_deref(), Some("tenant-77"));
    }
}
