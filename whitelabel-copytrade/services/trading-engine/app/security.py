"""Authentication for service-to-service calls.

The trading engine is never exposed to the public internet. It only accepts
requests carrying the shared internal token, compared in constant time, and it
requires an explicit tenant header so every action is attributable and scoped.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings

INTERNAL_TOKEN_HEADER = "x-internal-token"
TENANT_HEADER = "x-tenant-id"
REQUEST_ID_HEADER = "x-request-id"


class ServiceCaller:
    """The authenticated context of an internal request."""

    def __init__(self, tenant_id: str, request_id: str | None) -> None:
        self.tenant_id = tenant_id
        self.request_id = request_id


async def require_internal_auth(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=INTERNAL_TOKEN_HEADER)] = None,
    x_tenant_id: Annotated[str | None, Header(alias=TENANT_HEADER)] = None,
    x_request_id: Annotated[str | None, Header(alias=REQUEST_ID_HEADER)] = None,
) -> ServiceCaller:
    """Validates the internal token and the tenant scope of the caller."""
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, settings.INTERNAL_SERVICE_TOKEN
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid internal service credentials."},
        )

    if not x_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "TENANT_NOT_FOUND",
                "message": f"The {TENANT_HEADER} header is required.",
            },
        )

    return ServiceCaller(tenant_id=x_tenant_id, request_id=x_request_id)
