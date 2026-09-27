# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Execution engine (Python / FastAPI) - Part 11.
#
# The trading worker's execution core as a service: it holds the venue side
# (adapters, locks, incidents, reconciliation) while the Node worker holds
# the queue side. Internal service: never published to the internet, every
# command route requires the shared internal token AND a tenant header.
# This build serves the SIMULATED venue; EXECUTION_MODE=live refuses startup
# by code, so the image carries no path to money that configuration alone
# could open. Mirror of trading-engine.Dockerfile: venv built in the build
# stage, runtime carries no compiler.
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv "$VIRTUAL_ENV"

COPY services/execution-engine/requirements.txt ./requirements.txt
RUN pip install --require-hashes=false -r requirements.txt

# The whole point of this image: the execution plane lives in the shared
# library, and the service wires it. Runtime `import wlct_trading...`
# resolves to this install - the SAME code the engine's own test suite pins.
COPY libs/trading-core ./libs/trading-core
RUN pip install ./libs/trading-core

# ---------------------------------------------------------------------------
FROM base AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1003 appuser \
    && useradd --system --uid 1003 --gid appuser --create-home appuser

COPY --from=build --chown=appuser:appuser /opt/venv /opt/venv
COPY --chown=appuser:appuser services/execution-engine/app ./app
COPY --chown=appuser:appuser services/execution-engine/pyproject.toml ./pyproject.toml
# The log-config file is two no-op keys, and both halves of that sentence matter:
# uvicorn installs its own plain-text handlers unless --log-config points at
# something loadable, and this service's JSON log pipeline is configured by the app
# itself, a moment later, in create_app. A zero-length stand-in cannot work -
# logging.config.fileConfig, which is what uvicorn uses for any path that is not
# .json or .yaml, raises "RuntimeError: /dev/null is an empty file", true since at
# least python 3.11.9 - and the .json suffix is what routes uvicorn to dictConfig,
# which accepts this shape and changes nothing. Both the flag and the file are
# pinned by services/execution-engine/tests/test_part18_asgi_target.py, which loads
# every Python service's real image command through uvicorn's own Config.
COPY --chown=appuser:appuser services/execution-engine/log-config.json ./log-config.json

USER appuser
EXPOSE 8093

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent "http://127.0.0.1:${SERVICE_PORT:-8093}/health" || exit 1

# --no-access-log: uvicorn's access line shape can carry query strings, and
# this service's URLs are fixed - the JSON app log owns every request record
# (with the shared redactor on it).
#
# --factory, and it is load-bearing rather than stylistic: this service's app
# object does not exist at import time. ``create_app`` is where settings are
# parsed, and parsing has to happen when the process starts - not when a module
# is merely imported - because that is what turns a refused configuration into a
# startup error instead of an import-time one that also breaks ``pytest``
# collection, a linter, and anything else that reads ``app.main`` for a constant.
# The sibling services (trading-engine, market-data) expose a module-level ``app``
# and correctly use the plain ``app.main:app`` form; naming that target here was a
# defect that survived eleven parts, because until Part 18 wrote a manual recipe
# into docs/PART18_METRICS_EXPOSITION.md nothing in this repository ever
# attempted to resolve it - a test does now, in
# services/execution-engine/tests/test_part18_asgi_target.py.
CMD ["sh", "-c", "uvicorn --factory app.main:create_app --host ${EXECUTION_ENGINE_HOST:-127.0.0.1} --port ${SERVICE_PORT:-8093} --proxy-headers --no-access-log --log-config ./log-config.json"]
