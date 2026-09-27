"""Liveness and readiness for the execution runtime.

Readiness is not a formality here: it reports the actual wiring
properties - durable store? distributed locks? - because the worker and any
future supervisor must be able to tell "this engine accepts commands but
remembers nothing" apart from "this engine is the real execution plane".
That distinction is operational truth, and hiding it behind a 200 is the
kind of optimism that outlives its welcome.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from app import __version__
from app.composition import EngineRuntime
from app.config import Settings, get_settings

router = APIRouter(tags=["health"])


def get_runtime(request: Request) -> EngineRuntime:
    runtime = getattr(request.app.state, "runtime", None)
    if not isinstance(runtime, EngineRuntime):
        raise RuntimeError("runtime is not assembled - startup failed")
    return runtime


RuntimeDep = Annotated[EngineRuntime, Depends(get_runtime)]


@router.get("/health")
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, Any]:
    """Liveness: process is up and configuration parsed. No dependency
    probing - that is what /health/ready is for."""
    return {
        "status": "ok",
        "service": "execution-engine",
        "version": __version__,
        "instanceId": settings.EXECUTION_INSTANCE_ID,
    }


@router.get("/health/ready")
async def ready(runtime: RuntimeDep) -> dict[str, Any]:
    wiring = runtime.describe()
    return {
        "status": "ready",
        "simulated": wiring["mode"] == "simulated",
        **wiring,
    }
