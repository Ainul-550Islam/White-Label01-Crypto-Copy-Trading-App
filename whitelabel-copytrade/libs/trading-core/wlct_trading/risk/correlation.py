"""Manually defined correlation groups. Extensible by design, not by guesswork.

Part 8 explicitly does **not** build a statistical correlation engine. A
rolling correlation matrix computed from the very market data that might be
stale is a feedback loop wearing a mathematician's costume: during the
liquidations it would exist to prevent, its inputs are exactly what break.
Until a correlation *model* exists as its own reviewed component, the honest
capability is a human-curated grouping: an operator states "BTC and ETH are
one risk bucket on this account", and the engine enforces that statement.

The abstraction below is what a future statistical provider must satisfy:
:meth:`CorrelationGroupRegistry.groups_for` answers "which groups does this
symbol belong to", and the exposure calculator treats every returned group as
one notional bucket. Replacing the manual table with a model is a change of
registry construction, not of gate logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

__all__ = ["CorrelationGroup", "CorrelationGroupRegistry", "CorrelationGroupError"]


class CorrelationGroupError(ValueError):
    """Raised for a malformed group definition (never silently dropped)."""


@dataclass(slots=True, frozen=True)
class CorrelationGroup:
    """One operator-declared shared-risk bucket.

    ``max_notional`` is the group-level exposure ceiling. It is *not* the
    sum of member limits and must be configured explicitly when tighter;
    leaving it ``None`` means the group only documents the relationship, which
    is legal - a group without a ceiling constrains nothing but is still
    reported in exposure views so operators see the aggregation.
    """

    name: str
    exchange: str
    members: frozenset[str]
    max_notional: Decimal | None = None
    #: Human rationale, surfaced in every exposure view. "Why are these one
    #: bucket?" is the first question an auditor asks, and the answer should
    #: travel with the group rather than live in a wiki.
    rationale: str = ""

    def __post_init__(self) -> None:
        if not self.name or any(ch.isspace() for ch in self.name):
            raise CorrelationGroupError(
                "Group name must be non-empty and whitespace-free."
            )
        if not self.exchange:
            raise CorrelationGroupError(f"Group {self.name} needs an exchange.")
        if len(self.members) < 2:
            raise CorrelationGroupError(
                f"Group {self.name} needs at least two member symbols; a "
                "single-symbol group is just a symbol limit with extra steps."
            )
        if self.max_notional is not None and self.max_notional <= 0:
            raise CorrelationGroupError(
                f"Group {self.name} max_notional must be positive when set."
            )

    def contains(self, symbol: str) -> bool:
        return symbol in self.members


class CorrelationGroupRegistry:
    """Immutable, deterministic view over the configured groups.

    Two groups may overlap (BTC in {BTC,ETH} and in {BTC,ETH,SOL}); the
    engine enforces *every* applicable ceiling, so overlap is a legitimate
    modelling choice and no merge logic is attempted here.
    """

    __slots__ = ("_groups", "_by_symbol")

    def __init__(self, groups: tuple[CorrelationGroup, ...] = ()) -> None:
        names = [group.name for group in groups]
        duplicates = {name for name in names if names.count(name) > 1}
        if duplicates:
            raise CorrelationGroupError(
                f"Duplicate correlation group names: {sorted(duplicates)}."
            )
        self._groups = tuple(sorted(groups, key=lambda g: (g.exchange, g.name)))
        index: dict[tuple[str, str], list[CorrelationGroup]] = {}
        for group in self._groups:
            for symbol in sorted(group.members):
                index.setdefault((group.exchange, symbol.upper()), []).append(group)
        self._by_symbol: dict[tuple[str, str], tuple[CorrelationGroup, ...]] = {
            key: tuple(value) for key, value in index.items()
        }

    @property
    def groups(self) -> tuple[CorrelationGroup, ...]:
        return self._groups

    def __len__(self) -> int:
        return len(self._groups)

    def groups_for(self, exchange: str, symbol: str) -> tuple[CorrelationGroup, ...]:
        """Every group ``symbol`` belongs to on ``exchange``, in stable order."""
        return self._by_symbol.get((exchange, symbol.upper()), ())

    def symbols_in(self, group_name: str) -> frozenset[str]:
        for group in self._groups:
            if group.name == group_name:
                return group.members
        raise CorrelationGroupError(f"Unknown correlation group {group_name!r}.")
