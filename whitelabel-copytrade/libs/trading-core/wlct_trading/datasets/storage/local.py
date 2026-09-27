"""Local-filesystem dataset storage.

Layout, per dataset version::

    <root>/<dataset-key>/v<version>/
        manifest.json          written last, the visibility switch
        status.json            the live status record (the manifest keeps its own copy)
        report.json            the newest validation report
        quality.json           the newest quality report
        failure.json           present only in a quarantined/failed staging area
        data/<symbol>/<KIND>/<YYYY-MM-DD>/partNNNN.jsonl.gz

Why this shape
--------------
* **The manifest is the last file written.** A version directory without a
  readable manifest does not exist as far as this class is concerned, so
  "finalisation is atomic" reduces to "rename the directory, then nothing can
  observe a half-written manifest because nobody opens the rename target
  before the rename completes".
* **One directory per version, never merged.** Immutability stops needing
  discipline the moment versions are siblings: to change a VALID dataset you
  would have to edit a directory that every reader treats as closed, and the
  digest check at open time makes that edit visible.
* **Date-partitioned, kind-then-symbol ordered.** ``data/BTC-USDT/TRADE/
  2026-01-15/part0000.jsonl.gz``: a replay of "January trades" opens a handful
  of files, and the path components that skip whole days are the same ones the
  reader reads from the manifest - the index is the filename, deliberately,
  because a manifest is a single auditable artefact while a sidecar index is
  a second source of truth waiting to disagree.
* **Files 0o600, directories 0o750.** Datasets are public data; the tightness
  is not about secrets (there are none) but about refusing to make a
  multi-tenant host's sharing defaults someone else's problem.

Staging lives under a *separate root* by default, and finalisation refuses
rather than copying when the roots are on different filesystems: a rename is
atomic and a copy is not, and the difference is the entire guarantee.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
from collections.abc import Iterable, Iterator
from pathlib import Path

from wlct_trading.datasets.storage.base import (
    CHUNK_BYTES,
    DatasetStorage,
    StorageError,
    StoragePathError,
    WrittenFile,
    validate_dataset_key,
    validate_version,
)

__all__ = ["LocalDatasetStorage"]

_FILE_MODE = 0o600
_DIR_MODE = 0o750


class LocalDatasetStorage(DatasetStorage):
    """Storage on a local (or local-mounted network) filesystem."""

    def __init__(self, root: Path, staging_root: Path) -> None:
        self._root = Path(root).resolve()
        self._staging = Path(staging_root).resolve()
        if self._root == self._staging:
            raise StorageError(
                "Dataset root and staging root must differ: finalisation renames into the "
                "visible tree, and staging inside the visible tree would make the invisible "
                "half-written state visible."
            )
        self._ensure_tree(self._root)
        self._ensure_tree(self._staging)

    # -- construction helpers --------------------------------------------------
    @staticmethod
    def _ensure_tree(path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True, mode=_DIR_MODE)
        if not path.is_dir() or path.is_symlink():
            raise StorageError(f"{path} must be a real directory, not a symlink or file.")

    def _dataset_dir(self, dataset_key: str, version: int) -> Path:
        validate_dataset_key(dataset_key)
        validate_version(version)
        directory = self._root / dataset_key / f"v{version}"
        return self._contained(self._root, directory)

    def _staging_dir(self, job_key: str) -> Path:
        if not job_key or any(
            char in job_key for char in ("/", "\\", "..")
        ) or job_key != Path(job_key).name:
            raise StoragePathError(
                f"Job key {job_key!r} is not a single safe path component."
            )
        directory = self._staging / job_key
        return self._contained(self._staging, directory)

    def _safe_join(self, base: Path, relative: str) -> Path:
        """Join, contain, and reject every existing symlink in the chain.

        ``O_NOFOLLOW`` guards only the final component, and a symlink planted
        mid-path is the classic way to make a "contained" writer touch the
        world outside its root. Stepping through the components after the
        containment check closes that gap: dataset trees contain no symlinks,
        and this class enforces it on both the read and write side.
        """
        normalised = self._contained(base, Path(relative))
        current = base
        for part in Path(relative).parts:
            current = current / part
            if current.is_symlink():
                raise StoragePathError(
                    f"Path component {current.name} is a symlink; dataset trees "
                    "contain no symlinks and this storage refuses them."
                )
        return normalised

    @staticmethod
    def _contained(base: Path, candidate: Path) -> Path:
        """Join under ``base`` and refuse anything that escapes it.

        Normpath-then-contain, never resolve-then-contain: ``resolve`` follows
        symlinks, which would let a planted link inside the tree point the
        containment check at an outside target and *pass*. The component checks
        in ``validate_relative_path`` already reject the escapes this guards
        against; this is the belt that catches a future caller that forgets
        them, and it returns the joined path so callers read what they asked
        for.
        """
        joined = candidate if candidate.is_absolute() else base / candidate
        normalised = Path(os.path.normpath(str(joined)))
        try:
            normalised.relative_to(base)
        except ValueError as exc:
            raise StoragePathError(
                f"Path {candidate} resolves outside the storage root {base}."
            ) from exc
        return normalised

    @property
    def backend_name(self) -> str:
        return "local_filesystem"

    @property
    def root(self) -> Path:
        return self._root

    # -- staging ----------------------------------------------------------------
    def create_staging(self, job_key: str) -> None:
        self._ensure_tree(self._staging_dir(job_key))

    def write_staged(
        self, job_key: str, relative_path: str, chunks: Iterable[bytes]
    ) -> WrittenFile:
        safe = self.validate_relative_path(relative_path)
        target = self._safe_join(self._staging_dir(job_key), safe)
        target.parent.mkdir(parents=True, exist_ok=True, mode=_DIR_MODE)
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, _FILE_MODE)
        digest = hashlib.sha256()
        total = 0
        try:
            with os.fdopen(fd, "wb") as handle:
                for chunk in chunks:
                    handle.write(chunk)
                    digest.update(chunk)
                    total += len(chunk)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            # Never leave a half-written file pretending to be a partition:
            # the resume logic checks digests, but deleting here means a crash
            # mid-write is visibly absent rather than invisibly corrupt.
            target.unlink(missing_ok=True)
            raise
        return WrittenFile(relative_path=safe, bytes_written=total, sha256=digest.hexdigest())

    def read_staged_digest(self, job_key: str, relative_path: str) -> str | None:
        """Digest of an already-staged file (resume verification), or None."""
        safe = self.validate_relative_path(relative_path)
        target = self._staging_dir(job_key) / Path(safe)
        if any((self._staging_dir(job_key) / part).is_symlink() for part in Path(safe).parts):
            raise StoragePathError("Symlinked staging component; refusing to digest it.")
        if not target.exists():
            return None
        digest_obj, _ = DatasetStorage.digest_chunks(self._file_chunks(target))
        return digest_obj

    def remove_staged(self, job_key: str, relative_path: str) -> None:
        """Delete one staged file. Staging only, and only the pipeline's use.

        Resume needs this: a completed partition whose recorded digest no
        longer matches the bytes (a crash caught mid-flush) must be *removed*
        before rewriting, because the write path is deliberately exclusive -
        O_EXCL refuses to overwrite, which is the same paranoia that makes
        this method necessary rather than a truncating write.
        """
        safe = self.validate_relative_path(relative_path)
        target = self._staging_dir(job_key) / Path(safe)
        if target.is_symlink():
            raise StoragePathError("Refusing to remove a symlinked staged path.")
        target.unlink(missing_ok=True)

    def stage_has(self, job_key: str, relative_path: str) -> bool:
        safe = self.validate_relative_path(relative_path)
        return (self._staging_dir(job_key) / Path(safe)).exists()

    def discard_staging(self, job_key: str) -> None:
        directory = self._staging_dir(job_key)
        if directory.exists():
            shutil.rmtree(directory)

    def quarantine_staging(self, job_key: str, failure: dict[str, str]) -> Path:
        """Park a failed staging area with a ``failure.json``, preserving evidence.

        Nothing on this class deletes dataset evidence automatically - the
        retention policy's only destructive setting acts on *staging*, and
        even that is an explicit operator call, never a sweep.
        """
        directory = self._staging_dir(job_key)
        payload = (json.dumps(failure, sort_keys=True) + "\n").encode("utf-8")
        with open(
            directory / "failure.json",
            "wb",
            opener=lambda path, flags: os.open(path, flags | os.O_NOFOLLOW, _FILE_MODE),
        ) as handle:
            handle.write(payload)
        return directory

    def finalize_staging(
        self, job_key: str, dataset_key: str, version: int, replace: bool = False
    ) -> None:
        validate_dataset_key(dataset_key)
        validate_version(version)
        staging = self._staging_dir(job_key)
        if not (staging / "manifest.json").exists():
            raise StorageError(
                "Refusing to finalise a staging area without a manifest; publishing a "
                "version without its identity is how a dataset becomes folklore."
            )
        target = self._dataset_dir(dataset_key, version)
        if target.exists():
            # "No status.json" is not "no status": a freshly finalised version
            # has no status file (the verdict lives in the manifest) and is
            # whatever that says - VALID in practice. Treating the missing file
            # as replaceable would be the hole through which a published
            # version gets overwritten, so the guard reads *not QUARANTINED*
            # as the default instead of *not known*.
            existing_status = self._status_value(target)
            if not replace:
                raise StorageError(
                    f"Version v{version} of {dataset_key} already exists; a validated "
                    "dataset is immutable and a new dataset version is the only "
                    "legitimate successor."
                )
            if existing_status != "QUARANTINED":
                raise StorageError(
                    f"replace=True is only valid against a QUARANTINED version; refusing "
                    f"to touch v{version} in status {existing_status or 'VALID(finalised)'}."
                )
            evidence = target.parent / f"v{version}.quarantined-{job_key}"
            if evidence.exists():
                raise StorageError(
                    f"Quarantine evidence directory {evidence.name} already exists; "
                    "operator reconciliation is required before replacement."
                )
            target.rename(evidence)
        target.parent.mkdir(parents=True, exist_ok=True, mode=_DIR_MODE)
        if os.stat(staging).st_dev != os.stat(target.parent).st_dev:
            raise StorageError(
                "Staging and dataset roots are on different filesystems; renaming is "
                "atomic and copying is not, and this class will not silently trade one "
                "for the other. Move DATASET_TEMP_ROOT onto the dataset filesystem."
            )
        os.replace(staging, target)
        self._fsync_dir(target.parent)

    # -- reads --------------------------------------------------------------------
    def dataset_version_exists(self, dataset_key: str, version: int) -> bool:
        return (self._dataset_dir(dataset_key, version) / "manifest.json").exists()

    def list_versions(self, dataset_key: str) -> tuple[int, ...]:
        validate_dataset_key(dataset_key)
        directory = self._contained(self._root, self._root / dataset_key)
        if not directory.is_dir():
            return ()
        versions: list[int] = []
        for entry in sorted(directory.iterdir(), key=lambda item: item.name):
            if not entry.name.startswith("v") or entry.is_symlink():
                continue
            suffix = entry.name[1:]
            if not suffix.isdigit():
                continue
            if (entry / "manifest.json").exists():
                versions.append(int(suffix))
        return tuple(sorted(versions))

    def list_dataset_keys(self) -> tuple[str, ...]:
        keys: list[str] = []
        for entry in sorted(self._root.iterdir(), key=lambda item: item.name):
            if entry.is_dir() and not entry.is_symlink() and entry.name.startswith("hst-"):
                keys.append(entry.name)
        return tuple(keys)

    def read_manifest(self, dataset_key: str, version: int) -> bytes | None:
        path = self._dataset_dir(dataset_key, version) / "manifest.json"
        return self._read(path) if path.exists() else None

    def read_report(self, dataset_key: str, version: int) -> bytes | None:
        path = self._dataset_dir(dataset_key, version) / "report.json"
        return self._read(path) if path.exists() else None

    def read_status(self, dataset_key: str, version: int) -> bytes | None:
        path = self._dataset_dir(dataset_key, version) / "status.json"
        return self._read(path) if path.exists() else None

    def write_status(self, dataset_key: str, version: int, payload: bytes) -> None:
        directory = self._dataset_dir(dataset_key, version)
        if not (directory / "manifest.json").exists():
            raise StorageError(
                "Refusing to write status for a version whose manifest is absent."
            )
        self._atomic_write(directory / "status.json", payload)

    def open_partition(
        self, dataset_key: str, version: int, relative_path: str
    ) -> Iterator[bytes]:
        safe = self.validate_relative_path(relative_path)
        path = self._safe_join(self._dataset_dir(dataset_key, version), safe)
        if not path.exists():
            raise StorageError(f"Partition {safe!r} is missing from v{version}.")
        return self._file_chunks(path)

    def partition_digest(self, dataset_key: str, version: int, relative_path: str) -> str:
        """Recompute a partition's sha256 (verification pass)."""
        safe = self.validate_relative_path(relative_path)
        path = self._safe_join(self._dataset_dir(dataset_key, version), safe)
        digest, _ = DatasetStorage.digest_chunks(self._file_chunks(path))
        return digest

    # -- file helpers ----------------------------------------------------------------
    @staticmethod
    def _file_chunks(path: Path) -> Iterator[bytes]:
        with open(
            path, "rb", opener=lambda name, flags: os.open(name, flags | os.O_NOFOLLOW)
        ) as handle:
            while True:
                chunk = handle.read(CHUNK_BYTES)
                if not chunk:
                    return
                yield chunk

    @staticmethod
    def _read(path: Path) -> bytes:
        with open(
            path, "rb", opener=lambda name, flags: os.open(name, flags | os.O_NOFOLLOW)
        ) as handle:
            return handle.read()

    @staticmethod
    def _status_value(directory: Path) -> str | None:
        status_path = directory / "status.json"
        if not status_path.exists():
            return None
        raw = json.loads(LocalDatasetStorage._read(status_path).decode("utf-8"))
        value = raw.get("status")
        return value if isinstance(value, str) else None

    def _atomic_write(self, path: Path, payload: bytes) -> None:
        temp = path.with_name(path.name + ".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, _FILE_MODE)
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        self._fsync_dir(path.parent)

    @staticmethod
    def _fsync_dir(directory: Path) -> None:
        fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def directory_is_ordinary(path: Path) -> bool:
    """Symlink-free, regular directory check, exposed for tests and re-scans."""
    info = os.lstat(path)
    return stat.S_ISDIR(info.st_mode)
