# Responsibility: verifies route discovery under nested and lazy FastAPI router composition.
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

from tests._routes import (
    dependant_calls,
    internal_api_routes,
    iter_routes,
    route_paths,
    walk_routes,
)


def root_dependency() -> str:
    return 'root'


def nested_dependency() -> str:
    return 'nested'


def test_walk_routes_includes_eager_and_lazy_router_routes_once() -> None:
    lazy_router = APIRouter()

    @lazy_router.get('/internal/v1/lazy', dependencies=[Depends(nested_dependency)])
    def lazy_route() -> dict[str, bool]:
        return {'ok': True}

    eager_router = APIRouter()

    @eager_router.post('/internal/v1/eager', dependencies=[Depends(root_dependency)])
    def eager_route() -> dict[str, bool]:
        return {'ok': True}

    app = FastAPI()
    app.include_router(eager_router)
    app.include_router(lazy_router)

    paths = route_paths(app)
    assert '/internal/v1/eager' in paths
    assert '/internal/v1/lazy' in paths
    assert len([route for route in walk_routes(app) if route.path == '/internal/v1/lazy']) == 1
    expected = ('GET', '/internal/v1/lazy', lazy_route, frozenset({lazy_route, nested_dependency}))
    assert expected in list(iter_routes(app))


def test_internal_api_routes_excludes_outside_prefix_and_returns_methods_and_dependencies() -> None:
    app = FastAPI()

    @app.get('/internal/v1/status', dependencies=[Depends(root_dependency)])
    def status() -> dict[str, bool]:
        return {'ok': True}

    @app.get('/public/status')
    def public_status() -> dict[str, bool]:
        return {'ok': True}

    routes = internal_api_routes(app)
    assert [route.path for route in routes] == ['/internal/v1/status']
    assert routes[0].methods == {'GET'}
    assert routes[0].endpoint is status
    assert root_dependency in routes[0].dependencies
    assert ('GET', '/internal/v1/status', status) in [entry[:3] for entry in iter_routes(app)]


def test_dependant_calls_recurses_transitive_dependency_tree() -> None:
    router = APIRouter()

    def leaf() -> str:
        return 'leaf'

    def middle(value: str = Depends(leaf)) -> str:
        return value

    @router.get('/internal/v1/dependencies')
    def endpoint(value: str = Depends(middle)) -> dict[str, str]:
        return {'value': value}

    app = FastAPI()
    app.include_router(router)
    route = next(
        route for route in internal_api_routes(app) if route.path.endswith('/dependencies')
    )
    calls = dependant_calls(route.dependant)
    assert endpoint in calls
    assert middle in calls
    assert leaf in calls


def test_real_application_walk_finds_the_status_route_and_all_router_decorators(
    client: TestClient
) -> None:
    project_root = Path(__file__).resolve().parents[1]
    router_dir = project_root / 'app' / 'routers'
    decorator = re.compile(
        r'@\w+\.(?:get|post|put|patch|delete|options|head|api_route|route)\s*\(', re.IGNORECASE
    )
    declared = sum(
        len(decorator.findall(path.read_text(encoding='utf-8')))
        for path in sorted(router_dir.glob('*.py'))
    )

    routes = list(iter_routes(client.app))
    assert len(routes) >= declared, (
        f'found {len(routes)} concrete method routes for {declared} router decorators'
    )
    assert any(path == '/internal/v1/status' for _method, path, _endpoint, _dependencies in routes)
