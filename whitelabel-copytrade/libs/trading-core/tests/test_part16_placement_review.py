"""Part 16 law tests: the placement review, asserted as a black box.

Nothing here reaches a network, a clock, or a fixture factory. Every test calls
:func:`evaluate_placement_attestation` with an explicit attestation and an
explicit ``now_micros``, which is the shape the law was written for: a review is
a function of its evidence, so the evidence and the moment are both arguments and
a test can pin an answer without freezing or patching anything.

Two kinds of test are deliberate and should not be "cleaned up":

* Several tests assert that something does NOT exist (no policy field, no
  raising path, no default clock). A guard that is only a missing feature looks
  identical to a guard that was never needed until someone adds the feature, and
  a test is the only thing that makes the difference visible in review.
* Boundary tests land on the exact value and the value one past it, because
  every bound in this module is a decision about a failure the operator will
  eventually hit, and "less than" versus "less than or equal" is where those
  decisions are actually made.
"""

from __future__ import annotations

import ast
from dataclasses import fields, replace
from pathlib import Path

import pytest
from wlct_trading.execution.placement_review import (
    ATTESTATION_WIRE_FIELDS,
    MAX_ATTESTATION_AGE_MS,
    MAX_CLOCK_SKEW_MS,
    MAX_KEY_AGE_DAYS,
    MIN_ATTESTATION_AGE_MS,
    NO_KNOWN_WITHDRAWAL_PATH,
    RETRYABLE_REVIEW_CODES,
    REVIEW_CODE_SEVERITY,
    REVIEW_REQUIRED_AT,
    VENUE_TRADING_FIELD,
    VERDICT_CLAIM_WIRE_NAMES,
    PlacementAttestation,
    PlacementFacts,
    PlacementReviewError,
    PlacementReviewPolicy,
    ReviewCode,
    ReviewSeverity,
    attestation_from_payload,
    attestation_to_payload,
    evaluate_placement_attestation,
    severity_of,
)

NOW = 1_700_000_000_000_000
DAY_MICROS = 86_400_000 * 1_000

#: The whole set of "everything the venue checked and permitted" facts. Tests
#: start here and break ONE field, so a failure names the field that caused it
#: rather than the twenty that were missing.
HEALTHY = PlacementFacts(
    venue_backed=True,
    source="binance:apiRestrictions+account+exchangeInfo",
    key_created_at_millis=0,
)


def healthy(**overrides: object) -> PlacementFacts:
    base: dict[str, object] = {
        "venue_backed": True,
        "source": "binance:apiRestrictions+account+exchangeInfo",
        "key_created_at_millis": (NOW - 30 * DAY_MICROS) // 1_000,
        "key_permission_granted": True,
        "withdrawal_permitted": False,
        "read_permitted": True,
        "ip_allowlist_enabled": True,
        "account_can_trade": True,
        "account_type": "SPOT",
        "symbol_attached": True,
        "symbol_trading": True,
        "order_type_supported": True,
        "time_in_force_supported": True,
        "clock_skew_millis": 10,
        "recv_window_millis": 5_000,
        "venue_trading_permitted": True,
        "no_known_withdrawal_path": True,
        "review_required_at_micros": NOW,
    }
    base.update(overrides)
    return replace(HEALTHY, **base)


def attest(facts: PlacementFacts, *, at: int = NOW) -> PlacementAttestation:
    return PlacementAttestation(facts=facts, attested_at_micros=at)


def review(
    facts: PlacementFacts | None,
    *,
    policy: PlacementReviewPolicy | None = None,
    requires: bool = True,
    now: int = NOW,
    at: int = NOW,
):
    attestation = None if facts is None else attest(facts, at=at)
    return evaluate_placement_attestation(
        attestation,
        policy or PlacementReviewPolicy(),
        requires_venue_attestation=requires,
        now_micros=now,
    )


def codes_of(verdict) -> tuple[str, ...]:
    return tuple(finding.code.value for finding in verdict.findings)


# ---------------------------------------------------------------------------
# 1. the module's own purity, checked structurally
# ---------------------------------------------------------------------------


SOURCE = Path(__file__).resolve().parents[1] / "wlct_trading" / "execution" / "placement_review.py"

#: The modules held to the purity law, and the imports each may use.
#:
#: ``live_confirmation`` is scanned in the same breath as ``placement_review``
#: because the review imports its ``ConfirmationState`` enum, and an allowlist that
#: says "any first-party module" would let the law's purity be inherited from
#: whatever that module happens to import next. Pinning the pair, and pinning that
#: the confirmation module does NOT import the review back, is what keeps the one
#: permitted edge from becoming a hole.
PURE_MODULES: dict[str, frozenset[str]] = {
    "placement_review.py": frozenset({"hashlib", "json", "dataclasses", "enum", "typing"}),
    "live_confirmation.py": frozenset(
        {"hashlib", "hmac", "json", "dataclasses", "enum", "typing"}
    ),
}
PERMITTED_FIRST_PARTY: dict[str, frozenset[str]] = {
    "placement_review.py": frozenset({"wlct_trading.execution.live_confirmation"}),
    "live_confirmation.py": frozenset(),
}


def _import_names(source: str) -> tuple[set[str], set[str]]:
    """Return ``(full dotted from-imports, top-level import names)``."""
    dotted: set[str] = set()
    top_level: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                dotted.add(alias.name)
                top_level.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            dotted.add(node.module)
            top_level.add(node.module.split(".")[0])
    return dotted, top_level


class TestPurity:
    def test_the_law_imports_nothing_that_could_lie(self) -> None:
        """No clock, no entropy, no I/O, no await.

        The review's verdict ends up in a durable audit event next to an order
        that was already transmitted. If this module could read a clock itself, a
        replay would not reproduce the verdict - and "re-run the review to see
        what it decided" is the whole reason the digest exists.
        """
        banned = {
            "time",
            "datetime",
            "random",
            "secrets",
            "socket",
            "ssl",
            "http",
            "urllib",
            "os",
            "subprocess",
            "threading",
            "multiprocessing",
            "sqlite3",
            "asyncio",
        }
        for name, allowed in PURE_MODULES.items():
            source = (SOURCE.parent / name).read_text(encoding="utf-8")
            dotted, top_level = _import_names(source)
            unexpected = {
                module
                for module in dotted
                if module.split(".")[0] not in allowed | {"__future__"}
                and module not in PERMITTED_FIRST_PARTY[name]
            }
            assert not unexpected, f"{name} imports {sorted(unexpected)}"
            assert not top_level & banned, f"{name} imports {sorted(top_level & banned)}"

    def test_the_permitted_edge_is_not_a_cycle(self) -> None:
        """``placement_review`` may read the confirmation enum; not the other way.

        One directed edge is a layering. Two is a package that cannot be reasoned
        about in isolation, and the module that ends up unable to be imported alone
        is the one a caller finds out about at runtime.
        """
        review_dotted, _ = _import_names(SOURCE.read_text(encoding="utf-8"))
        confirmation_dotted, _ = _import_names(
            (SOURCE.parent / "live_confirmation.py").read_text(encoding="utf-8")
        )
        assert "wlct_trading.execution.live_confirmation" in review_dotted
        assert not {
            module for module in confirmation_dotted if module.startswith("wlct_trading.")
        }

    def test_no_function_that_needs_now_has_a_default_for_it(self) -> None:
        """``now_micros`` is required everywhere it appears.

        A default of ``epoch_micros()`` would be invisible at every call site and
        is exactly how a "pure" module ends up non-reproducible.
        """
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        offenders: list[str] = []
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            args = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
            defaults = [None] * (len(args) - len(node.args.defaults)) + list(node.args.defaults)
            defaults += list(node.args.kw_defaults)
            for argument, default in zip(args, defaults):
                if argument.arg.endswith(("_micros", "_millis")) and default is not None:
                    offenders.append(f"{node.name}.{argument.arg}")
        assert offenders == []

    def test_the_law_never_awaits_and_never_opens_anything(self) -> None:
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        names = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        assert not names & {"open", "input", "__import__", "eval", "exec"}
        assert not any(isinstance(node, ast.Await) for node in ast.walk(tree))


# ---------------------------------------------------------------------------
# 2. laws 1 and 2: absence, and the refusal to be talked into permitting
# ---------------------------------------------------------------------------


class TestAbsenceAndTightening:
    def test_law_1_no_attestation_is_its_own_code(self) -> None:
        verdict = review(None)
        assert verdict.allowed is False
        assert codes_of(verdict) == ("NO_ATTESTATION",)
        assert verdict.venue_backed is False
        assert verdict.attested_at_micros == 0
        # The message must be actionable, because this is the code a
        # misconfigured runtime produces and the operator has one chance to learn
        # what to wire.
        assert "attestor" in verdict.findings[0].message.lower()

    def test_law_2_a_permissive_looking_policy_cannot_lift_a_withdrawal_capable_key(self) -> None:
        loose = PlacementReviewPolicy(
            max_attestation_age_ms=MAX_ATTESTATION_AGE_MS,
            max_key_age_days=None,
            max_clock_skew_ms=MAX_CLOCK_SKEW_MS,
            require_ip_allowlist=False,
        )
        verdict = review(healthy(withdrawal_permitted=True), policy=loose)
        assert verdict.allowed is False
        assert "WITHDRAW_ENABLED" in verdict.blocking_codes
        assert verdict.retryable is False

    def test_the_policy_has_no_permission_knob_at_all(self) -> None:
        """Every tunable is a duration or a bound; none is a permission.

        Asserted against the field set rather than by review, because the next
        release is the one where someone adds ``allow_withdrawals`` and this is
        where that gets argued about.
        """
        names = {field.name for field in fields(PlacementReviewPolicy)}
        assert names == {
            "max_attestation_age_ms",
            "max_key_age_days",
            "max_clock_skew_ms",
            "recv_window_ms",
            "require_ip_allowlist",
            "require_operator_confirmation",
            "recv_window_headroom_ms",
        }
        assert not any(
            word in name
            for name in names
            for word in ("allow_", "skip_", "bypass", "force", "override")
        )
        # The stronger form of the same law, added in Part 19 when a second boolean
        # appeared: a flag here may only ever REQUIRE something. ``allow_*`` was
        # already unreachable by name, and now any new boolean has to be spelled
        # ``require_*`` - which is not a stylistic rule, it is the one that keeps a
        # reviewer from becoming a waiver desk. A deployment that wants to relax a
        # check must do it by widening a bound, in the open, in a diff.
        for field_obj in fields(PlacementReviewPolicy):
            default = field_obj.default
            if isinstance(default, bool):
                assert field_obj.name.startswith("require_"), (
                    f"{field_obj.name} is a boolean policy field that does not name a "
                    "requirement; every boolean here must only be able to add a refusal"
                )

    def test_a_venue_that_says_no_is_never_reported_as_a_gap_in_our_knowledge(self) -> None:
        refused = review(healthy(key_permission_granted=False))
        unreadable = review(healthy(key_permission_granted=None))
        assert refused.findings[0].code is ReviewCode.NO_SPOT_TRADE_PERMISSION
        assert unreadable.findings[0].code is ReviewCode.NO_SPOT_TRADE_PERMISSION
        # Same code, different message: the audit distinction an operator needs
        # is carried in the text, not invented as a second code that would let a
        # dashboard count "unknown" as if it were a policy violation.
        assert refused.findings[0].message != unreadable.findings[0].message
        assert "may not place spot orders" in refused.findings[0].message
        assert "did not answer" in unreadable.findings[0].message


# ---------------------------------------------------------------------------
# 3. law 3: staleness, with both boundaries
# ---------------------------------------------------------------------------


class TestFreshness:
    def test_an_attestation_exactly_at_the_bound_is_still_fresh(self) -> None:
        policy = PlacementReviewPolicy(max_attestation_age_ms=60_000)
        verdict = review(healthy(), policy=policy, at=NOW - 60_000 * 1_000)
        assert verdict.allowed is True

    def test_one_millisecond_past_the_bound_stales_it(self) -> None:
        policy = PlacementReviewPolicy(max_attestation_age_ms=60_000)
        verdict = review(healthy(), policy=policy, at=NOW - 60_001 * 1_000)
        assert verdict.allowed is False
        assert "STALE_ATTESTATION" in verdict.blocking_codes
        # Retryable, because the cure is a fresher gather and not an operator.
        assert verdict.retryable is True
        # The refusal names the age it measured, so a log line alone separates
        # "the venue is slow" from "the TTL is too short". The wording is in
        # whole seconds while the law is in milliseconds - acceptable only
        # because the payload carries both microsecond timestamps, which the
        # round-trip test below pins; without them a reader could not tell 60.001s
        # from 60.000s and would chase a boundary that was never the problem.
        assert "beyond the policy" in verdict.findings[0].message
        assert verdict.attested_at_micros == NOW - 60_001 * 1_000

    def test_age_is_measured_in_whole_milliseconds(self) -> None:
        # 60_000.001 ms of age is 60_000 ms of age: the sub-millisecond remainder
        # is truncated, not rounded up. Pinned because the alternative - rounding
        # up - makes a TTL of exactly N milliseconds refuse an attestation that a
        # cache with the same TTL still serves, and the two would argue forever.
        policy = PlacementReviewPolicy(max_attestation_age_ms=60_000)
        just_under = review(healthy(), policy=policy, at=NOW - 60_000 * 1_000 - 999)
        assert just_under.allowed is True
        just_over = review(healthy(), policy=policy, at=NOW - 60_001 * 1_000)
        assert just_over.allowed is False

    def test_an_attestation_from_the_future_is_refused(self) -> None:
        verdict = review(healthy(), at=NOW + 5_000_000)
        assert verdict.allowed is False
        assert "FUTURE_ATTESTATION" in verdict.codes
        # A clock that disagrees with the gatherer's invalidates every age
        # judgement in this file, so the refusal says which clock it blamed.
        assert "disagree" in verdict.findings[0].message

    def test_the_freshness_window_cannot_be_tuned_outside_the_sane_range(self) -> None:
        for bad in (MIN_ATTESTATION_AGE_MS - 1, MAX_ATTESTATION_AGE_MS + 1, 0, -5):
            with pytest.raises(PlacementReviewError, match="max_attestation_age_ms"):
                PlacementReviewPolicy(max_attestation_age_ms=bad)
        with pytest.raises(PlacementReviewError, match="max_clock_skew_ms"):
            PlacementReviewPolicy(max_clock_skew_ms=MAX_CLOCK_SKEW_MS + 1)
        with pytest.raises(PlacementReviewError, match="max_clock_skew_ms"):
            PlacementReviewPolicy(max_clock_skew_ms=-1)
        with pytest.raises(PlacementReviewError, match="recv_window_ms"):
            PlacementReviewPolicy(recv_window_ms=60_001)
        with pytest.raises(PlacementReviewError, match="max_key_age_days"):
            PlacementReviewPolicy(max_key_age_days=MAX_KEY_AGE_DAYS + 1)
        # ``None`` for the key bound is legal and means "no rotation opinion".
        assert PlacementReviewPolicy(max_key_age_days=None).max_key_age_days is None

    def test_a_key_age_bound_of_none_records_nothing_at_all(self) -> None:
        verdict = review(
            healthy(key_created_at_millis=(NOW - 400 * DAY_MICROS) // 1_000),
            policy=PlacementReviewPolicy(max_key_age_days=None),
        )
        assert verdict.allowed is True
        assert codes_of(verdict) == ()


# ---------------------------------------------------------------------------
# 4. law 4 and law 5: who may rely on what, and when silence counts
# ---------------------------------------------------------------------------


class TestAttestationProvenance:
    def test_local_facts_may_not_authorise_a_transmitting_runtime(self) -> None:
        verdict = review(healthy(venue_backed=False, source="local:in-process"), requires=True)
        assert verdict.allowed is False
        assert "VENUE_ATTESTATION_REQUIRED" in verdict.blocking_codes

    def test_the_same_facts_on_a_simulated_runtime_are_recorded_not_enforced(self) -> None:
        verdict = review(
            healthy(venue_backed=False, source="paper:in-process"), requires=False
        )
        assert verdict.allowed is True
        assert verdict.codes == ("VENUE_ATTESTATION_REQUIRED",)
        assert verdict.findings[0].severity is ReviewSeverity.INFO
        assert "does not transmit" in verdict.findings[0].message

    def test_law_5_silence_from_a_source_that_could_answer_blocks(self) -> None:
        # A venue-backed attestation that does not say the key cannot withdraw is
        # the one unknown the non-custodial rule will not tolerate...
        verdict = review(healthy(withdrawal_permitted=None))
        assert verdict.allowed is False
        assert "WITHDRAW_ENABLED" in verdict.blocking_codes
        # Meanwhile the same silence from a gatherer that was never able to ask
        # is not a finding at all. Without this half, a paper runtime would refuse
        # every order for facts only a venue can supply.
        paper = review(
            healthy(venue_backed=False, withdrawal_permitted=None, key_created_at_millis=None),
            requires=False,
        )
        assert paper.allowed is True
        assert paper.codes == ("VENUE_ATTESTATION_REQUIRED",)

    def test_venue_only_fields_never_block_a_simulated_runtime(self) -> None:
        hollow = PlacementFacts(venue_backed=False, source="paper:in-process")
        verdict = review(hollow, requires=False)
        assert verdict.allowed is True
        assert [
            finding.code.value for finding in verdict.findings
        ] == ["VENUE_ATTESTATION_REQUIRED"]

    def test_a_venue_backed_attestation_missing_the_creation_time_warns_instead_of_blocking(self) -> None:
        verdict = review(healthy(key_created_at_millis=None))
        assert verdict.allowed is True
        assert verdict.findings[0].code is ReviewCode.KEY_TOO_OLD
        assert verdict.findings[0].severity is ReviewSeverity.WARNING
        assert "Recorded, not enforced" in verdict.findings[0].message

    def test_rotation_is_enforced_when_the_venue_does_report_the_age(self) -> None:
        verdict = review(
            healthy(key_created_at_millis=(NOW - 120 * DAY_MICROS) // 1_000),
            policy=PlacementReviewPolicy(max_key_age_days=90),
        )
        assert verdict.allowed is False
        assert "120 days old" in verdict.findings[0].message


# ---------------------------------------------------------------------------
# 5. entitlements, symbols, and the clock
# ---------------------------------------------------------------------------


class TestEntitlements:
    def test_a_withdrawal_capable_key_is_refused_however_healthy_everything_else_is(self) -> None:
        verdict = review(healthy(withdrawal_permitted=True))
        assert verdict.allowed is False
        assert verdict.codes == ("WITHDRAW_ENABLED",)
        assert verdict.retryable is False

    def test_reading_is_a_warning_because_an_unreadable_key_is_a_data_problem(self) -> None:
        verdict = review(healthy(read_permitted=False))
        assert verdict.allowed is True
        assert verdict.findings[0].code is ReviewCode.NO_READ_PERMISSION
        assert verdict.findings[0].severity is ReviewSeverity.WARNING

    def test_the_ip_allowlist_rule_is_a_policy_choice_with_no_venue_override(self) -> None:
        strict = review(healthy(ip_allowlist_enabled=False))
        assert "IP_ALLOWLIST_REQUIRED" in strict.blocking_codes
        permissive = review(
            healthy(ip_allowlist_enabled=False),
            policy=PlacementReviewPolicy(require_ip_allowlist=False),
        )
        assert permissive.allowed is True
        # Unknown is not "off": a gatherer that could not read the flag is a gap
        # to record, and the venue's own answer is what the rule needs.
        unknown = review(healthy(ip_allowlist_enabled=None))
        assert "IP_ALLOWLIST_REQUIRED" in unknown.blocking_codes

    def test_authority_expiry_is_read_in_milliseconds_and_0_means_never(self) -> None:
        expired = review(healthy(trading_authority_expires_at_millis=NOW // 1_000 - 1))
        assert "TRADING_AUTHORITY_EXPIRED" in expired.blocking_codes
        live = review(healthy(trading_authority_expires_at_millis=NOW // 1_000 + 3_600_000))
        assert live.allowed is True
        # ``None`` (no field, or a venue that reports no expiry) is not "expired
        # in 1970", which is the bug the gatherer's 0-handling also defends.
        never = review(healthy(trading_authority_expires_at_millis=None))
        assert never.allowed is True

    def test_the_account_can_be_open_and_the_key_closed_and_back(self) -> None:
        key_closed = review(healthy(key_permission_granted=False, account_can_trade=True))
        account_closed = review(healthy(key_permission_granted=True, account_can_trade=False))
        assert "NO_SPOT_TRADE_PERMISSION" in key_closed.blocking_codes
        assert "ACCOUNT_TRADING_DISABLED" in account_closed.blocking_codes
        # A non-spot account is a wiring mistake worth seeing, not a refusal: the
        # venue would reject the order anyway, and the finding is the useful part.
        wrong_type = review(healthy(account_type="MARGIN"))
        assert wrong_type.allowed is True
        assert wrong_type.findings[0].code is ReviewCode.ACCOUNT_TYPE_UNEXPECTED
        assert wrong_type.findings[0].severity is ReviewSeverity.WARNING

    def test_symbol_and_shape_findings_are_independent_of_each_other(self) -> None:
        unlisted = review(healthy(symbol_attached=False, symbol_trading=False))
        assert "SYMBOL_UNATTACHED" in unlisted.blocking_codes
        assert "SYMBOL_NOT_TRADING" in unlisted.blocking_codes
        shape = review(healthy(order_type_supported=False, time_in_force_supported=False))
        assert set(shape.blocking_codes) == {"ORDER_TYPE_UNSUPPORTED", "TIF_UNSUPPORTED"}
        assert review(healthy(order_type_supported=None, time_in_force_supported=None)).allowed

    def test_clock_findings_distinguish_unmeasured_from_too_far_off(self) -> None:
        unsynchronised = review(healthy(clock_skew_millis=None))
        assert unsynchronised.allowed is False
        assert "CLOCK_UNSYNCHRONISED" in unsynchronised.blocking_codes
        # Retryable: an unmeasured clock is a gatherer that has not looked yet,
        # which the next order can fix on its own.
        assert unsynchronised.retryable is True
        skewed = review(
            healthy(clock_skew_millis=4_000),
            policy=PlacementReviewPolicy(max_clock_skew_ms=1_000),
        )
        assert "CLOCK_SKEW_EXCEEDED" in skewed.blocking_codes
        # A simulated runtime cannot be blamed for an unmeasured clock: nothing
        # it signs needs a signature.
        paper = review(
            healthy(venue_backed=False, clock_skew_millis=None), requires=False
        )
        assert "CLOCK_UNSYNCHRONISED" not in paper.codes

    def test_the_receive_window_is_judged_against_the_attested_window_when_there_is_one(self) -> None:
        policy = PlacementReviewPolicy(max_clock_skew_ms=1_000, recv_window_ms=5_000)
        tight = review(healthy(recv_window_millis=1_500, clock_skew_millis=1_000), policy=policy)
        assert "RECV_WINDOW_INSUFFICIENT" in tight.blocking_codes
        roomy = review(healthy(recv_window_millis=5_000, clock_skew_millis=1_000), policy=policy)
        assert roomy.allowed is True
        # With no attested window the policy's is used, and the message says
        # which of the two it reached for.
        unattested = review(
            healthy(recv_window_millis=None, clock_skew_millis=4_500), policy=policy
        )
        assert "RECV_WINDOW_INSUFFICIENT" in unattested.blocking_codes
        assert "the policy's window" in unattested.findings[-1].message


# ---------------------------------------------------------------------------
# 6. law 6: ordering, digest, retryability, and the audit encoding
# ---------------------------------------------------------------------------


class TestVerdictShape:
    def test_everything_wrong_produces_every_finding_in_one_pass(self) -> None:
        """The "show me all of it" property the gates are documented for.

        Order matters as much as completeness: severity, then code, then field,
        so two runs of the same evidence produce the same list and a digest that
        can be compared across processes.
        """
        verdict = review(
            healthy(
                key_permission_granted=False,
                withdrawal_permitted=True,
                read_permitted=False,
                ip_allowlist_enabled=False,
                account_can_trade=False,
                account_type="MARGIN",
                symbol_attached=False,
                order_type_supported=False,
                time_in_force_supported=False,
                clock_skew_millis=None,
                recv_window_millis=None,
                key_created_at_millis=(NOW - 400 * DAY_MICROS) // 1_000,
            ),
            policy=PlacementReviewPolicy(max_key_age_days=90),
        )
        assert verdict.allowed is False
        # Severity first with BLOCKING at the front (the enum's own order is the
        # opposite, which is why this ranks explicitly rather than trusting it),
        # then code, then field. An operator reading two runs of the same evidence
        # must see the same order, and a digest over a shuffled list would be a
        # different verdict id for identical facts.
        rank = {
            ReviewSeverity.BLOCKING: 0,
            ReviewSeverity.WARNING: 1,
            ReviewSeverity.INFO: 2,
        }
        keyed = [(rank[f.severity], f.code.value, f.field_name or "") for f in verdict.findings]
        assert keyed == sorted(keyed)
        assert verdict.findings[0].severity is ReviewSeverity.BLOCKING
        assert len(verdict.findings) == len({(f.code, f.field_name) for f in verdict.findings})
        assert verdict.blocking_findings[0].severity is ReviewSeverity.BLOCKING
        assert "NO_SPOT_TRADE_PERMISSION" in verdict.blocking_codes

    def test_the_digest_is_the_evidence_not_the_moment_or_the_order(self) -> None:
        facts = healthy()
        first = review(facts, now=NOW)
        second = review(facts, now=NOW + 1_000_000)
        assert first.verdict_id == second.verdict_id
        assert first.allowed and second.allowed
        # Different evidence, different id - and a one-bit change in an
        # entitlement moves it, so "same verdict as last time" is a real claim.
        other = review(healthy(account_type="SPOT"), now=NOW)
        assert other.verdict_id == first.verdict_id
        changed = review(healthy(account_type="MARGIN"), now=NOW)
        assert changed.verdict_id != first.verdict_id
        assert len(first.verdict_id) == 16

    def test_the_runtime_mode_is_part_of_the_digest(self) -> None:
        facts = healthy(venue_backed=False)
        live = review(facts, requires=True)
        paper = review(facts, requires=False)
        assert live.verdict_id != paper.verdict_id

    def test_retryability_is_read_from_the_blocking_findings_only(self) -> None:
        rate_limited = evaluate_placement_attestation(
            PlacementAttestation.unavailable(
                now_micros=NOW,
                code=ReviewCode.ATTESTATION_RATE_LIMITED,
                detail="429 from the venue",
                source="binance:apiRestrictions",
            ),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
            now_micros=NOW,
        )
        assert rate_limited.allowed is False
        assert rate_limited.retryable is True
        assert rate_limited.findings[0].severity is ReviewSeverity.BLOCKING
        # A refusal with no blocking finding cannot exist; ``retryable`` is never
        # a synonym for ``allowed``, which is how a caller ends up retrying
        # forever on a verdict that will not change.
        allowed = review(healthy())
        assert allowed.allowed is True and allowed.retryable is False

    def test_the_summary_names_the_first_refusal(self) -> None:
        refused = review(healthy(withdrawal_permitted=True))
        assert refused.summary.startswith("Placement refused: WITHDRAW_ENABLED")
        assert "Placement authorised" in review(healthy()).summary

    def test_findings_render_as_a_stable_dict(self) -> None:
        finding = review(healthy(withdrawal_permitted=True)).findings[0]
        assert finding.to_dict() == {
            "code": "WITHDRAW_ENABLED",
            "severity": "BLOCKING",
            "message": finding.message,
            "field": "withdrawalPermitted",
        }

    def test_the_event_payload_is_strings_only_and_round_trips_its_claims(self) -> None:
        verdict = review(healthy())
        payload = verdict.to_event_payload()
        assert set(payload) == {
            "verdictId",
            "allowed",
            "venueBacked",
            "codes",
            "blockingCodes",
            "retryable",
            "attestedAtMicros",
            *VERDICT_CLAIM_WIRE_NAMES.values(),
        }
        assert all(isinstance(value, str) for value in payload.values())
        # ``str(True)`` is "True"; a payload that spells yes two ways is one a
        # consumer will read as no. This is the assertion that caught it.
        assert "True" not in "".join(payload.values())
        assert payload["venueTradingPermitted"] == "true"
        assert payload["noKnownWithdrawalPath"] == "true"

    def test_the_wire_names_are_the_verdicts_own_fields(self) -> None:
        """The mapping between audit key and attribute, pinned both directions.

        ``to_event_payload`` reads these names off the verdict with ``getattr``,
        so a rename on either side would otherwise be an AttributeError inside the
        submission path - on the one code path that runs while an order is being
        released.
        """
        verdict = review(healthy())
        for field_name in VERDICT_CLAIM_WIRE_NAMES:
            assert hasattr(verdict, field_name), field_name
            assert field_name in {f.name for f in fields(PlacementFacts)}, field_name
        assert REVIEW_REQUIRED_AT == "review_required_at_micros"
        assert VENUE_TRADING_FIELD == "venue_trading_permitted"
        assert NO_KNOWN_WITHDRAWAL_PATH == "no_known_withdrawal_path"

    def test_the_attestation_payload_round_trips_and_refuses_invention(self) -> None:
        facts = healthy()
        original = attest(facts)
        payload = attestation_to_payload(original)
        assert payload["attestedAtMicros"] == NOW
        restored = attestation_from_payload(payload)
        assert restored.facts.venue_backed is True
        assert restored.facts.withdrawal_permitted is False
        assert restored.attested_at_micros == NOW
        assert restored.facts.source == facts.source
        assert set(ATTESTATION_WIRE_FIELDS) <= set(payload)

        for poison in (
            # A string where a bool belongs, and a bool where an int belongs:
            # ``True`` is ``1`` to Python, so an untyped replay could otherwise
            # turn "no withdrawal path is known" into a timestamp.
            {**payload, "withdrawalPermitted": "true"},
            {**payload, "keyCreatedAtMillis": True},
            {**payload, "invented": "yes"},
        ):
            with pytest.raises(PlacementReviewError):
                attestation_from_payload(poison)
        # A field may be absent only if it is explicitly nullable; the timestamp
        # the whole staleness law depends on is not one of them.
        missing = dict(payload)
        missing.pop("attestedAtMicros")
        with pytest.raises(PlacementReviewError, match="attestedAtMicros"):
            attestation_from_payload(missing)
        with pytest.raises(PlacementReviewError):
            attestation_from_payload({})
        # And the empty payload is not "an attestation of nothing", which would
        # read as a review with no objections.
        assert attestation_to_payload(
            PlacementAttestation.unavailable(
                now_micros=NOW,
                code=ReviewCode.NO_ATTESTATION,
                detail="no attestor is wired",
                source="none",
            )
        )["collectionCode"] == "NO_ATTESTATION"


# ---------------------------------------------------------------------------
# 7. the vocabulary is closed, and complete
# ---------------------------------------------------------------------------


class TestVocabulary:
    def test_every_code_has_a_severity_because_the_default_is_to_block(self) -> None:
        assert set(REVIEW_CODE_SEVERITY) == set(ReviewCode)
        for code in ReviewCode:
            assert severity_of(code) is REVIEW_CODE_SEVERITY[code]
        # ``severity_of`` answers BLOCKING for anything absent from the table, so
        # the day someone adds a code and forgets to classify it the review
        # refuses rather than waves through - which is why coverage of every
        # member, asserted above, is the security property and not bookkeeping.
        assert all(
            severity_of(code) is not None for code in ReviewCode
        )

    def test_retryable_codes_are_all_real_codes_and_the_operator_ones_are_not(self) -> None:
        assert RETRYABLE_REVIEW_CODES <= set(ReviewCode)
        for code in RETRYABLE_REVIEW_CODES:
            assert code.value.startswith(("ATTESTATION_", "STALE_")) or code in {
                ReviewCode.CLOCK_UNSYNCHRONISED,
                ReviewCode.MALFORMED_VENUE_RESPONSE,
            }
        # These need a human at the venue; a worker that retried them would be
        # re-asking a question whose answer only an operator can change.
        assert ReviewCode.ATTESTATION_REFUSED_BY_VENUE not in RETRYABLE_REVIEW_CODES
        assert ReviewCode.WITHDRAW_ENABLED not in RETRYABLE_REVIEW_CODES
        assert ReviewCode.NO_SPOT_TRADE_PERMISSION not in RETRYABLE_REVIEW_CODES
        # Part 19's confirmation refusals join the list on the same argument, and
        # the expiry among them most of all: it is the one a loop would eventually
        # "fix" by re-running the review after the window happened to roll, which is
        # not a retry succeeding, it is a control lapsing into a cache.
        for code in (
            ReviewCode.OPERATOR_CONFIRMATION_ABSENT,
            ReviewCode.OPERATOR_CONFIRMATION_EXPIRED,
            ReviewCode.OPERATOR_CONFIRMATION_NOT_YET_VALID,
            ReviewCode.OPERATOR_CONFIRMATION_SCOPE_MISMATCH,
            ReviewCode.OPERATOR_CONFIRMATION_UNVERIFIED,
        ):
            assert code not in RETRYABLE_REVIEW_CODES

    def test_codes_are_their_own_values_so_the_wire_spelling_is_stable(self) -> None:
        for code in ReviewCode:
            assert code.value == code.name

    def test_the_public_dict_of_a_policy_is_secret_free_and_total(self) -> None:
        view = PlacementReviewPolicy().to_public_dict()
        assert set(view) == {
            "maxAttestationAgeMillis",
            "maxKeyAgeDays",
            "maxClockSkewMillis",
            "recvWindowMillis",
            "requireIpAllowlist",
            "requireOperatorConfirmation",
            "recvWindowHeadroomMillis",
        }
