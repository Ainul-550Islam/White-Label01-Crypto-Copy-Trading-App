"""Deterministic dataset identity.

A dataset's identity answers one question: *if I re-derive it, will I get the
same thing?* A random UUID cannot answer that — two captures of the same window
would get different ids and the registry could not tell "reproducible" from
"coincidentally equal". So the id here is a content hash, and a UUID is only
ever the row handle inside the database, never the identity.

What feeds the hash
-------------------
Everything the identity must *distinguish*, and nothing else:

* exchange, market type — because the same symbol on different venues is
  different data;
* the canonical symbol set — sorted, so ingestion order cannot change identity;
* the event-kind set — sorted by wire value for the same reason;
* the exact window (first and last event timestamps, microseconds) — because
  "January" and "January to March" are different datasets;
* the canonical schema version — because a reinterpretation is a new dataset;
* the source kind and label — because the same window from the venue archive
  and from a private capture are different provenance even if the market was
  in an identical mood.

The content checksum is deliberately *recorded in the identity* but *excluded
from the key digest*. A key that changed with the bytes could never express
"the same dataset, re-ingested": every refresh would silently become a new
dataset and the version sequence would be a lie. The distinction the spec
demands - "different data content" must not conflate - is made by the pair
``(key, version)`` plus the per-version content checksum, and the replay
bridge verifies that pair before a backtest runs. Two datasets with the same
contract and different bytes share a name and never share a version.

What deliberately does *not* feed the hash: capture wall-clock time, file
timestamps, operator names, job ids. Those are facts about the retrieval, not
about the data, and folding them in would make reproducibility impossible to
demonstrate.

Credential exclusion is checked, not assumed: ``FORBIDDEN_PARAMETER_PATTERN``
from the strategy parameters module is reused here so that a source label or
metadata value shaped like a secret is refused before any hash is computed.
A dataset identity that once hashed a credential would leak it by structure
alone.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass
from enum import Enum

from wlct_trading.datasets.schema import DatasetFormatError
from wlct_trading.enums import ExchangeId, HistoricalSourceKind, MarketEventKind, MarketType
from wlct_trading.strategies.parameters import FORBIDDEN_PARAMETER_PATTERN

__all__ = [
    "DatasetIdentity",
    "build_dataset_key",
    "file_digests_checksum",
    "events_digest",
    "is_safe_dataset_key",
    "validate_credential_free",
]

_KEY_RE = re.compile(r"^hst-[0-9a-f]{32}$")
_HEX_RE = re.compile(r"^[0-9a-f]{64}$")


def validate_credential_free(label: str, value: str) -> None:
    """Refuse any value shaped like a credential.

    Shared by identity inputs and by manifest metadata. Historical datasets
    are public market data; nothing that arrives here has any business
    carrying a secret, and the cheapest guarantee is to refuse the shape at
    every write path rather than audit for it later.
    """
    if FORBIDDEN_PARAMETER_PATTERN.search(value):
        raise DatasetFormatError(
            f"{label} looks credential-shaped and is refused: historical dataset "
            "metadata must never contain secrets, in any field, at any length."
        )


def _enum_value(value: ExchangeId | MarketType | MarketEventKind | HistoricalSourceKind | str) -> str:
    # ``Enum.value`` is typed loosely in the standard library; wrapping in
    # ``str`` restates the contract this function promises instead of
    # forwarding whatever the enum attribute happens to be.
    if isinstance(value, Enum):
        return str(value.value)
    return str(value)


@dataclass(slots=True, frozen=True)
class DatasetIdentity:
    """The immutable attributes a dataset's id is derived from.

    Construct it, take :attr:`key`, and keep both in the manifest. Re-deriving
    the identity from any complete copy reproduces the same key — which is the
    entire point.
    """

    source_kind: HistoricalSourceKind
    source_label: str
    exchange: ExchangeId
    market_type: MarketType
    symbols: tuple[str, ...]
    event_kinds: tuple[MarketEventKind, ...]
    start_micros: int
    end_micros: int
    granularity: str
    content_checksum: str
    canonical_schema_version: int

    def __post_init__(self) -> None:
        if not self.source_label:
            raise DatasetFormatError("DatasetIdentity requires a non-empty source_label.")
        if not self.symbols:
            raise DatasetFormatError("DatasetIdentity requires at least one symbol.")
        if not self.event_kinds:
            raise DatasetFormatError("DatasetIdentity requires at least one event kind.")
        if self.end_micros < self.start_micros:
            raise DatasetFormatError("DatasetIdentity window end precedes start.")
        if not _HEX_RE.fullmatch(self.content_checksum):
            raise DatasetFormatError(
                "DatasetIdentity.content_checksum must be a 64-char lowercase hex digest."
            )
        if self.canonical_schema_version < 1:
            raise DatasetFormatError("canonical_schema_version must be positive.")
        if list(self.symbols) != sorted(self.symbols):
            raise DatasetFormatError("DatasetIdentity.symbols must be sorted.")
        normalized_labels = (self.source_label, self.granularity, *self.symbols)
        for value in normalized_labels:
            validate_credential_free("dataset identity input", value)

    def canonical_fields(self) -> tuple[tuple[str, str], ...]:
        """The exact input sequence the key hashes, as name/value pairs.

        Public because the manifest stores these fields alongside the digest:
        a verifier recomputes the key from the stored record alone, without
        the files, to confirm the record was not edited. ``content`` is part
        of the identity record (and of every stored manifest) but not of the
        key - see the module docstring for why that split is the only
        versioning story that does not contradict itself.
        """
        return (
            ("canonical_schema", str(self.canonical_schema_version)),
            ("end_micros", str(self.end_micros)),
            ("event_kinds", ",".join(sorted(_enum_value(kind) for kind in self.event_kinds))),
            ("exchange", _enum_value(self.exchange)),
            ("granularity", self.granularity),
            ("market_type", _enum_value(self.market_type)),
            ("source_kind", _enum_value(self.source_kind)),
            ("source_label", self.source_label),
            ("start_micros", str(self.start_micros)),
            ("symbols", ",".join(self.symbols)),
        )

    @property
    def key(self) -> str:
        """``hst-<32 hex>``. Deterministic by construction."""
        return build_dataset_key(self.canonical_fields())


def build_dataset_key(fields: tuple[tuple[str, str], ...]) -> str:
    """SHA-256 over ``name=value`` lines, truncated to the 128-bit key space.

    Truncation is a size decision, not a collision bet: at a million datasets
    a 128-bit prefix is a birthday distance of ~2^64, and the *full* digest
    remains recoverable from the stored identity fields, so the short key is
    for paths and indexes and the recomputation always verifies against the
    content checksum itself.
    """
    digest = hashlib.sha256()
    for name, value in sorted(fields):
        digest.update(name.encode("utf-8"))
        digest.update(b"=")
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    return f"hst-{digest.hexdigest()[:32]}"


def is_safe_dataset_key(key: object) -> bool:
    """Whether ``key`` can be used as a storage path component.

    The strict pattern does three jobs at once: it rejects traversal before
    path building, it rejects anything that cannot have been derived (so a
    hand-made directory never masquerades as a dataset), and it keeps the key
    inside filesystem limits without needing an escape mechanism.
    """
    return isinstance(key, str) and _KEY_RE.fullmatch(key) is not None


def file_digests_checksum(per_file: tuple[tuple[str, str], ...]) -> str:
    """SHA-256 over sorted ``(partition_path, sha256)`` pairs.

    This is the *storage integrity* digest: change any byte of any file and it
    moves, even when the semantic content is unchanged. It belongs in
    manifest verification (does the file on disk still match the file that was
    written), and is deliberately not the identity content checksum, which
    answers the *semantic* question through
    :func:`~wlct_trading.datasets.identity.events_digest`.
    """
    digest = hashlib.sha256()
    for path, sha in sorted(per_file):
        digest.update(path.encode("utf-8"))
        digest.update(b"=")
        digest.update(sha.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def events_digest(checksum_sources: Iterable[str]) -> str:
    """Streaming SHA-256 over canonical ``checksum_source`` lines.

    Kept separate from the file-level digests because it answers a different
    question - *what did the market do* - and is computed once, in the order
    the replay reader would merge the events, so the same value falls out of a
    re-run of the reader over the same files.

    Strings and bytes are refused outright: iterating a string yields
    characters and would happily produce a "content digest" of the wrong
    shape, which is exactly the kind of silent surprise this module exists to
    prevent.
    """
    if isinstance(checksum_sources, (str, bytes)):
        raise TypeError("events_digest expects an iterable of per-event strings.")
    digest = hashlib.sha256()
    count = 0
    for source in checksum_sources:
        digest.update(source.encode("utf-8"))
        digest.update(b"\n")
        count += 1
    if count == 0:
        raise DatasetFormatError(
            "An empty stream has no content checksum; refuse to call it one."
        )
    return digest.hexdigest()
