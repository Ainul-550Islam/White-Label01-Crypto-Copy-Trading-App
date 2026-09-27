"""Signed service-to-service transport for the execution plane.

Why this package exists
-----------------------
Part 20 wired the execution engine's live posture to a fact about the wiring:
``SIGNED_TRANSPORT_WIRED``. The prerequisite list had named a signed transport
since Part 16, and the composition root constructs the registry, the client,
the verifier and the replay guard in ``app/composition.py`` - but the package
that those four names were imported from was never present in the repository,
so the entire engine test suite failed at collection on an ``ImportError``
before a single assertion could run. This package is that import target.

What it provides, and what it deliberately does not
---------------------------------------------------
* :class:`~wlct_trading.execution.transport.key_registry.KeyRegistry` - the
  versioned HMAC secrets shared between the services that talk to each other.
  One active key at a time; older versions stay verifiable for rotation.
* :class:`~wlct_trading.execution.transport.client.SignedTransportClient` -
  signs a canonical request line with the registry's active key and returns
  the headers a verifier expects.
* :class:`~wlct_trading.execution.transport.server.SignedTransportVerifier` -
  verifies those headers fail-closed: bad key, stale timestamp, repeated nonce
  and bad encoding are all refusals, and none of them reaches the handler.
* :class:`~wlct_trading.execution.transport.replay_guard.ReplayGuard` with its
  :class:`~wlct_trading.execution.transport.replay_guard.InMemoryReplayStore`
  - the nonce memory that makes a stolen signature useless after first use.
* Metrics classes for both sides, following the service's own instrument law:
  an instrument that is cheap, monotone and read-only, constructed by the
  composition root and never consulted for a decision.

In simulated mode (the only mode this build can run) the objects are wired and
measured but authenticate no venue traffic - they authenticate *service to
service* requests, which is exactly what Part 20 says: present in simulated
mode, used for venue communication only in live mode.
"""

from wlct_trading.execution.transport.client import SignedTransportClient
from wlct_trading.execution.transport.client_metrics import (
    SignedTransportClientMetrics,
)
from wlct_trading.execution.transport.key_registry import (
    KeyRegistry,
    generate_secret,
)
from wlct_trading.execution.transport.replay_guard import (
    InMemoryReplayStore,
    ReplayGuard,
)
from wlct_trading.execution.transport.server import SignedTransportVerifier
from wlct_trading.execution.transport.server_metrics import (
    SignedTransportServerMetrics,
)

__all__ = [
    "InMemoryReplayStore",
    "KeyRegistry",
    "ReplayGuard",
    "SignedTransportClient",
    "SignedTransportClientMetrics",
    "SignedTransportServerMetrics",
    "SignedTransportVerifier",
    "generate_secret",
]
