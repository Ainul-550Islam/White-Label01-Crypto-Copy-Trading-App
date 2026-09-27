"""Binance public historical data: the first real historical source.

Everything about this adapter follows from one fact - the archive at
``data.binance.vision`` is *public, signed-offline data with no credentials*.
There is no API key here, no secret, no signing, and none may be added: a
historical dataset is by definition non-sensitive (it is the tape), and an
adapter that could hold a trading credential is one phishing email away from
leaking it into a dataset label. If Binance ever moves these files behind
authentication, the correct response is a different adapter with a different
security story, not a key parameter on this one.

The two shapes this reads:

* ``spot/daily/aggTrades/<VENUE>/<VENUE>-aggTrades-<date>.zip`` - the
  aggregate-trade tape, the one historical stream whose events map onto a
  canonical ``PublicTrade`` without loss (ids, prices, quantities, side,
  millisecond timestamps, all venue-confirmed);
* ``spot/daily/klines/<VENUE>/1m/<VENUE>-1m-<date>.zip`` - one-minute
  candles, which map onto ``Candle`` and give backtests a low-resolution
  stream for long windows without the byte cost of the full tape.

Order-book history is *not* offered by this archive. That is stated in the
exception this class raises rather than approximated: a book rebuilt from
sparse candles is neither a book nor sparse, and a validation suite that
checks sequence numbers would be grading its own homework. Book datasets
arrive through stream capture (Part 3's live feed, persisted) - which has
real sequence semantics - or a future venue that publishes genuine depth
deltas.

Both shapes are zipped CSVs. The CSVs come in two header eras; both are
handled by *reading the header line itself*, not by counting the release
month, because the header is present in the file and an assumption about file
names is not. Parsing lives in module-level pure functions so the unit tests
feed strings, not sockets - normal tests in this repository never reach a
network.

The fetcher is injected: tests pass a dict-backed callable, the CLI passes
one backed by ``urllib``. Nothing here decides policy; only the caller does.
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from wlct_trading.backtest.dataset import MarketEvent
from wlct_trading.datasets.ingestion.base import (
    HistoricalDataSource,
    IngestionRequest,
    SourceFileDescriptor,
    SourceRecord,
    validate_source_label,
)
from wlct_trading.datasets.schema import DatasetFormatError
from wlct_trading.enums import (
    ExchangeId,
    HistoricalSourceKind,
    MarketEventKind,
    MarketType,
    OrderSide,
)
from wlct_trading.market_data import Candle, PublicTrade

__all__ = [
    "BinanceVisionSource",
    "BinanceFetchError",
    "parse_agg_trades_csv",
    "parse_klines_rows",
    "venue_symbol",
    "dates_in_window",
]

_MICROS_PER_MILLI = 1_000
_DAY_MICROS = 86_400_000_000
_MAX_ZIP_MEMBER_BYTES = 512 * 1024 * 1024


class BinanceFetchError(RuntimeError):
    """A fetch failure. Carries no body: response bodies can contain venue
    request ids that tie a download to an account context, and logs of
    ingestion must not become account telemetry."""


def venue_symbol(symbol: str) -> str:
    """``BTC-USDT`` -> ``BTCUSDT``. The only mapping rule Binance needs."""
    return symbol.replace("-", "").upper()


def dates_in_window(start_micros: int, end_micros: int) -> tuple[date, ...]:
    """Every UTC calendar day the window touches, ascending and inclusive."""
    first = datetime.fromtimestamp(start_micros / 1_000_000, tz=timezone.utc).date()
    last = datetime.fromtimestamp(end_micros / 1_000_000, tz=timezone.utc).date()
    days: list[date] = []
    current = first
    while current <= last:
        days.append(current)
        current += timedelta(days=1)
    return tuple(days)


# -- pure parsers ------------------------------------------------------------------
def parse_agg_trades_csv(
    text: str, *, exchange: ExchangeId, symbol: str
) -> list[MarketEvent]:
    """One aggTrades CSV body to canonical TRADE events, in file order.

    ``is_best_match`` is inverted from intuition: ``true`` means the *buyer*
    was the maker, so the aggressor - the side that crossed - is SELL. The
    inversion lives here because it is venue vocabulary; nothing downstream
    should ever learn it.
    """
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if header is None:
        return []
    columns = [column.strip().lower() for column in header]
    named = "agg_trade_id" in columns
    events: list[MarketEvent] = []
    for row in reader:
        if not row or all(not cell.strip() for cell in row):
            continue
        if named:
            record = dict(zip(columns, (cell.strip() for cell in row)))
            trade_id = record.get("agg_trade_id", "")
            price = record.get("price", "")
            quantity = record.get("quantity", "")
            timestamp = record.get("transact_time", "")
            best_match = record.get("is_best_match", "")
        else:  # pre-2025 headerless era: id, price, qty, first_id, last_id, time, best
            trade_id, price, quantity, _, _, timestamp, best_match = (
                row[0],
                row[1],
                row[2],
                row[3],
                row[4],
                row[5],
                row[6] if len(row) > 6 else "false",
            )
        if not trade_id or not price or not quantity or not timestamp:
            raise DatasetFormatError(
                f"aggTrades row is missing an id, price, quantity or timestamp for {symbol}; "
                "refusing to invent the gap."
            )
        try:
            millis = int(timestamp)
        except ValueError as exc:
            raise DatasetFormatError(f"aggTrades timestamp {timestamp!r} is not an integer.") from exc
        price_decimal = Decimal(price)
        quantity_decimal = Decimal(quantity)
        aggressor = OrderSide.SELL if best_match.lower() == "true" else OrderSide.BUY
        payload = PublicTrade(
            exchange=exchange,
            symbol=symbol,
            trade_id=str(trade_id),
            price=price_decimal,
            quantity=quantity_decimal,
            aggressor_side=aggressor,
            exchange_timestamp=millis * _MICROS_PER_MILLI,
            received_timestamp=millis * _MICROS_PER_MILLI,
        )
        events.append(
            MarketEvent(
                kind=MarketEventKind.TRADE,
                timestamp_micros=millis * _MICROS_PER_MILLI,
                payload=payload,
                sequence=int(trade_id) if str(trade_id).isdigit() else len(events),
            )
        )
    return events


def parse_klines_rows(
    rows: list[list[str]], *, exchange: ExchangeId, symbol: str, interval: str
) -> list[MarketEvent]:
    """Kline rows to canonical CANDLE events, in file order.

    Binance's daily klines export identifies each row by the open time in
    milliseconds carried in the row itself; header presence varies by era, so
    the caller hands this function already-split rows and there is no era
    guessing left inside the parser.
    """
    events: list[MarketEvent] = []
    for row in rows:
        if len(row) < 9:
            raise DatasetFormatError(f"Kline row is short: {row!r}")
        open_ms = int(row[0])
        close_ms = int(row[6])
        payload = Candle(
            exchange=exchange,
            symbol=symbol,
            interval=interval,
            open_time=open_ms * _MICROS_PER_MILLI,
            close_time=close_ms * _MICROS_PER_MILLI,
            open=Decimal(row[1]),
            high=Decimal(row[2]),
            low=Decimal(row[3]),
            close=Decimal(row[4]),
            volume=Decimal(row[5]),
            trade_count=int(row[8]) if str(row[8]).isdigit() else 0,
            is_closed=True,
            received_timestamp=open_ms * _MICROS_PER_MILLI,
        )
        events.append(
            MarketEvent(
                kind=MarketEventKind.CANDLE,
                timestamp_micros=payload.close_time,
                payload=payload,
                sequence=open_ms,
            )
        )
    return events


def _unzip_member(zip_bytes: bytes, *, want_name_hint: str) -> str:
    try:
        archive = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as exc:
        raise BinanceFetchError(f"Downloaded archive is not a readable zip ({want_name_hint}).") from exc
    with archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if len(names) != 1:
            raise BinanceFetchError(
                f"Expected exactly one CSV member in the archive for {want_name_hint}; found {len(names)}."
            )
        info = archive.getinfo(names[0])
        if info.file_size > _MAX_ZIP_MEMBER_BYTES:
            raise BinanceFetchError(
                f"Archive member for {want_name_hint} declares {info.file_size} bytes, above the "
                "bounded-expansion ceiling; refusing to decompress it."
            )
        with archive.open(names[0]) as member:
            decompressed = member.read(_MAX_ZIP_MEMBER_BYTES + 1)
        if len(decompressed) > _MAX_ZIP_MEMBER_BYTES:
            raise BinanceFetchError(f"Archive member for {want_name_hint} exceeded the ceiling while reading.")
        return decompressed.decode("utf-8")


# -- the source ----------------------------------------------------------------------
@dataclass(slots=True, frozen=True)
class BinanceVisionSource(HistoricalDataSource):
    """Public Binance daily archives: aggTrades tape and 1m klines.

    ``fetch`` maps a full object URL to its bytes. The production CLI injects
    an ``urllib``-backed function; tests inject a table. No header, no auth,
    no query secrets - a public object store read.
    """

    base_url: str = "https://data.binance.vision"
    fetch: Callable[[str], bytes] | None = None
    kline_interval: str = "1m"
    _validated_label: str = field(default="", init=False, repr=False)

    def __post_init__(self) -> None:
        if self.base_url.endswith("/"):
            object.__setattr__(self, "base_url", self.base_url[:-1])
        if any(char in self.base_url for char in ("@", "?", "#")):
            raise DatasetFormatError(
                "The vision base URL must be a bare origin: query strings and "
                "userinfo have no business in a public archive endpoint, and "
                "refusing them here keeps credentials out of logs and manifests."
            )
        object.__setattr__(self, "_validated_label", validate_source_label(f"{self.base_url}/spot/daily"))

    @property
    def kind(self) -> HistoricalSourceKind:
        return HistoricalSourceKind.BINANCE_PUBLIC_DATA

    @property
    def label(self) -> str:
        return str(self._validated_label)

    def plan(self, request: IngestionRequest) -> tuple[SourceFileDescriptor, ...]:
        if request.exchange is not ExchangeId.BINANCE:
            raise DatasetFormatError(
                f"{request.exchange.value} is not a Binance; the vision archive adapter "
                "is venue-specific on purpose."
            )
        if request.market_type is not MarketType.SPOT:
            raise DatasetFormatError(
                "This adapter reads the spot archive only. Futures paths exist, but their "
                "files differ in shape per contract type, and pretending otherwise would "
                "label untested parsing as supported."
            )
        if MarketEventKind.BOOK_SNAPSHOT in request.kinds or MarketEventKind.BOOK_DELTA in request.kinds:
            raise DatasetFormatError(
                "Binance's public archive publishes no order-book history. Book datasets "
                "come from stream capture or a venue that publishes genuine depth deltas - "
                "never from a reconstruction, which would validate beautifully and mean "
                "nothing."
            )
        allowed_kinds = {MarketEventKind.TRADE, MarketEventKind.CANDLE}
        unsupported = set(request.kinds) - allowed_kinds
        if unsupported:
            raise DatasetFormatError(
                "This adapter supports TRADE and CANDLE streams; asked for "
                f"{sorted(kind.value for kind in unsupported)}."
            )
        descriptors: list[SourceFileDescriptor] = []
        for day in dates_in_window(request.start_micros, request.end_micros):
            for symbol in request.symbols:
                venue = venue_symbol(symbol)
                if MarketEventKind.TRADE in request.kinds:
                    descriptors.append(
                        SourceFileDescriptor(
                            source_key=f"spot/daily/aggTrades/{venue}/{venue}-aggTrades-{day.isoformat()}.zip",
                            symbol=symbol,
                            kind=MarketEventKind.TRADE,
                            date=day.isoformat(),
                            optional=True,
                        )
                    )
                if MarketEventKind.CANDLE in request.kinds:
                    descriptors.append(
                        SourceFileDescriptor(
                            source_key=(
                                f"spot/daily/klines/{venue}/{self.kline_interval}/"
                                f"{venue}-{self.kline_interval}-{day.isoformat()}.zip"
                            ),
                            symbol=symbol,
                            kind=MarketEventKind.CANDLE,
                            date=day.isoformat(),
                            optional=True,
                        )
                    )
        descriptors.sort(key=lambda item: (item.symbol, item.kind.value, item.date, item.source_key))
        return tuple(descriptors)

    def stream(
        self, descriptor: SourceFileDescriptor, request: IngestionRequest
    ) -> Iterator[SourceRecord]:
        if self.fetch is None:
            raise BinanceFetchError(
                "This source was constructed without a fetcher; production callers "
                "inject one (the CLI uses urllib, tests use a table). No default is "
                "intentional: an adapter that reaches the network *by default* makes "
                "offline-by-accident impossible to test for."
            )
        url = f"{self.base_url}/data/{descriptor.source_key}"
        payload = self.fetch(url)
        text = _unzip_member(payload, want_name_hint=descriptor.source_key)
        if descriptor.kind is MarketEventKind.TRADE:
            events = parse_agg_trades_csv(text, exchange=request.exchange, symbol=descriptor.symbol)
        else:
            rows = _kline_rows(text)
            events = parse_klines_rows(
                rows, exchange=request.exchange, symbol=descriptor.symbol, interval=self.kline_interval
            )
        for event in events:
            raw = None
            if request.retain_raw:
                raw = _line_for_event(event)
            yield SourceRecord(event=event, raw_text=raw)

    def metadata(self) -> dict[str, str]:
        return {"archive": "binance-public-data", "transport": "https", "credentials": "none"}


def _kline_rows(text: str) -> list[list[str]]:
    """Split klines CSV, dropping the header when the first cell names it.

    The header check is by *content* ("open time" in the first cell), not by
    row count or file age: present is present, and a parser that consults the
    file rather than folklore about it cannot go stale when the venue changes
    formats.
    """
    reader = csv.reader(io.StringIO(text))
    rows: list[list[str]] = []
    for row in reader:
        if not row or all(not cell.strip() for cell in row):
            continue
        first = row[0].strip().lower()
        if not rows and ("open" in first and "time" in first):
            continue
        rows.append(row)
    return rows


def _line_for_event(event: MarketEvent) -> str:
    from wlct_trading.datasets.schema import event_to_line

    return event_to_line(event)
