"""Part 19, core: the operator's live confirmation.

Every test here is about a *record* - what it takes to construct one, what makes it
verifiable, and what the assessment is allowed to say about it - because the whole
point of the type is that the deployment's decision now has a shape, and a shape can
be tested for every state it can be in. The states are enumerated in
:class:`ConfirmationState`, and this file walks them in the order the verifier decides
them, so a re-ordering of that logic (verifying after checking expiry, say) shows up
here rather than as a subtle weakening nobody notices.

Determinism: nothing in this file freezes a clock or patches a random source. Every
timestamp is an argument, and the "now" the assessment uses is passed in, so each
case is a fact about the module rather than a race with the machine.
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import hmac
import json
from typing import Any, Final

import pytest

from wlct_trading.execution.live_confirmation import (
    FINGERPRINT_LENGTH,
    MAX_CONFIRMATION_WINDOW_MS,
    MIN_NONCE_LENGTH,
    SCOPE_UNBOUNDED,
    ConfirmationOutcome,
    ConfirmationState,
    ConfirmationVerifier,
    LiveConfirmationError,
    LiveOperatorConfirmation,
    canonical_confirmation_json,
    compute_digest,
)
from wlct_trading.execution.placement_attestor import (
    PlacementReviewer,
    PlacementReviewRequest,
    UnattestedPlacementAttestor,
)
from wlct_trading.execution.placement_review import (
    MAX_CONFIRMATION_DETAIL_LENGTH,
    PlacementReviewError,
    PlacementReviewPolicy,
)

#: Not a secret and not meant to be: a key this file can compute a signature with,
#: because that is the capability under test. The real one is env-only.
KEY: Final[str] = "part19-test-confirmation-key-0123456789abcdef"
ISSUED: Final[int] = 1_700_000_000_000_000
ONE_DAY: Final[int] = 86_400_000_000
NOW: Final[int] = ISSUED + ONE_DAY


def record(
    *,
    instance: str = "exec-1",
    tenant: str = "tenant-a",
    account: str = "acct-1",
    exchange: str = "BINANCE",
    symbols: frozenset[str] = frozenset({"BTCUSDT", "ETHUSDT"}),
    order_types: frozenset[str] = frozenset({"LIMIT"}),
    expires: int = ISSUED + 7 * ONE_DAY,
    nonce: str = "0f1e2d3c4b5a6978",
    key: str = KEY,
    sign: bool = True,
) -> LiveOperatorConfirmation:
    """A well-formed record, signed by default.

    Signed by default because the interesting cases are the ones where a *valid*
    record then fails some other check; a test that had to pass ``sign=False`` to
    reach the scope logic would be testing the digest path by accident.
    """
    unsigned = LiveOperatorConfirmation(
        instance_id=instance,
        tenant_id=tenant,
        account_id=account,
        exchange=exchange,
        symbols=symbols,
        order_types=order_types,
        issued_at_micros=ISSUED,
        expires_at_micros=expires,
        nonce=nonce,
    )
    return unsigned if not sign else unsigned.with_digest(key)


def verifier(
    rec: LiveOperatorConfirmation | None,
    *,
    key: str = KEY,
    required: bool = True,
    instance: str = "exec-1",
    exchange: str = "BINANCE",
) -> ConfirmationVerifier:
    # ``None`` is passed through rather than replaced by a fresh record: "no
    # confirmation supplied" is one of the states under test, and a helper that
    # quietly minted one for that case would make the ABSENT tests assert on a
    # different object than their names claim.
    return ConfirmationVerifier(
        record=rec,
        key=key,
        instance_id=instance,
        exchange=exchange,
        required=required,
    )


def assess(
    rec: LiveOperatorConfirmation | None,
    *,
    symbol: str = "BTCUSDT",
    order_type: str = "LIMIT",
    tenant: str = "tenant-a",
    account: str = "acct-1",
    now: int = NOW,
    key: str = KEY,
    required: bool = True,
    instance: str = "exec-1",
    exchange: str = "BINANCE",
) -> ConfirmationOutcome:
    return verifier(
        rec,
        key=key,
        required=required,
        instance=instance,
        exchange=exchange,
    ).assess(
        tenant_id=tenant,
        account_id=account,
        symbol=symbol,
        order_type=order_type,
        now_micros=now,
    )


# ---------------------------------------------------------------------------
# 1. construction: what a record is allowed to be
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_a_record_refuses_every_blank_identity(self) -> None:
        for name in ("instance_id", "tenant_id", "account_id", "exchange"):
            # ``Any`` because the field being replaced is one of three types and the
            # loop's point is that the refusal is per field: a narrower annotation here
            # would state that the constructor only ever receives legal input, which is
            # the opposite of what the test is doing. No suppression token is used, so
            # the claim is carried by the annotation rather than by a comment.
            blank: dict[str, Any] = {
                "instance_id": "i",
                "tenant_id": "t",
                "account_id": "a",
                "exchange": "BINANCE",
                "issued_at_micros": ISSUED,
                "expires_at_micros": NOW,
                "nonce": "0" * MIN_NONCE_LENGTH,
            }
            blank[name] = "   "
            with pytest.raises(LiveConfirmationError, match=name):
                LiveOperatorConfirmation(**blank)

    def test_an_expiry_before_the_issue_time_is_refused_not_inverted(self) -> None:
        with pytest.raises(LiveConfirmationError, match="ends before it begins"):
            LiveOperatorConfirmation(
                instance_id="i",
                tenant_id="t",
                account_id="a",
                exchange="BINANCE",
                issued_at_micros=NOW,
                expires_at_micros=NOW - 1,
                nonce="0" * MIN_NONCE_LENGTH,
            )

    def test_a_window_longer_than_the_ceiling_is_refused(self) -> None:
        with pytest.raises(LiveConfirmationError, match="standing order"):
            LiveOperatorConfirmation(
                instance_id="i",
                tenant_id="t",
                account_id="a",
                exchange="BINANCE",
                issued_at_micros=ISSUED,
                # micros, because the field is micros and the ceiling is milliseconds:
                # one whole millisecond past the bound is the smallest thing that must
                # be refused, so that "exactly the ceiling" stays a legal record and is
                # covered by the test below instead of being an off-by-one in here.
                expires_at_micros=ISSUED + MAX_CONFIRMATION_WINDOW_MS * 1_000 + 1_000,
                nonce="0" * MIN_NONCE_LENGTH,
            )

    def test_the_ceiling_itself_is_allowed(self) -> None:
        # The bound is inclusive, and asserting only the refusal side would let an
        # off-by-one that rejects the legal maximum pass unnoticed - the failure mode
        # where a deployment cannot mint the longest confirmation the law permits.
        longest = LiveOperatorConfirmation(
            instance_id="i",
            tenant_id="t",
            account_id="a",
            exchange="BINANCE",
            issued_at_micros=ISSUED,
            expires_at_micros=ISSUED + MAX_CONFIRMATION_WINDOW_MS * 1_000,
            nonce="0" * MIN_NONCE_LENGTH,
        )
        assert longest.expires_at_micros - longest.issued_at_micros == (
            MAX_CONFIRMATION_WINDOW_MS * 1_000
        )

    def test_a_short_nonce_is_refused_because_the_digest_would_be_enumerable(self) -> None:
        with pytest.raises(LiveConfirmationError, match="nonce"):
            record(nonce="abc123")

    def test_a_truncated_digest_is_refused_at_construction(self) -> None:
        signed = record()
        with pytest.raises(LiveConfirmationError, match="SHA-256"):
            dataclasses.replace(signed, digest=signed.digest[:40])

    def test_a_zero_timestamp_is_refused_rather_than_read_as_epoch(self) -> None:
        # ``0`` is the value a missing field turns into, and a missing expiry in a
        # security record must never be readable as "1970, so obviously expired": it
        # is refused, and the caller has to decide what they meant.
        with pytest.raises(LiveConfirmationError, match="positive epoch"):
            LiveOperatorConfirmation(
                instance_id="i",
                tenant_id="t",
                account_id="a",
                exchange="BINANCE",
                issued_at_micros=0,
                expires_at_micros=NOW,
                nonce="0" * MIN_NONCE_LENGTH,
            )

    def test_a_boolean_is_not_an_integer_here(self) -> None:
        with pytest.raises(LiveConfirmationError, match="must be an int"):
            LiveOperatorConfirmation(
                instance_id="i",
                tenant_id="t",
                account_id="a",
                exchange="BINANCE",
                issued_at_micros=True,
                expires_at_micros=NOW,
                nonce="0" * MIN_NONCE_LENGTH,
            )


# ---------------------------------------------------------------------------
# 2. integrity: the digest, and what it is taken over
# ---------------------------------------------------------------------------


class TestIntegrity:
    def test_the_canonical_form_ignores_set_ordering(self) -> None:
        first = record(symbols=frozenset({"BTCUSDT", "ETHUSDT"}))
        second = record(symbols=frozenset({"ETHUSDT", "BTCUSDT"}))
        assert canonical_confirmation_json(first) == canonical_confirmation_json(second)
        assert first.digest == second.digest

    def test_every_field_changes_the_digest(self) -> None:
        base = record()
        for changes in (
            {"instance_id": "exec-2"},
            {"tenant_id": "tenant-b"},
            {"account_id": "acct-2"},
            {"exchange": "BYBIT"},
            {"symbols": frozenset({"SOLUSDT"})},
            {"order_types": frozenset({"MARKET"})},
            {"expires_at_micros": ISSUED + 8 * ONE_DAY},
            {"nonce": "9988776655443322"},
        ):
            changed = dataclasses.replace(base, **changes)
            assert changed.with_digest(KEY).digest != base.digest, changes

    def test_verification_is_the_hmac_of_the_content_under_the_key(self) -> None:
        signed = record()
        expected = hmac.new(
            KEY.encode("utf-8"), canonical_confirmation_json(signed).encode("utf-8"), hashlib.sha256
        ).hexdigest()
        assert signed.digest == expected
        assert signed.verifies(KEY)

    def test_a_different_key_does_not_verify(self) -> None:
        signed = record()
        assert not signed.verifies("another-key-entirely-0123456789abcdef")

    def test_an_unsigned_record_never_verifies(self) -> None:
        unsigned = record(sign=False)
        assert unsigned.digest == ""
        assert not unsigned.verifies(KEY)

    def test_signing_with_an_empty_key_is_refused(self) -> None:
        # Not "produces a signature over a known key": an operator who left the
        # variable unset would otherwise get records that verify for everybody.
        with pytest.raises(LiveConfirmationError, match="empty HMAC key"):
            compute_digest(record(sign=False), "")

    def test_a_tampered_record_fails_instead_of_falling_back(self) -> None:
        # Extended far past its window AND left with the old digest: the edit that
        # would matter in an attack, and the one a reader of "expires_at_micros"
        # alone cannot tell apart from an honest long window.
        signed = record()
        tampered = dataclasses.replace(signed, expires_at_micros=NOW + 30 * ONE_DAY)
        assert not tampered.verifies(KEY)
        outcome = assess(tampered)
        assert outcome.state is ConfirmationState.UNVERIFIED

    def test_the_fingerprint_is_a_prefix_and_the_digest_is_not_published(self) -> None:
        signed = record()
        assert signed.fingerprint == signed.digest[:FINGERPRINT_LENGTH]
        view = signed.describe()
        assert view["fingerprint"] == signed.fingerprint
        assert "digest" not in view
        assert "nonce" not in view
        assert record(sign=False).fingerprint == ""

    def test_an_unresolvable_record_carries_no_fingerprint(self) -> None:
        outcome = assess(dataclasses.replace(record(), digest="0" * 64))
        assert outcome.state is ConfirmationState.UNVERIFIED
        assert outcome.record is None
        assert outcome.fingerprint == ""


# ---------------------------------------------------------------------------
# 3. the wire form: a deployment configures this as JSON
# ---------------------------------------------------------------------------


class TestPayload:
    def test_round_trip_preserves_every_field(self) -> None:
        signed = record()
        assert LiveOperatorConfirmation.from_payload(signed.to_payload()) == signed

    def test_the_payload_is_json_safe(self) -> None:
        payload = record().to_payload()
        assert json.loads(json.dumps(payload))["instanceId"] == "exec-1"
        assert isinstance(payload["symbols"], list)

    def test_identities_are_normalised_on_parse(self) -> None:
        parsed = LiveOperatorConfirmation.from_payload(
            {
                **record().to_payload(),
                "exchange": " binance ",
                "symbols": ["btcusdt"],
                "orderTypes": ["limit"],
            }
        )
        assert parsed.exchange == "BINANCE"
        assert parsed.symbols == frozenset({"BTCUSDT"})
        assert parsed.order_types == frozenset({"LIMIT"})

    def test_an_unknown_field_is_refused_rather_than_dropped(self) -> None:
        with pytest.raises(LiveConfirmationError, match="unknown confirmation field"):
            LiveOperatorConfirmation.from_payload(
                {**record().to_payload(), "expriesAtMicros": 9_999_999_999_999_999}
            )

    def test_a_missing_field_is_refused_rather_than_defaulted(self) -> None:
        payload = record().to_payload()
        del payload["expiresAtMicros"]
        with pytest.raises(LiveConfirmationError, match="missing confirmation field"):
            LiveOperatorConfirmation.from_payload(payload)

    def test_a_string_expiry_is_accepted_and_a_float_is_not(self) -> None:
        payload = record().to_payload()
        payload["expiresAtMicros"] = str(ISSUED + 7 * ONE_DAY)
        assert LiveOperatorConfirmation.from_payload(payload).expires_at_micros == (
            ISSUED + 7 * ONE_DAY
        )
        payload["expiresAtMicros"] = 1.5e15
        with pytest.raises(LiveConfirmationError, match="integer"):
            LiveOperatorConfirmation.from_payload(payload)

    def test_the_empty_symbol_set_is_unbounded_and_says_so(self) -> None:
        unbounded = record(symbols=frozenset())
        assert unbounded.describe()["symbols"] == [SCOPE_UNBOUNDED]
        # And "unbounded" means "the deployment's own policy bounds it", not "no
        # symbol": an order on a symbol the record never mentions must still pass.
        assert assess(unbounded, symbol="SOLUSDT").state is ConfirmationState.VALID


# ---------------------------------------------------------------------------
# 4. the assessment, state by state, in decision order
# ---------------------------------------------------------------------------


class TestAssessment:
    def test_no_record_and_no_requirement_is_not_required(self) -> None:
        outcome = verifier(None, required=False).assess(
            tenant_id="t",
            account_id="a",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=NOW,
        )
        assert outcome.state is ConfirmationState.NOT_REQUIRED
        assert outcome.accepted

    def test_required_and_absent_is_absent_not_malformed(self) -> None:
        outcome = verifier(None).assess(
            tenant_id="t",
            account_id="a",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=NOW,
        )
        assert outcome.state is ConfirmationState.ABSENT
        assert "ceremony" in outcome.detail
        assert not outcome.accepted

    def test_the_verifier_refuses_to_be_built_required_with_no_key(self) -> None:
        with pytest.raises(LiveConfirmationError, match="verification key"):
            ConfirmationVerifier(record=None, key="", instance_id="i", required=True)

    def test_integrity_is_checked_before_time(self) -> None:
        expired = record(expires=NOW - 1)
        tampered = dataclasses.replace(expired, digest="f" * 64)
        outcome = assess(tampered)
        # Not EXPIRED: the record could have been rewritten to say anything, and a
        # report that trusted its timestamps would be trusting the forger's clock.
        assert outcome.state is ConfirmationState.UNVERIFIED

    def test_expiry_boundary_is_inclusive_and_validity_starts_at_issue(self) -> None:
        signed = record()
        assert assess(signed, now=signed.expires_at_micros).state is (
            ConfirmationState.EXPIRED
        )
        assert assess(signed, now=signed.expires_at_micros - 1).state is (
            ConfirmationState.VALID
        )
        assert assess(signed, now=signed.issued_at_micros).state is ConfirmationState.VALID
        assert assess(signed, now=signed.issued_at_micros - 1).state is (
            ConfirmationState.NOT_YET_VALID
        )

    def test_a_future_record_names_the_clock_as_the_remedy(self) -> None:
        assert "clock" in assess(record(), now=ISSUED - 1_000).detail

    @pytest.mark.parametrize(
        ("changes", "expected"),
        [
            ({"instance": "other"}, "the confirmation names"),
            ({"tenant": "tenant-z"}, "for tenant"),
            ({"account": "acct-z"}, "for account"),
        ],
    )
    def test_identity_scope_mismatches_are_named_by_field(
        self, changes: dict[str, Any], expected: str
    ) -> None:
        outcome = assess(record(**changes))
        assert outcome.state is ConfirmationState.SCOPE_MISMATCH
        assert expected in outcome.detail

    def test_a_symbol_outside_the_record_is_refused_and_one_inside_is_not(self) -> None:
        assert assess(record(), symbol="SOLUSDT").state is ConfirmationState.SCOPE_MISMATCH
        assert assess(record(), symbol="ETHUSDT").state is ConfirmationState.VALID

    def test_an_order_type_outside_the_record_is_refused(self) -> None:
        assert assess(record(), order_type="MARKET").state is (
            ConfirmationState.SCOPE_MISMATCH
        )
        assert assess(record(order_types=frozenset()), order_type="MARKET").state is (
            ConfirmationState.VALID
        )

    def test_the_exchange_and_instance_come_from_the_verifier_not_the_order(self) -> None:
        signed = record(exchange="BYBIT")
        outcome = verifier(signed, exchange="BINANCE").assess(
            tenant_id="tenant-a",
            account_id="acct-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=NOW,
        )
        assert outcome.state is ConfirmationState.SCOPE_MISMATCH
        assert "exchange" in outcome.detail

    def test_a_verifier_without_an_instance_name_does_not_invent_one(self) -> None:
        # An empty deployment identifier skips the instance comparison rather than
        # comparing against a guessed one, which is the same "unknown is not allowed"
        # law the review runs on in the other direction: the missing value here is
        # this verifier's own configuration, and it cannot manufacture an identity
        # for a deployment that declined to name one. Not a hole: the record's other
        # scope fields still bind, and ``app.config`` refuses an unnamed instance at
        # boot for every service this repository ships.
        outcome = verifier(record(), instance="").assess(
            tenant_id="tenant-a",
            account_id="acct-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=NOW,
        )
        assert outcome.state is ConfirmationState.VALID

    def test_the_outcome_view_is_small_and_secret_free(self) -> None:
        view = assess(record()).to_dict()
        assert view == {
            "state": "VALID",
            "detail": "scoped to tenant-a/acct-1 on BINANCE for this order shape",
            "accepted": True,
        }
        assert "digest" not in json.dumps(view)
        assert KEY not in json.dumps(view)

    def test_a_verifier_that_raises_is_reported_as_a_refusal_not_a_crash(self) -> None:
        class Exploding(ConfirmationVerifier):
            """A verifier whose own machinery fails: a collaborator, so it may."""

            def assess(self, **kwargs: object) -> ConfirmationOutcome:
                raise RuntimeError("the deployment's verifier exploded")

        # The reviewer swallows this into UNVERIFIED, because its contract is that a
        # review always returns a verdict: an exception here would land between
        # "validated" and "sent" and leave an order whose fate nobody recorded.
        reviewer = PlacementReviewer(
            UnattestedPlacementAttestor("no gatherer in this test"),
            PlacementReviewPolicy(require_operator_confirmation=True),
            requires_venue_attestation=False,
            confirmation=Exploding(record=record(), key=KEY, instance_id="exec-1"),
            clock=lambda: NOW,
        )
        attestation, verdict = asyncio.run(
            reviewer.review(
                PlacementReviewRequest(
                    tenant_id="tenant-a",
                    account_id="acct-1",
                    symbol="BTCUSDT",
                    order_type="LIMIT",
                    time_in_force="GTC",
                )
            )
        )
        assert not verdict.allowed
        assert attestation.facts.confirmation is ConfirmationState.UNVERIFIED
        # The exception TYPE is carried and the exception's message is not: a
        # collaborator's error text can quote configuration it was handed.
        blocking = verdict.blocking_findings
        assert [finding.code.value for finding in blocking] == [
            "OPERATOR_CONFIRMATION_UNVERIFIED"
        ]
        assert "RuntimeError" in blocking[0].message
        assert "exploded" not in blocking[0].message

    def test_the_reviewer_refuses_to_be_built_requiring_a_verifier_it_lacks(self) -> None:
        with pytest.raises(Exception, match="no ConfirmationVerifier was supplied"):
            PlacementReviewer(
                UnattestedPlacementAttestor("none"),
                PlacementReviewPolicy(require_operator_confirmation=True),
                requires_venue_attestation=False,
            )


# ---------------------------------------------------------------------------
# 5. the deployment-level half, and the boundary around it
# ---------------------------------------------------------------------------


class TestDeploymentGrading:
    def test_it_ignores_the_order_shape_checks(self) -> None:
        outcome = verifier(record(symbols=frozenset({"BTCUSDT"}))).assess_deployment(
            tenant_id="tenant-a",
            account_id="acct-1",
            now_micros=NOW,
        )
        assert outcome.state is ConfirmationState.VALID
        assert "for this order shape" not in outcome.detail

    def test_it_still_checks_integrity_identity_and_window(self) -> None:
        verifier_now = verifier(record(expires=NOW - 1))
        assert verifier_now.assess_deployment(
            tenant_id="tenant-a", account_id="acct-1", now_micros=NOW
        ).state is ConfirmationState.EXPIRED
        assert verifier(record(tenant="other")).assess_deployment(
            tenant_id="tenant-a", account_id="acct-1", now_micros=NOW
        ).state is ConfirmationState.SCOPE_MISMATCH
        assert verifier(record(sign=False)).assess_deployment(
            tenant_id="tenant-a", account_id="acct-1", now_micros=NOW
        ).state is ConfirmationState.UNVERIFIED

    def test_the_review_never_reaches_for_the_deployment_grading(self) -> None:
        """The per-order path must not be shortened to the boot path.

        Source-scanned rather than reasoned about, because this is the one
        asymmetry a future refactor is tempted to "simplify": reusing
        ``assess_deployment`` in the reviewer would make a confirmation for one
        symbol authorise every symbol, and no behavioural test in this file would
        notice, since every other case here passes a matching symbol.
        """
        import ast
        from pathlib import Path

        source = (
            Path(__file__).resolve().parents[1] / "wlct_trading" / "execution" / "placement_attestor.py"
        )
        tree = ast.parse(source.read_text(encoding="utf-8"))
        names = {
            node.func.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }
        assert "assess" in names
        assert "assess_deployment" not in names


# ---------------------------------------------------------------------------
# 6. the two views, and what separates them
# ---------------------------------------------------------------------------


class TestViews:
    def test_describe_carries_the_scope_and_public_summary_does_not(self) -> None:
        built = verifier(record())
        full = built.describe()
        slim = built.public_summary()
        record_view = full["record"]
        assert isinstance(record_view, dict)
        assert record_view["tenantId"] == "tenant-a"
        assert slim == {
            "required": True,
            "keyConfigured": True,
            "recordPresent": True,
            "expiresAtMicros": ISSUED + 7 * ONE_DAY,
            "fingerprint": record().fingerprint,
        }
        for name in ("tenantId", "accountId", "symbols", "orderTypes", "digest", "nonce"):
            assert name not in json.dumps(slim)
        assert "record" not in slim

    def test_the_key_appears_in_no_view_at_all(self) -> None:
        built = verifier(record())
        assert built.record is not None
        for view in (built.describe(), built.public_summary(), built.record.describe()):
            assert KEY not in json.dumps(view)
            assert KEY not in repr(view)

    def test_the_policy_flag_defaults_off_and_is_not_a_permission(self) -> None:
        assert PlacementReviewPolicy().require_operator_confirmation is False
        # A string where a bool belongs is refused by the policy rather than read as
        # truthy: "false" arriving as the four-character string from a config file is
        # the classic way a requirement becomes a permission.
        not_a_bool: Any = "yes"
        with pytest.raises(PlacementReviewError, match="must be a bool"):
            PlacementReviewPolicy(require_operator_confirmation=not_a_bool)

    def test_the_detail_bound_is_the_one_the_reviewer_truncates_to(self) -> None:
        assert MAX_CONFIRMATION_DETAIL_LENGTH > 40
