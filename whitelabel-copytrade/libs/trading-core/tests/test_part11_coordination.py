"""Part 11 coordination: partition math, leader leases, partition claims.

The Redis half of this suite runs the REAL RedisLockManager and
PartitionClaims code against a scripted stand-in client that simulates
exactly the five Lua scripts the platform ships - and refuses any script it
does not recognise by text. That refusal is the pin: changing a script's
text forces the simulator to change deliberately, which is the review the
scripts deserve (there is no embedded Lua interpreter in this test set, and
pretending otherwise with a general-purpose evaluator would be testing a
hand-waved Lua instead of the shipped one).

No sleeps, no wall clock, no network: TTL expiry is driven by an injected
micros clock, and the leader loop by a fake ``sleep`` that advances it.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import pytest

from wlct_trading.coordination.lease import (
    CLAIM_RELEASE_SCRIPT,
    CLAIM_RENEW_SCRIPT,
    LeaderElector,
    PartitionClaims,
    renew_due_micros,
)
from wlct_trading.coordination.partitions import (
    MAX_PARTITIONS,
    assignment,
    moved_by_membership,
    owns,
    partition_for,
    partition_owner,
)
from wlct_trading.execution import locks as locks_module
from wlct_trading.execution.locks import RedisLockManager
from wlct_trading.redis_keys import RedisKeys

# Algorithm-wiring pins, derived (not transcribed): utf-8 CRC-32 % count.
import zlib

CRC_ABC_8 = zlib.crc32(b"abc") % 8
CRC_TENANT_8 = zlib.crc32("tenant-1:acct-2".encode("utf-8")) % 8


class ScriptRedis:
    """Dict-backed Redis speaking exactly the shipped scripts, by text."""

    _KNOWN: dict[str, str]

    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.store: dict[str, tuple[str, int]] = {}  # key -> (value, expiry_micros)
        self.commands: list[str] = []

    # -- primitives ---------------------------------------------------------
    async def set(
        self, name: str, value: str, *, nx: bool = False, px: int | None = None
    ) -> bool | None:
        self.commands.append(f"SET {name}")
        entry = self._live(name)
        if nx and entry is not None:
            return None
        expiry = self.clock.micros + px * 1000 if px is not None else 0
        self.store[name] = (value, expiry)
        return True

    async def get(self, name: str) -> str | None:
        self.commands.append(f"GET {name}")
        return self._live(name)

    def _live(self, name: str) -> str | None:
        entry = self.store.get(name)
        if entry is None:
            return None
        value, expiry = entry
        if expiry and self.clock.micros >= expiry:
            del self.store[name]
            return None
        return value

    # -- scripts ------------------------------------------------------------
    async def eval(self, script: str, numkeys: int, *args: str) -> object:
        assert numkeys == 1
        kind = self._classify(script)
        key, member = args[0], args[1]
        self.commands.append(f"EVAL {kind} {key}")
        current = self._live(key)
        if current != member:
            return 0
        if kind == "release":
            del self.store[key]
            return 1
        if kind == "renew":
            ttl_millis = int(args[2])
            value, _ = self.store[key]
            self.store[key] = (value, self.clock.micros + ttl_millis * 1000)
            return 1
        raise AssertionError("unreachable")

    @staticmethod
    def _classify(script: str) -> str:
        known = {
            locks_module._RELEASE_SCRIPT: "release",
            locks_module._EXTEND_SCRIPT: "renew",
            CLAIM_RELEASE_SCRIPT: "release",
            CLAIM_RENEW_SCRIPT: "renew",
        }
        kind = known.get(script)
        if kind is None:
            raise AssertionError(
                "ScriptRedis only speaks the five shipped scripts; a new or "
                "edited script must be added HERE deliberately, never silently"
            )
        return kind

    def raw_ttl(self, name: str) -> int | None:
        entry = self.store.get(name)
        if entry is None:
            return None
        return max(0, entry[1] - self.clock.micros) // 1000


class FakeClock:
    def __init__(self) -> None:
        self.micros = 1_700_000_000_000_000

    def now(self) -> int:
        return self.micros

    def advance_ms(self, millis: int) -> None:
        self.micros += millis * 1000


class Sleeper:
    """Fake asyncio.sleep: every awaited sleep advances the shared clock."""

    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        self.clock.advance_ms(int(seconds * 1000))


def manager(redis: ScriptRedis) -> RedisLockManager:
    return RedisLockManager(redis)


# ---------------------------------------------------------------------------
# partition math
# ---------------------------------------------------------------------------


class TestPartitionMath:
    @pytest.mark.parametrize(
        ("key", "count", "expected"),
        [
            ("abc", 8, CRC_ABC_8),
            ("tenant-1:acct-2", 8, CRC_TENANT_8),
            ("x", 1, 0),
        ],
    )
    def test_stable_vectors(self, key: str, count: int, expected: int) -> None:
        # The expected values are computed from zlib.crc32 at module import
        # (CRC_ABC_8 above) so this test pins the ALGORITHM WIRING (utf-8,
        # plain modulo, no salt) rather than the constant - the fixture
        # file carries the hand-checked cross-language vectors, and the
        # parity spec on the TypeScript side refuses to run unless they
        # still match.
        assert partition_for(key, count) == expected
        assert partition_for(key, count) == expected  # determinism, twice

    def test_empty_key_is_refused_at_the_boundary(self) -> None:
        with pytest.raises(ValueError):
            partition_for("", 8)

    @pytest.mark.parametrize("count", [0, -1, MAX_PARTITIONS + 1, True, 8.0, "8"])
    def test_count_validation(self, count: Any) -> None:
        with pytest.raises(ValueError):
            partition_for("key", count)

    def test_assignment_is_complete_disjoint_and_order_insensitive(self) -> None:
        members = ["worker-a", "worker-b", "worker-c", "worker-d"]
        for count in (1, 3, 8, 17):
            table = assignment(members, count)
            seen: list[int] = []
            for parts in table.values():
                seen.extend(parts)
            assert sorted(seen) == list(range(count))  # complete
            assert len(seen) == len(set(seen))  # disjoint
            assert partition_owner(members, 0, count=count) is not None
            # order-independence: any permutation yields the same table
            for rotation in range(len(members)):
                rotated = members[rotation:] + members[:rotation]
                assert assignment(rotated, count) == table

    def test_leaving_membership_only_moves_the_leavers_partitions(self) -> None:
        full = ["worker-a", "worker-b", "worker-c"]
        without_b = ["worker-a", "worker-c"]
        for count in (4, 12, 40):
            b_parts = set(assignment(full, count).get("worker-b", ()))
            moved = moved_by_membership(full, without_b, count)
            assert set(moved) <= b_parts  # nothing else moved
            for partition, (before, after) in moved.items():
                assert before == "worker-b"
                assert after in {"worker-a", "worker-c"}

    def test_empty_membership_is_honest_emptiness(self) -> None:
        assert assignment([], 8) == {}
        assert partition_owner([], 3) is None
        assert owns({}, "worker-a", "key", 8) is False

    @pytest.mark.parametrize("bad", ["has space", "has|pipe", "", "-lead", "x" * 129])
    def test_member_validation(self, bad: str) -> None:
        with pytest.raises(ValueError):
            assignment([bad], 4)

    def test_duplicates_are_refused_not_deduplicated(self) -> None:
        with pytest.raises(ValueError):
            assignment(["a", "a"], 4)

    def test_partition_owner_range_guard(self) -> None:
        with pytest.raises(ValueError):
            partition_owner(["a", "b"], 9, count=8)
        with pytest.raises(ValueError):
            partition_owner(["a", "b"], -1)

    def test_tie_break_uses_the_committed_crc32_collision_pair(self) -> None:
        # Dev-time-found CRC-32 collision over legal member tokens: both
        # names hash to 242909273, and being equal-length their rendezvous
        # scores tie for EVERY partition ("score" appends a same-length-
        # suffix-independent xor... concretely: crc32 of `name|p` for these
        # two names is equal for all p we check, which is what makes this a
        # tie-break test and not a hash-quality wish).
        lo, hi = "5qjnzx3s", "9eg9tvkb"
        assert zlib.crc32(lo.encode("utf-8")) == zlib.crc32(hi.encode("utf-8"))
        assert lo < hi
        for partition in (0, 3, 7, 15):
            assert zlib.crc32(f"{lo}|{partition}".encode()) == zlib.crc32(
                f"{hi}|{partition}".encode()
            ), f"tie broken at partition {partition}"
            # tie-break law: lexicographically smaller member wins,
            # independent of the order the members arrived in
            assert partition_owner([lo, hi], partition) == lo
            assert partition_owner([hi, lo], partition) == lo
            table = assignment([hi, lo], partition + 1)
            assert partition in table[lo]
            assert partition not in table.get(hi, ())

    def test_owns_follows_the_table(self) -> None:
        table = assignment(["w1", "w2", "w3"], 12)
        for member, parts in table.items():
            target = parts[0]
            probe_key = ""
            for n in range(4096):
                candidate = f"acct-{n}"
                if partition_for(candidate, 12) == target:
                    probe_key = candidate
                    break
            assert probe_key != "f"  # sanity: a key for every partition exists
            assert owns(table, member, probe_key, 12) is True
            others = [m for m in table if m != member]
            for other in others:
                assert owns(table, other, probe_key, 12) is False


# ---------------------------------------------------------------------------
# lease timing rules
# ---------------------------------------------------------------------------


class TestLeaseConstruction:
    # -- the pure timing law: every branch named in the docstring, tested --
    def test_renew_due_before_interval(self) -> None:
        assert not renew_due_micros(
            now_micros=1_000_000, last_action_micros=990_001, renew_millis=10
        )

    def test_renew_due_exactly_interval(self) -> None:
        # the pinned `>=` boundary: one full interval IS due
        assert renew_due_micros(
            now_micros=1_000_000, last_action_micros=990_000, renew_millis=10
        )

    def test_renew_due_after_interval(self) -> None:
        assert renew_due_micros(
            now_micros=1_000_000, last_action_micros=10, renew_millis=10
        )

    def test_renew_due_huge_elapsed_is_due_not_wrapped(self) -> None:
        assert renew_due_micros(
            now_micros=2**63, last_action_micros=0, renew_millis=30_000
        )

    def test_renew_due_zero_interval_rejected(self) -> None:
        for bad in (0, -1, True, 10.0, "10"):
            with pytest.raises(ValueError, match="integer milliseconds"):
                renew_due_micros(
                    now_micros=1_000_000, last_action_micros=0, renew_millis=bad
                )

    def test_renew_due_non_integer_micros_rejected(self) -> None:
        for bad in (None, 1.5, "x"):
            with pytest.raises(ValueError, match="plain integer of microseconds"):
                renew_due_micros(
                    now_micros=bad, last_action_micros=0, renew_millis=10
                )
            with pytest.raises(ValueError, match="plain integer of microseconds"):
                renew_due_micros(
                    now_micros=0, last_action_micros=bad, renew_millis=10
                )

    def test_backward_clock_answers_due_not_dead(self) -> None:
        # An NTP step back must never lull a holder into skipping renewals.
        assert renew_due_micros(
            now_micros=989_999, last_action_micros=1_000_000, renew_millis=10
        )

    def test_half_ttl_rule(self) -> None:
        with pytest.raises(ValueError, match="half the lease TTL"):
            LeaderElector(
                manager(ScriptRedis(FakeClock())),
                name="x",
                ttl_millis=10_000,
                renew_millis=5_000,
            )
        # 4999*2 < 10000: legal, exactly-at-half is the refused boundary
        LeaderElector(
            manager(ScriptRedis(FakeClock())),
            name="x",
            ttl_millis=10_000,
            renew_millis=4_999,
        )

    @pytest.mark.parametrize(
        ("kwargs", "pattern"),
        [
            ({"ttl_millis": 999}, "below one second"),
            ({"renew_millis": 100}, "busy loop"),
            ({"name": ""}, "wire token"),
            ({"name": "has space"}, "wire token"),
            ({"name": "x" * 65}, "wire token"),
        ],
    )
    def test_refusals(self, kwargs: dict[str, Any], pattern: str) -> None:
        base: dict[str, Any] = {"name": "ok-name", "ttl_millis": 10_000}
        base.update(kwargs)
        with pytest.raises(ValueError, match=re.escape(pattern)):
            LeaderElector(manager(ScriptRedis(FakeClock())), **base)

    def test_key_lives_in_the_lock_namespace(self) -> None:
        clock = FakeClock()
        elector = LeaderElector(manager(ScriptRedis(clock)), name="copy-dispatch")
        assert elector.key == "wlct:trading:lock:leader:copy-dispatch"
        assert elector.key == RedisKeys.leader_lease("copy-dispatch")


# ---------------------------------------------------------------------------
# leader election over the real RedisLockManager
# ---------------------------------------------------------------------------


class TestLeaderElector:
    def _elector(
        self, redis: ScriptRedis, name: str = "recon"
    ) -> LeaderElector:
        clock = redis.clock
        return LeaderElector(
            manager(redis),
            name=name,
            ttl_millis=10_000,
            renew_millis=3_000,
            now=clock.now,
        )

    def test_tick_api_defers_early_and_renews_on_the_boundary(self) -> None:
        redis = ScriptRedis(FakeClock())
        e1 = self._elector(redis)
        assert asyncio.run(e1.try_campaign()) is True
        before = len(redis.commands)
        redis.clock.advance_ms(e1.renew_millis - 1)
        # not due: still leader, and NO traffic sent to Redis at all
        assert asyncio.run(e1.renew_if_due()) is True
        assert len(redis.commands) == before
        redis.clock.advance_ms(1)  # exactly the interval now
        assert asyncio.run(e1.renew_if_due()) is True
        assert len(redis.commands) > before
        assert e1.state.renewals == 1
        # not-leader answers False without touching Redis
        asyncio.run(e1.resign())
        assert asyncio.run(e1.renew_if_due()) is False

    def test_first_campaigner_wins_second_defers(self) -> None:
        redis = ScriptRedis(FakeClock())
        e1, e2 = self._elector(redis), self._elector(redis)
        assert asyncio.run(e1.try_campaign()) is True
        assert asyncio.run(e2.try_campaign()) is False
        assert e2.state.leader is False
        # campaigning again while leader is True without touching redis
        before = len(redis.commands)
        assert asyncio.run(e1.try_campaign()) is True
        assert len(redis.commands) == before

    def test_resign_hands_over_immediately(self) -> None:
        redis = ScriptRedis(FakeClock())
        e1, e2 = self._elector(redis), self._elector(redis)
        assert asyncio.run(e1.try_campaign()) is True
        assert asyncio.run(e1.resign()) is True
        assert asyncio.run(e2.try_campaign()) is True
        assert e2.state.token != e1.state.token  # (e1 is None-valued now)
        assert asyncio.run(e1.resign()) is False  # nothing left to release

    def test_renewal_extends_and_re_dates_the_handle(self) -> None:
        redis = ScriptRedis(FakeClock())
        e1 = self._elector(redis)
        assert asyncio.run(e1.try_campaign()) is True
        redis.clock.advance_ms(2_999)
        assert asyncio.run(e1.renew()) is True
        assert e1.state.renewals == 1
        ttl = redis.raw_ttl(e1.key)
        assert ttl is not None and ttl >= 9_000  # re-dated from NOW

    def test_ttl_lapse_demotes_the_stale_holder_on_its_next_renew(self) -> None:
        redis = ScriptRedis(FakeClock())
        e1, e2 = self._elector(redis), self._elector(redis)
        assert asyncio.run(e1.try_campaign()) is True
        redis.clock.advance_ms(10_001)  # lease expired; nobody noticed yet
        assert e1.is_leader is True  # belief survives until the PROOF check
        assert asyncio.run(e1.renew()) is False  # GET no longer returns our token
        assert e1.is_leader is False
        assert e1.state.demotions == 1
        assert asyncio.run(e2.try_campaign()) is True

    def test_transport_failure_renews_into_demotion_not_exception(self) -> None:
        redis = ScriptRedis(FakeClock())
        e1 = self._elector(redis)
        assert asyncio.run(e1.try_campaign()) is True

        async def boom(*args: Any, **kwargs: Any) -> int:
            raise ConnectionError("redis down")

        redis.eval =boom
        assert asyncio.run(e1.renew()) is False
        assert e1.is_leader is False
        assert e1.state.last_error == "LockError"

    def test_campaign_transport_failure_is_a_defer_not_a_crash(self) -> None:
        redis = ScriptRedis(FakeClock())
        e1 = self._elector(redis)

        async def boom(*args: Any, **kwargs: Any) -> bool:
            raise ConnectionError("redis down")

        redis.set = boom
        assert asyncio.run(e1.try_campaign()) is False
        assert e1.state.leader is False
        assert e1.state.last_error == "LockError"

    def test_run_loop_promotes_renews_demotes_and_resigns_on_exit(self) -> None:
        redis = ScriptRedis(FakeClock())
        clock = redis.clock
        events: list[str] = []

        class Stop:
            def __init__(self) -> None:
                self.n = 0

            def is_set(self) -> bool:
                return self.n >= 3  # stop after three sleep ticks

        stop = Stop()

        async def sleeper(seconds: float) -> None:
            stop.n += 1
            clock.advance_ms(int(seconds * 1000))

        e1 = LeaderElector(
            manager(redis),
            name="loop",
            ttl_millis=10_000,
            renew_millis=3_000,
            sleep=sleeper,
            now=clock.now,
        )

        async def on_promote() -> None:
            events.append("promote")

        async def on_demote() -> None:
            events.append("demote")

        async def drive() -> None:
            await e1.run(should_stop=stop, on_promote=on_promote, on_demote=on_demote)

        asyncio.run(drive())
        assert events == ["promote"]  # never demoted within three renew ticks
        assert e1.state.leader is False  # finally-resigned
        assert redis.store.get(e1.key) is None

    def test_promote_failure_releases_the_lease_and_surfaces(self) -> None:
        redis = ScriptRedis(FakeClock())
        clock = redis.clock
        ticks = {"n": 0}

        async def sleeper(seconds: float) -> None:
            clock.advance_ms(int(seconds * 1000))

        async def on_promote() -> None:
            ticks["n"] += 1  # the promote attempt IS the tick this test counts
            raise RuntimeError("service cannot start its leader duty")

        e1 = LeaderElector(
            manager(redis),
            name="bad-promote",
            ttl_millis=10_000,
            renew_millis=3_000,
            sleep=sleeper,
            now=clock.now,
        )

        async def drive() -> None:
            await e1.run(should_stop=lambda: ticks["n"] >= 1, on_promote=on_promote)

        with pytest.raises(RuntimeError, match="leader duties"):
            asyncio.run(drive())
        # the lease was handed back despite the failure
        assert redis.store.get(e1.key) is None
        # ...and a healthy candidate can take it now
        e2 = LeaderElector(
            manager(redis), name="bad-promote", ttl_millis=10_000, now=clock.now
        )
        assert asyncio.run(e2.try_campaign()) is True


# ---------------------------------------------------------------------------
# partition claims
# ---------------------------------------------------------------------------


class TestPartitionClaims:
    def _claims(self, redis: ScriptRedis, member: str) -> PartitionClaims:
        return PartitionClaims(
            redis,
            group="trade-execution",
            member=member,
            ttl_millis=5_000,
        )

    def test_claim_hold_take_over_and_self_renewal(self) -> None:
        redis = ScriptRedis(FakeClock())
        a, b = self._claims(redis, "host1:1"), self._claims(redis, "host2:1")
        assert asyncio.run(a.claim(3)) is True
        assert asyncio.run(b.claim(3)) is False
        assert asyncio.run(a.claim(3)) is True  # renewal path, same member
        assert asyncio.run(a.holder(3)) == "host1:1"
        redis.clock.advance_ms(5_001)
        assert asyncio.run(b.claim(3)) is True  # expiry handover, no release needed

    def test_release_is_compare_and_delete(self) -> None:
        redis = ScriptRedis(FakeClock())
        a, b = self._claims(redis, "host1:1"), self._claims(redis, "host2:1")
        asyncio.run(a.claim(0))
        assert asyncio.run(b.release(0)) is False  # stranger cannot release
        assert asyncio.run(a.holder(0)) == "host1:1"
        assert asyncio.run(a.release(0)) is True
        assert asyncio.run(a.holder(0)) is None
        assert asyncio.run(b.claim(0)) is True

    def test_reconcile_claims_only_the_wanted_set_and_survives_contention(self) -> None:
        redis = ScriptRedis(FakeClock())
        a = self._claims(redis, "host1:1")
        b = self._claims(redis, "host2:1")
        asyncio.run(b.claim(1))  # b grabs a partition a also wanted
        held = asyncio.run(a.reconcile({0, 1, 2}))
        assert held == frozenset({0, 2})  # contested partition honestly absent

    def test_claim_key_shape_and_transport_bluntness(self) -> None:
        redis = ScriptRedis(FakeClock())
        a = self._claims(redis, "m")
        assert a.key_for(7) == "wlct:trading:lock:partition:trade-execution:7"
        assert a.key_for(7) == RedisKeys.partition_claim("trade-execution", 7)

        async def boom(*args: Any, **kwargs: Any) -> bool:
            raise ConnectionError("redis down")

        redis.set = boom
        redis.eval = boom
        assert asyncio.run(a.claim(1)) is False

    def test_validation(self) -> None:
        redis = ScriptRedis(FakeClock())
        with pytest.raises(ValueError, match="not a member token"):
            PartitionClaims(redis, group="ok", member="bad member", ttl_millis=5_000)
        with pytest.raises(ValueError, match="not a wire token"):
            PartitionClaims(redis, group="bad group", member="m", ttl_millis=5_000)
        with pytest.raises(ValueError, match="one second"):
            PartitionClaims(redis, group="ok", member="m", ttl_millis=999)
        with pytest.raises(ValueError):
            RedisKeys.partition_claim("g", -1)


class TestScriptPinning:
    """The five scripts the platform trusts, pinned as text (the simulator
    above refuses anything else, but that guard only exists if these strings
    do - so pin them from the outside too)."""

    def test_claim_scripts_text(self) -> None:
        assert CLAIM_RENEW_SCRIPT == (
            "\nif redis.call('GET', KEYS[1]) == ARGV[1] then\n"
            "    return redis.call('PEXPIRE', KEYS[1], ARGV[2])\n"
            "else\n    return 0\nend\n"
        )
        assert CLAIM_RELEASE_SCRIPT == (
            "\nif redis.call('GET', KEYS[1]) == ARGV[1] then\n"
            "    return redis.call('DEL', KEYS[1])\n"
            "else\n    return 0\nend\n"
        )

    def test_lock_scripts_are_the_same_shape_differently_named(self) -> None:
        # The lock module's compare-and-extend and the claim module's renew
        # are the same two commands; assert that so a divergence here (a
        # bug fix in one) is a visible decision rather than an accident.
        assert "PEXPIRE" in locks_module._EXTEND_SCRIPT
        assert locks_module._EXTEND_SCRIPT.strip() == CLAIM_RENEW_SCRIPT.strip()
        assert locks_module._RELEASE_SCRIPT.strip() == CLAIM_RELEASE_SCRIPT.strip()


class TestLeaderElectorMatrix:
    """The callback/timing matrix from the Part 11 brief: promotions and
    demotions fire exactly once per transition, loss is recoverable, and
    the loop stays honest under cancellation."""

    def _elector(self, redis: ScriptRedis, name: str = "matrix") -> LeaderElector:
        return LeaderElector(
            manager(redis),
            name=name,
            ttl_millis=10_000,
            renew_millis=3_000,
            now=redis.clock.now,
        )

    def test_loss_then_recovery_promotes_twice_demotes_once(self) -> None:
        redis = ScriptRedis(FakeClock())
        events: list[str] = []
        ticks = {"n": 0}
        stolen = {"done": False}

        async def sleeper(seconds: float) -> None:
            ticks["n"] += 1
            redis.clock.advance_ms(int(seconds * 1000))
            if ticks["n"] == 1 and not stolen["done"]:
                # simulate the theft: the key now carries a foreign value
                # whose own expiry keeps it alive for 4 more seconds
                stolen["done"] = True
                redis.store[e1.key] = ("thief", redis.clock.micros + 4_000_000)

        e1 = LeaderElector(
            manager(redis),
            name="matrix",
            ttl_millis=10_000,
            renew_millis=3_000,
            sleep=sleeper,
            now=redis.clock.now,
        )

        async def promote() -> None:
            events.append("promote")

        async def demote() -> None:
            events.append("demote")

        async def drive() -> None:
            await e1.run(
                should_stop=lambda: ticks["n"] >= 6,
                on_promote=promote,
                on_demote=demote,
            )

        asyncio.run(drive())
        # tick1 promote; tick2 renew fails -> ONE demote; ticks 3-5 campaign
        # against the thief's live key (no callbacks); tick6 thief expired ->
        # re-promotion. Exactly this trace or the once-per-transition contract
        # broke.
        assert events == ["promote", "demote", "promote"]
        assert e1.state.demotions == 1
        assert e1.state.leader is False  # run's finally resigned on stop

    def test_failed_renewal_never_repeats_demotion_callback(self) -> None:
        redis = ScriptRedis(FakeClock())
        events: list[str] = []

        async def demote() -> None:
            events.append("demote")

        async def drive() -> None:
            ticks = {"n": 0}

            async def sleeper(seconds: float) -> None:
                ticks["n"] += 1
                redis.clock.advance_ms(int(seconds * 1000))
                # make the lease permanently foreign-owned: after the first
                # failed renewal every later renew must be a no-op False.
                if redis.store.get(e.key) is not None:
                    redis.store[e.key] = ("thief", redis.clock.micros + 10**12)

            e = LeaderElector(
                manager(redis),
                name="matrix2",
                ttl_millis=10_000,
                renew_millis=3_000,
                sleep=sleeper,
                now=redis.clock.now,
            )

            async def promote() -> None:
                events.append("promote")

            # the elector campaigns once (promote), the sleeper turns the
            # key into a foreign one, renew fails once (demote) - and the
            # loop then only campaigns against a key that never expires:
            # no further callbacks either way for the remaining ticks.
            await e.run(should_stop=lambda: ticks["n"] >= 4, on_promote=promote, on_demote=demote)
            # direct API calls after loss are inert, not re-demotions:
            assert await e.renew() is False
            assert await e.renew_if_due() is False

        asyncio.run(drive())
        assert events.count("demote") == 1
        assert events.count("promote") == 1

    def test_cancellation_resigns_the_lease(self) -> None:
        redis = ScriptRedis(FakeClock())
        started = asyncio.Event()

        async def sleeper(seconds: float) -> None:
            started.set()
            await asyncio.sleep(0)  # real yield: lets the test cancel us

        async def with_sleep(**kwargs: object) -> None:
            e = LeaderElector(
                manager(redis), name="cancel", ttl_millis=10_000, sleep=sleeper,
                now=redis.clock.now, **kwargs,
            )

            async def drive() -> None:
                await e.run()

            task = asyncio.ensure_future(drive())
            await started.wait()
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            assert e.state.leader is False
            assert redis.store.get(e.key) is None  # finally-resigned

        asyncio.run(with_sleep())


class TestRedisLockManager:
    """Step 13: the authoritative primitive gets the direct coverage it was
    missing before Part 11 - these same semantics are what the elector
    inherits, so they are pinned at the source."""

    def test_acquire_success_writes_token_with_ttl(self) -> None:
        redis = ScriptRedis(FakeClock())
        lock = manager(redis)
        handle = asyncio.run(lock.acquire("wlct:trading:lock:x", ttl_millis=7_500))
        assert handle.key == "wlct:trading:lock:x"
        assert len(handle.token) == 32  # secrets.token_hex(16)
        assert redis.store[handle.key][0] == handle.token
        assert redis.raw_ttl(handle.key) == 7_500
        assert redis.commands[0] == f"SET {handle.key}"

    def test_contention_raises_with_holder_hint_never_silently(self) -> None:
        redis = ScriptRedis(FakeClock())
        lock = manager(redis)
        handle = asyncio.run(lock.acquire("k", ttl_millis=7_500))
        with pytest.raises(locks_module.LockNotAcquired) as raised:
            asyncio.run(lock.acquire("k", ttl_millis=7_500))
        assert raised.value.key == "k"
        assert raised.value.holder_hint == handle.token

    def test_wait_then_acquire_after_expiry_uses_injected_sleep(self) -> None:
        redis = ScriptRedis(FakeClock())
        slept: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            slept.append(seconds)
            redis.clock.advance_ms(int(seconds * 1000))

        lock = RedisLockManager(redis, sleep=fake_sleep)
        first = asyncio.run(lock.acquire("k", ttl_millis=1_000))
        second = asyncio.run(lock.acquire("k", ttl_millis=1_000, wait_millis=2_500))
        assert slept  # waited rather than failing fast
        assert second.token != first.token
        assert redis.store["k"][0] == second.token

    def test_extend_by_owner_renews_by_thief_refuses(self) -> None:
        redis = ScriptRedis(FakeClock())
        lock = manager(redis)
        handle = asyncio.run(lock.acquire("k", ttl_millis=5_000))
        redis.clock.advance_ms(2_000)
        assert asyncio.run(lock.extend(handle, ttl_millis=5_000)) is True
        assert redis.raw_ttl(handle.key) == 5_000
        redis.store["k"] = ("thief", redis.clock.micros + 60_000_000)
        assert asyncio.run(lock.extend(handle, ttl_millis=5_000)) is False

    def test_release_owner_non_owner_and_post_expiry(self) -> None:
        redis = ScriptRedis(FakeClock())
        lock = manager(redis)
        handle = asyncio.run(lock.acquire("k", ttl_millis=5_000))
        impostor = locks_module.LockHandle(
            key="k", token="0" * 32, acquired_at_micros=0, ttl_millis=5_000
        )
        assert asyncio.run(lock.release(impostor)) is False
        assert asyncio.run(lock.release(handle)) is True
        assert asyncio.run(lock.release(handle)) is False  # already gone

        handle2 = asyncio.run(lock.acquire("k", ttl_millis=5_000))
        redis.clock.advance_ms(5_001)
        assert asyncio.run(lock.release(handle2)) is False  # our expiry ate it

    def test_exact_script_texts_are_the_contract(self) -> None:
        # If either script's text changes, the pinned dicts below stop
        # matching and ScriptRedis refuses the call: this asserts the same
        # fact from the fixture side of the contract.
        assert locks_module._RELEASE_SCRIPT == CLAIM_RELEASE_SCRIPT
        assert locks_module._EXTEND_SCRIPT == CLAIM_RENEW_SCRIPT

    def test_transport_errors_surface_as_lock_error_not_lock_success(self) -> None:
        redis = ScriptRedis(FakeClock())
        lock = manager(redis)

        async def boom(*args: object, **kwargs: object) -> bool:
            raise ConnectionError("redis down")

        redis.set = boom
        with pytest.raises(locks_module.LockError):
            asyncio.run(lock.acquire("k"))
        handle = locks_module.LockHandle(
            key="k", token="t", acquired_at_micros=0, ttl_millis=5_000
        )
        redis.eval = boom
        with pytest.raises(locks_module.LockError):
            asyncio.run(lock.release(handle))
        with pytest.raises(locks_module.LockError):
            asyncio.run(lock.extend(handle, ttl_millis=5_000))


class TestAuthorizationBoundary:
    """The Step 4/25 law as an executable rule: no module in the execution
    decision path may even IMPORT coordination - a lease or a partition is
    never, ever an authorisation input, and an import scan is the cheapest
    way to make that structural rather than aspirational."""

    def test_execution_package_never_imports_coordination(self) -> None:
        import ast
        from pathlib import Path

        import wlct_trading.execution as _execution_pkg

        execution_dir = Path(_execution_pkg.__file__).parent
        offenders: list[str] = []
        for path in sorted(execution_dir.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    mod = node.module or ""
                elif isinstance(node, ast.Import):
                    mod = node.names[0].name
                else:
                    continue
                if mod.split(".")[0:3] == ["wlct_trading", "coordination", ] or mod == "wlct_trading.coordination":
                    offenders.append(f"{path.name}:{mod}")
                for sub in getattr(node, "names", []):
                    full = f"{mod}.{sub.name}" if mod and isinstance(node, ast.Import) else sub.name
                    if "coordination" in (full or ""):
                        offenders.append(f"{path.name}:{full}")
        assert offenders == []

    def test_coordination_touches_only_the_lock_port_of_execution(self) -> None:
        import ast
        from pathlib import Path

        import wlct_trading.coordination as _coordination_pkg

        coord_dir = Path(_coordination_pkg.__file__).parent
        for path in sorted(coord_dir.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                mod = None
                if isinstance(node, ast.ImportFrom):
                    mod = node.module
                elif isinstance(node, ast.Import):
                    mod = node.names[0].name
                if mod and mod.startswith("wlct_trading.execution"):
                    assert mod == "wlct_trading.execution.locks", (
                        f"{path.name} imports {mod}: coordination may ride "
                        "the lock port ONLY - never engine, validators, risk "
                        "or store from inside a lease primitive"
                    )

