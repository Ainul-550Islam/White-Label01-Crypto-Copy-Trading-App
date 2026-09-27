"""The distributed risk-budget reservation ledger - the consistency model, stated.

The question this module exists for: two engine instances, one account, one
budget. Each reads a snapshot, each sees room, both approve, the venue sees
double the order. Snapshot-based ceiling checks cannot prevent it - they are
reads of shared state, and reads do not serialise. The answer is a
**check-and-reserve against the shared state itself**: before an approval
can flow through to submission, the exact budget it relied on must be
atomically consumed in Redis (or the in-process ledger), inside a script
that refuses if the consumption would cross a ceiling. Release happens on
terminal order events (fill applied to exposure, cancel, reject).

The consistency model, honestly named:

* **Within one Redis instance** the reserve step is atomic and serialized:
  two concurrent reservations cannot both cross a ceiling, because they
  cannot both execute the same Lua script at the same time. That is the
  guarantee the design claims.
* It is **not** linearizability across the whole system. The reserve and the
  venue submit are two steps; a crash between them leaves a reservation held
  until its TTL reclaims it (bounded over-reservation - conservative,
  intentional), and the fill that frees budget arrives asynchronously. The
  ledger therefore bounds *new approvals*, and the authoritative exposure
  remains the position/OMS state that later snapshots fold back in; a
  reservation that has been double-counted by the time the next snapshot
  lands is *automatically corrected*, because the next snapshot's exposure
  already includes the fill.
* If Redis is unreachable, reservation **denies**. A gate that cannot
  consume budget is a gate that must not approve risk-increasing orders;
  risk-reducing orders need no reservation and are unaffected. Unavailability
  degrades to "no new risk", never to "uncoordinated risk".

The in-process :class:`LocalReservationLedger` implements identical
semantics so paper trading, backtests and the test suite exercise the real
algorithm, not a stub - the projection rules above and the reservation rules
here are the same numbers from the same functions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Final, Mapping, Protocol

from wlct_trading.redis_keys import RedisKeys

__all__ = [
    "ReservationRequest",
    "ReservationTicket",
    "ReservationResult",
    "RiskReservationLedger",
    "LocalReservationLedger",
    "RedisRiskClient",
    "RedisReservationLedger",
    "RESERVATION_ACQUIRE_SCRIPT",
    "RESERVATION_RELEASE_SCRIPT",
]

_ZERO = Decimal(0)


@dataclass(slots=True, frozen=True)
class ReservationRequest:
    """One atomic consume attempt: what the decision would commit.

    ``ceilings`` are the *effective* resolved limits the gate already
    computed (min over the whole scope chain); passing them in rather than
    letting the ledger resolve configuration keeps persistence policy out of
    the ledger and arithmetic out of the gate - each side does exactly one
    kind of thinking.
    """

    tenant_id: str
    account_id: str
    #: Bucket name -> additional notional (quote units), e.g.
    #  ``{"symbol:BTC-USDT": 500, "account": 500, "exchange:binance": 500}``.
    add_notional: Mapping[str, Decimal]
    add_open_orders: int
    #: Bucket name -> ceiling from the resolved configuration. A bucket in
    # ``add_notional`` with no ceiling is a bug: request construction checks
    # this, and the acquire script refuses a bucket it cannot bound.
    ceilings_notional: Mapping[str, Decimal]
    open_orders_ceiling: int | None
    #: Crash safety net: an unreleased reservation expires after this long.
    #: Bounded by order-lifecycle reality (a submit that never reported back
    #: is reconciled within the execution layer's own window) - the ledger
    #: does not attempt to out-think reconciliation, it just does not block
    #: the account forever while reconciliation works.
    ttl_micros: int = 300_000_000
    request_id: str = ""
    #: Risk-reducing orders skip the ledger entirely - they cannot over-consume.
    risk_reducing: bool = False


@dataclass(slots=True, frozen=True)
class ReservationTicket:
    """Proof of a consumed reservation; the release token."""

    ticket_id: str
    tenant_id: str
    account_id: str
    held_notional: Mapping[str, Decimal]
    held_open_orders: int

    def to_payload(self) -> dict[str, object]:
        return {
            "ticketId": self.ticket_id,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "heldNotional": {key: str(value) for key, value in self.held_notional.items()},
            "heldOpenOrders": self.held_open_orders,
        }


@dataclass(slots=True, frozen=True)
class ReservationResult:
    """Outcome of one attempt. Denied carries which bucket refused, always."""

    granted: bool
    ticket: ReservationTicket | None
    denied_bucket: str | None = None
    #: ``"ledger-error"`` when the shared state was unreachable - a denial
    # with a different remediation than "at capacity", and the distinction
    # the metrics and the operator both need.
    reason: str = ""


class RiskReservationLedger(Protocol):
    """Consume/release risk budget against shared state."""

    def try_reserve(self, request: ReservationRequest) -> ReservationResult: ...

    def release(self, ticket: ReservationTicket) -> None: ...

    def snapshot_totals(self, tenant_id: str, account_id: str) -> Mapping[str, Decimal]:
        """Current held reservations, for the snapshot assembly path."""
        ...


@dataclass
class LocalReservationLedger:
    """Single-process ledger with the Redis implementation's exact semantics."""

    _held_notional: dict[tuple[str, str, str], Decimal] = field(default_factory=dict)
    _held_orders: dict[tuple[str, str], int] = field(default_factory=dict)
    _tickets: dict[str, ReservationTicket] = field(default_factory=dict)
    _counter: int = 0

    def try_reserve(self, request: ReservationRequest) -> ReservationResult:
        if request.risk_reducing:
            # Nothing to consume: a reduction frees budget, it never uses it.
            return ReservationResult(granted=True, ticket=None, reason="risk-reducing")
        base = (request.tenant_id, request.account_id)
        # Deterministic bucket order so a denial names the same bucket for
        # the same state on every run.
        for bucket in sorted(request.add_notional):
            add = request.add_notional[bucket]
            ceiling = request.ceilings_notional.get(bucket)
            if ceiling is None:
                if add > _ZERO:
                    return ReservationResult(
                        granted=False,
                        ticket=None,
                        denied_bucket=bucket,
                        reason="bucket has positive reservation and no ceiling; "
                        "refusing unbounded risk",
                    )
                continue
            key = (*base, bucket)
            current = self._held_notional.get(key, _ZERO)
            if current + add > ceiling:
                return ReservationResult(
                    granted=False,
                    ticket=None,
                    denied_bucket=bucket,
                    reason=f"held {current} + {add} exceeds ceiling {ceiling}",
                )
        if request.add_open_orders > 0 and request.open_orders_ceiling is not None:
            held_orders = self._held_orders.get(base, 0)
            if held_orders + request.add_open_orders > request.open_orders_ceiling:
                return ReservationResult(
                    granted=False,
                    ticket=None,
                    denied_bucket="open_orders",
                    reason=f"held {held_orders} + {request.add_open_orders} exceeds "
                    f"ceiling {request.open_orders_ceiling}",
                )
        self._counter += 1
        ticket = ReservationTicket(
            ticket_id=f"res-{self._counter}",
            tenant_id=request.tenant_id,
            account_id=request.account_id,
            held_notional=dict(request.add_notional),
            held_open_orders=request.add_open_orders,
        )
        for bucket, add in request.add_notional.items():
            if add == _ZERO:
                continue
            key = (*base, bucket)
            self._held_notional[key] = self._held_notional.get(key, _ZERO) + add
        if request.add_open_orders:
            self._held_orders[base] = self._held_orders.get(base, 0) + request.add_open_orders
        self._tickets[ticket.ticket_id] = ticket
        return ReservationResult(granted=True, ticket=ticket)

    def release(self, ticket: ReservationTicket) -> None:
        if ticket.ticket_id not in self._tickets:
            # Releasing twice, or releasing a foreign ticket, is a lifecycle
            # bug in the caller; silently ignoring it would hide a leaked or
            # crossed release. Raise: the fill/cancel handlers must be exact.
            raise KeyError(f"Unknown reservation ticket {ticket.ticket_id}.")
        del self._tickets[ticket.ticket_id]
        base = (ticket.tenant_id, ticket.account_id)
        for bucket, held in ticket.held_notional.items():
            key = (*base, bucket)
            current = self._held_notional.get(key, _ZERO)
            remainder = current - held
            if remainder <= _ZERO:
                self._held_notional.pop(key, None)
            else:
                self._held_notional[key] = remainder
        if ticket.held_open_orders:
            orders = self._held_orders.get(base, 0) - ticket.held_open_orders
            if orders <= 0:
                self._held_orders.pop(base, None)
            else:
                self._held_orders[base] = orders

    def snapshot_totals(self, tenant_id: str, account_id: str) -> Mapping[str, Decimal]:
        base = (tenant_id, account_id)
        return {
            bucket: value
            for (tenant, account, bucket), value in self._held_notional.items()
            if (tenant, account) == base
        }


#: Redis-side acquire. Hash fields hold per-bucket reservations
#: (``n:<bucket>`` decimal strings, ``open_orders`` integer). The script
#: refuses a bucket whose addition would cross the ceiling passed in ARGV,
#: and only then commits the HINCRBYs - the whole check-and-set is one
#: serialized script, which is the atomicity the design rests on. The
#: ``PEXPIRE`` is the crash reclaim described in the module docstring; the
#: expiry drops the whole account hash, so a worker that dies holding a
#: ticket releases every bucket of that account together, which is exactly
#: the conservative direction (a short window of lost budget, never of
#: double-counted budget).
RESERVATION_ACQUIRE_SCRIPT: Final[str] = """
local held = redis.call('HGETALL', KEYS[1])
local current = {}
for i = 1, #held, 2 do
  current[held[i]] = held[i + 1]
end
local n = tonumber(ARGV[1])
local buckets = {}
local check = {}
for i = 1, n do
  local bucket = ARGV[1 + i]
  local add = tonumber(ARGV[1 + n + i])
  local ceiling = ARGV[1 + 2 * n + i]
  local now = tonumber(current[bucket] or '0')
  if ceiling ~= '' then
    if now + add > tonumber(ceiling) then
      return {0, bucket}
    end
  elseif add > 0 then
    return {0, bucket}
  end
  buckets[i] = bucket
  check[i] = add
end
local openAdd = tonumber(ARGV[1 + 3 * n])
local openCeil = ARGV[2 + 3 * n]
local ttl = tonumber(ARGV[3 + 3 * n])
if openCeil ~= '' and openAdd > 0 then
  local nowOrders = tonumber(current['open_orders'] or '0')
  if nowOrders + openAdd > tonumber(openCeil) then
    return {0, 'open_orders'}
  end
end
for i = 1, n do
  if check[i] > 0 then
    redis.call('HINCRBYFLOAT', KEYS[1], buckets[i], check[i])
  end
end
if openAdd > 0 then
  redis.call('HINCRBY', KEYS[1], 'open_orders', openAdd)
end
redis.call('PEXPIRE', KEYS[1], ttl)
return {1, ''}
"""

#: Release: subtract the ticket's held amounts, dropping fields that reach
#: zero (an empty hash with a TTL is a scan-time ghost nobody wants).
RESERVATION_RELEASE_SCRIPT: Final[str] = """
local n = tonumber(ARGV[1])
for i = 1, n do
  local bucket = ARGV[1 + i]
  local sub = tonumber(ARGV[1 + n + i])
  if sub > 0 then
    local now = tonumber(redis.call('HGET', KEYS[1], bucket) or '0')
    local remainder = now - sub
    if remainder <= 0 then
      redis.call('HDEL', KEYS[1], bucket)
    else
      redis.call('HSET', KEYS[1], bucket, tostring(remainder))
    end
  end
end
local openSub = tonumber(ARGV[1 + 2 * n])
if openSub > 0 then
  local nowOrders = tonumber(redis.call('HGET', KEYS[1], 'open_orders') or '0')
  local remainderOrders = nowOrders - openSub
  if remainderOrders <= 0 then
    redis.call('HDEL', KEYS[1], 'open_orders')
  else
    redis.call('HSET', KEYS[1], 'open_orders', tostring(remainderOrders))
  end
end
return 1
"""


class RedisRiskClient(Protocol):
    """The minimal client surface the Redis ledger needs.

    Declared structurally (the pattern ``execution.locks`` established) so
    trading-core keeps its zero-dependency rule and a real client satisfies
    it without an import edge. ``eval``/``hgetall`` are the synchronous
    redis-py shapes because the reservation step runs inside the trading
    worker's submit path, where an await would put a network hop between
    risk approval and order transmission - the one gap this ledger exists
    to close atomically is the last place to add asynchronous uncertainty.
    """

    def eval(self, script: str, numkeys: int, *args: str) -> object: ...

    def hgetall(self, name: str) -> Mapping[object, object]: ...


class RedisReservationLedger:
    """Ledger over a synchronous Redis client (worker process context).

    The trading worker calls this from its submit path; the API never does
    (the API has no budget to consume - that boundary is the same one Part 5
    drew between "record intent" and "hold money"). A client error is
    returned as a *denial with reason* - see the module docstring: Redis
    down means no new risk, full stop, and it is the caller's metrics that
    count how often "no new risk" was an availability event rather than a
    capacity event.
    """

    def __init__(self, client: RedisRiskClient) -> None:
        self._client = client

    @staticmethod
    def _key(tenant_id: str, account_id: str) -> str:
        return RedisKeys.risk_reservation(tenant_id, account_id)

    def try_reserve(self, request: ReservationRequest) -> ReservationResult:
        if request.risk_reducing:
            return ReservationResult(granted=True, ticket=None, reason="risk-reducing")
        buckets = sorted(request.add_notional)
        args: list[str] = [str(len(buckets))]
        args.extend(buckets)
        args.extend(str(request.add_notional[bucket]) for bucket in buckets)
        args.extend(
            str(request.ceilings_notional.get(bucket, "")) for bucket in buckets
        )
        args.append(str(request.add_open_orders))
        args.append(
            "" if request.open_orders_ceiling is None else str(request.open_orders_ceiling)
        )
        args.append(str(max(request.ttl_micros // 1000, 1)))
        try:
            raw = self._client.eval(
                RESERVATION_ACQUIRE_SCRIPT, 1, self._key(request.tenant_id, request.account_id), *args
            )
        except Exception as exc:
            return ReservationResult(
                granted=False,
                ticket=None,
                reason=f"ledger-error: {type(exc).__name__}",
            )
        if not isinstance(raw, (list, tuple)) or len(raw) < 2:
            return ReservationResult(
                granted=False, ticket=None, reason="ledger-error: malformed reply"
            )
        granted = _to_int(raw[0]) == 1
        if not granted:
            denial = _to_str(raw[1])
            return ReservationResult(
                granted=False,
                ticket=None,
                denied_bucket=denial or None,
                reason="ceiling crossed",
            )
        ticket = ReservationTicket(
            ticket_id=request.request_id or "unidentified",
            tenant_id=request.tenant_id,
            account_id=request.account_id,
            held_notional=dict(request.add_notional),
            held_open_orders=request.add_open_orders,
        )
        return ReservationResult(granted=True, ticket=ticket)

    def release(self, ticket: ReservationTicket) -> None:
        buckets = sorted(ticket.held_notional)
        args: list[str] = [str(len(buckets))]
        args.extend(buckets)
        args.extend(str(ticket.held_notional[bucket]) for bucket in buckets)
        args.append(str(ticket.held_open_orders))
        self._client.eval(
            RESERVATION_RELEASE_SCRIPT,
            1,
            self._key(ticket.tenant_id, ticket.account_id),
            *args,
        )

    def snapshot_totals(self, tenant_id: str, account_id: str) -> Mapping[str, Decimal]:
        """Read path for snapshot assembly; ``{}`` means nothing is held.

        Connection failures *raise* - deliberately. An assembly layer that
        swallowed them would render "Redis unreachable" as "no reservations",
        which is the understatement direction this engine forbids; the
        loader catches and records ``reserved_budget`` as a missing source,
        and freshness plus the reservation check then deny. The ledger
        exposes facts; policy about their absence stays where the context is.
        """
        raw = self._client.hgetall(self._key(tenant_id, account_id))
        totals: dict[str, Decimal] = {}
        for key, value in raw.items():
            bucket = _to_str(key)
            if not bucket or bucket == "open_orders":
                continue
            totals[bucket] = Decimal(_to_str(value) or "0")
        return totals


def _to_str(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="strict")
    if isinstance(value, str):
        return value
    return str(value)


def _to_int(value: object) -> int:
    if isinstance(value, bool):
        raise ValueError("bool is not a valid reply integer")
    if isinstance(value, int):
        return value
    return int(_to_str(value))
