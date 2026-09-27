"""Part 19: the operator confirmation, end to end through this service.

The record type and the review's confirmation sub-law are tested in the core suite.
What is tested here is the service's half, which is where Part 19 actually changed
behaviour: what a deployment may configure, what it may not, what the composed runtime
reports, and - the load-bearing one - that turning every part of this on still leaves
``EXECUTION_MODE=live`` refused.

Configuration refusals are asserted as boot failures rather than as per-order
symptoms because that is the shape this service chose in Part 16 and kept since: a
deployment that starts and then cannot trade looks like a venue incident, while one that
refuses to start says "check your configuration" where somebody is guaranteed to read
it.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.clock import epoch_micros
from wlct_trading.execution.live_confirmation import (
    ConfirmationState,
    LiveOperatorConfirmation,
)
from wlct_trading.execution.live_enablement import LivePrerequisite
from wlct_trading.execution.placement_review import PlacementReviewPolicy, ReviewArea

from app.config import Settings
from app.placement import build_confirmation_verifier, build_placement_reviewer
from tests.conftest import BASE_ENV
from tests.test_execution_engine import settings_for
from tests.test_part16_placement import CREDENTIAL_SHAPED_KEYS, json_keys, runtime_for
from tests.test_part18_observability import hub_for

#: Not a secret: the HMAC key is what makes a record verifiable, and this test computes
#: signatures with it on purpose. The real one is env-only and never in a repository.
CONFIRMATION_KEY = "part19-service-confirmation-key-0123456789abcdef"
DAY = 86_400_000_000
#: Relative to the real clock on purpose. The core suite pins the grading arithmetic on
#: absolute stamps; this file is about a running service, and ``build_runtime`` grades
#: with ``epoch_micros()`` - a fixture stamped in 2023 would make every record here
#: expired, and every "valid confirmation" case would be a test about expiry instead.
NOW = epoch_micros()
ISSUED = NOW - 2 * DAY
EXPIRES = NOW + 6 * DAY


def confirmation_payload(**overrides: Any) -> dict[str, object]:
    base: dict[str, object] = {
        "instanceId": "exec-test-1",
        "tenantId": "tenant-1",
        "accountId": "account-1",
        "exchange": "BINANCE",
        "symbols": ["BTCUSDT"],
        "orderTypes": ["LIMIT"],
        "issuedAtMicros": ISSUED,
        "expiresAtMicros": EXPIRES,
        "nonce": "0f1e2d3c4b5a6978",
        "digest": "",
    }
    base.update(overrides)
    unsigned = LiveOperatorConfirmation(
        instance_id=str(base["instanceId"]),
        tenant_id=str(base["tenantId"]),
        account_id=str(base["accountId"]),
        exchange=str(base["exchange"]),
        symbols=frozenset(cast("list[str]", base["symbols"])),
        order_types=frozenset(cast("list[str]", base["orderTypes"])),
        issued_at_micros=int(str(base["issuedAtMicros"])),
        expires_at_micros=int(str(base["expiresAtMicros"])),
        nonce=str(base["nonce"]),
    )
    payload = unsigned.with_digest(CONFIRMATION_KEY).to_payload()
    # A test that passes its own ``digest`` is testing tampering, and the payload has to
    # keep the forged value rather than re-sign what it was handed - the whole point of
    # those cases is a record whose signature does not match its content.
    if "digest" in overrides:
        payload["digest"] = overrides["digest"]
    return payload


def settings_with_record(**overrides: Any) -> Settings:
    """Settings carrying a valid, signed confirmation for this test instance."""
    payload = confirmation_payload(**overrides)
    merged: dict[str, object] = dict(BASE_ENV)
    merged.update(
        {
            "EXECUTION_REQUIRE_OPERATOR_CONFIRMATION": "true",
            "EXECUTION_CONFIRMATION_KEY_ENV": "EXECUTION_TEST_CONFIRMATION_KEY",
            "EXECUTION_OPERATOR_CONFIRMATION_JSON": json.dumps(payload),
        }
    )
    return Settings.model_validate(merged)


# ---------------------------------------------------------------------------
# 1. what a deployment may configure
# ---------------------------------------------------------------------------


class TestConfiguration:
    def test_the_requirement_is_off_by_default_and_publishes_that(self) -> None:
        settings = settings_for()
        view = settings.to_public_dict()
        assert settings.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION is False
        assert view["requireOperatorConfirmation"] is False
        assert view["operatorConfirmationSource"] is None
        assert view["confirmationKeyEnvVar"] == "EXECUTION_CONFIRMATION_HMAC_KEY"
        assert settings.operator_confirmation is None
        # The policy the review runs on is unchanged for a deployment that did not ask
        # for Part 19: this is the no-silent-behaviour-change assertion, and it is here
        # rather than only in the core because the flag crosses the boundary in this
        # file - a settings field feeding a policy field is exactly where a default can
        # get inverted without anybody noticing.
        assert settings.placement_policy.require_operator_confirmation is False

    def test_turning_it_on_reaches_the_policy(self) -> None:
        settings = settings_with_record()
        assert settings.placement_policy.require_operator_confirmation is True
        assert settings.operator_confirmation is not None

    def test_a_record_is_required_when_the_check_is_required(self) -> None:
        with pytest.raises(ValidationError, match="supplies no confirmation record"):
            settings_for(("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"))

    def test_two_sources_for_one_ceremony_are_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "confirmation.json"
        path.write_text(json.dumps(confirmation_payload()), encoding="utf-8")
        with pytest.raises(ValidationError, match="both set"):
            settings_for(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_OPERATOR_CONFIRMATION_JSON", json.dumps(confirmation_payload())),
                ("EXECUTION_OPERATOR_CONFIRMATION_FILE", str(path)),
            )

    def test_the_file_form_is_read(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "confirmation.json"
        path.write_text(json.dumps(confirmation_payload()), encoding="utf-8")
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            ("EXECUTION_OPERATOR_CONFIRMATION_FILE", str(path)),
        )
        assert settings.operator_confirmation is not None
        assert settings.to_public_dict()["operatorConfirmationSource"] == "file"

    def test_an_unreadable_file_is_a_boot_failure_not_a_quiet_absence(self) -> None:
        with pytest.raises(ValidationError, match="could not be read"):
            settings_for(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                ("EXECUTION_OPERATOR_CONFIRMATION_FILE", "/nonexistent/confirmation.json"),
            )

    @pytest.mark.parametrize(
        "raw",
        [
            "not json at all",
            '"a string"',
            "[]",
            json.dumps({"instanceId": "exec-test-1"}),
            json.dumps({**confirmation_payload(), "expiresAtMicros": "soon"}),
            json.dumps({**confirmation_payload(), "extraField": 1}),
        ],
    )
    def test_a_malformed_record_fails_boot_with_the_reason(self, raw: str) -> None:
        with pytest.raises(ValidationError):
            settings_for(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                ("EXECUTION_OPERATOR_CONFIRMATION_JSON", raw),
            )

    def test_a_record_minted_for_another_instance_is_refused_at_boot(self) -> None:
        # Not because the per-order check would miss it - it would refuse every order -
        # but because a template copied between deployments is a deployment that starts
        # with a ceremony it cannot complete, and that is a boot message.
        with pytest.raises(ValidationError, match="names instance"):
            settings_for(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                (
                    "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                    json.dumps(confirmation_payload(instanceId="some-other-host")),
                ),
            )

    def test_an_expired_record_still_boots(self) -> None:
        # Deliberate, and the reason the per-order assessment exists: the process still
        # has cancellations, reconciliation and an audit trail to serve, and crashing it
        # on a lapsed confirmation converts an operator lapse into an outage of the only
        # path that can safely close positions. Every ORDER is refused instead.
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload(expiresAtMicros=NOW - DAY)),
            ),
        )
        assert settings.operator_confirmation is not None
        verifier = build_confirmation_verifier(
            settings, environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY}
        )
        assert verifier is not None
        outcome = verifier.assess(
            tenant_id="tenant-1",
            account_id="account-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=NOW,
        )
        assert outcome.state is ConfirmationState.EXPIRED

    def test_the_key_never_appears_in_the_settings_view(self) -> None:
        # What is published is the NAME of the variable, because a reader of /status
        # cannot do anything with a name and nothing with a value they were never sent.
        # The value's safety comes from a stronger property: there is no field that
        # could hold it, so no dump of this model - public or full - can leak it.
        plain = settings_for()
        assert plain.EXECUTION_CONFIRMATION_KEY_ENV == "EXECUTION_CONFIRMATION_HMAC_KEY"
        assert plain.to_public_dict()["confirmationKeyEnvVar"] == (
            "EXECUTION_CONFIRMATION_HMAC_KEY"
        )
        assert "EXECUTION_CONFIRMATION_HMAC_KEY" not in Settings.model_fields
        settings = settings_with_record()
        assert CONFIRMATION_KEY not in json.dumps(settings.to_public_dict())
        assert CONFIRMATION_KEY not in json.dumps(settings.model_dump())

    def test_the_requirement_type_is_enforced(self) -> None:
        # A nested object is not a boolean in any reading, and a "1" is: pydantic
        # coerces the latter, and the coerced answer has to reach the policy intact -
        # with the record present, because a requirement with nothing to require is
        # itself refused (asserted above), and that refusal is the point of it.
        with pytest.raises(ValidationError):
            settings_for(("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "{\"a\": 1}"))
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "1"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        assert settings.placement_policy.require_operator_confirmation is True

    def test_the_key_env_name_is_the_field_this_service_reads(self) -> None:
        # A typo in a name like this is invisible under the model's extra=ignore: the
        # setting would keep its default, the lookup would look for a different
        # variable, and the deployment would be refused at boot for a reason its own
        # configuration appears not to contain. So the name is pinned on both sides.
        settings = settings_with_record()
        assert settings.EXECUTION_CONFIRMATION_KEY_ENV == "EXECUTION_TEST_CONFIRMATION_KEY"
        assert "EXECUTION_CONFIRMATION_KEY_ENV" in Settings.model_fields


# ---------------------------------------------------------------------------
# 2. the verifier this service builds
# ---------------------------------------------------------------------------


class TestVerifierConstruction:
    def test_nothing_required_and_nothing_supplied_builds_nothing(self) -> None:
        assert build_confirmation_verifier(settings_for(), environ={}) is None

    def test_a_missing_key_is_named_by_variable(self) -> None:
        with pytest.raises(ValueError, match="EXECUTION_TEST_CONFIRMATION_KEY is not set"):
            build_confirmation_verifier(settings_with_record(), environ={})

    def test_a_blank_key_is_the_same_refusal(self) -> None:
        with pytest.raises(ValueError, match="not set or is blank"):
            build_confirmation_verifier(
                settings_with_record(), environ={"EXECUTION_TEST_CONFIRMATION_KEY": "   "}
            )

    def test_a_short_key_is_refused_because_it_is_guessable(self) -> None:
        with pytest.raises(ValueError, match="at least 32 characters"):
            build_confirmation_verifier(
                settings_with_record(), environ={"EXECUTION_TEST_CONFIRMATION_KEY": "short"}
            )

    def test_a_supplied_record_with_no_requirement_still_needs_a_key(self) -> None:
        # The record is only meaningful if somebody can check it; accepting an
        # unverifiable one because "the check is off" would let a stale file sit in a
        # deployment until the day the check is turned on and the file is wrong.
        settings = settings_for(
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
        )
        assert settings.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION is False
        with pytest.raises(ValueError, match="no signature"):
            build_confirmation_verifier(settings, environ={})
        built = build_confirmation_verifier(
            settings, environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY}
        )
        assert built is not None and built.required is False and built.record is not None

    def test_the_process_environment_is_the_default_source(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_CONFIRMATION_HMAC_KEY", CONFIRMATION_KEY)
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        assert build_confirmation_verifier(settings) is not None

    def test_the_verifier_is_scoped_to_this_deployment(self) -> None:
        built = build_confirmation_verifier(
            settings_with_record(), environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY}
        )
        # The builder answers None when nothing is required, so saying it is here is
        # part of the assertion, not a courtesy for the type checker.
        assert built is not None
        assert built.instance_id == "exec-test-1"
        assert built.exchange == "BINANCE"
        assert built.required is True


# ---------------------------------------------------------------------------
# 3. the reviewer, the wiring view, and the boot log
# ---------------------------------------------------------------------------


class TestReviewerWiring:
    def describe(self, *overrides: tuple[str, object]) -> dict[str, Any]:
        settings = settings_for(*overrides)
        wiring = build_placement_reviewer(
            settings,
            will_transmit_orders=False,
            environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY},
        )
        # ``Any`` rather than ``object``: the assertions below read a nested block, and
        # casting at every level would be noise. The shape itself is pinned exactly, so
        # the looseness buys nothing that a wrong key would hide.
        return cast("dict[str, Any]", wiring.describe())

    def test_the_wiring_reports_the_confirmation_block_always_and_whole(self) -> None:
        bare = self.describe()["operatorConfirmation"]
        wired = self.describe(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )["operatorConfirmation"]
        assert bare == {
            "required": False,
            "keyConfigured": False,
            "recordPresent": False,
            "expiresAtMicros": 0,
            "fingerprint": "",
        }
        assert set(wired) == set(bare)
        assert wired["required"] is True
        assert wired["recordPresent"] is True
        # A fingerprint is a correlation handle, not the signature: twelve hex
        # characters, so an audit line can be tied to the ceremony without the MAC
        # leaving the process.
        assert len(str(wired["fingerprint"])) == 12

    def test_the_confirmation_is_visible_on_the_wiring_object_itself(self) -> None:
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        wiring = build_placement_reviewer(
            settings,
            will_transmit_orders=False,
            environ={"EXECUTION_TEST_CONFIRMATION_KEY": CONFIRMATION_KEY},
        )
        assert wiring.confirmation_configured is True
        assert wiring.reviewer.confirmation_verifier is not None
        assert isinstance(wiring.reviewer.policy, PlacementReviewPolicy)

    def test_the_boot_log_carries_presence_and_no_material(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger="app.placement"):
            self.describe(
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                (
                    "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                    json.dumps(confirmation_payload()),
                ),
            )
        events = [
            record
            for record in caplog.records
            if getattr(record, "event", "") == "execution_engine.placement_review_wired"
        ]
        assert len(events) == 1
        assert events[0].__dict__["requireOperatorConfirmation"] is True
        assert events[0].__dict__["operatorConfirmationConfigured"] is True
        assert CONFIRMATION_KEY not in caplog.text
        assert "digest" not in caplog.text
        assert "nonce" not in caplog.text

    def test_a_policy_that_requires_a_verifier_and_gets_none_is_a_boot_failure(self) -> None:
        settings = settings_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        with pytest.raises(ValueError, match="EXECUTION_TEST_CONFIRMATION_KEY is not set"):
            build_placement_reviewer(settings, will_transmit_orders=False, environ={})


# ---------------------------------------------------------------------------
# 4. the composed runtime, the status surfaces, and the live refusal
# ---------------------------------------------------------------------------


class TestComposedRuntime:
    def setUpEnv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # ``build_runtime`` reads the process environment for the key (the whole point
        # of it being env-only), so a composed-runtime test has to put it there rather
        # than pass it in - which is also what makes the test the real thing.
        monkeypatch.setenv("EXECUTION_TEST_CONFIRMATION_KEY", CONFIRMATION_KEY)

    def test_live_still_refuses_with_a_perfect_confirmation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The regression Part 19 must not break, in the strongest form available.

        Everything the operator confirmation can supply is supplied and valid, the
        credential plumbing is named, and the mode is live: the process still refuses
        to start, and the sentence says why in terms of what is genuinely absent -
        a signed transport, and a venue attestor over it.
        """
        self.setUpEnv(monkeypatch)
        runtime, _ = runtime_for()
        assert runtime.live_enablement is not None
        with pytest.raises(Exception, match="not wired in this build") as caught:
            runtime_for(
                ("EXECUTION_MODE", "live"),
                ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
                ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
                (
                    "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                    json.dumps(confirmation_payload()),
                ),
            )
        message = str(caught.value)
        # Part 20: signed transport is now wired. The confirmation was accepted -
        # and it is said so, in the satisfied list. The refusal still stands
        # because other prerequisites (credential source, venue attestor) are
        # missing in this test environment.
        assert "operator confirmation accepted" in message.split("satisfied:")[1].split(".")[0]
        assert "No order was sent" in message
        assert runtime.live_enablement is not None

    def test_a_confirmation_in_window_grades_satisfied_at_boot(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self.setUpEnv(monkeypatch)
        runtime, _ = runtime_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload()),
            ),
        )
        report = runtime.live_enablement
        assert report is not None
        assert "OPERATOR_CONFIRMATION_ACCEPTED" in {
            prerequisite.name for prerequisite in report.satisfied
        }
        # Part 20: signed transport is now wired. Live is still refused because
        # other prerequisites (credential source) are missing in this test.
        assert report.blocks_live
        # SIGNED_TRANSPORT_WIRED is now satisfied, not missing
        assert LivePrerequisite.SIGNED_TRANSPORT_WIRED not in report.missing

    def test_an_expired_confirmation_grades_unsatisfied(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The same signed, well-formed record, read one day later: the grading is a
        # clock reading and not a parse, so a lapsed ceremony has to show up here too -
        # otherwise the boot report would tell an operator "confirmation accepted" for
        # a record that refuses every order.
        self.setUpEnv(monkeypatch)
        runtime, _ = runtime_for(
            ("EXECUTION_REQUIRE_OPERATOR_CONFIRMATION", "true"),
            ("EXECUTION_CONFIRMATION_KEY_ENV", "EXECUTION_TEST_CONFIRMATION_KEY"),
            (
                "EXECUTION_OPERATOR_CONFIRMATION_JSON",
                json.dumps(confirmation_payload(expiresAtMicros=NOW - DAY)),
            ),
        )
        report = runtime.live_enablement
        assert report is not None
        assert "OPERATOR_CONFIRMATION_ACCEPTED" in {
            prerequisite.name for prerequisite in report.missing
        }


# ---------------------------------------------------------------------------
# 5. the published surfaces
# ---------------------------------------------------------------------------


def gauges(body: str) -> dict[str, float]:
    """The wiring gauge values this file cares about, by component label.

    Parsed from the rendered text rather than from the registry, because what an
    operator's dashboard reads is the text: a family that exists in the registry and is
    mislabelled in the exposition is exactly the failure a test on the objects misses.
    """
    import re

    found: dict[str, float] = {}
    for line in body.splitlines():
        match = re.match(
            r'wlct_execution_wiring\{component="([a-z_]+)",service="[^"]+"\} ([0-9.]+)',
            line,
        )
        if match and match.group(1) in {"live_credential_fetcher", "operator_confirmation"}:
            found[match.group(1)] = float(match.group(2))
    return found


class TestStatusSurface:
    def test_status_publishes_the_graded_report_and_the_two_wirings(
        self, client: TestClient
    ) -> None:
        body = client.get("/internal/v1/status", headers=_headers()).json()
        assert body["credentialFetcher"] is None
        assert body["operatorConfirmation"] is False
        enablement = body["liveEnablement"]
        assert enablement["liveRefused"] is True
        # Part 20: no hard blockers remain — signed transport is now wired
        assert enablement["hardBlockersPresent"] is False
        # SIGNED_TRANSPORT_WIRED is now satisfied, not missing
        assert "SIGNED_TRANSPORT_WIRED" not in enablement["missing"]
        assert all(code.startswith("LIVE_") for code in enablement["missingCodes"])
        assert enablement["credentialSource"] == "none"
        assert body["placement"]["confirmationConfigured"] is False
        assert set(body["placement"]["operatorConfirmation"]) == {
            "required",
            "keyConfigured",
            "recordPresent",
            "expiresAtMicros",
            "fingerprint",
        }

    def test_ready_carries_the_same_block_unauthenticated_and_no_material(
        self, client: TestClient
    ) -> None:
        body = client.get("/health/ready").json()
        assert body["liveEnablement"]["liveRefused"] is True
        found = {key.lower() for key in json_keys(body)}
        assert found & set(CREDENTIAL_SHAPED_KEYS) == set()
        dumped = json.dumps(body, default=str).lower()
        for word in ("api_secret", "apisecret", "signing_key", "private_key", "nonce"):
            assert word not in dumped

    def test_the_placement_endpoint_reports_the_refusal_for_an_unconfirmed_symbol(
        self, client: TestClient
    ) -> None:
        """The per-order half, over HTTP.

        The endpoint is the surface an operator uses to ask "would this be refused",
        so the whole feature is worth nothing if the answer there and the answer in
        the engine disagree. They are the same code path, and this says so.
        """
        response = client.post(
            "/internal/v1/placement/attest",
            headers=_headers(),
            json={
                "tenantId": "tenant-1",
                "accountId": "account-1",
                "symbol": "SOLUSDT",
                "orderType": "LIMIT",
                "timeInForce": "GTC",
            },
        )
        assert response.status_code == 200
        body = response.json()
        # The deployment this client boots does not transmit, so the venue gap is
        # recorded and not blocking (law 5 of the review) - and the confirmation did not
        # fire at all, because nobody asked for it. The pairing is the point: an
        # unrequired ceremony adds nothing, and the code that would refuse it is absent
        # rather than merely unsatisfied.
        assert body["allowed"] is True
        assert "VENUE_ATTESTATION_REQUIRED" in body["codes"]
        assert body["blockingCodes"] == []
        assert not any(code.startswith("OPERATOR_CONFIRMATION") for code in body["codes"])

    def test_the_wiring_gauge_covers_the_two_new_components(self) -> None:
        hub = hub_for(
            None,
            {
                "credentialFetcher": "vault-kv2",
                "operatorConfirmation": True,
                "placement": {"label": "placement-review"},
            },
        )
        assert gauges(hub.scrape()) == {
            "live_credential_fetcher": 1.0,
            "operator_confirmation": 1.0,
        }
        absent = hub_for(None, {"credentialFetcher": None, "operatorConfirmation": False})
        values = gauges(absent.scrape())
        assert values["live_credential_fetcher"] == 0.0
        assert values["operator_confirmation"] == 0.0

    def test_the_area_counters_are_derived_without_an_exporter_edit(self) -> None:
        # Part 18 derives one family per counter field, both directions equal, so
        # Part 19's seven new fields must show up as seven new families - and the
        # assertion that they do is the proof that no exporter change was needed and
        # that none was forgotten.
        from app.observability import COUNTER_FAMILIES

        families = COUNTER_FAMILIES
        for area in ReviewArea:
            assert f"wlct_execution_placement_blocks_{area.value.lower()}_total" in families
        # Empty families are omitted at scrape time by Part 18's own law, so proving the
        # exposition means proving it with a value on it.
        from tests.test_part18_observability import FakeMetrics

        body = hub_for(FakeMetrics(placement_blocks_confirmation=2), {}).scrape()
        series = 'wlct_execution_placement_blocks_confirmation_total{service="execution-engine"}'
        assert f"{series} 2" in body


def _headers(tenant: str = "tenant-1") -> dict[str, str]:
    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


def _far_future_micros() -> int:
    # Sixty days out from the fixture's epoch: comfortably unexpired, and inside the
    # core's 90-day ceiling on a confirmation window - a test that minted a year-long
    # record would be asserting on a construction error rather than on the grading.
    return ISSUED + 60 * DAY

