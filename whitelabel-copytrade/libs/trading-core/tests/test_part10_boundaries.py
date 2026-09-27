"""Part 10 boundary guards: what the reliability code is forbidden to do.

These are source scans, executed by the normal test run (no CI plugin to
forget to enable), exactly like the Part 8/9 boundary discipline they mirror:

* the SLO engine, tracing primitives and fault injector carry no
  suppressions and no ambient I/O;
* the SLO/tracing packages never read the wall clock for DELTAS - durations
  come from the platform clock helpers so a clock jump cannot forge an
  error-budget row;
* nothing in wlct_trading.slo imports anything outside common/clock/decimal
  territory - the package must stay embeddable anywhere the API can run it;
* the tracer cannot authorise: execution/risk modules import exactly the
  tracing types they need and never import anything back from a hypothetical
  "tracing decision" surface (no module in the repo may import
  ``wlct_trading.slo`` into the execution path).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

CORE_ROOT = Path(__file__).resolve().parent.parent
WLC = CORE_ROOT / "wlct_trading"

PART10_SOURCES = sorted(
    [*(WLC / "slo").glob("*.py"), WLC / "observability" / "tracing.py", WLC / "observability" / "faults.py"]
)


def _sources() -> list[tuple[Path, str]]:
    assert PART10_SOURCES, "Part 10 sources must exist"
    return [(path, path.read_text(encoding="utf-8")) for path in PART10_SOURCES]


class TestNoSuppressionsOrAmbientIo:
    def test_no_type_or_lint_suppressions(self) -> None:
        for path, text in _sources():
            for pattern in ("# type: ignore", "# noqa", "# ruff:"):
                assert pattern not in text, f"{path.name} carries {pattern!r}"

    def test_no_direct_file_or_network_io(self) -> None:
        banned_imports = re.compile(
            r"^\s*(?:import|from)\s+(socket|ssl|http|urllib|requests|aiohttp|httpx|os|subprocess|pathlib|shutil)(?:\s|\.)",
            re.MULTILINE,
        )
        for path, text in _sources():
            assert banned_imports.search(text) is None, path.name
            assert not re.search(r"\bopen\s*\(", text), path.name

    def test_no_wallclock_deltas(self) -> None:
        # Durations must come from wlct_trading.clock helpers (which the
        # backtest and replay paths can simulate); raw time.time()/datetime
        # deltas would make an NTP jump a reliability event.
        for path, text in _sources():
            executable = "\n".join(
                line
                for line in text.splitlines()
                if not line.lstrip().startswith(("#", '"'))
            )
            assert not re.search(r"\bdatetime\b", executable), path.name
            assert not re.search(r"\btime\.time\s*\(", executable), path.name
            assert not re.search(
                r"^\s*(?:import|from)\s+time\b", executable, re.MULTILINE
            ), path.name


class TestSloPackagePurity:
    ALLOWED_ROOT_IMPORTS = {
        "__future__",
        "dataclasses",
        "decimal",
        "enum",
        "json",
        "re",
        "typing",
        "hashlib",
        "collections",
    }

    def test_imports_stay_inside_the_allowlist(self) -> None:
        # The allowlist binds the SLO package (embeddable next to any
        # collector); tracing/faults get the same scan minus the clock
        # exception they legitimately need.
        slo_sources = [
            (path, text)
            for path, text in _sources()
            if path.parent.name == "slo"
        ]
        for path, text in slo_sources:
            tree = ast.parse(text, filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    root = node.names[0].name.split(".")[0]
                    assert root in self.ALLOWED_ROOT_IMPORTS, (path.name, root)
                elif isinstance(node, ast.ImportFrom):
                    if node.level > 0:
                        continue  # intra-package relative import
                    mod = node.module or ""
                    if mod.startswith("wlct_trading"):
                        allowed_local = (
                            "wlct_trading.clock",
                            "wlct_trading.common",
                        )
                        assert mod.startswith(allowed_local), (path.name, mod)
                    elif mod.startswith(("wlct_trading.observability", ".observability")):
                        raise AssertionError(
                            f"{path.name}: the SLO engine must not depend on "
                            "observability (it feeds it, never leans on it)"
                        )
                    elif mod and not mod.startswith("."):
                        root = mod.split(".")[0]
                        assert root in self.ALLOWED_ROOT_IMPORTS, (path.name, mod)

    def test_no_execution_or_risk_imports_anywhere_in_slo_or_tracing(self) -> None:
        offenders: list[str] = []
        for path, text in _sources():
            for name in ("execution", "adapters", "risk", "orders"):
                if re.search(
                    rf"^\s*(?:from|import)\s+wlct_trading\.{name}\b", text, re.MULTILINE
                ):
                    offenders.append(f"{path.name}:{name}")
        assert offenders == []


class TestTracerCannotAuthorise:
    """Instrumented modules may hold a tracer; nothing in the decision path
    may READ from telemetry. The one legitimate read is the export loop in
    the service hubs (outside wlct_trading), which drains spans to hand them
    to a collector - it cannot feed anything into a decision."""

    def test_trading_modules_never_drain_the_tracer(self) -> None:
        for name in (
            "risk/evaluator.py",
            "execution/engine.py",
            "strategies/lifecycle.py",
            "backtest/engine.py",
            "datasets/replay/source.py",
        ):
            text = (WLC / name).read_text(encoding="utf-8")
            assert ".drain(" not in text, name
            assert "drop_counts" not in text, name
            # The tracer's own export machinery lives in observability only.
            assert "otlp_json_encode" not in text, name

    def test_slo_package_is_not_imported_by_the_decision_path(self) -> None:
        offenders = []
        for package in ("risk", "execution", "strategies", "adapters"):
            for path in (WLC / package).rglob("*.py"):
                text = path.read_text(encoding="utf-8")
                if re.search(r"wlct_trading\.slo\b", text):
                    offenders.append(str(path.relative_to(CORE_ROOT)))
        assert offenders == []

    def test_instrumentation_is_injectable_and_defaults_to_none(self) -> None:
        # Every traced constructor takes ``tracer: Tracer | None = None`` -
        # there is no ambient global tracer to grab, so a process that never
        # wires tracing never pays for it and never records anything.
        anchors = {
            "risk/evaluator.py": "RiskGate",
            "execution/engine.py": "ExecutionEngine",
            "strategies/lifecycle.py": "StrategyEngine",
            "backtest/engine.py": "BacktestEngine",
        }
        for name, cls in anchors.items():
            text = (WLC / name).read_text(encoding="utf-8")
            tree = ast.parse(text, filename=name)
            class_node = next(
                n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == cls
            )
            init = next(
                n for n in class_node.body if isinstance(n, ast.FunctionDef) and n.name == "__init__"
            )
            defaults: dict[str, ast.expr | None] = {
                a.arg: None for a in init.args.args if a.arg != "self"
            }
            offset = len(init.args.args) - len(init.args.defaults)
            for index, a in enumerate(init.args.args):
                if a.arg == "self":
                    continue
                if index >= offset:
                    defaults[a.arg] = init.args.defaults[index - offset]
            defaults.update(
                {a.arg: d for a, d in zip(init.args.kwonlyargs, init.args.kw_defaults)}
            )
            assert "tracer" in defaults, name
            default = defaults["tracer"]
            assert isinstance(default, ast.Constant) and default.value is None, name


class TestFaultPointsAreWiredToNothingCritical:
    def test_production_wiring_reads_faults_only_in_observability_and_services(self) -> None:
        # wlct_trading core must not consult the injector: simulated fault
        # conditions live at the service edges (exporters, probes, harness
        # fixtures), never inside decision code.
        offenders = []
        for package in ("risk", "execution", "adapters", "strategies", "orders"):
            directory = WLC / package
            if not directory.is_dir():
                continue
            for path in directory.rglob("*.py"):
                text = path.read_text(encoding="utf-8")
                if re.search(
                    r"from wlct_trading\.observability\.faults|import faults\b|FailureInjector",
                    text,
                ):
                    offenders.append(str(path.relative_to(CORE_ROOT)))
        assert offenders == []
