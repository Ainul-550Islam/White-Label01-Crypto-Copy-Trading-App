"""Authentication for service-to-service calls.

The execution engine is never exposed to the public internet. It accepts
only requests carrying the shared internal token (constant-time compared),
and it requires an explicit tenant header on every command so no action is
ever tenantless: the worker's job payload names a tenant, the header is
where the HTTP surface enforces it, and a mismatch between the two is
rejected rather than resolved by trust. The cross-check lives in the router
because it needs the parsed body; this module guarantees the caller IS an
internal service speaking for A tenant.

One route reads instead of acting, and says so by depending on
:func:`require_internal_auth_readonly` (Part 20). The distinction is the whole
argument, so it is stated here rather than only at the route: the tenant law
exists so that no money operation can run without an owner, and a read of this
process's own wiring has no owner to name because it has no effect to attribute.
The exemption also cannot disclose anything - every key ``GET /internal/v1/status``
returns is published on ``GET /health/ready``, which asks for nothing at all, and
that superset relation is a test in the service suite rather than a claim here.
The token is still required, because the point is not to hide that a posture
exists but to keep a stranger from learning which deployment has which one -
the same reason ``/status`` is a document and an environment file is not.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings

__all__ = [
    "CALLER_AUTH_HEADER",
    "TENANT_HEADER",
    "TENANT_REQUIRED_CODE",
    "REQUEST_ID_HEADER",
    "ServiceCaller",
    "require_internal_auth",
    "require_internal_auth_readonly",
    "require_tenant_match",
]

#: The header NAME - not a secret, it never holds one. Named away from
#: the word "token" deliberately: flake8-S105 rightly hunts string
#: literals assigned to token-shaped constants, and a header label is
#: not a credential; the config validator guards the value.
CALLER_AUTH_HEADER = "x-internal-token"
TENANT_HEADER = "x-tenant-id"

#: The refusal code for a command with no tenant. A name rather than a literal
#: because the worker matches on this string and the read scope below must not be
#: able to raise it by accident: `_tenant_or_none` is the only place it appears.
TENANT_REQUIRED_CODE = "TENANT_HEADER_REQUIRED"
REQUEST_ID_HEADER = "x-request-id"


class ServiceCaller:
    """The authenticated context of an internal request."""

    def __init__(self, tenant_id: str, request_id: str | None) -> None:
        self.tenant_id = tenant_id
        self.request_id = request_id


def _authenticate(settings: Settings, x_internal_token: str | None) -> None:
    """The token half, shared by both scopes.

    Extracted rather than copied because a constant-time comparison has exactly one
    correct spelling, and a second copy in this file would be a second place for
    somebody to get wrong - the failure mode being a function that looks timing-safe
    and quietly stopped being one.
    """
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, settings.EXECUTION_INTERNAL_TOKEN or ""
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid internal service credentials."},
        )


def _tenant_or_none(x_tenant_id: str | None, *, required: bool) -> str:
    """The tenant half, with the presence question asked by the caller.

    ``required=False`` does not mean "the header is ignored": a tenant that IS sent is
    validated exactly as strictly, so a caller cannot answer a read with
    ``x-tenant-id: ../../etc`` and have the anomaly pass because the route is exempt.
    Absence is tolerated; a bad value never is.
    """
    if not x_tenant_id:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": TENANT_REQUIRED_CODE,
                    "message": (
                        f"Every execution command must name its tenant via the "
                        f"{TENANT_HEADER} header; tenantless money operations are refused."
                    ),
                },
            )
        return ""
    if len(x_tenant_id) > 64 or not _tenant_ok(x_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "TENANT_HEADER_INVALID",
                "message": "The tenant header is not a plausible identifier.",
            },
        )
    return x_tenant_id


def _request_id(x_request_id: str | None) -> str | None:
    return x_request_id if x_request_id and len(x_request_id) <= 128 else None


async def require_internal_auth(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=CALLER_AUTH_HEADER)] = None,
    x_tenant_id: Annotated[str | None, Header(alias=TENANT_HEADER)] = None,
    x_request_id: Annotated[str | None, Header(alias=REQUEST_ID_HEADER)] = None,
) -> ServiceCaller:
    """Validates the internal token and the tenant scope of the caller.

    The command scope: every route that can act on a tenant's money uses this. The
    refusal text is a pinned contract - the worker's client and the API suite match on
    ``TENANT_HEADER_REQUIRED`` and on the word "tenantless" - which is why the code is
    a named constant and the sentence is kept verbatim below.
    """
    _authenticate(settings, x_internal_token)
    return ServiceCaller(
        tenant_id=_tenant_or_none(x_tenant_id, required=True),
        request_id=_request_id(x_request_id),
    )


async def require_internal_auth_readonly(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=CALLER_AUTH_HEADER)] = None,
    x_tenant_id: Annotated[str | None, Header(alias=TENANT_HEADER)] = None,
    x_request_id: Annotated[str | None, Header(alias=REQUEST_ID_HEADER)] = None,
) -> ServiceCaller:
    """The read scope: token required, tenant optional, a sent header still validated.

    Used by exactly one route - ``GET /internal/v1/status`` - and a test in the Part 20
    service suite walks the application's own route table to assert it stays the only
    one, because the way a scoping exemption rots is by becoming the convenient
    dependency to reach for on the next route somebody adds.

    ``tenant_id`` is the empty string when no header was sent. Not a sentinel naming a
    tenant: the status route never reads the field - it takes a caller only to make the
    dependency run - and an empty value is the shape of "nobody", which is what a
    process-level read actually has. A pseudo-tenant such as ``"system"`` would put a
    fake identifier into the one object whose purpose is to name a real one, and
    somebody would eventually compare it to one.
    """
    _authenticate(settings, x_internal_token)
    return ServiceCaller(
        tenant_id=_tenant_or_none(x_tenant_id, required=False),
        request_id=_request_id(x_request_id),
    )


def _tenant_ok(candidate: str) -> bool:
    # Wire-token grammar, same shape the platform uses for ids everywhere:
    # alphanumerics with '-' and '_'. This is header sanity, not lookup:
    # existence of the tenant is the store's business on the effects side.
    return all(
        ch.isascii() and (ch.isalnum() or ch in "-_") for ch in candidate
    )


def require_tenant_match(tenant_body: str, caller: ServiceCaller) -> None:
    """Reject a body naming a different tenant than the authenticated header.

    The API stamps both from the same job payload, so divergence here means
    either a misroute or a caller trying to cross tenants through a
    correctly authenticated connection. Both are 403, loudly.
    """
    if tenant_body != caller.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "TENANT_MISMATCH",
                "message": (
                    "The request body names a different tenant than the "
                    "authenticated header; the command was refused."
                ),
            },
        )
