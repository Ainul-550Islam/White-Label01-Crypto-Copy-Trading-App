"""Part 16: the credential seam, the placement review, and the surface between.

The rule this service has always tested against is that composition is proven by
booting it, not by reading it - so every test here runs against the real
``build_runtime`` / ``create_app``, with the core's real engine, the real paper
adapter and the real reviewer. The doubles are only the ones that stand in for
things outside this process (a secret manager, an HTTP sender).

What is being pinned, in order of how much it would hurt to lose:

1. nothing transmits. ``EXECUTION_MODE=live`` still refuses at startup, the new
   attestor's venue calls exist but are not reachable from a simulated runtime,
   and the one new endpoint provably places no order.
2. a misconfiguration dies at boot with the environment variable named in the
   message, not at the first order with a stack trace.
3. the review's answer is *data*: a refusal is a 200 with the codes, because an
   error status would hide the evidence inside the transport.
4. no key material reaches a response, a log line, or ``describe()``.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.execution.credentials import (
    CredentialNotFound,
    EnvironmentCredentialProvider,
    ExchangeCredentials,
    NullCredentialProvider,
    SecretManagerCredentialProvider,
)
from wlct_trading.execution.live_enablement import LivePrerequisite
from wlct_trading.execution.placement_attestor import (
    MAX_ATTESTER_TTL_MS,
    LocalPlacementAttestor,
    PlacementReviewer,
    PlacementReviewRequest,
    UnattestedPlacementAttestor,
)
from wlct_trading.execution.placement_review import (
    MAX_KEY_AGE_DAYS,
    MIN_KEY_AGE_DAYS,
    PlacementReviewError,
)

from app.composition import ExecutionUnavailable, build_runtime
from app.credentials import (
    build_credential_provider,
    credential_env_names,
)
from app.placement import build_placement_reviewer, review_placement
from app.routers import placement as placement_router
from app.schemas import (
    PlacementAttestRequest,
    PlacementAttestResponse,
    PlacementStatusView,
    StatusResponse,
)
from tests.conftest import auth_headers
from tests.test_execution_engine import settings_for

REVIEW_PATH = "/internal/v1/placement/attest"


#: Every name a credential has ever been called in this repository, in the shape
#: it would appear in a JSON key. Not a filter and not a redactor: a list this
#: test compares against, so that a field ADDED to describe() or to a response
#: model under one of these names fails here instead of shipping.
CREDENTIAL_SHAPED_KEYS: frozenset[str] = frozenset(
    {
        "apikey",
        "apisecret",
        "secret",
        "credential",
        "credentials",
        "signature",
        "token",
        "privatekey",
        "passphrase",
        "password",
        "authorization",
    }
)


def json_keys(node: object) -> set[str]:
    """Every key name at every depth of a decoded JSON body."""
    if isinstance(node, dict):
        return set(node) | {k for child in node.values() for k in json_keys(child)}
    if isinstance(node, list):
        return {k for child in node for k in json_keys(child)}
    return set()


def runtime_for(*overrides: tuple[str, object]):
    """``build_runtime`` over a Settings object with the given env overrides."""
    settings = settings_for(*overrides)
    return build_runtime(settings), settings


# ---------------------------------------------------------------------------
# 1. the credential seam
# ---------------------------------------------------------------------------


class TestCredentialWiring:
    def test_none_is_the_default_and_it_refuses_every_lookup(self) -> None:
        wiring = build_credential_provider(settings_for())
        assert wiring.source == "none"
        assert isinstance(wiring.provider, NullCredentialProvider)
        # The refusal has to be an instance of the error every caller already
        # catches, or "no credentials" escapes as an unexpected exception.
        with pytest.raises(CredentialNotFound):
            asyncio.run(wiring.provider.resolve("tenant-a", "account-1", None))

    def test_description_carries_the_source_and_nothing_else_secret(self) -> None:
        wiring = build_credential_provider(settings_for())
        view = wiring.describe()
        assert view["source"] == "none"
        assert view["cacheSeconds"] is None
        # ``providerSource`` is read back off the provider, so a wrapper that
        # replaced the provider would be visible here rather than hidden.
        assert view["providerSource"] == "none"
        assert "apiKey" not in json.dumps(view).lower()

    def test_environment_source_reads_the_prefixed_variables(self) -> None:
        settings = settings_for(("EXECUTION_CREDENTIAL_SOURCE", "environment"))
        key_name, secret_name = credential_env_names(settings.EXECUTION_CREDENTIAL_ENV_PREFIX)
        assert (key_name, secret_name) == ("WLCT_BINANCE_API_KEY", "WLCT_BINANCE_API_SECRET")
        wiring = build_credential_provider(
            settings,
            environ={key_name: "ak_live_1234567890", secret_name: "sk_live_abcdefghij"},
        )
        assert wiring.source == "environment"
        assert wiring.cache_seconds == settings.EXECUTION_CREDENTIAL_CACHE_SECONDS
        # Cached, so the provider is wrapped; the label still says where the
        # material came from, because /status must not describe the wrapper.
        # The wrapper is visible in the label, and the object behind it is
        # reachable: "cached(...)" alone would let a second, unintended wrapper
        # pass as the intended one.
        assert wiring.provider.source.startswith("cached(")
        assert isinstance(wiring.provider.inner, EnvironmentCredentialProvider)
        resolved = asyncio.run(
            wiring.provider.resolve(
                settings.EXECUTION_CREDENTIAL_TENANT_ID,
                settings.EXECUTION_CREDENTIAL_ACCOUNT_ID,
                wiring.provider.default_exchange,
            )
        )
        assert isinstance(resolved, ExchangeCredentials)
        # The value survives use and does not survive rendering.
        assert repr(resolved).find("sk_live_abcdefghij") == -1
        assert "sk_live_abcdefghij" not in json.dumps(wiring.describe(), default=str)

    def test_a_prefix_with_a_trailing_underscore_refuses_to_start(self) -> None:
        # The name is built by appending "_API_KEY", so "ACME_" would look for
        # "ACME__API_KEY". Refused at boot instead of normalised, because a
        # check that quietly disagrees with the code it guards is worse than no
        # check: it turns a missing variable into a passing startup.
        with pytest.raises(Exception, match="must not end in an underscore"):
            settings_for(
                ("EXECUTION_CREDENTIAL_SOURCE", "environment"),
                ("EXECUTION_CREDENTIAL_ENV_PREFIX", "ACME_"),
            )

    def test_the_names_this_service_checks_are_the_names_the_provider_reads(self) -> None:
        # The one test that makes the check above more than a coincidence: the
        # provider's own refusal is asked what it wanted, for the default prefix
        # and for a hand-written one.
        for prefix in ("WLCT_BINANCE", "wlct_binance_", "ACME"):
            expected = credential_env_names(prefix)
            provider = EnvironmentCredentialProvider(
                {},
                tenant_id="tenant-a",
                account_id="account-a",
                prefix=prefix,
            )
            with pytest.raises(CredentialNotFound) as caught:
                asyncio.run(provider.resolve("tenant-a", "account-a", provider.default_exchange))
            message = str(caught.value)
            assert all(name in message for name in expected), (prefix, message)

    def test_environment_source_refuses_when_a_variable_is_absent(self) -> None:
        # Not "resolve later and fail per order": the boot check names both
        # variables so the operator fixes them in one edit.
        settings = settings_for(("EXECUTION_CREDENTIAL_SOURCE", "environment"))
        with pytest.raises(ValueError, match="WLCT_BINANCE_API_KEY"):
            build_credential_provider(settings, environ={})

    def test_environment_source_is_refused_in_production(self) -> None:
        # The refusal is at Settings construction, so no caller - including one
        # that never reaches this builder - can end up with the combination.
        with pytest.raises(Exception, match="refused in production"):
            settings_for(
                ("EXECUTION_CREDENTIAL_SOURCE", "environment"),
                ("NODE_ENV", "production"),
            )
        # and the same config in a non-production node environment is accepted,
        # which is what makes the refusal a policy rather than a parse failure
        settings_for(("EXECUTION_CREDENTIAL_SOURCE", "environment"))

    def test_secret_manager_source_needs_an_injected_fetcher(self) -> None:
        settings = settings_for(("EXECUTION_CREDENTIAL_SOURCE", "secret-manager"))
        with pytest.raises(ValueError, match="secret fetcher"):
            build_credential_provider(settings)

        async def fetch(tenant_id: str, account_id: str, exchange: Any) -> None:
            return None

        wiring = build_credential_provider(settings, secret_fetcher=fetch)
        assert isinstance(wiring.provider.inner, SecretManagerCredentialProvider)
        assert wiring.source == "secret-manager"


# ---------------------------------------------------------------------------
# 2. the reviewer's construction, and the config that feeds it
# ---------------------------------------------------------------------------


class TestPlacementWiring:
    def test_simulated_runtime_gets_the_local_gatherer_and_no_venue_claim(self) -> None:
        settings = settings_for()
        credentials = build_credential_provider(settings)
        wiring = build_placement_reviewer(
            settings, will_transmit_orders=False, credential_provider=credentials.provider
        )
        assert wiring.mode == "local"
        assert wiring.requires_venue_attestation is False
        assert wiring.cache_ttl_ms == settings.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS
        description = wiring.describe()
        assert description["attestorSource"].startswith("local:")
        # The cache is between the reviewer and the gatherer, so the source the
        # reviewer reports is the cached gatherer's label, not the reviewer's.
        assert description["cache"]["ttlMillis"] == wiring.cache_ttl_ms

    def test_no_gatherer_at_all_is_not_the_same_as_a_permissive_one(self) -> None:
        settings = settings_for()
        wiring = build_placement_reviewer(settings, will_transmit_orders=False)
        assert wiring.mode == "unattested"
        assert isinstance(wiring.reviewer.attestor.inner, UnattestedPlacementAttestor)
        _, verdict = asyncio.run(
            review_placement(
                wiring,
                tenant_id="tenant-a",
                account_id="account-1",
                symbol="BTC-USDT",
            )
        )
        # A simulated runtime may proceed on "we have nothing", but it must say
        # so: one recorded finding is the whole difference between this and a
        # review that quietly passed. The code is the true cause
        # (NO_ATTESTATION), not a proxy, and the severity is the mode's answer.
        assert verdict.allowed is True
        assert verdict.codes == ("NO_ATTESTATION",)
        assert verdict.findings[0].severity.value == "INFO"

    def test_a_transmitting_runtime_refuses_a_local_gatherer(self) -> None:
        settings = settings_for()
        with pytest.raises(ValueError, match="configuration is not permission"):
            build_placement_reviewer(
                settings,
                will_transmit_orders=True,
                credential_provider=build_credential_provider(settings).provider,
            )

    def test_a_transmitting_runtime_with_a_venue_gatherer_is_allowed_to_exist(self) -> None:
        settings = settings_for()
        wiring = build_placement_reviewer(
            settings,
            will_transmit_orders=True,
            venue_attestor=LocalPlacementAttestor(),
        )
        assert wiring.requires_venue_attestation is True
        assert wiring.mode == "venue"

    def test_the_same_gatherer_failure_is_info_here_and_a_refusal_live(self) -> None:
        """One gatherer, two runtimes, two answers - decided by the mode.

        This is the pairing the whole design rests on: the review must not be
        able to authorise a live order on an error, and must not lock a paper
        deployment out because a venue it will never call is unreachable. If a
        future change makes the two assertions agree with each other, this test
        is the one that notices.
        """
        class Exploding(LocalPlacementAttestor):
            async def attest(self, request: PlacementReviewRequest):
                raise RuntimeError("the venue is on fire")

        settings = settings_for()

        async def run(wiring):
            return await review_placement(
                wiring,
                tenant_id="tenant-a",
                account_id="account-1",
                symbol="BTC-USDT",
            )

        paper_wiring = build_placement_reviewer(
            settings, will_transmit_orders=False, venue_attestor=Exploding()
        )
        _, paper = asyncio.run(run(paper_wiring))
        assert paper.allowed is True
        assert paper.codes == ("ATTESTATION_UNREACHABLE",)
        assert paper.findings[0].severity.value == "INFO"

        _, live = asyncio.run(
            run(
                build_placement_reviewer(
                    settings, will_transmit_orders=True, venue_attestor=Exploding()
                )
            )
        )
        assert live.allowed is False
        assert live.codes == ("ATTESTATION_UNREACHABLE",)
        assert live.findings[0].severity.value == "BLOCKING"
        # Retryable in both: the venue being on fire is not an operator action.
        assert live.retryable is True

    def test_the_reviewer_never_raises_even_when_the_gatherer_does(self) -> None:
        class Broken(LocalPlacementAttestor):
            @property
            def source(self) -> str:
                raise RuntimeError("the source property itself is broken")

            async def attest(self, request: PlacementReviewRequest):
                raise RuntimeError("no answer")

        wiring = build_placement_reviewer(
            settings_for(),
            will_transmit_orders=True,
            venue_attestor=Broken(),
        )
        _, verdict = asyncio.run(
            review_placement(
                wiring, tenant_id="tenant-a", account_id="account-1", symbol="BTC-USDT"
            )
        )
        assert verdict.allowed is False
        # A gatherer whose ``source`` property also explodes must not escape as an
        # exception: the label degrades, the refusal stands.
        assert verdict.codes[0] == "ATTESTATION_UNREACHABLE"

    def test_ttl_and_key_age_bounds_are_the_cores(self) -> None:
        with pytest.raises(Exception, match="EXECUTION_PLACEMENT_ATTESTATION_TTL_MS"):
            settings_for(("EXECUTION_PLACEMENT_ATTESTATION_TTL_MS", MAX_ATTESTER_TTL_MS + 1))
        with pytest.raises(Exception, match="EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS"):
            settings_for(("EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS", MAX_KEY_AGE_DAYS + 1))
        # The lower bound is checked by the same path, and is not off by one.
        settings_for(("EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS", MIN_KEY_AGE_DAYS))
        with pytest.raises(Exception, match="EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS"):
            settings_for(("EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS", MIN_KEY_AGE_DAYS - 1))

    def test_live_without_the_ip_allowlist_refuses_to_start(self) -> None:
        # ``settings_for`` validates, so the refusal is expected there: a boot
        # that produced a Settings object would mean the check is not on the
        # construction path and could be skipped by any other entry point.
        with pytest.raises(Exception, match="EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST"):
            settings_for(
                ("EXECUTION_MODE", "live"),
                ("EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST", "false"),
            )

    def test_a_simulated_runtime_may_still_ask_for_the_allowlist_to_be_off(self) -> None:
        settings = settings_for(
            ("EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST", "false"),
        )
        assert settings.placement_policy.require_ip_allowlist is False

    def test_the_policy_is_built_by_the_core_law_not_by_this_service(self) -> None:
        # The service's own bounds are the core's constants (imported, never
        # retyped), and the core policy is constructed during validation so its
        # law has the last word: a deployment can never hand the endpoint a
        # policy that treats every attestation as fresh.
        from wlct_trading.execution.placement_attestor import MIN_ATTESTER_TTL_MS
        from wlct_trading.execution.placement_review import MIN_ATTESTATION_AGE_MS

        assert MIN_ATTESTER_TTL_MS == MIN_ATTESTATION_AGE_MS
        with pytest.raises(Exception, match="must be within"):
            settings_for(("EXECUTION_PLACEMENT_ATTESTATION_TTL_MS", "1"))
        assert issubclass(PlacementReviewError, Exception)


# ---------------------------------------------------------------------------
# 3. the composed runtime, still dark
# ---------------------------------------------------------------------------


class TestComposedRuntime:
    def test_live_still_refuses_and_says_what_is_actually_missing(self) -> None:
        with pytest.raises(ExecutionUnavailable, match="not wired in this build") as caught:
            build_runtime(settings_for(("EXECUTION_MODE", "live")))
        message = str(caught.value)
        # Both halves of Part 16's premise are named as DONE, and the thing that
        # is genuinely absent is named too: this service never constructs a
        # venue adapter. A message that claimed "the review is unfinished" after
        # this part shipped would be a lie with a test behind it.
        #
        # Part 19 re-homed the first two assertions rather than relaxing them: the
        # sentence is now computed from the graded wiring, so what used to be checked
        # by prose ("does the paragraph mention credentials and durability") is
        # checked by the report the prose is generated from. That is a strictly
        # stronger pin - a hand-written message can mention a part it does not have,
        # and a graded one cannot, because the words come from the check's own result.
        assert "credential" in message and "durable" in message
        assert "venue attestor wired" in message
        assert "signed HTTP transport" in message
        # And the report the sentence was built from says what the reference
        # deployment actually is: a simulated runtime with a memory store and
        # in-process locks is NOT "close to live", and an operator who read the
        # satisfied half of a hand-written paragraph could easily have concluded that
        # it was. The grading is the difference - a memory store is reported as the
        # absence of durability, because that is what it is.
        report = build_runtime(settings_for(("EXECUTION_MODE", "simulated"),)).live_enablement
        assert report is not None
        assert {prerequisite.name for prerequisite in report.satisfied} == {
            "IP_ALLOWLIST_ENFORCED",
            "SIGNED_TRANSPORT_WIRED",
        }
        missing = {prerequisite.name for prerequisite in report.missing}
        assert {
            "CREDENTIAL_SOURCE_CONFIGURED",
            # ...and with no source selected there is no fetcher either: the two
            # items are separate prerequisites precisely so that "a source is named"
            # and "the named source can be read" cannot be reported as one fact.
            "CREDENTIAL_FETCHER_WIRED",
            "DURABLE_STORE_WIRED",
            "DISTRIBUTED_LOCKS_WIRED",
            "VENUE_ATTESTOR_WIRED",
            "OPERATOR_CONFIRMATION_ACCEPTED",
        } == missing
        # Part 20: SIGNED_TRANSPORT_WIRED is now satisfied — the composition root
        # constructs a real key registry and transport.
        assert LivePrerequisite.SIGNED_TRANSPORT_WIRED not in report.missing
        # No hard blockers remain
        assert not report.hard_blockers_present
        assert report.blocks_live

    def test_simulated_runtime_carries_a_reviewer_into_the_engine(self) -> None:
        runtime, _ = runtime_for()
        assert runtime.placement.mode == "local"
        engine = runtime.engine
        reviewer: PlacementReviewer = engine._placement_reviewer
        assert isinstance(reviewer, PlacementReviewer)
        assert reviewer.requires_venue_attestation is False

    def test_status_publishes_the_wiring_without_publishing_a_key(self) -> None:
        runtime, _ = runtime_for()
        description = runtime.describe()
        assert description["credentialSource"] == "none"
        assert description["placement"]["mode"] == "local"
        assert description["placement"]["requiresVenueAttestation"] is False
        dumped = json.dumps(description, default=str).lower()
        for secret_word in ("api_secret", "apisecret", "signing_key", "private_key"):
            assert secret_word not in dumped

    def test_the_caching_wrappers_own_ttl_is_the_configured_one(self) -> None:
        runtime, settings = runtime_for(
            ("EXECUTION_PLACEMENT_ATTESTATION_TTL_MS", "45000"),
        )
        stats = runtime.placement.reviewer.attestor.stats()
        assert stats["ttlMillis"] == 45_000 == settings.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS
        # Failures are evicted sooner than successes are refreshed, so a venue
        # outage slows reviews down instead of locking them out for a window.
        assert stats["failureTtlMillis"] < stats["ttlMillis"]


# ---------------------------------------------------------------------------
# 4. the endpoint
# ---------------------------------------------------------------------------


class TestAttestEndpoint:
    def test_a_refusal_on_a_paper_runtime_is_reported_as_data(self, client: TestClient) -> None:
        response = client.post(
            REVIEW_PATH,
            headers=auth_headers("tenant-a"),
            json={
                "tenantId": "tenant-a",
                "accountId": "account-1",
                "symbol": "BTC-USDT",
                "orderType": "LIMIT",
                "timeInForce": "GTC",
            },
        )
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        assert body["transmitted"] is False
        assert body["verdictId"]
        assert body["attestorSource"].startswith("local:")
        assert body["reviewRequiredAtMicros"] > 0
        # A simulated runtime answers, and says what it could not answer.
        assert "VENUE_ATTESTATION_REQUIRED" in body["codes"]
        assert body["blockingCodes"] == []
        assert body["allowed"] is True
        assert body["payload"]["verdictId"] == body["verdictId"]
        # The wire spelling of the three claims matches the durable event's,
        # because both come out of ``to_event_payload`` and nothing re-derives
        # them - a second spelling is a second contract.
        assert set(body["payload"]) >= {
            "verdictId",
            "venueTradingPermitted",
            "noKnownWithdrawalPath",
            "reviewRequiredAtMicros",
        }

    def test_it_places_no_order_and_creates_no_record(self, client: TestClient) -> None:
        runtime = client.app.state.runtime
        before = runtime.store.order_count()
        client.post(
            REVIEW_PATH,
            headers=auth_headers("tenant-a"),
            json={"tenantId": "tenant-a", "accountId": "account-1", "symbol": "ETH-USDT"},
        )
        assert runtime.store.order_count() == before
        # The defaults are asserted rather than assumed: the endpoint's shape is
        # a spot limit order, which is what an operator typing curl means.
        request = PlacementAttestRequest(
            tenantId="tenant-a", accountId="account-1", symbol="eth-usdt"
        )
        assert (request.order_type, request.time_in_force) == ("LIMIT", "GTC")
        assert request.symbol == "ETH-USDT"

    def test_the_review_is_cached_across_requests(self, client: TestClient) -> None:
        attestor = client.app.state.runtime.placement.reviewer.attestor
        before = attestor.stats()["misses"]
        for _ in range(3):
            client.post(
                REVIEW_PATH,
                headers=auth_headers("tenant-a"),
                json={"tenantId": "tenant-a", "accountId": "account-1", "symbol": "BTC-USDT"},
            )
        stats = attestor.stats()
        assert stats["misses"] == before + 1
        assert stats["hits"] == 2

    def test_it_needs_the_internal_token_and_the_matching_tenant(self, client: TestClient) -> None:
        body = {"tenantId": "tenant-a", "accountId": "a", "symbol": "BTC-USDT"}
        assert client.post(REVIEW_PATH, json=body).status_code == 401
        wrong = {"x-internal-token": auth_headers()["x-internal-token"], "x-tenant-id": "tenant-b"}
        assert client.post(REVIEW_PATH, headers=wrong, json=body).status_code == 403

    def test_a_malformed_body_is_refused_before_any_gathering(self, client: TestClient) -> None:
        for bad in (
            {"tenantId": "tenant-a", "accountId": "a", "symbol": ""},
            {
                "tenantId": "tenant-a",
                "accountId": "a",
                "symbol": "BTC-USDT",
                "quantity": 1,
            },
            {"tenantId": "tenant-a", "accountId": "a", "symbol": "BTC;USDT"},
        ):
            response = client.post(
                REVIEW_PATH, headers=auth_headers("tenant-a"), json=bad
            )
            assert response.status_code == 422

    def test_the_response_model_has_no_field_a_key_could_fit_into(self) -> None:
        # Not "we promise not to return a secret": the shape itself has nowhere to
        # put one, and this test fails the day someone adds a credential view.
        fields = set(PlacementAttestRequest.model_fields) | set(
            PlacementAttestResponse.model_fields
        )
        assert not {name.lower() for name in fields} & {
            "apikey",
            "apisecret",
            "secret",
            "credentials",
            "signedpayload",
        }

    def test_the_endpoint_survives_a_gatherer_that_raises(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        runtime = client.app.state.runtime
        inner = runtime.placement.reviewer.attestor.inner

        async def explode(request: PlacementReviewRequest):
            raise RuntimeError("the venue is on fire")

        monkeypatch.setattr(inner, "attest", explode)
        response = client.post(
            REVIEW_PATH,
            headers=auth_headers("tenant-a"),
            json={"tenantId": "tenant-a", "accountId": "account-1", "symbol": "BTC-USDT"},
        )
        assert response.status_code == 200
        body = response.json()
        # Simulated runtime: recorded, not enforced. A live runtime's version of
        # this same explosion is the pairing test above, where it blocks.
        assert body["allowed"] is True
        assert body["codes"] == ["ATTESTATION_UNREACHABLE"]
        assert body["findings"][0]["severity"] == "INFO"
        assert body["transmitted"] is False


# ---------------------------------------------------------------------------
# 5. drift parity with the rest of the platform
class TestStatusExposesTheWiring:
    """``/status`` must be able to answer "what was this runtime wired to believe".

    The review's answer is on the wire (the attest endpoint) and the review's
    POSTURE is on a different one. That split is a bug waiting to happen: an
    operator reading a refusal needs to know whether the process even has a
    credential source, and the worker asserts against this same surface before it
    forwards anything, so a posture that is not published here is a posture the
    platform is guessing at.
    """

    def test_the_status_body_carries_the_placement_block(self, client: TestClient) -> None:
        body = client.get("/internal/v1/status", headers=auth_headers("tenant-a")).json()
        assert body["credentialSource"] == "none"
        placement = body["placement"]
        assert placement["label"] == "placement-review"
        assert placement["mode"] == "local"
        assert placement["requiresVenueAttestation"] is False
        assert placement["attestorSource"] == "local:in-process"
        assert placement["cacheTtlMillis"] == 300_000
        # The bounds are published as configured, because the two most common
        # reasons for a blocked order are a stale attestation and a key older
        # than MAX_KEY_AGE_DAYS - both of which are numbers an operator is
        # supposed to be able to read without opening the source.
        policy = placement["policy"]
        assert policy["maxAttestationAgeMillis"] == 300_000
        assert policy["maxKeyAgeDays"] == 90
        assert policy["requireIpAllowlist"] is True
        # And the cache block exists because the caching wrapper is what this
        # service composes; its absence would mean the runtime is not caching.
        assert placement["cache"]["failuresCached"] == 0

    def test_the_body_is_the_describe_output_key_for_key(self, client: TestClient) -> None:
        """The router translates; it is not allowed to editorialise.

        Walked off ``describe()`` rather than off a written-out expectation, so the
        day a field is added to the description and the response, this test stops
        meaning anything ONLY if the two also stay equal - which is the property
        that matters. The two deliberate exceptions are spelled out below, because
        an undocumented coercion in a status surface is how a dashboard starts
        lying.
        """
        wiring = client.app.state.runtime.describe()
        body = client.get(
            "/internal/v1/status", headers=auth_headers("tenant-a")
        ).json()
        for key, value in wiring.items():
            if key == "instanceId":
                # None is "not configured"; the body's "" is the same statement in
                # a field the worker compares against its own string config.
                assert body[key] == str(value or "")
            elif key == "commands":
                assert body[key] == sorted(value)
            else:
                assert body[key] == value, key

    def test_no_credential_shaped_key_or_value_reaches_the_body(
        self, client: TestClient
    ) -> None:
        body = client.get("/internal/v1/status", headers=auth_headers("tenant-a")).json()
        found = {k.lower() for k in json_keys(body)}
        assert found & set(CREDENTIAL_SHAPED_KEYS) == set()
        dumped = json.dumps(body, default=str).lower()
        for word in ("api_secret", "apisecret", "signing_key", "private_key", "bearer"):
            assert word not in dumped

    def test_everything_described_is_published_and_nothing_else(self, client: TestClient) -> None:
        """The two key sets must agree in BOTH directions.

        Underside of the ``extra="forbid"`` choice on the view: a fact added to
        ``describe()`` without a matching field here is a failure in this test, not
        a 500 in production and not a silently unpublished fact.
        """
        wiring = client.app.state.runtime.describe()
        status_aliases = {
            field.alias or name for name, field in StatusResponse.model_fields.items()
        }
        # `simulated` is the only field with no describe() counterpart, and it is
        # the worker's legacy assertion, kept for exactly that reason.
        assert set(wiring) == status_aliases - {"simulated"}
        placement_aliases = {
            field.alias or name for name, field in PlacementStatusView.model_fields.items()
        }
        assert set(wiring["placement"]) == placement_aliases

    def test_ready_mirrors_the_wiring_and_is_the_surface_with_no_token(
        self, client: TestClient
    ) -> None:
        """``/health/ready`` answers with the SAME dict, unauthenticated.

        That is the shipped design and not an oversight: Part 13 pinned
        ``storeBackend`` there for exactly the reason an orchestrator needs it -
        a probe cannot be asked for a service token it was never given. The
        consequence is that the placement block reaches a caller with no
        credentials, which is safe only while ``describe()`` is secret-free by
        construction. So this is the test that makes that true rather than
        observed: every described key must appear (no filtering nobody asked
        for), the placement block must arrive whole, and nothing
        credential-shaped may appear at any depth of the body.
        """
        wiring = client.app.state.runtime.describe()
        body = client.get("/health/ready").json()
        assert body["status"] == "ready"
        for key in wiring:
            assert key in body, f"/health/ready dropped {key}"
        assert body["credentialSource"] == wiring["credentialSource"]
        assert body["placement"] == wiring["placement"]
        found = {k.lower() for k in json_keys(body)}
        assert found & set(CREDENTIAL_SHAPED_KEYS) == set()
        dumped = json.dumps(body, default=str).lower()
        for word in ("api_secret", "apisecret", "signing_key", "private_key"):
            assert word not in dumped

    def test_the_view_refuses_a_key_the_contract_does_not_have(self) -> None:
        """A credential cannot be smuggled in through the pass-through dict."""
        from app.placement import REVIEW_ENDPOINT_LABEL

        with pytest.raises(ValidationError, match="apiSecret"):
            PlacementStatusView(
                label=REVIEW_ENDPOINT_LABEL,
                mode="local",
                requires_venue_attestation=False,
                cacheTtlMillis=1,
                attestorSource="local:in-process",
                policy={},
                apiSecret="nope",
            )

    def test_an_older_engine_reads_as_unproven_not_as_wired_with_nothing(self) -> None:
        """The defaults describe silence, not a state of the world.

        ``placement is None`` is "this engine did not answer the question";
        ``attestorSource == "unattested"`` is "the question was answered: no venue
        is behind this review". Collapsing the two would let a pre-Part-16
        deployment be reported as a reviewed one.
        """
        minimal = StatusResponse(
            instance_id="i",
            mode="simulated",
            dry_run=True,
            adapter="PaperTradingAdapter",
            store="InMemoryOrderStore",
            store_durable=False,
            store_backend="memory",
            retention_enabled=False,
            retention_event_days=90,
            enablement_max_age_days=30,
            credential_source="none",
            locks_distributed=False,
            commands=[],
        )
        assert minimal.placement is None
        assert minimal.simulated is True


# ---------------------------------------------------------------------------


class TestPlacementDriftParity:
    def test_the_route_lives_only_on_the_internal_prefix(self) -> None:
        assert placement_router.router.prefix == "/internal/v1"
        paths = [route.path for route in placement_router.router.routes]
        assert paths == [REVIEW_PATH]

    def test_the_worker_never_forwards_it(self) -> None:
        from tests.test_part15_drift_parity import ENGINE_CLIENT  # local import: path constant

        client_source = ENGINE_CLIENT.read_text(encoding="utf-8")
        assert REVIEW_PATH not in client_source

    def test_the_shipped_defaults_are_inside_the_cores_bounds(self) -> None:
        settings = settings_for()
        policy = settings.placement_policy
        assert MIN_KEY_AGE_DAYS <= policy.max_key_age_days <= MAX_KEY_AGE_DAYS
        assert 0 < settings.EXECUTION_CREDENTIAL_CACHE_SECONDS
        assert policy.require_ip_allowlist is True

    def test_the_handover_document_states_the_gate_it_added(self) -> None:
        from tests.test_part15_drift_parity import ROOT

        doc = ROOT / "docs" / "PART16_PLACEMENT_REVIEW.md"
        assert doc.exists(), "Part 16 ships a gate, so it ships its document"
        text = doc.read_text(encoding="utf-8")
        assert "PLACEMENT_ATTESTED" in text
        assert "11" in text
        assert "not wired in this build" in text
