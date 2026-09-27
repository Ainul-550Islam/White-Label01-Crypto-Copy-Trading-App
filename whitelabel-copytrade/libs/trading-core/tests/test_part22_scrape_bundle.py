"""Part 22: the scrape-side bundle, its generator, and the one overlay that reads it.

The headline test here is ``test_check_passes_on_the_committed_bundle``: every artifact under
``infrastructure/observability/`` in this repository must be byte-identical to what the generator
renders from the files it reads (compose, the services' routers, ``ALERT_RULES``). A bundle that
drifts from its sources is the failure this part exists to prevent, so the test does not check that
the generator *can* render - it checks that what is committed is what it renders right now.

Everything else is the refusal machinery, tested as refusals: each audit in ``compose_bundle`` is
fed a mutated artifact and must object. A generator whose checks only ever run against the one
output they were written for is a generator that has never been checked.

No network, no container, no scrape is performed: the tool reads text and writes text, and so does
this file. The two places that need a real Prometheus text format do not invent one - they build a
registry with the library's own API and let ``render_prometheus`` produce the input.
"""

from __future__ import annotations

import hashlib
import importlib.util
import re
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from wlct_trading.observability.alerts import ALERT_RULES, rule_for
from wlct_trading.observability.metrics import (
    ObservabilityRegistry,
    render_prometheus,
)

REPO = Path(__file__).resolve().parents[2].parent
SCRIPT = REPO / "libs" / "trading-core" / "scripts" / "gen_observability_bundle.py"
RELATIVE_SCRIPT = Path("libs/trading-core/scripts/gen_observability_bundle.py")

_SKIPPED: frozenset[str] = frozenset({".git", "node_modules", "__pycache__", ".venv"})

GENERATED: tuple[str, ...] = (
    "infrastructure/observability/prometheus/prometheus.yml",
    "infrastructure/observability/prometheus/rules/wlct.rules.yml",
    "infrastructure/observability/metrics-catalog.json",
    "infrastructure/observability/README.md",
)


@pytest.fixture(scope="session")
def bundle() -> ModuleType:
    """The generator as a module.

    It lives in ``scripts/``, not in ``wlct_trading``, because it is a build tool: importing it by
    path is how the tests reach the same functions the CLI runs, instead of re-implementing them and
    testing the re-implementation. The module bootstraps its own ``sys.path`` for the library import,
    so nothing here has to know that.
    """
    spec = importlib.util.spec_from_file_location("gen_observability_bundle", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def scratch_root(tmp_path: Path, *, compose: str | None = None) -> Path:
    """A tree that is the repository, with one file replaced.

    Symlinks rather than copies: a copy of ``services/`` would be a snapshot that ages during the
    test run, and the whole point of these tests is that the bundle tracks the real source.
    """
    for name in ("libs", "apps", "services", "docs", ".env.example"):
        (tmp_path / name).symlink_to(REPO / name)
    # The overlay is hand-written and not regenerated, so a tree that wants to pass `--check` has
    # to carry it: a missing deployment file is drift, and this helper must not hide that.
    (tmp_path / "docker-compose.observability.yml").symlink_to(
        REPO / "docker-compose.observability.yml"
    )
    if compose is None:
        (tmp_path / "docker-compose.yml").symlink_to(REPO / "docker-compose.yml")
    else:
        (tmp_path / "docker-compose.yml").write_text(compose, encoding="utf-8")
    return tmp_path


# --------------------------------------------------------------- the committed state


def test_check_passes_on_the_committed_bundle(bundle: ModuleType) -> None:
    code, lines = bundle.check_bundle(REPO)
    assert code == bundle.EXIT_OK, lines
    assert all(line.startswith("ok ") for line in lines), lines
    # Four artifacts, plus the hand-written overlay - which reports itself even when it agrees, so
    # that "checked and satisfied" and "never checked" are two different strings on purpose.
    assert len(lines) == len(GENERATED) + 1
    assert "overlay laws" in lines[-1]


def test_every_committed_artifact_is_byte_identical_to_a_fresh_render(
    bundle: ModuleType,
) -> None:
    rendered = bundle.compose_bundle(REPO)
    for rel, text in rendered.items():
        on_disk = (REPO / rel).read_text(encoding="utf-8")
        assert on_disk == text, f"{rel} differs from a fresh render"
    assert set(rendered) == set(GENERATED)


def test_check_writes_nothing(bundle: ModuleType) -> None:
    before = {rel: _digest(REPO / rel) for rel in GENERATED}
    assert bundle.check_bundle(REPO)[0] == bundle.EXIT_OK
    assert {rel: _digest(REPO / rel) for rel in GENERATED} == before


def test_rendering_is_deterministic(bundle: ModuleType) -> None:
    assert bundle.compose_bundle(REPO) == bundle.compose_bundle(REPO)


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------- the rule census


def test_rendered_plus_refused_is_exactly_the_catalog(bundle: ModuleType) -> None:
    families = bundle.collect_families(REPO, sources={})
    rendered, refused = bundle.derive_rules(families, bundle.collect_help_texts(REPO))
    assert len(rendered) + len(refused) == len(ALERT_RULES)
    assert {rule.rule_id for rule in rendered} | {entry.rule_id for entry in refused} == {
        rule.rule_id for rule in ALERT_RULES
    }


def test_the_rendered_set_is_the_four_rules_the_tree_can_actually_support(
    bundle: ModuleType,
) -> None:
    families = bundle.collect_families(REPO, sources={})
    rendered, refused = bundle.derive_rules(families, bundle.collect_help_texts(REPO))
    assert sorted(rule.rule_id for rule in rendered) == [
        "SLO_BUDGET_EXHAUSTED",
        "SLO_BURN_FAST",
        "SLO_BURN_SLOW",
        "TELEMETRY_EXPORT_FAILING",
    ]
    # Every refusal states what was missing, in words a reviewer can act on. A silent omission is how
    # "we alert on nothing else" eventually reads as "nothing else was ever worth alerting on".
    assert all(entry.reason.strip() for entry in refused)
    assert len(refused) == 20


def test_thresholds_are_the_catalog_numbers_and_no_others(bundle: ModuleType) -> None:

    families = bundle.collect_families(REPO, sources={})

    rendered, _ = bundle.derive_rules(families, bundle.collect_help_texts(REPO))

    exprs = {rule.rule_id: rule.expr for rule in rendered}

    allowed = {rule.rule_id: set(rule.allowed_numbers) for rule in rendered}



    def scaled(rule_id: str) -> str:

        """The catalog's threshold, converted by the unit the family is registered in.



        The narrowing is explicit because `AlertRule.threshold` is `float | None`: 17 of the 24 rules

        have no threshold, and a test that multiplied through the `None` would be a test that assumes

        what the tool checks.

        """

        rule = rule_for(rule_id)

        assert rule is not None, rule_id

        threshold = rule.threshold

        assert threshold is not None, rule_id

        return str(int(threshold * 1_000_000))



    # `wlct_slo_burn_rate_ppm` is registered in parts per million and the catalog speaks in burn-rate

    # ratios, so 14.4 becomes 14400000. One multiplication by a declared unit, and the only

    # arithmetic this tool performs on a threshold.

    assert exprs["SLO_BURN_FAST"] == (

        'wlct_slo_burn_rate_ppm{window_kind="short"} > ' + scaled("SLO_BURN_FAST")

        + ' and wlct_slo_burn_rate_ppm{window_kind="long"} > '

        + scaled("SLO_BURN_FAST")

    )

    assert exprs["SLO_BURN_SLOW"] == (

        'wlct_slo_burn_rate_ppm{window_kind="short"} > ' + scaled("SLO_BURN_SLOW")

        + ' and wlct_slo_burn_rate_ppm{window_kind="long"} > '

        + scaled("SLO_BURN_SLOW")

    )

    # A count, not a ratio: the family is registered as consecutive failures, so no unit conversion

    # is due and the catalog's own 3 is written as 3. The registered help says "alert threshold at 3",

    # which is agreement rather than a second source, and the rule's evidence records that reading.

    assert exprs["TELEMETRY_EXPORT_FAILING"] == "wlct_tracing_export_consecutive_failures > 3"

    assert "3" in allowed["TELEMETRY_EXPORT_FAILING"]

    # The inverted comparison is the catalog's condition, not the AlertRule docstring: "remaining

    # budget is zero" counts downward on a gauge, and `>` here would page on every healthy second.

    budget = rule_for("SLO_BUDGET_EXHAUSTED")

    assert budget is not None and budget.threshold == 0.0

    assert exprs["SLO_BUDGET_EXHAUSTED"] == "wlct_slo_error_budget_remaining_ppm <= 0"


def test_invented_numbers_are_refused_even_inside_an_expression(
    bundle: ModuleType,
) -> None:
    """The allowance is declared on the rule, never read back out of its ``expr``."""
    families = bundle.collect_families(REPO, sources={})
    rendered, _ = bundle.derive_rules(families, bundle.collect_help_texts(REPO))
    good = bundle.compose_bundle(REPO)[bundle.RULES_REL]
    bundle.assert_no_invented_numbers(good, rendered)

    smuggled = tuple(
        rule if rule.rule_id != "SLO_BURN_FAST" else _widen(rule) for rule in rendered
    )
    text = good.replace("window_kind=\"long\"} > 14400000", "window_kind=\"long\"} > 14400001")
    with pytest.raises(bundle.BundleError, match="14400001 is not attributable"):
        bundle.assert_no_invented_numbers(text, smuggled)


def _widen(rule: Any) -> Any:
    """The same rule with its allowance removed, which is what a rule that wanted to be believed does.

    If the check read the numbers back out of the expression it had just rendered, this would be
    indistinguishable from the honest version and the audit would be a comment.
    """
    return replace(rule, allowed_numbers=())


# ------------------------------------------------------------- what must be absent


def test_no_cadence_is_declared_anywhere(bundle: ModuleType) -> None:
    artifacts = bundle.compose_bundle(REPO)
    bundle.assert_no_invented_cadence(artifacts)
    for key in ("scrape_interval", "evaluation_interval", "scrape_timeout", "honor_labels"):
        assert not re.search(rf"^\s*{key}:", artifacts[bundle.PROMETHEUS_CONFIG_REL], re.M)
    mutated = dict(artifacts)
    mutated[bundle.PROMETHEUS_CONFIG_REL] = (
        artifacts[bundle.PROMETHEUS_CONFIG_REL] + "\nscrape_interval: 15s\n"
    )
    with pytest.raises(bundle.BundleError, match="declares no cadence"):
        bundle.assert_no_invented_cadence(mutated)
    mutated_rules = dict(artifacts)
    mutated_rules[bundle.RULES_REL] = artifacts[bundle.RULES_REL].replace(
        "        expr: wlct_slo_error_budget_remaining_ppm <= 0",
        "        expr: wlct_slo_error_budget_remaining_ppm <= 0\n        for: 5m",
    )
    with pytest.raises(bundle.BundleError, match="no dwell time"):
        bundle.assert_no_invented_cadence(mutated_rules)


def test_no_credential_literal_appears(bundle: ModuleType) -> None:
    artifacts = bundle.compose_bundle(REPO)
    bundle.assert_no_secret_shapes(artifacts)
    for text in artifacts.values():
        for line in text.splitlines():
            if line.strip().startswith("#"):
                continue
            assert not re.search(r"METRICS_TOKEN.{0,4}[=:]\s*[\x27\x22][^\x27\x22$]", line), line
    planted = dict(artifacts)
    planted[bundle.PROMETHEUS_CONFIG_REL] = artifacts[
        bundle.PROMETHEUS_CONFIG_REL
    ].replace('"${METRICS_TOKEN}"', '"s3cr3t-token-value-do-not-log"')
    with pytest.raises(bundle.BundleError, match="secret-shaped"):
        bundle.assert_no_secret_shapes(planted)


def test_no_relabeling_or_extra_labels(bundle: ModuleType) -> None:
    artifacts = bundle.compose_bundle(REPO)
    bundle.assert_labels_are_not_invented(artifacts)
    bundle.assert_only_catalog_labels(artifacts)
    config = artifacts[bundle.PROMETHEUS_CONFIG_REL]
    body = "\n".join(line for line in config.splitlines() if not line.strip().startswith("#"))
    for needle in bundle.CARDINALITY_ESCAPES:
        assert needle not in body, needle
    # The header of that same file explains the absence in prose, and the audit reads past it. Both
    # halves are pinned, because "grep for a bad word" would pass here and fail the check below.
    assert "external_labels" in config
    planted = dict(artifacts)
    planted[bundle.RULES_REL] = artifacts[bundle.RULES_REL].replace(
        "          severity: critical\n          rule_id: SLO_BUDGET_EXHAUSTED",
        "          severity: critical\n          rule_id: SLO_BUDGET_EXHAUSTED\n"
        "          team: platform-core",
    )
    with pytest.raises(bundle.BundleError, match="team"):
        bundle.assert_only_catalog_labels(planted)
    relabelled = dict(artifacts)
    relabelled[bundle.PROMETHEUS_CONFIG_REL] = (
        artifacts[bundle.PROMETHEUS_CONFIG_REL] + "    metric_relabel_configs: []\n"
    )
    with pytest.raises(bundle.BundleError, match="cardinality law"):
        bundle.assert_labels_are_not_invented(relabelled)


# --------------------------------------------------------------------- the targets



    # And the escape the first version of this audit missed: a `global:` block that adds a label to
    # every series in the file, which no per-job check would ever see.
    escaped = dict(artifacts)
    escaped[bundle.PROMETHEUS_CONFIG_REL] = body + "\n  external_labels:\n    cluster: local\n"
    with pytest.raises(bundle.BundleError, match="external_labels"):
        bundle.assert_labels_are_not_invented(escaped)

def test_ports_and_paths_come_from_compose_and_the_routers(bundle: ModuleType) -> None:
    rendered = bundle.compose_bundle(REPO)
    config = rendered[bundle.PROMETHEUS_CONFIG_REL]
    catalog = __import__("json").loads(rendered[bundle.CATALOG_REL])
    targets = {t["service"]: t for t in catalog["targets"]}
    assert sorted(targets) == [
        "api",
        "execution-engine",
        "market-data",
        "trading-engine",
    ]
    compose_text = (REPO / bundle.COMPOSE_REL).read_text(encoding="utf-8")
    services = bundle.parse_compose_services(compose_text)
    for service, target in targets.items():
        entry = services[target["composeService"]]
        assert str(target["port"]) in " ".join(entry["expose"] + entry["ports"]), service
        assert f'targets: ["{target["composeService"]}:{target["port"]}"]' in config


def test_a_changed_compose_port_moves_the_job(bundle: ModuleType, tmp_path: Path) -> None:
    """Not a copy of the config with a different number: the same code path, different input."""
    compose_text = (REPO / bundle.COMPOSE_REL).read_text(encoding="utf-8")
    assert "      - \"8001\"" in compose_text
    root = scratch_root(tmp_path, compose=compose_text.replace('      - "8001"', '      - "8111"', 1))
    rendered = bundle.compose_bundle(root)
    assert 'targets: ["trading-engine:8111"]' in rendered[bundle.PROMETHEUS_CONFIG_REL]
    assert 'targets: ["trading-engine:8001"]' not in rendered[bundle.PROMETHEUS_CONFIG_REL]


def test_a_removed_route_removes_the_target(bundle: ModuleType, tmp_path: Path) -> None:
    """Absence in the code is absence in the bundle: no fallback path, no guessed port.

    This is the part's central law in one test. A router that stops declaring ``/metrics`` takes its
    job with it, and the availability rule's job regex shrinks to match, because a target that cannot
    be reported down is a target whose silence reads as health.
    """
    route = REPO / "services/market-data/app/routers/observability.py"
    text = route.read_text(encoding="utf-8")
    assert '"/metrics"' in text
    patched = re.sub(r'@router\.(get|api_route)\(\s*"/metrics"', r"@router.\1(\"/nope\"", text, count=1)
    assert patched != text

    overlay: dict[Path, str] = {route: patched}
    _mirror_tree(tmp_path, overlay)
    rendered = bundle.compose_bundle(tmp_path)
    config = rendered[bundle.PROMETHEUS_CONFIG_REL]
    assert "wlct-market-data" not in config, "a router with no /metrics route still produced a job"
    assert config.count("job_name:") == 3
    jobs = [job.removeprefix("wlct-") for job in re.findall(r"- job_name: (\S+)", config)]
    covered = rendered[bundle.RULES_REL].split('up{job=~"')[1].split('"}')[0]
    assert jobs == ["api", "trading-engine", "execution-engine", "market-data"] or jobs == [
        "api",
        "trading-engine",
        "execution-engine",
    ]
    assert all(job in covered for job in jobs), "a job the regex cannot match"
    assert "market-data" not in covered

    catalog = __import__("json").loads(rendered[bundle.CATALOG_REL])
    services = {t["service"] for t in catalog["targets"]}
    assert "market-data" not in services
    assert "market-data" in {e["service"] for e in catalog["excluded"]}


def _mirror_tree(destination: Path, overrides: dict[Path, str]) -> None:
    """The repository as a tree of symlinks, with a handful of files replaced.

    The materialisation order matters and is the reason this helper exists instead of a one-liner: a
    symlink cannot be written *through* without changing the file it points at, so every ancestor of
    an override has to become a real directory before the override is written, and the directory's
    other children are symlinked afterwards - except the child that continues the override path, which
    is materialised in its turn. Getting that order wrong once is enough to edit the repository.
    """
    for source in overrides:
        relative = source.relative_to(REPO)
        for depth in range(1, len(relative.parts)):
            node = destination.joinpath(*relative.parts[:depth])
            if node.is_symlink():
                node.unlink()
            node.mkdir(exist_ok=True)
            child_of_override_path = relative.parts[depth]
            for child in sorted(REPO.joinpath(*relative.parts[:depth]).iterdir()):
                if child.name == child_of_override_path or child.name in _SKIPPED:
                    continue
                link = node / child.name
                if link.exists() or link.is_symlink():
                    continue
                link.symlink_to(child)
        (destination / relative).write_text(overrides[source], encoding="utf-8")
    for name in ("libs", "apps", "services", "docs", ".env.example", bundle_compose()):
        node = destination / name
        if node.exists() or node.is_symlink():
            continue
        node.symlink_to(REPO / name)


def bundle_compose() -> str:
    """The main compose file, reached through the module rather than restated as a literal."""
    return "docker-compose.yml"


# ------------------------------------------------------------------------- overlay


def test_overlay_laws_pass_on_the_committed_file(bundle: ModuleType) -> None:
    text = (REPO / bundle.OBS_COMPOSE_REL).read_text(encoding="utf-8")
    assert bundle.overlay_laws(text) == []


@pytest.mark.parametrize(
    ("needle", "replacement", "expected"),
    [
        ("      - --storage.tsdb.path=/prometheus", "      - --web.enable-lifecycle", "lifecycle"),
        ('      - "127.0.0.1:${PROMETHEUS_PORT:-9090}:9090"', '      - "9090:9090"', "beyond the loopback"),
        ("image: prom/prometheus:v3.5.0", "image: prom/prometheus:latest", "runs image"),
        ("- ./infrastructure/observability/prometheus:/etc/prometheus:ro", "- ./prometheus:/etc/prometheus", "read-only"),
        ("- prometheus-data:/prometheus", "", "TSDB path"),
        ("      - wlct-internal\n", "", "wlct-internal"),
    ],
)
def test_each_overlay_law_bites(
    bundle: ModuleType, needle: str, replacement: str, expected: str
) -> None:
    text = (REPO / bundle.OBS_COMPOSE_REL).read_text(encoding="utf-8")
    assert needle in text, f"the fixture needle {needle!r} is no longer in the overlay"
    mutated = text.replace(needle, replacement, 1)
    problems = bundle.overlay_laws(mutated)
    assert any(expected in problem for problem in problems), problems


def test_a_second_service_in_the_overlay_is_refused(bundle: ModuleType) -> None:
    text = (REPO / bundle.OBS_COMPOSE_REL).read_text(encoding="utf-8")
    mutated = text.replace(
        "\nvolumes:\n",
        "\n  grafana:\n    image: grafana/grafana:11.0.0\n    networks:\n      - wlct-internal\n\n"
        "volumes:\n",
        1,
    )
    problems = bundle.overlay_laws(mutated)
    assert any("only ['prometheus'] belongs" in problem for problem in problems), problems


def test_a_comment_cannot_trip_an_overlay_law(bundle: ModuleType) -> None:
    """The file documents the flag it refuses to set, and the checker reads structure anyway.

    Without this, a checker that greps the text would report its own documentation as drift, which is
    exactly how checks get ignored.
    """
    text = (REPO / bundle.OBS_COMPOSE_REL).read_text(encoding="utf-8")
    assert "#   * `--web.enable-lifecycle`" in text
    assert bundle.overlay_laws(text) == []


# ------------------------------------------------------------------- emit discipline


def test_emit_refuses_a_foreign_file_and_writes_nothing(bundle: ModuleType, tmp_path: Path) -> None:
    root = scratch_root(tmp_path)
    for rel in GENERATED:
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(bundle.compose_bundle(REPO)[rel], encoding="utf-8")
    foreign = root / bundle.README_REL
    foreign.write_text("# my own notes about this directory\n", encoding="utf-8")

    code, lines = bundle.emit_bundle(root)
    assert code == bundle.EXIT_REFUSED
    assert any("does not carry this tool's marker" in line for line in lines), lines
    # Nothing at all was written: a half-regenerated bundle is worse than a stale one, because the
    # rules and the jobs would then disagree while each file looked current.
    assert foreign.read_text(encoding="utf-8") == "# my own notes about this directory\n"
    for rel in GENERATED:
        if rel == bundle.README_REL:
            continue
        assert (root / rel).read_text(encoding="utf-8") == bundle.compose_bundle(REPO)[rel]


def test_emit_overwrites_a_marked_file_and_reports_it(bundle: ModuleType, tmp_path: Path) -> None:
    root = scratch_root(tmp_path)
    fresh = bundle.compose_bundle(REPO)
    for rel in GENERATED:
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(fresh[rel], encoding="utf-8")
    edited = root / bundle.RULES_REL
    edited.write_text(fresh[bundle.RULES_REL].replace("<= 0", "<= 1"), encoding="utf-8")

    code, lines = bundle.emit_bundle(root)
    assert code == bundle.EXIT_OK
    assert any(bundle.RULES_REL in line and line.startswith("wrote") for line in lines), lines
    assert edited.read_text(encoding="utf-8") == fresh[bundle.RULES_REL]
    assert any("unchanged" in line for line in lines), lines
    assert bundle.check_bundle(root)[0] == bundle.EXIT_OK


def test_force_overwrites_a_foreign_file(bundle: ModuleType, tmp_path: Path) -> None:
    root = scratch_root(tmp_path)
    (root / bundle.README_REL).parent.mkdir(parents=True, exist_ok=True)
    (root / bundle.README_REL).write_text("# mine\n", encoding="utf-8")
    code, lines = bundle.emit_bundle(root, force=True)
    assert code == bundle.EXIT_OK
    assert bundle.README_REL in " ".join(lines)
    assert "mine" not in (root / bundle.README_REL).read_text(encoding="utf-8")


def test_a_missing_input_is_a_refusal_not_an_empty_bundle(bundle: ModuleType, tmp_path: Path) -> None:
    for name in ("libs", "apps", "services", ".env.example"):
        (tmp_path / name).symlink_to(REPO / name)
    (tmp_path / bundle.COMPOSE_REL).write_text("services: {}\n", encoding="utf-8")
    with pytest.raises(bundle.BundleError, match="refusing to emit a bundle that scrapes nothing"):
        bundle.compose_bundle(tmp_path)


# --------------------------------------------------------------------- exposition


def registry_text() -> str:
    """A real scrape, rendered by the library rather than typed out by hand.

    Hand-written exposition would test the parser against what the author expected it to see. This
    tests it against what the platform actually emits, including the ``le`` label sorting first inside
    a bucket line and the ``service`` label on every series.
    """
    registry = ObservabilityRegistry(service="execution-engine")
    registry.register_counter("wlct_execution_orders_total", "Orders accepted by the engine.")
    registry.register_gauge(
        "wlct_execution_wiring",
        "Wiring facts (1=yes) needed to read a zero correctly.",
        "component",
        bounds={"component": frozenset({"durable_store", "placement_review"})},
    )
    registry.register_histogram(
        "wlct_execution_stage_latency_micros",
        "Engine stage durations in microseconds.",
        ("stage",),
        (1000, 10000),
        bounds={"stage": frozenset({"place", "ack"})},
    )
    registry.inc("wlct_execution_orders_total", {}, 7)
    registry.set_gauge("wlct_execution_wiring", {"component": "durable_store"}, 1)
    for micros in (500, 500, 500, 50_000):
        registry.observe_micros("wlct_execution_stage_latency_micros", {"stage": "place"}, micros)
        registry.observe_micros("wlct_execution_stage_latency_micros", {"stage": "ack"}, micros)
    return render_prometheus(registry)


@pytest.fixture(scope="session")
def exposition() -> str:
    return registry_text()


def test_the_parser_reconstructs_what_the_registry_held(
    bundle: ModuleType, exposition: str
) -> None:
    snapshot = bundle.parse_exposition(exposition)
    assert sorted(snapshot) == [
        "wlct_execution_orders_total",
        "wlct_execution_stage_latency_micros",
        "wlct_execution_wiring",
        "wlct_registry_series_overflow_total",
    ]
    orders = snapshot["wlct_execution_orders_total"]
    assert orders["type"] == "counter"
    assert orders["series"] == [{"labels": {"service": "execution-engine"}, "value": 7.0}]
    latency = snapshot["wlct_execution_stage_latency_micros"]
    assert latency["type"] == "histogram"
    assert [sorted(row["labels"]) for row in latency["series"]] == [["service", "stage"]] * 2
    for row in latency["series"]:
        assert row["count"] == 4
        assert row["sumMicros"] == pytest.approx(51_500.0)
        assert row["buckets"] == {"1000": 3.0, "10000": 3.0, "+Inf": 4.0}
    wiring = snapshot["wlct_execution_wiring"]
    assert wiring["series"] == [
        {"labels": {"component": "durable_store", "service": "execution-engine"}, "value": 1.0}
    ]


def test_the_dashboard_document_is_the_library_shape(
    bundle: ModuleType, exposition: str
) -> None:
    from wlct_trading.observability.dashboard import SECTIONS

    document, absent = bundle.dashboard_document(
        service="execution-engine",
        exposition=exposition,
        catalog_names=tuple(sorted(bundle.registered_family_names(REPO, "execution-engine"))),
    )
    assert document["service"] == "execution-engine"
    assert list(document["sections"]) == list(SECTIONS)
    assert "not a source of financial truth" in document["note"]
    routed = document["sections"]["EXECUTION"]
    assert any(row["label"] == "orders_total" and row["value"] == "7.0" for row in routed)
    for section, rows in document["sections"].items():
        for row in rows:
            assert sorted(row) == ["detail", "label", "tone", "value"], section
    # The scrape-side view runs no health checks and holds no alert records, so those sections are
    # legitimately empty rather than reassuringly populated.
    assert document["sections"]["SYSTEM"] == []
    assert document["sections"]["ALERTS"] == []
    assert "wlct_execution_orders_total" not in absent
    assert "wlct_component_health" in absent


def test_absence_is_reported_as_absence(bundle: ModuleType, exposition: str) -> None:
    """The families the service registers and this scrape did not contain are named, not zeroed."""
    registered = bundle.registered_family_names(REPO, "execution-engine")
    _, absent = bundle.dashboard_document(
        service="execution-engine", exposition=exposition, catalog_names=tuple(sorted(registered))
    )
    served = set(bundle.parse_exposition(exposition))
    assert set(absent) == set(registered) - served
    assert absent == tuple(sorted(absent))
    # A prefix constant is not a family. `wlct_execution_` shows up in the source as a builder, and
    # listing it as absent would send somebody looking for a metric nobody can register.
    assert not any(name.endswith("_") for name in absent)


def test_the_strict_census_prefers_nothing_over_a_guess(bundle: ModuleType) -> None:
    """Two sets by design: the wide scan may find an alert, the strict one may only claim absence."""
    wide = bundle.collect_families(REPO, sources={})["execution-engine"]
    strict = bundle.registered_family_names(REPO, "execution-engine")
    assert strict <= wide
    assert not any(name.endswith("_") for name in strict)
    # Registered with a literal name and a help string, so the census is allowed to speak about it...
    # The API registers by literal, so its census may name families by name...
    api_strict = bundle.registered_family_names(REPO, "api")
    assert "wlct_slo_burn_rate_ppm" in api_strict
    assert "wlct_component_health" in strict  # the core's, registered by literal
    # ...while the engine builds its counter names at runtime behind a constant. Those families are
    # genuinely served and genuinely not mentionable here: an absence claim about a name the source
    # assembles would be a guess about the assembly, which is what the rest of this file refuses.
    assert "wlct_execution_" in wide
    assert "wlct_execution_" not in strict
    assert "wlct_execution_orders_total" not in strict


def test_garbage_input_is_refused(bundle: ModuleType) -> None:
    with pytest.raises(bundle.BundleError, match="is not a sample"):
        bundle.parse_exposition("this is not exposition\n")
    with pytest.raises(bundle.BundleError, match="metric type"):
        bundle.parse_exposition("# TYPE wlct_x summary\nwlct_x 1\n")
    with pytest.raises(bundle.BundleError, match="suffix while"):
        bundle.parse_exposition(
            "# TYPE wlct_x counter\nwlct_x_sum{service=\"s\"} 1\nwlct_x 2\n"
        )


def test_read_exposition_refuses_what_a_pipe_can_misdeliver(
    bundle: ModuleType, tmp_path: Path
) -> None:
    missing = tmp_path / "nope.txt"
    with pytest.raises(bundle.BundleError, match="not a file"):
        bundle.read_exposition(str(missing))
    empty = tmp_path / "empty.txt"
    empty.write_text("\n", encoding="utf-8")
    with pytest.raises(bundle.BundleError, match="empty"):
        bundle.read_exposition(str(empty))
    binary = tmp_path / "binary.txt"
    binary.write_bytes(b"wlct_x 1\x00\n")
    with pytest.raises(bundle.BundleError, match="NUL"):
        bundle.read_exposition(str(binary))
    huge = tmp_path / "huge.txt"
    huge.write_bytes(b"#" + b"x" * (bundle.MAX_EXPOSITION_BYTES + 1))
    with pytest.raises(bundle.BundleError, match="over the"):
        bundle.read_exposition(str(huge))
    ok = tmp_path / "ok.txt"
    ok.write_text("# TYPE wlct_x gauge\nwlct_x 1\n", encoding="utf-8")
    assert bundle.read_exposition(str(ok)).endswith("wlct_x 1\n")


# ------------------------------------------------------------------------ the CLI


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        cwd=REPO,
        check=False,
    )


def test_cli_check_succeeds_against_the_committed_bundle() -> None:
    result = run_cli("--check")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "matches a fresh render" in result.stdout


def test_cli_rules_reports_the_census() -> None:
    result = run_cli("--rules")
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.count("rendered ") == 4
    assert result.stdout.count("refused ") == 20


def test_cli_catalog_json_is_the_document_the_files_came_from() -> None:
    import json

    result = run_cli("--catalog", "--json")
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema"] == "wlct.observability.scrape-bundle/1"
    assert len(payload["rules"]["rendered"]) == 4
    assert [t["service"] for t in payload["targets"]] == [
        "api",
        "trading-engine",
        "execution-engine",
        "market-data",
    ]
    for target in payload["targets"]:
        assert target["portEvidence"].startswith("docker-compose.yml:")
    assert payload["cadence"] == {
        "scrapeInterval": None,
        "sustainedFor": None,
        "why": payload["cadence"]["why"],
    }


def test_cli_exit_codes_are_the_documented_ones() -> None:
    unknown = subprocess.run(
        [sys.executable, str(SCRIPT), "--dashboard", "not-a-service", "--from", "-"],
        input="# TYPE wlct_x gauge\nwlct_x 1\n",
        capture_output=True,
        text=True,
        cwd=REPO,
        check=False,
    )
    assert unknown.returncode == 2
    assert "not a service this bundle knows" in unknown.stderr
    assert run_cli("--dashboard", "api").returncode == 3
    assert run_cli().returncode != 0  # a mode is required
    assert run_cli("--check", "--emit").returncode != 0  # the modes are exclusive


def test_cli_dashboard_reads_stdin() -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--dashboard", "execution-engine", "--from", "-"],
        input=registry_text(),
        capture_output=True,
        text=True,
        cwd=REPO,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "EXECUTION  (4 rows)" in result.stdout
    assert "ABSENT" in result.stdout


# ------------------------------------------------------------------- the tool itself


def test_the_generator_never_reaches_the_network_or_a_container() -> None:
    """Proven from the source, because the claim is about the file rather than one run of it.

    A tool that performed a scrape could report "no data" as "0", which is the confusion this whole
    part is built to keep impossible. Reading text and writing text is the boundary, and the boundary
    is asserted instead of asserted to be obvious.
    """
    text = SCRIPT.read_text(encoding="utf-8")
    for forbidden in (
        "import socket",
        "import subprocess",
        "import urllib",
        "import http.client",
        "import requests",
        "import yaml",
    ):
        assert forbidden not in text, f"{forbidden} appeared in the generator"
    assert "subprocess.run" not in text


def test_the_generator_carries_no_suppression_tokens() -> None:
    """The handover's audit looks at every new file, including the prose of this one.

    It is also the honest rule for a tool whose whole job is refusing: a generator that quiets a
    finding has quietly widened what it will accept. The tokens are spelled by concatenation because
    a file that names a forbidden thing in order to forbid it must not itself become one - the same
    reason `docs/PART18_METRICS_EXPOSITION.md` spells its own absences in prose.
    """
    text = SCRIPT.read_text(encoding="utf-8")
    forbidden = ("no" + "qa", "pragma" + ":", "type:" + " ignore")
    for token in forbidden:
        assert token not in text, token


def test_the_prometheus_image_pin_is_the_one_the_config_needs(bundle: ModuleType) -> None:
    assert bundle.PROMETHEUS_IMAGE.startswith("prom/prometheus:")
    tag = bundle.PROMETHEUS_IMAGE.split(":", 1)[1]
    assert re.fullmatch(r"v\d+\.\d+\.\d+", tag), tag
    major, minor = (int(part) for part in tag[1:].split(".")[:2])
    required = tuple(int(part) for part in bundle.MIN_SCRAPE_HEADERS_VERSION.split("."))
    assert (major, minor) >= required, "the pinned image predates the config syntax it must read"
    text = (REPO / bundle.OBS_COMPOSE_REL).read_text(encoding="utf-8")
    assert f"image: {bundle.PROMETHEUS_IMAGE}" in text
    assert "prom/prometheus:latest" not in text
