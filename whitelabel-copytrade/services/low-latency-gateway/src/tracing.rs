//! Structured tracing setup with correlation ids and secret redaction.
//!
//! Two independent defenses:
//! 1. `redact_text` scrubs known credential shapes (AWS keys, JWTs, private
//!    key blocks, `authorization`/`api_key`/`token`/`password` style fields)
//!    from any text before it is written anywhere.
//! 2. The tracing `FormatEvent` implementation routes every log line through
//!    `redact_text`, so even a `tracing::error!` that accidentally receives
//!    a sensitive value cannot emit it.
//!
//! API keys can never appear in metrics either: the metrics registry has no
//! dynamic labels at all (see metrics.rs).

use std::fmt;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{format::Format, FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::prelude::*;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::EnvFilter;

/// Replaces credential-shaped substrings with explicit redaction markers.
/// Deterministic, allocation-bounded (single pass per pattern family).
pub fn redact_text(input: &str) -> String {
    let mut out = redact_aws_keys(input);
    out = redact_jwt(&out);
    out = redact_key_blocks(&out);
    out = redact_key_value_fields(&out);
    out
}

fn redact_aws_keys(input: &str) -> String {
    // AKIA + 16 uppercase alphanumerics.
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        let rest = &input[i..];
        if rest.len() >= 20
            && rest.starts_with("AKIA")
            && rest[4..20]
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        {
            out.push_str("[REDACTED_AWS_KEY]");
            i += 20;
        } else {
            let ch = rest.chars().next().expect("non-empty rest");
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn redact_jwt(input: &str) -> String {
    // JWT shape: eyJ<base64url>.<base64url>.<base64url>
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(pos) = rest.find("eyJ") {
        out.push_str(&rest[..pos]);
        let tail = &rest[pos..];
        let mut end = 0;
        let mut dots = 0;
        for (idx, ch) in tail.char_indices() {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                end = idx + ch.len_utf8();
            } else if ch == '.' {
                dots += 1;
                end = idx + 1;
            } else {
                break;
            }
        }
        let candidate = &tail[..end];
        if dots >= 2 && candidate.len() > 20 {
            out.push_str("[REDACTED_JWT]");
        } else {
            out.push_str("eyJ");
            out.push_str(&tail[3..end]);
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

fn redact_key_blocks(input: &str) -> String {
    // PEM blocks: -----BEGIN X KEY----- ... -----END X KEY-----
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("-----BEGIN") {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        match tail.find("-----END") {
            Some(end_rel) => {
                let end_abs = tail[end_rel..]
                    .find('\n')
                    .map(|n| end_rel + n)
                    .unwrap_or(tail.len());
                out.push_str("[REDACTED_KEY_MATERIAL]");
                rest = &tail[end_abs..];
            }
            None => {
                // Unterminated block: redact to end of input.
                out.push_str("[REDACTED_KEY_MATERIAL]");
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn redact_key_value_fields(input: &str) -> String {
    const SENSITIVE: [&str; 7] = [
        "authorization",
        "api_key",
        "api-key",
        "apikey",
        "password",
        "secret",
        "token",
    ];
    let lower = input.to_ascii_lowercase();
    let mut redactions: Vec<(usize, usize)> = Vec::new();
    for key in SENSITIVE {
        let mut search_from = 0;
        while let Some(rel) = lower[search_from..].find(key) {
            let start = search_from + rel;
            let key_end = start + key.len();
            // Key must be followed by a separator (: or =), optionally with
            // a closing JSON quote in between (`"authorization": "..."`),
            // then a value token.
            let after = &input[key_end..];
            let after_trimmed = after.trim_start();
            let after_trimmed = after_trimmed.strip_prefix('"').unwrap_or(after_trimmed);
            let after_trimmed = after_trimmed.trim_start();
            let sep_offset = after.len() - after_trimmed.len();
            if after_trimmed.starts_with(':') || after_trimmed.starts_with('=') {
                let value_start = key_end + sep_offset + 1;
                let value_rest = &input[value_start..];
                let value_trimmed = value_rest.trim_start();
                let ws = value_rest.len() - value_trimmed.len();
                let (token_len, advance_past_quote) =
                    if let Some(stripped) = value_trimmed.strip_prefix('"') {
                        let len = stripped.find('"').unwrap_or(stripped.len());
                        (len + 1, true)
                    } else {
                        let len = value_trimmed
                            .find(|c: char| c.is_whitespace() || c == ',' || c == '}' || c == ')')
                            .unwrap_or(value_trimmed.len());
                        (len, false)
                    };
                if token_len > 0 {
                    let from = value_start + ws;
                    redactions.push((from, from + token_len));
                    let consumed = from + token_len + if advance_past_quote { 1 } else { 0 };
                    search_from = consumed.min(input.len());
                    continue;
                }
            }
            search_from = key_end.max(start + 1);
        }
    }
    if redactions.is_empty() {
        return input.to_string();
    }
    redactions.sort_unstable();
    redactions.dedup();
    let mut out = String::with_capacity(input.len());
    let mut last = 0;
    for (from, to) in redactions {
        if from < last {
            continue;
        }
        out.push_str(&input[last..from]);
        out.push_str("[REDACTED]");
        last = to;
    }
    out.push_str(&input[last..]);
    out
}

/// Event formatter that scrubs every rendered line. Correlation ids and
/// ordinary identifiers pass through untouched.
struct RedactingFormat {
    inner: Format,
}

impl<S, N> FormatEvent<S, N> for RedactingFormat
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> fmt::Result {
        let mut buffer = String::new();
        let buffer_writer = Writer::new(&mut buffer);
        self.inner
            .clone()
            .with_ansi(false)
            .format_event(ctx, buffer_writer, event)?;
        let redacted = redact_text(&buffer);
        writer.write_fmt(format_args!("{redacted}"))
    }
}

static TRACING_INSTALLED: std::sync::OnceLock<()> = std::sync::OnceLock::new();

/// Installs the global subscriber exactly once. Idempotent: repeated calls
/// (e.g. in tests) leave the first installation in place and report false.
pub fn init_tracing(default_level: &str) -> bool {
    if TRACING_INSTALLED.set(()).is_err() {
        return false;
    }
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level));
    let formatter = RedactingFormat {
        inner: Format::default(),
    };
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().event_format(formatter))
        .init();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 49 support] redaction scrubs every credential family we know
    // about from rendered text.
    #[test]
    fn redaction_scrubs_credential_shapes() {
        let scrubbed = redact_text("connecting key=AKIAIOSFODNN7EXAMPLE url=https://x");
        assert!(!scrubbed.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(scrubbed.contains("[REDACTED_AWS_KEY]"));

        let scrubbed = redact_text(
            "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c end",
        );
        assert!(!scrubbed.contains("SflKxwRJSMeK"));
        assert!(scrubbed.contains("[REDACTED_JWT]"));

        let scrubbed =
            redact_text("-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----");
        assert!(!scrubbed.contains("MIIabc"));
        assert!(scrubbed.contains("[REDACTED_KEY_MATERIAL]"));

        for (line, marker_value) in [
            ("api_key: sk_live_51H8xYzabcd", "sk_live_51H8xYzabcd"),
            ("\"authorization\": \"Bearer abc.def\"", "Bearer abc.def"),
            ("password=hunter2,", "hunter2"),
            ("x_api_key = \"topsecretvalue\"", "topsecretvalue"),
        ] {
            let scrubbed = redact_text(line);
            assert!(!scrubbed.contains(marker_value), "leaked in: {scrubbed}");
            assert!(
                scrubbed.contains("[REDACTED]"),
                "missing marker in: {scrubbed}"
            );
        }
    }

    // Benign content is untouched: correlation ids and identifiers survive.
    #[test]
    fn redaction_preserves_benign_identifiers() {
        let line = "intent 9f1c3b2a accepted correlation=corr-29-0001 tenant=tenant-77";
        assert_eq!(redact_text(line), line);
    }

    // The subscriber installs exactly once and never panics on re-init.
    #[test]
    fn tracing_init_is_idempotent() {
        let first = init_tracing("warn");
        let second = init_tracing("info");
        // Exactly one installation wins; neither call panics.
        assert!(!(first && second));
        tracing::info!("gateway tracing installed");
    }
}
