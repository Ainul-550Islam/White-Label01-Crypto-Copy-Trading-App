"""Internal-only authentication.

Market data is not secret, but the service is still an internal component: an
open endpoint would let anyone use the platform's upstream rate-limit budget.
Reads therefore require the same shared token as the trading engine.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings

INTERNAL_TOKEN_HEADER = "x-internal-token"


async def require_internal_auth(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=INTERNAL_TOKEN_HEADER)] = None,
) -> None:
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, settings.INTERNAL_SERVICE_TOKEN
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid internal service credentials."},
        )
