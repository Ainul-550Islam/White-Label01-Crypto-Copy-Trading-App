"""Generate ``docs/fixtures/observability_fixtures.json`` - the Part 9 oracle.

Two languages implement the pieces the operations console depends on: the
Python engine (this repository's ``wlct_trading.observability``) and the
TypeScript API (``apps/api/src/modules/observability`` plus the metrics
infrastructure). They must agree on the *wire facts*: the Prometheus text
format, redaction answers, alert payload shapes, correlation wire keys, and
the declarative catalogs (gates, rules, statuses). The jest suite consumes
this file exactly as the Python tests do, so a drift in either direction
fails one of the two suites rather than surviving review.

Run: ``python3 libs/trading-core/scripts/gen_observability_fixtures.py``
from anywhere inside the repository. Output is deterministic (fixed clock,
sorted keys) - regenerate to inspect a diff, never hand-edit.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "libs" / "trading-core"))

from wlct_trading.observability import alerts as alerts_module  # noqa: E402 - imports follow the sys.path.insert above
from wlct_trading.observability import health as health_module  # noqa: E402 - imports follow the sys.path.insert above
from wlct_trading.observability import labels as labels_module  # noqa: E402 - imports follow the sys.path.insert above
from wlct_trading.observability import readiness as readiness_module  # noqa: E402 - imports follow the sys.path.insert above
from wlct_trading.observability.metrics import ObservabilityRegistry, render_prometheus  # noqa: E402 - imports follow the sys.path.insert above
from wlct_trading.observability.redaction import is_sensitive_key, redact_value  # noqa: E402 - imports follow the sys.path.insert above

OUT = ROOT / "docs" / "fixtures" / "observability_fixtures.json"

T0 = 1_700_000_000_000_000


def prometheus_vectors() -> dict[str, Any]:
    vectors: list[dict[str, Any]] = []

    registry = ObservabilityRegistry(service="engine")
    registry.register_counter(
        "wlct_risk_decisions_total", "Risk decisions evaluated, by verdict.", "result"
    )
    registry.inc("wlct_risk_decisions_total", {"result": "approved"})
    registry.inc("wlct_risk_decisions_total", {"result": "approved"}, 2)
    registry.inc("wlct_risk_decisions_total", {"result": "rejected"})
    vectors.append(
        {
            "name": "counter-single-label",
            "service": "engine",
            "families": [
                {
                    "name": "wlct_risk_decisions_total",
                    "type": "counter",
                    "help": "Risk decisions evaluated, by verdict.",
                    "labels": ["result"],
                    "record": [
                        {"op": "inc", "labels": {"result": "approved"}},
                        {"op": "inc", "labels": {"result": "approved"}, "amount": 2},
                        {"op": "inc", "labels": {"result": "rejected"}},
                    ],
                }
            ],
        }
    )

    registry2 = ObservabilityRegistry(service="engine")
    registry2.register_histogram(
        "wlct_pipeline_transition_micros",
        "Pipeline transition durations in microseconds.",
        ("stage", "simulation"),
        buckets=(100, 1_000),
    )
    for micros in (50, 100, 999, 1000, 5_000):
        registry2.observe_micros(
            "wlct_pipeline_transition_micros",
            {"stage": "risk_started__risk_finished", "simulation": "live"},
            micros,
        )
    registry2.observe_micros(
        "wlct_pipeline_transition_micros",
        {"stage": "risk_started__risk_finished", "simulation": "simulated"},
        -25,
    )
    vectors.append(
        {
            "name": "histogram-cumulative-and-negative",
            "service": "engine",
            "families": [
                {
                    "name": "wlct_pipeline_transition_micros",
                    "type": "histogram",
                    "help": "Pipeline transition durations in microseconds.",
                    "labels": ["stage", "simulation"],
                    "buckets": [100, 1_000],
                    "record": [
                        {"op": "observe", "labels": {"stage": "risk_started__risk_finished", "simulation": "live"}, "micros": 50},
                        {"op": "observe", "labels": {"stage": "risk_started__risk_finished", "simulation": "live"}, "micros": 100},
                        {"op": "observe", "labels": {"stage": "risk_started__risk_finished", "simulation": "live"}, "micros": 999},
                        {"op": "observe", "labels": {"stage": "risk_started__risk_finished", "simulation": "live"}, "micros": 1000},
                        {"op": "observe", "labels": {"stage": "risk_started__risk_finished", "simulation": "live"}, "micros": 5000},
                        {"op": "observe", "labels": {"stage": "risk_started__risk_finished", "simulation": "simulated"}, "micros": -25},
                    ],
                }
            ],
        }
    )

    registry3 = ObservabilityRegistry(service="engine")
    registry3.register_gauge("wlct_orders_open", "Open orders per venue.", "exchange")
    registry3.set_gauge("wlct_orders_open", {"exchange": "binance"}, 12)
    vectors.append(
        {
            "name": "gauge-floats",
            "service": "engine",
            "families": [
                {
                    "name": "wlct_orders_open",
                    "type": "gauge",
                    "help": "Open orders per venue.",
                    "labels": ["exchange"],
                    "record": [{"op": "set", "labels": {"exchange": "binance"}, "value": 12}],
                }
            ],
        }
    )

    rendered: list[dict[str, Any]] = []
    for vector, source in zip(vectors, (registry, registry2, registry3)):
        rendered.append({**vector, "text": render_prometheus(source)})
    return {
        "comment": (
            "Exact Prometheus 0.0.4 exposition outputs. The TS registry must "
            "render byte-identical text for identical family/record shapes "
            "(minus the wlct_registry_series_overflow_total preamble, which "
            "each side renders from its own counter)."
        ),
        "vectors": rendered,
    }


def redaction_cases() -> dict[str, Any]:
    jwt = "header.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.9fKq-_2example_sig_x"
    stripe_key = "sk_live_0123456789abcdefghij"
    aws_key = "AKIAIOSFODNN7EXAMPLE"
    inputs: list[dict[str, Any]] = [
        {"key": "api_key", "expected": True},
        {"key": "API-KEY", "expected": True},
        {"key": "accessToken", "expected": True},
        {"key": "jwt", "expected": True},
        {"key": "x-signature", "expected": True},
        {"key": "dsn", "expected": True},
        {"key": "database_url", "expected": True},
        {"key": "symbol", "expected": False},
        {"key": "quantity", "expected": False},
        {"input": {"api_key": "abc", "symbol": "BTCUSDT"}, "expected": {"api_key": "[REDACTED]", "symbol": "BTCUSDT"}, "forbidden": ["abc"]},
        {"input": [1, {"token": "t0k3n"}, "plain"], "expected": [1, {"token": "[REDACTED]"}, "plain"], "forbidden": ["t0k3n"]},
        {"input": {"note": f"auth Bearer {'a' * 32}.{b'x'.decode() * 12}"}, "forbidden": ["a" * 32]},
        {"input": {"url": f"https://api.example.com?Signature={aws_key}&x=1"}, "forbidden": [aws_key]},
        {"input": {"msg": f"paid with {stripe_key}"}, "forbidden": [stripe_key]},
        {"input": {"jwtish": jwt}, "forbidden": [jwt]},
        {"input": {"connection": "postgresql://user:hunter2@db.internal:5432/app"}, "forbidden": ["hunter2"]},
        {"input": "no secrets here", "expected": "no secrets here"},
    ]
    computed: list[dict[str, Any]] = []
    for case in inputs:
        if "key" in case:
            computed.append({"key": case["key"], "expected": is_sensitive_key(case["key"])})
            continue
        redacted = redact_value(case["input"])
        entry: dict[str, Any] = {
            "input": case["input"],
            "expected": redacted,
            "forbidden": case.get("forbidden", []),
        }
        if "expected" in case and isinstance(case["expected"], dict) and "expected" in case:
            # The hand-written expectation stays in the file too, so a
            # Python-side regression is visible as a diff in the fixture,
            # not silently baked into the "expected" column.
            entry["declared"] = case["expected"]
        computed.append(entry)
    return {
        "comment": (
            "redact_value / is_sensitive_key answers. 'expected' is computed "
            "by the reference implementation; 'declared' appears only where "
            "the generator also had a human-written expectation, and the TS "
            "suite asserts BOTH 'expected' and every 'forbidden' substring "
            "being absent from its own output."
        ),
        "cases": computed,
    }


def catalog_facts() -> dict[str, Any]:
    return {
        "comment": (
            "The declarative tables the TS module mirrors verbatim. The TS "
            "safety spec asserts set-equality against these; drift fails CI."
        ),
        "alert_rules": [
            {
                "ruleId": rule.rule_id,
                "severity": rule.severity.value,
                "title": rule.title,
                "requiresRecovery": rule.requires_recovery,
                "blocksTrading": rule.blocks_trading,
            }
            for rule in alerts_module.ALERT_RULES
        ],
        "alert_severities": [s.value for s in alerts_module.AlertSeverity],
        "alert_states": [s.value for s in alerts_module.AlertState],
        "health_statuses": [s.value for s in health_module.ComponentStatus],
        "trading_gates": [g.name for g in readiness_module.TRADING_GATES],
        "forbidden_labels": sorted(labels_module.FORBIDDEN_LABEL_NAMES),
        "allowed_labels": sorted(labels_module.ALLOWED_LABEL_NAMES),
        "alert_payload_shape": sorted(
            alerts_module.AlertRecord(
                alert_id="x",
                rule_id="MARKET_DATA_STALE",
                severity=alerts_module.AlertSeverity.CRITICAL,
                state=alerts_module.AlertState.OPEN,
                component="c",
                scope=None,
                title="t",
                condition="t",
                first_seen_at_micros=0,
                last_seen_at_micros=0,
                occurrences=1,
                observed_value=None,
                threshold_value=None,
                message=None,
                links={},
            ).to_payload()
        ),
    }


def alert_fold_vectors() -> dict[str, Any]:
    engine = alerts_module.AlertEngine()
    o1 = alerts_module.AlertObservation(
        rule_id="MARKET_DATA_STALE",
        component="market-data",
        scope="binance/BTCUSDT",
        observed_value="4100000",
        at_micros=T0,
        links={"correlation_id": "corr-fx"},
    )
    opened = engine.observe(o1)
    folded = engine.observe(alerts_module.AlertObservation(
        rule_id="MARKET_DATA_STALE", component="market-data", scope="binance/BTCUSDT",
        observed_value="9000000", at_micros=T0 + 5,
    ))
    acked = engine.acknowledge(
        rule_id="MARKET_DATA_STALE", component="market-data",
        scope="binance/BTCUSDT", actor="ops@example", at_micros=T0 + 6,
    )
    recovered = engine.recover(
        rule_id="MARKET_DATA_STALE", component="market-data",
        scope="binance/BTCUSDT", at_micros=T0 + 7,
    )
    return {
        "comment": (
            "The four state shapes persistence must round-trip. The TS "
            "alerts mapper parses exactly these keys and must map state "
            "transitions identically (fold keeps alertId, increments "
            "occurrences, preserves firstSeenAtMicros)."
        ),
        "opened": opened.to_payload(),
        "folded": folded.to_payload(),
        "acked": acked.to_payload(),
        "recovered": (recovered.to_payload() if recovered is not None else None),
    }


def readiness_truth_table() -> dict[str, Any]:
    """All 2^9 satisfied/unsatisfied combinations of the declared gates.

    The TS evaluator must reproduce ``ready`` and ``blockingGates`` for every
    row; this is the cheapest way to pin a nine-input policy table without
    a hundred hand-written cases.
    """
    from itertools import product

    names = [g.name for g in readiness_module.TRADING_GATES]
    rows: list[dict[str, Any]] = []
    for bits in product((False, True), repeat=len(names)):
        evidence = {
            name: readiness_module.GateEvidence(value=value)
            for name, value in zip(names, bits)
        }
        verdict = readiness_module.evaluate_trading_readiness(evidence, now_micros=T0)
        rows.append(
            {
                "satisfied": "".join("1" if b else "0" for b in bits),
                "ready": verdict.ready,
                "blocking": list(verdict.blocking_gates),
            }
        )
    # A second table: one gate None (unknown) must block exactly that gate.
    unknown_rows: list[dict[str, Any]] = []
    for name in names:
        evidence = {g.name: readiness_module.GateEvidence(value=True) for g in readiness_module.TRADING_GATES}
        evidence[name] = readiness_module.GateEvidence(value=None)
        verdict = readiness_module.evaluate_trading_readiness(evidence, now_micros=T0)
        unknown_rows.append({"unknown": name, "ready": verdict.ready, "blocking": list(verdict.blocking_gates)})
    # ...and a third: stale evidence behaves like unsatisfied evidence.
    stale_rows: list[dict[str, Any]] = []
    for name in names:
        evidence = {g.name: readiness_module.GateEvidence(value=True) for g in readiness_module.TRADING_GATES}
        evidence[name] = readiness_module.GateEvidence(
            value=True, age_micros=9_000_000, freshness_budget_micros=2_000_000
        )
        verdict = readiness_module.evaluate_trading_readiness(evidence, now_micros=T0)
        stale_rows.append({"stale": name, "ready": verdict.ready, "blocking": list(verdict.blocking_gates)})
    return {
        "comment": (
            "Gate order: " + ",".join(names) + ". Row semantics are the TS "
            "evaluator's contract: missing evidence blocks, stale blocks, "
            "and only all-satisfied yields ready=true."
        ),
        "gates": names,
        "rows": rows,
        "unknownRows": unknown_rows,
        "staleRows": stale_rows,
    }


def main() -> int:
    doc = {
        "generatedBy": "libs/trading-core/scripts/gen_observability_fixtures.py",
        "comment": (
            "Part 9 cross-language oracle. Regenerate, never hand-edit. The "
            "Python tests and the API jest suite both consume this file."
        ),
        "prometheus": prometheus_vectors(),
        "redaction": redaction_cases(),
        "catalogs": catalog_facts(),
        "alertFolds": alert_fold_vectors(),
        "readiness": readiness_truth_table(),
    }
    OUT.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(OUT.read_text(encoding='utf-8').splitlines())} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
