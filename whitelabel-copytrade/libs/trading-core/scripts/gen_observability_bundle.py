"""Render and verify the deployment-side telemetry bundle (Part 22).

Part 18 put the numbers at the edge of the process that measures them and stopped there on purpose:
"the alert rules, the dashboards and the scrape targets stay in the deployment"
(``docs/ROADMAP.md`` line 221). Four parts later nobody had picked that half up, so ``/metrics`` was
an endpoint with no scraper - a service could publish a burn-rate gauge that nothing was allowed to
read. This script closes the gap the only way a repository can: it RENDERS the scrape config, the
rule file, the metric catalog and the README from facts it reads out of this tree, and it VERIFYs
that the committed artifacts still match a fresh render. It does not run Prometheus, does not scrape
anything, and does not state one number about live telemetry.

Five laws, each enforced rather than described
----------------------------------------------
1. **A target exists only if the deployment and the source both say so.** A scrape job is emitted for
   a compose service that is on ``wlct-internal``, exposes a port, and has the exposition route
   written in its own source. That is four of the eleven services; the worker serves nothing, the
   notification service and the admin web publish no ``/metrics``, and Postgres/Redis are not this
   platform's metrics. Every excluded service is recorded in the catalog with its reason, because a
   silence about ``worker`` would read as an oversight.
2. **Ports and paths are read, never typed.** The port comes from the compose block; the Python
   services' path from the literal route in their router (anything but ``/metrics`` is a refusal, not
   a silent adoption); the API's from ``PROMETHEUS_PATH`` through Prometheus' own ``${...}``
   expansion, because the API is the one service that reads that variable.
3. **No cadence is invented.** The generated config contains no ``scrape_interval`` and the rules no
   ``interval`` or ``for``: this repository declares no scrape policy and the catalog carries no
   dwell time, so the pinned image's defaults stand and a test asserts the keys are absent. A ``15s``
   typed here would be a policy nobody chose.
4. **A rule is rendered only when the catalog can support it.** ``ALERT_RULES`` carries 24 rules; 17
   have ``threshold: None``, and of the 7 that have a number, 3 name a unit no registered family
   exposes. So four rules render - each referencing a family whose name was found literally in the
   source that registers it - and twenty refuse, with the reason and the names that were searched.
   Every numeric literal in the output is then re-checked against the catalog: the file may contain
   nothing but catalog thresholds, the declared ppm conversion, and the zero of a failed scrape.
5. **Nothing secret-shaped and nothing live.** ``METRICS_TOKEN`` appears as an expansion, never a
   value; no relabeling or extra label appears in the config, because the cardinality law lives in
   ``labels.py`` and a scrape config may not route around it; the module imports no HTTP client, no
   socket and no subprocess; ``--check`` writes nothing, and ``--emit`` refuses to overwrite an
   artifact it did not generate unless ``--force`` says otherwise.

Run: ``python3 libs/trading-core/scripts/gen_observability_bundle.py --check`` from anywhere in the
repository. Output is deterministic - sorted keys, no clock, no path of the machine that rendered it
- so regenerating to inspect a diff always works, and a stale artifact is a real failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "libs" / "trading-core"))

from wlct_trading.observability.alerts import ALERT_RULES, AlertRule

# The dashboard builder is imported where it is used rather than up here. `--check`, `--emit`,
# `--catalog` and `--rules` never render a dashboard, and a module-level import of a path most runs do
# not take buys one more "import not at top of file" finding for no benefit - the bootstrap above is
# already the reason one exists, and a generator should not spend the lint budget on its own layout.

# --------------------------------------------------------------------------- paths

COMPOSE_REL: Final[str] = "docker-compose.yml"
OBS_COMPOSE_REL: Final[str] = "docker-compose.observability.yml"
ENV_EXAMPLE_REL: Final[str] = ".env.example"
BUNDLE_DIR_REL: Final[str] = "infrastructure/observability"
PROMETHEUS_CONFIG_REL: Final[str] = f"{BUNDLE_DIR_REL}/prometheus/prometheus.yml"
RULES_REL: Final[str] = f"{BUNDLE_DIR_REL}/prometheus/rules/wlct.rules.yml"
CATALOG_REL: Final[str] = f"{BUNDLE_DIR_REL}/metrics-catalog.json"
README_REL: Final[str] = f"{BUNDLE_DIR_REL}/README.md"

#: The image this bundle is written against. Pinned because a config file is a contract with a
#: version: ``http_headers`` needs Prometheus >= 2.53, and a floating tag lets a major version change
#: the format underneath a committed file. The tag is named here so an operator bumping it can see
#: exactly which assumption travels with it.
PROMETHEUS_IMAGE: Final[str] = "prom/prometheus:v3.5.0"
MIN_SCRAPE_HEADERS_VERSION: Final[str] = "2.53"

#: The mark every generated artifact carries, in its own format. It is what tells ``--emit`` that a
#: file it is about to replace was produced here rather than written by a person.
GENERATED_MARK: Final[str] = "gen_observability_bundle.py"

#: The document name in the catalog JSON, checked by the same rule.
CATALOG_SCHEMA: Final[str] = "wlct.observability.scrape-bundle/1"

MAX_EXPOSITION_BYTES: Final[int] = 8 * 1024 * 1024

EXIT_OK: Final[int] = 0
EXIT_DRIFT: Final[int] = 1
EXIT_MISSING: Final[int] = 2
EXIT_REFUSED: Final[int] = 3

#: Services that could in principle be scraped, in the order the compose file lists them. Any other
#: service is not a metrics target by definition (databases, the migration job, the web front end),
#: and the exclusions are recorded with reasons rather than left as a shorter list.
CANDIDATE_SERVICES: Final[tuple[str, ...]] = (
    "api",
    "notification-service",
    "trading-engine",
    "execution-engine",
    "market-data",
    "worker",
    "admin-web",
)

#: Where to look for "does this service answer GET /metrics", expressed as a path whose text is
#: scanned rather than a list of endpoints asserted in prose. The API is absent on purpose: it
#: registers the route through Nest decorators with a configurable path, handled by rule 2's second
#: half. A directory path means "no route in there", which is itself the exclusion evidence.
ROUTES_BY_SERVICE: Final[dict[str, str]] = {
    "notification-service": "services/notification-service/app",
    "trading-engine": "services/trading-engine/app/routers/observability.py",
    "execution-engine": "services/execution-engine/app/routers/observability.py",
    "market-data": "services/market-data/app/routers/observability.py",
    "worker": "apps/api/src/modules/worker",
    "admin-web": "apps/admin-web/src",
}

#: The Python side of the platform: the services whose registry IS the core's.
PYTHON_SERVICES: Final[frozenset[str]] = frozenset(
    {"notification-service", "trading-engine", "execution-engine", "market-data"}
)

#: Where each service's registered metric names are written. Directories are scanned recursively,
#: files literally.
FAMILY_SOURCES_BY_SERVICE: Final[dict[str, tuple[str, ...]]] = {
    "api": ("apps/api/src",),
    "notification-service": ("services/notification-service/app",),
    "trading-engine": ("services/trading-engine/app",),
    "execution-engine": ("services/execution-engine/app",),
    "market-data": ("services/market-data/app",),
    "worker": ("apps/api/src/modules/worker",),
    "admin-web": ("apps/admin-web/src",),
}
CORE_FAMILY_SOURCES: Final[str] = "libs/trading-core/wlct_trading"

#: The family name pattern. ``wlct_`` is the platform's own prefix; names built at runtime (the
#: derived families Part 18 introduced) do not appear literally and therefore cannot be referenced
#: by a rendered rule - which is the point, not a limitation to work around.
FAMILY_RE: Final[re.Pattern[str]] = re.compile(r"\b(wlct_[a-z0-9_]{3,})\b")

HELP_LINE_RE: Final[re.Pattern[str]] = re.compile(
    r"['\"](?P<name>wlct_[a-z0-9_]{4,})['\"]\s*,\s*\n?\s*['\"](?P<help>[^'\"]{8,400})['\"]", re.S
)

#: A secret-shaped literal that must never reach the bundle. Deliberately narrower than
#: ``scripts/dr-manifest.mjs``'s patterns: the question here is only whether a credential ended up in
#: a file the monitoring stack reads and the repository commits.
SECRET_SHAPE_RE: Final[re.Pattern[str]] = re.compile(
    r"(?i)\b(secret|token|password|passwd|api[_-]?key|private[_-]?key)\b\s*[:=]\s*[\"']?"
    r"[A-Za-z0-9+/=_-]{12,}"
)

#: The reasons a rule cannot be rendered, as data, so the catalog and the README say one thing twice.
REFUSE_NO_THRESHOLD: Final[str] = "no numeric threshold in the catalog (threshold: None)"
REFUSE_NO_FAMILY: Final[str] = "no registered family in this tree exposes the unit the rule names"


# --------------------------------------------------------------------------- errors


class BundleError(RuntimeError):
    """A refusal to produce or accept an artifact. Never downgraded to a warning."""


# --------------------------------------------------------------------------- records


@dataclass(frozen=True, slots=True)
class Target:
    """One scrape job, with the evidence that made it a job."""

    service: str
    compose_service: str
    port: int
    metrics_path: str
    path_is_expansion: bool
    auth_header: str | None
    port_evidence: str
    path_evidence: str
    families_named_in_source: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "service": self.service,
            "composeService": self.compose_service,
            "port": self.port,
            "metricsPath": self.metrics_path,
            "metricsPathIsExpansion": self.path_is_expansion,
            "authHeader": self.auth_header,
            "portEvidence": self.port_evidence,
            "pathEvidence": self.path_evidence,
            "familiesNamedInSource": self.families_named_in_source,
        }


@dataclass(frozen=True, slots=True)
class Excluded:
    """A service that is NOT scraped, and why. Silence would be the failure."""

    service: str
    reason: str
    evidence: str

    def to_dict(self) -> dict[str, Any]:
        return {"service": self.service, "reason": self.reason, "evidence": self.evidence}


@dataclass(frozen=True, slots=True)
class RenderedRule:
    """A catalog rule that became a Prometheus alert, expression and all."""

    rule_id: str
    severity: str
    title: str
    family: str
    expr: str
    labels: tuple[tuple[str, str], ...]
    evidence: tuple[str, ...]
    #: The numbers this rule may contain, as strings, for the audit in
    #: ``assert_no_invented_numbers``. Declared here rather than read back out of the expression, so
    #: a rule cannot widen its own allowance by putting a number in its ``expr``.
    allowed_numbers: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "ruleId": self.rule_id,
            "severity": self.severity,
            "title": self.title,
            "family": self.family,
            "expr": self.expr,
            "labels": dict(self.labels),
            "evidence": list(self.evidence),
        }


@dataclass(frozen=True, slots=True)
class RefusedRule:
    """A catalog rule that stayed a catalog rule."""

    rule_id: str
    reason: str
    searched: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {"ruleId": self.rule_id, "reason": self.reason, "searched": list(self.searched)}


@dataclass(frozen=True, slots=True)
class RuleSource:
    """How one catalog rule maps onto one registered family.

    Every field is a claim about this tree, so each carries the text it came from. A mapping without
    evidence is how a rule file slowly fills up with numbers nobody owns.
    """

    rule_id: str
    family: str
    comparison: str
    unit_conversion: float | None
    window_kind: str | None
    require_both_windows: bool
    evidence: tuple[str, ...]
    matchers: tuple[tuple[str, str], ...] = ()


#: The whole mapping: four entries, twenty refusals. The SLO pair lands on the API's own SLO gauges
#: and the telemetry rule on the tracing exporter's consecutive-failure gauge, whose registered help
#: text already contains the number the catalog names.
RULE_SOURCES: Final[tuple[RuleSource, ...]] = (
    RuleSource(
        rule_id="SLO_BURN_FAST",
        family="wlct_slo_burn_rate_ppm",
        comparison=">",
        unit_conversion=1_000_000.0,
        window_kind="short",
        require_both_windows=True,
        evidence=(
            "apps/api/src/modules/observability/slo.service.ts sets `wlct_slo_burn_rate_ppm` with "
            "`window_kind` short|long, and the rule's condition says the short window reached the fast "
            "multiplier AND the long window agrees - which is why the expression is an `and` over both",
            "the catalog's unit is `burn_rate_ratio` while the family's registered help says `ppm`, so "
            "the threshold is multiplied by 1e6 and by nothing else",
        ),
    ),
    RuleSource(
        rule_id="SLO_BURN_SLOW",
        family="wlct_slo_burn_rate_ppm",
        comparison=">",
        unit_conversion=1_000_000.0,
        window_kind="short",
        require_both_windows=True,
        evidence=(
            "the rule's condition says `both evaluation windows crossed the slow burn multiplier`, so "
            "the expression covers short and long exactly as written; the ppm law is the same one "
            "SLO_BURN_FAST uses",
        ),
    ),
    RuleSource(
        rule_id="SLO_BUDGET_EXHAUSTED",
        family="wlct_slo_error_budget_remaining_ppm",
        comparison="<=",
        unit_conversion=None,
        window_kind=None,
        require_both_windows=False,
        evidence=(
            "the catalog's unit `remaining_budget_ppm` is the family's name verbatim, so the threshold "
            "needs no conversion",
            "the direction is `<=` because the condition says the remaining budget IS ZERO: a gauge "
            "that counts remaining budget fires downward, and `>` would alert on every healthy second "
            "of the platform's life",
        ),
    ),
    RuleSource(
        rule_id="TELEMETRY_EXPORT_FAILING",
        family="wlct_tracing_export_consecutive_failures",
        comparison=">",
        unit_conversion=None,
        window_kind=None,
        require_both_windows=False,
        evidence=(
            "apps/api/src/modules/observability/metrics.registry.provider.ts registers the family "
            "with the help text 'Consecutive trace export failures (alert threshold at 3; reset by any "
            "success or deliberate skip)'",
            "the direction follows AlertRule's own docstring - `threshold` is the value the observation "
            "exceeded - so `>` even though the help text's prose says `at 3`; whether three failures or "
            "four are the trigger is the catalog's policy, not this file's",
        ),
    ),
)


# --------------------------------------------------------------------------- reading


def _read(root: Path, rel: str) -> str:
    path = root / rel
    if not path.is_file():
        raise BundleError(f"required repository file is missing: {rel}")
    return path.read_text(encoding="utf-8")


def parse_env_example(text: str) -> dict[str, str]:
    """``KEY=value`` lines, and commented ``# KEY=value`` lines too.

    The commented form is what the repository uses for variables a deployment sets but no committed
    file may carry a value for (``# OTEL_ENDPOINT=...``). Reading only the uncommented form would
    make a documented default invisible, which is how a config generator ends up inventing its own.
    """
    out: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            stripped = stripped.lstrip("#").strip()
        m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", stripped)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


#: The list-valued fields a service block may carry that this tool reads. Anything else is not
#: collected at all: a checker that grew to cover every compose field would be a second compose
#: implementation, and the one that fails is the one that reads a field it was never given.
LIST_FIELDS: Final[tuple[str, ...]] = (
    "ports",
    "expose",
    "networks",
    "volumes",
    "command",
    "entrypoint",
)
SCALAR_FIELDS: Final[tuple[str, ...]] = ("image", "container_name")


def parse_compose_services(text: str) -> dict[str, dict[str, Any]]:
    """The subset of the compose document this tool needs, without a YAML dependency.

    Only ``services:``, each service block's ``LIST_FIELDS`` lists and ``SCALAR_FIELDS`` scalars,
    and nothing else. That is deliberate: a full YAML parser would let this file start depending on
    parts of compose it has no business interpreting (image digests, healthcheck timings, resource
    limits), and every extra field read is a field whose absence could later be mistaken for a fact.
    """
    services: dict[str, dict[str, Any]] = {}
    in_services = False
    current: str | None = None
    field: str | None = None
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw == "services:":
            in_services = True
            current = None
            field = None
            continue
        if in_services and not raw.startswith(" "):
            break  # a later top-level block (volumes:, networks:) ends the services section
        if not in_services:
            continue
        m = re.match(r"^  ([a-z][a-z0-9_-]*):\s*(#.*)?$", raw)
        if m:
            current = m.group(1)
            services[current] = {key: [] for key in LIST_FIELDS}
            services[current].update({key: "" for key in SCALAR_FIELDS})
            field = None
            continue
        if current is None:
            continue
        fm = re.match(r"^    ([a-z_]+):\s*(#.*)?$", raw)
        if fm:
            field = fm.group(1) if fm.group(1) in LIST_FIELDS else None
            continue
        sm = re.match(r"^    ([a-z_]+):\s*(.+?)\s*(?:#.*)?$", raw)
        if sm and sm.group(1) in SCALAR_FIELDS:
            services[current][sm.group(1)] = sm.group(2).strip().strip('"')
            continue
        im = re.match(r"^      - (.+)$", raw)
        if im and field:
            services[current][field].append(im.group(1).strip().strip('"'))
            continue
        if re.match(r"^    [a-z_]+:", raw):
            field = None
    return services


def service_port(entry: dict[str, Any]) -> tuple[int | None, str]:
    """The container port a service listens on, from ``expose`` or from a published mapping.

    ``127.0.0.1:${REDIS_PORT:-6379}:6379`` yields 6379 - the right-hand number, which is the port
    inside the network. Reading the left-hand one instead would make a target depend on the host's
    environment, which is exactly what an internal scrape must not do.
    """
    for item in entry["expose"]:
        m = re.match(r"^(\d+)$", item)
        if m:
            return int(m.group(1)), f"expose: {item}"
    for item in entry["ports"]:
        m = re.match(r"^([^:]+:)?([^:]+):(\d+)(?:/.*)?$", item)
        if m:
            return int(m.group(3)), f"ports: {item}"
    return None, "no expose or ports entry"


ROUTE_LINE_RE: Final[re.Pattern[str]] = re.compile(
    r'@router\.(?:get|api_route)\(\s*["\x27]/metrics["\x27]'
)


def _route_evidence(rel: str, text: str) -> str | None:
    """Where the ``/metrics`` route is DECLARED, or None if it is not declared at all.

    A file mentioning ``/metrics`` in its own docstring is not a route: three of the four Python
    routers do exactly that, several lines before the decorator. Evidence that points at prose would
    make the generated config look sourced when it is only adjacent, so the pattern is the decorator
    itself and the check below refuses a file that mentions the path without declaring it.
    """
    for i, line in enumerate(text.splitlines(), 1):
        if ROUTE_LINE_RE.search(line):
            return f"{rel}:{i}"
    return None


def discover_targets(
    *,
    compose_text: str,
    env: dict[str, str],
    sources: dict[str, str],
    families: dict[str, frozenset[str]],
) -> tuple[tuple[Target, ...], tuple[Excluded, ...]]:
    """Build the job list from compose plus each service's own source."""
    services = parse_compose_services(compose_text)
    targets: list[Target] = []
    excluded: list[Excluded] = []
    for name in CANDIDATE_SERVICES:
        entry = services.get(name)
        if entry is None:
            excluded.append(Excluded(name, "not a service in docker-compose.yml", COMPOSE_REL))
            continue
        if "wlct-internal" not in entry["networks"]:
            excluded.append(
                Excluded(
                    name,
                    "not on the internal network, so a scraper inside it could not reach it",
                    f"{COMPOSE_REL}: {name}.networks = {', '.join(entry['networks']) or 'none'}",
                )
            )
            continue
        port, port_evidence = service_port(entry)
        route_rel = ROUTES_BY_SERVICE.get(name)
        route_evidence = (
            _route_evidence(route_rel, sources.get(route_rel, "")) if route_rel else None
        )

        if name == "api":
            path = env.get("PROMETHEUS_PATH", "")
            if path != "/metrics":
                raise BundleError(
                    "the API's exposition path is configurable and this bundle expects the shipped "
                    f"default; {ENV_EXAMPLE_REL} says PROMETHEUS_PATH={path!r}. Change the template, "
                    "do not edit a generated file to match it"
                )
            targets.append(
                Target(
                    service=name,
                    compose_service=name,
                    port=port if port is not None else 4000,
                    # An expansion, not the value: the API can be re-pointed by environment, and the
                    # scrape has to follow it there rather than disagree with it.
                    metrics_path="${PROMETHEUS_PATH}",
                    path_is_expansion=True,
                    auth_header="x-metrics-token",
                    port_evidence=f"{COMPOSE_REL}: {name}.{port_evidence}",
                    path_evidence=(
                        "apps/api/src/config/app-config.service.ts reads PROMETHEUS_PATH "
                        f"({ENV_EXAMPLE_REL})"
                    ),
                    families_named_in_source=len(families.get(name, frozenset())),
                )
            )
            continue

        if port is None:
            excluded.append(
                Excluded(
                    name,
                    "serves no port at all, so there is no target to scrape",
                    f"{COMPOSE_REL}: {name} has neither expose nor ports",
                )
            )
            continue
        if route_evidence is None or route_rel is None:
            excluded.append(
                Excluded(
                    name,
                    "its source contains no GET /metrics route, so there is nothing to scrape",
                    route_rel or COMPOSE_REL,
                )
            )
            continue
        source_text = sources.get(route_rel, "")
        if '@router.get("/metrics"' not in source_text:
            raise BundleError(
                f"{route_rel} mentions /metrics but not as the literal route this bundle expects; the "
                "Python exposition paths are not configurable, so a change there is a change here, "
                "made deliberately and re-emitted rather than quietly followed"
            )
        targets.append(
            Target(
                service=name,
                compose_service=name,
                port=port,
                metrics_path="/metrics",
                path_is_expansion=False,
                auth_header=None,
                port_evidence=f"{COMPOSE_REL}: {name}.{port_evidence}",
                path_evidence=route_evidence,
                families_named_in_source=len(families.get(name, frozenset())),
            )
        )
    return tuple(targets), tuple(excluded)


def collect_families(root: Path, *, sources: dict[str, str]) -> dict[str, frozenset[str]]:
    """Every literal ``wlct_*`` name each service's source mentions, core included.

    This is a text scan, not a registry dump, and the distinction is the reason the catalog calls the
    count ``familiesNamedInSource`` rather than something that sounds like a fact about the endpoint: a
    name here proves somebody wrote it down in that tree, not that the service serves it. The scan is
    wide on purpose - a registration site that this pattern missed would make a REAL family look
    unregistered, which is the direction of error that could suppress a legitimate alert - and every
    use of the result states how much weight it can carry.
    """

    def scan(path: Path) -> set[str]:
        found: set[str] = set()
        if path.is_dir():
            for child in sorted(path.rglob("*")):
                if child.suffix not in (".py", ".ts") or "node_modules" in child.parts:
                    continue
                text = child.read_text(encoding="utf-8", errors="replace")
                sources[child.relative_to(root).as_posix()] = text
                found.update(FAMILY_RE.findall(text))
            return found
        if path.is_file():
            rel = path.relative_to(root).as_posix()
            if rel not in sources:
                sources[rel] = path.read_text(encoding="utf-8", errors="replace")
            found.update(FAMILY_RE.findall(sources[rel]))
        return found

    out: dict[str, frozenset[str]] = {}
    core_names: frozenset[str] | None = None
    for service, rels in FAMILY_SOURCES_BY_SERVICE.items():
        names: set[str] = set()
        for rel in rels:
            names |= scan(root / rel)
        if service in PYTHON_SERVICES:
            # A Python service does not merely reuse the core's names, it registers them: the
            # families under `wlct_trading/observability` are published by every process that builds
            # the registry. The API has its own TypeScript registry instead, and claiming the core's
            # names for it would put families in the catalog that its endpoint does not serve.
            if core_names is None:
                core_names = frozenset(scan(root / CORE_FAMILY_SOURCES))
            names |= set(core_names)
        out[service] = frozenset(names)
    return out


def registered_family_names(root: Path, service: str) -> frozenset[str]:
    """The families ``service`` registers *with a help string*, from its own source.

    The strict half of the family census, used for one purpose: reporting what a scrape did not
    contain. A name only counts when a registration site pairs it with a help literal, because the
    exposition format requires ``# HELP`` for every family a service serves - so a mention with no
    help is a prefix constant, an event name or a module path, and none of those is something a
    scrape could have failed to produce.

    Reporting absence is where the precision matters: a false "absent" sends an operator hunting for
    a metric that never existed, which is worse than no census at all. Rule derivation deliberately
    uses the wider scan in ``collect_families``, where the opposite error - a real alert suppressed
    because a registration site did not match a pattern - is the one worth trading a false positive
    against. Two sets, two directions of harm, one reason each.
    """
    if service not in FAMILY_SOURCES_BY_SERVICE:
        raise BundleError(
            f"{service!r} is not a service this bundle knows; it can name "
            + ", ".join(sorted(FAMILY_SOURCES_BY_SERVICE))
        )
    bases = [root / rel for rel in FAMILY_SOURCES_BY_SERVICE[service]]
    if service in PYTHON_SERVICES:
        bases.append(root / CORE_FAMILY_SOURCES)
    names: set[str] = set()
    for base in bases:
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in (".py", ".ts") or "node_modules" in path.parts:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for match in HELP_LINE_RE.finditer(text):
                name = match.group("name")
                # A name ending in `_` is a prefix that something else completes (the engine's
                # `wlct_execution_<counter>` families are built at runtime), and a prefix is not a
                # family any scrape could have carried.
                if not name.endswith("_"):
                    names.add(name)
    return frozenset(names)


def collect_help_texts(root: Path) -> dict[str, str]:
    """``family -> registered help text``, for rules that must not contradict it.

    Only a name immediately followed by a string literal matches. A family whose help cannot be found
    has no help, which is a refusal reason for rules that would have to read it - never a default.
    """
    help_texts: dict[str, str] = {}
    bases = (root / "apps/api/src", root / CORE_FAMILY_SOURCES)
    for base in bases:
        for path in sorted(base.rglob("*")):
            if path.suffix not in (".py", ".ts"):
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for m in HELP_LINE_RE.finditer(text):
                name = m.group("name")
                help_text = " ".join(m.group("help").split())
                if name not in help_texts and len(help_text) > 8:
                    help_texts[name] = help_text[:400]
    return help_texts


# --------------------------------------------------------------------------- rules


def rules_by_id() -> dict[str, AlertRule]:
    return {rule.rule_id: rule for rule in ALERT_RULES}


def _matcher_text(matchers: tuple[tuple[str, str], ...], kind: str | None) -> str:
    parts = [f'{label}="{value}"' for label, value in matchers]
    if kind is not None:
        parts.append(f'window_kind="{kind}"')
    return "{" + ",".join(parts) + "}" if parts else ""


def _complete_help(help_text: str | None) -> str | None:
    """The registered help text, only when it can be quoted whole.

    The TypeScript and Python registrations both concatenate string literals, and this tool reads the
    first fragment (parsing a concatenation across two languages is not a check worth its complexity).
    A fragment that ends mid-sentence is therefore either cut at its last full stop or not quoted at
    all: an evidence line that trails off into "A gauge: the" reads like a truncated quotation of a
    fact, and quoting half a sentence is how a comment starts being trusted less than the code.
    """
    if help_text is None:
        return None
    if help_text.endswith((".", ")")):
        return help_text
    cut = help_text.rfind(". ")
    if cut == -1:
        return None
    return help_text[: cut + 1]


def _threshold_text(value: float, conversion: float | None) -> str:
    scaled = value * (conversion or 1.0)
    return f"{scaled:.0f}" if float(scaled).is_integer() else f"{scaled:g}"


def candidate_names(rule: AlertRule, published: frozenset[str]) -> set[str]:
    """The registered names a reader would search, given this rule's unit.

    Reported in the catalog so that a refusal is checkable: "no family exposes resyncs_per_minute"
    can be re-run, while "I looked and found nothing" cannot.
    """
    unit = (rule.unit or "").split("_per_")[0]
    words = {w for w in re.split(r"[_/]", unit or "") if len(w) > 3}
    found: set[str] = set()
    for word in words:
        found.update(name for name in published if word in name)
    return found


def derive_rules(
    families_by_service: dict[str, frozenset[str]],
    help_texts: dict[str, str],
) -> tuple[tuple[RenderedRule, ...], tuple[RefusedRule, ...]]:
    """Render what the catalog supports; refuse the rest with a reason that can be checked."""
    rules = rules_by_id()
    published = (
        frozenset().union(*families_by_service.values()) if families_by_service else frozenset()
    )
    rendered: list[RenderedRule] = []
    refused: list[RefusedRule] = []

    for source in RULE_SOURCES:
        rule = rules.get(source.rule_id)
        if rule is None:
            raise BundleError(
                f"RULE_SOURCES names {source.rule_id}, which ALERT_RULES does not contain - the "
                "mapping and the catalog may not drift apart in opposite directions"
            )
        if source.family not in published:
            raise BundleError(
                f"{source.rule_id} maps to {source.family}, which no service in this tree registers; "
                "the mapping is stale and refusing to render everything is the honest answer"
            )
        if rule.threshold is None:
            refused.append(RefusedRule(source.rule_id, REFUSE_NO_THRESHOLD, (source.family,)))
            continue

        allowed: list[str] = []
        threshold_text = _threshold_text(rule.threshold, source.unit_conversion)
        allowed.append(threshold_text)
        if source.unit_conversion is not None:
            allowed.append(f"{source.unit_conversion:.0f}")

        kinds = (
            ("short", "long")
            if source.require_both_windows
            else ((source.window_kind,) if source.window_kind else (None,))
        )
        sides = [
            f"{source.family}{_matcher_text(source.matchers, kind)} {source.comparison} {threshold_text}"
            for kind in kinds
        ]
        evidence = list(source.evidence)
        help_text = _complete_help(help_texts.get(source.family))
        if help_text is not None:
            evidence.insert(0, f"registered help: {help_text}")
        rendered.append(
            RenderedRule(
                rule_id=source.rule_id,
                severity=rule.severity.value,
                title=rule.title,
                family=source.family,
                expr=" and ".join(sides),
                labels=(("severity", rule.severity.value.lower()), ("rule_id", source.rule_id)),
                evidence=tuple(evidence),
                allowed_numbers=tuple(sorted(set(allowed))),
            )
        )

    rendered_ids = {rule.rule_id for rule in rendered}
    for rule in ALERT_RULES:
        if rule.rule_id in rendered_ids:
            continue
        if rule.threshold is None:
            refused.append(RefusedRule(rule.rule_id, REFUSE_NO_THRESHOLD))
        else:
            refused.append(
                RefusedRule(
                    rule.rule_id,
                    REFUSE_NO_FAMILY,
                    searched=tuple(sorted(candidate_names(rule, published)))[:8],
                )
            )
    return tuple(sorted(rendered, key=lambda r: r.rule_id)), tuple(sorted(refused, key=lambda r: r.rule_id))


# --------------------------------------------------------------------------- rendering


def render_prometheus_config(targets: tuple[Target, ...]) -> str:
    header = "\n".join(
        [
            "# The scrape configuration for this platform's own services.",
            "#",
            f"# GENERATED by `python3 libs/trading-core/scripts/{Path(__file__).name} --emit`.",
            "# Do not edit: `--check` compares this file against a fresh render and fails on drift,",
            "# and an edit here is a change the code being scraped will never notice.",
            "#",
            "# What is deliberately absent:",
            "#   * `scrape_interval` / `evaluation_interval` - this repository declares no scrape",
            "#     cadence, so the pinned image's default stands. A number typed here would be a",
            "#     policy nobody chose, and `--check` fails if one appears.",
            "#   * `global.external_labels` and any relabeling - adding labels is how a scraper",
            "#     silently widens cardinality, which is the law",
            "#     `libs/trading-core/wlct_trading/observability/labels.py` enforces at registration.",
            "#     The monitoring side does not get to route around what the code cannot break.",
            "#   * rule files beyond `rules/wlct.rules.yml` - the only alerts that exist are the ones",
            "#     derived from ALERT_RULES, and that file lists the ones that refused to render.",
            "#",
            f"# Needs Prometheus >= {MIN_SCRAPE_HEADERS_VERSION} for `http_headers`. Pinned:",
            f"#   {PROMETHEUS_IMAGE}",
            "#",
            "# `${...}` is Prometheus' own environment expansion, applied inside the container, and",
            "# it is used wherever the value belongs to the deployment rather than to the repository.",
            "# An unset variable expands to the empty string, which makes the config invalid for that",
            "# job rather than quietly scraping something else: failing loudly is the house style.",
            "",
        ]
    )
    blocks: list[str] = ["scrape_configs:"]
    for target in targets:
        block = [
            f"  # {target.service}: {target.path_evidence}",
            f"  - job_name: wlct-{target.service}",
            f"    metrics_path: {target.metrics_path}",
            "    static_configs:",
            f"      - targets: [\"{target.compose_service}:{target.port}\"]",
        ]
        if target.auth_header is not None:
            block.extend(
                [
                    "    http_headers:",
                    "      headers:",
                    f"        {target.auth_header}: \"${{METRICS_TOKEN}}\"",
                    "    # The header is harmless when no token is configured: the controller returns",
                    "    # early when `metricsToken` is undefined (metrics.controller.ts), and in",
                    "    # production the environment validation makes METRICS_TOKEN exist at all. So",
                    "    # development scrapes without a secret and production cannot be scraped",
                    "    # without one, from the same three lines of config.",
                ]
            )
        blocks.append("\n".join(block))
    return header + "\n\n".join(blocks) + "\n"


def render_rules_file(
    rendered: tuple[RenderedRule, ...],
    refused: tuple[RefusedRule, ...],
    targets: tuple[Target, ...],
) -> str:
    total = len(rendered) + len(refused)
    lines: list[str] = [
        "# Alert rules for this platform, derived from the catalog that already owns them.",
        "#",
        f"# GENERATED by `python3 libs/trading-core/scripts/{Path(__file__).name} --emit` - drift is a",
        "# failure, not a suggestion, and `--check` re-renders and compares.",
        "#",
        "# Where the numbers come from:",
        "#   libs/trading-core/wlct_trading/observability/alerts.py  (ALERT_RULES)",
        "#",
        "# Every threshold below is an `AlertRule.threshold`, optionally scaled by a unit conversion",
        "# the family's own registered help asks for. Nothing here was decided here, and the file says",
        "# so by listing the rules it refused to write:",
        "",
        f"#   rendered: {len(rendered)} of {total} catalog rules",
    ]
    for rule in refused:
        lines.append(f"#   not rendered  {rule.rule_id}: {rule.reason}")
        if rule.searched:
            lines.append(f"#               searched the registered names: {', '.join(rule.searched)}")
    lines += [
        "",
        "# No `for:` clause appears below, and no group sets `interval`. A sustained-for duration is a",
        "# policy and ALERT_RULES carries none; dwell time belongs to the alert engine that already",
        "# owns dedupe (ALERT_DEDUP_WINDOW_MS). Firing states are visible in Prometheus' own UI, while",
        "# the durable alert record stays the application's, because a second store of alerts is a",
        "# second truth to reconcile.",
        "",
        "groups:",
        "  - name: wlct-slo",
        "    rules:",
    ]
    for rule in [r for r in rendered if r.rule_id.startswith("SLO_")]:
        lines += _rule_lines(rule)
    lines += ["", "  - name: wlct-platform", "    rules:"]
    for rule in [r for r in rendered if not r.rule_id.startswith("SLO_")]:
        lines += _rule_lines(rule)
    # Parenthesised on purpose: Prometheus anchors `=~` at both ends, so `wlct-a|b` would match
    # `wlct-a` and `b` and silently never match `wlct-b` - a broken availability alert that still
    # reads correctly in review. `assert_job_regex_matches_every_target` below is what keeps that
    # from being a comment instead of a guarantee.
    jobs = "|".join(t.service for t in targets)
    lines += [
        "",
        "  - name: wlct-availability",
        "    rules:",
        "      # The one rule here that is not in the catalog, and the only number it uses is 0 - the",
        "      # definition of a failed scrape, not a threshold somebody set. It exists because every",
        "      # rule above is silent while its own target is unreachable, and silence",
        "      # indistinguishable from health is the failure mode this repository names in four",
        "      # separate documents. Adding a metric to this list is not possible from here: the job",
        "      # regex is generated from the same evidence rules that decide what gets scraped.",
        "      - alert: WLCTScrapeTargetDown",
        f"        expr: up{{job=~\"wlct-({jobs})\"}} == 0",
        "        labels:",
        "          severity: critical",
        "          source: scrape",
        "        annotations:",
        "          summary: A platform service stopped being scraped.",
        "          description: >-",
        "            Absence of telemetry, reported as absence rather than as health. Nothing in this",
        "            bundle claims to know why the target is down, and nothing here can page anybody.",
    ]
    return "\n".join(lines) + "\n"


def _rule_lines(rule: RenderedRule) -> list[str]:
    lines = [
        f"      # {rule.title}",
        *[f"      # evidence: {line}" for line in rule.evidence],
        f"      - alert: WLCT{rule.rule_id.replace('_', '')}",
        f"        expr: {rule.expr}",
        "        labels:",
    ]
    for label, value in rule.labels:
        lines.append(f"          {label}: {value}")
    lines += [
        "        annotations:",
        f"          summary: {rule.title}",
        "          description: >-",
        f"            Derived from ALERT_RULES {rule.rule_id}. The durable record and the",
        "            blocks_trading hint live in the application; this is the scrape-side mirror,",
        "            which grants nothing and changes no verdict.",
    ]
    return lines


def render_catalog(
    *,
    targets: tuple[Target, ...],
    excluded: tuple[Excluded, ...],
    rendered: tuple[RenderedRule, ...],
    refused: tuple[RefusedRule, ...],
    families_by_service: dict[str, frozenset[str]],
) -> str:
    catalog: dict[str, Any] = {
        "schema": CATALOG_SCHEMA,
        "reading": (
            "The deployment side of the platform's telemetry, as data. `targets` are the services "
            "whose own compose block and source say there is something to scrape; `excluded` names "
            "every candidate that is not scraped and why, because an omission reads as an oversight. "
            "`rules.rendered` are ALERT_RULES entries with a numeric threshold AND a registered "
            "family; `rules.refused` is the rest of the catalog with the reason each stayed unwritten. "
            "`families` is a literal scan of each service's own source: a name listed there is a "
            "mention, not proof the endpoint serves it, and the count is not a count of series. "
            "Nothing here records a measurement - no scrape was performed to build it."
        ),
        "bundle": {
            "prometheusConfig": PROMETHEUS_CONFIG_REL,
            "rules": RULES_REL,
            "compose": OBS_COMPOSE_REL,
            "readme": README_REL,
        },
        "image": {
            "reference": PROMETHEUS_IMAGE,
            "minimumVersionForHttpHeaders": MIN_SCRAPE_HEADERS_VERSION,
            "why": (
                "pinned because this config uses `http_headers`, and a floating tag lets a major "
                "version change the format underneath a committed file"
            ),
        },
        "cadence": {
            "scrapeInterval": None,
            "sustainedFor": None,
            "why": (
                "the repository declares neither, so neither is invented here; the image's default "
                "applies and the generator refuses to emit a file that sets one"
            ),
        },
        "targets": [t.to_dict() for t in targets],
        "excluded": [e.to_dict() for e in excluded],
        "families": {
            service: sorted(names)
            for service, names in sorted(families_by_service.items())
            if names
        },
        "rules": {
            "catalogSize": len(ALERT_RULES),
            "rendered": [r.to_dict() for r in rendered],
            "refused": [f.to_dict() for f in refused],
        },
        "notIncluded": [
            {
                "item": "Alertmanager",
                "reason": (
                    "the platform already owns the alert lifecycle - ALERT_RULES, the fold, durable "
                    "dedupe and retention in wlct_trading/observability/alerts.py and "
                    "apps/api/src/modules/observability - and a second store of the same alerts is a "
                    "second truth to reconcile"
                ),
            },
            {
                "item": "Grafana provisioning and dashboard JSON",
                "reason": (
                    "a panel file needs a data source UID and a layout, neither of which exists in "
                    "this tree; the dashboard the platform does own is the derived document built by "
                    "wlct_trading/observability/dashboard.py, and --dashboard renders exactly that "
                    "from an exposition file an operator captures"
                ),
            },
            {
                "item": "RED rows over the scraped text",
                "reason": (
                    "the RED view is Part 21's, in-process, and needs surfaces and budgets a caller "
                    "owns; a file cannot own a budget without inventing one, which is the law Part 21 "
                    "states and this bundle repeats rather than competes with"
                ),
            },
            {
                "item": "OpenTelemetry collector",
                "reason": (
                    "`OTEL_ENDPOINT` names http://otel-collector:4318 in .env.example as a "
                    "deployment-provided address; shipping a collector would mean choosing the "
                    "exporter it writes to, and this repository has no trace backend to name"
                ),
            },
            {
                "item": "node-exporter or any host-level exporter",
                "reason": (
                    "out of scope for a platform whose failure modes are trading-path ones, and every "
                    "added exporter is another image to pin and another surface to secure"
                ),
            },
        ],
    }
    return json.dumps(catalog, indent=2, sort_keys=True) + "\n"


def render_readme(
    *,
    targets: tuple[Target, ...],
    excluded: tuple[Excluded, ...],
    rendered: tuple[RenderedRule, ...],
    refused: tuple[RefusedRule, ...],
) -> str:
    lines = [
        "# The scrape bundle",
        "",
        "The deployment side of the platform's telemetry: which process reads the exposition this",
        "code already publishes, and which rules it may evaluate. Everything under `prometheus/` here",
        "is generated from files elsewhere in the repository, so the two cannot disagree by accident.",
        "",
        "## Generate and verify",
        "",
        "```sh",
        "python3 libs/trading-core/scripts/gen_observability_bundle.py --check",
        "python3 libs/trading-core/scripts/gen_observability_bundle.py --emit",
        "python3 libs/trading-core/scripts/gen_observability_bundle.py --catalog",
        "python3 libs/trading-core/scripts/gen_observability_bundle.py --rules",
        "```",
        "",
        "`--check` is what CI runs and it writes nothing; exit 0 means the committed bundle matches a",
        "fresh render, 1 means drift, 2 means an input this bundle depends on is missing or unreadable,",
        "3 means the command itself was refused. `--emit` refuses to overwrite a file it did not",
        "generate unless `--force` is passed, because a hand-edited artifact is a fact about somebody's",
        "intent that a generator has no business destroying.",
        "",
        "## Seeing the dashboard this format already has",
        "",
        "```sh",
        "curl -s http://127.0.0.1:9090/api/v1/query?query=up > /dev/null   # not run by this tool",
        "curl -s http://execution-engine:8093/metrics \\",
        "  | python3 libs/trading-core/scripts/gen_observability_bundle.py \\",
        "      --dashboard execution-engine --from -",
        "```",
        "",
        "The second command is the whole `--dashboard` mode: exposition text in, the repository's own",
        "dashboard document out, with the families a service registers but the scrape did not",
        "contain listed as absent rather than as zero. Nothing synthesises a value, so an idle service "
        "renders as absent or",
        "zero rather than healthy, and this tool never performs the curl itself.",
        "",
        "## Deploy",
        "",
        "```sh",
        "docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d prometheus",
        "```",
        "",
        "The extra file adds one service. It mounts this directory read-only, publishes 9090 on",
        "127.0.0.1 only like Postgres and Redis publish theirs, and sets no lifecycle endpoint, so",
        "changing the config means a restart - which is what makes a check that fails loudly worth",
        "having.",
        "",
        "## What is scraped",
        "",
        "| service | port | path | note |",
        "| --- | --- | --- | --- |",
    ]
    for target in targets:
        note = (
            "token expanded from the deployment environment"
            if target.auth_header
            else "unauthenticated on the internal network"
        )
        lines.append(
            f"| `{target.service}` | {target.port} | `{target.metrics_path}` | {note} "
            f"({target.families_named_in_source} `wlct_*` names in its source) |"
        )
    lines += ["", "## What is not, and why", ""]
    for entry in excluded:
        lines.append(f"* `{entry.service}` - {entry.reason} ({entry.evidence})")
    lines += ["", "## Rules", ""]
    lines.append(
        f"{len(rendered)} of {len(rendered) + len(refused)} catalog rules became Prometheus alerts:"
    )
    lines.append("")
    for rule in rendered:
        lines.append(f"* `{rule.rule_id}` ({rule.severity}) - `{rule.expr}`")
        for evidence in rule.evidence:
            lines.append(f"  - {evidence}")
    lines += [
        "",
        "The rest stayed in the catalog. A rules file is where an invented number goes to look",
        "official, so each refusal names what was missing:",
        "",
    ]
    for entry in refused:
        searched = f" (searched: {', '.join(entry.searched)})" if entry.searched else ""
        lines.append(f"* `{entry.rule_id}` - {entry.reason}{searched}")
    lines += [
        "",
        "## Boundary",
        "",
        "This bundle is not a monitoring product and it observes nothing. Nothing in the trading path",
        "imports it, no rule here can change a risk decision or block a placement, and no file in this",
        "directory contains a credential: `METRICS_TOKEN` appears only as an expansion. The durable",
        "alert record, the SLO evaluation rows and the operations console stay where they were.",
        "Prometheus is a reader. If it is switched off, nothing about trading changes, and the",
        "difference between that and the platform going dark is exactly what `WLCTScrapeTargetDown`",
        "is for.",
        "",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------- audits


def assert_no_invented_numbers(rules_text: str, rendered: tuple[RenderedRule, ...]) -> None:
    """Every numeric literal in the rule file must be attributable.

    This is the part's own answer to the question an operator asks a rules file: where did 14.4 come
    from. The answer has to be "the catalog" or "the ppm unit of the family it measures", and the
    audit is a refusal rather than a comment - the allowed set is declared on each rule, never read
    back out of the expression the rule produced, so a rule cannot widen its own allowance.
    """
    allowed: set[str] = {"0"}
    for rule in rendered:
        allowed.update(rule.allowed_numbers)
    offenders: list[str] = []
    for i, line in enumerate(rules_text.splitlines(), 1):
        if line.lstrip().startswith("#"):
            continue
        m = re.match(r"^\s*(?:expr|for|keep_firing_for):\s*(.*)$", line)
        if m is None:
            continue
        for token in re.findall(r"(?<![A-Za-z0-9_.])(\d+(?:\.\d+)?)(?![A-Za-z0-9_.])", m.group(1)):
            if token not in allowed:
                offenders.append(f"line {i}: {token} is not attributable to ALERT_RULES")
    if offenders:
        raise BundleError(f"invented numbers in {RULES_REL}: " + "; ".join(offenders))


def assert_no_secret_shapes(artifacts: dict[str, str]) -> None:
    for rel, text in artifacts.items():
        hits = [m.group(0) for m in SECRET_SHAPE_RE.finditer(text) if "${" not in m.group(0)]
        if hits:
            raise BundleError(
                f"{rel} would carry a secret-shaped literal ({hits[0][:32]}...); this bundle takes "
                "credentials only as ${...} expansions"
            )


def assert_no_invented_cadence(artifacts: dict[str, str]) -> None:
    config = artifacts[PROMETHEUS_CONFIG_REL]
    for key in ("scrape_interval", "evaluation_interval", "honor_labels", "scrape_timeout"):
        if re.search(rf"^\s*{key}:", config, re.M):
            raise BundleError(
                f"{PROMETHEUS_CONFIG_REL} sets `{key}`; this repository declares no cadence or "
                "label-honouring policy, so the generated file must not either"
            )
    rules = artifacts[RULES_REL]
    for key in ("for", "interval", "keep_firing_for"):
        if re.search(rf"^\s*{key}:", rules, re.M):
            raise BundleError(
                f"{RULES_REL} sets `{key}`; ALERT_RULES carries no dwell time and the catalog owns "
                "nothing that a group interval would express"
            )


#: The shapes that would let the deployment side add a label without touching the code. `labelmap` is
#: a relabel action rather than a block, and `external_labels` is the one that hides in `global:` where
#: no per-job audit would look for it.
CARDINALITY_ESCAPES: Final[tuple[str, ...]] = (
    "metric_relabel_configs",
    "relabel_configs",
    "external_labels",
    "labelmap",
)


def assert_labels_are_not_invented(artifacts: dict[str, str]) -> None:
    """No relabeling and no extra labels: nothing may widen cardinality from the outside.

    Comments are excluded, which is what makes the audit read the config rather than the file: the
    generated header names these very keys to explain why they are absent, and a checker that greps
    text would report that explanation as a violation. The same rule the overlay laws follow, applied
    to the tool's own output.
    """
    for rel in (PROMETHEUS_CONFIG_REL, RULES_REL):
        for line in artifacts[rel].splitlines():
            if line.strip().startswith("#"):
                continue
            for needle in CARDINALITY_ESCAPES:
                if needle in line:
                    raise BundleError(
                        f"{rel} contains {needle!r}; the cardinality law lives in "
                        "wlct_trading/observability/labels.py and a deployment file may not route "
                        "around it"
                    )


#: The labels a rendered rule may carry. `severity` comes from `AlertSeverity`, `rule_id` from the
#: catalog, and `source` is the availability rule's own constant. A fourth label would be a dimension
#: invented here, and every label on an alert rule is a label on every series it produces.
ALLOWED_RULE_LABELS: Final[frozenset[str]] = frozenset({"severity", "rule_id", "source"})


def assert_job_regex_matches_every_target(
    config_text: str, rules_text: str, targets: tuple[Target, ...]
) -> None:
    """The availability alert must cover every scraped job, proven by evaluating it.

    WHY: the rule and the jobs are rendered from the same list but written in two different syntaxes,
    and a regex that is anchored differently from what the author assumed would leave a target
    unmonitored while the file still looked complete. So the audit does what Prometheus does: it
    anchors the pattern and tries every job name in the config.
    """
    m = re.search(r"up\{job=~\"([^\"]+)\"\}", rules_text)
    if m is None:
        raise BundleError(f"{RULES_REL} has no `up{{job=~...}}` rule to audit")
    pattern = re.compile("^(?:%s)$" % m.group(1))
    jobs = re.findall(r"^\s*- job_name: (\S+)$", config_text, re.M)
    declared = [t for t, expected in zip(targets, jobs) if expected != f"wlct-{t.service}"]
    if declared:
        raise BundleError(
            "generated job names do not follow `wlct-<service>` for "
            + ", ".join(t.service for t in declared)
            + "; the availability regex and the jobs must be built from one rule"
        )
    uncovered = [job for job in jobs if pattern.match(job) is None]
    if uncovered:
        raise BundleError(
            f"{RULES_REL}'s availability regex misses {', '.join(uncovered)}; a target that cannot be"
            " reported down is a target whose absence reads as health"
        )


def assert_only_catalog_labels(artifacts: dict[str, str]) -> None:
    """Read the label blocks, not the whole file: annotations have keys too, and they are prose."""
    offenders: list[str] = []
    in_labels = False
    for i, line in enumerate(artifacts[RULES_REL].splitlines(), 1):
        if line.strip().startswith("#"):
            continue
        if re.match(r"^\s*labels:\s*$", line):
            in_labels = True
            continue
        if not in_labels:
            continue
        m = re.match(r"^(\s+)([a-zA-Z_][a-zA-Z0-9_]*):", line)
        if m is None or len(m.group(1)) < 10:
            in_labels = False
            if m is None or len(m.group(1)) > 10:
                continue
        if m is not None and len(m.group(1)) == 10 and m.group(2) not in ALLOWED_RULE_LABELS:
            offenders.append(f"line {i}: {m.group(2)}")
    if offenders:
        raise BundleError(
            f"{RULES_REL} puts invented labels on a series ({'; '.join(offenders)}); only "
            + ", ".join(sorted(ALLOWED_RULE_LABELS))
            + " are derived from the catalog"
        )


# --------------------------------------------------------------------------- composition


def compose_bundle(root: Path) -> dict[str, str]:
    """Read the tree, render everything, run every audit. Pure: this writes nothing."""
    env = parse_env_example(_read(root, ENV_EXAMPLE_REL))
    compose_text = _read(root, COMPOSE_REL)
    sources: dict[str, str] = {}
    for rel in ROUTES_BY_SERVICE.values():
        path = root / rel
        if path.is_file():
            sources[rel] = path.read_text(encoding="utf-8", errors="replace")
    families = collect_families(root, sources=sources)
    targets, excluded = discover_targets(
        compose_text=compose_text, env=env, sources=sources, families=families
    )
    if not targets:
        raise BundleError(
            "no service survived the target rules; refusing to emit a bundle that scrapes nothing"
        )
    rendered, refused = derive_rules(families, collect_help_texts(root))
    artifacts = {
        PROMETHEUS_CONFIG_REL: render_prometheus_config(targets),
        RULES_REL: render_rules_file(rendered, refused, targets),
        CATALOG_REL: render_catalog(
            targets=targets,
            excluded=excluded,
            rendered=rendered,
            refused=refused,
            families_by_service=families,
        ),
        README_REL: render_readme(
            targets=targets, excluded=excluded, rendered=rendered, refused=refused
        ),
    }
    assert_no_invented_numbers(artifacts[RULES_REL], rendered)
    assert_no_invented_cadence(artifacts)
    assert_no_secret_shapes(artifacts)
    assert_labels_are_not_invented(artifacts)
    assert_job_regex_matches_every_target(
        artifacts[PROMETHEUS_CONFIG_REL], artifacts[RULES_REL], targets
    )
    assert_only_catalog_labels(artifacts)
    return artifacts


def check_bundle(root: Path) -> tuple[int, list[str]]:
    """Compare every committed artifact with a fresh render, plus the compose laws. Writes nothing."""
    try:
        artifacts = compose_bundle(root)
    except BundleError as exc:
        return EXIT_MISSING, [f"refused: {exc}"]
    lines: list[str] = []
    drift = False
    for rel, text in sorted(artifacts.items()):
        path = root / rel
        if not path.is_file():
            lines.append(f"missing  {rel}")
            drift = True
        elif path.read_text(encoding="utf-8") != text:
            lines.append(f"drift    {rel} differs from a fresh render")
            drift = True
        else:
            lines.append(f"ok       {rel}")

    compose = root / OBS_COMPOSE_REL
    if not compose.is_file():
        lines.append(f"missing  {OBS_COMPOSE_REL}")
        drift = True
    else:
        problems = overlay_laws(compose.read_text(encoding="utf-8"))
        for problem in problems:
            lines.append(f"drift    {OBS_COMPOSE_REL}: {problem}")
            drift = True
        if not problems:
            # Reported even when it passes. A check nobody prints is indistinguishable from a check
            # that did not run, and this one is the only thing standing between the hand-written
            # overlay and a mount that stopped being read-only.
            lines.append(f"ok       {OBS_COMPOSE_REL} (overlay laws)")
    return (EXIT_DRIFT if drift else EXIT_OK), lines


#: What the observability overlay must and must not do. Every law reads the PARSED service block
#: instead of substring-matching the file, because that compose file explains the lifecycle flag in a
#: comment - and a checker that reports its own documentation as a deployment defect is a check
#: people learn to ignore, which is how a control stops being one.
OVERLAY_SERVICES: Final[frozenset[str]] = frozenset({"prometheus"})


def overlay_laws(text: str) -> list[str]:
    """The overlay's laws as a list of problems; empty means the deployment matches the bundle."""
    services = parse_compose_services(text)
    problems: list[str] = []
    names = set(services)
    if names != set(OVERLAY_SERVICES):
        extra = ", ".join(sorted(names - set(OVERLAY_SERVICES))) or "none"
        missing = ", ".join(sorted(set(OVERLAY_SERVICES) - names)) or "none"
        problems.append(
            f"declares services [{extra}] where only {sorted(OVERLAY_SERVICES)} belongs "
            f"(missing: {missing}); the banner at the top of that file lists what is deliberately "
            "absent, and a second service turns that list into a lie"
        )
        return problems
    entry = services["prometheus"]
    if entry["image"] != PROMETHEUS_IMAGE:
        problems.append(
            f"runs image {entry['image']!r}; the bundle is written against {PROMETHEUS_IMAGE!r} "
            f"because `http_headers` needs Prometheus >= {MIN_SCRAPE_HEADERS_VERSION} and a "
            "floating tag lets a major version move the config format underneath a committed file"
        )
    # `./` and the bare path name the same bind mount, and compose accepts either, so the
    # comparison normalises instead of demanding one spelling.
    mounted = [v[2:] if v.startswith("./") else v for v in entry["volumes"]]
    if f"{BUNDLE_DIR_REL}/prometheus:/etc/prometheus:ro" not in mounted:
        problems.append(
            "does not mount the generated bundle read-only at /etc/prometheus, so what runs is "
            "whatever the host happens to have in mind"
        )
    if "prometheus-data:/prometheus" not in entry["volumes"]:
        problems.append(
            "mounts no named volume at the TSDB path, so the history dies with the container while "
            "`--storage.tsdb.path` promises it lives on disk"
        )
    if not re.search(r"^volumes:\n(?:  [^\n]*\n)*  prometheus-data:", text, re.M):
        problems.append("uses prometheus-data without declaring it at the top of the file")
    beyond_loopback = [port for port in entry["ports"] if not port.startswith("127.0.0.1:")]
    if beyond_loopback:
        problems.append(
            "publishes "
            + ", ".join(beyond_loopback)
            + " beyond the loopback; Postgres and Redis bind to 127.0.0.1 for the same reason"
        )
    if "127.0.0.1:${PROMETHEUS_PORT:-9090}:9090" not in entry["ports"]:
        problems.append(
            "does not publish 9090 as `127.0.0.1:${PROMETHEUS_PORT:-9090}:9090`, the one shape that "
            "keeps the port configurable and the surface local"
        )
    if "wlct-internal" not in entry["networks"]:
        problems.append(
            "is not on wlct-internal, so it cannot reach the ports the services expose rather than "
            "publish"
        )
    flags = list(entry["command"]) + list(entry["entrypoint"])
    if any("enable-lifecycle" in flag for flag in flags):
        problems.append(
            "enables the lifecycle API; a POST that reloads a monitoring config, on a container with "
            "no need of that power, is an unauthenticated control surface"
        )
    if any(flag.startswith("--web.listen-address") and not flag.endswith(":9090") for flag in flags):
        problems.append("moves the listen address off 9090 while the publish line does not follow")
    for line in text.splitlines():
        if line.strip().startswith("#"):
            continue
        if re.match(r"^\s*privileged:\s*true\s*(?:#.*)?$", line):
            problems.append("asks for privileged mode")
        if re.match(r"^\s*network_mode:\s*host\s*(?:#.*)?$", line):
            problems.append("uses host networking, which skips the network the ports law depends on")
    return problems


# --------------------------------------------------------------------------- write
#
# `--emit` is the only mode that touches the working tree, so the whole of the tool's restraint lives
# in these lines: plan everything first, then write. A generator that wrote three of four files and
# then refused on the fourth would leave a bundle whose parts disagree with each other, which is the
# one state this tool exists to prevent.


def _is_generated(rel: str, text: str) -> bool:
    """Whether ``text`` was produced by this tool, and so whether overwriting it destroys anything.

    JSON has no comments, so the catalog's marker is a field rather than the banner; a file that
    carries neither is somebody's work, and the difference is worth a refusal.
    """
    if GENERATED_MARK in text:
        return True
    if rel == CATALOG_REL:
        try:
            payload = json.loads(text)
        except ValueError:
            return False
        return isinstance(payload, dict) and payload.get("schema") == CATALOG_SCHEMA
    return False


def emit_bundle(root: Path, *, force: bool = False) -> tuple[int, list[str]]:
    """Render the bundle and write it, refusing to clobber anything this tool did not generate."""
    try:
        artifacts = compose_bundle(root)
    except BundleError as exc:
        return EXIT_MISSING, [f"refused: {exc}"]

    plan: list[tuple[str, Path, str]] = []
    lines: list[str] = []
    refused: list[str] = []
    for rel in sorted(artifacts):
        rendered = artifacts[rel]
        target = root / rel
        if target.is_file():
            current = target.read_text(encoding="utf-8")
            if current == rendered:
                lines.append(f"unchanged {rel}")
                continue
            if not _is_generated(rel, current) and not force:
                refused.append(rel)
                lines.append(
                    f"refused   {rel} differs and does not carry this tool's marker; it looks "
                    "hand-edited, so nothing was written anywhere - pass --force to overwrite"
                )
                continue
        plan.append((rel, target, rendered))
    if refused:
        # The refusal is printed before any write on purpose: a bundle that is half regenerated is a
        # bundle where the rules and the scrape targets disagree, and `--check` would then report
        # drift in files whose author believed they had just run `--emit`.
        return EXIT_REFUSED, lines
    for rel, target, rendered in plan:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered, encoding="utf-8")
        lines.append(f"wrote     {rel} ({len(rendered.splitlines())} lines)")
    return EXIT_OK, lines


def read_exposition(source: str) -> str:
    """The text a scrape produced, from a file or ``-`` for stdin, within the size this tool parses.

    The cap and the NUL check are not paranoia about hostile input: a truncated pipe and a binary
    dump both arrive here as "text", and both would parse into a dashboard that looks merely quiet.
    Refusing at the boundary is what keeps a quiet dashboard a statement about the service rather
    than about the shell command that fed this one.
    """
    if source == "-":
        raw = sys.stdin.buffer.read()
    else:
        path = Path(source)
        if not path.is_file():
            raise BundleError(f"--from names {source!r}, which is not a file")
        try:
            raw = path.read_bytes()
        except OSError as exc:
            raise BundleError(f"--from {source!r} could not be read: {exc}") from exc
    if len(raw) > MAX_EXPOSITION_BYTES:
        raise BundleError(
            f"exposition is {len(raw)} bytes, over the {MAX_EXPOSITION_BYTES}-byte cap; a scrape this "
            "large means a label cardinality problem, not a dashboard to render"
        )
    if b"\x00" in raw:
        raise BundleError("exposition contains a NUL byte, which no registry writes")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise BundleError(f"exposition is not UTF-8: {exc}") from exc
    if not text.strip():
        raise BundleError(
            "exposition is empty; a failed curl and an idle service both look like this, and the "
            "dashboard cannot tell them apart - so neither can this tool, and it refuses"
        )
    return text


def plain_catalog(payload: dict[str, Any]) -> str:
    """The catalog as a page, for a human who has the file but not a JSON reader.

    Nothing is derived here that the payload does not already state: every line is one field printed,
    because a summary that computes its own numbers is a second document to keep honest.
    """
    lines = [
        f"schema {payload['schema']}",
        f"reader {payload['image']['reference']} "
        f"(config syntax needs >= {payload['image']['minimumVersionForHttpHeaders']})",
        f"cadence scrape={payload['cadence']['scrapeInterval']} "
        f"sustainedFor={payload['cadence']['sustainedFor']}",
        "",
        "scraped",
    ]
    for target in payload["targets"]:
        auth = f" header {target['authHeader']}" if target["authHeader"] else ""
        expansion = " (path from the environment)" if target["metricsPathIsExpansion"] else ""
        lines.append(
            f"  {target['service']:<20} {target['composeService']}:{target['port']} "
            f"{target['metricsPath']}{auth}{expansion}"
        )
        lines.append(f"  {'':<20} port from {target['portEvidence']}; path from {target['pathEvidence']}")
        lines.append(
            f"  {'':<20} {target['familiesNamedInSource']} families named in the service's own source"
        )
    lines += ["", "not scraped"]
    for entry in payload["excluded"]:
        lines.append(f"  {entry['service']:<20} {entry['reason']}")
        lines.append(f"  {'':<20} evidence: {entry['evidence']}")
    rules = payload["rules"]
    lines += [
        "",
        f"rules: {len(rules['rendered'])} rendered of {rules['catalogSize']} in the catalog, "
        f"{len(rules['refused'])} refused",
    ]
    for rule in rules["rendered"]:
        lines.append(f"  {rule['ruleId']:<26} {rule['severity']:<9} {rule['expr']}")
        lines.append(f"  {'':<26} on {rule['family']}")
    for entry in rules["refused"]:
        lines.append(f"  {entry['ruleId']:<26} refused - {entry['reason']}")
    lines += ["", "deliberately absent"]
    for entry in payload["notIncluded"]:
        lines.append(f"  {entry['item']}")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- dashboard
#
# `--dashboard` is the one mode that reads what a scrape produced. It exists because the repository
# already owns a dashboard document (observability/dashboard.py) and the only input a Prometheus
# scrape yields is exposition text. The library takes a registry snapshot, so the text is parsed into
# that snapshot shape here - and parsed strictly: a mode that skipped lines it could not read would
# print a calm dashboard over a broken one, which is the exact failure this whole bundle is built to
# refuse.
#
# The document itself is the library's, unmodified: no section is invented, no row is synthesised,
# and the health/alerts sections stay empty because a scrape-side view runs no checks of its own.
# What the tool adds is printed BESIDE the document, never inside it - the census of families the
# service registers but this scrape did not contain, which is absence reported as absence.

EXPOSITION_SAMPLE_RE: Final[re.Pattern[str]] = re.compile(
    r"^(?P<name>[a-zA-Z_:][a-zA-Z0-9_:]*)"
    r"(?:\{(?P<labels>[^{}]*)\})?"
    r"\s+(?P<value>[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|NaN|[+-]Inf)"
    r"(?:\s+(?P<stamp>\d+))?\s*$"
)
LABEL_PAIR_RE: Final[re.Pattern[str]] = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"')
TYPE_LINE_RE: Final[re.Pattern[str]] = re.compile(r"^#\s*TYPE\s+(\S+)\s+(\S+)\s*$")
HISTOGRAM_SUFFIXES: Final[tuple[str, ...]] = ("_bucket", "_sum", "_count")
KNOWN_METRIC_TYPES: Final[frozenset[str]] = frozenset(
    {"counter", "gauge", "histogram", "untyped"}
)


def parse_exposition(text: str) -> dict[str, dict[str, object]]:
    """Exposition text as a registry snapshot: the shape ``DashboardBuilder`` reads.

    Families are keyed by base name, series by their label tuple, and a histogram's ``_bucket``,
    ``_sum`` and ``_count`` lines are folded back into the one series they describe. The ``le`` label
    is bucket geometry rather than a dimension of the series, so it is kept in ``buckets`` instead of
    in ``labels`` - which is what the library's own ``snapshot()`` does, and the reason a scrape and a
    live registry render the same rows.
    """
    types: dict[str, str] = {}
    order: list[str] = []
    series: dict[str, dict[tuple[tuple[str, str], ...], dict[str, object]]] = {}

    def family(name: str) -> dict[tuple[tuple[str, str], ...], dict[str, object]]:
        if name not in series:
            series[name] = {}
            order.append(name)
        return series[name]

    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            type_match = TYPE_LINE_RE.match(line)
            if type_match is not None:
                name, declared = type_match.group(1), type_match.group(2)
                if declared not in KNOWN_METRIC_TYPES:
                    raise BundleError(
                        f"exposition line {lineno}: {name!r} declares metric type {declared!r}; "
                        f"a scraper reads {sorted(KNOWN_METRIC_TYPES)}"
                    )
                types[name] = declared
            continue
        match = EXPOSITION_SAMPLE_RE.match(line)
        if match is None:
            raise BundleError(
                f"exposition line {lineno} is not a sample: {raw[:120]!r} - this mode refuses to "
                "guess, because a dashboard printed from half the input looks exactly like one "
                "printed from all of it"
            )
        name = _resolve_family(match.group("name"), types, lineno)
        labels = _parse_labels(match.group("labels") or "", lineno)
        value = _parse_value(match.group("value"))
        if types.get(name) == "histogram":
            _fold_histogram(family(name), match.group("name"), labels, value, lineno)
            continue
        if name != match.group("name"):
            raise BundleError(
                f"exposition line {lineno}: {match.group('name')!r} looks like histogram geometry "
                f"but {name!r} is registered as {types.get(name, 'unknown')!r}"
            )
        family(name)[labels] = {"labels": dict(labels), "value": value}

    snapshot: dict[str, dict[str, object]] = {}
    for name in sorted(order):
        rows = [series[name][key] for key in sorted(series[name])]
        if types.get(name) == "histogram":
            for row in rows:
                # A histogram whose `_sum` line never arrived still has to answer with a number: the
                # builder formats `sumMicros` directly, and a missing key there is a crash inside a
                # read-only view, which is the worst place to discover one.
                row.setdefault("count", 0)
                row.setdefault("sumMicros", 0.0)
                row.setdefault("buckets", {})
        snapshot[name] = {"type": types.get(name, "untyped"), "series": rows}
    return snapshot


def _resolve_family(name: str, types: dict[str, str], lineno: int) -> str:
    """The family a sample line belongs to, peeling histogram suffixes when needed."""
    if name in types:
        return name
    for suffix in HISTOGRAM_SUFFIXES:
        if name.endswith(suffix) and name[: -len(suffix)] in types:
            base = name[: -len(suffix)]
            if types[base] != "histogram":
                raise BundleError(
                    f"exposition line {lineno}: {name!r} carries a {suffix!r} suffix while {base!r} "
                    f"is declared {types[base]!r}"
                )
            return base
    return name


def _parse_labels(text: str, lineno: int) -> tuple[tuple[str, str], ...]:
    labels: dict[str, str] = {}
    remainder = text.strip()
    if not remainder:
        return ()
    position = 0
    while position < len(remainder):
        match = LABEL_PAIR_RE.match(remainder, position)
        if match is None:
            raise BundleError(
                f"exposition line {lineno}: label set {text!r} is not a list of name=\"value\" pairs"
            )
        labels[match.group(1)] = match.group(2).replace('\\"', '"').replace("\\\\", "\\")
        position = match.end()
        while position < len(remainder) and remainder[position] in ", ":
            position += 1
    return tuple(sorted(labels.items()))


def _parse_value(text: str) -> float:
    if text == "NaN":
        return float("nan")
    if text.endswith("Inf"):
        return float(text)
    return float(text)


def _fold_histogram(
    store: dict[tuple[tuple[str, str], ...], dict[str, object]],
    name: str,
    labels: tuple[tuple[str, str], ...],
    value: float,
    lineno: int,
) -> None:
    """Merge one histogram line into the series it describes.

    ``name`` here is the line's own sample name - ``_latency_bucket``, not the family it belongs to -
    because the suffix is the whole question this function asks.
    """
    if name.endswith("_bucket"):
        dims = tuple(pair for pair in labels if pair[0] != "le")
        bound = next((v for k, v in labels if k == "le"), None)
        if bound is None:
            raise BundleError(f"exposition line {lineno}: {name}_bucket without an `le` label")
        row = store.setdefault(dims, {"labels": dict(dims)})
        buckets = row.setdefault("buckets", {})
        assert isinstance(buckets, dict)
        buckets[bound] = value
        if bound == "+Inf":
            row["count"] = int(value)
        return
    dims = labels
    row = store.setdefault(dims, {"labels": dict(dims)})
    if name.endswith("_count"):
        row["count"] = int(value)
    elif name.endswith("_sum"):
        row["sumMicros"] = value


def plain_dashboard(document: dict[str, Any], absent: tuple[str, ...]) -> str:
    """The document as a terminal page: one line per row, in the library's own section order.

    Deliberately narrow. It formats what ``DashboardBuilder`` produced and adds one block of its own
    for the absent families, so a reader can tell the two apart; pretty-printing a dashboard from the
    monitoring side is not a second UI, and the moment it starts deriving values it is.
    """
    lines: list[str] = []
    lines.append(f"dashboard for {document['service']} (derived from scraped exposition)")
    # The builder emits the sections in its own fixed order, so the document's key order IS the
    # panel order; re-listing SECTIONS here would be a second copy of a table the library owns.
    for section, rows in document["sections"].items():
        lines.append("")
        lines.append(f"{section}  ({len(rows)} row{'s' if len(rows) != 1 else ''})")
        for row in rows:
            detail = f"  [{row['detail']}]" if row["detail"] else ""
            tone = "" if row["tone"] == "neutral" else f"  <{row['tone']}>"
            lines.append(f"  {row['label']:<44} {row['value']}{detail}{tone}")
    lines.append("")
    lines.append(
        "ABSENT  (registered by this service with a help string, absent from this scrape)"
    )
    lines.append(
        "Reported as absence, not as a zero: a family that is registered and has produced no series "
        "is a fact the scrape carries, and 0 would have been a different fact."
    )
    if absent:
        lines.extend(f"  {name}" for name in absent)
    else:
        lines.append("  none: every registered family produced at least one series")
    return "\n".join(lines) + "\n"


def dashboard_document(
    *, service: str, exposition: str, catalog_names: tuple[str, ...]
) -> tuple[dict[str, Any], tuple[str, ...]]:
    """The library's document, plus the families this scrape did not show.

    ``DashboardBuilder`` takes any object with ``snapshot()``; handing it the parsed scrape through a
    one-method shim is the duck-typing the class documents for itself, and the only way a scrape - a
    text file - can be rendered by a builder designed for a live registry.
    """
    from wlct_trading.observability.dashboard import DashboardBuilder

    snapshot = parse_exposition(exposition)
    builder = DashboardBuilder(service=service)
    document = builder.build(registry=_ScrapeRegistry(snapshot))
    absent = tuple(sorted(set(catalog_names) - set(snapshot)))
    return document, absent


class _ScrapeRegistry:
    """A registry-shaped view of a parsed scrape: one method, no state of its own."""

    def __init__(self, snapshot: dict[str, dict[str, object]]) -> None:
        self._snapshot = snapshot

    def snapshot(self) -> dict[str, dict[str, object]]:
        return self._snapshot

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gen_observability_bundle.py",
        description="Render and verify the deployment-side telemetry bundle (Part 22).",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--check", action="store_true", help="compare the committed bundle with a fresh render"
    )
    mode.add_argument("--emit", action="store_true", help="write the bundle")
    mode.add_argument("--catalog", action="store_true", help="print the metric catalog document")
    mode.add_argument(
        "--rules", action="store_true", help="print which catalog rules rendered and which refused"
    )
    mode.add_argument(
        "--dashboard", metavar="SERVICE", help="render the dashboard document from --from"
    )
    parser.add_argument("--from", dest="from_path", help="exposition text file, or - for stdin")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--force", action="store_true", help="with --emit, overwrite hand-edited files")
    args = parser.parse_args(argv)

    if args.check:
        code, lines = check_bundle(ROOT)
        print("\n".join(lines))
        print("scrape bundle " + ("matches a fresh render" if code == EXIT_OK else "DIFFERS"))
        return code

    if args.emit:
        code, lines = emit_bundle(ROOT, force=args.force)
        print("\n".join(lines))
        return code

    if args.catalog:
        payload = json.loads(compose_bundle(ROOT)[CATALOG_REL])
        print(json.dumps(payload, indent=2, sort_keys=True) if args.json else plain_catalog(payload))
        return EXIT_OK

    if args.rules:
        families = collect_families(ROOT, sources={})
        rendered, refused = derive_rules(families, collect_help_texts(ROOT))
        if args.json:
            print(
                json.dumps(
                    {
                        "rendered": [r.to_dict() for r in rendered],
                        "refused": [f.to_dict() for f in refused],
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
        else:
            for rule in rendered:
                print(f"rendered {rule.rule_id:26} {rule.expr}")
            for entry in refused:
                print(f"refused  {entry.rule_id:26} {entry.reason}")
        return EXIT_OK

    if args.dashboard is not None:
        if not args.from_path:
            print("--dashboard needs --from <file> (or - for stdin)", file=sys.stderr)
            return EXIT_REFUSED
        try:
            raw = read_exposition(args.from_path)
        except BundleError as exc:
            print(f"refused: {exc}", file=sys.stderr)
            return EXIT_MISSING
        try:
            names = tuple(sorted(registered_family_names(ROOT, args.dashboard)))
            document, absent = dashboard_document(
                service=args.dashboard, exposition=raw, catalog_names=names
            )
        except BundleError as exc:
            print(f"refused: {exc}", file=sys.stderr)
            return EXIT_MISSING
        if args.json:
            print(
                json.dumps(
                    {"document": document, "absentFamilies": list(absent)},
                    indent=2,
                    sort_keys=True,
                )
            )
        else:
            print(plain_dashboard(document, absent), end="")
        return EXIT_OK

    return EXIT_REFUSED


if __name__ == "__main__":
    # Exercised in tests through main(), and by a subprocess run against the real interpreter, which
    # is the only way to prove a CLI contract instead of describing one.
    raise SystemExit(main(sys.argv[1:]))
