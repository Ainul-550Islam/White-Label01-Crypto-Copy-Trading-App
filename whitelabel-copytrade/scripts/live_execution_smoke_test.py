#!/usr/bin/env python3
"""LIVE EXECUTION SMOKE TEST — signs real requests with real credentials.

    ############################################################
    #                          WARNING                         #
    #                                                          #
    #  This script authenticates against a real exchange using #
    #  a real API key. It is NOT part of the test suite, is    #
    #  never run by CI, and is disabled unless you opt in      #
    #  twice: once with an environment variable and once on    #
    #  the command line.                                       #
    #                                                          #
    #  `pytest` needs no credentials, no network and no        #
    #  database. This script needs all three of the first two. #
    ############################################################

What it does by default (read-only mode)
----------------------------------------
  1. Refuses to run unless explicitly enabled.
  2. Refuses to run against production unless --allow-mainnet is given.
  3. Synchronises the venue clock and reports the measured skew.
  4. Verifies the credential, and FAILS if the key can withdraw.
  5. Reads the account, balances and open orders.
  6. Confirms that no secret appears in any rendered output.

Every one of those is a GET. Nothing is placed, nothing is cancelled, no
position changes. This is the mode you should use.

Order placement mode
--------------------
With --place-test-order the script will place ONE order and then cancel it.
The order is a limit order priced far from the market so that it should rest
rather than fill — but "should" is doing real work in that sentence, and on a
thin book, during a fast move, or with a fat-fingered --test-price, it can
fill. If it fills you own the position and this script will not close it for
you.

That mode additionally requires:
  * --place-test-order on the command line,
  * WLCT_LIVE_EXECUTION_CONFIRM=I_UNDERSTAND_THIS_PLACES_A_REAL_ORDER,
  * a testnet endpoint, unless --allow-mainnet is ALSO given.

Usage
-----
    # Read-only against the Binance Spot testnet (recommended):
    WLCT_LIVE_EXECUTION=1 \\
    BINANCE_API_KEY=... BINANCE_API_SECRET=... \\
      python scripts/live_execution_smoke_test.py --testnet

    # Read-only against production:
    WLCT_LIVE_EXECUTION=1 \\
    BINANCE_API_KEY=... BINANCE_API_SECRET=... \\
      python scripts/live_execution_smoke_test.py --allow-mainnet

Exit codes: 0 all checks passed, 1 a check failed, 2 bad configuration or the
safety interlocks were not satisfied.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
TRADING_CORE = REPOSITORY_ROOT / "libs" / "trading-core"
if str(TRADING_CORE) not in sys.path:
    sys.path.insert(0, str(TRADING_CORE))

try:
    from wlct_trading.enums import ExchangeId, OrderSide, OrderType, TimeInForce
    from wlct_trading.execution.credentials import (
        CredentialError,
        EnvironmentCredentialProvider,
        scrub_secret_like,
    )
    from wlct_trading.execution.timesync import ExchangeClock
    from wlct_trading.exchanges.binance.trading import (
        BinanceAccountAdapter,
        BinanceTradingAdapter,
    )
    from wlct_trading.net.config import TransportSettings
    from wlct_trading.net.signed_client import HttpxSignedSender, fetch_server_time
    from wlct_trading.idempotency import build_client_order_id
    from wlct_trading.orders import OrderIntent
except ImportError as exc:  # pragma: no cover - depends on install
    print(f"Cannot import the execution stack: {exc}", file=sys.stderr)
    print(
        "Install the optional dependencies first:\n"
        "  pip install -e 'libs/trading-core[live]'",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


#: The opt-in gate. Absent or anything other than a truthy value means the
#: script does nothing. Defaulting to "off" is the whole point.
ENABLE_VARIABLE = "WLCT_LIVE_EXECUTION"

#: The second, deliberately verbose gate for the order-placing mode.
ORDER_CONFIRM_VARIABLE = "WLCT_LIVE_EXECUTION_CONFIRM"
ORDER_CONFIRM_VALUE = "I_UNDERSTAND_THIS_PLACES_A_REAL_ORDER"

MAINNET_REST = "https://api.binance.com"
TESTNET_REST = "https://testnet.binance.vision"

#: Synthetic identifiers. This harness is not multi-tenant; it exercises one
#: credential pair from the environment, and the ids exist only to satisfy the
#: adapter contract.
HARNESS_TENANT_ID = "smoke-tenant"
HARNESS_ACCOUNT_ID = "smoke-account"


class Checks:
    """Tiny result recorder, so the summary reads like a checklist."""

    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0
        self._lines: list[str] = []

    def ok(self, name: str, detail: str = "") -> None:
        self.passed += 1
        suffix = f" — {detail}" if detail else ""
        line = f"  [PASS] {name}{suffix}"
        self._lines.append(line)
        print(line, flush=True)

    def fail(self, name: str, detail: str = "") -> None:
        self.failed += 1
        suffix = f" — {detail}" if detail else ""
        line = f"  [FAIL] {name}{suffix}"
        self._lines.append(line)
        print(line, flush=True)

    def note(self, text: str) -> None:
        print(f"  .      {text}", flush=True)

    @property
    def total(self) -> int:
        return self.passed + self.failed


def _truthy(raw: str | None) -> bool:
    return (raw or "").strip().lower() in {"1", "true", "yes", "on"}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Live authenticated execution smoke test. Disabled by default.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--testnet",
        action="store_true",
        help=f"Use {TESTNET_REST} instead of production. Strongly recommended.",
    )
    parser.add_argument(
        "--allow-mainnet",
        action="store_true",
        help="Permit running against real production endpoints.",
    )
    parser.add_argument(
        "--symbol",
        default="BTC/USDT",
        help="Platform symbol used for the open-orders read (default: BTC/USDT).",
    )
    parser.add_argument(
        "--place-test-order",
        action="store_true",
        help=(
            "DANGEROUS. Place one far-from-market limit order and cancel it. "
            "Requires the confirmation environment variable as well."
        ),
    )
    parser.add_argument(
        "--test-quantity",
        default="0.001",
        help="Quantity for the test order. Keep it at the venue minimum.",
    )
    parser.add_argument(
        "--test-price",
        default=None,
        help=(
            "Limit price for the test order. Required with --place-test-order. "
            "Choose a price far below the market for a BUY so it rests unfilled."
        ),
    )
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=10_000,
        help="Per-request timeout in milliseconds (default: 10000).",
    )
    return parser.parse_args(argv)


def check_interlocks(args: argparse.Namespace) -> str:
    """Validate every safety gate, or exit 2. Returns the REST base to use.

    Written as a single function that either returns a usable configuration or
    terminates. There is no partially-satisfied state in which the script
    proceeds "carefully" — that is how a harness ends up trading production by
    accident at the end of a long debugging session.
    """
    if not _truthy(os.environ.get(ENABLE_VARIABLE)):
        print(
            f"Refusing to run: {ENABLE_VARIABLE} is not set.\n"
            f"\n"
            f"This script signs real requests with real credentials. Set\n"
            f"  {ENABLE_VARIABLE}=1\n"
            f"only when you intend exactly that.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    if args.testnet and args.allow_mainnet:
        print(
            "Refusing to run: --testnet and --allow-mainnet contradict each other. "
            "Pick one.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    if not args.testnet and not args.allow_mainnet:
        print(
            "Refusing to run: neither --testnet nor --allow-mainnet was given.\n"
            "\n"
            "There is no default. Choosing an endpoint for you is precisely the\n"
            "decision this script must not make on your behalf.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    rest_base = TESTNET_REST if args.testnet else MAINNET_REST

    if args.place_test_order:
        if os.environ.get(ORDER_CONFIRM_VARIABLE) != ORDER_CONFIRM_VALUE:
            print(
                f"Refusing to place an order: {ORDER_CONFIRM_VARIABLE} must be set "
                f"to exactly\n  {ORDER_CONFIRM_VALUE}\n"
                f"\n"
                f"An order placed by this script is a real order. It can fill.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        if args.test_price is None:
            print(
                "Refusing to place an order: --test-price is required.\n"
                "\n"
                "There is no safe default price. A market order would fill "
                "immediately, and a limit price the script chose for you could "
                "sit on the wrong side of the book.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        if not args.testnet:
            print(
                "Refusing to place an order against production.\n"
                "\n"
                "Order placement from this harness is testnet-only. Exercising "
                "the live path with real money belongs in a supervised "
                "deployment, not a smoke script.",
                file=sys.stderr,
            )
            raise SystemExit(2)

    api_key = (os.environ.get("BINANCE_API_KEY") or "").strip()
    api_secret = (os.environ.get("BINANCE_API_SECRET") or "").strip()
    if not api_key or not api_secret:
        print(
            "Refusing to run: BINANCE_API_KEY and BINANCE_API_SECRET must both be "
            "set.\n"
            "\n"
            "Use a key with 'Enable Reading' and, if you intend to place the test "
            "order, 'Enable Spot & Margin Trading'. Never a key with withdrawal "
            "permission: this script fails on one deliberately.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    return rest_base


async def run(args: argparse.Namespace, rest_base: str) -> int:
    checks = Checks()

    print()
    print("=" * 72)
    print("LIVE EXECUTION SMOKE TEST")
    print("=" * 72)
    print(f"  endpoint      : {rest_base}")
    print(f"  mode          : {'PLACE TEST ORDER' if args.place_test_order else 'READ ONLY'}")
    print(f"  symbol        : {args.symbol}")
    print("  credentials   : from environment (never printed)")
    print("=" * 72)
    print()

    settings = TransportSettings(http_timeout_ms=args.timeout_ms)
    credentials = EnvironmentCredentialProvider(
        os.environ,
        exchange=ExchangeId.BINANCE,
        tenant_id=HARNESS_TENANT_ID,
        account_id=HARNESS_ACCOUNT_ID,
    )

    # Captured so the final containment check can assert that nothing rendered
    # by this script contains either value. Held in a local, never logged.
    secret_material = [
        (os.environ.get("BINANCE_API_KEY") or "").strip(),
        (os.environ.get("BINANCE_API_SECRET") or "").strip(),
    ]
    rendered_output: list[str] = []

    def record(text: str) -> str:
        rendered_output.append(text)
        return text

    async with HttpxSignedSender(settings) as sender:
        # ------------------------------------------------------------------
        # 1. Clock synchronisation
        # ------------------------------------------------------------------
        print("Clock")
        clock = ExchangeClock(
            lambda: fetch_server_time(
                sender, rest_base=rest_base, timeout_ms=args.timeout_ms
            ),
            max_skew_millis=1_000,
        )
        try:
            sample = await clock.synchronise()
            checks.ok(
                "server time read",
                f"offset {sample.offset_millis}ms, round trip {sample.round_trip_millis}ms",
            )
        except Exception as exc:  # noqa: BLE001 - reported, then fatal
            checks.fail("server time read", f"{type(exc).__name__}: {exc}")
            print("\nWithout a synchronised clock nothing else can be signed.")
            return 1

        if clock.is_within_limits:
            checks.ok("clock skew within 1000ms", f"offset {clock.offset_millis}ms")
        else:
            checks.fail(
                "clock skew within 1000ms",
                f"offset {clock.offset_millis}ms — Binance will reject signed "
                f"requests. Fix the host clock (enable NTP) before trading.",
            )

        try:
            signing_timestamp = clock.timestamp_millis()
            checks.ok("venue-aligned timestamp produced", str(signing_timestamp))
        except Exception as exc:  # noqa: BLE001
            checks.fail("venue-aligned timestamp produced", f"{type(exc).__name__}: {exc}")
            return 1

        account_adapter = BinanceAccountAdapter(
            send=sender,
            credentials=credentials,
            clock=clock,
            testnet=args.testnet,
            rest_base=rest_base,
            timeout_ms=args.timeout_ms,
        )
        trading_adapter = BinanceTradingAdapter(
            send=sender,
            credentials=credentials,
            clock=clock,
            testnet=args.testnet,
            rest_base=rest_base,
            timeout_ms=args.timeout_ms,
        )

        # ------------------------------------------------------------------
        # 2. Credential verification
        # ------------------------------------------------------------------
        print("\nCredentials")
        try:
            verified, message = await account_adapter.verify_credentials(
                HARNESS_TENANT_ID, HARNESS_ACCOUNT_ID
            )
        except CredentialError as exc:
            checks.fail("credential resolution", f"{type(exc).__name__}: {exc}")
            return 1

        if verified:
            checks.ok("credential verified", record(message))
        else:
            # A withdrawal-capable key lands here, and that is a hard failure by
            # design: the platform is non-custodial and refuses such a key.
            checks.fail("credential verified", record(message))

        # ------------------------------------------------------------------
        # 3. Account and balances
        # ------------------------------------------------------------------
        print("\nAccount")
        try:
            account = await account_adapter.fetch_account(
                HARNESS_TENANT_ID, HARNESS_ACCOUNT_ID
            )
        except Exception as exc:  # noqa: BLE001
            checks.fail("account read", f"{type(exc).__name__}: {scrub_secret_like(str(exc))}")
            return 1

        checks.ok(
            "account read",
            record(
                f"type={account.account_type} canTrade={account.can_trade} "
                f"canWithdraw={account.can_withdraw}"
            ),
        )

        if account.can_withdraw:
            checks.fail(
                "key has no withdrawal permission",
                "the venue reports WITHDRAW enabled — replace this key",
            )
        else:
            checks.ok("key has no withdrawal permission")

        funded = account.non_zero_balances
        checks.ok("balances normalised", record(f"{len(funded)} funded asset(s)"))
        for balance in funded[:5]:
            line = (
                f"{balance.asset}: free={balance.free} locked={balance.locked} "
                f"total={balance.total}"
            )
            checks.note(record(line))
            if balance.total != balance.free + balance.locked:
                checks.fail(
                    f"balance arithmetic for {balance.asset}",
                    "total does not equal free + locked",
                )

        # ------------------------------------------------------------------
        # 4. Open orders
        # ------------------------------------------------------------------
        print("\nOpen orders")
        try:
            open_orders = await trading_adapter.fetch_open_orders(
                HARNESS_TENANT_ID, HARNESS_ACCOUNT_ID, symbol=args.symbol
            )
            checks.ok(
                "open orders read",
                record(f"{len(open_orders)} working order(s) for {args.symbol}"),
            )
        except Exception as exc:  # noqa: BLE001
            checks.fail(
                "open orders read",
                f"{type(exc).__name__}: {scrub_secret_like(str(exc))}",
            )

        # ------------------------------------------------------------------
        # 5. Optional: place and cancel one order
        # ------------------------------------------------------------------
        if args.place_test_order:
            print("\nOrder placement (TESTNET)")
            await _place_and_cancel(
                trading_adapter, args, checks, record
            )
        else:
            print("\nOrder placement")
            checks.note("skipped — pass --place-test-order to exercise it")

        # ------------------------------------------------------------------
        # 6. Containment
        # ------------------------------------------------------------------
        print("\nContainment")
        leaked = [
            secret
            for secret in secret_material
            if secret and any(secret in text for text in rendered_output)
        ]
        if leaked:
            # Deliberately does not print what leaked or where.
            checks.fail(
                "no credential in rendered output",
                f"{len(leaked)} credential value(s) appeared in output",
            )
        else:
            checks.ok("no credential in rendered output")

        stats = sender.stats()
        checks.ok(
            "transport counters",
            f"requests={stats['requests']} failures={stats['failures']} "
            f"venueUsedWeight1m={stats['lastVenueUsedWeight1m']}",
        )

    print()
    print("=" * 72)
    print(f"  {checks.passed}/{checks.total} checks passed")
    print("=" * 72)
    print()
    return 0 if checks.failed == 0 else 1


async def _place_and_cancel(
    adapter: BinanceTradingAdapter,
    args: argparse.Namespace,
    checks: Checks,
    record: Any,
) -> None:
    """Place one resting limit order, then cancel it.

    Note the ordering discipline: the cancel is issued in a ``finally`` so that
    a failure anywhere after submission still attempts to clean up. That is not
    a guarantee — if the cancel itself fails, the order is still live and the
    operator is told so in the clearest terms available.
    """
    try:
        quantity = Decimal(args.test_quantity)
        price = Decimal(args.test_price)
    except Exception:  # noqa: BLE001
        checks.fail("test order parameters", "quantity and price must be decimals")
        return

    intent = OrderIntent(
        tenant_id=HARNESS_TENANT_ID,
        account_id=HARNESS_ACCOUNT_ID,
        exchange=ExchangeId.BINANCE,
        symbol=args.symbol,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=quantity,
        price=price,
        time_in_force=TimeInForce.GTC,
    )
    client_order_id = build_client_order_id(intent)
    checks.note(f"clientOrderId {client_order_id}")

    submitted = False
    try:
        result = await adapter.submit_order(intent, client_order_id)
        submitted = True
        checks.ok(
            "test order submitted",
            record(f"status={result.status.value} venueId={result.exchange_order_id}"),
        )
    except Exception as exc:  # noqa: BLE001
        checks.fail(
            "test order submitted",
            f"{type(exc).__name__}: {scrub_secret_like(str(exc))}",
        )
        return
    finally:
        if submitted:
            try:
                order = await adapter.fetch_order(
                    HARNESS_TENANT_ID, HARNESS_ACCOUNT_ID, client_order_id
                )
                if order is None:
                    checks.fail(
                        "test order readable by clientOrderId",
                        "the venue does not know this order",
                    )
                else:
                    checks.ok(
                        "test order readable by clientOrderId",
                        record(f"status={order.status.value}"),
                    )
                    cancelled = await adapter.cancel_order(order)
                    checks.ok(
                        "test order cancelled",
                        record(f"status={cancelled.status.value}"),
                    )
            except Exception as exc:  # noqa: BLE001
                checks.fail(
                    "test order cancelled",
                    f"{type(exc).__name__}: {scrub_secret_like(str(exc))}",
                )
                print(
                    "\n"
                    "  !!  THE TEST ORDER MAY STILL BE LIVE AT THE VENUE.\n"
                    f"  !!  clientOrderId: {client_order_id}\n"
                    "  !!  Cancel it manually before doing anything else.\n",
                    flush=True,
                )


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    rest_base = check_interlocks(args)
    try:
        return asyncio.run(run(args, rest_base))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
