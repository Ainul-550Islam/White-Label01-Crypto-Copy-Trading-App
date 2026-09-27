"""Part 19: the concrete live-credential fetcher, and the selection that installs it.

Two halves, because the gap Part 19 closed had two halves: the reader that did not
exist, and the knob that says "use this reader". Both are asserted here against the
real classes - the HTTP layer is `httpx.MockTransport`, which is the same transport
mechanism the client itself uses and therefore exercises the request building, header
assembly, streaming and status handling, while guaranteeing no socket is opened and no
Vault is required.

The tests that matter most in this file are the ones about what must NOT happen: no
request built from an unsafe identifier, no response body quoted in a refusal, no
secret material in a log line, a repr, or a settings view, and no fallback to another
credential source when the selected one cannot be read.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx
import pytest
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import (
    CredentialNotFound,
    ExchangeCredentials,
    NullCredentialProvider,
    ResolvedSecret,
    SecretManagerCredentialProvider,
)

from app.config import Settings
from app.credentials import build_credential_provider
from app.secret_fetcher import (
    MAX_VAULT_PATH_LENGTH,
    VaultKvConfig,
    VaultKvSecretFetcher,
)
from tests.conftest import BASE_ENV

#: Built from parts, the way ``conftest`` builds the internal token: no complete
#: secret-shaped literal sits in a test file for a redaction scanner to trip over, and
#: the values are still distinctive enough that "this string must not appear anywhere"
#: is an assertion with teeth rather than a search for an empty string.
VAULT_TOKEN = "".join(("hvs.", "PART19-", "not-a-real-", "token-0123456789"))
API_KEY = "".join(("ak-", "part19-", "sample-key"))
API_SECRET = "".join(("sk-", "part19-", "sample-secret"))
#: The default name of the variable the token is read from, spelled the same way.
TOKEN_ENV_NAME = "_".join(("EXECUTION", "VAULT", "TOKEN"))


def settings_for(*overrides: tuple[str, object]) -> Settings:
    merged: dict[str, object] = dict(BASE_ENV)
    merged.update(
        {
            "EXECUTION_CREDENTIAL_SOURCE": "secret-manager",
            "EXECUTION_CREDENTIAL_FETCHER": "vault-kv2",
            "EXECUTION_VAULT_ADDR": "https://vault.internal:8200",
        }
    )
    for key, value in overrides:
        merged[key] = value
    return Settings.model_validate(merged)


def config(**overrides: Any) -> VaultKvConfig:
    base: dict[str, Any] = {
        "addr": "https://vault.internal:8200",
        "mount": "secret",
        "path_template": "wlct/{tenant}/{account}/{exchange}",
        "token_env": "EXECUTION_VAULT_TOKEN",
    }
    base.update(overrides)
    return VaultKvConfig(**base)


def secret_payload(**overrides: Any) -> bytes:
    data: dict[str, Any] = {"api_key": API_KEY, "api_secret": API_SECRET}
    data.update(overrides)
    for key in list(data):
        if data[key] is None:
            del data[key]
    return json.dumps(
        {"data": {"data": data, "metadata": {"version": 7}, "lease_duration": 0}}
    ).encode("utf-8")


def fetcher_for(
    body: bytes = b"",
    *,
    status: int = 200,
    config_overrides: dict[str, Any] | None = None,
    seen: list[httpx.Request] | None = None,
) -> VaultKvSecretFetcher:
    """A fetcher whose transport answers with exactly this response.

    ``seen`` collects the requests, because half of what is under test is what this
    client PUTS ON THE WIRE (path, headers) and not only what it does with the answer.
    """
    captured = seen if seen is not None else []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(status, content=body)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return VaultKvSecretFetcher(
        config(**(config_overrides or {})),
        environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
        client=client,
    )


def resolve(
    fetcher: VaultKvSecretFetcher, tenant: str = "tenant-a", account: str = "acct-1"
) -> ExchangeCredentials:
    provider = SecretManagerCredentialProvider(fetcher, exchange=ExchangeId.BINANCE)
    return asyncio.run(provider.resolve(tenant, account, ExchangeId.BINANCE))


# ---------------------------------------------------------------------------
# 1. the config object is the single place the shape rules live
# ---------------------------------------------------------------------------


class TestConfigRefusals:
    def test_http_is_refused_because_a_token_travels_on_the_request(self) -> None:
        with pytest.raises(ValueError, match="must be https"):
            config(addr="http://vault.internal:8200")

    def test_a_missing_scheme_is_refused_rather_than_defaulted(self) -> None:
        with pytest.raises(ValueError, match="scheme"):
            config(addr="vault.internal:8200")

    def test_credentials_in_the_url_are_refused_not_honoured(self) -> None:
        with pytest.raises(ValueError, match="embed credentials"):
            config(addr="https://robot:hunter2@vault.internal:8200")

    def test_the_trailing_slash_is_stripped_once_and_predictably(self) -> None:
        assert config(addr="https://vault.internal:8200///").addr == (
            "https://vault.internal:8200"
        )

    def test_a_nested_mount_is_refused_because_a_segment_is_checkable(self) -> None:
        with pytest.raises(ValueError, match="one safe path segment"):
            config(mount="secret/kv")

    def test_an_unknown_placeholder_is_refused_rather_than_left_literal(self) -> None:
        # A typo ({tenent}) would otherwise look up a nonexistent path and report "no
        # secret" for every tenant, forever, with a plausible message.
        with pytest.raises(ValueError, match="unknown placeholder"):
            config(path_template="wlct/{tenent}/{account}/{exchange}")

    def test_an_unbalanced_brace_is_refused(self) -> None:
        with pytest.raises(ValueError, match="unbalanced braces"):
            config(path_template="wlct/{tenant/{account}/{exchange}")

    def test_a_traversal_segment_in_the_template_is_refused(self) -> None:
        with pytest.raises(ValueError, match=r"\.\."):
            config(path_template="wlct/{tenant}/../../other/{account}/{exchange}")

    def test_the_token_variable_must_be_a_variable_name(self) -> None:
        for bad in ("", "not an env name", "EXECUTION-VAULT"):
            expected = "EXECUTION_VAULT_TOKEN_ENV|environment-variable name"
            with pytest.raises(ValueError, match=expected):
                config(token_env=bad)

    def test_the_response_bound_has_bounds(self) -> None:
        with pytest.raises(ValueError, match="1 KiB"):
            config(max_response_bytes=512)
        with pytest.raises(ValueError, match="1 KiB"):
            config(max_response_bytes=50_000_000)

    def test_a_namespace_that_looks_like_a_url_path_survives_and_a_control_char_does_not(
        self,
    ) -> None:
        assert config(namespace="admin/ops").namespace == "admin/ops"
        with pytest.raises(ValueError, match="namespace"):
            config(namespace="admin\nops")

    def test_the_description_carries_no_token(self) -> None:
        built = config()
        view = built.describe()
        assert view["tokenEnvVar"] == "EXECUTION_VAULT_TOKEN"
        assert VAULT_TOKEN not in json.dumps(view)
        assert "token" not in {key.lower() for key in view} - {"tokenenvvar"}

    def test_the_settings_object_cannot_hold_the_token(self) -> None:
        # The law is structural: there is no field to leak. A later part that adds one
        # fails here rather than in a security review.
        names = set(Settings.model_fields)
        assert not any(
            name.upper().endswith(("TOKEN", "_KEY", "SECRET", "PASSWORD"))
            and "ENV" not in name.upper()
            for name in names
            if name.startswith("EXECUTION_VAULT")
        )
        for name in names:
            if name.startswith("EXECUTION_VAULT"):
                assert "ADDR" in name or name.endswith(
                    (
                        "MOUNT",
                        "PATH_TEMPLATE",
                        "TOKEN_ENV",
                        "NAMESPACE",
                        "TIMEOUT_MS",
                        "TLS_VERIFY",
                        "MAX_RESPONSE_BYTES",
                    )
                ), name


# ---------------------------------------------------------------------------
# 2. the lookup: what goes out, and what comes back
# ---------------------------------------------------------------------------


class TestLookup:
    def test_a_healthy_read_yields_a_credential_with_the_stored_metadata(self) -> None:
        seen: list[httpx.Request] = []
        fetcher = fetcher_for(
            secret_payload(
                permissions="READ,SPOT_TRADE",
                expiresAtMicros=1_800_000_000_000_000,
            ),
            seen=seen,
        )
        credentials = resolve(fetcher)
        assert credentials.api_key == API_KEY
        assert credentials.api_secret == API_SECRET
        # The version rides in the source label, so a rotated secret is a new label and
        # an audit line can be tied to the version that signed it.
        assert credentials.source == "vault-kv2:v7"
        assert credentials.permissions == frozenset({"READ", "SPOT_TRADE"})
        assert credentials.expires_at_micros == 1_800_000_000_000_000
        request = seen[0]
        assert request.url.path == "/v1/secret/data/wlct/tenant-a/acct-1/binance"
        assert request.headers["X-Vault-Token"] == VAULT_TOKEN
        assert "X-Vault-Namespace" not in request.headers

    def test_the_namespace_header_is_sent_only_when_configured(self) -> None:
        seen: list[httpx.Request] = []
        fetcher = fetcher_for(
            secret_payload(),
            config_overrides={"namespace": "admin/ops"},
            seen=seen,
        )
        resolve(fetcher)
        assert seen[0].headers["X-Vault-Namespace"] == "admin/ops"

    def test_camel_case_spelling_is_accepted(self) -> None:
        fetcher = fetcher_for(
            json.dumps({"data": {"data": {"apiKey": API_KEY, "apiSecret": API_SECRET}}}).encode()
        )
        assert resolve(fetcher).api_key == API_KEY

    def test_two_disagreeing_spellings_are_refused(self) -> None:
        fetcher = fetcher_for(
            json.dumps(
                {
                    "data": {
                        "data": {
                            "api_key": API_KEY,
                            "apiKey": "different",
                            "api_secret": API_SECRET,
                        }
                    }
                }
            ).encode()
        )
        with pytest.raises(CredentialNotFound, match="more than one spelling"):
            resolve(fetcher)

    def test_two_agreeing_spellings_are_accepted(self) -> None:
        fetcher = fetcher_for(
            json.dumps(
                {
                    "data": {
                        "data": {
                            "api_key": API_KEY,
                            "apiKey": API_KEY,
                            "api_secret": API_SECRET,
                        }
                    }
                }
            ).encode()
        )
        assert resolve(fetcher).api_key == API_KEY

    def test_absent_fields_are_a_refusal_not_an_empty_credential(self) -> None:
        for missing in ({"api_key": None}, {"api_secret": None}):
            payload = secret_payload(**missing)
            with pytest.raises(CredentialNotFound):
                resolve(fetcher_for(payload))

    def test_a_blank_value_is_refused_even_though_the_key_is_present(self) -> None:
        blank = "   "
        with pytest.raises(CredentialNotFound, match="blank"):
            resolve(fetcher_for(secret_payload(api_secret=blank)))

    def test_no_permissions_stored_means_no_claim_not_a_permissive_default(self) -> None:
        credentials = resolve(fetcher_for(secret_payload()))
        assert credentials.permissions == frozenset()

    def test_a_stored_withdraw_permission_is_carried_so_the_review_can_refuse_it(self) -> None:
        # The fetcher does NOT filter withdrawals: refusing here would hide the fact
        # from the review, which is the component that turns it into a typed finding
        # and an audit line.
        credentials = resolve(fetcher_for(secret_payload(permissions=["READ", "WITHDRAW"])))
        assert "WITHDRAW" in credentials.permissions

    def test_a_permission_field_of_the_wrong_shape_is_refused(self) -> None:
        with pytest.raises(CredentialNotFound, match="permissions field"):
            resolve(fetcher_for(secret_payload(permissions={"a": 1})))

    def test_an_expiry_string_is_refused_because_a_timezone_was_never_written_down(self) -> None:
        with pytest.raises(CredentialNotFound, match="expires_at_micros"):
            resolve(fetcher_for(secret_payload(expiresAtMicros="2026-01-01T00:00:00Z")))

    def test_an_expiry_as_a_digit_string_is_accepted(self) -> None:
        credentials = resolve(fetcher_for(secret_payload(expiresAtMicros="1800000000000000")))
        assert credentials.expires_at_micros == 1_800_000_000_000_000

    @pytest.mark.parametrize("status", [400, 403, 404, 429, 500, 503])
    def test_every_non_200_is_one_refusal_with_the_status_and_no_body(self, status: int) -> None:
        seen: list[httpx.Request] = []
        body = json.dumps({"errors": [f"secret payload for {API_SECRET}"]}).encode()
        fetcher = fetcher_for(body, status=status, seen=seen)
        with pytest.raises(CredentialNotFound) as caught:
            resolve(fetcher)
        message = str(caught.value)
        assert f"HTTP {status}" in message
        # The refusal must not repeat what the server said: a Vault error document can
        # echo request material, and "credential path under mount" is enough context.
        assert API_SECRET not in message
        assert "payload" not in message

    def test_a_200_with_a_null_data_block_is_refused_not_treated_as_empty(self) -> None:
        # Vault answers a deleted KV secret with 200 and {"data": null}.
        with pytest.raises(CredentialNotFound, match="could not be read"):
            resolve(fetcher_for(json.dumps({"data": None}).encode()))

    def test_html_from_a_proxy_is_refused_as_malformed(self) -> None:
        with pytest.raises(CredentialNotFound, match="could not be read"):
            resolve(fetcher_for(b"<html>502 bad gateway</html>"))

    def test_an_oversized_response_is_refused_without_being_consumed(self) -> None:
        fetcher = fetcher_for(
            secret_payload(api_secret="x" * 4096),
            config_overrides={"max_response_bytes": 1024},
        )
        with pytest.raises(CredentialNotFound, match="above the 1024 byte bound"):
            resolve(fetcher)

    def test_a_transport_failure_names_the_type_and_not_the_url(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError(f"connection refused to {request.url}")

        fetcher = VaultKvSecretFetcher(
            config(),
            environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        with pytest.raises(CredentialNotFound) as caught:
            resolve(fetcher)
        assert "ConnectError" in str(caught.value)
        assert VAULT_TOKEN not in str(caught.value)

    def test_a_missing_token_is_a_refusal_at_construction(self) -> None:
        with pytest.raises(CredentialNotFound, match="EXECUTION_VAULT_TOKEN is not set"):
            VaultKvSecretFetcher(config(), environ={})

    @pytest.mark.parametrize(
        "tenant",
        ["tenant/../other", "tenant\na", "a" * 65, "", "tenant*a"],
    )
    def test_an_unsafe_identifier_never_becomes_a_request(self, tenant: str) -> None:
        seen: list[httpx.Request] = []
        fetcher = fetcher_for(secret_payload(), seen=seen)
        with pytest.raises(CredentialNotFound, match="safe path segment"):
            asyncio.run(fetcher(tenant, "acct-1", ExchangeId.BINANCE))
        # The assertion that gives the refusal its meaning: nothing left this process.
        assert seen == []

    def test_the_rendered_path_is_bounded(self) -> None:
        # A template that is legal in every segment but absurd in total is caught here,
        # where the failure is a named refusal, rather than downstream where a proxy
        # answers 414 and the operator sees "no secret".
        def respond(request: httpx.Request) -> httpx.Response:  # pragma: no cover
            raise AssertionError("a request must never be built for an over-long path")

        bounded = VaultKvSecretFetcher(
            config(
                path_template="n" * (MAX_VAULT_PATH_LENGTH + 10)
                + "/{tenant}/{account}/{exchange}"
            ),
            environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
            client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        )
        with pytest.raises(CredentialNotFound, match="characters"):
            asyncio.run(bounded("tenant-a", "acct-1", ExchangeId.BINANCE))

    def test_the_fetcher_never_renders_the_token_or_the_secret(self) -> None:
        fetcher = fetcher_for(secret_payload())
        for rendered in (repr(fetcher), str(fetcher), json.dumps(fetcher.describe())):
            assert VAULT_TOKEN not in rendered
            assert API_SECRET not in rendered
        assert "mount='secret'" in repr(fetcher)
        credentials = resolve(fetcher)
        # The core's credential value already refuses to survive rendering; asserted
        # here as well because this module is the one that hands it the material, and a
        # regression in either place lands the secret in a log line.
        assert API_SECRET not in repr(credentials)
        assert API_SECRET not in str(credentials)
        # A malformed body's refusal quotes the exception TYPE, not the bytes it came
        # from - and the bytes here would be the secret if the field order changed.
        with pytest.raises(CredentialNotFound) as caught:
            fetcher._decode(b'{"data": {"data": {"api_secret": "' + API_SECRET.encode() + b'"}}}')
        assert API_SECRET not in str(caught.value)


# ---------------------------------------------------------------------------
# 3. selection: the knob that installs the reader, and the refusals around it
# ---------------------------------------------------------------------------


class TestSelection:
    def test_secret_manager_without_a_fetcher_still_refuses_and_says_what_to_do(self) -> None:
        settings = settings_for(("EXECUTION_CREDENTIAL_FETCHER", "none"))
        with pytest.raises(ValueError, match="needs a secret fetcher") as caught:
            build_credential_provider(settings, environ={})
        message = str(caught.value)
        assert "EXECUTION_CREDENTIAL_FETCHER=vault-kv2" in message
        assert "run simulated" in message

    def test_vault_kv2_installs_the_reader_and_reports_it(self) -> None:
        wiring = build_credential_provider(
            settings_for(),
            environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
        )
        assert wiring.source == "secret-manager"
        assert wiring.fetcher_source == "vault-kv2"
        # ``source`` is the public chain: the cache wrapper says what it wraps, so a
        # selection that silently skipped the secret-manager provider would read
        # differently here without anyone having to reach into a private attribute.
        assert wiring.provider.source == "cached(secret-manager)"
        assert wiring.describe()["fetcherSource"] == "vault-kv2"
        # A single-tenant claim would be wrong here: the fetcher is keyed per
        # (tenant, account), so the configured pair is not the only one it can read.
        assert wiring.tenant_id is None
        assert wiring.account_id is None

    def test_an_injected_fetcher_is_reported_as_injected(self) -> None:
        async def fetch(
            tenant_id: str, account_id: str, exchange: ExchangeId
        ) -> ResolvedSecret:
            raise CredentialNotFound("deployment fetcher")

        wiring = build_credential_provider(
            settings_for(("EXECUTION_CREDENTIAL_FETCHER", "none")),
            environ={},
            secret_fetcher=fetch,
        )
        assert wiring.fetcher_source == "injected"
        # ``str`` rather than an index cast: describe() is typed as a mapping to
        # ``object``, and the assertion is about the sentence, so reading it as text is
        # the honest narrowing rather than an annotation that lies about the shape.
        assert "deployment-provided" in str(wiring.describe()["note"])

    def test_the_selected_source_never_falls_back_to_another_one(self) -> None:
        # The whole point of an explicit selector: no path through this function
        # returns a working provider when the selected one cannot be built.
        with pytest.raises(ValueError):
            build_credential_provider(
                settings_for(("EXECUTION_VAULT_ADDR", "")),
                environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
            )
        with pytest.raises(ValueError):
            build_credential_provider(
                settings_for(("EXECUTION_VAULT_ADDR", "http://vault:8200")),
                environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
            )
        # ``none`` with no fetcher selected is the shipped default, and it stays a
        # null provider: the refusal above must not be able to talk this branch into
        # installing the Vault reader "because it was configured".
        assert isinstance(
            build_credential_provider(
                Settings.model_validate(
                    {**BASE_ENV, "EXECUTION_CREDENTIAL_SOURCE": "none"}
                )
            ).provider,
            NullCredentialProvider,
        )

    def test_the_boot_log_names_the_mechanism_and_nothing_else(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # The filter is installed for the duration of the test rather than left to the
        # suite's ordering, because the property that matters is "the operator can read
        # which mechanism was chosen AFTER the platform's redaction filter has had its
        # say". Whether the filter happens to be attached by another test first is not
        # a property of this module, and a test that only passes in one ordering is a
        # test that fails in the other.
        from app.logging_config import RedactionFilter

        log = logging.getLogger("app.credentials")
        scrubber = RedactionFilter()
        log.addFilter(scrubber)
        try:
            with caplog.at_level(logging.INFO, logger="app.credentials"):
                build_credential_provider(
                    settings_for(),
                    environ={"EXECUTION_VAULT_TOKEN": VAULT_TOKEN},
                )
        finally:
            log.removeFilter(scrubber)
        events = [
            record
            for record in caplog.records
            if getattr(record, "event", "") == "execution_engine.credentials_selected"
        ]
        assert len(events) == 1
        extra = events[0].__dict__
        assert extra["providerFetcher"] == "vault-kv2"
        assert VAULT_TOKEN not in caplog.text
        assert API_KEY not in caplog.text
        # Not even the path template's tenant placeholder is logged per selection:
        # the boot line says what was wired, and the request says nothing at all.
        assert "wlct/" not in caplog.text


# ---------------------------------------------------------------------------
# 4. the settings surface, which is where a config mistake becomes visible
# ---------------------------------------------------------------------------


class TestSettingsSurface:
    def test_a_fetcher_selected_for_another_source_is_refused(self) -> None:
        with pytest.raises(Exception, match="EXECUTION_CREDENTIAL_FETCHER=vault-kv2"):
            settings_for(
                ("EXECUTION_CREDENTIAL_SOURCE", "environment"),
                ("EXECUTION_CREDENTIAL_ENV_PREFIX", "WLCT_TEST"),
            )

    def test_the_fetcher_defaults_to_none_and_publishes_that(self) -> None:
        view = Settings.model_validate(dict(BASE_ENV)).to_public_dict()
        assert view["credentialFetcher"] == "none"
        # Nothing Vault-shaped is published when nothing is wired: a status page that
        # prints defaults describes a deployment that does not exist.
        assert view["vaultMount"] is None
        assert view["vaultPathTemplate"] is None
        assert view["vaultTokenEnvVar"] is None

    def test_the_vault_view_publishes_the_name_of_the_variable_only(self) -> None:
        view = settings_for().to_public_dict()
        assert view["credentialFetcher"] == "vault-kv2"
        assert view["vaultMount"] == "secret"
        assert view["vaultTokenEnvVar"] == "EXECUTION_VAULT_TOKEN"
        assert "EXECUTION_VAULT_ADDR" not in json.dumps(view)
        assert VAULT_TOKEN not in json.dumps(view)
        # The address is topology, not a secret, and it is deliberately NOT published:
        # /status is readable by the worker, which has no need to know where the
        # platform's key store lives.
        assert "vault.internal" not in json.dumps(view)

    def test_an_unparseable_vault_address_fails_the_boot_that_named_it(self) -> None:
        with pytest.raises(Exception, match="vault-kv2 credential fetcher rejected"):
            settings_for(("EXECUTION_VAULT_MOUNT", "secret/kv"))

    def test_the_token_has_no_field_it_could_be_stored_in(self) -> None:
        # The stronger half of the redaction story. A test that the rendered view omits
        # the token only proves the view is careful; this proves there is nowhere in the
        # settings model to be careless about, so ``model_dump`` - which is what a debug
        # endpoint or an exception repr would reach for - cannot carry it either. The
        # field that does exist holds the NAME of the variable, and the name is safe to
        # publish because it is printed in the deployment's own documentation.
        settings = settings_for()
        assert "EXECUTION_VAULT_TOKEN" not in Settings.model_fields
        assert settings.EXECUTION_VAULT_TOKEN_ENV == TOKEN_ENV_NAME
        assert VAULT_TOKEN not in json.dumps(settings.model_dump())
        assert VAULT_TOKEN not in json.dumps(settings.to_public_dict())
        assert VAULT_TOKEN not in repr(settings)
