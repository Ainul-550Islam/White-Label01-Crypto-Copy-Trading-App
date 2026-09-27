"""Production Python SDK for the developer platform.

Every method maps to a REAL backend route (inventory pinned by
developer.contract.spec.ts CHECK 47); no endpoint is invented. The client
propagates correlation ids, pins the API version per request, retries only
safe GET transport failures, normalises errors and paginates by cursor.
`verify_webhook` validates platform signatures over the raw body with a
constant-time comparison and timestamp tolerance. Credentials are never
logged or persisted by this module.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_module
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, Tuple, cast

try:  # stdlib only; httpx-style transports stay injectable
    from urllib import error as urllib_error
    from urllib import parse as urllib_parse
    from urllib import request as urllib_request
except ImportError:  # pragma: no cover - Python 3 always has urllib
    urllib_error = urllib_parse = urllib_request = None  # type: ignore[assignment]

APPLICATION_STATES = ("PENDING", "ACTIVE", "SUSPENDED", "REACTIVATION_REVIEW", "REVOKED")

DEVELOPER_SCOPES: Tuple[str, ...] = (
    "profile:read",
    "account:read",
    "portfolio:read",
    "portfolio:write",
    "trading:read",
    "trading:execute",
    "copy:read",
    "copy:manage",
    "billing:read",
    "billing:manage",
    "funding:read",
    "funding:request",
    "statements:read",
    "reports:read",
    "webhooks:manage",
    "developer:manage",
)

DEVELOPER_EVENT_TYPES: Tuple[str, ...] = (
    "customer.created",
    "customer.updated",
    "subscription.created",
    "subscription.changed",
    "subscription.cancelled",
    "payment.succeeded",
    "payment.failed",
    "invoice.created",
    "invoice.paid",
    "funding.requested",
    "funding.confirmed",
    "withdrawal.requested",
    "withdrawal.confirmed",
    "copy.subscription.created",
    "copy.subscription.cancelled",
    "order.created",
    "order.acknowledged",
    "order.filled",
    "order.rejected",
    "portfolio.snapshot.created",
    "statement.generated",
    "compliance.review.required",
    "security.event",
)


class DeveloperApiError(Exception):
    """Normalised API failure with backend error code and correlation id."""

    def __init__(self, status: int, code: str, message: str, correlation_id: Optional[str]) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.correlation_id = correlation_id


@dataclass(frozen=True)
class BearerCredentials:
    token: str


@dataclass(frozen=True)
class DeveloperKeyCredentials:
    key_id: str
    secret: str


@dataclass(frozen=True)
class Page:
    rows: List[Dict[str, Any]]
    next_cursor: Optional[str]

    def __iter__(self) -> Iterator[Dict[str, Any]]:
        return iter(self.rows)


Transport = Callable[[str, str, Dict[str, str], Optional[bytes]], Tuple[int, Dict[str, str], bytes]]


def _default_transport(method: str, url: str, headers: Dict[str, str], body: Optional[bytes]) -> Tuple[int, Dict[str, str], bytes]:
    request = urllib_request.Request(url, data=body, method=method)  # noqa: S310 - caller-provided base URL
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urllib_request.urlopen(request, timeout=20) as response:  # noqa: S310
            return response.status, dict(response.headers.items()), response.read()
    except urllib_error.HTTPError as failure:  # non-2xx
        return failure.code, dict(failure.headers.items()), failure.read()


@dataclass
class DeveloperPlatformClient:
    """Typed client over the developer-platform controller routes."""

    base_url: str
    credentials: Optional[Any] = None
    api_version: str = "v2"
    transport: Transport = field(default_factory=lambda: _default_transport)
    max_safe_retries: int = 2

    def set_credentials(self, credentials: Any) -> None:
        self.credentials = credentials

    # ---------------------------------------------------------------- internals

    def _auth_header(self) -> str:
        if self.credentials is None:
            raise DeveloperApiError(0, "SDK_NO_AUTH", "credentials not configured", None)
        if isinstance(self.credentials, BearerCredentials):
            return f"Bearer {self.credentials.token}"
        if isinstance(self.credentials, DeveloperKeyCredentials):
            return f"Developer {self.credentials.key_id}.{self.credentials.secret}"
        raise DeveloperApiError(0, "SDK_NO_AUTH", "unsupported credential kind", None)

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Any, Dict[str, str]]:
        url = self.base_url.rstrip("/") + path
        if query:
            filtered = {key: str(value) for key, value in query.items() if value is not None}
            if filtered:
                url += "?" + urllib_parse.urlencode(filtered)
        headers = {
            "X-Api-Version": self.api_version,
            "x-correlation-id": f"sdk-{uuid.uuid4().hex[:12]}",
            "Authorization": self._auth_header(),
        }
        payload: Optional[bytes] = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(body).encode("utf-8")
        attempt = 0
        while True:
            status, response_headers, raw = self.transport(method, url, headers, payload)
            if status in (502, 503, 504) and method == "GET" and attempt < self.max_safe_retries:
                attempt += 1
                time.sleep(0.2 * (2 ** attempt))
                continue
            correlation_id = response_headers.get("x-correlation-id") or response_headers.get("X-Correlation-Id")
            if status >= 400:
                code, message = "HTTP_ERROR", f"request failed with HTTP {status}"
                try:
                    parsed = json.loads(raw.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    # Non-JSON error bodies stay generic; never guessed into success.
                    parsed = {}
                code = str(parsed.get("code", code))
                message = str(parsed.get("message", message))
                raise DeveloperApiError(status, code, message, correlation_id)
            if status == 204 or not raw:
                return None, response_headers
            return json.loads(raw.decode("utf-8")), response_headers

    def _call(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        data, _headers = self._request(method, path, body, query)
        return cast(Dict[str, Any], data)

    def _page(self, path: str, query: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        data, _headers = self._request("GET", path, None, query)
        return cast(Dict[str, Any], data)

    def paginate(self, path: str, query: Optional[Dict[str, Any]] = None) -> Iterator[Dict[str, Any]]:
        """Cursor-aware iteration over any list endpoint."""
        cursor: Optional[str] = None
        while True:
            page = self._page(path, {**(query or {}), "cursor": cursor} if cursor else query)
            for row in page.get("rows", []):
                yield row
            cursor = page.get("nextCursor")
            if not cursor:
                return

    # -------------------------------------------------------------- applications

    def create_application(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", "/developer-platform/applications", payload)

    def list_applications(self, query: Optional[Dict[str, Any]] = None) -> Page:
        data = self._page("/developer-platform/applications", query)
        return Page(data.get("rows", []), data.get("nextCursor"))

    def get_application(self, application_id: str) -> Dict[str, Any]:
        return self._call("GET", f"/developer-platform/applications/{application_id}")

    def update_application(self, application_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("PATCH", f"/developer-platform/applications/{application_id}", patch)

    def transition_application(
        self,
        application_id: str,
        target_state: str,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        if target_state not in APPLICATION_STATES:
            raise ValueError(f"unknown lifecycle state: {target_state}")
        return self._call(
            "POST",
            f"/developer-platform/applications/{application_id}/transitions",
            {"targetState": target_state, "reason": reason},
        )

    def add_redirect_uri(self, application_id: str, uri: str) -> Dict[str, Any]:
        return self._call(
            "POST",
            f"/developer-platform/applications/{application_id}/redirect-uris",
            {"redirect": {"uri": uri}},
        )

    def update_application_scopes(
        self,
        application_id: str,
        scopes: Iterable[str],
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        unknown = set(scopes) - set(DEVELOPER_SCOPES)
        if unknown:
            raise ValueError(f"unknown scopes: {sorted(unknown)}")
        return self._call(
            "PUT",
            f"/developer-platform/applications/{application_id}/scopes",
            {"scopes": list(scopes), "reason": reason},
        )

    # --------------------------------------------------------------- credentials

    def create_credential(self, application_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """The returned secret is shown exactly once by the platform."""
        return self._call(
            "POST",
            f"/developer-platform/applications/{application_id}/credentials",
            payload,
        )

    def list_credentials(self, query: Optional[Dict[str, Any]] = None) -> Page:
        data = self._page("/developer-platform/credentials", query)
        return Page(data.get("rows", []), data.get("nextCursor"))

    def rotate_credential(self, application_id: str, key_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
        return self._call(
            "POST",
            f"/developer-platform/applications/{application_id}/credentials/{key_id}/rotate",
            {"keyId": key_id, "reason": reason},
        )

    def revoke_credential(self, application_id: str, key_id: str, reason: Optional[str] = None) -> None:
        self._request(
            "DELETE",
            f"/developer-platform/applications/{application_id}/credentials/{key_id}",
            {"reason": reason},
        )

    # -------------------------------------------------------------------- oauth

    def exchange_oauth_token(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", "/developer-platform/oauth/token", payload)

    def revoke_oauth_token(self, token: str) -> None:
        self._request("POST", "/developer-platform/oauth/revoke", {"token": token})

    # ------------------------------------------------------------------ webhooks

    def create_webhook_subscription(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        unknown = set(payload.get("eventTypes", [])) - set(DEVELOPER_EVENT_TYPES)
        if unknown:
            raise ValueError(f"unknown event types: {sorted(unknown)}")
        return self._call("POST", "/developer-platform/webhooks", payload)

    def list_webhook_subscriptions(self, query: Optional[Dict[str, Any]] = None) -> Page:
        data = self._page("/developer-platform/webhooks", query)
        return Page(data.get("rows", []), data.get("nextCursor"))

    def update_webhook_subscription(self, subscription_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("PATCH", f"/developer-platform/webhooks/{subscription_id}", patch)

    def webhook_action(self, subscription_id: str, action: str, reason: Optional[str] = None) -> Dict[str, Any]:
        if action not in ("pause", "resume", "revoke"):
            raise ValueError(f"unknown webhook action: {action}")
        return self._call(
            "POST",
            f"/developer-platform/webhooks/{subscription_id}/actions",
            {"action": action, "reason": reason},
        )

    def rotate_webhook_secret(self, subscription_id: str) -> Dict[str, Any]:
        return self._call("POST", f"/developer-platform/webhooks/{subscription_id}/rotate-secret", {})

    def replay_webhook_event(self, subscription_id: str, event_id: str) -> Dict[str, Any]:
        return self._call(
            "POST",
            f"/developer-platform/webhooks/{subscription_id}/replay",
            {"eventId": event_id},
        )

    def list_webhook_deliveries(
        self,
        subscription_id: str,
        query: Optional[Dict[str, Any]] = None,
    ) -> Page:
        data = self._page(f"/developer-platform/webhooks/{subscription_id}/deliveries", query)
        return Page(data.get("rows", []), data.get("nextCursor"))

    # --------------------------------------------------------- usage & analytics

    def usage_rollup(self, query: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._call("GET", "/developer-platform/usage", None, query)

    def application_analytics(self, application_id: str, query: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._call(
            "GET",
            "/developer-platform/analytics",
            None,
            {**(query or {}), "applicationId": application_id},
        )

    # --------------------------------------------------------- versions & docs

    def api_versions(self) -> Dict[str, Any]:
        return self._call("GET", "/developer-platform/api-versions")

    def event_types(self) -> Dict[str, Any]:
        return self._call("GET", "/developer-platform/event-types")


def verify_webhook(
    raw_body: bytes,
    secret: str,
    headers: Dict[str, str],
    now_seconds: Optional[int] = None,
    tolerance_seconds: int = 300,
) -> Dict[str, str]:
    """Verify a platform webhook signature over the RAW request body.

    Headers are matched case-insensitively. Raises DeveloperApiError on a
    stale timestamp or a signature that does not verify (constant-time).
    """
    lowered = {key.lower(): value for key, value in headers.items()}
    try:
        timestamp = int(str(lowered.get("x-webhook-timestamp", "")))
    except ValueError as failure:
        raise DeveloperApiError(400, "WEBHOOK_TIMESTAMP_INVALID", "missing or malformed timestamp", None) from failure
    event_id = str(lowered.get("x-webhook-event-id", ""))
    version = str(lowered.get("x-webhook-version", ""))
    signature = str(lowered.get("x-webhook-signature", ""))
    now = now_seconds if now_seconds is not None else int(time.time())
    if abs(now - timestamp) > tolerance_seconds:
        raise DeveloperApiError(400, "WEBHOOK_TIMESTAMP_EXPIRED", "signature timestamp outside tolerance", None)
    canonical = f"t={timestamp}.id={event_id}.v={version}.".encode("utf-8") + raw_body
    expected = "v1=" + hmac_module.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
    if not hmac_module.compare_digest(expected, signature):
        raise DeveloperApiError(401, "WEBHOOK_SIGNATURE_INVALID", "signature does not verify", None)
    return {"eventId": event_id, "version": version, "valid": "true"}


__all__ = [
    "DeveloperPlatformClient",
    "DeveloperApiError",
    "BearerCredentials",
    "DeveloperKeyCredentials",
    "Page",
    "verify_webhook",
    "APPLICATION_STATES",
    "DEVELOPER_SCOPES",
    "DEVELOPER_EVENT_TYPES",
]
