"""Dataset storage backends.

The abstraction in :mod:`~wlct_trading.datasets.storage.base` is the contract;
the local filesystem in :mod:`~wlct_trading.datasets.storage.local` is the
implementation this release ships. An object-storage backend is a new module
in this package - never a branch inside ``local.py`` - because the replay
engine, the pipeline and the registry all speak to the abstract type and must
not need to know which one they are talking to.
"""

from __future__ import annotations

from wlct_trading.datasets.storage.base import (
    CHUNK_BYTES,
    DatasetStorage,
    StorageError,
    StoragePathError,
    WrittenFile,
    validate_dataset_key,
    validate_version,
)
from wlct_trading.datasets.storage.local import LocalDatasetStorage

__all__ = [
    "CHUNK_BYTES",
    "DatasetStorage",
    "LocalDatasetStorage",
    "StorageError",
    "StoragePathError",
    "WrittenFile",
    "validate_dataset_key",
    "validate_version",
]
