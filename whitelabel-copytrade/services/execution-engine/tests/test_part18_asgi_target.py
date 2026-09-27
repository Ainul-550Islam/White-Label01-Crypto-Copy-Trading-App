"""Part 18: the ASGI target an image names has to resolve, and nothing checked it.

Every Python service in this repository is started by a line of shell in its
Dockerfile - ``uvicorn [flags] app.main:something`` - and until this file existed,
no test, script or check in the tree had ever confirmed that the name on that line
exists in the module beside it. That is how ``execution-engine`` shipped for eleven
parts with an image that cannot boot: ``create_app()`` is the only factory the
module defines, there is no module-level ``app``, and the container's first action
was ``AttributeError``-adjacent failure output ("Attribute \"app\" not found in
module \"app.main\"") followed by a restart loop. The healthcheck in the same file
was the only thing that would have noticed, and a healthcheck is read by a runtime
nobody runs here.

Two laws are pinned, and they are deliberately asymmetric in method:

1. **Shape, checked statically, for all three services.** The Dockerfile's uvicorn
   target is parsed and the named module is parsed (AST, not import). A plain
   ``module:attr`` target requires a module-level binding of that name; a
   ``--factory`` target requires a zero-argument function of that name. Nothing is
   imported, because the two sibling modules build their app at import time and
   would refuse to parse settings in a test environment configured for a different
   service - an import here would be a test that fails for the wrong reason.
2. **Reality, checked by doing, for this service.** ``create_app`` is called and
   the object it returns is asserted to be the ASGI application the platform
   expects. A name that exists but is not callable is the same broken image with
   better spelling, and the static half cannot tell the two apart.

The fix this test guards is the factory form in the Dockerfile and in
``python -m app.main``; the reason the service is not "fixed" by adding
``app = create_app()`` at module scope (which the siblings do, and which would have
made the eleven-year-old line correct) is recorded on the command in
``infrastructure/docker/execution-engine.Dockerfile`` and in §6.1 of
``docs/PART18_METRICS_EXPOSITION.md``: settings parse inside ``create_app``, so an
import-time construction turns a startup refusal into an import refusal, and that
would break this suite's own collection as fast as it would break a linter.
"""

from __future__ import annotations

import ast
import inspect
import json
import logging
import logging.config
import re
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[3]

#: service directory name -> its Dockerfile, under infrastructure/docker.
SERVICES = ("trading-engine", "market-data", "execution-engine")

#: A command line names its target after the binary; ``uvicorn.run`` names the
#: same thing as its first argument. Two shapes, one dotted-target rule.
_COMMAND_TARGET = re.compile(r"uvicorn\s+(?P<factory>--factory\s+)?(?P<dotted>[\w.]+:\w+)")
_DOTTED = re.compile(r"^(?P<module>[\w.]+):(?P<attr>\w+)$")
#: The command line is a JSON array, so the path ends at the first quote;
#: [^"\s] rather than \S+ is what keeps a trailing "], from being a filename.
_LOG_FLAG = re.compile(r"--log-config\s+(?P<path>[^\"\s]+)")


@dataclass(frozen=True)
class UvicornTarget:
    """What an image command line actually asks for."""

    module: str
    attribute: str
    factory: bool

    @property
    def dotted(self) -> str:
        return f"{self.module}:{self.attribute}"


def dockerfile(service: str) -> Path:
    return ROOT / "infrastructure" / "docker" / f"{service}.Dockerfile"


def image_log_config(service: str) -> str:
    """The path the image hands uvicorn for ``--log-config``, verbatim."""
    line = next(
        line
        for line in dockerfile(service).read_text(encoding="utf-8").splitlines()
        if line.startswith("CMD [")
    )
    match = _LOG_FLAG.search(line)
    assert match is not None, f"{service}: the image command sets no --log-config"
    return match.group("path")


def log_config_source(service: str, image_path: str) -> Path:
    """The build-context file that becomes that path inside the image.

    The COPY lines put a file next to ``pyproject.toml`` in the WORKDIR, so the
    image's ``./log-config.json`` is the service's ``log-config.json`` - a mapping
    this test reads off the Dockerfile rather than assumes.
    """
    if image_path.startswith("./"):
        return ROOT / "services" / service / image_path.removeprefix("./")
    return ROOT / image_path.lstrip("/")


def module_file(service: str, module: str) -> Path:
    return ROOT / "services" / service / f"{module.replace('.', '/')}.py"


def split_target(dotted: str) -> tuple[str, str]:
    match = _DOTTED.match(dotted)
    assert match is not None, f"{dotted!r} is not a module:attribute target"
    return match.group("module"), match.group("attr")


def parse_target(command: str) -> UvicornTarget:
    match = _COMMAND_TARGET.search(command)
    assert match is not None, f"no uvicorn target in this command: {command!r}"
    module, attribute = split_target(match.group("dotted"))
    return UvicornTarget(
        module=module,
        attribute=attribute,
        factory=match.group("factory") is not None,
    )


def image_command(service: str) -> UvicornTarget:
    """The single command the container runs, read out of the image recipe."""
    text = dockerfile(service).read_text(encoding="utf-8")
    lines = [line for line in text.splitlines() if line.startswith("CMD [")]
    assert len(lines) == 1, f"{service}: expected exactly one CMD, found {len(lines)}"
    # Only the payload string matters; "sh"/"-c" and the flag order around the
    # target are the recipe's business, not this test's.
    return parse_target(lines[0])


class ModuleShape:
    """The two facts about a module that decide which uvicorn form is correct."""

    def __init__(self, path: Path) -> None:
        self.tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

    def has_module_binding(self, name: str) -> bool:
        for node in self.tree.body:
            if isinstance(node, ast.Assign | ast.AnnAssign):
                targets: list[ast.expr] = (
                    list(node.targets) if isinstance(node, ast.Assign) else [node.target]
                )
                if any(isinstance(t, ast.Name) and t.id == name for t in targets):
                    return True
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                if node.name == name:
                    return False  # a def is not a binding the plain form can use
        return False

    def zero_arg_function(self, name: str) -> bool:
        for node in self.tree.body:
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name == name:
                args = node.args
                return not (args.args or args.posonlyargs or args.kwonlyargs or args.vararg)
        return False


@pytest.mark.parametrize("service", SERVICES)
def test_the_image_command_names_a_target_its_module_can_satisfy(service: str) -> None:
    target = image_command(service)
    shape = ModuleShape(module_file(service, target.module))
    if target.factory:
        assert shape.zero_arg_function(target.attribute), (
            f"{service}: the image passes --factory {target.dotted}, but that name is "
            "not a zero-argument function in the module - uvicorn would fail to build the app"
        )
    else:
        assert shape.has_module_binding(target.attribute), (
            f"{service}: the image names {target.dotted} with no --factory, but the module "
            "defines no such object - this is the exact shape of the boot failure Part 18 "
            "found in execution-engine, where create_app is a factory and nothing is bound "
            "to app at module scope"
        )


@pytest.mark.parametrize("service", SERVICES)
def test_the_image_command_survives_uvicorn_s_own_startup(service: str) -> None:
    """Every flag the image passes has to be loadable, by uvicorn, before the app.

    ``uvicorn.Config`` configures logging inside its constructor, so this single
    call is the whole boot-time surface the container depends on - the target, the
    factory flag, and the log config - with no server, no port and no settings
    parse. It is the check that would have failed for eleven parts.
    """
    import uvicorn

    target = image_command(service)
    image_path = image_log_config(service)
    source = log_config_source(service, image_path)
    assert source.is_file(), f"{service}: {image_path} names no file in the build context"
    uvicorn.Config(
        app=target.dotted,
        factory=target.factory,
        log_config=str(source),
    )  # raises if the shape is wrong, which is the assertion


@pytest.mark.parametrize("service", SERVICES)
def test_the_factory_flag_is_not_carried_by_a_module_that_does_not_need_it(service: str) -> None:
    # The mirror of the test above, because a wrong flag is as fatal as a wrong
    # name: --factory against a module-level app instance hands uvicorn an
    # application object and tells it to call it, and calling a FastAPI app raises
    # deep inside the server rather than at the front door.
    target = image_command(service)
    shape = ModuleShape(module_file(service, target.module))
    if shape.has_module_binding(target.attribute):
        assert not target.factory, f"{service}: {target.dotted} is an object, not a factory"


def test_the_two_ways_to_start_this_service_name_the_same_target() -> None:
    # ``python -m app.main`` and the image must not be able to disagree: one is
    # what an operator types, the other is what ships, and a divergence means the
    # reproduction and the deployment are different programs.
    from_image = image_command("execution-engine")
    tree = ast.parse(
        module_file("execution-engine", from_image.module).read_text(encoding="utf-8"),
        filename="main.py",
    )
    from_module = _uvicorn_run_target(tree)
    assert from_module == from_image, (
        f"python -m app.main starts {from_module.dotted if from_module else None} while the "
        "image starts "
        f"{from_image.dotted}"
    )


def _target_of_string(dotted: str) -> UvicornTarget:
    module, attribute = split_target(dotted)
    return UvicornTarget(module=module, attribute=attribute, factory=False)


def _uvicorn_run_target(tree: ast.Module) -> UvicornTarget | None:
    """The ``uvicorn.run`` call inside the module's ``__main__`` block, if any."""
    for node in tree.body:
        if not (isinstance(node, ast.If) and _is_main_guard(node.test)):
            continue
        for call in ast.walk(node):
            if not (isinstance(call, ast.Call) and _is_uvicorn_run(call.func)):
                continue
            target = _target_of_string(call.args[0].value) if call.args else None
            factory = any(
                kw.arg == "factory" and isinstance(kw.value, ast.Constant) and kw.value.value
                for kw in call.keywords
            )
            return UvicornTarget(target.module, target.attribute, factory)
    return None


def _is_main_guard(test: ast.expr) -> bool:
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and any(isinstance(op, ast.Eq) for op in test.ops)
    )


def _is_uvicorn_run(func: ast.expr) -> bool:
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "run"
        and isinstance(func.value, ast.Name)
        and func.value.id == "uvicorn"
    )


def test_the_zero_length_stand_in_that_used_to_be_the_flag_is_rejected() -> None:
    """The reason the file exists, pinned as a behaviour rather than a story.

    ``--log-config /dev/null`` was every Python service's image command until Part
    18: neat, portable, and not loadable. uvicorn routes a path with no .json/.yaml
    suffix to ``logging.config.fileConfig``, which refuses a zero-length file -
    so the container died before importing the app, and the healthcheck in the same
    Dockerfile was the only thing in the repository watching. This test does not
    assert that the old flag is gone (the test above proves the new one loads); it
    asserts the mechanism, so a revert cannot be justified by "it worked for us".
    """
    import uvicorn

    with pytest.raises(RuntimeError, match="empty file"):
        uvicorn.Config(app="app.main:create_app", factory=True, log_config="/dev/null")


def test_the_log_config_changes_nothing_about_the_loggers_it_meets() -> None:
    """"A no-op" is a claim about behaviour, so it is tested as behaviour: an
    existing handler on the root logger has to still be there afterwards, because
    the whole point of the file is that uvicorn must not reconfigure the app's
    JSON pipeline out from under it.
    """
    root = logging.getLogger()
    sentinel = logging.NullHandler()
    root.addHandler(sentinel)
    try:
        for service in SERVICES:
            source = log_config_source(service, image_log_config(service))
            config = json.loads(source.read_text(encoding="utf-8"))
            assert config == {"version": 1, "disable_existing_loggers": False}
            logging.config.dictConfig(config)
            assert sentinel in root.handlers, f"{service}'s log config moved the app's handlers"
    finally:
        root.removeHandler(sentinel)


def test_the_factory_this_image_calls_produces_a_working_application() -> None:
    # The reality half of the docstring: called on a real environment, the named
    # factory returns a FastAPI app that serves the health route. Static checks
    # prove a name exists; only this proves the name is the thing a server needs.
    from fastapi.testclient import TestClient

    from app.main import create_app

    assert callable(create_app)
    assert inspect.signature(create_app).parameters == {}
    built = create_app()
    assert isinstance(built, FastAPI)
    with TestClient(built) as started:
        assert started.get("/health").status_code == 200


def test_no_module_level_app_so_the_import_stays_free() -> None:
    # Why there is no module-level ``app``: an operator running this service with a
    # missing variable must get the settings error at startup, and a test collector,
    # a linter or a docs build must get nothing at all. If someone "fixes" the image
    # by binding ``app = create_app()`` at import, this test is where they learn
    # what that costs - and the Dockerfile comment is where they learn it twice.
    source = module_file("execution-engine", "app.main").read_text(encoding="utf-8")
    shape = ModuleShape(module_file("execution-engine", "app.main"))
    assert not shape.has_module_binding("app"), (
        "app.main now builds its application at import time; that makes settings parsing "
        "an import side effect - see the two comments this test exists to enforce"
    )
    assert "create_app" in source
