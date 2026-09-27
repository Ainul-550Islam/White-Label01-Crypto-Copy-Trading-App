#!/usr/bin/env python3
"""Generate docs/fixtures/reliability_fixtures.json (Part 10).

One source of truth for the cross-language reliability contract: the TS
services re-implement sampling, budget arithmetic, burn windows, checksum
canonicalisation and the OTLP/JSON encoder; their parity spec replays the
vectors committed here. Run from the repository root:

    python3 libs/trading-core/scripts/gen_part10_fixtures.py

Regenerating twice must produce byte-identical output (the determinism
claims in the code are checked by exactly that property).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "libs" / "trading-core"))

from wlct_trading.observability import faults as faults_module  # noqa: E402
from wlct_trading.observability.alerts import ALERT_RULES  # noqa: E402
from wlct_trading.observability.tracing import (  # noqa: E402
    TRACED_OPERATIONS,
    SamplingMode,
    SamplingPolicy,
    Span,
    SpanKind,
    SpanStatus,
    TraceContext,
    _safe_attribute,
    format_traceparent,
    format_tracestate,
    otlp_json_encode,
    parse_traceparent,
    parse_tracestate,
)
from wlct_trading.slo import (  # noqa: E402
    DEFAULT_SLO_CATALOG,
    SloDefinition,
    SloIndicator,
    SloState,
    SloWindowKind,
    SloWindowSample,
    canonical_slo_json,
    compute_budget,
    evaluate_burn,
    evaluate_slo,
    slo_checksum,
)
from wlct_trading.observability.labels import ALLOWED_LABEL_NAMES  # noqa: E402

FIXTURE_PATH = ROOT / "docs" / "fixtures" / "reliability_fixtures.json"

VALID_TID = "0af7651916cd43dd8448eb211c80319c"
VALID_SID = "b7ad6b7169203331"


def _traceparent_vectors() -> dict[str, Any]:
    valid: list[dict[str, Any]] = []
    for flags, sampled in (("01", True), ("00", False), ("09", True), ("0a", False)):
        header = f"00-{VALID_TID}-{VALID_SID}-{flags}"
        context = parse_traceparent(header)
        assert context is not None
        valid.append(
            {
                "header": header,
                "traceId": context.trace_id,
                "spanId": context.span_id,
                "flags": context.trace_flags,
                "sampled": sampled,
                "reformat": format_traceparent(context),
            }
        )
    future = parse_traceparent(f"00-{VALID_TID}-{VALID_SID}-01-extra-field")
    assert future is not None
    valid.append(
        {
            "header": f"00-{VALID_TID}-{VALID_SID}-01-extra-field",
            "traceId": VALID_TID,
            "spanId": VALID_SID,
            "flags": 1,
            "sampled": True,
            "reformat": format_traceparent(future),
            "note": "trailing fields for future versions are dropped",
        }
    )
    invalid = [
        "",
        "x",
        "00-nothex-nothex-01",
        f"00-{VALID_TID.upper()}-{VALID_SID}-01",
        f"00-{'0' * 32}-{VALID_SID}-01",
        f"00-{VALID_TID}-{'0' * 16}-01",
        f"01-{VALID_TID}-{VALID_SID}-01",
        f"ff-{VALID_TID}-{VALID_SID}-ff",
        f"00-{VALID_TID}-{VALID_SID}",
        f"00-{VALID_TID}-{VALID_SID}-0",
        f"00-{VALID_TID}-{VALID_SID}-zz",
        f"0-{VALID_TID}-{VALID_SID}-01",
    ]
    state_vectors = []
    for header in (
        "foo=bar,baz",
        "FOO=bar,ok=1",
        f"a={'z' * 200},b=ok",
        "key-with-no-value",
        "a=b=c",
    ):
        members = parse_tracestate(header)
        state_vectors.append(
            {"header": header, "members": [[k, v] for k, v in members],
             "reformat": format_tracestate(members)}
        )
    return {"valid": valid, "invalid": invalid, "tracestate": state_vectors}


def _sampling_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    ops = ["risk.evaluate", "execution.transmit"]

    def record(
        mode: SamplingMode,
        ratio: float,
        trace_id: str,
        parent: bool | None,
        operation: str,
        *,
        priority: tuple[str, ...] = (),
    ) -> None:
        policy = SamplingPolicy(mode, ratio=ratio, priority_operations=priority)
        rows.append(
            {
                "mode": mode.value,
                "ratio": ratio,
                "ratioPpm": policy._ratio_ppm,
                "traceId": trace_id,
                "bucket": int(trace_id[:16], 16),
                "parentSampled": parent,
                "operation": operation,
                "priorityOperations": list(priority),
                "enabled": policy.enabled,
                "expected": policy.should_sample(
                    trace_id=trace_id, parent_sampled=parent, operation=operation
                ),
            }
        )

    for mode in (
        SamplingMode.DISABLED,
        SamplingMode.OFF,
        SamplingMode.ALL,
    ):
        record(mode, 0.0, VALID_TID, None, "risk.evaluate")
    half_threshold = (1 << 64) // 2
    record(SamplingMode.RATIO, 0.5, f"{half_threshold - 1:016x}{VALID_TID[16:]}", None, "risk.evaluate")
    record(SamplingMode.RATIO, 0.5, f"{half_threshold:016x}{VALID_TID[16:]}", None, "risk.evaluate")
    tiny_threshold = (1 << 64) * 1 // 1_000_000
    record(SamplingMode.RATIO, 0.000001, f"{tiny_threshold - 1:016x}{'0' * 16}", None, "risk.evaluate")
    record(SamplingMode.RATIO, 0.000001, f"{tiny_threshold:016x}{'0' * 16}", None, "risk.evaluate")
    record(SamplingMode.RATIO, 0.05, VALID_TID, None, "risk.evaluate")
    record(SamplingMode.RATIO, 1.0, "f" * 32, None, "risk.evaluate")
    record(SamplingMode.RATIO, 0.0, VALID_TID, True, "execution.transmit", priority=("execution.transmit",))
    record(SamplingMode.RATIO, 0.0, VALID_TID, None, ops[0])
    for parent in (True, False, None):
        record(SamplingMode.PARENT_BASED, 0.1, VALID_TID, parent, "risk.evaluate")
    rows.append(
        {
            "mode": "constant",
            "ratio": 0,
            "ratioPpm": 65536,
            "traceId": "0" * 32,
            "bucket": 0,
            "parentSampled": None,
            "operation": "risk.evaluate",
            "priorityOperations": [],
            "enabled": True,
            "expected": True,
            "note": (
                "row with a fabricated all-zero trace id fed straight into "
                "should_sample: bucket 0 is under every positive threshold; "
                "note that Tracer.start_span rejects all-zero ids BEFORE "
                "sampling via the W3C validity rule, so this row tests the "
                "pure function, not the tracer path"
            ),
        }
    )
    return rows


def _otlp_payloads() -> dict[str, Any]:
    def make_span(
        *,
        trace: str,
        span_id: str,
        parent: str | None,
        name: str,
        kind: SpanKind,
        start: int,
        end: int,
        attributes: dict[str, Any],
        events: list[dict[str, Any]] | None,
        status: SpanStatus,
        description: str | None,
        resource: dict[str, str],
        tracestate: tuple[tuple[str, str], ...] = (),
        dropped_attrs: int = 0,
        dropped_events: int = 0,
    ) -> Span:
        span = Span(
            context=TraceContext(
                trace_id=trace,
                span_id=span_id,
                parent_span_id=parent,
                trace_flags=1,
                tracestate=tracestate,
            ),
            name=name,
            kind=kind,
            attributes=dict(attributes),
            events=list(events or []),
            status=status,
            status_description=description,
            start_unix_nano=start,
            end_unix_nano=end,
            duration_nanos=end - start,
            resource=dict(resource),
        )
        span._ended = True
        span._dropped_attrs = dropped_attrs
        span._dropped_events = dropped_events
        return span

    base: dict[str, Any] = {
        "trace": "a" * 32,
        "span_id": "1234567890abcdef",
        "parent": None,
        "name": "risk.evaluate",
        "kind": SpanKind.INTERNAL,
        "start": 1_700_000_000_000_000_000,
        "end": 1_700_000_000_000_001_500,
        "attributes": {
            "trade.symbol": "BTCUSDT",
            "risk.simulated": "false",
            "risk.event_count": 0,
            "approved": True,
        },
        "events": [
            {
                "name": "milestone",
                "time_unix_nano": 1_700_000_000_000_500_000,
                "attributes": {"detail": "reservation admitted"},
            }
        ],
        "status": SpanStatus.OK,
        "description": None,
        "resource": {"service.name": "trading-engine", "deployment.environment": "test"},
    }
    single = make_span(**base)
    child = make_span(
        **{
            **base,
            "trace": "b" * 32,
            "span_id": "fedcba0987654321",
            "parent": "1234567890abcdef",
            "name": "execution.transmit",
            "kind": SpanKind.CLIENT,
            "start": 1_700_000_000_000_000_000,
            "status": SpanStatus.ERROR,
            "description": 'connect postgres://u:p@db failed "quoted" \\n',
            "tracestate": (("vendor", "v=1"), ("solo", "")),
            "dropped_attrs": 3,
            "dropped_events": 1,
            "events": [
                {
                    "name": "exception",
                    "time_unix_nano": 1_700_000_000_000_999_999,
                    "attributes": {
                        "exception.type": "ConnectionError",
                        "exception.message": "[REDACTED]@db:5432 down",
                    },
                }
            ],
        }
    )
    int64_edge = make_span(
        **{
            **base,
            "trace": "c" * 32,
            "span_id": "ffffffffffffffff",
            "start": 9_223_372_036_854_775_807,
            "end": 9_223_372_036_854_775_808,
            "attributes": {"big.count": 2**53 + 1, "neg": -7, "zero": 0},
            "events": [],
            "status": SpanStatus.UNSET,
        }
    )
    other_resource = make_span(
        **{**base, "trace": "d" * 32, "span_id": "abcdabcdabcdabcd", "resource": {"service.name": "api"}}
    )
    return {
        "single": otlp_json_encode([single]),
        "twoSpansOneResource": otlp_json_encode([child, single]),
        "int64Edge": otlp_json_encode([int64_edge]),
        "twoResources": otlp_json_encode([other_resource, single, child]),
        "empty": otlp_json_encode([]),
    }


def _redaction_rows() -> list[dict[str, Any]]:
    cases = [
        ("approved", True),
        ("event_count", 7),
        ("note", "plain text"),
        ("ratio", 1.25),
        ("api_key", "AAAABBBB"),
        ("authorization", "Bearer xyz"),
        ("password", "hunter2"),
        ("UPPERKEY", "x"),
        ("key with spaces", "x"),
        ("detail", "postgres://user:secret@db:5432/x"),
        ("long", "y" * 400),
        ("nested", {"a": 1}),
        ("none_value", None),
    ]
    rows = []
    for key, value in cases:
        entry = _safe_attribute(key, value)
        rows.append(
            {
                "key": key,
                "value": None if not isinstance(value, (str, int, bool, float)) else value,
                "kept": entry is not None,
                "renderedKey": entry[0] if entry else None,
                "renderedValue": entry[1] if entry else None,
            }
        )
    return rows


def _budget_rows() -> list[dict[str, Any]]:
    rows = []
    for objective, good, bad in (
        ("99.5", 995, 5),
        ("99.5", 999, 1),
        ("99.5", 0, 0),
        ("99.9999", 2_999_998, 2),
        ("99.95", 999, 1),
        ("99.0", 100, 1),
        ("95", 9_999_990, 10),
        ("99.5", 2, 1),
    ):
        rows.append(
            {
                "objective": objective,
                "good": good,
                "bad": bad,
                "budget": compute_budget(objective=objective, good=good, bad=bad).to_dict(),
            }
        )
    return rows


def _burn_rows() -> list[dict[str, Any]]:
    rows = []
    for short in (None, 5_999_999, 6_000_000, 14_399_999, 14_400_000, 20_000_000):
        for long in (None, 1_000_000, 6_000_000, 14_400_000):
            state = evaluate_burn(
                short_burn_ppm=short,
                long_burn_ppm=long,
                fast_multiplier_ppm=14_400_000,
                slow_multiplier_ppm=6_000_000,
            )
            rows.append(
                {
                    "shortBurnPpm": short,
                    "longBurnPpm": long,
                    "fastThresholdPpm": 14_400_000,
                    "slowThresholdPpm": 6_000_000,
                    "expected": state.to_dict(),
                }
            )
    return rows


def _slo_rows() -> dict[str, Any]:
    def sample(good: int, bad: int, complete: bool = True, note: str | None = None) -> dict[str, Any]:
        return {"good": good, "bad": bad, "dataComplete": complete, "note": note}

    scenarios = [
        (
            "healthy",
            {
                "slo_id": "test.availability",
                "service": "test",
                "description": "Parity scenario.",
                "owner": "sre",
                "indicator": SloIndicator.AVAILABILITY.value,
                "objective": "99.5",
                "window_minutes": 1440,
                "short_window_minutes": 60,
                "good_event": "no 5xx",
                "bad_event": "5xx",
            },
            sample(100_000, 1),
            sample(1_000, 0),
            14_400_000,
            6_000_000,
        ),
        (
            "unknown-incomplete",
            {
                "slo_id": "test.availability",
                "service": "test",
                "description": "Parity scenario.",
                "owner": "sre",
                "indicator": SloIndicator.AVAILABILITY.value,
                "objective": "99.5",
                "window_minutes": 1440,
                "short_window_minutes": 60,
                "good_event": "no 5xx",
                "bad_event": "5xx",
            },
            sample(1_000_000, 0, complete=False),
            sample(10_000, 0),
            14_400_000,
            6_000_000,
        ),
        (
            "no-samples",
            {
                "slo_id": "test.availability",
                "service": "test",
                "description": "Parity scenario.",
                "owner": "sre",
                "indicator": SloIndicator.AVAILABILITY.value,
                "objective": "99.5",
                "window_minutes": 1440,
                "short_window_minutes": 60,
                "good_event": "no 5xx",
                "bad_event": "5xx",
            },
            sample(0, 0),
            sample(0, 0),
            14_400_000,
            6_000_000,
        ),
        (
            "exhausted-long-window",
            {
                "slo_id": "test.api",
                "service": "api",
                "description": "Parity scenario two.",
                "owner": "platform-sre",
                "indicator": SloIndicator.REQUEST_SUCCESS_RATIO.value,
                "objective": "99.9",
                "window_minutes": 2880,
                "short_window_minutes": 120,
                "good_event": "2xx/3xx/4xx",
                "bad_event": "5xx",
                "warning_burn_ppm": 1_000_000,
                "critical_burn_ppm": 2_000_000,
            },
            sample(997_000, 3_000),
            sample(40_000, 600),
            14_400_000,
            6_000_000,
        ),
        (
            "critical-band",
            {
                "slo_id": "test.tiny-budget",
                "service": "test",
                "description": "Parity scenario three.",
                "owner": "sre",
                "indicator": SloIndicator.ERROR_RATE_COMPLIANCE.value,
                "objective": "99.95",
                "window_minutes": 1440,
                "short_window_minutes": 60,
                "good_event": "no fault",
                "bad_event": "fault",
                "warning_burn_ppm": 1_000_000,
                "critical_burn_ppm": 2_000_000,
            },
            sample(999, 1),
            sample(999, 1),
            14_400_000,
            6_000_000,
        ),
    ]
    evaluations = []
    for name, defn, long_row, short_row, fast, slow in scenarios:
        definition = SloDefinition(**{**defn, "indicator": SloIndicator(defn["indicator"])})
        evaluation = evaluate_slo(
            definition,
            long_window=SloWindowSample(
                good=long_row["good"], bad=long_row["bad"],
                data_complete=long_row["dataComplete"], note=long_row["note"],
            ),
            short_window=SloWindowSample(
                good=short_row["good"], bad=short_row["bad"],
                data_complete=short_row["dataComplete"], note=short_row["note"],
            ),
            evaluated_at_micros=1_700_000_000_000_000,
            fast_multiplier_ppm=fast,
            slow_multiplier_ppm=slow,
        )
        expected = evaluation.to_dict()
        expected.pop("reason", None)
        evaluations.append(
            {
                "name": name,
                "definition": {k.replace("_", ""): v for k, v in defn.items()},
                "longWindow": long_row,
                "shortWindow": short_row,
                "fastMultiplierPpm": fast,
                "slowMultiplierPpm": slow,
                "expected": expected,
            }
        )

    checksum_vectors = []
    for defn in (
        {
            "slo_id": "test.availability",
            "service": "test",
            "description": "Canonical spelling A.",
            "owner": "sre",
            "indicator": "availability",
            "objective": "99.50",
            "window_minutes": 1440,
            "short_window_minutes": 60,
            "good_event": "no 5xx",
            "bad_event": "5xx",
        },
        {
            "slo_id": "test.prose",
            "service": "test",
            "description": "Prose moves the digest.",
            "owner": "sre",
            "indicator": "availability",
            "objective": "99.5",
            "window_minutes": 1440,
            "short_window_minutes": 60,
            "good_event": "2xx",
            "bad_event": "5xx",
        },
        {
            "slo_id": "test.freshness",
            "service": "test",
            "description": "Freshness with threshold.",
            "owner": "sre",
            "indicator": "market_data_freshness",
            "objective": "99.0",
            "window_minutes": 10080,
            "short_window_minutes": 30,
            "good_event": "within budget",
            "bad_event": "over budget",
            "max_age_micros": 30_000_000,
        },
    ):
        definition = SloDefinition(**{**defn, "indicator": SloIndicator(defn["indicator"])})
        payload = canonical_slo_json(definition.canonical_payload())
        checksum_vectors.append(
            {
                "canonicalJson": payload,
                "sha256": hashlib.sha256(payload.encode("utf-8")).hexdigest(),
                "engineChecksum": slo_checksum(definition),
            }
        )
    assert all(v["sha256"] == v["engineChecksum"] for v in checksum_vectors)

    catalog = []
    for d in DEFAULT_SLO_CATALOG:
        catalog.append(
            {
                "sloId": d.slo_id,
                "service": d.service,
                "owner": d.owner,
                "indicator": d.indicator.value,
                "objective": d.objective,
                "objectivePpm": compute_budget(objective=d.objective, good=0, bad=0).objective_ppm,
                "allowedPpm": compute_budget(objective=d.objective, good=0, bad=0).allowed_ppm,
                "windowMinutes": d.window_minutes,
                "shortWindowMinutes": d.short_window_minutes,
                "warningBurnPpm": d.warning_burn_ppm,
                "criticalBurnPpm": d.critical_burn_ppm,
                "maxAgeMicros": (
                    str(d.max_age_micros) if d.max_age_micros is not None else None
                ),
                "latencyThresholdMicros": (
                    str(d.latency_threshold_micros)
                    if d.latency_threshold_micros is not None
                    else None
                ),
                "checksum": slo_checksum(d),
            }
        )
    return {
        "evaluations": evaluations,
        "checksumVectors": checksum_vectors,
        "catalog": catalog,
    }


def main() -> int:
    fixture = {
        "part": "10",
        "generator": "libs/trading-core/scripts/gen_part10_fixtures.py",
        "note": (
            "Committed cross-language vectors for Part 10. The TS services "
            "must reproduce every value below from their own implementation. "
            "Nothing here authorises a trade; measurement only."
        ),
        "traceparent": _traceparent_vectors(),
        "sampling": {"rows": _sampling_rows()},
        "otlpJson": _otlp_payloads(),
        "attributeHygiene": _redaction_rows(),
        "budgetRows": _budget_rows(),
        "burnRows": _burn_rows(),
        "slo": _slo_rows(),
        "enums": {
            "sloStates": [s.value for s in SloState],
            "sloIndicators": [i.value for i in SloIndicator],
            "sloWindowKinds": [k.value for k in SloWindowKind],
            "samplingModes": [m.value for m in SamplingMode],
            "tracedOperations": sorted(TRACED_OPERATIONS),
            "faultPoints": sorted(faults_module.FAULT_POINTS),
            "allowedLabelNames": sorted(ALLOWED_LABEL_NAMES),
            "alertRules": [
                {
                    "ruleId": r.rule_id,
                    "severity": r.severity.value,
                    "requiresRecovery": r.requires_recovery,
                    "blocksTrading": r.blocks_trading,
                }
                for r in ALERT_RULES
            ],
        },
    }
    text = json.dumps(fixture, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    old = FIXTURE_PATH.read_text(encoding="utf-8") if FIXTURE_PATH.exists() else None
    FIXTURE_PATH.write_text(text, encoding="utf-8")
    print(
        f"wrote {FIXTURE_PATH} ({len(text)} bytes"
        + (", unchanged" if old == text else ", updated")
        + ")"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
