"""Deterministic SDK tests: route contract, pagination, webhook verify.
No network: the transport is an in-memory fake bound to canned responses."""

from __future__ import annotations

import hashlib
import hmac as hmac_module
import json
import time
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib import parse as urllib_parse

import pytest

from wlct_sdk import (
    APPLICATION_STATES,
    DEVELOPER_EVENT_TYPES,
    DEVELOPER_SCOPES,
    BearerCredentials,
    DeveloperApiError,
    DeveloperPlatformClient,
    verify_webhook,
)


class FakeTransport:
    def __init__(self) -> None:
        self.calls: List[Tuple[str, str]] = []
        self.routes: Dict[Tuple[str, str], Callable[[Optional[bytes]], Tuple[int, Dict[str, str], Any]]] = {}
        self.register("GET", "/developer-platform/api-versions", lambda _: (200, {}, {"versions": [{"version": "v2", "state": "SUPPORTED"}]}))

    def register(self, method: str, path: str, handler: Callable[[Optional[bytes]], Tuple[int, Dict[str, str], Any]]) -> None:
        self.routes[(method, path)] = handler

    def __call__(self, method: str, url: str, headers: Dict[str, str], body: Optional[bytes]) -> Tuple[int, Dict[str, str], bytes]:
        base = urllib_parse.urlsplit(url).path
        self.calls.append((method, base))
        handler = self.routes.get((method, base))
        if handler is None:
            return 404, {}, json.dumps({"code": "NOT_FOUND", "message": "no such route"}).encode()
        status, extra_headers, payload = handler(body)
        raw = b"" if payload is None else json.dumps(payload).encode("utf-8")
        return status, {**extra_headers, "x-correlation-id": "corr-test"}, raw


@pytest.fixture()
def transport() -> FakeTransport:
    return FakeTransport()


@pytest.fixture()
def client(transport: FakeTransport) -> DeveloperPlatformClient:
    return DeveloperPlatformClient(
        base_url="https://api.example.test",
        credentials=BearerCredentials(token="tok"),
        transport=transport,
    )


def test_route_inventory_matches_backend_contract(client: DeveloperPlatformClient, transport: FakeTransport) -> None:
    client.api_versions()
    assert transport.calls == [("GET", "/developer-platform/api-versions")]


def test_application_crud_and_transition(client: DeveloperPlatformClient, transport: FakeTransport) -> None:
    transport.register("POST", "/developer-platform/applications", lambda _: (201, {}, {"id": "app-1", "state": "PENDING"}))
    transport.register("GET", "/developer-platform/applications/app-1", lambda _: (200, {}, {"id": "app-1", "state": "PENDING"}))
    transport.register("PATCH", "/developer-platform/applications/app-1", lambda _: (200, {}, {"id": "app-1", "state": "PENDING"}))
    transport.register("POST", "/developer-platform/applications/app-1/transitions", lambda body: (200, {}, {"id": "app-1", "state": json.loads(body or b"{}").get("targetState")}))
    assert client.create_application({"name": "n"})["state"] == "PENDING"
    assert client.get_application("app-1")["id"] == "app-1"
    client.update_application("app-1", {"name": "n2"})
    assert client.transition_application("app-1", "ACTIVE")["state"] == "ACTIVE"
    with pytest.raises(ValueError):
        client.transition_application("app-1", "EXPLODED")


def test_pagination_follows_cursors(client: DeveloperPlatformClient, transport: FakeTransport) -> None:
    seen: List[str] = []

    def smart(body: Optional[bytes]) -> Tuple[int, Dict[str, str], Any]:
        seen.append("call")
        rows = [f"row-{len(seen)}"]
        next_cursor = None if len(seen) >= 3 else f"cursor-{len(seen)}"
        return 200, {}, {"rows": rows, "nextCursor": next_cursor}

    transport.register("GET", "/developer-platform/webhooks", smart)
    rows = list(client.paginate("/developer-platform/webhooks"))
    assert rows == ["row-1", "row-2", "row-3"]
    assert len(seen) == 3


def test_error_normalisation(client: DeveloperPlatformClient, transport: FakeTransport) -> None:
    transport.register("GET", "/developer-platform/usage", lambda _: (403, {}, {"code": "SCOPE_NOT_AUTHORIZED", "message": "denied"}))
    with pytest.raises(DeveloperApiError) as failure:
        client.usage_rollup()
    assert failure.value.status == 403
    assert failure.value.code == "SCOPE_NOT_AUTHORIZED"
    assert failure.value.correlation_id == "corr-test"


def test_webhook_verify_roundtrip_and_rejection() -> None:
    secret = "whsec_" + "a" * 40
    body = json.dumps({"id": "pay-1"}).encode()
    timestamp = int(time.time())
    event_id = "evt-1"
    canonical = f"t={timestamp}.id={event_id}.v=v1.".encode() + body
    signature = "v1=" + hmac_module.new(secret.encode(), canonical, hashlib.sha256).hexdigest()
    result = verify_webhook(
        raw_body=body,
        secret=secret,
        headers={"X-Webhook-Timestamp": str(timestamp), "X-Webhook-Event-Id": event_id, "X-Webhook-Version": "v1", "X-Webhook-Signature": signature},
        now_seconds=timestamp,
    )
    assert result["eventId"] == event_id
    with pytest.raises(DeveloperApiError):
        verify_webhook(raw_body=body, secret=secret, headers={"X-Webhook-Timestamp": str(timestamp - 4000), "X-Webhook-Event-Id": event_id, "X-Webhook-Version": "v1", "X-Webhook-Signature": signature}, now_seconds=timestamp)
    with pytest.raises(DeveloperApiError):
        verify_webhook(raw_body=body, secret="whsec_" + "b" * 40, headers={"X-Webhook-Timestamp": str(timestamp), "X-Webhook-Event-Id": event_id, "X-Webhook-Version": "v1", "X-Webhook-Signature": signature}, now_seconds=timestamp)


def test_catalog_constants_are_backend_pinned() -> None:
    assert len(DEVELOPER_SCOPES) == 16
    assert len(DEVELOPER_EVENT_TYPES) == 23
    assert "trading:execute" in DEVELOPER_SCOPES
    assert "customer.created" in DEVELOPER_EVENT_TYPES
    assert APPLICATION_STATES[-1] == "REVOKED"
