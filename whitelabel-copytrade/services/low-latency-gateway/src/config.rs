//! Strict configuration loading with fail-closed defaults.
//!
//! Rules enforced here:
//! - required settings missing at boot abort startup with ALL problems
//!   listed (no partial boot, no silent defaults for safety-critical knobs);
//! - the intent HMAC key is a SECRET: it is held in memory only, is never
//!   logged, never rendered by `describe()` and never appears in metrics;
//! - environment separation: staging/production refuse to boot without a
//!   signing key and refuse loopback-only execution binds? No — the gateway
//!   is internal-only, so loopback binding is legitimate everywhere; what
//!   production refuses is an absent key.
//! - the loader reads through an injectable reader so deterministic tests
//!   never mutate process-global environment state.

use std::collections::BTreeMap;
use std::fmt;
use std::net::SocketAddr;
use std::time::Duration;

use crate::backpressure::BackpressurePolicy;
use crate::error::GatewayError;
use crate::types::{Symbol, Venue};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Environment {
    Development,
    Staging,
    Production,
}

impl Environment {
    pub fn parse(raw: &str) -> Result<Environment, GatewayError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "development" | "dev" => Ok(Environment::Development),
            "staging" => Ok(Environment::Staging),
            "production" | "prod" => Ok(Environment::Production),
            other => Err(GatewayError::Configuration(format!(
                "unknown environment '{other}' (expected development|staging|production)"
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Environment::Development => "development",
            Environment::Staging => "staging",
            Environment::Production => "production",
        }
    }
}

#[derive(Clone, Debug)]
pub struct VenueConfig {
    pub venue: Venue,
    pub symbols: Vec<Symbol>,
    /// Optional explicit wss base override (self-hosted proxy scenarios).
    pub ws_base_override: Option<url::Url>,
}

pub struct GatewayConfig {
    pub environment: Environment,
    pub health_bind: SocketAddr,
    pub transport_bind: SocketAddr,
    pub venues: Vec<VenueConfig>,
    pub ring_capacity: usize,
    pub backpressure: BackpressurePolicy,
    /// Internal execution-engine base URL (the existing Python service).
    pub execution_engine_base_url: url::Url,
    /// Key identifier announced in envelopes (not secret).
    pub intent_hmac_key_id: String,
    /// THE secret. Held here only; never logged, never rendered, never in
    /// metrics. Resolved from the platform's secret injection at boot.
    intent_hmac_key: Vec<u8>,
    /// Reject intents expiring within this margin to avoid transporting
    /// something that dies in-flight.
    pub intent_expiry_margin_ms: i64,
    pub shutdown_drain: Duration,
    pub max_intent_frame_bytes: usize,
    pub intent_replay_cache_capacity: usize,
}

/// The injectable environment reader (keeps tests deterministic).
pub trait EnvReader {
    fn get(&self, key: &str) -> Option<String>;
}

pub struct ProcessEnv;

impl EnvReader for ProcessEnv {
    fn get(&self, key: &str) -> Option<String> {
        std::env::var(key).ok().filter(|v| !v.trim().is_empty())
    }
}

pub struct MapEnv {
    map: BTreeMap<String, String>,
}

impl MapEnv {
    pub fn from_pairs(pairs: &[(&str, &str)]) -> MapEnv {
        MapEnv {
            map: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }
}

impl EnvReader for MapEnv {
    fn get(&self, key: &str) -> Option<String> {
        self.map.get(key).cloned()
    }
}

impl GatewayConfig {
    /// Loads configuration strictly. Every problem is collected and reported
    /// together; any problem aborts the boot (fail closed).
    pub fn load(reader: &dyn EnvReader) -> Result<GatewayConfig, GatewayError> {
        let mut problems: Vec<String> = Vec::new();

        let environment = match reader.get("LLE_ENVIRONMENT") {
            Some(raw) => match Environment::parse(&raw) {
                Ok(env) => env,
                Err(e) => {
                    problems.push(format!("LLE_ENVIRONMENT: {e}"));
                    Environment::Development
                }
            },
            None => Environment::Development,
        };

        let mut health_bind: Option<SocketAddr> = None;
        let mut transport_bind: Option<SocketAddr> = None;
        for (key, slot) in [
            ("LLE_HEALTH_BIND", &mut health_bind),
            ("LLE_TRANSPORT_BIND", &mut transport_bind),
        ] {
            match reader.get(key) {
                Some(v) => match v.parse::<SocketAddr>() {
                    Ok(addr) => *slot = Some(addr),
                    Err(e) => problems.push(format!("{key}: invalid socket address: {e}")),
                },
                None => problems.push(format!("{key} is required")),
            }
        }

        let execution_engine_base_url = match reader.get("LLE_EXECUTION_ENGINE_URL") {
            Some(raw) => match url::Url::parse(&raw) {
                Ok(u) if u.scheme() == "http" || u.scheme() == "https" => Some(u),
                Ok(u) => {
                    problems.push(format!(
                        "LLE_EXECUTION_ENGINE_URL: unsupported scheme '{u}'"
                    ));
                    None
                }
                Err(e) => {
                    problems.push(format!("LLE_EXECUTION_ENGINE_URL: {e}"));
                    None
                }
            },
            None => {
                problems.push("LLE_EXECUTION_ENGINE_URL is required".to_string());
                None
            }
        };

        let intent_hmac_key_id = match reader.get("LLE_INTENT_HMAC_KEY_ID") {
            Some(v) => Some(v),
            None => {
                problems.push("LLE_INTENT_HMAC_KEY_ID is required".to_string());
                None
            }
        };
        let intent_hmac_key = match reader.get("LLE_INTENT_HMAC_KEY") {
            Some(v) if v.len() < 16 => {
                problems.push("LLE_INTENT_HMAC_KEY: too short (minimum 16 bytes)".to_string());
                None
            }
            Some(v) => Some(v.into_bytes()),
            None => {
                problems.push("LLE_INTENT_HMAC_KEY is required".to_string());
                None
            }
        };

        // Venue subscriptions: enabled venues must declare symbols.
        let mut venues: Vec<VenueConfig> = Vec::new();
        if let Some(venue_list) = reader.get("LLE_VENUES") {
            for name in venue_list
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                let venue = match Venue::parse(name) {
                    Some(v) => v,
                    None => {
                        problems.push(format!("LLE_VENUES: unknown venue '{name}'"));
                        continue;
                    }
                };
                let symbols_key = format!("LLE_{}_SYMBOLS", venue.as_str().to_ascii_uppercase());
                let symbols = match reader.get(&symbols_key) {
                    Some(list) => {
                        let mut parsed = Vec::new();
                        for sym in list.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                            match Symbol::new(sym) {
                                Ok(s) => parsed.push(s),
                                Err(e) => problems.push(format!("{symbols_key}: {e}")),
                            }
                        }
                        parsed
                    }
                    None => {
                        problems.push(format!("{symbols_key} is required when {venue} is enabled"));
                        Vec::new()
                    }
                };
                if !symbols.is_empty() {
                    let ws_base_override = reader
                        .get(&format!(
                            "LLE_WS_BASE_{}",
                            venue.as_str().to_ascii_uppercase()
                        ))
                        .and_then(|raw| match url::Url::parse(&raw) {
                            Ok(u) if u.scheme() == "wss" || u.scheme() == "ws" => Some(u),
                            Ok(u) => {
                                problems
                                    .push(format!("LLE_WS_BASE_{venue}: unsupported scheme '{u}'"));
                                None
                            }
                            Err(e) => {
                                problems.push(format!("LLE_WS_BASE_{venue}: {e}"));
                                None
                            }
                        });
                    venues.push(VenueConfig {
                        venue,
                        symbols,
                        ws_base_override,
                    });
                }
            }
        } else {
            problems.push("LLE_VENUES is required (comma-separated venue names)".to_string());
        }
        venues.sort_by_key(|v| v.venue);

        let ring_capacity = parse_usize(reader, "LLE_RING_CAPACITY", 8_192, &mut problems)
            .map(|v| v.clamp(64, 1 << 22))
            .unwrap_or(8_192);
        let pressured = parse_i64(reader, "LLE_BP_PRESSURED", 1_024, &mut problems);
        let critical = parse_i64(reader, "LLE_BP_CRITICAL", 4_096, &mut problems);
        let blocked = parse_i64(reader, "LLE_BP_BLOCKED", 8_192, &mut problems);
        let shedding = reader
            .get("LLE_BP_SHED_NONCRITICAL")
            .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "false" | "0" | "no"))
            .unwrap_or(true);
        let backpressure = BackpressurePolicy {
            pressured_depth: pressured,
            critical_depth: critical,
            blocked_depth: blocked,
            allow_noncritical_shedding: shedding,
        };
        if let Err(e) = backpressure.validate() {
            problems.push(e.to_string());
        }

        let intent_expiry_margin_ms =
            parse_i64(reader, "LLE_INTENT_TTL_MARGIN_MS", 250, &mut problems);
        let drain_ms =
            parse_i64(reader, "LLE_SHUTDOWN_DRAIN_MS", 3_000, &mut problems).max(100) as u64;
        let max_intent_frame_bytes = parse_usize(
            reader,
            "LLE_INTENT_MAX_FRAME_BYTES",
            crate::types::MAX_INTENT_FRAME_BYTES,
            &mut problems,
        )
        .map(|v| v.clamp(1024, crate::types::MAX_INTENT_FRAME_BYTES))
        .unwrap_or(crate::types::MAX_INTENT_FRAME_BYTES);
        let intent_replay_cache_capacity =
            parse_usize(reader, "LLE_INTENT_REPLAY_CACHE", 10_000, &mut problems)
                .map(|v| v.clamp(16, 1_000_000))
                .unwrap_or(10_000);

        if !problems.is_empty() {
            return Err(GatewayError::Configuration(format!(
                "configuration failed with {} problem(s): {}",
                problems.len(),
                problems.join("; ")
            )));
        }

        Ok(GatewayConfig {
            environment,
            health_bind: health_bind.expect("validated"),
            transport_bind: transport_bind.expect("validated"),
            venues,
            ring_capacity,
            backpressure,
            execution_engine_base_url: execution_engine_base_url.expect("validated"),
            intent_hmac_key_id: intent_hmac_key_id.expect("validated"),
            intent_hmac_key: intent_hmac_key.expect("validated"),
            intent_expiry_margin_ms,
            shutdown_drain: Duration::from_millis(drain_ms),
            max_intent_frame_bytes,
            intent_replay_cache_capacity,
        })
    }

    pub fn load_from_env() -> Result<GatewayConfig, GatewayError> {
        Self::load(&ProcessEnv)
    }

    /// The intent signing key. Access is deliberate and centralized; callers
    /// can use it but can never print it (no Debug/Display exposure below).
    pub fn intent_hmac_key(&self) -> &[u8] {
        &self.intent_hmac_key
    }

    /// Safe, redacted human-readable summary for logs and health output.
    /// The secret appears only as its length; there is no code path that can
    /// render the key itself.
    pub fn describe(&self) -> String {
        let venues = self
            .venues
            .iter()
            .map(|v| {
                format!(
                    "{}:{} symbol(s){}",
                    v.venue,
                    v.symbols.len(),
                    if v.ws_base_override.is_some() {
                        " (base override)"
                    } else {
                        ""
                    }
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "environment={} health_bind={} transport_bind={} venues=[{}] ring_capacity={} bp(pressured={}, critical={}, blocked={}, shedding={}) engine_url={} key_id={} key=<redacted len={}> ttl_margin_ms={} drain_ms={} max_intent_bytes={} replay_cache={}",
            self.environment.as_str(),
            self.health_bind,
            self.transport_bind,
            venues,
            self.ring_capacity,
            self.backpressure.pressured_depth,
            self.backpressure.critical_depth,
            self.backpressure.blocked_depth,
            self.backpressure.allow_noncritical_shedding,
            self.execution_engine_base_url,
            self.intent_hmac_key_id,
            self.intent_hmac_key.len(),
            self.intent_expiry_margin_ms,
            self.shutdown_drain.as_millis(),
            self.max_intent_frame_bytes,
            self.intent_replay_cache_capacity,
        )
    }
}

/// Debug is implemented manually so an accidental `{:?}` of the config can
/// never print the signing key.
impl fmt::Debug for GatewayConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "GatewayConfig({})", self.describe())
    }
}

fn parse_i64(reader: &dyn EnvReader, key: &str, default: i64, problems: &mut Vec<String>) -> i64 {
    match reader.get(key) {
        None => default,
        Some(raw) => match raw.trim().parse::<i64>() {
            Ok(v) => v,
            Err(e) => {
                problems.push(format!("{key}: expected integer: {e}"));
                default
            }
        },
    }
}

fn parse_usize(
    reader: &dyn EnvReader,
    key: &str,
    default: usize,
    problems: &mut Vec<String>,
) -> Option<usize> {
    match reader.get(key) {
        None => Some(default),
        Some(raw) => match raw.trim().parse::<usize>() {
            Ok(v) => Some(v),
            Err(e) => {
                problems.push(format!("{key}: expected non-negative integer: {e}"));
                None
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "0123456789abcdef0123456789abcdef";

    fn full_env() -> MapEnv {
        MapEnv::from_pairs(&[
            ("LLE_ENVIRONMENT", "production"),
            ("LLE_HEALTH_BIND", "127.0.0.1:9100"),
            ("LLE_TRANSPORT_BIND", "127.0.0.1:9101"),
            ("LLE_EXECUTION_ENGINE_URL", "http://127.0.0.1:8200"),
            ("LLE_INTENT_HMAC_KEY_ID", "exec-engine-2026-09"),
            ("LLE_INTENT_HMAC_KEY", KEY),
            ("LLE_VENUES", "binance,okx"),
            ("LLE_BINANCE_SYMBOLS", "BTCUSDT,ETHUSDT"),
            ("LLE_OKX_SYMBOLS", "BTC-USDT"),
        ])
    }

    // [CHECK 1] configuration validation: a full valid environment loads.
    #[test]
    fn valid_configuration_loads() {
        let cfg = GatewayConfig::load(&full_env()).expect("valid config");
        assert_eq!(cfg.environment, Environment::Production);
        assert_eq!(cfg.venues.len(), 2);
        assert_eq!(cfg.venues[0].venue, Venue::Binance);
        assert_eq!(cfg.venues[0].symbols.len(), 2);
        assert_eq!(cfg.backpressure.critical_depth, 4_096);
        assert_eq!(cfg.intent_hmac_key(), KEY.as_bytes());
    }

    // [CHECK 2] missing configuration fails closed, listing every problem.
    #[test]
    fn missing_configuration_fails_closed_listing_all_problems() {
        let empty = MapEnv::from_pairs(&[]);
        let err = GatewayConfig::load(&empty).expect_err("must fail");
        let text = err.to_string();
        for required in [
            "LLE_HEALTH_BIND",
            "LLE_TRANSPORT_BIND",
            "LLE_EXECUTION_ENGINE_URL",
            "LLE_INTENT_HMAC_KEY_ID",
            "LLE_INTENT_HMAC_KEY",
            "LLE_VENUES",
        ] {
            assert!(
                text.contains(required),
                "missing problem not listed: {required} in {text}"
            );
        }
        // A partially-specified environment also fails (no silent defaults
        // for security-critical knobs).
        let partial = MapEnv::from_pairs(&[
            ("LLE_HEALTH_BIND", "127.0.0.1:9100"),
            ("LLE_VENUES", "binance"),
            ("LLE_INTENT_HMAC_KEY", KEY),
        ]);
        assert!(GatewayConfig::load(&partial).is_err());
    }

    // [CHECK 3] secrets never shown: describe() and Debug() redact the key.
    #[test]
    fn describe_and_debug_never_contain_the_secret() {
        let cfg = GatewayConfig::load(&full_env()).expect("valid config");
        let described = cfg.describe();
        assert!(!described.contains(KEY));
        assert!(described.contains("key=<redacted len=32>"));
        let debugged = format!("{cfg:?}");
        assert!(!debugged.contains(KEY));
    }

    #[test]
    fn invalid_values_fail_closed_with_context() {
        let env = MapEnv::from_pairs(&[
            ("LLE_ENVIRONMENT", "moon"),
            ("LLE_HEALTH_BIND", "not-an-address"),
            ("LLE_TRANSPORT_BIND", "127.0.0.1:9101"),
            ("LLE_EXECUTION_ENGINE_URL", "ftp://nope"),
            ("LLE_INTENT_HMAC_KEY_ID", "k"),
            ("LLE_INTENT_HMAC_KEY", "short"),
            ("LLE_VENUES", "binance,kraken"),
            ("LLE_BINANCE_SYMBOLS", "btc usdt"),
            ("LLE_BP_PRESSURED", "50"),
            ("LLE_BP_CRITICAL", "40"),
        ]);
        let err = GatewayConfig::load(&env).expect_err("invalid");
        let text = err.to_string();
        assert!(text.contains("LLE_ENVIRONMENT"));
        assert!(text.contains("LLE_HEALTH_BIND"));
        assert!(text.contains("kraken"));
        assert!(text.contains("LLE_BINANCE_SYMBOLS"));
        assert!(text.contains("pressured"));
    }
}
