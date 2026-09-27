//! Operational/business-safe error taxonomy for the gateway.
//!
//! Variants separate the failure classes that operations must distinguish:
//! malformed data, sequence discontinuities, provider failure, timeouts,
//! backpressure, authorization failure, stale intent and unavailable
//! capability. Messages are safe for logs: they carry identifiers and
//! counts, never credentials and never raw exchange payloads.

use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum GatewayError {
    #[error("malformed data: {0}")]
    MalformedData(String),

    #[error("sequence gap on {stream}: expected {expected}, got {actual}")]
    SequenceGap {
        stream: String,
        expected: u64,
        actual: u64,
    },

    #[error("duplicate sequence {actual} on {stream}")]
    DuplicateSequence { stream: String, actual: u64 },

    #[error("out-of-order sequence {actual} on {stream} (last {last})")]
    OutOfOrder {
        stream: String,
        actual: u64,
        last: u64,
    },

    #[error("provider failure: {0}")]
    ProviderFailure(String),

    #[error("timeout: {0}")]
    Timeout(String),

    #[error("backpressure refused: state {state:?}")]
    BackpressureRefused {
        state: crate::backpressure::BackpressureState,
    },

    #[error("non-critical event shed: state {state:?}")]
    BackpressureShed {
        state: crate::backpressure::BackpressureState,
    },

    #[error("authorization failure: {0}")]
    AuthorizationFailure(String),

    #[error("stale intent {intent_id}: expired at {expired_at_ms}")]
    StaleIntent {
        intent_id: String,
        expired_at_ms: i64,
    },

    #[error("integrity failure: {0}")]
    IntegrityFailure(String),

    #[error("unsupported capability: {0}")]
    UnsupportedCapability(String),

    #[error("configuration error: {0}")]
    Configuration(String),

    #[error("crossed book on {symbol}: best bid {bid} >= best ask {ask}")]
    CrossedBook {
        symbol: String,
        bid: String,
        ask: String,
    },

    #[error("book state unusable (stale or gapped) on {0}")]
    BookUnusable(String),

    #[error("transport failure: {0}")]
    Transport(String),

    #[error("io failure: {0}")]
    Io(String),

    #[error("shutting down: {0}")]
    Shutdown(String),
}

impl GatewayError {
    /// Stable machine-readable class used by metrics and ack mapping.
    /// Fixed strings only — never dynamic labels, never payload content.
    pub fn kind(&self) -> &'static str {
        match self {
            GatewayError::MalformedData(_) => "malformed_data",
            GatewayError::SequenceGap { .. } => "sequence_gap",
            GatewayError::DuplicateSequence { .. } => "duplicate_sequence",
            GatewayError::OutOfOrder { .. } => "out_of_order",
            GatewayError::ProviderFailure(_) => "provider_failure",
            GatewayError::Timeout(_) => "timeout",
            GatewayError::BackpressureRefused { .. } => "backpressure_refused",
            GatewayError::BackpressureShed { .. } => "backpressure_shed",
            GatewayError::AuthorizationFailure(_) => "authorization_failure",
            GatewayError::StaleIntent { .. } => "stale_intent",
            GatewayError::IntegrityFailure(_) => "integrity_failure",
            GatewayError::UnsupportedCapability(_) => "unsupported_capability",
            GatewayError::Configuration(_) => "configuration",
            GatewayError::CrossedBook { .. } => "crossed_book",
            GatewayError::BookUnusable(_) => "book_unusable",
            GatewayError::Transport(_) => "transport",
            GatewayError::Io(_) => "io",
            GatewayError::Shutdown(_) => "shutdown",
        }
    }

    /// Whether the condition is transient and the operation may be retried
    /// by the caller. Fail-closed components use this to classify retries;
    /// integrity/authorization/stale failures are never retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            GatewayError::Timeout(_)
                | GatewayError::ProviderFailure(_)
                | GatewayError::BackpressureRefused { .. }
                | GatewayError::Io(_)
                | GatewayError::Transport(_)
        )
    }
}

impl From<std::io::Error> for GatewayError {
    fn from(value: std::io::Error) -> Self {
        GatewayError::Io(value.to_string())
    }
}

impl From<serde_json::Error> for GatewayError {
    fn from(value: serde_json::Error) -> Self {
        GatewayError::MalformedData(format!("json: {value}"))
    }
}

impl From<url::ParseError> for GatewayError {
    fn from(value: url::ParseError) -> Self {
        GatewayError::Configuration(format!("url: {value}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 49 support] error classes are a fixed vocabulary: no payload
    // content becomes a label.
    #[test]
    fn error_kinds_are_a_fixed_vocabulary() {
        let samples = vec![
            GatewayError::MalformedData("x".into()),
            GatewayError::SequenceGap {
                stream: "s".into(),
                expected: 1,
                actual: 3,
            },
            GatewayError::DuplicateSequence {
                stream: "s".into(),
                actual: 1,
            },
            GatewayError::OutOfOrder {
                stream: "s".into(),
                actual: 1,
                last: 5,
            },
            GatewayError::ProviderFailure("conn reset".into()),
            GatewayError::Timeout("500ms".into()),
            GatewayError::BackpressureRefused {
                state: crate::backpressure::BackpressureState::Blocked,
            },
            GatewayError::BackpressureShed {
                state: crate::backpressure::BackpressureState::Critical,
            },
            GatewayError::AuthorizationFailure("bad key id".into()),
            GatewayError::StaleIntent {
                intent_id: "i".into(),
                expired_at_ms: 1,
            },
            GatewayError::IntegrityFailure("hmac".into()),
            GatewayError::UnsupportedCapability("kline".into()),
            GatewayError::Configuration("missing".into()),
            GatewayError::CrossedBook {
                symbol: "BTCUSDT".into(),
                bid: "1".into(),
                ask: "0.5".into(),
            },
            GatewayError::BookUnusable("BTCUSDT".into()),
            GatewayError::Transport("http".into()),
            GatewayError::Io("eof".into()),
            GatewayError::Shutdown("sigterm".into()),
        ];
        for err in &samples {
            let kind = err.kind();
            assert!(!kind.is_empty());
            assert!(!kind.contains(' '));
            assert!(!kind.contains("AKIA"));
            assert!(!format!("{err}").contains("AKIA"));
        }
    }

    // Retry classification: safety failures never retry; transient ones do.
    #[test]
    fn retry_classification_is_fail_closed_for_safety_failures() {
        assert!(GatewayError::Timeout("t".into()).is_retryable());
        assert!(GatewayError::ProviderFailure("p".into()).is_retryable());
        assert!(!GatewayError::IntegrityFailure("i".into()).is_retryable());
        assert!(!GatewayError::AuthorizationFailure("a".into()).is_retryable());
        assert!(!GatewayError::StaleIntent {
            intent_id: "i".into(),
            expired_at_ms: 1
        }
        .is_retryable());
        assert!(!GatewayError::UnsupportedCapability("u".into()).is_retryable());
    }
}
