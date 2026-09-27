"""Binance-side evidence for the authenticated placement review (Part 16).

The review's law lives in
:mod:`wlct_trading.execution.placement_review` and knows nothing about any venue;
this module is the Binance gatherer that feeds it, and it is the only module in
the repository that names a Binance endpoint *for the purpose of deciding
whether to trade*. Everything else that asks for the same data is doing a
different job: :meth:`BinanceAccountAdapter.fetch_account` answers "what does
this account hold", :meth:`BinanceMarketDataAdapter.load_symbols` answers "what
are this instrument's rules". This module answers "may this key place this order
on this symbol right now", and the difference matters because the answer is a
permission, not a snapshot.

What it asks, and what each answer is for
----------------------------------------

``GET /sapi/v1/account/apiRestrictions`` (SAPI weight 1)
    The key's own entitlements: ``enableSpotAndMarginTrading``,
    ``enableWithdrawals``, ``enableReading``, ``ipRestrict``, ``createTime`` and
    ``tradingAuthorityExpirationTime``. This is the only endpoint that reports
    the *key* rather than the account, which is why the review's strongest
    claims come from here.

``GET /api/v3/account`` (spot weight 20), only when an account reader is wired
    The account-level switch ``canTrade`` and the ``accountType``. A key can be
    perfect on an account the venue has shut to trading; the reverse is equally
    true, so both are consulted and the stricter answer wins.

the deployment's instrument catalog
    Whether the symbol is listed and in the ``TRADING`` phase. Read through an
    injected lookup rather than by fetching ``exchangeInfo`` here: the market
    adapter already owns that fetch, already spends the 20 units of weight for
    it, and already runs it before any order (see its own docstring). A second
    fetcher in the review path would be a second, differently-cached copy of the
    same authority, which is how a review comes to disagree with the order it is
    supposed to be describing.

What it refuses to claim
------------------------

Nothing here is inferred. A field the venue did not send stays ``None`` on
:``PlacementFacts``, and law 5 of the review decides what silence means - which
for a venue-backed attestation is a refusal on exactly the fields where silence
is not reassuring (the non-custodial withdrawal rule) and a recorded warning on
the ones where it is (key rotation). The gatherer does not pre-empt that
judgement by inventing a default, and it does not soften it by reporting a parse
failure as a "no": a malformed payload is raised as
:``ReviewCode.MALFORMED_VENUE_RESPONSE``, which says "we could not read the
answer" rather than "the answer was no".

Two rules this module exists to enforce
---------------------------------------

*Withdrawals are decided by the union of sources.* If the key says it can
withdraw, or the account says it can, ``withdrawal_permitted`` becomes ``True``.
Taking the SAPI answer alone would let an account-level permission read as
"safe", and this platform is non-custodial: the order that moves funds off the
exchange is the one order this codebase will never place, from any key, for any
reason.

*Binance's ``0`` is not the 1970s.* ``tradingAuthorityExpirationTime`` is
documented as ``0`` when the authority does not expire, and a naive
``int * 1000 <= now`` comparison would read every non-expiring key as expired
since 1970 - a refusal that no operator could explain from the venue's console.
Zero therefore becomes ``None``: "the venue says this never expires".
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Final, Protocol

from wlct_trading.clock import epoch_micros
from wlct_trading.execution.placement_attestor import (
    AttestationFailure,
    PlacementAttestation,
    SymbolEvidence,
    PlacementAttestor,
    PlacementFacts,
    PlacementReviewRequest,
    SymbolFacts,
    symbol_evidence,
)
from wlct_trading.execution.placement_review import ReviewCode

from .parsers import BinanceParseError
from .trading import BinanceTradingAdapter

__all__ = [
    "AccountFlagReader",
    "BINANCE_REVIEW_SOURCE",
    "BinancePlacementAttestor",
    "KeyEvidence",
    "SymbolRegistry",
    "VenueAccountFlags",
    "exchange_info_symbol_facts",
    "key_evidence_from_restrictions",
    "symbol_facts_from_market",
]

logger = logging.getLogger(__name__)

#: The prefix of every provenance label this gatherer produces. Surfaces in
#: ``PlacementFacts.source``, in the review's log line and in the operator
#: console's wiring view, and it is a prefix rather than a constant because the
#: suffix has to say which endpoints this particular deployment actually
#: consulted - a label that claimed ``+account`` when no account reader was
#: configured would mislead exactly the reader trying to diagnose a refusal.
BINANCE_REVIEW_SOURCE: Final[str] = "binance:apiRestrictions"


@dataclass(frozen=True, slots=True)
class KeyEvidence:
    """What ``apiRestrictions`` said about the key, with silence kept as silence.

    Every field is ``bool | None`` or ``int | None`` because that is the shape of
    the venue's answer: a response missing ``enableWithdrawals`` is not a
    response saying withdrawals are off, and the two must stay distinguishable
    all the way into the review. This is why the evidence is a dataclass of
    optional fields rather than a permissive dict with defaults.
    """

    trading_permitted: bool | None
    withdrawals_permitted: bool | None
    reading_permitted: bool | None
    ip_allowlist_enabled: bool | None
    created_at_millis: int | None
    trading_authority_expires_at_millis: int | None

    def to_public_dict(self) -> dict[str, object]:
        """The evidence without any secret material - which is all of it.

        Nothing in this class is sensitive: ``apiRestrictions`` returns flags and
        timestamps, never the key. The method exists so a ``/status`` view can
        show an operator what the gatherer saw, because "the review refused" is a
        much shorter argument when the console already displays the venue's own
        answer next to it.
        """
        return {
            "tradingPermitted": self.trading_permitted,
            "withdrawalsPermitted": self.withdrawals_permitted,
            "readingPermitted": self.reading_permitted,
            "ipAllowlistEnabled": self.ip_allowlist_enabled,
            "createdAtMillis": self.created_at_millis,
            "tradingAuthorityExpiresAtMillis": self.trading_authority_expires_at_millis,
        }


@dataclass(frozen=True, slots=True)
class VenueAccountFlags:
    """The three account-level answers the review consumes.

    A narrow projection of ``VenueAccount`` on purpose: the review has no use for
    balances, and importing a balance snapshot into a permission check is how a
    refactor one day ends with a money field in an audit payload.
    """

    can_trade: bool | None
    can_withdraw: bool | None
    account_type: str | None


class SymbolRegistry(Protocol):
    """Anything that can answer "what do you know about this symbol?".

    Declared here rather than imported from the market adapter so the gatherer
    can be fed a cached, read-restricted or test-local registry - and so the
    attribute access below is checked instead of suppressed. The only member
    needed is the one the review asks about; a wider interface here would let a
    deployment pass a whole market adapter and then reach into it from a
    permission check.
    """

    def specification(self, symbol: str) -> object:
        ...


class AccountFlagReader(Protocol):
    """Anything that can answer ``/api/v3/account``-shaped questions.

    :class:`~wlct_trading.exchanges.binance.trading.BinanceAccountAdapter`
    satisfies it. It is a protocol rather than an import of that class so a
    deployment can supply a cached or read-restricted implementation - and so this
    module does not acquire a second construction path for the same adapter
    simply to name its type.
    """

    async def fetch_account(
        self, tenant_id: str, account_id: str
    ) -> object:  # pragma: no cover - protocol
        ...


def _optional_flag(payload: Mapping[str, object], name: str) -> bool | None:
    """Read a JSON boolean, keeping absence and nonsense as ``None``.

    Binance serves these as real JSON booleans, but a truthy-shaped surprise
    (``0``/``1``) is accepted because that is what an intermediary proxy has been
    known to produce. Anything else is *unknown*, not false: an unknown field
    costs this deployment one refused order while it is being investigated, and a
    wrongly-false ``enableWithdrawals`` would wave an order through on a key that
    can empty the account.
    """
    if name not in payload:
        return None
    raw = payload[name]
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, int) and not isinstance(raw, bool):
        return bool(raw)
    return None


def _optional_millis(payload: Mapping[str, object], name: str) -> int | None:
    """Read an epoch-milliseconds field, treating Binance's ``0`` as "no value".

    ``tradingAuthorityExpirationTime`` is ``0`` for a key whose authority does not
    expire. Read literally that is 1970, which is in the past, which would refuse
    every order from every non-expiring key - the kind of bug that presents as a
    venue outage and is really a unit error. Strings are accepted because
    ``HttpResponse.json`` parses floats as ``str`` to protect precision, and a
    venue that ever moves this field to a string must not silently become
    "unknown" here.
    """
    if name not in payload:
        return None
    raw = payload[name]
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str):
        try:
            value = int(raw)
        except ValueError:
            return None
    else:
        return None
    return value if value > 0 else None


def key_evidence_from_restrictions(payload: Mapping[str, object]) -> KeyEvidence:
    """Map ``/sapi/v1/account/apiRestrictions`` onto the review's key questions.

    The field-by-field comments below are the whole value of this function: each
    one is the venue's name for a concept the review has its own name for, and
    the mapping between the two is where a silent misreading would live.
    """
    if not isinstance(payload, Mapping):
        raise BinanceParseError(
            "Binance apiRestrictions did not return an object; nothing can be "
            "attested about this key."
        )
    return KeyEvidence(
        # The key's permission to place spot orders. ``enableMargin`` and
        # ``enableFutures`` are deliberately not consulted: this platform trades
        # spot, and a key that may trade futures may not place a spot order.
        trading_permitted=_optional_flag(payload, "enableSpotAndMarginTrading"),
        # The non-custodial rule. ``enableInternalTransfer`` and
        # ``permitsUniversalTransfer`` are NOT folded in here even though they can
        # also move value, because the review's rule is about withdrawals from
        # the exchange and reads ``withdrawal_permitted``; the extra abilities are
        # reported in ``collection_detail``-adjacent log lines instead of
        # silently widening a blocking code's meaning.
        withdrawals_permitted=_optional_flag(payload, "enableWithdrawals"),
        # Reading is what this gatherer itself needs, and a key that cannot read
        # cannot be attested: the review downgrades this to a warning rather than
        # a refusal, because an unreadable key is a data problem, not a licence.
        reading_permitted=_optional_flag(payload, "enableReading"),
        # ``ipRestrict`` is Binance's name for "this key only answers to the
        # allowlist". The platform requires it, so ``False`` here is a refusal
        # regardless of everything else that is true about the key.
        ip_allowlist_enabled=_optional_flag(payload, "ipRestrict"),
        created_at_millis=_optional_millis(payload, "createTime"),
        trading_authority_expires_at_millis=_optional_millis(
            payload, "tradingAuthorityExpirationTime"
        ),
    )


def _account_flags(account: object) -> VenueAccountFlags:
    """Project a ``VenueAccount``-shaped object, attribute by attribute.

    Guarded with ``getattr`` for the same reason the local gatherer guards its
    credential reads: the injected reader may return a cached copy, a test stub or
    a wrapper, and an attribute that is missing must read as "unknown" instead of
    raising inside a review that is trying to report a venue problem.
    """
    can_trade = getattr(account, "can_trade", None)
    can_withdraw = getattr(account, "can_withdraw", None)
    account_type = getattr(account, "account_type", None)
    return VenueAccountFlags(
        can_trade=can_trade if isinstance(can_trade, bool) else None,
        can_withdraw=can_withdraw if isinstance(can_withdraw, bool) else None,
        account_type=None if account_type is None else str(account_type).upper(),
    )


def _str_list(raw: object) -> tuple[str, ...]:
    if isinstance(raw, str):
        return (raw.upper(),)
    if isinstance(raw, (list, tuple)):
        return tuple(str(item).upper() for item in raw)
    return ()


def exchange_info_symbol_facts(
    payload: Mapping[str, object],
) -> Callable[[str], SymbolFacts | None]:
    """Build a symbol lookup from Binance's own ``exchangeInfo`` payload.

    Returns the four-tuple the review consumes: listed, trading, order types, and
    - always empty - time-in-forces. The empty third slot is not an oversight and
    must not be "fixed" by inventing a rule: Binance publishes per-symbol
    ``orderTypes`` but no per-symbol time-in-force list for spot (a disallowed
    ``timeInForce`` is rejected per order, with ``-2010``), so the honest answer
    to "does this symbol accept GTC" from venue metadata alone is "the venue does
    not say". ``symbol_evidence`` maps an empty list to ``None`` for exactly this
    reason, and the review's law 5 treats that as unasserted rather than refused.

    Two answers are different and are kept apart here on purpose: a payload with
    no ``symbols`` at all has not been loaded, so the lookup returns ``None`` and
    the review asserts nothing; a loaded catalog that lacks the symbol knows
    something, so it returns "not attached" and the review refuses the order.
    Collapsing the two would turn a cold start into a venue-side denial.

    ``isSpotTradingAllowed`` is honoured alongside ``status``: a symbol in the
    ``TRADING`` phase that this account's spot permissions exclude is not a symbol
    this platform may trade, and the venue's own guidance is to check both.
    """
    entries = payload.get("symbols") if isinstance(payload, Mapping) else None
    by_symbol: dict[str, SymbolFacts] = {}
    if isinstance(entries, (list, tuple)):
        for entry in entries:
            if not isinstance(entry, Mapping):
                continue
            # ``strip`` before the emptiness test: a catalog entry whose symbol is
            # "  " is not a symbol, and registering it would make the catalog look
            # loaded - which is precisely the state in which an unlisted symbol is
            # refused as SYMBOL_UNATTACHED. A malformed payload would then be read
            # as "this exchange lists nothing" and every order would be denied.
            venue_symbol = str(entry.get("symbol", "")).strip().upper()
            if not venue_symbol:
                continue
            by_symbol[venue_symbol] = (
                True,
                str(entry.get("status", "")).upper() == "TRADING"
                and entry.get("isSpotTradingAllowed", True) is not False,
                _str_list(entry.get("orderTypes")),
                (),
            )

    def lookup(symbol: str) -> SymbolFacts | None:
        if not by_symbol:
            # Nothing loaded: no claim either way.
            return None
        venue_symbol = str(symbol).upper().replace("/", "").replace("-", "")
        found = by_symbol.get(venue_symbol)
        if found is None:
            # A populated exchangeInfo that does not contain the symbol has
            # answered the question, and its answer is "not listed": reported as
            # such, so the review refuses with SYMBOL_UNATTACHED instead of
            # quietly asserting nothing about a symbol the venue rejected.
            return (False, False, (), ())
        return found

    return lookup


def symbol_facts_from_market(market: SymbolRegistry) -> Callable[[str], SymbolFacts | None]:
    """Adapt a market adapter's ``specification(symbol)`` into a review lookup.

    The cheap wiring: no extra weight, no second fetch, and the same authoritative
    "listed?" answer, because the market adapter's registry is populated by
    ``load_symbols()`` - which runs before any subscription or order precisely so
    that symbol translation is not a guess.

    It reports empty capability lists, because :class:`SymbolSpecification`
    carries tick size, step and ``is_tradeable`` and not Binance's ``orderTypes``.
    A symbol the registry does not know is reported as *not attached*, which
    refuses the order: a catalog that has not loaded yet would then refuse
    everything, which is the wrong direction to be wrong in only for as long as it
    takes to load, and it is loud in the audit as ``SYMBOL_UNATTACHED``. A
    deployment that must not have that window should wire
    :func:`exchange_info_symbol_facts` with its own cached payload instead.
    """

    def lookup(symbol: str) -> SymbolFacts | None:
        specification = market.specification(symbol)
        if specification is None:
            # "not in the registry" is an assertion for a registry that has been
            # populated, and ``load_symbols()`` populates it wholesale or raises;
            # there is no partial-registry state to hedge about.
            return (False, False, (), ())
        return (
            True,
            bool(getattr(specification, "is_tradeable", False)),
            (),
            (),
        )

    return lookup


class BinancePlacementAttestor(PlacementAttestor):
    """Gathers the venue's answers, in one review, about one (account, symbol).

    ``adapter`` is the deployment's
    :class:`~wlct_trading.exchanges.binance.trading.BinanceTradingAdapter`: it is
    reused rather than replaced by a second signed client because the review must
    share the adapter's credential provider, its clock synchronisation and -
    critically - its rate-limit budget. A separate client with its own
    :class:`RateLimitRegistry` would spend weight the deployment never
    accounted for, and the venue's 429 would arrive as a review failure on the
    way to an order that never went out.

    ``account_reader`` is optional; without it ``account_can_trade`` and
    ``account_type`` stay unknown, which the review reads as "not asserted" and
    the key-level permission still answers. That is a deliberate degradation:
    20 units of weight per review is a real budget cost, and an operator who
    wants the account switch checked passes the reader and gets it checked.
    """

    __slots__ = ("_adapter", "_account_reader", "_symbol_facts", "_clock", "_source")

    def __init__(
        self,
        *,
        adapter: BinanceTradingAdapter,
        account_reader: AccountFlagReader | None = None,
        symbol_facts: Callable[[str], SymbolFacts | None] | None = None,
        clock: Callable[[], int] = epoch_micros,
    ) -> None:
        self._adapter = adapter
        self._account_reader = account_reader
        self._symbol_facts = symbol_facts
        self._clock = clock
        # Named after what was consulted, so the audit line cannot claim an
        # endpoint this deployment never wired.
        parts = [BINANCE_REVIEW_SOURCE]
        if account_reader is not None:
            parts.append("account")
        if symbol_facts is not None:
            parts.append("exchangeInfo")
        self._source = "+".join(parts)

    @property
    def source(self) -> str:
        return self._source

    async def attest(
        self, request: PlacementReviewRequest
    ) -> PlacementAttestation:
        """One review's worth of Binance calls: one, or two with an account reader.

        No retry loop lives here. The venue's ``-1003`` answers (429/418) are
        already handled at the adapter boundary, and a review that silently retried
        would both hide an outage and double the weight cost of asking permission.
        """
        now = self._clock()
        restrictions = await self._restrictions(request)
        evidence = key_evidence_from_restrictions(restrictions)
        reader = self._account_reader
        flags = None if reader is None else await self._account_flags(reader, request)
        symbol = self._symbol_evidence(request)
        withdrawal_permitted = self._strictest_withdrawal_answer(evidence, flags)
        facts = PlacementFacts(
            venue_backed=True,
            source=self._source,
            key_created_at_millis=evidence.created_at_millis,
            key_permission_granted=evidence.trading_permitted,
            withdrawal_permitted=withdrawal_permitted,
            read_permitted=evidence.reading_permitted,
            ip_allowlist_enabled=evidence.ip_allowlist_enabled,
            trading_authority_expires_at_millis=(
                evidence.trading_authority_expires_at_millis
            ),
            account_can_trade=None if flags is None else flags.can_trade,
            account_type=None if flags is None else flags.account_type,
            # The four symbol fields stay ``None`` (unasserted) when this
            # deployment wired no symbol source at all. That is different from a
            # source that answered "not listed", which sets ``symbol_attached``
            # False and is refused - the distinction lives in the lookup helpers
            # above and is preserved here rather than flattened.
            symbol_attached=None if symbol is None else symbol.symbol_attached,
            symbol_trading=None if symbol is None else symbol.symbol_trading,
            order_type_supported=(
                None if symbol is None else symbol.order_type_supported
            ),
            time_in_force_supported=(
                None if symbol is None else symbol.time_in_force_supported
            ),
            clock_skew_millis=self._adapter.clock_skew_millis,
            recv_window_millis=self._adapter.recv_window_ms,
            # ``key_expires_at_millis`` is left unset rather than guessed: Binance
            # keys do not expire, so there is no venue field for it, and the
            # review's ``KEY_EXPIRED`` code is reserved for a venue that does
            # answer that question.
            venue_trading_permitted=self._trading_established(evidence, flags, symbol),
            no_known_withdrawal_path=withdrawal_permitted is False,
            review_required_at_micros=now,
        )
        return PlacementAttestation(facts=facts, attested_at_micros=now)

    async def _restrictions(self, request: PlacementReviewRequest) -> Mapping[str, object]:
        try:
            payload = await self._adapter.fetch_key_restrictions(
                request.tenant_id, request.account_id
            )
        except BinanceParseError as error:
            # A payload that is not the shape the venue documents is reported as
            # an unreadable answer, never as a "no": the review's retryable codes
            # then tell the worker to ask again instead of telling an operator to
            # change a key that may be perfectly configured.
            raise _unreadable("apiRestrictions", error) from error
        return payload

    async def _account_flags(
        self, reader: AccountFlagReader, request: PlacementReviewRequest
    ) -> VenueAccountFlags:
        try:
            account = await reader.fetch_account(request.tenant_id, request.account_id)
        except BinanceParseError as error:
            raise _unreadable("account", error) from error
        return _account_flags(account)

    def _symbol_evidence(self, request: PlacementReviewRequest) -> SymbolEvidence | None:
        lookup = self._symbol_facts
        if lookup is None:
            return None
        try:
            found = lookup(request.symbol)
        except Exception as error:  # a catalog fault is not a refusal
            logger.warning(
                "placement.attestation.symbol_lookup_failed",
                extra={
                    "event": "placement.attestation.symbol_lookup_failed",
                    "symbol": request.symbol,
                    "error": f"{type(error).__name__}: {error}",
                },
            )
            return None
        if found is None:
            return None
        return symbol_evidence(
            found,
            order_type=request.order_type,
            time_in_force=request.time_in_force,
        )

    @staticmethod
    def _strictest_withdrawal_answer(
        evidence: KeyEvidence, flags: VenueAccountFlags | None
    ) -> bool | None:
        """Key and account are separate switches; either one being on is on.

        ``False`` requires the key itself to say no: a deployment without an
        account reader still gets a decisive answer from ``enableWithdrawals``,
        because that field is the key's own permission and the review is about the
        key. Conversely, an account that says it cannot withdraw does not make a
        silent key safe - only the key can answer for the key, so ``None`` from it
        stays ``None`` here and the review's law 5 turns that silence into a
        refusal.
        """
        key_answer = evidence.withdrawals_permitted
        account_answer = None if flags is None else flags.can_withdraw
        if key_answer is True or account_answer is True:
            return True
        if key_answer is False:
            return False
        return None

    @staticmethod
    def _trading_established(
        evidence: KeyEvidence,
        flags: VenueAccountFlags | None,
        symbol: SymbolEvidence | None,
    ) -> bool:
        """Whether *this* gatherer can say the venue permitted this order shape.

        ``venue_trading_permitted`` is the claim that lands in the durable audit
        record, so it is held to the strictest reading available: an explicit
        ``True`` on the key, no refusal from the account switch, and - when a
        symbol source was consulted - a symbol that is not being held. Anything
        less is not "no", but it is not a claim either, and an audit record that
        overstates what was established is the failure mode this whole module was
        written to avoid. It is recomputable from :class:`PlacementFacts`, which is
        why it is derived here instead of remembered from the previous review.
        """
        if evidence.trading_permitted is not True:
            return False
        if flags is not None and flags.can_trade is False:
            return False
        return symbol is None or symbol.symbol_trading is not False


def _unreadable(endpoint: str, error: Exception) -> Exception:
    """A gatherer's own classification, so the review does not have to guess.

    :class:`AttestationFailure` carries the code the review should record; the
    reviewer's fallback classifier would otherwise see a ``ValueError`` and
    report "unreachable", which sends an operator to the network when the real
    problem is that the venue's answer could not be read.
    """
    return AttestationFailure(
        ReviewCode.MALFORMED_VENUE_RESPONSE,
        f"{endpoint}: {type(error).__name__}: {error}",
    )
