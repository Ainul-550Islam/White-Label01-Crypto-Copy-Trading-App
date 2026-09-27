"""Every name a service reads from the environment is named in an example file.

Why this law exists rather than another config test: the root `.env.example` and the
per-service `.env.example` files are the only place a deployment operator learns what
can be set, and they are the source Part 22's scrape bundle cites as evidence for the
paths and headers it refuses to invent. Both files are hand-maintained. A part that
adds a `Settings` field and documents it only in the class docstring leaves the operator
with an undocumented knob and a reviewer with nothing to check - which is how twenty-two
engine settings looked "missing" to the audit that prompted this file, when in fact six
of them had been documented in `services/execution-engine/.env.example` all along and the
audit had read only the root file. That false positive is the reason the test below looks
at BOTH files and says so in its failure text, instead of demanding one canonical list.

Two directions are checked, because drift runs both ways:

* every env-facing field a service declares is named somewhere an operator reads;
* every name those files name is read by something in the tree - an example file that
  documents a knob nothing consumes is a promise the platform will not keep.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Final

REPO: Final[Path] = Path(__file__).resolve().parents[3]
ROOT_EXAMPLE: Final[Path] = REPO / ".env.example"
SERVICES: Final[Path] = REPO / "services"

#: Upper-case annotated attributes of a settings class are, for every service in this
#: repository, exactly the environment surface: pydantic-settings maps them 1:1 and
#: nothing else in those classes is named that way. A module-level constant of the same
#: shape is not a setting, which is why the walk is scoped to the class body - the audit
#: that preceded this file tripped over `PRISMA_ONLY_DSN_PARAMS`, a frozenset of DSN query
#: parameters in trading-engine's config module that reads like a flag and is not one.
SETTING_NAME: Final[re.Pattern[str]] = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
ENV_ASSIGNMENT: Final[re.Pattern[str]] = re.compile(r"^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=")

#: Suffixes whose files are configuration or build input rather than source that reads an
#: environment variable. Kept narrow on purpose: a name documented in `.env.example` counts
#: as consumed when it appears in one of these, including `docker-compose.yml`, because
#: compose passing `${NAME:-default}` through is exactly how a container gets it.
SOURCE_SUFFIXES: Final[frozenset[str]] = frozenset(
    {".py", ".ts", ".tsx", ".mjs", ".js", ".dart", ".yml", ".yaml", ".sql", ".prisma", ".json"}
)
SKIP_DIR_PARTS: Final[frozenset[str]] = frozenset(
    {"node_modules", "dist", "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache", "build", ".next"}
)


def settings_classes(path: Path) -> list[ast.ClassDef]:
    """Classes in a config module that hold the environment surface."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: list[ast.ClassDef] = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        bases = {b.id if isinstance(b, ast.Name) else getattr(b, "attr", "") for b in node.bases}
        if bases & {"BaseSettings", "Settings"} or node.name.endswith("Settings"):
            found.append(node)
    return found


def declared_names(path: Path) -> set[str]:
    names: set[str] = set()
    for klass in settings_classes(path):
        for stmt in klass.body:
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                if SETTING_NAME.match(stmt.target.id):
                    names.add(stmt.target.id)
    return names


def documented_names(paths: list[Path]) -> dict[str, list[str]]:
    """name -> the example files that name it, for the reverse check."""
    out: dict[str, list[str]] = {}
    for path in paths:
        if not path.exists():
            continue
        for match in ENV_ASSIGNMENT.finditer(path.read_text(encoding="utf-8")):
            out.setdefault(match.group(1), []).append(path.relative_to(REPO).as_posix())
    return out


def tree_text_by_name() -> dict[str, set[str]]:
    """Every source token that looks like an env name, mapped to the files reading it."""
    readers: dict[str, set[str]] = {}
    for path in REPO.rglob("*"):
        if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
            continue
        if any(part in SKIP_DIR_PARTS for part in path.parts):
            continue
        if path in (ROOT_EXAMPLE,) or path.name == ".env.example":
            continue
        rel = path.relative_to(REPO).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        for name in set(re.findall(r"\b[A-Z][A-Z0-9_]{2,}\b", text)):
            readers.setdefault(name, set()).add(rel)
    return readers


def service_example_files(config_module: Path) -> list[Path]:
    service_dir = config_module.parent.parent
    return [ROOT_EXAMPLE, service_dir / ".env.example"]


def python_services() -> list[Path]:
    return sorted(SERVICES.glob("*/app/config.py"))


def test_every_python_service_declares_settings_in_the_first_place() -> None:
    # A vacuous pass is the worst outcome available to a parity test, so the set it
    # operates on is asserted non-empty before any comparison runs.
    modules = python_services()
    assert len(modules) >= 3, f"expected the python services to be present, saw {[m.as_posix() for m in modules]}"
    found = sum(len(declared_names(module)) for module in modules)
    assert found > 80, f"the settings scan found only {found} fields, which is too few to trust"


def test_every_declared_setting_is_named_in_an_example_file() -> None:
    offenders: list[str] = []
    for module in python_services():
        declared = declared_names(module)
        examples = service_example_files(module)
        corpus = "\n".join(p.read_text(encoding="utf-8") for p in examples if p.exists())
        missing = sorted(name for name in declared if name not in corpus)
        if missing:
            where = ", ".join(p.relative_to(REPO).as_posix() for p in examples if p.exists())
            offenders.append(f"{module.relative_to(REPO).as_posix()}: {missing} (searched {where})")
    assert not offenders, "settings read from the environment but named in no .env.example:\n" + "\n".join(offenders)


def test_every_name_an_example_file_names_is_read_somewhere() -> None:
    example_paths = [ROOT_EXAMPLE, *sorted(SERVICES.glob("*/.env.example"))]
    documented = documented_names(example_paths)
    readers = tree_text_by_name()
    ghosts = sorted(name for name, files in documented.items() if name not in readers)
    assert not ghosts, (
        "names documented as settable that no file in the tree reads (the first three of "
        f"{len(documented)} documented names): " + ", ".join(f"{g} [{', '.join(documented[g][:2])}]" for g in ghosts[:3])
    )


def test_no_name_is_assigned_twice_in_the_same_example_file() -> None:
    """One active assignment per name per file, because two answers is no answer.

    `dotenv` honours the first value of a repeated key and `docker compose`'s `env_file`
    honours the last, so a name written twice in one file is a setting whose value depends
    on which loader read it. Three were, when this check was written - `LOG_FORMAT` at
    `pretty` and `json`, `MARKET_DATA_SYMBOLS` twice with the same value (so the two
    sections could drift silently), and `MAX_RISK_STATE_AGE_MS` at 5000 and 2000, which is
    a risk budget with two documented answers. Prose mentions are excluded by the pattern:
    this counts assignments at column zero, not sentences that quote a name.
    """
    for path in [ROOT_EXAMPLE, *sorted(SERVICES.glob("*/.env.example"))]:
        if not path.exists():
            continue
        assigned = re.findall(r"^([A-Z][A-Z0-9_]{2,})=", path.read_text(encoding="utf-8"), re.M)
        duplicated = sorted({name for name in assigned if assigned.count(name) > 1})
        assert not duplicated, f"{path.relative_to(REPO).as_posix()} assigns {duplicated} more than once"


def test_every_name_compose_requires_by_force_is_documented() -> None:
    """An expansion with no default is a boot failure whose only explanation is this file.

    `${NAME:?message}` in a compose file refuses the deployment outright, and the operator's
    first move is to open the example file for the name. If it is not there, the message is
    the whole of the documentation.
    """
    example = ROOT_EXAMPLE.read_text(encoding="utf-8")
    required: set[str] = set()
    for compose in sorted(REPO.glob("docker-compose*.yml")):
        required.update(re.findall(r"\$\{([A-Z][A-Z0-9_]+):\?", compose.read_text(encoding="utf-8")))
    undocumented = sorted(name for name in required if name not in example)
    assert not undocumented, f"compose requires {undocumented} with no default and .env.example never names them"


def test_the_engine_settings_the_root_example_defers_actually_live_in_the_service_file() -> None:
    # The root file says "Details: services/execution-engine/.env.example" for engine knobs.
    # That deferral is only true if the service file really carries them, so the sentence is
    # pinned against the file rather than trusted.
    root = ROOT_EXAMPLE.read_text(encoding="utf-8")
    assert "services/execution-engine/.env.example" in root, "the root example no longer points at the engine's own"
    local = SERVICES / "execution-engine" / ".env.example"
    assert local.exists(), "the engine's own example file that the root file points at is gone"
    deferred = SERVICES / "execution-engine" / "app" / "config.py"
    local_text = local.read_text(encoding="utf-8")
    # Every engine setting must be named by exactly one of the two files, and the local file
    # must carry a meaningful share of them - a pointer to a file that documents nothing is
    # how the deferral becomes fiction.
    declared = declared_names(deferred)
    in_local = {n for n in declared if n in local_text}
    assert len(in_local) >= 15, f"only {len(in_local)} of {len(declared)} engine settings are named in the local file"
