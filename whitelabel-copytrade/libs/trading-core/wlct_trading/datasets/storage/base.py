"""The storage abstraction: where dataset bytes live.

Two implementations are honest to keep apart in the same interface:
``LOCAL_FILESYSTEM`` (this release) and ``OBJECT_STORAGE`` (the next one). The
interface therefore speaks in *keys* and *streams*, never in paths or file
descriptors - a method that returned a ``Path`` would be a local filesystem
in an interface costume, and the day somebody implements S3 they would find
the costume sewn into every caller.

Three properties every implementation must provide, because the pipeline's
safety story depends on them:

1. **Staging is separate from final.** Writes land in a staging area that
   normal reads never see. A crash between "written" and "finalised" leaves
   nothing half-published; there is no window in which a version directory
   exists without its manifest.
2. **Finalisation is atomic per version.** One call moves the completed
   staging directory into the visible namespace (or fails outright on a
   cross-device configuration rather than degrading into a visible partial
   copy).
3. **Paths are derived, never accepted.** Everything that can reach the
   filesystem is a dataset key matching the strict derived pattern, a positive
   integer version, and manifest-relative partition paths re-validated on
   every read and write. There is no method on this interface that takes a
   caller-supplied directory, because the first one added is the path
   traversal.
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

__all__ = [
    "CHUNK_BYTES",
    "DatasetStorage",
    "StorageError",
    "StoragePathError",
    "WrittenFile",
    "validate_dataset_key",
    "validate_version",
]

#: Read chunk size for digest computation. A 64 KiB window keeps hashing memory
#: constant for files of any size; the number is a throughput compromise, not
#: a guarantee of either.
CHUNK_BYTES = 65_536


class StorageError(Exception):
    """Anything the storage layer refuses, with the refusal as the point."""


class StoragePathError(StorageError):
    """A supplied key, version or relative path failed the shape checks."""


@dataclass(slots=True, frozen=True)
class WrittenFile:
    """Receipt for one written file: exactly what landed, hashed."""

    relative_path: str
    bytes_written: int
    sha256: str


class DatasetStorage(ABC):
    """Key-addressed, stream-friendly, staging-first dataset storage."""

    @property
    @abstractmethod
    def backend_name(self) -> str:
        """``"local_filesystem"`` today; ``"object_storage"`` later."""

    # -- path safety ---------------------------------------------------------
    @staticmethod
    def validate_relative_path(relative_path: str) -> str:
        """Return the path unchanged iff it is a safe manifest-relative path.

        The rules are a blacklist of everything an object-store key can be
        abused with, not a policy of this backend: absolute paths, any dot
        segment, backslashes (a Windows path on a POSIX box is still a path),
        control characters, empty segments, and leading/trailing separators.
        Partition paths are produced by the writer from derived components,
        so nothing legitimate needs the escapes this rejects.
        """
        DatasetStorage._reject_shape(relative_path, what="partition path")
        if "\\" in relative_path:
            raise StoragePathError(f"Partition path {relative_path!r} contains a backslash.")
        segments = relative_path.split("/")
        if any(segment in ("", ".", "..") for segment in segments):
            raise StoragePathError(
                f"Partition path {relative_path!r} contains an empty, '.' or '..' segment; "
                "dataset paths must be plain and relative."
            )
        return relative_path

    @staticmethod
    def _reject_shape(value: str, *, what: str) -> None:
        if not value:
            raise StoragePathError(f"Empty {what}.")
        if value.startswith("/") or value.startswith("~"):
            raise StoragePathError(f"{what.capitalize()} {value!r} is absolute.")
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise StoragePathError(f"{what.capitalize()} {value!r} contains control characters.")

    # -- staging ---------------------------------------------------------------
    @abstractmethod
    def create_staging(self, job_key: str) -> None:
        """Prepare a staging area for one ingestion job. Idempotent."""

    @abstractmethod
    def write_staged(
        self, job_key: str, relative_path: str, chunks: Iterable[bytes]
    ) -> WrittenFile:
        """Write one file into staging, hashing as it goes.

        Takes an iterable of byte chunks precisely so that no caller has to
        hold a whole partition in memory to write it, and returns the digest
        for free rather than making the pipeline read the file back.
        """

    @abstractmethod
    def stage_has(self, job_key: str, relative_path: str) -> bool:
        """Whether a staged file exists (resume check)."""

    @abstractmethod
    def remove_staged(self, job_key: str, relative_path: str) -> None:
        """Delete one staged file (resume re-write of a failed partition)."""

    @abstractmethod
    def discard_staging(self, job_key: str) -> None:
        """Delete a staging area. Only ever valid for staging."""

    @abstractmethod
    def finalize_staging(
        self, job_key: str, dataset_key: str, version: int, replace: bool = False
    ) -> None:
        """Atomically move a completed staging directory into the visible tree.

        ``replace`` exists for exactly one caller - re-ingest of the same
        identity after quarantine - and implementations must refuse it against
        a ``VALID`` version. Normal dataset evolution is a new version, never
        a replacement.
        """

    # -- reads ---------------------------------------------------------------
    @abstractmethod
    def dataset_version_exists(self, dataset_key: str, version: int) -> bool:
        """A version exists only when its manifest is present and complete."""

    @abstractmethod
    def list_versions(self, dataset_key: str) -> tuple[int, ...]:
        """Versions with readable manifests, ascending.

        Directories without a manifest are *invisible*, not errors: that is
        the crash window, and the atomic finalisation means it contains no
        complete dataset anyway.
        """

    @abstractmethod
    def list_dataset_keys(self) -> tuple[str, ...]:
        """Every dataset key with at least one visible version, ascending."""

    @abstractmethod
    def read_manifest(self, dataset_key: str, version: int) -> bytes | None:
        """Manifest bytes, or ``None`` when the version was never finalised.

        ``None`` rather than an exception: the registry distinguishes "absent"
        (invisible crash debris) from "unreadable" (a manifest that exists and
        fails to parse), and conflating them would turn a non-event into an
        alarm.
        """

    @abstractmethod
    def read_report(self, dataset_key: str, version: int) -> bytes | None:
        """The stored validation report, if a re-validation wrote a newer one."""

    @abstractmethod
    def read_status(self, dataset_key: str, version: int) -> bytes | None:
        """The live status record, if it exists (it does from finalisation on)."""

    @abstractmethod
    def write_status(self, dataset_key: str, version: int, payload: bytes) -> None:
        """Status transitions only. There is no method here that rewrites a
        manifest or a data partition, and adding one would end the immutability
        story, so callers should consider that a warning about the design."""

    @abstractmethod
    def open_partition(self, dataset_key: str, version: int, relative_path: str) -> Iterator[bytes]:
        """Yield raw bytes of one partition file in order, in chunks.

        A generator rather than a file object because the bounded-buffer
        contract of the reader starts here: whatever the backend, exactly one
        chunk is in flight at a time.
        """

    # -- shared utilities -------------------------------------------------------
    @staticmethod
    def digest_chunks(chunks: Iterable[bytes]) -> tuple[str, int]:
        """Stream a ``(sha256, byte_count)`` over an iterable of chunks."""
        digest = hashlib.sha256()
        total = 0
        for chunk in chunks:
            digest.update(chunk)
            total += len(chunk)
        return digest.hexdigest(), total


def validate_dataset_key(dataset_key: str) -> str:
    """The one gate every key passes through before touching the backend."""
    from wlct_trading.datasets.identity import is_safe_dataset_key

    if not is_safe_dataset_key(dataset_key):
        raise StoragePathError(
            f"Dataset key {dataset_key!r} is not a derived key (hst-<32 hex>). "
            "Keys are computed from the identity, never supplied by a caller."
        )
    return dataset_key


def validate_version(version: int) -> int:
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise StoragePathError(f"Dataset version {version!r} is not a positive integer.")
    return version
