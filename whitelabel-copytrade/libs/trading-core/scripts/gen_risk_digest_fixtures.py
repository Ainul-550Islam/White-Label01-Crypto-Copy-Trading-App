"""Generate the Part 8 cross-language digest fixtures.

WHY THIS FILE EXISTS
    The API's `risk.digest.ts` is a hand-written replica of Python's
    canonicalisation (`wlct_trading.risk.configuration`): Decimal.normalize
    string forms, recursive sort-keys JSON, sha256 over UTF-8. A replica is
    only trustworthy against its source, and asserting the same rules twice
    in two languages by hand is how replicas drift. So Python computes the
    answers here, at generation time, and the TypeScript spec only ever
    compares its output against the fixture.

RUN IT
    python scripts/gen_risk_digest_fixtures.py   # from libs/trading-core
    Writes docs/fixtures/risk_digest_fixtures.json (repo root docs/).

The fixture is INPUT + EXPECTED only - no logic. Regenerate whenever the
Python canonicalisation changes; the TS spec will then fail until
risk.digest.ts is aligned, which is precisely the point.
"""

from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wlct_trading.enums import (  # noqa: E402
    RISK_RULE_ORDER,
    RISK_RULE_UNITS,
    RISK_SWITCH_TRANSITIONS,
)
from wlct_trading.risk.configuration import (  # noqa: E402
    RiskConfiguration,
    RiskLimitEntry,
)
from wlct_trading.risk.correlation import CorrelationGroup  # noqa: E402
from wlct_trading.risk.protections import (  # noqa: E402
    AutomaticProtectionPolicy,
)
from wlct_trading.enums import (  # noqa: E402
    PriceReferenceKind,
)


def _entry(
    rule: str,
    scope: str,
    target: str | None,
    value: str,
    unit: str,
    *,
    enabled: bool = True,
    priority: int = 0,
    window_micros: int | None = None,
    effective_from: int = 0,
    effective_until: int | None = None,
    entry_version: int = 1,
) -> dict[str, Any]:
    return {
        "ruleId": rule,
        "scope": scope,
        "target": target,
        "enabled": enabled,
        "value": value,
        "unit": unit,
        "priority": priority,
        "effectiveFromMicros": effective_from,
        "effectiveUntilMicros": effective_until,
        "entryVersion": entry_version,
        "windowMicros": window_micros,
    }


def _config(payload_entries: list[dict[str, Any]], case: dict[str, Any]) -> RiskConfiguration:
    entries = [RiskLimitEntry.from_payload(e) for e in payload_entries]
    groups = tuple(
        CorrelationGroup(
            name=g["name"],
            exchange=g["exchange"],
            members=frozenset(g["members"]),
            max_notional=None if g.get("maxNotional") is None else Decimal(str(g["maxNotional"])),
            rationale=g.get("rationale", ""),
        )
        for g in case.get("correlationGroups", [])
    )
    policy_raw = case.get("protectionPolicy")
    policy = (
        AutomaticProtectionPolicy.from_payload(policy_raw)
        if policy_raw is not None
        else AutomaticProtectionPolicy()
    )
    fee = case.get("feeRateBps")
    return RiskConfiguration(
        entries=entries,
        config_version=case.get("configVersion", 1),
        correlation_groups=groups,
        protection_policy=policy,
        daily_loss_includes_unrealized=bool(case.get("dailyLossIncludesUnrealized", False)),
        daily_loss_includes_fees=bool(case.get("dailyLossIncludesFees", True)),
        price_deviation_reference=PriceReferenceKind(
            case.get("priceDeviationReference", "SIDE_TOUCH")
        ),
        fee_rate_bps=None if fee is None else Decimal(str(fee)),
        notes=case.get("notes", ""),
    )


CASES: list[dict[str, Any]] = [
    {
        "name": "minimal-global",
        "entries": [
            _entry("MAX_ORDER_NOTIONAL", "GLOBAL", None, "1000", "QUOTE_NOTIONAL"),
            _entry("MAX_DAILY_LOSS", "GLOBAL", None, "500", "LOSS"),
        ],
    },
    {
        "name": "hierarchy-with-windows",
        "notes": "tightest-wins demo; strategy window is time-boxed",
        "entries": [
            _entry("MAX_ORDER_NOTIONAL", "GLOBAL", None, "1000", "QUOTE_NOTIONAL"),
            _entry(
                "MAX_ORDER_NOTIONAL",
                "EXCHANGE",
                "binance",
                "800.000",
                "QUOTE_NOTIONAL",
                priority=10,
            ),
            _entry(
                "MAX_ORDER_NOTIONAL",
                "STRATEGY",
                "strat-alpha",
                "0.2500",
                "QUOTE_NOTIONAL",
                effective_from=1_700_000_000_000_000,
                effective_until=1_800_000_000_000_000,
                entry_version=3,
            ),
            _entry(
                "MAX_POSITION_NOTIONAL",
                "ACCOUNT",
                "acct-1",
                "5000",
                "QUOTE_NOTIONAL",
            ),
            _entry(
                "MAX_SYMBOL_EXPOSURE",
                "SYMBOL",
                "BTCUSDT",
                "1000000",
                "QUOTE_NOTIONAL",
                enabled=False,
            ),
            _entry(
                "MAX_ORDER_RATE",
                "GLOBAL",
                None,
                "2",
                "COUNT",
                window_micros=1_000_000,
            ),
            _entry(
                "MAX_ORDER_RATE",
                "GLOBAL",
                None,
                "30",
                "COUNT",
                window_micros=60_000_000,
            ),
            _entry(
                "MAX_STALE_DATA_AGE",
                "GLOBAL",
                None,
                "2000000",
                "AGE_MICROS",
            ),
        ],
    },
    {
        "name": "correlation-and-fees-and-unrealized",
        "dailyLossIncludesUnrealized": True,
        "feeRateBps": "7.5",
        "priceDeviationReference": "MID",
        "configVersion": 9,
        "protectionPolicy": {
            "dailyLossAction": "BLOCK_ACCOUNT",
            "strategyDailyLossAction": "BLOCK_STRATEGY",
            "drawdownAction": "BLOCK_ACCOUNT",
            "consecutiveLossesAction": "BLOCK_ACCOUNT",
            "orderRateAction": "BLOCK_STRATEGY",
            "cancelRateAction": "BLOCK_STRATEGY",
            "staleRiskStateAction": "BLOCK_NEW_RISK",
            "allowRiskReducingOrders": False,
        },
        "correlationGroups": [
            {
                "name": "eth-proxies",
                "exchange": "binance",
                "members": ["ETHUSDT", "ETHBTC", "WETHUSDT"],
                "maxNotional": "10000.00",
                "rationale": "same underlying; move together intraday",
            },
            {
                "name": "solana-beta",
                "exchange": "binance",
                "members": ["SOLUSDT", "JUPUSDT"],
                "maxNotional": None,
                "rationale": "ecosystem correlation, ceiling documented elsewhere",
            },
        ],
        "entries": [
            _entry("MAX_SYMBOL_EXPOSURE", "GLOBAL", None, "5000", "QUOTE_NOTIONAL"),
            _entry(
                "MAX_CORRELATION_GROUP_EXPOSURE",
                "GLOBAL",
                None,
                "0.000001",
                "QUOTE_NOTIONAL",
            ),
            _entry("MAX_LEVERAGE", "GLOBAL", None, "3", "LEVERAGE_X"),
            _entry("MAX_CONSECUTIVE_LOSSES", "GLOBAL", None, "5", "COUNT"),
        ],
    },
    {
        "name": "exotic-decimals",
        "entries": [
            _entry("MAX_ORDER_NOTIONAL", "GLOBAL", None, "5000", "QUOTE_NOTIONAL"),
            _entry("MAX_ORDER_QUANTITY", "GLOBAL", None, "100.10", "BASE_QUANTITY"),
            _entry("MAX_POSITION_QUANTITY", "GLOBAL", None, "0.0000004", "BASE_QUANTITY"),
            _entry(
                "MAX_PRICE_DEVIATION",
                "GLOBAL",
                None,
                "250.000",
                "BPS",
            ),
            _entry(
                "MAX_ACCOUNT_EXPOSURE",
                "ACCOUNT",
                "acct-1",
                "100000000000000",
                "QUOTE_NOTIONAL",
            ),
        ],
    },
]


def decimal_cases() -> list[dict[str, str]]:
    raw = [
        "0",
        "0.000",
        "5",
        "5000",
        "0.2500",
        "100.00",
        "1000000",
        "1000000.000000",
        "0.000001",
        "0.0000004",
        "-3000.500",
        "12345.67890000",
        "1000000000000000.000000000001",
        "7.5",
        "250.000",
        "100000000000000",
        "0.00000000025",
        "1000.10",
        "0.50",
    ]
    out: list[dict[str, str]] = []
    for text in raw:
        normalised = Decimal(text).normalize()
        out.append(
            {
                "input": text,
                "normalized": str(normalised),
                # str(Decimal(text)) - what a Python-side entry keeps when
                # built from the RAW input. The API's documents store the
                # NORMALISED form, so Python-side loads see a fixed point:
                # str(Decimal(normalized)) == normalized, asserted in TS.
                "pythonStoredRaw": str(Decimal(text)),
            }
        )
    return out


def comparison_cases() -> list[dict[str, Any]]:
    pairs = [
        ("5000", "5E+3"),
        ("0.2500", "0.25"),
        ("100", "100.0"),
        ("0.000001", "0.0000009999"),
        ("-3000.5", "-3000.50"),
        ("12345.6789", "12345.67890000"),
        ("1000000", "999999.999999"),
        ("0", "0.000"),
        ("250", "2.5E+2"),
    ]
    out: list[dict[str, Any]] = []
    for left, right in pairs:
        sign = (Decimal(left) > Decimal(right)) - (Decimal(left) < Decimal(right))
        out.append({"left": left, "right": right, "sign": sign})
    return out


def main() -> int:
    fixture_cases: list[dict[str, Any]] = []
    for case in CASES:
        config = _config(case["entries"], case)
        payload = config.canonical_payload()
        # The entry constructor normalises its Decimal; to_payload writes
        # str(value). Record both the raw input and what Python stored so
        # TS can test the normalisation and the document assembly in order.
        fixture_cases.append(
            {
                "name": case["name"],
                "rawEntries": case["entries"],
                "canonicalPayload": payload,
                "canonicalJson": config.canonical_json(),
                "digest": config.digest,
            }
        )

    units = {rule.value: [unit.value for unit in units_] for rule, units_ in RISK_RULE_UNITS.items()}
    transitions = {
        status.value: sorted(target.value for target in targets)
        for status, targets in RISK_SWITCH_TRANSITIONS.items()
    }

    document = {
        "version": 1,
        "generatedBy": "libs/trading-core/scripts/gen_risk_digest_fixtures.py",
        "ruleOrder": [rule.value for rule in RISK_RULE_ORDER],
        "ruleUnits": units,
        "switchTransitions": transitions,
        "decimalNormalizations": decimal_cases(),
        "decimalComparisons": comparison_cases(),
        "cases": fixture_cases,
    }
    out_path = (
        Path(__file__).resolve().parents[3]
        / "docs"
        / "fixtures"
        / "risk_digest_fixtures.json"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {out_path} ({out_path.stat().st_size} bytes, {len(fixture_cases)} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
