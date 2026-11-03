#!/usr/bin/env node
/**
 * Web -> API contract check.
 *
 * Every `apiClient.<method>(path)` and `serverFetch(path)` call in apps/web
 * and apps/admin-web must hit a route the API actually declares (same HTTP
 * method, same path, `:param` segments matching anything). The round-4 audit found 17 of 76 web
 * calls pointing at routes that never existed (the maintenance banner, the
 * status page, the whole trading API module, onboarding, account pages, ...);
 * each failed at runtime with a 404 the UI rendered as a generic error.
 *
 * API routes: `/v1/<@Controller prefix>/<@Get|@Post|... path>` from every
 * *.controller.ts under apps/api/src. Web calls with a non-literal path are
 * reported as "dynamic" and not checked.
 *
 * Path conventions:
 *   apps/web        apiClient paths carry the version (`/v1/...`); serverFetch
 *                   paths are relative to /api/v1.
 *   apps/admin-web  apiClient goes through /api/proxy/* and serverFetch through
 *                   lib/server-api.ts; both prepend the version. Module-level
 *                   `fetchJson(`${API_BASE}...`)` browser calls are resolved
 *                   with the file's `const API_BASE = '...'` and must go
 *                   through `/api/proxy/`: any other `/api/...` URL is served
 *                   by the admin Next.js app itself, which only has
 *                   /api/auth/* and /api/proxy/*, so it always 404s.
 *   apps/mobile     paths come from `ApiEndpoints` (core/network/
 *                   api_endpoints.dart), relative to `<API_BASE_URL>/v1`.
 *                   Each `_apiClient.<get|post|patch|delete>(ApiEndpoints.x)`
 *                   call site is checked with its own HTTP method; Dart
 *                   interpolation (`$id`, `${id}`) becomes `:param`.
 *
 * Query keys: see scripts/lib/api-query-contract.js. A key the route's
 * `@Query()` DTO does not declare is a 422 (whitelist + forbidNonWhitelisted);
 * a key a per-key handler does not read is silently ignored. Both fail.
 *
 * Usage: node scripts/check-web-api-contract.js [--list]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const qc = require('./lib/api-query-contract');

const ROOT = path.resolve(__dirname, '..');
const API_SRC = path.join(ROOT, 'apps', 'api', 'src');
const WEB_SRC = path.join(ROOT, 'apps', 'web', 'src');
const ADMIN_SRC = path.join(ROOT, 'apps', 'admin-web', 'src');
const MOBILE_LIB = path.join(ROOT, 'apps', 'mobile', 'lib');
const MOBILE_ENDPOINTS = path.join(MOBILE_LIB, 'core', 'network', 'api_endpoints.dart');

function walk(dir, filter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

function joinPath(...parts) {
  const segs = parts
    .filter((p) => p !== undefined && p !== null)
    .join('/')
    .split('/')
    .filter((s) => s.length > 0);
  return '/' + segs.join('/');
}

/** Backend routes as { method, path } with path like /v1/copy-trading/traders/:id. */
function apiRoutes() {
  const routes = [];
  for (const file of walk(API_SRC, (f) => f.endsWith('.controller.ts'))) {
    const src = fs.readFileSync(file, 'utf8');
    const ctrl =
      /@Controller\(\s*\{[^}]*?path:\s*(['"`])([^'"`]*)\1[^}]*\}\s*\)/.exec(src) ||
      /@Controller\(\s*(['"`])([^'"`]*)\1\s*\)/.exec(src) ||
      (/@Controller\(\s*\)/.test(src) ? [null, null, ''] : null);
    if (!ctrl) continue;
    const prefix = ctrl[2];
    const versionMatch = /@Controller\(\s*\{[^}]*?version:\s*(['"`])([^'"`]*)\1/.exec(src);
    const version = versionMatch ? versionMatch[2] : '1';
    const re = /@(Get|Post|Put|Patch|Delete)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g;
    const found = [...src.matchAll(re)];
    found.forEach((m, k) => {
      const next = k + 1 < found.length ? found[k + 1].index : src.length;
      routes.push({
        method: m[1].toUpperCase(),
        path: joinPath(`v${version}`, prefix, m[3] || ''),
        file: path.relative(ROOT, file),
        query: qc.routeQuery(src, m.index, next),
      });
    });
  }
  return routes;
}

/** Read a string/template literal starting at src[i] (a quote char). */
function readLiteral(src, i) {
  const quote = src[i];
  let out = '';
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      out += src[j + 1];
      j += 2;
      continue;
    }
    if (quote === '`' && c === '$' && src[j + 1] === '{') {
      let depth = 1;
      j += 2;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      out += '${}';
      continue;
    }
    if (c === quote) return { value: out, end: j + 1 };
    out += c;
    j++;
  }
  return null;
}

function skipGeneric(src, i) {
  if (src[i] !== '<') return i;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '<') depth++;
    else if (src[j] === '>' && src[j - 1] !== '=') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return i;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

/** Normalise a web path: strip query strings and trailing template suffixes, params -> :param. */
function normaliseWebPath(raw) {
  let p = raw.split('?')[0];
  const segs = p.split('/').map((seg) => {
    if (seg === '${}') return ':param';
    // `accounts${qs}` or `${base}` glued to text: a trailing template is a query/suffix builder.
    return seg.replace(/\$\{\}$/, '').replace(/\$\{\}/g, ':param');
  });
  p = segs.join('/');
  return joinPath(p);
}

function webCalls(srcDir, app) {
  const calls = [];
  if (!fs.existsSync(srcDir)) return calls;
  const isAdmin = app === 'admin-web';
  for (const file of walk(srcDir, (f) => /\.(ts|tsx)$/.test(f) && !/[\\/]tests?[\\/]/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))) {
    let src = fs.readFileSync(file, 'utf8');
    // Resolve simple module constants used to build URLs, in dependency order.
    for (const name of ['PROXY_PREFIX', 'API_BASE']) {
      const def = new RegExp(`\\bconst\\s+${name}\\s*=\\s*(['"\`])([^'"\`]*)\\1`).exec(src);
      if (def && !def[2].includes('${')) src = src.split('${' + name + '}').join(def[2]);
    }
    const re = isAdmin
      ? /\bapiClient\.(get|post|put|patch|delete)\b|\bserverFetch\b|\bfetchJson\b/g
      : /\bapiClient\.(get|post|put|patch|delete)\b|\bserverFetch\b/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const isServer = m[0] === 'serverFetch';
      const isFetchJson = m[0] === 'fetchJson';
      // `function serverFetch<T>(path...` is the definition, not a call.
      if (/\bfunction\s*$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
      let i = skipGeneric(src, m.index + m[0].length);
      while (/\s/.test(src[i])) i++;
      if (src[i] !== '(') continue; // import or reference, not a call
      const callOpen = i;
      i++;
      while (/\s/.test(src[i])) i++;
      const rel = path.relative(ROOT, file);
      const line = lineOf(src, m.index);
      if (!['"', "'", '`'].includes(src[i])) {
        calls.push({ file: rel, line, dynamic: true });
        continue;
      }
      const lit = readLiteral(src, i);
      if (!lit) continue;
      let method = isServer || isFetchJson ? 'GET' : m[1].toUpperCase();
      if (isServer || isFetchJson) {
        const tail = src.slice(lit.end, lit.end + 400);
        const mm = /method:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i.exec(tail.split(/\)\s*;/)[0]);
        if (mm) method = mm[1].toUpperCase();
      }
      let p = lit.value;
      if (isFetchJson) {
        if (!p.startsWith('/api/proxy/')) {
          calls.push({ file: rel, line, method, raw: lit.value, path: normaliseWebPath(p), reason: 'not routed through /api/proxy (the admin app has no such route)' });
          continue;
        }
        p = p.slice('/api/proxy'.length);
      }
      const prependVersion = isServer || (isAdmin && (m[1] !== undefined || isFetchJson));
      if (prependVersion && !/^\/?v\d+\//.test(p)) p = joinPath('v1', p);
      const callEnd = qc.balancedEnd(src, callOpen);
      const args = callEnd > 0 ? src.slice(callOpen, callEnd) : '';
      const query = mergeQuery(qc.inlineQueryKeys(lit.value), qc.queryKeysFromArgs(args, 'searchParams', src, m.index));
      calls.push({ file: rel, line, method, raw: lit.value, path: normaliseWebPath(p), query });
    }
  }
  return calls;
}

/** Flutter call sites: ApiEndpoints constants/functions resolved per HTTP verb. */
function mobileCalls() {
  const calls = [];
  if (!fs.existsSync(MOBILE_ENDPOINTS)) return calls;
  const table = {};
  const defs = fs.readFileSync(MOBILE_ENDPOINTS, 'utf8');
  for (const m of defs.matchAll(/static\s+(?:const\s+)?String\s+(\w+)\s*(?:=|\([^)]*\)\s*=>)\s*'([^']*)'/g)) {
    table[m[1]] = m[2].replace(/\$\{[^}]*\}|\$\w+/g, '${}');
  }
  for (const file of walk(MOBILE_LIB, (f) => f.endsWith('.dart') && f !== MOBILE_ENDPOINTS)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    for (const m of src.matchAll(/ApiEndpoints\.(\w+)/g)) {
      const before = src.slice(Math.max(0, m.index - 300), m.index);
      const verbs = [...before.matchAll(/\b_?apiClient\.(get|post|patch|put|delete)\b/gi)];
      const line = lineOf(src, m.index);
      if (verbs.length === 0 || !(m[1] in table)) {
        calls.push({ file: rel, line, dynamic: true });
        continue;
      }
      const verb = verbs[verbs.length - 1];
      const method = verb[1].toUpperCase();
      const raw = table[m[1]];
      const verbAt = m.index - before.length + verb.index + verb[0].length;
      const open = src.indexOf('(', verbAt);
      const end = open > 0 ? qc.balancedEnd(src, open) : -1;
      const query = end > 0 ? qc.queryKeysFromArgs(src.slice(open, end), 'queryParameters', src, m.index) : null;
      calls.push({ file: rel, line, method, raw: `ApiEndpoints.${m[1]} = '${raw}'`, path: normaliseWebPath(joinPath('v1', raw)), query });
    }
  }
  return calls;
}

function mergeQuery(a, b) {
  if (!a && !b) return null;
  return { keys: [...((a && a.keys) || []), ...((b && b.keys) || [])], partial: Boolean((a && a.partial) || (b && b.partial)) };
}

/** The most specific matching route (most literal segments equal). */
function bestRoute(routes, call) {
  let best = null;
  let score = -1;
  for (const r of routes) {
    if (!matches(r, call)) continue;
    const a = r.path.split('/');
    const b = call.path.split('/');
    const sc = a.filter((seg, k) => !seg.startsWith(':') && seg === b[k]).length;
    if (sc > score) {
      best = r;
      score = sc;
    }
  }
  return best;
}

function matches(route, call) {
  if (route.method !== call.method) return false;
  const a = route.path.split('/');
  const b = call.path.split('/');
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (a[k].startsWith(':') || b[k] === ':param') continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function main() {
  const list = process.argv.includes('--list');
  const routes = apiRoutes();
  const calls = [...webCalls(WEB_SRC, 'web'), ...webCalls(ADMIN_SRC, 'admin-web'), ...mobileCalls()];
  const checked = calls.filter((c) => !c.dynamic);
  const classes = qc.dtoIndex(walk, API_SRC);
  for (const c of checked) {
    if (c.reason) continue;
    const r = bestRoute(routes, c);
    if (!r) continue;
    const problem = qc.queryProblem(c, r, classes);
    if (problem) c.reason = problem;
  }
  const withQuery = checked.filter((c) => c.query && c.query.keys.length > 0).length;
  const bad = checked.filter((c) => c.reason || !routes.some((r) => matches(r, c)));
  if (list) {
    for (const c of checked) console.log(`${bad.includes(c) ? 'BAD ' : 'ok  '} ${c.method.padEnd(6)} ${c.path.padEnd(60)} ${c.file}:${c.line}`);
  }
  const dynamic = calls.length - checked.length;
  if (bad.length > 0) {
    console.error(`Web API contract check FAILED: ${bad.length} of ${checked.length} client calls have no matching API route or send query keys the route does not accept`);
    for (const c of bad) console.error(`  - ${c.method} ${c.raw}  (${c.file}:${c.line}) -> ${c.reason || c.path}`);
    process.exit(1);
  }
  console.log(
    `Web API contract check OK: ${checked.length} client calls match ${routes.length} API routes; query keys checked on ${withQuery}` +
      (dynamic > 0 ? ` (${dynamic} dynamic paths not checked)` : ''),
  );
}

main();
