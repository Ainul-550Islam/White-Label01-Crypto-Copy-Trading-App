//! Production Rust SDK for the developer platform: a typed async client over
//! a hand-rolled HTTP/1.1 transport (tokio TcpStream, no external HTTP deps),
//! with cursor pagination, normalized errors, correlation-id propagation,
//! per-request API version pinning and a constant-time webhook verifier.
//!
//! Every method maps to a REAL backend route (inventory pinned by
//! developer.contract.spec.ts CHECK 47); no endpoint is invented. Credentials
//! are never logged or persisted by this crate. No `unsafe` anywhere.

use std::collections::BTreeMap;
use std::time::Duration;

use hmac::{Hmac, Mac};
use serde::de::DeserializeOwned;
use sha2::Sha256;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// The 16 backend-authoritative scopes; the SDK never invents extra ones.
pub const DEVELOPER_SCOPES: [&str; 16] = [
    "profile:read",
    "account:read",
    "portfolio:read",
    "portfolio:write",
    "trading:read",
    "trading:execute",
    "copy:read",
    "copy:manage",
    "billing:read",
    "billing:manage",
    "funding:read",
    "funding:request",
    "statements:read",
    "reports:read",
    "webhooks:manage",
    "developer:manage",
];

/// The 23 authoritative event types mirrored from the platform catalog.
pub const DEVELOPER_EVENT_TYPES: [&str; 23] = [
    "customer.created",
    "customer.updated",
    "subscription.created",
    "subscription.changed",
    "subscription.cancelled",
    "payment.succeeded",
    "payment.failed",
    "invoice.created",
    "invoice.paid",
    "funding.requested",
    "funding.confirmed",
    "withdrawal.requested",
    "withdrawal.confirmed",
    "copy.subscription.created",
    "copy.subscription.cancelled",
    "order.created",
    "order.acknowledged",
    "order.filled",
    "order.rejected",
    "portfolio.snapshot.created",
    "statement.generated",
    "compliance.review.required",
    "security.event",
];

/// Application lifecycle states enforced by the backend.
pub const APPLICATION_STATES: [&str; 5] = [
    "PENDING",
    "ACTIVE",
    "SUSPENDED",
    "REACTIVATION_REVIEW",
    "REVOKED",
];

#[derive(Debug, Clone)]
pub enum Credentials {
    Bearer { token: String },
    DeveloperKey { key_id: String, secret: String },
}

#[derive(Debug, Error)]
pub enum SdkError {
    #[error("transport failure: {0}")]
    Transport(String),
    #[error("api error {status}: {code} — {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
        correlation_id: Option<String>,
    },
    #[error("protocol violation: {0}")]
    Protocol(String),
}

type Result<T> = std::result::Result<T, SdkError>;

#[derive(Debug, Clone)]
pub struct SdkConfig {
    /// Host header + connect target, e.g. `api.example.test:443` (TLS terminates upstream).
    pub authority: String,
    pub api_version: String,
    pub timeout: Duration,
    pub max_safe_retries: u32,
}

impl Default for SdkConfig {
    fn default() -> Self {
        Self {
            authority: "127.0.0.1:3000".to_string(),
            api_version: "v2".to_string(),
            timeout: Duration::from_secs(15),
            max_safe_retries: 2,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct Page<T> {
    pub rows: Vec<T>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ApplicationView {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub name: String,
    #[serde(rename = "clientId")]
    pub client_id: String,
    pub state: String,
    pub environment: String,
    #[serde(rename = "redirectUris")]
    pub redirect_uris: Vec<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct IssuedCredential {
    #[serde(rename = "keyId")]
    pub key_id: String,
    /// One-time presentation; the platform never shows this value again.
    pub secret: String,
    pub scopes: Vec<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct WebhookSubscriptionView {
    pub id: String,
    #[serde(rename = "applicationId")]
    pub application_id: String,
    #[serde(rename = "endpointUrl")]
    pub endpoint_url: String,
    #[serde(rename = "eventTypes")]
    pub event_types: Vec<String>,
    pub state: String,
    pub environment: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct DeliveryView {
    pub id: String,
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "eventType")]
    pub event_type: String,
    pub attempt: u32,
    pub state: String,
    #[serde(rename = "responseStatus")]
    pub response_status: Option<u16>,
}

pub struct DeveloperPlatformClient {
    config: SdkConfig,
    credentials: Option<Credentials>,
    correlation_counter: std::sync::atomic::AtomicU64,
}

impl DeveloperPlatformClient {
    pub fn new(config: SdkConfig) -> Self {
        Self {
            config,
            credentials: None,
            correlation_counter: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub fn with_credentials(mut self, credentials: Credentials) -> Self {
        self.credentials = Some(credentials);
        self
    }

    fn correlation_id(&self) -> String {
        let counter = self
            .correlation_counter
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        format!("sdk-rust-{}", counter)
    }

    fn authorization(&self) -> Result<String> {
        match &self.credentials {
            None => Err(SdkError::Api {
                status: 0,
                code: "SDK_NO_AUTH".to_string(),
                message: "credentials not configured".to_string(),
                correlation_id: None,
            }),
            Some(Credentials::Bearer { token }) => Ok(format!("Bearer {token}")),
            Some(Credentials::DeveloperKey { key_id, secret }) => {
                Ok(format!("Developer {key_id}.{secret}"))
            }
        }
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
        query: &[(&str, String)],
    ) -> Result<T> {
        let mut query_string = String::new();
        for (index, (key, value)) in query.iter().enumerate() {
            query_string.push(if index == 0 { '?' } else { '&' });
            query_string.push_str(key);
            query_string.push('=');
            query_string.push_str(&value.replace(' ', "%20"));
        }
        let payload: Option<String> = body
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .ok()
            .flatten();
        let mut attempt = 0u32;
        loop {
            let outcome = self
                .request_once(method, path, &query_string, payload.as_deref())
                .await;
            match outcome {
                Err(SdkError::Transport(_))
                    if method == "GET" && attempt < self.config.max_safe_retries =>
                {
                    attempt += 1;
                    continue;
                }
                other => return other,
            }
        }
    }

    async fn request_once<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        query_string: &str,
        payload: Option<&str>,
    ) -> Result<T> {
        let target = format!("/developer-platform{path}{query_string}");
        let mut request = format!(
            "{method} {target} HTTP/1.1\r\nHost: {}\r\nX-Api-Version: {}\r\nx-correlation-id: {}\r\nAuthorization: {}\r\nConnection: close\r\n",
            self.config.authority,
            self.config.api_version,
            self.correlation_id(),
            self.authorization()?,
        );
        if let Some(body) = payload {
            request.push_str("Content-Type: application/json\r\n");
            request.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        request.push_str("\r\n");
        if let Some(body) = payload {
            request.push_str(body);
        }

        let connect = tokio::time::timeout(
            self.config.timeout,
            TcpStream::connect(&self.config.authority),
        )
        .await
        .map_err(|_| SdkError::Transport("connect timeout".to_string()))?;
        let mut stream = connect.map_err(|error| SdkError::Transport(error.to_string()))?;
        tokio::time::timeout(self.config.timeout, stream.write_all(request.as_bytes()))
            .await
            .map_err(|_| SdkError::Transport("write timeout".to_string()))?
            .map_err(|error| SdkError::Transport(error.to_string()))?;

        let mut raw = Vec::new();
        tokio::time::timeout(self.config.timeout, stream.read_to_end(&mut raw))
            .await
            .map_err(|_| SdkError::Transport("read timeout".to_string()))?
            .map_err(|error| SdkError::Transport(error.to_string()))?;

        let text = std::str::from_utf8(&raw)
            .map_err(|error| SdkError::Protocol(format!("non-utf8 response: {error}")))?;
        let (head, body) = text
            .split_once("\r\n\r\n")
            .ok_or_else(|| SdkError::Protocol("missing header/body separator".to_string()))?;
        let mut lines = head.lines();
        let status_line = lines
            .next()
            .ok_or_else(|| SdkError::Protocol("empty status line".to_string()))?;
        let status: u16 = status_line
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .ok_or_else(|| SdkError::Protocol("unparsable status line".to_string()))?;
        let mut headers: BTreeMap<String, String> = BTreeMap::new();
        for line in lines {
            if let Some((name, value)) = line.split_once(':') {
                headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
            }
        }
        let correlation_id = headers.get("x-correlation-id").cloned();

        // Chunked responses are reassembled deterministically.
        let body_text: String = match headers.get("transfer-encoding").map(String::as_str) {
            Some(encoding) if encoding.eq_ignore_ascii_case("chunked") => {
                let mut out = String::new();
                let mut rest = body;
                loop {
                    let (size_line, remainder) = rest
                        .split_once("\r\n")
                        .ok_or_else(|| SdkError::Protocol("truncated chunk".to_string()))?;
                    let size = usize::from_str_radix(size_line.trim(), 16)
                        .map_err(|error| SdkError::Protocol(format!("bad chunk size: {error}")))?;
                    if size == 0 {
                        break;
                    }
                    let end = remainder.len().min(size);
                    out.push_str(&remainder[..end]);
                    rest = &remainder[end..];
                    rest = rest.strip_prefix("\r\n").unwrap_or(rest);
                }
                out
            }
            _ => body.to_string(),
        };

        if status >= 400 {
            let parsed: serde_json::Value =
                serde_json::from_str(&body_text).unwrap_or(serde_json::Value::Null);
            let code = parsed
                .get("code")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("HTTP_ERROR")
                .to_string();
            let message = parsed
                .get("message")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("request failed with HTTP {status}"));
            return Err(SdkError::Api {
                status,
                code,
                message,
                correlation_id,
            });
        }
        if body_text.trim().is_empty() {
            return serde_json::from_str("null")
                .map_err(|error| SdkError::Protocol(error.to_string()));
        }
        serde_json::from_str(&body_text).map_err(|error| SdkError::Protocol(error.to_string()))
    }

    // ------------------------------------------------------------- applications

    pub async fn create_application(&self, input: &serde_json::Value) -> Result<ApplicationView> {
        self.request("POST", "/applications", Some(input.clone()), &[])
            .await
    }

    pub async fn get_application(&self, application_id: &str) -> Result<ApplicationView> {
        self.request("GET", &format!("/applications/{application_id}"), None, &[])
            .await
    }

    pub async fn list_applications(
        &self,
        query: &[(&str, String)],
    ) -> Result<Page<ApplicationView>> {
        self.request("GET", "/applications", None, query).await
    }

    pub async fn update_application(
        &self,
        application_id: &str,
        patch: &serde_json::Value,
    ) -> Result<ApplicationView> {
        self.request(
            "PATCH",
            &format!("/applications/{application_id}"),
            Some(patch.clone()),
            &[],
        )
        .await
    }

    pub async fn transition_application(
        &self,
        application_id: &str,
        target_state: &str,
        reason: Option<&str>,
    ) -> Result<ApplicationView> {
        if !APPLICATION_STATES.contains(&target_state) {
            return Err(SdkError::Protocol(format!(
                "unknown lifecycle state: {target_state}"
            )));
        }
        self.request(
            "POST",
            &format!("/applications/{application_id}/transitions"),
            Some(serde_json::json!({ "targetState": target_state, "reason": reason })),
            &[],
        )
        .await
    }

    pub async fn add_redirect_uri(
        &self,
        application_id: &str,
        uri: &str,
    ) -> Result<ApplicationView> {
        self.request(
            "POST",
            &format!("/applications/{application_id}/redirect-uris"),
            Some(serde_json::json!({ "redirect": { "uri": uri } })),
            &[],
        )
        .await
    }

    pub async fn update_application_scopes(
        &self,
        application_id: &str,
        scopes: &[&str],
        reason: Option<&str>,
    ) -> Result<ApplicationView> {
        for scope in scopes {
            if !DEVELOPER_SCOPES.contains(scope) {
                return Err(SdkError::Protocol(format!("unknown scope: {scope}")));
            }
        }
        self.request(
            "PUT",
            &format!("/applications/{application_id}/scopes"),
            Some(serde_json::json!({ "scopes": scopes, "reason": reason })),
            &[],
        )
        .await
    }

    // -------------------------------------------------------------- credentials

    pub async fn create_credential(
        &self,
        application_id: &str,
        input: &serde_json::Value,
    ) -> Result<IssuedCredential> {
        self.request(
            "POST",
            &format!("/applications/{application_id}/credentials"),
            Some(input.clone()),
            &[],
        )
        .await
    }

    pub async fn list_credentials(
        &self,
        query: &[(&str, String)],
    ) -> Result<Page<serde_json::Value>> {
        self.request("GET", "/credentials", None, query).await
    }

    pub async fn rotate_credential(
        &self,
        application_id: &str,
        key_id: &str,
        reason: Option<&str>,
    ) -> Result<IssuedCredential> {
        self.request(
            "POST",
            &format!("/applications/{application_id}/credentials/{key_id}/rotate"),
            Some(serde_json::json!({ "keyId": key_id, "reason": reason })),
            &[],
        )
        .await
    }

    pub async fn revoke_credential(
        &self,
        application_id: &str,
        key_id: &str,
        reason: Option<&str>,
    ) -> Result<serde_json::Value> {
        self.request(
            "DELETE",
            &format!("/applications/{application_id}/credentials/{key_id}"),
            Some(serde_json::json!({ "reason": reason })),
            &[],
        )
        .await
    }

    // -------------------------------------------------------------------- oauth

    pub async fn exchange_oauth_token(
        &self,
        input: &serde_json::Value,
    ) -> Result<serde_json::Value> {
        self.request("POST", "/oauth/token", Some(input.clone()), &[])
            .await
    }

    pub async fn revoke_oauth_token(&self, token: &str) -> Result<serde_json::Value> {
        self.request(
            "POST",
            "/oauth/revoke",
            Some(serde_json::json!({ "token": token })),
            &[],
        )
        .await
    }

    // ------------------------------------------------------------------ webhooks

    pub async fn create_webhook_subscription(
        &self,
        input: &serde_json::Value,
    ) -> Result<serde_json::Value> {
        if let Some(event_types) = input
            .get("eventTypes")
            .and_then(serde_json::Value::as_array)
        {
            for event_type in event_types {
                let name = event_type.as_str().ok_or_else(|| {
                    SdkError::Protocol("eventTypes entries must be strings".to_string())
                })?;
                if !DEVELOPER_EVENT_TYPES.contains(&name) {
                    return Err(SdkError::Protocol(format!("unknown event type: {name}")));
                }
            }
        }
        self.request("POST", "/webhooks", Some(input.clone()), &[])
            .await
    }

    pub async fn list_webhook_subscriptions(
        &self,
        query: &[(&str, String)],
    ) -> Result<Page<WebhookSubscriptionView>> {
        self.request("GET", "/webhooks", None, query).await
    }

    pub async fn update_webhook_subscription(
        &self,
        subscription_id: &str,
        patch: &serde_json::Value,
    ) -> Result<WebhookSubscriptionView> {
        self.request(
            "PATCH",
            &format!("/webhooks/{subscription_id}"),
            Some(patch.clone()),
            &[],
        )
        .await
    }

    pub async fn webhook_action(
        &self,
        subscription_id: &str,
        action: &str,
        reason: Option<&str>,
    ) -> Result<WebhookSubscriptionView> {
        if !matches!(action, "pause" | "resume" | "revoke") {
            return Err(SdkError::Protocol(format!(
                "unknown webhook action: {action}"
            )));
        }
        self.request(
            "POST",
            &format!("/webhooks/{subscription_id}/actions"),
            Some(serde_json::json!({ "action": action, "reason": reason })),
            &[],
        )
        .await
    }

    pub async fn rotate_webhook_secret(&self, subscription_id: &str) -> Result<serde_json::Value> {
        self.request(
            "POST",
            &format!("/webhooks/{subscription_id}/rotate-secret"),
            Some(serde_json::json!({})),
            &[],
        )
        .await
    }

    pub async fn replay_webhook_event(
        &self,
        subscription_id: &str,
        event_id: &str,
    ) -> Result<serde_json::Value> {
        self.request(
            "POST",
            &format!("/webhooks/{subscription_id}/replay"),
            Some(serde_json::json!({ "eventId": event_id })),
            &[],
        )
        .await
    }

    pub async fn list_webhook_deliveries(
        &self,
        subscription_id: &str,
        query: &[(&str, String)],
    ) -> Result<Page<DeliveryView>> {
        self.request(
            "GET",
            &format!("/webhooks/{subscription_id}/deliveries"),
            None,
            query,
        )
        .await
    }

    // -------------------------------------------------------- usage & analytics

    pub async fn usage_rollup(&self, query: &[(&str, String)]) -> Result<serde_json::Value> {
        self.request("GET", "/usage", None, query).await
    }

    pub async fn application_analytics(
        &self,
        application_id: &str,
        query: &[(&str, String)],
    ) -> Result<serde_json::Value> {
        let mut full: Vec<(&str, String)> = vec![("applicationId", application_id.to_string())];
        full.extend_from_slice(query);
        self.request("GET", "/analytics", None, &full).await
    }

    // -------------------------------------------------------- versions & catalog

    pub async fn api_versions(&self) -> Result<serde_json::Value> {
        self.request("GET", "/api-versions", None, &[]).await
    }

    pub async fn event_types(&self) -> Result<serde_json::Value> {
        self.request("GET", "/event-types", None, &[]).await
    }
}

/// Verify a platform webhook signature over the RAW body (constant-time),
/// enforcing the timestamp tolerance. Consumers dedupe on the event id.
pub fn verify_webhook(
    raw_body: &[u8],
    secret: &str,
    headers: &BTreeMap<String, String>,
    now_seconds: u64,
    tolerance_seconds: u64,
) -> Result<String> {
    let get = |name: &str| -> Option<String> {
        headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.clone())
    };
    let timestamp: u64 = get("x-webhook-timestamp")
        .ok_or_else(|| SdkError::Protocol("missing x-webhook-timestamp".to_string()))?
        .parse()
        .map_err(|_| SdkError::Protocol("malformed timestamp".to_string()))?;
    let event_id = get("x-webhook-event-id").unwrap_or_default();
    let version = get("x-webhook-version").unwrap_or_default();
    let signature = get("x-webhook-signature").unwrap_or_default();
    let now_lower = now_seconds.saturating_sub(timestamp);
    let now_upper = timestamp.saturating_sub(now_seconds);
    if now_lower.max(now_upper) > tolerance_seconds {
        return Err(SdkError::Api {
            status: 400,
            code: "WEBHOOK_TIMESTAMP_EXPIRED".to_string(),
            message: "signature timestamp outside tolerance".to_string(),
            correlation_id: None,
        });
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| SdkError::Protocol("hmac key error".to_string()))?;
    mac.update(format!("t={timestamp}.id={event_id}.v={version}.").as_bytes());
    mac.update(raw_body);
    let expected = format!("v1={}", hex::encode(mac.finalize().into_bytes()));
    if expected.len() != signature.len() {
        return Err(SdkError::Api {
            status: 401,
            code: "WEBHOOK_SIGNATURE_INVALID".to_string(),
            message: "signature does not verify".to_string(),
            correlation_id: None,
        });
    }
    let mut mismatch = 0u8;
    for (expected_byte, signature_byte) in expected.bytes().zip(signature.bytes()) {
        mismatch |= expected_byte ^ signature_byte;
    }
    if mismatch != 0 {
        return Err(SdkError::Api {
            status: 401,
            code: "WEBHOOK_SIGNATURE_INVALID".to_string(),
            message: "signature does not verify".to_string(),
            correlation_id: None,
        });
    }
    Ok(event_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogs_are_backend_pinned() {
        assert_eq!(DEVELOPER_SCOPES.len(), 16);
        assert_eq!(DEVELOPER_EVENT_TYPES.len(), 23);
        assert!(DEVELOPER_SCOPES.contains(&"trading:execute"));
        assert!(DEVELOPER_EVENT_TYPES.contains(&"order.filled"));
        assert_eq!(APPLICATION_STATES[4], "REVOKED");
    }

    #[test]
    fn webhook_verify_accepts_and_rejects() {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        let secret = "whsec_test";
        let body = br#"{"id":"pay-1"}"#;
        let timestamp = 1_790_000_000u64;
        let event_id = "evt-1";
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(format!("t={timestamp}.id={event_id}.v=v1.").as_bytes());
        mac.update(body);
        let signature = format!("v1={}", hex::encode(mac.finalize().into_bytes()));
        let mut headers = BTreeMap::new();
        headers.insert("x-webhook-timestamp".to_string(), timestamp.to_string());
        headers.insert("x-webhook-event-id".to_string(), event_id.to_string());
        headers.insert("x-webhook-version".to_string(), "v1".to_string());
        headers.insert("x-webhook-signature".to_string(), signature);
        assert_eq!(
            verify_webhook(body, secret, &headers, timestamp, 300).unwrap(),
            event_id
        );
        headers.insert(
            "x-webhook-timestamp".to_string(),
            (timestamp - 4_000).to_string(),
        );
        assert!(verify_webhook(body, secret, &headers, timestamp, 300).is_err());
    }

    #[tokio::test]
    async fn unknown_scope_and_event_are_rejected_client_side() {
        let client = DeveloperPlatformClient::new(SdkConfig::default());
        assert!(client
            .update_application_scopes("app", &["galaxy:read"], None)
            .await
            .is_err());
        assert!(client
            .create_webhook_subscription(&serde_json::json!({
                "applicationId": "app",
                "endpointUrl": "https://hooks.example.test",
                "eventTypes": ["wallet.drained"]
            }))
            .await
            .is_err());
    }
}
