//! Central backpressure policy for market-data and transport channels.
//!
//! States are derived deterministically from observed queue depth:
//! NORMAL -> PRESSURED -> CRITICAL -> BLOCKED. Execution-critical traffic is
//! fail-closed: once pressure reaches CRITICAL, new execution intents are
//! refused (never queued behind an unknown-lag consumer). Non-critical
//! market-data fanout may shed intermediate events under an explicit policy,
//! but every shed is counted and observable.

#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum BackpressureState {
    Normal,
    Pressured,
    Critical,
    Blocked,
}

impl BackpressureState {
    pub fn as_str(self) -> &'static str {
        match self {
            BackpressureState::Normal => "normal",
            BackpressureState::Pressured => "pressured",
            BackpressureState::Critical => "critical",
            BackpressureState::Blocked => "blocked",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BackpressurePolicy {
    /// Depth at which the state becomes PRESSURED (observation only).
    pub pressured_depth: i64,
    /// Depth at which the state becomes CRITICAL: execution-critical
    /// admissions are refused; non-critical shedding may begin.
    pub critical_depth: i64,
    /// Depth at which the state becomes BLOCKED: nothing new is admitted.
    pub blocked_depth: i64,
    /// Whether non-critical market-data events may be shed at CRITICAL.
    /// Execution-critical traffic is NEVER shed regardless of this flag.
    pub allow_noncritical_shedding: bool,
}

impl BackpressurePolicy {
    pub fn validate(&self) -> Result<(), crate::error::GatewayError> {
        if self.pressured_depth <= 0
            || self.critical_depth <= self.pressured_depth
            || self.blocked_depth <= self.critical_depth
        {
            return Err(crate::error::GatewayError::Configuration(
                "backpressure thresholds must satisfy 0 < pressured < critical < blocked"
                    .to_string(),
            ));
        }
        Ok(())
    }
}

impl Default for BackpressurePolicy {
    fn default() -> Self {
        BackpressurePolicy {
            pressured_depth: 1_024,
            critical_depth: 4_096,
            blocked_depth: 8_192,
            allow_noncritical_shedding: true,
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Admission {
    /// Admitted into the bounded channel.
    Admitted,
    /// Rejected under the explicit non-critical shedding policy. The caller
    /// must count this drop (metrics::noncritical_drop_total).
    Shed,
}

/// Deterministically maps queue depth to the pressure state. Same depth in,
/// same state out — always.
pub fn evaluate(policy: &BackpressurePolicy, queue_depth: i64) -> BackpressureState {
    if queue_depth >= policy.blocked_depth {
        BackpressureState::Blocked
    } else if queue_depth >= policy.critical_depth {
        BackpressureState::Critical
    } else if queue_depth >= policy.pressured_depth {
        BackpressureState::Pressured
    } else {
        BackpressureState::Normal
    }
}

/// Decides admission for one item against the current state.
///
/// Execution-critical (`critical = true`): admitted in Normal and Pressured;
/// refused (fail closed) in Critical and Blocked. There is no policy under
/// which a critical item is silently dropped — refusal is an explicit error
/// the caller must turn into a rejected ack.
pub fn admit_critical(
    _policy: &BackpressurePolicy,
    state: BackpressureState,
) -> Result<Admission, crate::error::GatewayError> {
    if state >= BackpressureState::Critical {
        Err(crate::error::GatewayError::BackpressureRefused { state })
    } else {
        Ok(Admission::Admitted)
    }
}

/// Decides admission for one non-critical market-data item. Shedding only
/// happens in Critical and only when the policy explicitly allows it; at
/// BLOCKED nothing is admitted.
pub fn admit_non_critical(
    policy: &BackpressurePolicy,
    state: BackpressureState,
) -> Result<Admission, crate::error::GatewayError> {
    match state {
        BackpressureState::Normal | BackpressureState::Pressured => Ok(Admission::Admitted),
        BackpressureState::Critical => {
            if policy.allow_noncritical_shedding {
                Ok(Admission::Shed)
            } else {
                Err(crate::error::GatewayError::BackpressureRefused { state })
            }
        }
        BackpressureState::Blocked => {
            Err(crate::error::GatewayError::BackpressureRefused { state })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> BackpressurePolicy {
        BackpressurePolicy {
            pressured_depth: 10,
            critical_depth: 20,
            blocked_depth: 30,
            allow_noncritical_shedding: true,
        }
    }

    // [CHECK 17] backpressure state derivation is deterministic.
    #[test]
    fn state_derivation_is_deterministic() {
        let p = policy();
        let cases = [
            (0, BackpressureState::Normal),
            (9, BackpressureState::Normal),
            (10, BackpressureState::Pressured),
            (19, BackpressureState::Pressured),
            (20, BackpressureState::Critical),
            (29, BackpressureState::Critical),
            (30, BackpressureState::Blocked),
            (10_000, BackpressureState::Blocked),
        ];
        for (depth, expected) in cases {
            assert_eq!(evaluate(&p, depth), expected, "depth {depth}");
            // Determinism: same input, same output, repeatedly.
            assert_eq!(evaluate(&p, depth), evaluate(&p, depth));
        }
    }

    // [CHECK 16] execution-critical traffic is never dropped; it fails
    // closed under unsafe pressure.
    #[test]
    fn execution_critical_fails_closed_never_silently_dropped() {
        let p = policy();
        assert!(admit_critical(&p, BackpressureState::Normal).is_ok());
        assert!(admit_critical(&p, BackpressureState::Pressured).is_ok());
        assert!(matches!(
            admit_critical(&p, BackpressureState::Critical),
            Err(crate::error::GatewayError::BackpressureRefused { .. })
        ));
        assert!(matches!(
            admit_critical(&p, BackpressureState::Blocked),
            Err(crate::error::GatewayError::BackpressureRefused { .. })
        ));
        // Shedding semantics cannot apply to critical traffic even if the
        // policy would allow it for non-critical: refused, not shed.
        let admitted = admit_critical(&p, BackpressureState::Normal);
        assert!(matches!(admitted, Ok(Admission::Admitted)));
        assert!(!matches!(admitted, Ok(Admission::Shed)));
    }

    // [CHECK 15] non-critical drop policy is explicit and counted upstream.
    #[test]
    fn non_critical_shedding_is_explicit_and_refused_when_disabled() {
        let mut p = policy();
        assert!(matches!(
            admit_non_critical(&p, BackpressureState::Critical),
            Ok(Admission::Shed)
        ));
        p.allow_noncritical_shedding = false;
        assert!(matches!(
            admit_non_critical(&p, BackpressureState::Critical),
            Err(crate::error::GatewayError::BackpressureRefused { .. })
        ));
        // BLOCKED refuses everything, shedding policy or not.
        p.allow_noncritical_shedding = true;
        assert!(matches!(
            admit_non_critical(&p, BackpressureState::Blocked),
            Err(crate::error::GatewayError::BackpressureRefused { .. })
        ));
        // Normal pressure admits.
        assert!(matches!(
            admit_non_critical(&p, BackpressureState::Normal),
            Ok(Admission::Admitted)
        ));
    }

    #[test]
    fn policy_validation_enforces_threshold_ordering() {
        let ok = policy();
        assert!(ok.validate().is_ok());
        let inverted = BackpressurePolicy {
            pressured_depth: 30,
            critical_depth: 20,
            blocked_depth: 10,
            allow_noncritical_shedding: true,
        };
        assert!(inverted.validate().is_err());
        let zero = BackpressurePolicy {
            pressured_depth: 0,
            critical_depth: 20,
            blocked_depth: 30,
            allow_noncritical_shedding: true,
        };
        assert!(zero.validate().is_err());
    }
}
