// # Responsibility: a dependency-free stub of the platform API for the browser E2E suite, which fails loudly on any route the suite has not declared instead of inventing a response.
//
// Why a stub upstream and not `page.route()`: the customer web app's data path is
// browser -> `/api/proxy/*` (Next route handler) -> platform API, and the admin console's is
// `serverFetch` inside a server component. Half of that traffic never passes through the browser,
// so intercepting in the browser would silently test nothing for the admin console. The stub sits
// where the real API sits, and both applications talk to it through their normal code paths
// (`API_BASE_URL`), which is what makes the suite end-to-end.
//
// The behaviour that matters most is what happens on a route nobody stubbed: a 404 whose body names
// the path, recorded in `unmatched`. The specs assert `unmatched` is empty, so a page that starts
// calling a new endpoint fails the suite with the path in the report rather than rendering an empty
// state and passing.
//
// It is also a small control surface for the suite:
//   GET  /__stub/requests          every request the applications made (assertions about traffic)
//   POST /__stub/mode              { rankingUnavailable: true }        (drive an unavailable state)
//   POST /__stub/reset             clears the request log, the mode and any pause
//
// Authentication is enforced the way the platform enforces it: every route except login requires
// `authorization: Bearer <access token>`, so a broken session path (cookie not set, token not
// forwarded by the proxy) fails the suite with a 401 instead of passing with a rendered page.

import { createServer } from 'node:http';

import {
  E2E_ACCESS_TOKEN,
  E2E_REFRESH_TOKEN,
  E2E_USER,
  activeRestrictions,
  complianceCases,
  custodyReconciliationFindings,
  maintenanceCurrent,
  monitoringSignals,
  notificationsPage,
  effectivePolicyResource,
  executionsPage,
  rankings,
  rankingsMethodology,
  subscriptionResource,
  subscriptionResourcePaused,
  subscriptionsPage,
  traders,
} from './fixtures.mjs';

export const API_VERSION = 'v1';
export const DEFAULT_PORT = 4600;

const SESSION_PAYLOAD = {
  tokens: {
    accessToken: E2E_ACCESS_TOKEN,
    refreshToken: E2E_REFRESH_TOKEN,
    expiresIn: 900,
    refreshExpiresIn: 604800,
  },
  user: E2E_USER,
  sessionId: 'session-e2e-1',
};

export function createStubApi({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  const state = {
    requests: [],
    unmatched: [],
    mode: { rankingUnavailable: false },
    pausedSubscriptions: new Set(),
  };

  const routes = [
    // ---- session ---------------------------------------------------------------------------
    {
      method: 'POST',
      path: `/${API_VERSION}/auth/login`,
      authenticated: false,
      handler: () => ok(SESSION_PAYLOAD),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/auth/me`,
      handler: () => ok({ user: E2E_USER, permissions: ['*'], tenantId: 'tenant-e2e' }),
    },
    {
      method: 'POST',
      path: `/${API_VERSION}/auth/refresh`,
      authenticated: false,
      handler: () => ok(SESSION_PAYLOAD),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/tenants/public-config`,
      authenticated: false,
      handler: () =>
        ok({
          tenantId: 'tenant-e2e',
          slug: 'platform',
          displayName: 'E2E Platform',
          branding: { primaryColor: '#111827' },
          features: {},
        }),
    },

    // ---- discovery -------------------------------------------------------------------------
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/traders`,
      handler: (_req, url) => {
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        const verification = url.searchParams.get('verificationState') ?? '';
        const featuredOnly = url.searchParams.get('isFeatured') === 'true';
        const rows = traders.filter((trader) => {
          if (search && !`${trader.displayName} ${trader.bio}`.toLowerCase().includes(search)) {
            return false;
          }
          if (verification && trader.verificationState !== verification) return false;
          if (featuredOnly && !trader.isFeatured) return false;
          return true;
        });
        return ok({ data: rows, total: rows.length });
      },
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/rankings`,
      handler: () => {
        if (state.mode.rankingUnavailable) {
          return ok({
            data: [],
            total: 0,
            methodology: {
              ...rankingsMethodology,
              status: 'UNAVAILABLE',
              rankedCount: 0,
              unrankedCount: traders.length,
            },
          });
        }
        return ok({ data: rankings, total: rankings.length, methodology: rankingsMethodology });
      },
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/traders/:traderId/performance`,
      handler: (_req, _url, params) => {
        const ranking = rankings.find((row) => row.traderId === params.traderId);
        return ok(ranking?.performance ?? null);
      },
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/traders/:traderId`,
      handler: (_req, _url, params) => {
        const trader = traders.find((row) => row.traderId === params.traderId);
        return trader ? ok(trader) : notFound(`no trader ${params.traderId}`);
      },
    },

    // ---- subscriptions ---------------------------------------------------------------------
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/subscriptions/me`,
      handler: () => ok(subscriptionsPage),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/subscriptions/:subscriptionId`,
      handler: (_req, _url, params) =>
        ok(
          state.pausedSubscriptions.has(params.subscriptionId)
            ? subscriptionResourcePaused()
            : subscriptionResource,
        ),
    },
    {
      method: 'POST',
      path: `/${API_VERSION}/copy-trading/subscriptions/:subscriptionId/pause`,
      handler: (_req, _url, params) => {
        state.pausedSubscriptions.add(params.subscriptionId);
        return ok(subscriptionResourcePaused());
      },
    },
    {
      method: 'POST',
      path: `/${API_VERSION}/copy-trading/subscriptions/:subscriptionId/resume`,
      handler: (_req, _url, params) => {
        state.pausedSubscriptions.delete(params.subscriptionId);
        return ok(subscriptionResource);
      },
    },
    // The subscription detail view composes three calls, not one: the subscription, the effective
    // policy and the execution page. All three are declared here, because a 404 on any of them is a
    // page the customer sees broken and a spec that must fail.
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/policies/effective`,
      handler: () => ok(effectivePolicyResource),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/executions`,
      handler: (_req, url) => {
        const subscriptionId = url.searchParams.get('subscriptionId');
        const rows = subscriptionId
          ? executionsPage.data.filter((row) => row.subscriptionId === subscriptionId)
          : executionsPage.data;
        return ok({ data: rows, total: rows.length });
      },
    },

    // ---- trading state the pages compose their banners from ---------------------------------
    {
      method: 'GET',
      path: `/${API_VERSION}/operations/maintenance/current`,
      handler: () => ok(maintenanceCurrent),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/client-lifecycle/restrictions`,
      handler: () => ok(activeRestrictions),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/notifications`,
      handler: () => ok(notificationsPage),
    },

    // ---- admin console ---------------------------------------------------------------------
    {
      method: 'GET',
      path: `/${API_VERSION}/compliance/cases`,
      handler: () => ok(complianceCases),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/compliance/monitoring/signals`,
      handler: () => ok(monitoringSignals),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/custody/reconciliation/findings`,
      handler: () => ok(custodyReconciliationFindings),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/operations/maintenance`,
      handler: () => ok({ data: [], total: 0 }),
    },

    // ---- control surface -------------------------------------------------------------------
    {
      method: 'GET',
      path: '/__stub/requests',
      authenticated: false,
      prefix: true,
      handler: () => ok({ requests: state.requests, unmatched: state.unmatched, mode: state.mode }),
    },
    {
      method: 'POST',
      path: '/__stub/mode',
      authenticated: false,
      handler: (_req, _url, _params, body) => {
        state.mode = { ...state.mode, ...(body ?? {}) };
        return ok(state.mode);
      },
    },
    {
      method: 'POST',
      path: '/__stub/reset',
      authenticated: false,
      handler: () => {
        state.requests = [];
        state.unmatched = [];
        state.mode = { rankingUnavailable: false };
        state.pausedSubscriptions.clear();
        return ok({ reset: true });
      },
    },
  ];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    const authorization = req.headers.authorization ?? null;
    const body = await readJsonBody(req);
    const entry = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      authorized: authorization === `Bearer ${E2E_ACCESS_TOKEN}`,
    };
    state.requests.push(entry);

    const route = matchRoute(routes, req.method ?? 'GET', url.pathname);
    if (!route) {
      state.unmatched.push(entry);
      return send(res, 404, {
        success: false,
        error: {
          code: 'STUB_API_UNMATCHED_ROUTE',
          message: `stub-api has no route for ${req.method} ${url.pathname}; declare it in tests/e2e/browser/support/stub-api.mjs`,
        },
      });
    }

    if (route.authenticated !== false && authorization !== `Bearer ${E2E_ACCESS_TOKEN}`) {
      return send(res, 401, {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'The stub requires the session token issued at login.',
        },
      });
    }

    let result;
    try {
      result = route.handler(req, url, route.params ?? {}, body);
    } catch (error) {
      return send(res, 500, {
        success: false,
        error: { code: 'STUB_API_ERROR', message: (error && error.message) || 'stub handler threw' },
      });
    }
    return send(res, result.status, result.body);
  });

  return {
    port,
    host,
    state,
    server,
    baseUrl: `http://${host}:${port}`,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
      }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      }),
  };
}

function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.prefix) {
      if (pathname.startsWith(route.path)) return { ...route, params: {} };
      continue;
    }
    const routeSegments = route.path.split('/');
    const pathSegments = pathname.split('/');
    if (routeSegments.length !== pathSegments.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < routeSegments.length; index += 1) {
      const expected = routeSegments[index];
      const actual = pathSegments[index];
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { ...route, params };
  }
  return null;
}

async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function ok(data) {
  return { status: 200, body: { success: true, data } };
}

function notFound(message) {
  return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message } } };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// `node tests/e2e/browser/support/stub-api.mjs --port 4600` starts it for a manual session.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('stub-api.mjs');
if (invokedDirectly) {
  const portFlag = process.argv.indexOf('--port');
  const port = portFlag === -1 ? DEFAULT_PORT : Number(process.argv[portFlag + 1]);
  const stub = createStubApi({ port });
  await stub.listen();
  console.log(`stub-api listening on ${stub.baseUrl}/${API_VERSION}`);
}
