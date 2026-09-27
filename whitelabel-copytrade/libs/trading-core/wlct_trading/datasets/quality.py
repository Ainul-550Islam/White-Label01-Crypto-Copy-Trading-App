"""The quality report: one artefact that answers "how good is this data?".

The validation report says what is *wrong*; the quality report says what is
*there*. Both are written at finalisation, both are hashed, and every dataset
version is required to carry one - a dataset without a quality report is not
"unmeasured", it is incomplete, and the registry treats it that way.

Every figure here is derived from the manifest and the validation report in
one deterministic pass. Nothing is sampled, nothing is estimated, and nothing
is rounded to a float: event counts and byte counts are exact because they
were counted, and the timestamps are the stream's own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from wlct_trading.datasets.manifest import DatasetManifest
from wlct_trading.datasets.schema import canonical_json
from wlct_trading.datasets.validation import DatasetValidationReport
from wlct_trading.enums import DatasetCompleteness, DatasetValidationSeverity

__all__ = ["QualityReport", "build_quality_report"]


@dataclass(slots=True, frozen=True)
class QualityReport:
    """The twelve numbers every validated dataset must be able to show."""

    dataset_key: str
    version: int
    total_events: int
    total_bytes: int
    first_timestamp_micros: int | None
    last_timestamp_micros: int | None
    duplicate_count: int
    gap_count: int
    sequence_error_count: int
    invalid_event_count: int
    warning_count: int
    fatal_count: int
    info_count: int
    error_count: int
    validation_duration_micros: int
    completeness: DatasetCompleteness
    events_per_symbol: Mapping[str, int]
    events_per_kind: Mapping[str, int]

    def to_wire(self) -> dict[str, Any]:
        return {
            "datasetKey": self.dataset_key,
            "version": self.version,
            "totalEvents": self.total_events,
            "totalBytes": self.total_bytes,
            "firstTs": self.first_timestamp_micros,
            "lastTs": self.last_timestamp_micros,
            "duplicates": self.duplicate_count,
            "gaps": self.gap_count,
            "sequenceErrors": self.sequence_error_count,
            "invalidEvents": self.invalid_event_count,
            "counts": {
                "info": self.info_count,
                "warning": self.warning_count,
                "error": self.error_count,
                "fatal": self.fatal_count,
            },
            "validationDurationMicros": self.validation_duration_micros,
            "completeness": self.completeness.value,
            "eventsPerSymbol": dict(sorted(self.events_per_symbol.items())),
            "eventsPerKind": dict(sorted(self.events_per_kind.items())),
        }

    def to_json_bytes(self) -> bytes:
        return (canonical_json(self.to_wire()) + "\n").encode("utf-8")


def build_quality_report(
    manifest: DatasetManifest,
    report: DatasetValidationReport,
) -> QualityReport:
    """Fold the manifest and the validation report into one readable summary.

    Counts are *rule* counts from the report, not a re-scan: the numbers in a
    quality report must be the numbers that produced the verdict, or the two
    artefacts can disagree and an operator is left choosing which to believe.
    """
    per_symbol: dict[str, int] = {}
    per_kind: dict[str, int] = {}
    for entry in manifest.files:
        per_symbol[entry.symbol] = per_symbol.get(entry.symbol, 0) + entry.events
        per_kind[entry.kind.value] = per_kind.get(entry.kind.value, 0) + entry.events
    rules = report.counts_by_rule
    return QualityReport(
        dataset_key=manifest.dataset_key,
        version=manifest.version,
        total_events=manifest.event_count,
        total_bytes=manifest.total_bytes,
        first_timestamp_micros=report.first_timestamp_micros,
        last_timestamp_micros=report.last_timestamp_micros,
        duplicate_count=rules.get("DUPLICATE_EVENT", 0),
        gap_count=(
            rules.get("TIMESTAMP_GAP", 0)
            + rules.get("DATE_GAP", 0)
            + rules.get("BOOK_SEQUENCE_GAP", 0)
        ),
        sequence_error_count=(
            rules.get("BOOK_SEQUENCE_GAP", 0) + rules.get("BOOK_SEQUENCE_REPLAY", 0)
        ),
        invalid_event_count=(
            rules.get("FORMAT_ERROR", 0)
            + rules.get("NEGATIVE_PRICE", 0)
            + rules.get("NEGATIVE_QUANTITY", 0)
            + rules.get("ZERO_QUANTITY_PRINT", 0)
            + rules.get("CANDLE_RANGE_INCONSISTENT", 0)
            + rules.get("CROSSED_BOOK", 0)
        ),
        warning_count=report.counts_by_severity.get(DatasetValidationSeverity.WARNING.value, 0),
        fatal_count=report.counts_by_severity.get(DatasetValidationSeverity.FATAL.value, 0),
        info_count=report.counts_by_severity.get(DatasetValidationSeverity.INFO.value, 0),
        error_count=report.counts_by_severity.get(DatasetValidationSeverity.ERROR.value, 0),
        validation_duration_micros=report.duration_micros,
        completeness=manifest.completeness,
        events_per_symbol=per_symbol,
        events_per_kind=per_kind,
    )
