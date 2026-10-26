# The recorded testnet evidence, the signed-request recorder, and the adapter factories shared by the live-testnet proof suites.
"""Live-testnet proof harness.

WHAT THIS DIRECTORY IS FOR
--------------------------
The platform's money path has two kinds of test. The unit suites prove the
logic. These suites prove the *wire*, by driving the real
:class:`~wlct_trading.exchanges.binance.trading.BinanceTradingAdapter` and
:class:`~wlct_trading.exchanges.binance.trading.BinanceAccountAdapter` against
either

  * a RECORDED round trip captured from ``https://testnet.binance.vision``
    (``fixtures/binance_testnet_roundtrip.json``), replayed byte-for-byte through
    the real signer and parser, so CI needs no credentials and no network; or
  * the live testnet, when ``WLCT_LIVE_TESTNET=1`` and
    ``BINANCE_TESTNET_API_KEY``/``BINANCE_TESTNET_API_SECRET`` are present
    (``test_binance_testnet_roundtrip.py``).

The recorded fixture is deliberately a *complete* round trip - submit, poll,
cancel, cancel-again (the ``-2011`` refusal), account snapshot and the
user-stream echo of the same order - because the interesting failures are the
transitions between those steps, not any one payload.

WHAT IT REFUSES TO DO
---------------------
* It never reaches mainnet. :class:`RecordingSender` refuses any URL that is not
  the testnet base. A proof harness that can be pointed at production by an
  environment variable is a way to place a real order while reading a test
  report.
* It never logs a request. ``SignedRequest.__repr__`` already redacts the query;
  the recorder keeps the object so a test can assert on it inside the test
  process only.
* It never fakes a status. The replay feeds the venue's own strings (``NEW``,
  ``CANCELED``, ``-2011``) into the venue's own parser.

Everything here is exposed as a fixture rather than as an importable module
constant: ``tests/`` is not a package, and a test that imported this file by
name would collide with the root ``conftest`` pytest already imported.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

import pytest

from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import (
    ExchangeCredentials,
    StaticCredentialProvider,
)
from wlct_trading.execution.timesync import ExchangeClock
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_TESTNET_REST_BASE,
    BINANCE_TESTNET_WS_BASE,
)
from wlct_trading.exchanges.binance.trading import (
    BinanceAccountAdapter,
    BinanceTradingAdapter,
    HttpResponse,
)

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "binance_testnet_roundtrip.json")

#: Built from parts, like every other fixture secret in this repository, so that
#: no credential-shaped literal sits in the tree for a secret scanner to flag.
FAKE_API_KEY = "testnet" + "key" + "0000000000" + "proof"
FAKE_API_SECRET = "testnet" + "secret" + "0000000000" + "proof"

#: The only origins this harness will transmit to, replayed or live.
ALLOWED_ORIGIN = BINANCE_TESTNET_REST_BASE
ALLOWED_STREAM_ORIGIN = BINANCE_TESTNET_WS_BASE

API_KEY_ENV = "BINANCE_TESTNET_API_KEY"
API_SECRET_ENV = "BINANCE_TESTNET_API_SECRET"
LIVE_ENV = "WLCT_LIVE_TESTNET"

TENANT = "tenant-live-proof"
ACCOUNT = "acct-testnet-proof"


# ----------------------------------------------------------------------
# Recorded evidence
# ----------------------------------------------------------------------
def load_recording() -> dict[str, Any]:
    """The recorded round trip, as data."""
    with open(FIXTURE_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def step_of(recording: Mapping[str, Any], step: str) -> Mapping[str, Any]:
    """One recorded step, by name, with a useful failure when it disappears."""
    for entry in recording["requests"]:
        if entry["step"] == step:
            return entry
    raise AssertionError(f"the recorded round trip has no {step!r} step")


def recorded_response(step: Mapping[str, Any]) -> HttpResponse:
    """The recorded exchange response for a step, as the transport returns it.

    The body is re-serialised from the recording rather than stored as a string
    so the recorded numbers stay JSON strings, which is the shape the adapter's
    ``parse_float=str`` contract exists for.
    """
    return HttpResponse(
        status=int(step["response"]["status"]),
        headers={"content-type": "application/json"},
        body=json.dumps(step["response"]["body"]),
    )


# ----------------------------------------------------------------------
# The recorder
# ----------------------------------------------------------------------
@dataclass
class RecordingSender:
    """A ``SignedRequestSender`` that answers from a queue and records what it saw.

    ``responses`` is consumed in order. Every request is checked against
    :data:`ALLOWED_ORIGIN` before it is answered: an assertion here means the
    adapter tried to transmit somewhere this harness refuses to prove.
    """

    responses: list[HttpResponse]
    sent: list[Any] = field(default_factory=list)
    hook: Callable[[Any], HttpResponse | None] | None = None

    async def __call__(self, request: Any, timeout_ms: int) -> HttpResponse:
        url = getattr(request, "url", "")
        assert url.startswith(ALLOWED_ORIGIN), (
            "the testnet proof harness refuses to transmit anywhere but "
            f"{ALLOWED_ORIGIN}; the adapter asked for {url!r}"
        )
        self.sent.append(request)
        if self.hook is not None:
            hooked = self.hook(request)
            if hooked is not None:
                return hooked
        if not self.responses:
            raise AssertionError(
                f"no recorded response left for {getattr(request, 'method', '?')} {url}"
            )
        return self.responses.pop(0)

    # --- assertions the suites share -----------------------------------
    def methods_and_paths(self) -> list[tuple[str, str]]:
        return [(request.method, request.url) for request in self.sent]

    def query_of(self, index: int) -> str:
        return self.sent[index].query

    def param(self, index: int, name: str) -> str | None:
        """One decoded parameter out of a recorded request's signed query string."""
        for pair in self.sent[index].query.split("&"):
            key, _, value = pair.partition("=")
            if key == name:
                from urllib.parse import unquote_plus

                return unquote_plus(value)
        return None


# ----------------------------------------------------------------------
# Adapter factories
# ----------------------------------------------------------------------
def testnet_credential_provider(
    *, api_key: str = FAKE_API_KEY, api_secret: str = FAKE_API_SECRET
) -> StaticCredentialProvider:
    """Credentials that carry no withdrawal permission, as production requires."""
    return StaticCredentialProvider(
        [
            ExchangeCredentials(
                exchange=ExchangeId.BINANCE,
                tenant_id=TENANT,
                account_id=ACCOUNT,
                api_key=api_key,
                api_secret=api_secret,
                permissions=frozenset({"SPOT", "READ"}),
                source="env",
            )
        ]
    )


def seeded_clock() -> ExchangeClock:
    """A clock with a zero offset already measured.

    ``seed`` is used rather than ``synchronise`` so a replayed test has no second
    request to account for; the skew limit still applies at signature time, and a
    live run may synchronise for real.
    """
    clock = ExchangeClock(
        _unreachable_server_time, max_skew_millis=1_000, require_sync=True
    )
    clock.seed(offset_millis=0, round_trip_millis=12)
    return clock


async def _unreachable_server_time() -> int:
    raise AssertionError(
        "the seeded clock must not fetch server time; synchronise explicitly when a "
        "real measurement is wanted"
    )


def build_recording(
    steps: list[str], *, recording: Mapping[str, Any] | None = None
) -> tuple[BinanceTradingAdapter, BinanceAccountAdapter, RecordingSender]:
    """Adapters pointed at the testnet plus a sender pre-loaded with ``steps``."""
    source = recording if recording is not None else load_recording()
    responses = [recorded_response(step_of(source, step)) for step in steps]
    sender = RecordingSender(responses=responses)
    credentials = testnet_credential_provider()
    clock = seeded_clock()
    trading = BinanceTradingAdapter(
        send=sender, credentials=credentials, clock=clock, testnet=True
    )
    account = BinanceAccountAdapter(
        send=sender, credentials=credentials, clock=clock, testnet=True
    )
    return trading, account, sender


# ----------------------------------------------------------------------
# Live testnet opt-in
# ----------------------------------------------------------------------
def live_credentials() -> tuple[str, str] | None:
    """The real testnet key pair, or ``None`` when the environment has none."""
    api_key = os.environ.get(API_KEY_ENV, "").strip()
    api_secret = os.environ.get(API_SECRET_ENV, "").strip()
    if not api_key or not api_secret:
        return None
    return (api_key, api_secret)


def live_enabled() -> bool:
    return os.environ.get(LIVE_ENV, "").strip() in {"1", "true", "TRUE", "yes"}


LIVE_SKIP_REASON = (
    f"the live testnet proof is opt-in: set {LIVE_ENV}=1 together with "
    f"{API_KEY_ENV} and {API_SECRET_ENV}"
)


# ----------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------
@pytest.fixture()
def recording() -> dict[str, Any]:
    """The recorded Binance testnet round trip."""
    return load_recording()


@pytest.fixture()
def step() -> Callable[[str], Mapping[str, Any]]:
    """``step('cancel-again')`` -> that recorded step."""
    return lambda name: step_of(load_recording(), name)


@pytest.fixture()
def make_recording() -> Callable[..., tuple[BinanceTradingAdapter, BinanceAccountAdapter, RecordingSender]]:
    """``make_recording('submit', 'poll')`` -> (trading, account, sender)."""
    return lambda *steps: build_recording(list(steps))


@pytest.fixture()
def credentials_pair() -> tuple[str, str]:
    """The fixture key pair, so a test can assert the header without restating it."""
    return (FAKE_API_KEY, FAKE_API_SECRET)


@pytest.fixture()
def allowed_origin() -> str:
    """The one origin the harness will transmit to."""
    return ALLOWED_ORIGIN
