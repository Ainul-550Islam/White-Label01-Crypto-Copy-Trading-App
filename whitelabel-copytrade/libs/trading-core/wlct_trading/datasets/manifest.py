"""The dataset manifest: one file that makes a dataset reproducible.

A dataset without a manifest is a directory. The manifest is what turns it
into a *dataset*: the identity it was derived from, the window it covers, the
files it contains with their storage-integrity digests, the validation verdict
and its digest, and the schema versions on both sides of the canonical
format. It is written once, at finalisation, and never edited afterwards —
every mutation an operator might want (quarantine, archive, re-validation)
touches status files beside it, never the manifest itself.

Byte-determinism
----------------
:func:`~wlct_trading.datasets.schema.canonical_json` with sorted keys and no
floats, so the manifest's own digest (its SHA-256) can be recomputed from the
bytes or from the parsed record. Two engines that disagree about nothing else
agree here, and a registry can compare stored digests against a re-hash of the
file to prove it was not edited in place.

Validation status lives beside the payload, not inside it
---------------------------------------------------------
The manifest written at finalisation carries the *finalisation-time* verdict.
Re-validation must not rewrite the manifest — rewriting it would change its
digest and destroy the very integrity record the file exists to keep. So the
current status and the latest report live in ``status.json`` and
``report.json``; the manifest field documents history, and the two are
reconciled by :meth:`DatasetManifest.validate_against` at open time. If they
disagree, the dataset is not usable until an operator says why.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from wlct_trading.datasets.identity import DatasetIdentity, validate_credential_free
from wlct_trading.datasets.schema import (
    CANONICAL_SCHEMA_VERSION,
    MANIFEST_SCHEMA_VERSION,
    DatasetFormatError,
    canonical_json,
)
from wlct_trading.enums import (
    DatasetCompleteness,
    DatasetStatus,
    DatasetValidationSeverity,
    ExchangeId,
    HistoricalSourceKind,
    MarketEventKind,
    MarketType,
)

__all__ = [
    "DatasetFileEntry",
    "DatasetManifest",
    "ManifestValidationSummary",
    "manifest_digest",
]


@dataclass(slots=True, frozen=True)
class DatasetFileEntry:
    """One partition file, exactly as written.

    ``partition_path`` is storage-relative and was produced by the writer —
    the reader validates it again rather than trusting the manifest, because
    a manifest and a directory tree can drift apart and the manifest is the
    one an attacker (or a careless operator) could edit.
    """

    partition_path: str
    symbol: str
    kind: MarketEventKind
    events: int
    bytes: int
    sha256: str
    first_timestamp_micros: int
    last_timestamp_micros: int
    compression: str = "gzip"

    def __post_init__(self) -> None:
        if self.events <= 0:
            raise DatasetFormatError("A stored partition must contain at least one event.")
        if self.bytes <= 0:
            raise DatasetFormatError("A stored partition must have positive byte count.")
        if len(self.sha256) != 64 or any(c not in "0123456789abcdef" for c in self.sha256):
            raise DatasetFormatError("Partition sha256 must be a 64-char lowercase hex digest.")
        if self.last_timestamp_micros < self.first_timestamp_micros:
            raise DatasetFormatError("Partition window end precedes its start.")
        if self.compression not in ("gzip", "none"):
            raise DatasetFormatError(f"Unsupported compression {self.compression!r}.")

    def to_wire(self) -> dict[str, Any]:
        return {
            "path": self.partition_path,
            "symbol": self.symbol,
            "kind": self.kind.value,
            "events": self.events,
            "bytes": self.bytes,
            "sha256": self.sha256,
            "firstTs": self.first_timestamp_micros,
            "lastTs": self.last_timestamp_micros,
            "compression": self.compression,
        }

    @classmethod
    def from_wire(cls, wire: Mapping[str, object]) -> "DatasetFileEntry":
        return cls(
            partition_path=_require_str(wire, "path"),
            symbol=_require_str(wire, "symbol"),
            kind=MarketEventKind(_require_str(wire, "kind")),
            events=_require_int(wire, "events"),
            bytes=_require_int(wire, "bytes"),
            sha256=_require_str(wire, "sha256"),
            first_timestamp_micros=_require_int(wire, "firstTs"),
            last_timestamp_micros=_require_int(wire, "lastTs"),
            compression=str(wire.get("compression", "gzip")),
        )


@dataclass(slots=True, frozen=True)
class ManifestValidationSummary:
    """The verdict as recorded at finalisation. A summary, not the report."""

    status: DatasetStatus
    info_count: int
    warning_count: int
    error_count: int
    fatal_count: int
    report_sha256: str
    policy_digest: str

    def to_wire(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "info": self.info_count,
            "warning": self.warning_count,
            "error": self.error_count,
            "fatal": self.fatal_count,
            "reportSha256": self.report_sha256,
            "policyDigest": self.policy_digest,
        }

    @classmethod
    def from_wire(cls, wire: Mapping[str, object]) -> "ManifestValidationSummary":
        return cls(
            status=DatasetStatus(_require_str(wire, "status")),
            info_count=_require_int(wire, "info"),
            warning_count=_require_int(wire, "warning"),
            error_count=_require_int(wire, "error"),
            fatal_count=_require_int(wire, "fatal"),
            report_sha256=_require_str(wire, "reportSha256"),
            policy_digest=_require_str(wire, "policyDigest"),
        )


@dataclass(slots=True, frozen=True)
class DatasetManifest:
    """The complete, immutable description of one dataset version."""

    identity: DatasetIdentity
    version: int
    name: str
    event_count: int
    total_bytes: int
    files: tuple[DatasetFileEntry, ...]
    file_digests_checksum: str
    completeness: DatasetCompleteness
    validation: ManifestValidationSummary
    manifest_schema_version: int
    created_at_micros: int
    creator_job_id: str
    metadata: Mapping[str, str]

    def __post_init__(self) -> None:
        if self.version < 1:
            raise DatasetFormatError("Dataset version numbers start at 1.")
        if not self.name:
            raise DatasetFormatError("A manifest requires a name.")
        if not self.files:
            raise DatasetFormatError("A manifest with no files describes nothing.")
        if self.manifest_schema_version != MANIFEST_SCHEMA_VERSION:
            raise DatasetFormatError(
                f"Manifest schema v{self.manifest_schema_version} is not understood by this "
                f"release (v{MANIFEST_SCHEMA_VERSION}); refusing to reinterpret the file."
            )
        if self.identity.canonical_schema_version != CANONICAL_SCHEMA_VERSION:
            raise DatasetFormatError(
                f"Dataset was written with canonical schema v"
                f"{self.identity.canonical_schema_version}; this release understands exactly v"
                f"{CANONICAL_SCHEMA_VERSION}."
            )
        if self.event_count < len(self.files):
            raise DatasetFormatError("Event count below file count is inconsistent.")
        declared_events = sum(entry.events for entry in self.files)
        if declared_events != self.event_count:
            raise DatasetFormatError(
                f"Manifest declares {self.event_count} events but its file entries sum to "
                f"{declared_events}; a manifest and its files must agree exactly."
            )
        declared_bytes = sum(entry.bytes for entry in self.files)
        if declared_bytes != self.total_bytes:
            raise DatasetFormatError(
                "Manifest total_bytes disagrees with the sum of its file entries."
            )
        paths = [entry.partition_path for entry in self.files]
        if len(set(paths)) != len(paths):
            raise DatasetFormatError("Duplicate partition path in manifest.")
        for key, value in self.metadata.items():
            validate_credential_free(f"manifest metadata key {key!r}", value)
            validate_credential_free(f"manifest metadata value for {key!r}", value)

    # -- identity accessors --------------------------------------------------
    @property
    def dataset_key(self) -> str:
        return self.identity.key

    @property
    def exchange(self) -> ExchangeId:
        return self.identity.exchange

    @property
    def symbols(self) -> tuple[str, ...]:
        return self.identity.symbols

    @property
    def event_kinds(self) -> tuple[MarketEventKind, ...]:
        return self.identity.event_kinds

    @property
    def content_checksum(self) -> str:
        return self.identity.content_checksum

    @property
    def start_micros(self) -> int:
        return self.identity.start_micros

    @property
    def end_micros(self) -> int:
        return self.identity.end_micros

    @property
    def status(self) -> DatasetStatus:
        """The finalisation-time verdict embedded in the manifest bytes."""
        return self.validation.status

    # -- (de)serialisation ----------------------------------------------------
    def to_wire(self) -> dict[str, Any]:
        identity = self.identity
        return {
            "manifestSchema": self.manifest_schema_version,
            "datasetKey": identity.key,
            "version": self.version,
            "name": self.name,
            # ``content`` is recorded alongside the key inputs but excluded
            # from the key digest (see identity module): same contract, new
            # bytes -> same key, new version. A verifier checks both halves.
            "identity": {
                **{name: value for name, value in identity.canonical_fields()},
                "content": identity.content_checksum,
            },
            "eventCount": self.event_count,
            "totalBytes": self.total_bytes,
            "completeness": self.completeness.value,
            "fileDigests": self.file_digests_checksum,
            "files": [entry.to_wire() for entry in self.files],
            "validation": self.validation.to_wire(),
            "createdAtMicros": self.created_at_micros,
            "creatorJobId": self.creator_job_id,
            "metadata": dict(sorted(self.metadata.items())),
        }

    def to_json_bytes(self) -> bytes:
        return (canonical_json(self.to_wire()) + "\n").encode("utf-8")

    @classmethod
    def from_json_bytes(cls, raw: bytes) -> "DatasetManifest":
        import json

        parsed = json.loads(raw.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise DatasetFormatError("manifest.json must contain a single JSON object.")
        return cls._from_wire(parsed)

    @classmethod
    def _from_wire(cls, wire: Mapping[str, object]) -> "DatasetManifest":
        schema = _require_int(wire, "manifestSchema")
        if schema != MANIFEST_SCHEMA_VERSION:
            raise DatasetFormatError(
                f"manifest.json carries schema v{schema}; this release reads v"
                f"{MANIFEST_SCHEMA_VERSION}. Use the reader that wrote it, or re-ingest."
            )
        identity_wire = wire.get("identity")
        if not isinstance(identity_wire, dict):
            raise DatasetFormatError("Manifest is missing its identity block.")
        identity = _identity_from_wire(identity_wire)
        files_raw = wire.get("files")
        if not isinstance(files_raw, list) or not files_raw:
            raise DatasetFormatError("Manifest is missing its files block.")
        files = tuple(
            DatasetFileEntry.from_wire(entry)
            for entry in files_raw
            if isinstance(entry, dict)
        )
        if len(files) != len(files_raw):
            raise DatasetFormatError("Every manifest files[] entry must be an object.")
        validation_raw = wire.get("validation")
        if not isinstance(validation_raw, dict):
            raise DatasetFormatError("Manifest is missing its validation block.")
        metadata_raw = wire.get("metadata", {})
        if not isinstance(metadata_raw, dict) or any(
            not isinstance(k, str) or not isinstance(v, str) for k, v in metadata_raw.items()
        ):
            raise DatasetFormatError("Manifest metadata must be a string-to-string mapping.")
        manifest = cls(
            identity=identity,
            version=_require_int(wire, "version"),
            name=_require_str(wire, "name"),
            event_count=_require_int(wire, "eventCount"),
            total_bytes=_require_int(wire, "totalBytes"),
            files=files,
            file_digests_checksum=_require_str(wire, "fileDigests"),
            completeness=DatasetCompleteness(_require_str(wire, "completeness")),
            validation=ManifestValidationSummary.from_wire(validation_raw),
            manifest_schema_version=schema,
            created_at_micros=_require_int(wire, "createdAtMicros"),
            creator_job_id=_require_str(wire, "creatorJobId"),
            metadata=dict(metadata_raw),
        )
        stored_key = _require_str(wire, "datasetKey")
        if stored_key != identity.key:
            raise DatasetFormatError(
                "Manifest datasetKey does not match the key re-derived from its identity "
                "fields: the record was edited, and nothing built from it is trustworthy."
            )
        return manifest

    # -- verification ------------------------------------------------------------
    def verify_against_files(self, actual: Mapping[str, str]) -> tuple[str, ...]:
        """Compare stored per-file digests against freshly computed ones.

        Returns the mismatching paths, empty when everything agrees. Taking
        ``path -> sha256`` from the caller keeps this free of storage imports:
        the verification *is* a pure comparison, and who read the bytes is
        somebody else's concern.
        """
        mismatches: list[str] = []
        for entry in self.files:
            observed = actual.get(entry.partition_path)
            if observed is None:
                mismatches.append(f"{entry.partition_path}: missing")
            elif observed != entry.sha256:
                mismatches.append(f"{entry.partition_path}: digest differs")
        for path in sorted(set(actual) - {entry.partition_path for entry in self.files}):
            mismatches.append(f"{path}: present on disk but not in the manifest")
        return tuple(mismatches)

    def descriptor_dataset_id(self) -> str:
        """The identity string recorded in every backtest over this version."""
        return f"{self.identity.key}@v{self.version}"

    def status_for_normal_use(self) -> DatasetStatus:
        return self.validation.status

    def worst_severity(self) -> DatasetValidationSeverity:
        """The heaviest finding class the summary declares.

        Derived rather than stored: an extra field recording it could disagree
        with the counts it is supposed to summarise.
        """
        for severity, count in (
            (DatasetValidationSeverity.FATAL, self.validation.fatal_count),
            (DatasetValidationSeverity.ERROR, self.validation.error_count),
            (DatasetValidationSeverity.WARNING, self.validation.warning_count),
            (DatasetValidationSeverity.INFO, self.validation.info_count),
        ):
            if count > 0:
                return severity
        return DatasetValidationSeverity.INFO


def _identity_from_wire(fields: Mapping[object, object]) -> DatasetIdentity:
    def value(name: str) -> str:
        raw = fields.get(name)
        if not isinstance(raw, str) or not raw:
            raise DatasetFormatError(f"Manifest identity is missing field {name!r}.")
        return raw

    try:
        return DatasetIdentity(
            source_kind=HistoricalSourceKind(value("source_kind")),
            source_label=value("source_label"),
            exchange=ExchangeId(value("exchange")),
            market_type=MarketType(value("market_type")),
            symbols=tuple(value("symbols").split(",")),
            event_kinds=tuple(
                MarketEventKind(item) for item in value("event_kinds").split(",")
            ),
            start_micros=int(value("start_micros")),
            end_micros=int(value("end_micros")),
            granularity=value("granularity"),
            content_checksum=value("content"),
            canonical_schema_version=int(value("canonical_schema")),
        )
    except ValueError as exc:  # int() or enum lookup — a corrupt record, not a bug
        raise DatasetFormatError(f"Manifest identity is malformed: {exc}") from exc


def manifest_digest(manifest: DatasetManifest) -> str:
    """SHA-256 of the manifest's canonical bytes."""
    return hashlib.sha256(manifest.to_json_bytes()).hexdigest()


def _require_str(wire: Mapping[str, Any], key: str) -> str:
    raw = wire.get(key)
    if not isinstance(raw, str) or not raw:
        raise DatasetFormatError(f"Manifest field {key!r} must be a non-empty string.")
    return raw


def _require_int(wire: Mapping[str, Any], key: str) -> int:
    raw = wire.get(key)
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise DatasetFormatError(f"Manifest field {key!r} must be an integer.")
    return raw
