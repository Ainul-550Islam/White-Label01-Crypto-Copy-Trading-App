# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Market data service (Python / FastAPI).
#
# Polls public exchange endpoints into a shared Redis cache and serves the
# cached values to internal callers. Holds no credentials of any kind.
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

COPY services/market-data/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

# Part 9: the service publishes observability through the shared pure-Python
# library (zero runtime dependencies, so this adds no transitive surface).
# Runtime `import wlct_trading...` resolves to this install.
COPY libs/trading-core ./libs/trading-core
RUN pip install ./libs/trading-core

# ---------------------------------------------------------------------------
FROM base AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 appuser \
    && useradd --system --uid 1001 --gid appuser --create-home appuser

COPY --from=build --chown=appuser:appuser /opt/venv /opt/venv
COPY --chown=appuser:appuser services/market-data/app ./app
COPY --chown=appuser:appuser services/market-data/pyproject.toml ./pyproject.toml
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
COPY --chown=appuser:appuser services/market-data/log-config.json ./log-config.json

USER appuser
EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent "http://127.0.0.1:${MARKET_DATA_PORT:-8002}/health" || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${MARKET_DATA_PORT:-8002} --proxy-headers --no-access-log --log-config ./log-config.json"]
