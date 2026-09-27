#!/usr/bin/env python3
"""Generate docs/fixtures/coordination_fixtures.json (Part 11).

One source of truth for the cross-language coordination contract: the TS
side re-implements CRC-32 partitioning, the rendezvous assignment, the
leader/claim key builders, the renewal timing rule and the two Lua scripts;
its parity spec replays the vectors committed here. Run from the repository
root:

    python3 libs/trading-core/scripts/gen_part11_fixtures.py

Regenerating twice must produce byte-identical output (the determinism
claims in the code are checked by exactly that property, and this script
asserts it before writing).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "libs" / "trading-core"))

from wlct_trading.coordination.membership import (  # noqa: E402 - imports follow the sys.path.insert above
    MEMBERSHIP_PING_SCRIPT,
    MEMBERSHIP_RESIGN_SCRIPT,
    MEMBERSHIP_SNAPSHOT_SCRIPT,
    heartbeat_expiry,
    live_members,
)
from wlct_trading.coordination.lease import (  # noqa: E402 - imports follow the sys.path.insert above
    CLAIM_RELEASE_SCRIPT,
    CLAIM_RENEW_SCRIPT,
    LeaderElector,
    renew_due_micros,
)
from wlct_trading.coordination.partitions import (  # noqa: E402 - imports follow the sys.path.insert above
    MAX_PARTITIONS,
    assignment,
    moved_by_membership,
    partition_for,
)
from wlct_trading.execution import locks as locks_module  # noqa: E402 - imports follow the sys.path.insert above
from wlct_trading.redis_keys import RedisKeys  # noqa: E402 - imports follow the sys.path.insert above

FIXTURE_PATH = ROOT / "docs" / "fixtures" / "coordination_fixtures.json"


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _key_vectors() -> dict[str, Any]:
    leader_names = [
        "a",
        "execution-reconciliation",
        "copy-dispatch",
        "with.dots-and_underscores123",
        "x" * 64,
    ]
    rejects: list[dict[str, object]] = []
    for bad in ["", "-lead", "has space", "x" * 65, "semi;colon"]:
        rejects.append({"name": bad, "error": "wire token"})
    return {
        "leaderLease": [
            {"name": name, "key": RedisKeys.leader_lease(name)} for name in leader_names
        ],
        "partitionClaim": [
            {"name": name, "partition": p, "key": RedisKeys.partition_claim(name, p)}
            for name in ("trade-execution", "trade-signal", "a")
            for p in (0, 1, 7, MAX_PARTITIONS - 1)
        ],
        "partitionClaimRejects": [{"name": "g", "partition": -1, "error": "non-negative"}],
        "nameRejects": rejects,
    }


def _membership_vectors() -> dict[str, Any]:
    """Part 12: the self-registration law - expiry math, staleness, rejects.

    Generator-side verification first (the tie-pair discipline): every row
    below is replayed through the Python implementation and must produce the
    expected answer, so a wrong row fails HERE rather than blessing drift in
    both languages at once. ``entries`` rows are JSON arrays; each language
    converts them to its pair type at the boundary, which is exactly the
    shape the TS spec replays.
    """

    def expect_error(fn, *args: object) -> str:
        try:
            fn(*args)
        except ValueError as error:
            return str(error)
        raise AssertionError("expected rejection did not happen")

    expiry_rows = [
        {"nowMillis": 0, "ttlMillis": 1_000, "expiryMillis": 1_000},
        {
            "nowMillis": 1_700_000_000_000,
            "ttlMillis": 15_000,
            "expiryMillis": 1_700_000_015_000,
        },
        {
            "nowMillis": 1_700_000_000_000,
            "ttlMillis": 1_440_000,
            "expiryMillis": 1_700_001_440_000,
        },
    ]
    for row in expiry_rows:
        assert heartbeat_expiry(row["nowMillis"], row["ttlMillis"]) == row["expiryMillis"], row

    members_rows = [
        {"nowMillis": 100, "entries": [], "expected": []},
        {"nowMillis": 100, "entries": [["a", 101]], "expected": ["a"]},
        {"nowMillis": 100, "entries": [["a", 100]], "expected": []},
        {"nowMillis": 100, "entries": [["a", 99]], "expected": []},
        {
            "nowMillis": 1_700_000_000_000,
            "entries": [
                ["worker-beta", 1_700_000_015_000],
                ["worker-alpha", 1_700_000_015_000],
                ["worker-stray", 1_700_000_000_000],
            ],
            "expected": ["worker-alpha", "worker-beta"],
        },
        {
            "nowMillis": 50,
            "entries": [["dup", 90], ["dup", 120], ["other", 121]],
            "expected": ["dup", "other"],
        },
        {
            "nowMillis": 50,
            "entries": [["dup", 120], ["dup", 90], ["dup", 60]],
            "expected": ["dup"],
        },
    ]
    for row in members_rows:
        pairs = [(str(name), int(expiry)) for name, expiry in row["entries"]]
        assert live_members(pairs, row["nowMillis"]) == tuple(row["expected"]), row

    members_rejects = [
        {"entry": ["has space", 100], "why": "member token"},
        {"entry": ["ok-1", True], "why": "pair"},
        {"entry": ["ok-1", "100"], "why": "pair"},
        {"entry": ["x" * 129, 100], "why": "member token"},
    ]
    return {
        "heartbeatExpiry": expiry_rows,
        "heartbeatExpiryRejects": [
            {
                "nowMillis": -1,
                "ttlMillis": 15_000,
                "error": expect_error(heartbeat_expiry, -1, 15_000),
            },
            {
                "nowMillis": 1_700_000_000_000,
                "ttlMillis": 999,
                "error": expect_error(heartbeat_expiry, 1_700_000_000_000, 999),
            },
            {
                "nowMillis": 1_700_000_000_000,
                "ttlMillis": 15_000.5,
                "error": expect_error(heartbeat_expiry, 1_700_000_000_000, 15_000.5),
            },
            {
                "nowMillis": True,
                "ttlMillis": 15_000,
                "error": expect_error(heartbeat_expiry, True, 15_000),
            },
        ],
        "liveMembers": members_rows,
        "liveMembersRejects": [
            {
                "entries": [row["entry"]],
                "nowMillis": 100,
                "error": expect_error(
                    live_members,
                    [(str(row["entry"][0]), row["entry"][1])],
                    100,
                ),
            }
            for row in members_rejects
        ],
    }


def _partition_vectors() -> dict[str, Any]:
    keys = [
        "abc",
        "tenant-1:acct-2",
        "x",
        "unicode-ünïcøde-✓",
        "0" * 512,
        "acct-17",
        "tenant:42:symbol:BTCUSDT",
    ]
    partition_for_vectors = [
        {"key": key, "count": count, "partition": partition_for(key, count)}
        for key in keys
        for count in (1, 2, 8, 12, 4096)
    ]
    member_sets = [
        ["worker-a"],
        ["worker-a", "worker-b"],
        ["worker-a", "worker-b", "worker-c"],
        ["m1", "m2", "m3", "m4", "m5"],
        ["host-1:2001:9f3c", "host-2:2001:a1b2"],
    ]
    assignments = []
    for members in member_sets:
        for count in (1, 3, 8, 12):
            table = assignment(members, count)
            assignments.append(
                {
                    "members": members,
                    "count": count,
                    "table": {m: list(parts) for m, parts in sorted(table.items())},
                }
            )
    moved = [
        {
            "before": before,
            "after": after,
            "count": count,
            "moved": {
                str(partition): [b, a]
                for partition, (b, a) in sorted(
                    moved_by_membership(before, after, count).items()
                )
            },
        }
        for before, after, count in (
            (["w1", "w2", "w3"], ["w1", "w3"], 12),
            (["w1", "w2", "w3"], ["w1", "w2", "w3", "w4"], 12),
            (["w1", "w2"], ["w2"], 40),
        )
    ]
    rejects: dict[str, Any] = {
        "counts": [],
        "keys": [{"key": "", "count": 8}],
        "members": [
            {"members": ["has space"]},
            {"members": [""]},
            {"members": ["-lead"]},
            {"members": ["has|pipe"]},
            {"members": ["a", "a"]},
            {"members": ["x" * 129]},
        ],
    }
    for bad in (0, -1, MAX_PARTITIONS + 1, "8", True):
        try:
            partition_for("abc", bad)
        except ValueError as error:
            rejects["counts"].append(
                {"count": "true" if bad is True else repr(bad), "error": str(error)}
            )
    return {
        "maxPartitions": MAX_PARTITIONS,
        "partitionFor": partition_for_vectors,
        "assignments": assignments,
        "movedByMembership": moved,
        "rejects": rejects,
    }


def _lease_vectors() -> dict[str, Any]:
    base = 1_700_000_000_000_000
    due_rows = []
    due_rejects: list[dict[str, Any]] = []
    for last_delta, renew, expected in (
        (10_000, 10, True),   # exactly due: the >= boundary, pinned
        (9_999, 10, False),
        (0, 10, False),       # no inactivity at all: not due
        (1_000_000, 10, True),  # huge elapsed: due, uncounted, no wrap
        (250_000, 250, True),
        (249_999, 250, False),
        (-1, 10, True),       # clock moved BACKWARD one micro: due, not dead
        (-10**12, 60_000, True),  # a full NTP-scale step back: due
    ):
        due_rows.append(
            {
                "nowMicros": base,
                "lastActionMicros": base - last_delta,
                "renewMillis": renew,
                "expected": expected,
            }
        )
        assert (
            renew_due_micros(
                now_micros=base,
                last_action_micros=base - last_delta,
                renew_millis=renew,
            )
            is expected
        ), f"generation-side drift on {last_delta}/{renew}"
    for bad_renew in (0, -5):
        try:
            renew_due_micros(now_micros=base, last_action_micros=base, renew_millis=bad_renew)
        except ValueError as error:
            due_rejects.append({"renewMillis": bad_renew, "error": str(error)})
    for bad_micros in ("1000", 1.5, True):
        try:
            renew_due_micros(
                now_micros=base, last_action_micros=base, renew_millis=10
            )
            renew_due_micros(
                now_micros=bad_micros,
                last_action_micros=base,
                renew_millis=10,
            )
        except ValueError as error:
            due_rejects.append({"nowMicros": repr(bad_micros), "error": str(error)})
            break  # one representative row: the TS twin must reject the first

    construction = []
    for ttl, renew, ok in (
        (30_000, 10_000, True),   # ttl/3 default boundary friend
        (10_000, 4_999, True),
        (10_000, 5_000, False),   # half-TTL rule refuses exactly-at-half
        (999, None, False),       # ttl floor
        (10_000, 100, False),     # busy-loop floor
        (30_000, None, True),     # default renew = ttl//3
    ):
        try:
            LeaderElector(
                _ProbeLockManager(),
                name="gen-probe",
                ttl_millis=ttl,
                renew_millis=renew,
            )
            actual_ok = True
            if renew is None:
                # record the derived default so the TS twin agrees on it
                ttl_floor = ttl if ttl >= 1_000 else 30_000
                construction.append(
                    {
                        "ttlMillis": ttl_floor,
                        "renewMillis": None,
                        "ok": True,
                        "derivedRenewMillis": max(250, ttl_floor // 3),
                    }
                )
                continue
        except ValueError as error:
            actual_ok = False
            construction.append(
                {"ttlMillis": ttl, "renewMillis": renew, "ok": False, "error": str(error)}
            )
            continue
        construction.append({"ttlMillis": ttl, "renewMillis": renew, "ok": actual_ok})
    scripts = {
        "claimRenew": {"text": CLAIM_RENEW_SCRIPT, "sha256": _sha(CLAIM_RENEW_SCRIPT)},
        "claimRelease": {"text": CLAIM_RELEASE_SCRIPT, "sha256": _sha(CLAIM_RELEASE_SCRIPT)},
        "lockExtend": {
            "text": locks_module._EXTEND_SCRIPT,
            "sha256": _sha(locks_module._EXTEND_SCRIPT),
        },
        "lockRelease": {
            "text": locks_module._RELEASE_SCRIPT,
            "sha256": _sha(locks_module._RELEASE_SCRIPT),
        },
        "note": (
            "The lock manager's compare-and-extend and the claim renew are "
            "the SAME Lua text modulo whitespace; release likewise. The TS "
            "twin embeds its own copies and the parity spec asserts both the "
            "digests and that stripped equivalence, so a fix to one script "
            "in either language fails a test."
        ),
    }
    derived = {"defaultTtlMillis": 30_000, "defaultRetryDivisor": 8}
    return {
        "renewDueMicros": due_rows,
        "renewDueMicrosRejects": due_rejects,
        "construction": construction,
        "scripts": scripts,
        "defaults": derived,
    }


#: Dev-time-found CRC-32 collision over two legal member tokens
#: (crc32 of each name alone is 242909273 for both). Equal length and a
#: per-partition-constant score, so they tie in rendezvous scoring at every
#: partition - the committed witness for the tie-break law. Discovered by
#: an LCG scan; the generator VERIFIES the property below rather than
#: trusting the constants, so a CRC implementation drift is caught here too.
TIE_LO, TIE_HI = "5qjnzx3s", "9eg9tvkb"


def _crc_and_tie_vectors() -> dict[str, Any]:
    import zlib

    crc_inputs = [
        "",
        "abc",
        "x",
        "tenant-1:acct-2",
        "unicode-ünïcøde-✓",
        "0" * 512,
        f"{TIE_LO}|7",
        f"{TIE_HI}|7",
    ]
    crc_vectors = [
        {"input": s, "crc32": zlib.crc32(s.encode("utf-8"))} for s in crc_inputs
    ]
    assert zlib.crc32(TIE_LO.encode("utf-8")) == zlib.crc32(TIE_HI.encode("utf-8"))
    tie_vectors = []
    for partition in (0, 3, 7, 15):
        sa = zlib.crc32(f"{TIE_LO}|{partition}".encode("utf-8"))
        sb = zlib.crc32(f"{TIE_HI}|{partition}".encode("utf-8"))
        assert sa == sb, f"committed tie pair no longer ties at {partition}"
        tie_vectors.append(
            {
                "partition": partition,
                "score": sa,
                "members": sorted([TIE_LO, TIE_HI]),
                "winner": TIE_LO,  # sorted()[0] == lexicographic smallest
            }
        )
    return {"crc32": crc_vectors, "tieBreak": tie_vectors}


class _ProbeLockManager:
    """Constructor-only stand-in: the vectors below exercise validation,
    never I/O, so the manager argument is never touched."""

    def __getattr__(self, _name: str) -> None:
        raise AssertionError("probe manager must not be used for I/O")


def build() -> dict[str, Any]:
    fixture = {
        "schema": "part11-coordination-v1",
        "generatedBy": "libs/trading-core/scripts/gen_part11_fixtures.py",
        "keys": _key_vectors(),
        "partitions": _partition_vectors(),
        "lease": _lease_vectors(),
    }
    fixture["partitions"].update(_crc_and_tie_vectors())
    membership = _membership_vectors()
    fixture["membership"] = {
        "heartbeatExpiry": membership["heartbeatExpiry"],
        "heartbeatExpiryRejects": membership["heartbeatExpiryRejects"],
        "liveMembers": membership["liveMembers"],
        "liveMembersRejects": membership["liveMembersRejects"],
        "scripts": {
            "ping": {"text": MEMBERSHIP_PING_SCRIPT, "sha256": _sha(MEMBERSHIP_PING_SCRIPT)},
            "snapshot": {
                "text": MEMBERSHIP_SNAPSHOT_SCRIPT,
                "sha256": _sha(MEMBERSHIP_SNAPSHOT_SCRIPT),
            },
            "resign": {
                "text": MEMBERSHIP_RESIGN_SCRIPT,
                "sha256": _sha(MEMBERSHIP_RESIGN_SCRIPT),
            },
        },
        "defaults": {"group": "trade-execution", "key": RedisKeys.membership_registry("trade-execution")},
    }
    return fixture


def main() -> int:
    first = json.dumps(build(), indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    second = json.dumps(build(), indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    if first != second:
        print("FIXTURE GENERATION IS NOT DETERMINISTIC - refusing to write", file=sys.stderr)
        return 1
    FIXTURE_PATH.write_text(first, encoding="utf-8")
    print(f"wrote {FIXTURE_PATH} ({len(first.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
