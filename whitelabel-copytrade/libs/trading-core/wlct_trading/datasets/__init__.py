"""Persisted historical market data: capture, validation, immutability, replay.

Part 7's single job is to feed the Part 6 backtest engine real stored data
without the engine ever learning that storage exists. The package layout maps
that job one-to-one::

    schema.py        canonical line format and its strict parsers
    identity.py      deterministic dataset keys (never a random UUID alone)
    manifest.py      the file that makes a directory a dataset
    validation.py    quality rules; findings, not repairs
    quality.py       the one artefact that answers "how good is this data"
    storage/         DatasetStorage: local filesystem now, object stores later
    readers/         bounded streaming reader with deterministic merge
    ingestion/       source adapters and the pipeline that finalises versions
    registry/        what exists, is it valid, may I replay it
    replay/          the bridge: dataset version -> Part 6 HistoricalDataset
    cli.py           operator entry points (all deterministic, all offline-safe)

The invariants the rest of the platform relies on:

* **Validated versions are immutable.** New data means a new version; the
  payload of a ``VALID`` version is never rewritten, and both the local
  storage and the registry refuse attempts structurally, not politely.
* **A version becomes visible only fully finalised.** Staging is separate,
  the manifest is the last word, and a crash leaves nothing half-published.
* **Nothing unsafe is silently repaired.** Corruption is classified (INFO,
  WARNING, ERROR, FATAL), reported, and used to refuse normal replay;
  an override is a written, recorded decision, never a default.
* **No credentials, ever, anywhere.** Public archives by construction;
  credential-shaped inputs are refused at every write boundary here, and the
  historical path shares no import with the live execution path - a test in
  the suite reads the sources to keep that a fact, not a hope.

Datasets belong to BACKTEST. They are not a paper-trading input and cannot
become one; the live feed and the historical store meet nowhere by design.
"""

from __future__ import annotations

from wlct_trading.datasets.identity import (
    DatasetIdentity,
    build_dataset_key,
    events_digest,
    file_digests_checksum,
    is_safe_dataset_key,
)
from wlct_trading.datasets.manifest import (
    DatasetFileEntry,
    DatasetManifest,
    ManifestValidationSummary,
    manifest_digest,
)
from wlct_trading.datasets.quality import QualityReport, build_quality_report
from wlct_trading.datasets.readers.streaming import (
    ReaderStats,
    StreamingDatasetReader,
    merge_sort_key,
)
from wlct_trading.datasets.registry import DatasetRegistry, RegistryError, VersionRecord
from wlct_trading.datasets.schema import (
    CANONICAL_SCHEMA_VERSION,
    MANIFEST_SCHEMA_VERSION,
    DatasetFormatError,
    event_to_line,
    line_to_event,
)
from wlct_trading.datasets.storage.base import DatasetStorage, StorageError, StoragePathError
from wlct_trading.datasets.storage.local import LocalDatasetStorage
from wlct_trading.datasets.validation import (
    DatasetValidationReport,
    DatasetValidator,
    ValidationFinding,
    ValidationPolicy,
)

__all__ = [
    "CANONICAL_SCHEMA_VERSION",
    "MANIFEST_SCHEMA_VERSION",
    "DatasetFileEntry",
    "DatasetFormatError",
    "DatasetIdentity",
    "DatasetManifest",
    "DatasetRegistry",
    "DatasetStorage",
    "DatasetValidationReport",
    "DatasetValidator",
    "LocalDatasetStorage",
    "ManifestValidationSummary",
    "QualityReport",
    "ReaderStats",
    "RegistryError",
    "StorageError",
    "StoragePathError",
    "StreamingDatasetReader",
    "ValidationFinding",
    "ValidationPolicy",
    "VersionRecord",
    "build_dataset_key",
    "build_quality_report",
    "event_to_line",
    "events_digest",
    "file_digests_checksum",
    "is_safe_dataset_key",
    "line_to_event",
    "manifest_digest",
    "merge_sort_key",
]
