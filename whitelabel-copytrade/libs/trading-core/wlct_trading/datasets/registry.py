"""The dataset registry: what exists, is it valid, can I replay it.

This is the *file-side* registry — the authority the worker and the CLI use.
The Prisma tables (``historical_datasets`` and friends) are the control-plane
projection of exactly these manifests, kept in sync by the registration step
of the ingestion job; neither side mutates the other's payloads, and the
manifest on disk is what a checksum can be verified *against*, so the file
record is the ground truth and the database is the queryable mirror.

Queries it answers, per the system spec: which datasets exist, which versions
are valid, what symbols and ranges and kinds they cover, which checksum
identifies a version, which source produced it, and — the one every consumer
asks first — *may I use this for a backtest*. The last answer is where policy
lives: a ``VALID`` version is usable; a ``QUARANTINED`` or ``INVALID`` one is
not; an ``ARCHIVED`` one is readable only when the caller names the archive
explicitly; and an override exists for the compliance-review case, never
silent, always reason-carrying.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from wlct_trading.datasets.manifest import DatasetManifest, manifest_digest
from wlct_trading.datasets.storage.base import DatasetStorage
from wlct_trading.enums import DatasetStatus, ExchangeId, MarketEventKind

__all__ = ["DatasetRegistry", "VersionRecord", "RegistryError"]


class RegistryError(RuntimeError):
    """The registry refused, and says why in the message."""


@dataclass(slots=True, frozen=True)
class VersionRecord:
    """One dataset version, as the registry sees it."""

    manifest: DatasetManifest
    status: DatasetStatus
    manifest_sha256: str
    stored_manifest_bytes: int

    @property
    def dataset_key(self) -> str:
        return self.manifest.dataset_key

    @property
    def version(self) -> int:
        return self.manifest.version

    @property
    def usable_for_backtest(self) -> bool:
        return self.status.usable_for_backtest

    def coverage(self) -> dict[str, object]:
        return {
            "symbols": list(self.manifest.symbols),
            "kinds": [kind.value for kind in self.manifest.event_kinds],
            "startMicros": self.manifest.start_micros,
            "endMicros": self.manifest.end_micros,
            "events": self.manifest.event_count,
            "completeness": self.manifest.completeness.value,
        }


class DatasetRegistry:
    """Manifest-driven registry over any :class:`DatasetStorage`."""

    def __init__(self, storage: DatasetStorage) -> None:
        self._storage = storage

    @property
    def storage(self) -> DatasetStorage:
        """The registry's storage handle, shared with readers of the same tree.

        Deliberately the *same object*, not a copy of its configuration: two
        mounts of one filesystem are how components end up disagreeing about
        what is visible, and "visible" is exactly the atomic-finalisation
        promise.
        """
        return self._storage

    # -- enumeration -----------------------------------------------------------
    def datasets(self) -> tuple[str, ...]:
        """Every dataset key with at least one visible version, ascending."""
        return tuple(
            key
            for key in self._storage.list_dataset_keys()
            if self._storage.list_versions(key)
        )

    def versions(self, dataset_key: str) -> tuple[VersionRecord, ...]:
        records: list[VersionRecord] = []
        for version in self._storage.list_versions(dataset_key):
            record = self.record(dataset_key, version)
            if record is not None:
                records.append(record)
        return tuple(records)

    def latest_valid(self, dataset_key: str) -> VersionRecord | None:
        valid = [record for record in self.versions(dataset_key) if record.usable_for_backtest]
        return max(valid, key=lambda record: record.version) if valid else None

    def record(self, dataset_key: str, version: int) -> VersionRecord | None:
        raw = self._storage.read_manifest(dataset_key, version)
        if raw is None:
            return None
        manifest = DatasetManifest.from_json_bytes(raw)
        status = self._current_status(dataset_key, version, manifest)
        import hashlib

        return VersionRecord(
            manifest=manifest,
            status=status,
            manifest_sha256=hashlib.sha256(raw).hexdigest(),
            stored_manifest_bytes=len(raw),
        )

    # -- lookup by content -----------------------------------------------------
    def find(
        self,
        *,
        exchange: ExchangeId,
        symbol: str,
        kind: MarketEventKind | None = None,
        start_micros: int | None = None,
        end_micros: int | None = None,
        usable_only: bool = True,
    ) -> tuple[VersionRecord, ...]:
        """Every version covering ``[start, end]`` for one symbol.

        Scan-and-match, not index-and-lookup, by design at registry scale:
        thousands of manifests fit in a directory listing, and an index that
        could disagree with the manifests it indexes would be a second truth
        about the same bytes. If the registry ever grows into the tens of
        thousands, the index belongs beside it, not instead of it.
        """
        found: list[VersionRecord] = []
        for key in self._storage.list_dataset_keys():
            for record in self.versions(key):
                manifest = record.manifest
                if manifest.exchange is not exchange:
                    continue
                if symbol not in manifest.symbols:
                    continue
                if kind is not None and kind not in manifest.event_kinds:
                    continue
                if start_micros is not None and manifest.start_micros > start_micros:
                    continue
                if end_micros is not None and manifest.end_micros < end_micros:
                    continue
                if usable_only and not record.usable_for_backtest:
                    continue
                found.append(record)
        found.sort(key=lambda record: (record.manifest.start_micros, record.dataset_key, record.version))
        return tuple(found)

    def coverage_ranges(
        self,
        *,
        exchange: ExchangeId,
        symbol: str,
        kind: MarketEventKind | None = None,
    ) -> tuple[tuple[int, int, str, int], ...]:
        """Merged covered windows as ``(start, end, dataset_key, version)``.

        The question "what can I replay for BTC-USDT trades?" is answered from
        VALID versions only: ranges an operator cannot use are not coverage,
        they are noise that would make the answer lie about itself.
        """
        windows = [
            (record.manifest.start_micros, record.manifest.end_micros, record.dataset_key, record.version)
            for record in self.find(exchange=exchange, symbol=symbol, kind=kind, usable_only=True)
            if symbol in record.manifest.symbols
        ]
        windows.sort()
        merged: list[tuple[int, int, str, int]] = []
        for start, end, key, version in windows:
            if merged and start <= merged[-1][1]:
                previous_start, previous_end, previous_key, previous_version = merged[-1]
                if end > previous_end:
                    merged[-1] = (previous_start, end, previous_key, previous_version)
                continue
            merged.append((start, end, key, version))
        return tuple(merged)

    # -- status transitions (metadata only; the payload never moves) --------------
    def quarantine(self, dataset_key: str, version: int, *, reason: str) -> None:
        self._transition(dataset_key, version, DatasetStatus.QUARANTINED, reason=reason)

    def archive(self, dataset_key: str, version: int, *, reason: str) -> None:
        self._transition(dataset_key, version, DatasetStatus.ARCHIVED, reason=reason)

    def _transition(self, dataset_key: str, version: int, target: DatasetStatus, *, reason: str) -> None:
        if not reason or len(reason) < 5:
            raise RegistryError(
                f"Refusing a {target.value} transition without a real reason: an operator's "
                "later question 'why is this quarantined?' must have an answer in the record."
            )
        record = self.record(dataset_key, version)
        if record is None:
            raise RegistryError(f"No readable version {dataset_key} v{version} to transition.")
        current = record.status
        allowed: dict[DatasetStatus, set[DatasetStatus]] = {
            DatasetStatus.VALID: {DatasetStatus.QUARANTINED, DatasetStatus.ARCHIVED},
            DatasetStatus.INVALID: {DatasetStatus.QUARANTINED},
            DatasetStatus.QUARANTINED: {DatasetStatus.ARCHIVED},
        }
        if target not in allowed.get(current, set()):
            raise RegistryError(
                f"Status transition {current.value} -> {target.value} is not allowed for "
                f"{dataset_key} v{version}."
            )
        payload = json.dumps(
            {
                "status": target.value,
                "reason": reason,
                "changedAtMicros": _now_micros(),
                "manifestSha256": record.manifest_sha256,
            },
            sort_keys=True,
        ).encode("utf-8")
        self._storage.write_status(dataset_key, version, payload + b"\n")

    def verify_manifest_integrity(self, dataset_key: str, version: int) -> tuple[str, ...]:
        """Re-hash the stored manifest and re-digest every partition file.

        Returns mismatching partition descriptions (empty when the version is
        byte-for-byte what was finalised). The stored manifest digest is also
        compared against the record's own re-derivation, so an edited manifest
        is caught by its own identity field, not by trust.
        """
        record = self.record(dataset_key, version)
        if record is None:
            raise RegistryError(f"No readable version {dataset_key} v{version} to verify.")
        recomputed = manifest_digest(record.manifest)
        if recomputed != record.manifest_sha256:
            return (f"manifest.json digest {record.manifest_sha256} recomputes to {recomputed}",)
        actual: dict[str, str] = {}
        for entry in record.manifest.files:
            # The storage resolves the version directory itself; callers never
            # hand it a path, so this stays inside the containment rules.
            digest = self._partition_digest(dataset_key, version, entry.partition_path)
            actual[entry.partition_path] = digest if digest is not None else "missing"
        return record.manifest.verify_against_files(actual)

    def _partition_digest(self, dataset_key: str, version: int, relative_path: str) -> str | None:
        from wlct_trading.datasets.storage.local import LocalDatasetStorage

        if isinstance(self._storage, LocalDatasetStorage):
            try:
                return self._storage.partition_digest(dataset_key, version, relative_path)
            except FileNotFoundError:
                return None
        return None  # pragma: no cover - object storage supplies this when it exists

    def _current_status(
        self, dataset_key: str, version: int, manifest: DatasetManifest
    ) -> DatasetStatus:
        """``status.json`` when present, else the manifest's finalisation verdict.

        The status file names the manifest digest it was written against: if
        the two disagree, the record is *not usable* rather than "probably
        fine", because the only way they disagree is that something edited one
        side after finalisation.
        """
        raw = self._storage.read_status(dataset_key, version)
        if raw is None:
            return manifest.status
        try:
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict):
                return DatasetStatus.QUARANTINED
            status_value = data.get("status")
            bound = data.get("manifestSha256")
            if not isinstance(status_value, str) or not isinstance(bound, str):
                return DatasetStatus.QUARANTINED
            if status_value in (DatasetStatus.QUARANTINED.value, DatasetStatus.ARCHIVED.value):
                return DatasetStatus(status_value)
            if hashlib.sha256(manifest.to_json_bytes()).hexdigest() != bound:
                return DatasetStatus.QUARANTINED
            return DatasetStatus(status_value)
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            return DatasetStatus.QUARANTINED


def _now_micros() -> int:
    from datetime import datetime, timezone

    return int(datetime.now(timezone.utc).timestamp() * 1_000_000)
