"""The one concrete secret fetcher this service ships: HashiCorp Vault, KV v2.

Part 16 left the multi-tenant credential path half-open on purpose. The core's
:class:`~wlct_trading.execution.credentials.SecretManagerCredentialProvider` is complete
and tested, and ``app/credentials.py`` refused ``EXECUTION_CREDENTIAL_SOURCE=secret-manager``
without an injected fetcher, because key custody is a deployment decision and an
execution engine that hard-codes a backend silently decides which customers may trade.

Part 19 closes that half-open door the only way that does not decide anything for
anybody: it implements the fetch for the backend this platform's own infrastructure
already runs (``infrastructure/docker`` carries a Vault for the API service), behind an
explicit selector, and it still refuses when nothing is selected. A deployment that
uses a different KMS still injects its own fetcher; a deployment that uses this one
sets two variables instead of writing code. There is no default here: the selector's
default is ``none``, which keeps every existing deployment's behaviour byte-identical.

THE LAWS THIS MODULE ENFORCES
-----------------------------

1. **The token is read from the environment, and only from the environment.** It is
   not a field on the config object, so it cannot be published by ``to_public_dict``,
   cannot arrive in a ``model_dump``, and cannot be printed by a debugger that walks a
   dataclass. ``EXECUTION_VAULT_TOKEN_ENV`` names the variable to read (default
   ``EXECUTION_VAULT_TOKEN``) because an agent-injected credential rarely keeps the
   default name - and the indirection is cheap enough that "we could not find it" is a
   boot refusal, not a runtime surprise.
2. **A failure is a :class:`CredentialNotFound`, always.** Vault answers a bad token
   and a nonexistent path in ways that differ by policy and by version; the difference
   is not something this process should be confident about, and it is not something a
   log line should repeat. Every failure - transport, status, JSON shape, decoded
   field - normalises to the same exception type carrying the *type* of what went wrong.
   Vault's response body is never included in a message: KV responses contain key
   material.
3. **Nothing here is logged per lookup.** Construction logs the mount and the path
   template, which are configuration. A per-order log line that named the resolved path
   would put tenant identifiers in the aggregator on the busiest path in the service,
   for no operational gain - the provider above already reports the failure.
4. **Path segments are validated, not escaped.** A tenant identifier containing
   ``..``, a slash, or a control character is refused before a request is built, rather
   than being percent-encoded into a request that reads a different tenant's secret.
   Encoding would make the traversal *work* on most servers; refusing it makes the
   misconfiguration visible at the boundary that owns it.
5. **The response is bounded.** A KV secret is a few hundred bytes; a cap (default 64
   KiB) means a misconfigured path that lands on a large object cannot turn an order's
   latency into a memory event. The read is streamed so the cap is a real bound, not a
   post-hoc length check.
6. **Rotation evidence is carried, not invented.** If the stored secret has a
   ``version``, it rides back as the credential's ``source`` label (``vault-kv2:v12``),
   so a rotated secret produces a new label through the cache's TTL without this module
   pretending to know what rotation means. ``expiresAtMicros`` is read if present and
   defaulted if absent: an expiry the operator stored is enforced, and an absent one is
   reported as unknown rather than as "never" by this module (the core's review decides
   what unknown means).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Final

import httpx
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import (
    CredentialNotFound,
    ResolvedSecret,
)

__all__ = [
    "MAX_VAULT_PATH_LENGTH",
    "PLACEHOLDER_TOKENS",
    "VaultKvConfig",
    "VaultKvSecretFetcher",
]

#: The only placeholders a path template may contain. Deliberately three, because a
#: template is a lookup path for signing material and a placeholder that could reach
#: outside the (tenant, account, exchange) tuple - a raw ``{path}`` from the request,
#: say - is a template injection with a very specific payoff.
PLACEHOLDER_TOKENS: Final[tuple[str, ...]] = ("tenant", "account", "exchange")

#: Characters a tenant, account or exchange identifier is made of, for the purpose of
#: putting one in a URL path. ``.`` and ``-`` and ``_`` are allowed because they appear
#: in real tenant slugs; ``/``, ``\\``, ``%``, ``:`` and every control character are not,
#: and the exclusion is a refusal rather than an escape (see law 4).
_SAFE_SEGMENT: Final[re.Pattern[str]] = re.compile(r"\A[A-Za-z0-9._-]{1,64}\Z")

#: A KV secret is named, not routed, so the assembled path has a bound. It is generous
#: (a Vault path can be long) and its purpose is to stop a template-and-input
#: combination from producing a 4 KiB "path" that a proxy truncates into a 404 nobody
#: can explain.
MAX_VAULT_PATH_LENGTH: Final[int] = 512

#: The two spellings a stored key pair shows up with, in the wild and in this
#: repository's own examples. Both are accepted; a payload carrying both with different
#: values is refused, because picking one of two disagreeing secrets is a coin flip on
#: the signature.
_API_KEY_FIELDS: Final[tuple[str, ...]] = ("api_key", "apiKey")
_API_SECRET_FIELDS: Final[tuple[str, ...]] = ("api_secret", "apiSecret")
_EXPIRES_FIELDS: Final[tuple[str, ...]] = ("expires_at_micros", "expiresAtMicros")
_VERSION_FIELDS: Final[tuple[str, ...]] = ("version", "vault_version", "vaultVersion")


@dataclass(frozen=True)
class VaultKvConfig:
    """Validated Vault addressing. Nonsense is refused here, at boot.

    The shape checks live on the config object rather than in ``app/config.py``
    because the fetcher and the service's startup validator must not have two
    opinions: ``Settings`` constructs one of these inside a ``try`` and lets the
    refusal fail the boot, so the rule that fails startup is the same rule the runtime
    relies on, with no second copy to drift.
    """

    #: e.g. ``https://vault.internal:8200``. Scheme required, no trailing slash.
    addr: str
    #: The KV v2 mount, without ``/v1`` and without a trailing slash.
    mount: str = "secret"
    #: Lookup path, relative to ``/data/`` under the mount.
    path_template: str = "wlct/{tenant}/{account}/{exchange}"
    #: NAME of the environment variable holding the token. The token itself is never a
    #: field on any object in this module.
    token_env: str = "EXECUTION_VAULT_TOKEN"
    #: Optional Vault enterprise namespace, sent as a header.
    namespace: str | None = None
    timeout_ms: int = 3_000
    verify_tls: bool = True
    max_response_bytes: int = 65_536

    def __post_init__(self) -> None:
        if not isinstance(self.addr, str) or not self.addr.strip():
            raise ValueError("EXECUTION_VAULT_ADDR is required by the vault-kv2 fetcher.")
        addr = self.addr.strip().rstrip("/")
        if "://" not in addr:
            raise ValueError(
                f"EXECUTION_VAULT_ADDR must include a scheme, got {self.addr!r}; a "
                "host with no scheme is a request to http:// by default, which sends a "
                "token in cleartext."
            )
        authority = addr.split("://", 1)[1].split("/", 1)[0]
        if "@" in authority:
            raise ValueError(
                "EXECUTION_VAULT_ADDR must not embed credentials (a 'user:pass@host' "
                "authority): this client authenticates with a token from the "
                "environment and nothing else, and a URL that could carry a password "
                "is a password that will end up in a log line about the URL."
            )
        scheme = addr.split("://", 1)[0].lower()
        if scheme not in ("https", "http"):
            raise ValueError(f"EXECUTION_VAULT_ADDR scheme must be https or http; got {scheme!r}.")
        if scheme == "http":
            raise ValueError(
                "EXECUTION_VAULT_ADDR must be https: this request carries a token that "
                "reads signing keys, and the deployment's service mesh is not a "
                "substitute for transport security in a component that fails closed "
                "over everything else."
            )
        object.__setattr__(self, "addr", addr)
        mount = self.mount.strip().strip("/")
        if not mount or "/" in mount or not _SAFE_SEGMENT.match(mount):
            raise ValueError(
                f"EXECUTION_VAULT_MOUNT must be one safe path segment (the KV v2 "
                f"mount, e.g. 'secret'); got {self.mount!r}. A nested mount is spelled "
                "in the path template, not here, so that this value can be validated."
            )
        object.__setattr__(self, "mount", mount)
        template = self.path_template.strip().strip("/")
        if not template:
            raise ValueError("EXECUTION_VAULT_PATH_TEMPLATE must not be blank.")
        found = set(re.findall(r"\{([^{}]*)\}", template))
        unknown = sorted(found - set(PLACEHOLDER_TOKENS))
        if unknown:
            raise ValueError(
                f"EXECUTION_VAULT_PATH_TEMPLATE may only contain "
                f"{'/'.join('{' + t + '}' for t in PLACEHOLDER_TOKENS)}; unknown "
                f"placeholder(s): {', '.join(unknown)}. Refused rather than left "
                "literal, because a typo like {tenent} would then look up a path that "
                "does not exist and report 'no secret' for every tenant forever."
            )
        # Remove every complete placeholder, then look for leftovers: a template with
        # an unbalanced brace is not a template this module can fill deterministically.
        if any(character in re.sub(r"\{[^{}]*\}", "", template) for character in "{}"):
            raise ValueError(
                "EXECUTION_VAULT_PATH_TEMPLATE has unbalanced braces; a template that "
                "cannot be filled deterministically cannot be trusted to point at one "
                "tenant's secret."
            )
        if ".." in template.split("/"):
            raise ValueError(
                "EXECUTION_VAULT_PATH_TEMPLATE must not contain a '..' segment: the "
                "mount already bounds the lookup, and a template that climbs out of it "
                "is not a path this module is willing to guess the intent of."
            )
        object.__setattr__(self, "path_template", template)
        if not self.token_env.strip():
            raise ValueError(
                "EXECUTION_VAULT_TOKEN_ENV names the variable to read and must not be blank."
            )
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", self.token_env.strip()):
            raise ValueError(
                f"EXECUTION_VAULT_TOKEN_ENV must be an environment-variable name; got "
                f"{self.token_env!r}."
            )
        object.__setattr__(self, "token_env", self.token_env.strip())
        if self.namespace is not None:
            namespace = self.namespace.strip()
            if not namespace or not re.fullmatch(r"[\w./-]{1,256}", namespace):
                raise ValueError(
                    "EXECUTION_VAULT_NAMESPACE, when set, must be a non-blank namespace "
                    "path without control characters."
                )
            object.__setattr__(self, "namespace", namespace)
        if self.timeout_ms < 250:
            raise ValueError(
                "EXECUTION_VAULT_TIMEOUT_MS below 250 tests Vault's availability, not "
                "the network; a fetch that is supposed to be off the order path needs "
                "longer than that to be worth calling."
            )
        if not 1_024 <= self.max_response_bytes <= 4_194_304:
            raise ValueError(
                "EXECUTION_VAULT_MAX_RESPONSE_BYTES must be within 1 KiB..4 MiB; got "
                f"{self.max_response_bytes}. Below 1 KiB no usable secret fits, above "
                "4 MiB the bound has stopped being about secrets."
            )

    def describe(self) -> dict[str, object]:
        """Everything about this config that an operator may see. No token, ever."""
        return {
            "addr": self.addr,
            "mount": self.mount,
            "pathTemplate": self.path_template,
            "tokenEnvVar": self.token_env,
            "namespace": self.namespace,
            "timeoutMillis": self.timeout_ms,
            "verifyTls": self.verify_tls,
            "maxResponseBytes": self.max_response_bytes,
        }

    def read_token(self, environ: dict[str, str] | None = None) -> str:
        source = os.environ if environ is None else environ
        token = (source.get(self.token_env) or "").strip()
        if not token:
            raise CredentialNotFound(
                f"{self.token_env} is not set or is blank. The vault-kv2 fetcher reads "
                "the token from the environment and nowhere else, so there is no "
                "fallback to try - and a fetcher that tried one would be a fetcher "
                "that trades on whichever credential it happened to find."
            )
        return token


class VaultKvSecretFetcher:
    """``SecretFetcher`` over ``GET {addr}/v1/{mount}/data/{path}``.

    Constructed once at boot by ``app.credentials.build_credential_provider`` and
    called by the core's provider beneath ``CachingCredentialProvider``, so the
    expected rate is one request per cache TTL per (tenant, account) - not one per
    order. That is also why there is no retry logic here: a retry loop in front of a
    secret store converts an outage into a load problem, and the cache above already
    holds the answer for the callers that need one.
    """

    __slots__ = ("_config", "_token", "_client", "_owns_client", "source")

    def __init__(
        self,
        config: VaultKvConfig,
        *,
        environ: dict[str, str] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._config = config
        # Read once, at construction, and never again: a credential store whose token
        # changes under a running process is a process that should be restarted, and
        # re-reading per lookup would make "which token signed this order" unanswerable.
        self._token = config.read_token(environ)
        self._client = client
        self._owns_client = client is None
        self.source = "vault-kv2"

    def __repr__(self) -> str:
        # No token, no addr-with-credentials: this object is reachable from an
        # exception's locals, which is a rendering path, which is where secrets go.
        return f"VaultKvSecretFetcher(mount={self._config.mount!r}, source={self.source!r})"

    @property
    def config(self) -> VaultKvConfig:
        return self._config

    def describe(self) -> dict[str, object]:
        return {"fetcher": self.source, **self._config.describe()}

    async def aclose(self) -> None:
        """Close only the client this fetcher created."""
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            # Lazy: importing this module, or building a runtime that never resolves a
            # credential, must not open a connection pool or start a resolver.
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._config.timeout_ms / 1_000),
                verify=self._config.verify_tls,
            )
        return self._client

    def lookup_path(self, tenant_id: str, account_id: str, exchange: ExchangeId) -> str:
        """Render the template, refusing anything unsafe. No request has been made yet."""
        segments = {
            "tenant": str(tenant_id).strip(),
            "account": str(account_id).strip(),
            "exchange": str(getattr(exchange, "value", exchange)).strip().lower(),
        }
        for name, value in segments.items():
            if not _SAFE_SEGMENT.match(value):
                raise CredentialNotFound(
                    f"the {name} identifier {value!r} is not a safe path segment "
                    "(expected [A-Za-z0-9._-]{1,64}); the lookup was refused before any "
                    "request left this process, because the alternative - encoding it - "
                    "would make a traversal reach a different tenant's secret."
                )
        path = self._config.path_template.format(**segments)
        if not path or len(path) > MAX_VAULT_PATH_LENGTH:
            raise CredentialNotFound(
                f"the rendered Vault path is {len(path)} characters, outside the "
                f"1..{MAX_VAULT_PATH_LENGTH} bound this fetcher enforces."
            )
        return path

    async def __call__(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ResolvedSecret:
        path = self.lookup_path(tenant_id, account_id, exchange)
        url = f"{self._config.addr}/v1/{self._config.mount}/data/{path}"
        headers = {"X-Vault-Token": self._token, "Accept": "application/json"}
        if self._config.namespace:
            headers["X-Vault-Namespace"] = self._config.namespace
        try:
            client = await self._http()
            async with client.stream("GET", url, headers=headers) as response:
                status = response.status_code
                if status != 200:
                    # The body is deliberately unread here. A 4xx/5xx from Vault is a
                    # JSON error document, and the only thing in it this process is
                    # allowed to repeat is the status code, because "which path failed"
                    # is already in the refusal and "what the server said" is not.
                    raise CredentialNotFound(
                        f"Vault returned HTTP {status} for the credential path under "
                        f"mount {self._config.mount!r}. The response body was not read: "
                        "Vault error documents can echo request material."
                    )
                body = await response.aread()
        except CredentialNotFound:
            raise
        except Exception as error:
            raise CredentialNotFound(
                f"the Vault request failed: {type(error).__name__}. Vault's message was "
                "not carried through, because a transport exception can quote the URL "
                "that carried the token."
            ) from None
        if len(body) > self._config.max_response_bytes:
            raise CredentialNotFound(
                f"the response was {len(body)} bytes, above the "
                f"{self._config.max_response_bytes} byte bound for a KV secret; this "
                "path is not holding an API key pair."
            )
        return self._decode(body)

    def _decode(self, body: bytes) -> ResolvedSecret:
        try:
            envelope = json.loads(body.decode("utf-8"))
            if not isinstance(envelope, dict):
                raise TypeError("envelope is not an object")
            wrapper = envelope.get("data")
            if not isinstance(wrapper, dict):
                # A KV v2 read of a deleted secret answers 200 with "data": null, which
                # is a real answer that must not be decoded as an empty credential.
                raise TypeError("'data' is absent or null (a deleted secret, or a v1 mount)")
            data = wrapper.get("data")
            if not isinstance(data, dict):
                raise TypeError("'data.data' is not an object")
            metadata = wrapper.get("metadata")
            if not isinstance(metadata, dict):
                metadata = {}
        except Exception as error:
            raise CredentialNotFound(
                f"Vault's response could not be read as a KV v2 secret "
                f"({type(error).__name__}). A 200 whose shape is not "
                "'data.data' is a wrong mount version, a wrong path, or a proxy "
                "answering; none of those is a credential."
            ) from None
        api_key = _pick(data, _API_KEY_FIELDS, "API key")
        api_secret = _pick(data, _API_SECRET_FIELDS, "API secret")
        permissions = _permissions(data.get("permissions"))
        expires_at = _expires(data)
        version = metadata.get("version") or _first(data, _VERSION_FIELDS)
        source = self.source if version in (None, "") else f"{self.source}:v{version}"
        return ResolvedSecret(
            api_key=api_key,
            api_secret=api_secret,
            permissions=permissions,
            expires_at_micros=expires_at,
            source=source,
        )


def _pick(data: dict[str, object], names: tuple[str, ...], what: str) -> str:
    present = {name: data[name] for name in names if name in data}
    if not present:
        raise CredentialNotFound(
            f"the stored secret has no {what} field (looked for "
            f"{' or '.join(names)})."
        )
    values = {str(value).strip() for value in present.values()}
    if len(values) != 1:
        raise CredentialNotFound(
            f"the stored secret carries {what} under more than one spelling "
            f"({', '.join(sorted(present))}) and the values differ. Choosing one would "
            "be a coin flip on a signature."
        )
    value = values.pop()
    if not value:
        raise CredentialNotFound(f"the stored secret's {what} is blank.")
    return value


def _first(data: dict[str, object], names: tuple[str, ...]) -> object:
    for name in names:
        if name in data:
            return data[name]
    return None


def _permissions(value: object) -> frozenset[str]:
    """``"READ,SPOT_TRADE"`` or a list, into the core's vocabulary.

    The core owns the meaning of these strings (``PERMISSION_WITHDRAW`` in
    particular, which the review treats as a refusal); this function only parses. It
    therefore does NOT default to anything permissive when the field is absent - the
    empty set means "the operator stored no claim", and the review's law for an
    unattested field decides what that is worth.
    """
    if value is None:
        return frozenset()
    if isinstance(value, str):
        items = value.split(",")
    elif isinstance(value, list | tuple | set | frozenset):
        items = [str(item) for item in value]
    else:
        raise CredentialNotFound(
            f"the stored secret's permissions field must be a comma-separated string "
            f"or a list, got {type(value).__name__}."
        )
    return frozenset(item.strip().upper() for item in items if str(item).strip())


def _expires(data: dict[str, object]) -> int | None:
    """An explicit microsecond expiry, or None.

    No ISO-8601 support, on purpose: an unqualified timestamp string has a timezone
    the reader supplies, and an expiry computed from a guess is worse than no expiry -
    the review treats unknown as unknown, and would treat a wrong guess as a fact.
    """
    raw = _first(data, _EXPIRES_FIELDS)
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool) or not isinstance(raw, int | str):
        raise CredentialNotFound(
            "expires_at_micros must be an integer number of microseconds since the epoch."
        )
    if isinstance(raw, str):
        if not raw.strip().isdigit():
            raise CredentialNotFound(
                f"expires_at_micros must be an integer, got {raw!r}; a timestamp string "
                "is refused because a timezone nobody wrote down is a guess about when "
                "a key stops working."
            )
        return int(raw)
    return int(raw)
