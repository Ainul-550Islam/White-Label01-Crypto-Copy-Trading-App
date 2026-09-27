"""Walk-forward foundation.

This provides the *structure* for walk-forward evaluation - splitting a dataset
into training, validation and test windows and running the same strategy over
each - and deliberately stops there. There is no parameter search, no
optimiser and no machine learning in this module, because an optimiser that
selects the best of many parameter sets on the same data manufactures
overfitting, and shipping one without the surrounding discipline would be worse
than shipping none.

What the structure buys today: a run is labelled with the
:class:`~wlct_trading.enums.BacktestPhase` it belongs to, each window is a
separately checksummed dataset slice, and a result computed on a training
window can never be mistaken for one computed on the test window.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterator

from wlct_trading.backtest.dataset import HistoricalDataset
from wlct_trading.enums import BacktestPhase

__all__ = ["WalkForwardWindow", "WalkForwardSplit", "split_dataset", "rolling_windows"]

_ZERO = Decimal(0)
_ONE = Decimal(1)


@dataclass(slots=True, frozen=True)
class WalkForwardWindow:
    """One labelled time window and the dataset slice covering it."""

    phase: BacktestPhase
    start_micros: int
    end_micros: int
    dataset: HistoricalDataset

    @property
    def duration_micros(self) -> int:
        return self.end_micros - self.start_micros

    @property
    def event_count(self) -> int:
        return len(self.dataset)

    def to_dict(self) -> dict[str, object]:
        return {
            "phase": self.phase.value,
            "startMicros": self.start_micros,
            "endMicros": self.end_micros,
            "durationMicros": self.duration_micros,
            "eventCount": self.event_count,
            "datasetId": self.dataset.descriptor.dataset_id,
            "checksum": self.dataset.descriptor.checksum,
        }


@dataclass(slots=True, frozen=True)
class WalkForwardSplit:
    """A training/validation/test partition of one dataset.

    The three windows are contiguous and non-overlapping. Overlap would leak
    information from one phase into the next, which is the specific failure
    walk-forward analysis exists to avoid.
    """

    training: WalkForwardWindow
    validation: WalkForwardWindow
    test: WalkForwardWindow

    def windows(self) -> tuple[WalkForwardWindow, ...]:
        return (self.training, self.validation, self.test)

    @property
    def is_non_overlapping(self) -> bool:
        return (
            self.training.end_micros < self.validation.start_micros
            and self.validation.end_micros < self.test.start_micros
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "training": self.training.to_dict(),
            "validation": self.validation.to_dict(),
            "test": self.test.to_dict(),
            "isNonOverlapping": self.is_non_overlapping,
            "note": (
                "Window labels carry no statistical claim on their own. This "
                "module performs no parameter optimisation."
            ),
        }


def split_dataset(
    dataset: HistoricalDataset,
    *,
    training_fraction: Decimal = Decimal("0.6"),
    validation_fraction: Decimal = Decimal("0.2"),
) -> WalkForwardSplit:
    """Split a dataset by time into training, validation and test windows.

    Fractions are of the dataset's *time span*, not of its event count: an
    event-count split would put more wall-clock time in the quiet periods and
    make the windows incomparable.

    The test fraction is whatever remains, and must be positive - a split with
    no test window is not a walk-forward split.
    """
    if training_fraction <= _ZERO or validation_fraction <= _ZERO:
        raise ValueError("Walk-forward fractions must be positive.")
    test_fraction = _ONE - training_fraction - validation_fraction
    if test_fraction <= _ZERO:
        raise ValueError(
            "training_fraction + validation_fraction must leave a positive test "
            f"window; they sum to {training_fraction + validation_fraction}."
        )

    start = dataset.descriptor.start_micros
    end = dataset.descriptor.end_micros
    span = end - start
    if span <= 0:
        raise ValueError("Cannot split a dataset that spans no time.")

    training_end = start + int(Decimal(span) * training_fraction)
    validation_end = training_end + int(Decimal(span) * validation_fraction)

    training = WalkForwardWindow(
        phase=BacktestPhase.TRAINING,
        start_micros=start,
        end_micros=training_end,
        dataset=dataset.slice(start_micros=start, end_micros=training_end),
    )
    validation = WalkForwardWindow(
        phase=BacktestPhase.VALIDATION,
        start_micros=training_end + 1,
        end_micros=validation_end,
        dataset=dataset.slice(start_micros=training_end + 1, end_micros=validation_end),
    )
    test = WalkForwardWindow(
        phase=BacktestPhase.TEST,
        start_micros=validation_end + 1,
        end_micros=end,
        dataset=dataset.slice(start_micros=validation_end + 1, end_micros=end),
    )
    return WalkForwardSplit(training=training, validation=validation, test=test)


def rolling_windows(
    dataset: HistoricalDataset,
    *,
    window_micros: int,
    step_micros: int,
    phase: BacktestPhase = BacktestPhase.TEST,
) -> Iterator[WalkForwardWindow]:
    """Yield fixed-length windows advancing by ``step_micros``.

    The foundation for anchored or rolling walk-forward runs. Windows with no
    events are skipped rather than yielded empty, because a backtest over zero
    events produces metrics that are all ``None`` and would only add noise to a
    fold table.
    """
    if window_micros <= 0 or step_micros <= 0:
        raise ValueError("window_micros and step_micros must be positive.")

    start = dataset.descriptor.start_micros
    end = dataset.descriptor.end_micros
    cursor = start
    while cursor <= end:
        window_end = cursor + window_micros
        if window_end > end:
            window_end = end
        sliced = dataset.slice(start_micros=cursor, end_micros=window_end)
        if len(sliced) > 0:
            yield WalkForwardWindow(
                phase=phase,
                start_micros=cursor,
                end_micros=window_end,
                dataset=sliced,
            )
        if window_end >= end:
            break
        cursor += step_micros
