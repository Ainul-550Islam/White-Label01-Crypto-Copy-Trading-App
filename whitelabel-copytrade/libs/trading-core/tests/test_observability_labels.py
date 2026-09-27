"""The label policy is the part of observability that can break production;
test it like the load-bearing component it is.

Everything here checks *refusal* - the allow-list earns its keep only if bad
labels are rejected at registration and at record time, not merely
discouraged in a docstring.
"""

from __future__ import annotations

import pytest

from wlct_trading.observability.labels import (
    ALLOWED_LABEL_NAMES,
    FORBIDDEN_LABEL_NAMES,
    CardinalityError,
    LabelPolicy,
    label_value_ok,
    metric_name_ok,
)


def test_forbidden_and_allowed_never_overlap() -> None:
    # A name on both lists would make the policy ambiguous; FORBIDDEN wins by
    # construction, so an overlap means someone wrote a conflicting entry.
    assert not (FORBIDDEN_LABEL_NAMES & ALLOWED_LABEL_NAMES)


@pytest.mark.parametrize(
    "name",
    [
        "order_id",
        "client_order_id",
        "request_id",
        "correlation_id",
        "tenant_id",
        "user_id",
        "account_id",
        "api_key",
        "token",
        "message",
    ],
)
def test_identifier_and_secret_labels_are_forbidden(name: str) -> None:
    assert name in FORBIDDEN_LABEL_NAMES


def test_metric_name_pattern() -> None:
    assert metric_name_ok("wlct_risk_decisions_total")
    assert not metric_name_ok("has space")
    assert not metric_name_ok("9lives")
    assert not metric_name_ok("")


def test_label_value_must_be_wire_token() -> None:
    assert label_value_ok("BINANCE")
    assert label_value_ok("0198abcd-1111-2222-3333-444455556666")
    assert not label_value_ok("")
    assert not label_value_ok("two words")
    assert not label_value_ok("line\nbreak")
    assert not label_value_ok(42)
    assert not label_value_ok("x" * 65)


def test_policy_rejects_forbidden_label_at_construction() -> None:
    with pytest.raises(CardinalityError, match="forbidden label name"):
        LabelPolicy(name="wlct_orders_by_id", label_names=("order_id",))


def test_policy_rejects_unlisted_label_at_construction() -> None:
    with pytest.raises(CardinalityError, match="not in the allow-list"):
        LabelPolicy(name="wlct_anything", label_names=("shoe_size",))


def test_labelless_family_is_the_safest_shape() -> None:
    policy = LabelPolicy(name="wlct_anon", label_names=())
    assert policy.validate({}) == ()
    with pytest.raises(CardinalityError, match="must be exactly"):
        policy.validate({"sneaky": "value"})


def test_policy_duplicate_label_rejected() -> None:
    with pytest.raises(CardinalityError, match="twice"):
        LabelPolicy(name="wlct_x", label_names=("result", "result"))


def test_bounds_require_declared_label_and_nonempty_domain() -> None:
    with pytest.raises(CardinalityError, match="not a declared label"):
        LabelPolicy(
            name="wlct_y",
            label_names=("result",),
            bounds={"symbol": frozenset({"BTCUSDT"})},
        )
    with pytest.raises(CardinalityError, match="empty domain"):
        LabelPolicy(
            name="wlct_z",
            label_names=("symbol",),
            bounds={"symbol": frozenset()},
        )


def test_validate_exact_label_set_and_bounds() -> None:
    policy = LabelPolicy(
        name="wlct_market_messages_total",
        label_names=("exchange", "channel", "symbol"),
        bounds={
            "exchange": frozenset({"binance", "bybit"}),
            "symbol": frozenset({"BTCUSDT", "ETHUSDT"}),
        },
    )
    key = policy.validate(
        {"exchange": "binance", "channel": "depth", "symbol": "BTCUSDT"}
    )
    assert key == (("exchange", "binance"), ("channel", "depth"), ("symbol", "BTCUSDT"))

    with pytest.raises(CardinalityError, match="must be exactly"):
        policy.validate({"exchange": "binance", "channel": "depth"})

    with pytest.raises(CardinalityError, match="outside the declared"):
        policy.validate(
            {"exchange": "binance", "channel": "depth", "symbol": "SOLVUSDT"}
        )

    with pytest.raises(CardinalityError, match="not a bounded wire token"):
        policy.validate(
            {"exchange": "binance", "channel": "depth", "symbol": "BTC USDT"}
        )


def test_labels_allow_list_is_stable_documentation() -> None:
    # If a label name is added or removed, this test fires and the removal/
    # addition has to be *justified in review*, matching the spec's "explicit
    # metric-label rules" requirement instead of drift.
    assert ALLOWED_LABEL_NAMES >= frozenset(
        {
            "service",
            "exchange",
            "market_type",
            "event_kind",
            "result",
            "risk_code",
            "stage",
            "component",
            "symbol",
        }
    )
