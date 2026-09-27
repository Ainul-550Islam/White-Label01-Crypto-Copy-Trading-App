"""Part 12: self-registering worker membership.

Three layers of proof, in the order their failures would hurt:

1. the pinned law (expiry arithmetic, staleness boundary, duplicate
   resolution, rejects) replayed row-for-row against the shared fixture;
2. the wire protocol: the three scripts, executed by a fake Redis that
   INTERPRETS them by exact text identity - a renamed or reshaped script in
   the module fails the fake the same way it would fail a real server, and
   the fixture's sha256 pins the same texts against the TypeScript twin;
3. the failure law: ping propagates, members degrades to None, resign is
   best-effort - the three different answers are deliberate and each is
   tested at exactly its own severity.

The fleet scenario (two workers, one goes silent) is the whole point of
self-registration, so it runs end to end against the same fake: no test of
this feature may consist only of unit-law replay.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from wlct_trading.coordination.membership import (
    MEMBERSHIP_PING_SCRIPT,
    MEMBERSHIP_RESIGN_SCRIPT,
    MEMBERSHIP_SNAPSHOT_SCRIPT,
    MembershipRegistry,
    heartbeat_expiry,
    live_members,
)
from wlct_trading.coordination.partitions import assignment, moved_by_membership

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / ".." / "docs" / "fixtures" / "coordination_fixtures.json"
).resolve()
FIXTURE: dict[str, Any] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
MEMBERSHIP = FIXTURE["membership"]


# ---------------------------------------------------------------------------
# 1. the pinned law
# ---------------------------------------------------------------------------


class TestMembershipLaw:
    def test_heartbeat_expiry_rows(self) -> None:
        for row in MEMBERSHIP["heartbeatExpiry"]:
            got = heartbeat_expiry(row["nowMillis"], row["ttlMillis"])
            assert got == row["expiryMillis"], row

    def test_heartbeat_expiry_rejects_match_verbatim(self) -> None:
        for row in MEMBERSHIP["heartbeatExpiryRejects"]:
            with pytest.raises(ValueError) as caught:
                heartbeat_expiry(row["nowMillis"], row["ttlMillis"])
            assert str(caught.value) == row["error"], row

    def test_live_members_rows(self) -> None:
        for row in MEMBERSHIP["liveMembers"]:
            pairs = [(str(name), int(expiry)) for name, expiry in row["entries"]]
            assert live_members(pairs, row["nowMillis"]) == tuple(row["expected"]), row

    def test_live_members_rejects_match_verbatim(self) -> None:
        for row in MEMBERSHIP["liveMembersRejects"]:
            entry = row["entries"][0]
            with pytest.raises(ValueError) as caught:
                live_members([(str(entry[0]), entry[1])], row["nowMillis"])
            assert str(caught.value) == row["error"], row

    def test_boundary_is_strictly_alive(self) -> None:
        # The dedicated row above is the pin; this is the sentence it means:
        # expiring exactly when asked "still live?" answers no.
        assert live_members([("solo", 100)], 100) == ()
        assert live_members([("solo", 101)], 100) == ("solo",)


# ---------------------------------------------------------------------------
# 2. the scripts: text identity, byte pinning
# ---------------------------------------------------------------------------


class TestMembershipScripts:
    def test_script_texts_match_the_fixture_exactly(self) -> None:
        for name, script in (
            ("ping", MEMBERSHIP_PING_SCRIPT),
            ("snapshot", MEMBERSHIP_SNAPSHOT_SCRIPT),
            ("resign", MEMBERSHIP_RESIGN_SCRIPT),
        ):
            entry = MEMBERSHIP["scripts"][name]
            assert script == entry["text"], name
            digest = hashlib.sha256(script.encode("utf-8")).hexdigest()
            assert digest == entry["sha256"], name

    def test_scripts_use_only_the_single_key_and_deterministic_commands(self) -> None:
        # Membership lives at exactly one key per group and never scans.
        for script in (
            MEMBERSHIP_PING_SCRIPT,
            MEMBERSHIP_SNAPSHOT_SCRIPT,
            MEMBERSHIP_RESIGN_SCRIPT,
        ):
            assert "KEYS[2]" not in script
            for banned in ("SCAN", "TIME(", "SRANDMEMBER", "RANDOMKEY"):
                assert banned not in script


# ---------------------------------------------------------------------------
# the fake: a registry SERVER, not a mock
# ---------------------------------------------------------------------------


class FakeRegistryServer:
    """Implements the three pinned scripts over plain zset state.

    ZRANGE ... WITHSCORES replies arrive from Redis as a FLAT array of
    strings - members and scores alike. The fake returns string scores on
    purpose: int-coercion at the boundary is part of the contract, and a
    fake that returned tidy tuples would test a shape the production client
    never sees. ``reply_shape`` flips the other tolerated shape (an
    already-decoded client) so both legs of the parser are exercised.
    """

    def __init__(self) -> None:
        self.zsets: dict[str, dict[str, int]] = {}
        self.transport_down = False
        self.commands: list[str] = []
        self.reply_shape: str = "flat-strings"

    def _flat(self, entries: dict[str, int]) -> list[object]:
        out: list[object] = []
        for name, expiry in entries.items():
            out.append(name)
            out.append(str(expiry) if self.reply_shape == "flat-strings" else expiry)
        return out

    async def eval(self, script: str, numkeys: int, *args: str) -> object:
        if self.transport_down:
            raise ConnectionError("transport down")
        assert numkeys == 1, "the registry protocol is one-key by construction"
        key = args[0]
        argv = args[1:]
        if script == MEMBERSHIP_PING_SCRIPT:
            self.commands.append(f"PING {key}")
            now = int(argv[0])
            expiry = int(argv[1])
            member = argv[2]
            entries = self.zsets.setdefault(key, {})
            for dead in [m for m, e in entries.items() if e <= now]:
                del entries[dead]
            current = entries.get(member)
            if current is None or expiry > current:  # the GT law, server-side
                entries[member] = expiry
            return self._flat(entries)
        if script == MEMBERSHIP_SNAPSHOT_SCRIPT:
            self.commands.append(f"SNAPSHOT {key}")
            entries = self.zsets.get(key)
            if not entries:
                return []
            return self._flat(dict(entries))
        if script == MEMBERSHIP_RESIGN_SCRIPT:
            self.commands.append(f"RESIGN {key}")
            entries = self.zsets.get(key, {})
            entries.pop(argv[0], None)
            return len(entries)
        raise AssertionError(f"unknown script reached the fake: {script[:48]!r}")


class ExplodingClient:
    async def eval(self, script: str, numkeys: int, *args: str) -> object:
        raise ConnectionError("registry unreachable")


class GarbageClient:
    async def eval(self, script: str, numkeys: int, *args: str) -> object:
        return ["unpaired-reply-element"]


# ---------------------------------------------------------------------------
# 3. the client contract
# ---------------------------------------------------------------------------


class TestRegistryContract:
    def registry(
        self, client: object, *, member: str = "worker-alpha", ttl: int = 15_000
    ) -> MembershipRegistry:
        return MembershipRegistry(
            client, group="trade-execution", member=member, ttl_millis=ttl
        )

    def test_construction_laws(self) -> None:
        server = FakeRegistryServer()
        with pytest.raises(ValueError, match="not a wire token"):
            MembershipRegistry(server, group="bad group!", member="m", ttl_millis=15_000)
        with pytest.raises(ValueError, match="member token"):
            MembershipRegistry(server, group="ok", member="has space", ttl_millis=15_000)
        with pytest.raises(ValueError, match="one second"):
            MembershipRegistry(server, group="ok", member="ok-member", ttl_millis=999)
        with pytest.raises(ValueError, match="plain integer"):
            MembershipRegistry(server, group="ok", member="m", ttl_millis=True)

    def test_key_uses_the_pinned_builder(self) -> None:
        reg = self.registry(FakeRegistryServer())
        assert reg.key == MEMBERSHIP["defaults"]["key"]

    def test_ping_registers_and_reads(self) -> None:
        server = FakeRegistryServer()
        reg = self.registry(server)
        got = asyncio.run(reg.ping(1_000))
        assert got == ("worker-alpha",)
        assert server.zsets[reg.key]["worker-alpha"] == heartbeat_expiry(1_000, 15_000)

    def test_gt_flag_makes_stale_replays_harmless(self) -> None:
        server = FakeRegistryServer()
        reg = self.registry(server)
        asyncio.run(reg.ping(10_000))
        # A delayed/replayed heartbeat with an EARLIER expiry must not
        # shorten the live window (the GT in the ping script is the law).
        asyncio.run(reg.ping(9_000))
        assert server.zsets[reg.key]["worker-alpha"] == heartbeat_expiry(10_000, 15_000)

    def test_members_degrades_to_none_never_raises(self) -> None:
        reg = self.registry(ExplodingClient())
        assert asyncio.run(reg.members(1_000)) is None

    def test_ping_propagates_the_transport_error(self) -> None:
        reg = self.registry(ExplodingClient())
        with pytest.raises(ConnectionError):
            asyncio.run(reg.ping(1_000))

    def test_resign_is_best_effort(self) -> None:
        server = FakeRegistryServer()
        reg = self.registry(server)
        asyncio.run(reg.ping(1_000))
        assert asyncio.run(reg.resign()) is True
        assert asyncio.run(reg.members(1_000)) == ()
        server.transport_down = True
        assert asyncio.run(reg.resign()) is False

    def test_malformed_replies_are_loud_not_plausible(self) -> None:
        reg = self.registry(GarbageClient())
        with pytest.raises(ValueError, match="odd number"):
            asyncio.run(reg.members(1_000))

    def test_int_scores_from_a_typed_client_parse_too(self) -> None:
        server = FakeRegistryServer()
        server.reply_shape = "int-scores"
        reg = self.registry(server)
        assert asyncio.run(reg.ping(1_000)) == ("worker-alpha",)


# ---------------------------------------------------------------------------
# 4. the fleet scenario: join, serve, die silently, reassign
# ---------------------------------------------------------------------------


class TestFleetScenario:
    def test_self_registration_drives_real_reassignment(self) -> None:
        server = FakeRegistryServer()
        alpha = MembershipRegistry(
            server, group="trade-execution", member="worker-alpha", ttl_millis=30_000
        )
        beta = MembershipRegistry(
            server, group="trade-execution", member="worker-beta", ttl_millis=30_000
        )
        now = 1_000_000

        assert asyncio.run(alpha.ping(now)) == ("worker-alpha",)
        assert asyncio.run(beta.ping(now)) == ("worker-alpha", "worker-beta")
        assert asyncio.run(alpha.ping(now + 1_000)) == ("worker-alpha", "worker-beta")

        before = assignment(["worker-alpha", "worker-beta"], 8)
        assert before["worker-alpha"] and before["worker-beta"]
        assert set(before["worker-alpha"]).isdisjoint(before["worker-beta"])

        # Beta dies silently: no resign, no goodbye - the TTL is the only
        # protocol, and that is the case the whole design exists for.
        stale_at = now + 1_000 + 30_000 + 1
        after = asyncio.run(alpha.ping(stale_at))
        assert after == ("worker-alpha",)

        moved = moved_by_membership(["worker-alpha", "worker-beta"], list(after), 8)
        # Everything beta had moves; alpha's holdings are untouched, and no
        # partition ends up ownerless or shared.
        # moved_by_membership answers "who loses what": (previous, new) per
        # moved partition - beta's whole set, each one handed to alpha.
        assert moved == {p: ("worker-beta", "worker-alpha") for p in before["worker-beta"]}
        # assignment() is member -> ascending partitions: one survivor, all
        # eight, exactly the table the claim loop will re-reconcile against.
        assert assignment(list(after), 8) == {"worker-alpha": tuple(range(8))}
        assert asyncio.run(alpha.members(stale_at)) == ("worker-alpha",)


def test_fixture_membership_sections_are_complete() -> None:
    assert sorted(MEMBERSHIP.keys()) == [
        "defaults",
        "heartbeatExpiry",
        "heartbeatExpiryRejects",
        "liveMembers",
        "liveMembersRejects",
        "scripts",
    ]
