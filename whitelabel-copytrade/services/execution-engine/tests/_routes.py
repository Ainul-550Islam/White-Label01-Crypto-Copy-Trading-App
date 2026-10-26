# Responsibility: flatten concrete FastAPI routes across nested and lazy router includes for tests.
"""Test helpers for inspecting concrete FastAPI routes, including lazy includes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator

from fastapi.routing import APIRoute


@dataclass(frozen=True)
class FlattenedRoute:
    """A concrete route paired with its fully resolved application path."""

    path: str
    methods: set[str]
    endpoint: Any
    dependant: Any
    dependencies: frozenset[Any]
    original: Any


def _router_routes(router: Any) -> list[Any]:
    """Read route collections across Starlette and FastAPI router wrappers."""
    routes = getattr(router, "routes", None)
    if routes is not None:
        return list(routes)
    nested = getattr(router, "router", None)
    if nested is not None and nested is not router:
        routes = getattr(nested, "routes", None)
        if routes is not None:
            return list(routes)
    return []


def _normalise_path(path: str | None) -> str:
    if not path:
        return ""
    return "/" + path.strip("/") if path != "/" else "/"


def _join_path(parent: str, child: str | None) -> str:
    local = _normalise_path(child)
    if not local:
        return parent or "/"
    if not parent:
        return local
    if local == parent or local.startswith(parent.rstrip("/") + "/"):
        return local
    return parent.rstrip("/") + "/" + local.lstrip("/")


def _include_prefix(included: Any) -> str:
    """Return the prefix recorded by either eager or lazy include implementations."""
    context = getattr(included, "include_context", None)
    for owner in (context, included, getattr(included, "original_router", None)):
        if owner is None:
            continue
        for attribute in ("prefix", "path"):
            value = getattr(owner, attribute, None)
            if isinstance(value, str) and value:
                return value
    return ""


def _included_dependencies(included: Any) -> set[Any]:
    """Collect dependencies declared at an include boundary when exposed by FastAPI."""
    context = getattr(included, "include_context", None)
    result: set[Any] = set()
    for owner in (context, included):
        if owner is None:
            continue
        for dependency in getattr(owner, "dependencies", ()) or ():
            call = getattr(dependency, "dependency", None)
            if call is not None:
                result.add(call)
    return result


def dependant_calls(dependant: Any) -> set[Any]:
    """Collect direct and transitive callables from a FastAPI dependency tree."""
    call = getattr(dependant, "call", None)
    calls = {call} if call is not None else set()
    for sub_dependant in getattr(dependant, "dependencies", ()) or ():
        calls.update(dependant_calls(sub_dependant))
    return calls


def _concrete_route(route: Any) -> bool:
    return isinstance(route, APIRoute) or (
        isinstance(getattr(route, "path", None), str)
        and hasattr(route, "endpoint")
        and hasattr(route, "methods")
    )


def walk_routes(app: Any) -> list[FlattenedRoute]:
    """Flatten eager routes and lazy/mounted router includes into route records."""
    flattened: list[FlattenedRoute] = []
    seen_routers: set[tuple[int, str]] = set()
    seen_routes: set[tuple[int, str]] = set()

    def visit(router: Any, prefix: str, inherited_dependencies: set[Any]) -> None:
        marker = (id(router), prefix)
        if marker in seen_routers:
            return
        seen_routers.add(marker)

        for route in _router_routes(router):
            if _concrete_route(route):
                full_path = _join_path(prefix, getattr(route, "path", None))
                route_marker = (id(route), full_path)
                if route_marker in seen_routes:
                    continue
                seen_routes.add(route_marker)
                dependant = getattr(route, "dependant", None)
                dependencies = set(inherited_dependencies)
                if dependant is not None:
                    dependencies.update(dependant_calls(dependant))
                flattened.append(
                    FlattenedRoute(
                        path=full_path,
                        methods=set(getattr(route, "methods", ()) or ()),
                        endpoint=getattr(route, "endpoint", None),
                        dependant=dependant,
                        dependencies=frozenset(dependencies),
                        original=route,
                    )
                )
                continue

            nested_routers: list[Any] = []
            for candidate in (
                getattr(route, "original_router", None),
                getattr(route, "router", None),
                getattr(route, "app", None),
                route,
            ):
                if candidate is not None and candidate is not router and _router_routes(candidate):
                    if all(candidate is not existing for existing in nested_routers):
                        nested_routers.append(candidate)
            next_prefix = _join_path(prefix, _include_prefix(route)) if _include_prefix(route) else prefix
            next_dependencies = inherited_dependencies | _included_dependencies(route)
            for nested_router in nested_routers:
                visit(nested_router, next_prefix, next_dependencies)

    visit(app, "", set())
    return flattened


def iter_routes(app: Any) -> Iterator[tuple[str, str, Any, frozenset[Any]]]:
    """Yield ``(method, full_path, endpoint, dependencies)`` for each HTTP method."""
    for route in walk_routes(app):
        for method in sorted(route.methods):
            yield method, route.path, route.endpoint, route.dependencies


def internal_api_routes(app: Any, prefix: str = "/internal/v1") -> list[FlattenedRoute]:
    """Return flattened API routes on the internal plane."""
    return [route for route in walk_routes(app) if route.path.startswith(prefix)]


def route_paths(app: Any) -> set[str]:
    """Return fully prefixed paths from concrete routes and lazy router source routes."""
    return {path for _method, path, _endpoint, _dependencies in iter_routes(app)}
