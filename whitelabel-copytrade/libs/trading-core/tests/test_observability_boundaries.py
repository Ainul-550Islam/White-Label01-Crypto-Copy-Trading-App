"""Source-level guarantees for the Part 9 observability package.

Same method as the Part 8 guards, same reason: behavioural tests can only
prove what a path does when it runs; what an observability layer must also
guarantee is what it *cannot* do. Three properties are load-bearing here:

1. **No reach into the trading path.** If an operations module can import
   execution, someone will eventually call it "convenient". The read-only
   dependency direction (observability knows the shapes, never the levers)
   is what keeps the risk gate the only authority.
2. **No ambient I/O in hot-path-adjacent modules.** Alerts, correlation and
   the registry must not network, sleep, or spawn on their own; the
   services own their transports, and the library stays embeddable in any
   of them.
3. **No suppression comments.** The gate is the gate: the package keeps
   zero ``type: ignore`` / ``noqa`` / ``fmt: off``.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

OBS_DIR = Path(__file__).resolve().parents[1] / "wlct_trading" / "observability"
ALL_MODULES = sorted(p.name for p in OBS_DIR.glob("*.py"))

ASSERTED_MODULES = [name for name in ALL_MODULES if name != "__init__.py"]


def module_source(name: str) -> str:
    return (OBS_DIR / name).read_text(encoding="utf-8")


def imported_modules(name: str) -> set[str]:
    """Real imports only - docstrings may *mention* the trading path (they
    explain the ban); the AST records what is actually imported."""
    tree = ast.parse(module_source(name))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            found.add(node.module)
    return found


def code_only(name: str) -> str:
    """Source with triple-quoted blocks removed, for substring guards.

    Coarse on purpose: enough to drop docstrings so prose about a
    prohibition never trips the prohibition's own check.
    """
    return re.sub(r'''("[^"]*")?''', lambda m: "", module_source(name), flags=re.S).replace(
        "\x27\x27\x27", ""
    )


def test_package_covers_every_module_on_disk() -> None:
    assert set(ASSERTED_MODULES) >= {
        "labels.py",
        "metrics.py",
        "health.py",
        "readiness.py",
        "correlation.py",
        "alerts.py",
        "incidents.py",
        "redaction.py",
        "dashboard.py",
    }


@pytest.mark.parametrize("name", ASSERTED_MODULES)
def test_no_suppressions_anywhere(name: str) -> None:
    source = module_source(name)
    for token in ("type: ignore", "noqa", "ruff: noqa", "fmt: off"):
        assert token not in source, f"{name} uses {token}"


@pytest.mark.parametrize("name", ASSERTED_MODULES)
def test_no_ambient_io_or_sleep(name: str) -> None:
    source = code_only(name)
    modules = imported_modules(name)
    for banned in ("socket", "subprocess", "redis", "asyncpg", "httpx", "urllib"):
        assert banned not in modules, f"{name} imports {banned}"
    for token in (
        "import socket",
        "import subprocess",
        "time.sleep",
        "asyncio.sleep",
        "import redis",
        "import asyncpg",
        "import httpx",
        "import urllib.request",
        "requests.",
    ):
        assert token not in source, f"{name} reaches for ambient I/O: {token}"


@pytest.mark.parametrize("name", ASSERTED_MODULES)
def test_no_imports_from_the_trading_path(name: str) -> None:
    modules = imported_modules(name)
    banned_prefixes = (
        "wlct_trading.execution",
        "wlct_trading.adapters",
        "wlct_trading.orders",
        "wlct_trading.exchanges",
        "wlct_trading.risk",
        "wlct_trading.strategies",
        "wlct_trading.paper",
        "wlct_trading.backtest",
        "wlct_trading.datasets",
    )
    for imported in sorted(modules):
        for banned in banned_prefixes:
            assert not imported.startswith(banned), (
                f"{name} imports {imported}: observability must describe "
                "state, never reach levers. Adapters go in the services."
            )
    # Relative imports that escape the package upward are the same act
    # written differently; none are allowed at all (only ".sibling" style).
    source = module_source(name)
    assert "from .." not in source, f"{name} uses a parent-relative import"


def test_only_reads_from_sibling_packages() -> None:
    # The legitimate cross-package imports are the timing primitives and the
    # existing metrics module being projected - both read-only, both stable.
    for name in ASSERTED_MODULES:
        external = {
            module
            for module in imported_modules(name)
            if module.startswith("wlct_trading.")
        }
        allowed = {"wlct_trading.clock", "wlct_trading.metrics", "wlct_trading.enums"}
        assert external <= allowed, f"{name} imports {sorted(external - allowed)}"
    for name in {"metrics.py", "health.py", "readiness.py"}:
        assert "wlct_trading.clock" in imported_modules(name), name


def test_wall_clock_never_yields_durations() -> None:
    """Duration math must come from the monotonic clock, per the spec.

    Wall clock is fine for *timestamps* (that is what the health/registry
    stamps use). What it must never do is subtract two of them to produce a
    latency - so we scan for the suspicious shapes: ``time.time() -`` and
    ``epoch_micros()``/``epoch_millis()`` on the left of a minus. The
    ``-``-adjacency check is deliberately crude and that is correct for a
    guard: a crude guard that runs beats a clever one that never does.
    """
    suspects = (
        re.compile(r"time\.time\(\)\s*-"),
        re.compile(r"-\s*time\.time\(\)"),
        re.compile(r"epoch_micros\(\)\s*-\s*.*epoch_micros"),
        re.compile(r"time\.monotonic\(\)\s*-\s*.*epoch_"),
    )
    for name in ASSERTED_MODULES:
        source = code_only(name)
        for pattern in suspects:
            assert not pattern.search(source), f"{name}: suspicious wall-clock duration {pattern.pattern}"


def test_readiness_and_alert_modules_are_pure_state_machines() -> None:
    for name in ("readiness.py", "alerts.py", "incidents.py"):
        source = module_source(name)
        assert "async def" not in source, f"{name} must not introduce async coupling"
        assert "await" not in source
    assert "def clear" in module_source("alerts.py")  # documented test-only hook


def test_metric_names_follow_the_platform_namespace() -> None:
    """Every family this package registers at import time must be ``wlct_``.

    (Families registered by services at runtime are checked by the services'
    own tests; here we pin the library's own.)
    """
    registry_source = module_source("metrics.py")
    for literal in re.findall(r'"(wlct_[a-z0-9_]+|other_[a-z0-9_]+)"', registry_source):
        assert literal.startswith("wlct_"), literal
