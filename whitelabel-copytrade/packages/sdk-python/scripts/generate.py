# # NEW — Generates Pydantic models and event constants from the committed OpenAPI contract

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
SDK_ROOT = SCRIPT_DIRECTORY.parent
REPOSITORY_ROOT = SDK_ROOT.parents[1]
SPEC_PATH = REPOSITORY_ROOT / "docs" / "openapi" / "openapi.json"
GENERATED_DIRECTORY = SDK_ROOT / "wlct_sdk" / "generated"
MODELS_PATH = GENERATED_DIRECTORY / "models.py"
EVENT_TYPES_PATH = GENERATED_DIRECTORY / "event_types.py"
INIT_PATH = GENERATED_DIRECTORY / "__init__.py"


def load_event_types() -> list[str]:
    document = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    enum = (
        document.get("components", {})
        .get("schemas", {})
        .get("DeveloperWebhookEventEnvelope", {})
        .get("properties", {})
        .get("eventType", {})
        .get("enum")
    )
    if not isinstance(enum, list) or not enum or any(not isinstance(item, str) for item in enum):
        raise RuntimeError("OpenAPI DeveloperWebhookEventEnvelope.eventType.enum is missing or invalid")
    if len(set(enum)) != len(enum):
        raise RuntimeError("OpenAPI webhook event catalog contains duplicates")
    return sorted(enum)


def event_types_source(event_types: Sequence[str]) -> str:
    entries = "\n".join(f"    {event_type!r}," for event_type in event_types)
    return (
        "# # NEW — Generated from docs/openapi/openapi.json; do not edit directly.\n"
        "from typing import Tuple\n\n"
        "DEVELOPER_EVENT_TYPES: Tuple[str, ...] = (\n"
        f"{entries}\n"
        ")\n"
    )


def generated_init_source() -> str:
    return (
        "# # NEW — Exports the generated webhook event catalog for the Python SDK.\n"
        "from .event_types import DEVELOPER_EVENT_TYPES\n\n"
        "__all__ = [\"DEVELOPER_EVENT_TYPES\"]\n"
    )


def run_model_generator(output_path: Path) -> str:
    command = [
        sys.executable,
        "-m",
        "datamodel_code_generator",
        "--input",
        str(SPEC_PATH),
        "--input-file-type",
        "openapi",
        "--output",
        str(output_path),
        "--output-model-type",
        "pydantic_v2.BaseModel",
        "--target-python-version",
        "3.10",
        "--disable-timestamp",
    ]
    subprocess.run(command, check=True, cwd=REPOSITORY_ROOT)
    generated = output_path.read_text(encoding="utf-8")
    if not generated.endswith("\n"):
        generated += "\n"
    return "# # NEW — Generated Pydantic models from docs/openapi/openapi.json; do not edit directly.\n" + generated


def compare_or_write(path: Path, expected: str, check_only: bool) -> None:
    if check_only:
        try:
            current = path.read_text(encoding="utf-8")
        except FileNotFoundError as error:
            raise RuntimeError(f"{path.relative_to(SDK_ROOT)} is missing; run python scripts/generate.py") from error
        if current != expected:
            raise RuntimeError(f"{path.relative_to(SDK_ROOT)} is stale; run python scripts/generate.py")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(expected, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if generated SDK files differ from the OpenAPI spec")
    args = parser.parse_args()
    if not SPEC_PATH.is_file():
        raise RuntimeError(f"OpenAPI specification is missing: {SPEC_PATH}")

    event_types = load_event_types()
    with tempfile.TemporaryDirectory(prefix="wlct-sdk-python-") as temporary_directory:
        temporary_models_path = Path(temporary_directory) / "models.py"
        models_source = run_model_generator(temporary_models_path)

    compare_or_write(MODELS_PATH, models_source, args.check)
    compare_or_write(EVENT_TYPES_PATH, event_types_source(event_types), args.check)
    compare_or_write(INIT_PATH, generated_init_source(), args.check)
    print(f"{'Verified' if args.check else 'Generated'} Python SDK models and {len(event_types)} webhook event types.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
