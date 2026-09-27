"""Coordination primitives (Parts 11-12): who runs the singletons, and which
worker holds which slice of the queue - decided by arithmetic and timed
leases, never by a coordinator daemon.

Part 12 adds ``membership``: self-registering fleet topology (heartbeat zset
with the staleness law in pure, fixture-pinned functions). The division of
labour is unchanged - membership says who WANTS a partition, claims decide
who HAS one - and self-registration only replaces the hand-configured list
as the source of the first.

``partitions`` is pure math (CRC-32 + rendezvous hashing) shared across
languages through committed fixtures; ``lease`` is the timed half
(leader election and partition claims) riding the execution layer's lock
port, so the platform has exactly one mutual-exclusion implementation.
Read :mod:`wlct_trading.coordination.lease`'s module docstring before
wiring anything behind a lease: the safety story of this package is
"idempotence under an optimisation", not "exactly-once guaranteed".
"""

from wlct_trading.coordination.membership import (
    MEMBERSHIP_PING_SCRIPT,
    MEMBERSHIP_RESIGN_SCRIPT,
    MEMBERSHIP_SNAPSHOT_SCRIPT,
    MembershipRegistry,
    heartbeat_expiry,
    live_members,
)
from wlct_trading.coordination.lease import (
    CLAIM_RELEASE_SCRIPT,
    CLAIM_RENEW_SCRIPT,
    LeaderElector,
    LeaseState,
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

__all__ = [
    "CLAIM_RELEASE_SCRIPT",
    "CLAIM_RENEW_SCRIPT",
    "MEMBERSHIP_PING_SCRIPT",
    "MEMBERSHIP_RESIGN_SCRIPT",
    "MEMBERSHIP_SNAPSHOT_SCRIPT",
    "MembershipRegistry",
    "heartbeat_expiry",
    "live_members",
    "LeaderElector",
    "LeaseState",
    "MAX_PARTITIONS",
    "PartitionClaims",
    "assignment",
    "moved_by_membership",
    "owns",
    "partition_for",
    "partition_owner",
    "renew_due_micros",
]
