# # Verifies generated Python models and event types against the committed OpenAPI and event catalogue.
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pydantic import RootModel

SDK_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SDK_ROOT.parents[1]
sys.path.insert(0, str(SDK_ROOT))

from wlct_sdk import event_types, models  # noqa: E402


def test_every_openapi_component_schema_has_a_generated_python_model() -> None:
    document = json.loads((REPOSITORY_ROOT / "docs/openapi/openapi.json").read_text(encoding="utf-8"))
    component_names = set(document["components"]["schemas"])
    generated_names = {
        name for name, value in vars(models).items() if isinstance(value, type)
    }
    expected_class_names = {
        re.sub(r"_([a-z0-9])", lambda match: match.group(1).upper(), name): name
        for name in component_names
    }
    missing = sorted(
        schema_name
        for class_name, schema_name in expected_class_names.items()
        if class_name not in generated_names
    )
    assert not missing, f"missing generated Pydantic models: {missing}"


def test_every_catalogued_event_has_a_generated_event_type() -> None:
    document = json.loads((REPOSITORY_ROOT / "docs/openapi/openapi.json").read_text(encoding="utf-8"))
    from_openapi = set(document["components"]["schemas"]["DeveloperWebhookEventEnvelope"]["properties"]["eventType"]["enum"])
    from_docs = set()
    for line in (REPOSITORY_ROOT / "docs/WEBHOOK_EVENTS.md").read_text(encoding="utf-8").splitlines():
        if line.startswith("| `"):
            from_docs.add(line.split("`", 2)[1])
    assert set(event_types.DEVELOPER_EVENT_TYPES) == from_openapi == from_docs


def test_fixture_round_trips_through_pydantic_and_json() -> None:
    fixture_path = REPOSITORY_ROOT / "docs/fixtures/coordination_fixtures.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    round_trip = RootModel[dict[str, object]].model_validate(fixture).model_dump()
    assert json.loads(json.dumps(round_trip, sort_keys=True)) == fixture
