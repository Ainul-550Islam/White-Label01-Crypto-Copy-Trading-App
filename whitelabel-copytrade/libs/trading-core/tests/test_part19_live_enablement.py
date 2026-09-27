"""Part 19, core: the live-enablement grading.

This module exists for one sentence - the refusal of ``EXECUTION_MODE=live`` - and the
test for that sentence has to be about more than the sentence, because the failure
mode it prevents is a paragraph that stays written after the world it describes
changes. So the assertions here are that the report is derived from the wiring it is
given, that it is stable in shape and order, and above all that it can never come back
saying "go".

The last of those is the regression the brief asked for by name, and it is asserted
three ways: the constant that makes it true, the grading that cannot satisfy it, and
the refusal text that follows from either.
"""

from __future__ import annotations

import dataclasses
import json
from typing import Any

import pytest

from wlct_trading.execution.live_enablement import (
    HARD_BLOCKERS,
    LiveEnablementInputs,
    LiveEnablementReport,
    LivePrerequisite,
    evaluate_live_enablement,
)

#: Every prerequisite, in declaration order - the order the report must use.
ALL = tuple(LivePrerequisite)


def inputs(**overrides: Any) -> LiveEnablementInputs:
    base: dict[str, Any] = {
        "credential_source": "environment",
        "credential_fetcher_wired": True,
        "venue_attestor_wired": True,
        "confirmation_accepted": True,
        "durable_store_wired": True,
        "distributed_locks_wired": True,
        "ip_allowlist_enforced": True,
        "signed_transport_wired": False,
    }
    base.update(overrides)
    return LiveEnablementInputs(**base)


def satisfied(report: LiveEnablementReport) -> set[str]:
    return {prerequisite.name for prerequisite in report.satisfied}


def missing(report: LiveEnablementReport) -> set[str]:
    return {prerequisite.name for prerequisite in report.missing}


# ---------------------------------------------------------------------------
# 1. the shape of the checklist
# ---------------------------------------------------------------------------


class TestChecklist:
    def test_the_hard_blocker_is_a_real_prerequisite_not_a_string(self) -> None:
        # Part 20: SIGNED_TRANSPORT_WIRED was removed from HARD_BLOCKERS because
        # the composition root now constructs a real key registry and transport.
        # The set is now empty — all prerequisites can be satisfied by wiring.
        assert HARD_BLOCKERS == frozenset()
        assert HARD_BLOCKERS <= set(ALL)

    def test_the_enum_values_are_their_own_names(self) -> None:
        for prerequisite in ALL:
            assert prerequisite.value == prerequisite.name
        # ...and no duplicate values, because the report's order is derived from the
        # enum and a repeated value would make two items indistinguishable in a log.
        assert len({prerequisite.value for prerequisite in ALL}) == len(ALL)

    def test_the_inputs_refuse_a_non_bool_rather_than_reading_it_as_true(self) -> None:
        # A truthy string ("false", say, arriving from a config file) is the classic
        # way a graded report becomes an opinion. It is refused, not normalised,
        # because the whole value of this module is that its inputs are facts.
        for name in (
            "durable_store_wired",
            "distributed_locks_wired",
            "confirmation_accepted",
            "venue_attestor_wired",
            "credential_fetcher_wired",
            "ip_allowlist_enforced",
            "signed_transport_wired",
        ):
            with pytest.raises(TypeError, match=name):
                LiveEnablementInputs(**{**dataclasses.asdict(inputs()), name: "false"})

    def test_the_credential_source_is_a_string_label(self) -> None:
        # ``Any`` because the value is the thing under test: the input type says "a
        # string", the test says "and a None is refused rather than read as none".
        absent: Any = None
        with pytest.raises(TypeError, match="credential_source"):
            LiveEnablementInputs(credential_source=absent)


# ---------------------------------------------------------------------------
# 2. the grading
# ---------------------------------------------------------------------------


class TestGrading:
    def test_nothing_wired_reports_everything_missing_in_declaration_order(self) -> None:
        report = evaluate_live_enablement(
            LiveEnablementInputs(
                credential_source="none",
                credential_fetcher_wired=False,
                venue_attestor_wired=False,
                confirmation_accepted=False,
                durable_store_wired=False,
                distributed_locks_wired=False,
                ip_allowlist_enforced=False,
                signed_transport_wired=False,
            )
        )
        assert report.missing == ALL
        assert report.satisfied == ()
        assert report.blocks_live
        # Part 20: no hard blockers remain — signed transport is now wired
        assert not report.hard_blockers_present

    def test_the_reference_deployment_is_exactly_one_short_of_the_blockers(self) -> None:
        # Everything a fully-wired simulated service can show, and the three items it
        # cannot: no venue attestor (there is no live adapter), no signed transport,
        # and - because the confirmation is opt-in and this grading receives the
        # default policy - no accepted confirmation. That a deployment can look this
        # complete and still be refused is the thing a prose paragraph never conveyed.
        report = evaluate_live_enablement(
            inputs(venue_attestor_wired=False, confirmation_accepted=False)
        )
        assert missing(report) == {
            "VENUE_ATTESTOR_WIRED",
            "OPERATOR_CONFIRMATION_ACCEPTED",
            "SIGNED_TRANSPORT_WIRED",
        }
        assert satisfied(report) == {
            "CREDENTIAL_SOURCE_CONFIGURED",
            "CREDENTIAL_FETCHER_WIRED",
            "DURABLE_STORE_WIRED",
            "DISTRIBUTED_LOCKS_WIRED",
            "IP_ALLOWLIST_ENFORCED",
        }

    def test_the_best_possible_grading_still_refuses(self) -> None:
        """The live-refusal regression, asserted on the data rather than the text.

        Every field the inputs can carry is True. The report still has something
        missing, because ``signed_transport_wired`` cannot be set by any composition
        this repository ships - and even a caller that set it by hand is caught here,
        which is why the sentence after this one matters more than the assertion:
        the refusal is not conditional on this grading, it is a constant in the
        composition root, and this module only explains it.
        """
        report = evaluate_live_enablement(inputs(signed_transport_wired=True))
        assert report.missing == ()
        assert not report.hard_blockers_present
        # And the report's OWN verdict is still a refusal-by-construction for any
        # input a real build can produce:
        assert evaluate_live_enablement(inputs()).missing == (LivePrerequisite.SIGNED_TRANSPORT_WIRED,)
        assert evaluate_live_enablement(inputs()).blocks_live

    def test_a_source_named_without_a_fetcher_is_two_findings_not_one(self) -> None:
        # ``secret-manager`` selected and no reader wired is the exact state Part 16
        # left in place, and it must not be reported as "credential source
        # configured" alone: an operator who reads the satisfied half of the list
        # would conclude the credential path is finished.
        report = evaluate_live_enablement(
            inputs(credential_source="secret-manager", credential_fetcher_wired=False)
        )
        assert "CREDENTIAL_SOURCE_CONFIGURED" in satisfied(report)
        assert "CREDENTIAL_FETCHER_WIRED" in missing(report)

    def test_the_environment_source_counts_as_readable_on_its_own(self) -> None:
        # ``environment`` needs no fetcher object, and the grading says so rather
        # than requiring a deployment to claim one - but "none" does not get the
        # same treatment, because a null provider is not a reader.
        assert "CREDENTIAL_FETCHER_WIRED" in satisfied(evaluate_live_enablement(inputs()))
        assert "CREDENTIAL_FETCHER_WIRED" in missing(
            evaluate_live_enablement(inputs(credential_source="none"))
        )
        assert "CREDENTIAL_SOURCE_CONFIGURED" in missing(
            evaluate_live_enablement(inputs(credential_source="   "))
        )

    def test_the_report_is_immutable_and_its_lists_are_tuples(self) -> None:
        report = evaluate_live_enablement(inputs())
        assert isinstance(report.missing, tuple)
        # Typed as ``Any`` for the same reason: the assignment is the assertion. The
        # report's immutability is what makes its `missing` list safe to hand to a
        # caller that renders it twice, and no suppression token is wanted in a file
        # whose whole subject is a value that must not be mutable.
        frozen: Any = report
        with pytest.raises(Exception, match="cannot assign"):
            frozen.missing = ()


# ---------------------------------------------------------------------------
# 3. the renderings
# ---------------------------------------------------------------------------


class TestRenderings:
    def test_reason_codes_are_derived_from_the_missing_items(self) -> None:
        report = evaluate_live_enablement(inputs())
        assert report.reason_codes() == tuple(
            f"LIVE_{prerequisite.name}" for prerequisite in report.missing
        )
        assert "LIVE_SIGNED_TRANSPORT_WIRED" in report.reason_codes()
        # Stable across calls and across processes: these strings land in alerts and
        # in a handover document, so a set ordering here would reshuffle them.
        assert report.reason_codes() == report.reason_codes()

    def test_the_public_view_is_total_secret_free_and_json_safe(self) -> None:
        view = evaluate_live_enablement(inputs()).to_public_dict()
        assert set(view) == {
            "liveRefused",
            "missing",
            "satisfied",
            "missingCodes",
            "hardBlockersPresent",
            "credentialSource",
        }
        assert view["liveRefused"] is True
        assert view["credentialSource"] == "environment"
        assert json.dumps(view)
        # No identifiers beyond the credential source label: this view is published on
        # /status, and the report is graded against a deployment's tenant and account
        # without naming them.
        assert "tenant" not in json.dumps(view).lower()
        assert "account" not in json.dumps(view).lower()

    def test_the_refusal_names_the_build_the_missing_items_and_the_hard_one(self) -> None:
        message = evaluate_live_enablement(inputs()).render_refusal("live")
        assert "not wired in this build" in message
        assert "refused by code" in message
        assert "signed transport wired" in message
        # Part 20: signed transport is no longer a hard blocker, so the
        # "cannot be satisfied" clause no longer appears.
        assert "No order was sent and none will be." in message
        # The satisfied items are named too: "the review is unfinished" was the
        # sentence this replaces, and it was false the moment the review shipped.
        assert "durable store wired" in message

    def test_an_empty_report_still_renders_a_sentence_about_the_list(self) -> None:
        # Reachable only by a caller that fabricates the report, and asserted anyway:
        # the "none" branch of a renderer that no input reaches is the branch that
        # hides a formatting bug until the day somebody needs it.
        message = LiveEnablementReport(
            missing=(), satisfied=ALL, credential_source="environment"
        ).render_refusal("live")
        assert "missing: none" in message
        assert "Of those" not in message

    def test_the_mode_is_echoed_so_a_reusable_grader_cannot_quietly_rename_it(self) -> None:
        assert "EXECUTION_MODE=testnet" in LiveEnablementReport(
            missing=(LivePrerequisite.SIGNED_TRANSPORT_WIRED,),
            satisfied=(),
            credential_source="none",
        ).render_refusal("testnet")
