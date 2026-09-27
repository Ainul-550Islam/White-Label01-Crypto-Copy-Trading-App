"""Strongly validated strategy parameters.

A strategy's behaviour is a function of its code *and* its parameters, so
parameters get the same treatment as any other untrusted input: an explicit
schema, type coercion from strings, range checks, and rejection of anything
unknown. A malformed configuration must fail at construction, not produce a
subtly different strategy at runtime.

Three rules that are enforced structurally rather than by convention:

* **Unknown keys are refused.** A typo in a parameter name would otherwise
  leave the default silently in place, and the operator would believe they had
  changed something.
* **Numeric parameters are ``Decimal`` or ``int``, never ``float``.** The
  project's precision convention applies to configuration too: a threshold
  compared against a ``Decimal`` price must itself be exact.
* **Secret-looking names are refused outright.** A strategy is never given a
  credential, so a parameter called ``api_secret`` is either a mistake or an
  attempt to smuggle one into a code path that logs and hashes its inputs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping

__all__ = [
    "ParameterError",
    "ParameterType",
    "ParameterSpec",
    "ParameterSchema",
    "FORBIDDEN_PARAMETER_PATTERN",
]

#: Parameter names that must never appear. Matched case-insensitively against
#: the whole name. The strategy layer has no use for any of them.
FORBIDDEN_PARAMETER_PATTERN = re.compile(
    r"(secret|password|passwd|api[_-]?key|private[_-]?key|token|credential|passphrase)",
    re.IGNORECASE,
)

_BOOL_TRUE = frozenset({"1", "true", "yes", "on"})
_BOOL_FALSE = frozenset({"0", "false", "no", "off"})


class ParameterError(ValueError):
    """Raised when a parameter set is missing, unknown, or out of range."""


class ParameterType:
    """The supported parameter types.

    A deliberately small set. Anything a strategy needs can be expressed as an
    integer, an exact decimal, a boolean or a constrained string; richer types
    would need richer validation and would not survive a configuration hash
    unambiguously.
    """

    INT = "INT"
    DECIMAL = "DECIMAL"
    BOOL = "BOOL"
    STRING = "STRING"

    ALL = (INT, DECIMAL, BOOL, STRING)


@dataclass(slots=True, frozen=True)
class ParameterSpec:
    """Declaration of one parameter.

    ``minimum``/``maximum`` are inclusive bounds and apply to ``INT`` and
    ``DECIMAL``. ``choices`` constrains ``STRING``. ``default`` is used when
    the key is absent; a spec with no default is required.
    """

    name: str
    kind: str
    description: str
    default: Any = None
    minimum: Decimal | int | None = None
    maximum: Decimal | int | None = None
    choices: tuple[str, ...] | None = None
    required: bool = False

    def __post_init__(self) -> None:
        if not self.name:
            raise ParameterError("ParameterSpec requires a name.")
        if FORBIDDEN_PARAMETER_PATTERN.search(self.name):
            raise ParameterError(
                f"Parameter name {self.name!r} looks like a credential. Strategies "
                "are never given credentials."
            )
        if self.kind not in ParameterType.ALL:
            raise ParameterError(
                f"Parameter {self.name!r} has unknown type {self.kind!r}."
            )
        if self.required and self.default is not None:
            raise ParameterError(
                f"Parameter {self.name!r} is required and must not carry a default."
            )
        if self.choices is not None and self.kind != ParameterType.STRING:
            raise ParameterError(
                f"Parameter {self.name!r} declares choices but is not a STRING."
            )

    # -- coercion -------------------------------------------------------
    def coerce(self, raw: Any) -> Any:
        """Convert ``raw`` to this parameter's type, or raise.

        Strings are accepted for every type so that a parameter set loaded from
        the database, an environment variable or a JSON payload validates the
        same way as one written in Python.
        """
        if self.kind == ParameterType.BOOL:
            return self._coerce_bool(raw)
        if self.kind == ParameterType.INT:
            return self._coerce_int(raw)
        if self.kind == ParameterType.DECIMAL:
            return self._coerce_decimal(raw)
        return self._coerce_string(raw)

    def _coerce_bool(self, raw: Any) -> bool:
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            lowered = raw.strip().lower()
            if lowered in _BOOL_TRUE:
                return True
            if lowered in _BOOL_FALSE:
                return False
        raise ParameterError(
            f"Parameter {self.name!r} must be a boolean; got {raw!r}."
        )

    def _coerce_int(self, raw: Any) -> int:
        if isinstance(raw, bool):
            raise ParameterError(
                f"Parameter {self.name!r} must be an integer, not a boolean."
            )
        if isinstance(raw, int):
            value = raw
        elif isinstance(raw, str):
            try:
                value = int(raw.strip())
            except ValueError as exc:
                raise ParameterError(
                    f"Parameter {self.name!r} must be an integer; got {raw!r}."
                ) from exc
        else:
            raise ParameterError(
                f"Parameter {self.name!r} must be an integer; got {type(raw).__name__}."
            )
        self._check_bounds(Decimal(value))
        return value

    def _coerce_decimal(self, raw: Any) -> Decimal:
        if isinstance(raw, bool):
            raise ParameterError(
                f"Parameter {self.name!r} must be a decimal, not a boolean."
            )
        if isinstance(raw, Decimal):
            value = raw
        elif isinstance(raw, int):
            value = Decimal(raw)
        elif isinstance(raw, str):
            try:
                value = Decimal(raw.strip())
            except InvalidOperation as exc:
                raise ParameterError(
                    f"Parameter {self.name!r} must be a decimal; got {raw!r}."
                ) from exc
        elif isinstance(raw, float):
            # Refused rather than converted: Decimal(0.1) is 0.1000000000000000055...
            # and a strategy threshold that is almost the number the operator
            # typed is worse than an error.
            raise ParameterError(
                f"Parameter {self.name!r} must not be a float; pass a string or "
                "Decimal so the exact value is preserved."
            )
        else:
            raise ParameterError(
                f"Parameter {self.name!r} must be a decimal; got {type(raw).__name__}."
            )
        if not value.is_finite():
            raise ParameterError(f"Parameter {self.name!r} must be finite.")
        self._check_bounds(value)
        return value

    def _coerce_string(self, raw: Any) -> str:
        if not isinstance(raw, str):
            raise ParameterError(
                f"Parameter {self.name!r} must be a string; got {type(raw).__name__}."
            )
        value = raw.strip()
        if self.choices is not None and value not in self.choices:
            raise ParameterError(
                f"Parameter {self.name!r} must be one of {list(self.choices)}; "
                f"got {value!r}."
            )
        return value

    def _check_bounds(self, value: Decimal) -> None:
        if self.minimum is not None and value < Decimal(str(self.minimum)):
            raise ParameterError(
                f"Parameter {self.name!r} must be >= {self.minimum}; got {value}."
            )
        if self.maximum is not None and value > Decimal(str(self.maximum)):
            raise ParameterError(
                f"Parameter {self.name!r} must be <= {self.maximum}; got {value}."
            )

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "kind": self.kind,
            "description": self.description,
            "default": str(self.default) if self.default is not None else None,
            "minimum": str(self.minimum) if self.minimum is not None else None,
            "maximum": str(self.maximum) if self.maximum is not None else None,
            "choices": list(self.choices) if self.choices else None,
            "required": self.required,
        }


@dataclass(slots=True, frozen=True)
class ParameterSchema:
    """An ordered set of :class:`ParameterSpec`.

    Order matters: :meth:`canonical_form` emits parameters sorted by name so
    that two logically identical configurations hash identically regardless of
    the order the operator supplied them in.
    """

    specs: tuple[ParameterSpec, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        seen: set[str] = set()
        for spec in self.specs:
            if spec.name in seen:
                raise ParameterError(f"Duplicate parameter {spec.name!r} in schema.")
            seen.add(spec.name)

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(spec.name for spec in self.specs)

    def spec_for(self, name: str) -> ParameterSpec | None:
        for spec in self.specs:
            if spec.name == name:
                return spec
        return None

    def validate(self, raw: Mapping[str, Any] | None) -> dict[str, Any]:
        """Validate and coerce a parameter mapping.

        Returns a new dict containing every declared parameter, with defaults
        filled in. Raises :class:`ParameterError` on an unknown key, a missing
        required key, a wrong type, or an out-of-range value.
        """
        supplied = dict(raw or {})

        for key in supplied:
            if FORBIDDEN_PARAMETER_PATTERN.search(key):
                raise ParameterError(
                    f"Parameter {key!r} looks like a credential and is refused."
                )

        unknown = sorted(set(supplied) - set(self.names))
        if unknown:
            raise ParameterError(
                "Unknown strategy parameter(s): "
                + ", ".join(unknown)
                + f". Declared parameters are: {', '.join(self.names) or '(none)'}."
            )

        resolved: dict[str, Any] = {}
        for spec in self.specs:
            if spec.name in supplied:
                resolved[spec.name] = spec.coerce(supplied[spec.name])
            elif spec.required:
                raise ParameterError(f"Parameter {spec.name!r} is required.")
            else:
                resolved[spec.name] = (
                    spec.coerce(spec.default) if spec.default is not None else None
                )
        return resolved

    def canonical_form(self, values: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
        """Deterministic ``(name, string_value)`` pairs for hashing.

        Sorted by name and stringified with ``str()``, which is exact for
        ``Decimal`` and ``int``. This is the only representation used by the
        configuration hash, so a hash never depends on dict ordering or on the
        caller's decimal context.
        """
        return tuple(
            (name, "null" if values.get(name) is None else str(values.get(name)))
            for name in sorted(values)
        )

    def to_dict(self) -> dict[str, object]:
        return {"parameters": [spec.to_dict() for spec in self.specs]}

    @classmethod
    def of(cls, specs: Iterable[ParameterSpec]) -> "ParameterSchema":
        return cls(specs=tuple(specs))
