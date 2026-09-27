"""The versioned HMAC key registry shared by the signed-transport peers.

One registry per process, built by the composition root. Keys are versioned
because rotation must not be a rewrite: a verifier has to keep accepting the
previous version while a deployment rolls, and a client has to publish WHICH
version it signed with so the verifier never has to guess (guessing keys is
how verification becomes an oracle).

``active_key_id`` is the fact the live-enablement report checks. It is None
until a key is registered, which is what makes "wired but keyless" a state
the report can name instead of a crash at first request.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass

__all__ = [
    "KeyRegistry",
    "KeyRegistryError",
    "RegisteredKey",
    "generate_secret",
]

#: Byte length used by :func:`generate_secret` when a caller asks for a size
#: that is not a positive integer. 32 bytes is the composition root's choice
#: (``generate_secret(32)``) and is also the sane default.
DEFAULT_SECRET_BYTES = 32


class KeyRegistryError(ValueError):
    """Raised when the registry is asked to do something it cannot answer."""


def generate_secret(num_bytes: int = DEFAULT_SECRET_BYTES) -> str:
    """Return a fresh URL-safe random secret.

    ``secrets``, not ``random``: this value authenticates service-to-service
    requests, so its entropy is a security boundary, not a shuffle.
    """
    if num_bytes <= 0:
        raise KeyRegistryError("secret length must be a positive number of bytes")
    return secrets.token_urlsafe(num_bytes)


@dataclass(frozen=True)
class RegisteredKey:
    """One immutable registry entry.

    ``secret`` is the raw key material and is never rendered: ``describe()``
    exists so wiring surfaces can show WHICH key is in use without ever
    showing the key, following the same redaction discipline as the exchange
    credential value objects.
    """

    key_id: str
    version: int
    algorithm: str
    secret: str
    description: str = ""

    def describe(self) -> dict[str, object]:
        """The log-safe rendering: everything about the key except the key."""
        return {
            "keyId": self.key_id,
            "version": self.version,
            "algorithm": self.algorithm,
            "description": self.description,
        }


class KeyRegistry:
    """Versioned HMAC keys with exactly one active version at a time.

    Registration order and version order are independent on purpose. A
    deployment that registers version 2 twice, or version 3 after version 5,
    still gets a well-defined active key: the highest registered version. The
    lower versions remain reachable by id so a verifier can honour signatures
    made before the rotation landed.
    """

    def __init__(self, algorithm: str = "HMAC-SHA256") -> None:
        algorithm = (algorithm or "").strip().upper()
        if algorithm != "HMAC-SHA256":
            # Fail closed on an unknown algorithm at construction, not at the
            # first signature: a misconfigured registry should never get far
            # enough to sign anything.
            raise KeyRegistryError(
                f"unsupported key registry algorithm: {algorithm!r} "
                "(only HMAC-SHA256 is implemented)"
            )
        self._algorithm = algorithm
        self._keys: dict[str, RegisteredKey] = {}
        self._versions: dict[int, str] = {}

    @property
    def algorithm(self) -> str:
        return self._algorithm

    @property
    def active_key_id(self) -> str | None:
        """The id of the highest registered version, or None before any key."""
        if not self._versions:
            return None
        highest = max(self._versions)
        return self._versions[highest]

    def register(
        self,
        secret: str,
        version: int,
        description: str = "",
    ) -> RegisteredKey:
        """Register (or replace) one key version and return its entry.

        Re-registering a version replaces its material: the composition root
        constructs exactly one registry per process, and a test that rebuilds
        a version should not need a second registry to do it.
        """
        if not isinstance(secret, str) or len(secret) < 16:
            # Short keys make HMAC brute-forceable offline. 16 characters of
            # url-safe base64 is ~95 bits; the generator emits far more.
            raise KeyRegistryError(
                "key material must be a string of at least 16 characters"
            )
        if not isinstance(version, int) or isinstance(version, bool) or version <= 0:
            raise KeyRegistryError("key version must be a positive integer")
        key_id = f"{self._algorithm.lower().replace('-', '_')}-v{version}"
        entry = RegisteredKey(
            key_id=key_id,
            version=version,
            algorithm=self._algorithm,
            secret=secret,
            description=description,
        )
        self._keys[key_id] = entry
        self._versions[version] = key_id
        return entry

    def key_for(self, key_id: str) -> RegisteredKey | None:
        """The entry for an id, or None: verification treats unknown ids as
        refusals, not lookups that raise."""
        return self._keys.get(key_id)

    def active_key(self) -> RegisteredKey | None:
        key_id = self.active_key_id
        return None if key_id is None else self._keys[key_id]

    def signing_key(self) -> tuple[str, RegisteredKey]:
        """The (key_id, entry) pair a client should sign with, or raise.

        Signing without an active key would produce a signature no verifier
        of this registry accepts, and silently emitting that is worse than
        refusing here.
        """
        entry = self.active_key()
        if entry is None:
            raise KeyRegistryError(
                "no key registered: a client cannot sign without an active key"
            )
        return entry.key_id, entry

    def describe(self) -> dict[str, object]:
        """The wiring-safe view: algorithm, active id, count - never material."""
        return {
            "algorithm": self._algorithm,
            "activeKeyId": self.active_key_id,
            "keyCount": len(self._keys),
            "versions": sorted(self._versions),
        }
