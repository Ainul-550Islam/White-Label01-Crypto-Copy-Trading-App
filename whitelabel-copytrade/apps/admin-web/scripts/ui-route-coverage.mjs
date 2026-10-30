#!/usr/bin/env node
/* eslint-disable no-console -- this script's stdout is its interface: the human
   report, the per-module summary and the JSON document are all output. */
/**
 * Static route inventory. "Referenced" means a literal API call exists in a
 * web/admin module, NOT that a reachable UI invokes it. Computed paths and
 * indirect clients cannot be proven here; they are reported separately.
 * No generated file or package is required beyond the repo's TypeScript.
 *
 * Modes
 * -----
 * default          the historical human report (unchanged byte for byte, so
 *                  anything reading this output keeps working)
 * --summary        the same report plus a per-module table, ordered by the
 *                  number of uncovered routes, then alphabetically
 * --json           one machine-readable document on stdout instead of prose;
 *                  consumed by src/tests/route-coverage-batch04.test.ts
 * --module <name>  with --json, restrict the `uncovered` list to one module
 *                  (repeatable); the summary always covers every module
 * --help           usage
 *
 * The measurement logic itself - controller parsing, client-call matching,
 * the developer-platform UI-reachability rule and the "unresolved" count - is
 * untouched: a coverage script that quietly stopped counting a route would be
 * worse than no script at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const apiRoot = path.join(root, 'apps/api/src');
const uiRoots = ['apps/web/src', 'apps/admin-web/src'].map((p) => path.join(root, p));
const verbs = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);
const relative = (file) => path.relative(root, file).split(path.sep).join('/');

/** CLI surface. Anything unrecognised is an error, not a silent no-op. */
const argv = process.argv.slice(2);
const options = { json: false, summary: false, help: false, modules: [] };
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--json') options.json = true;
  else if (arg === '--summary') options.summary = true;
  else if (arg === '--help' || arg === '-h') options.help = true;
  else if (arg === '--module') {
    const value = argv[i + 1];
    if (!value) {
      console.error('--module requires a value, e.g. --module custody');
      process.exit(2);
    }
    options.modules.push(value);
    i += 1;
  } else {
    console.error(`Unknown argument: ${arg}`);
    console.error('Usage: node apps/admin-web/scripts/ui-route-coverage.mjs [--json] [--summary] [--module <name>]... [--help]');
    process.exit(2);
  }
}

if (options.help) {
  console.log(`Static UI route coverage for the admin console and the customer web app.

  node apps/admin-web/scripts/ui-route-coverage.mjs             human report (unchanged)
  node apps/admin-web/scripts/ui-route-coverage.mjs --summary    human report + per-module table
  node apps/admin-web/scripts/ui-route-coverage.mjs --json       machine-readable document
  node apps/admin-web/scripts/ui-route-coverage.mjs --json --module custody
                                                                JSON, uncovered list limited to a module

Exit code is 0 whenever the inventory can be computed. Coverage is reported as
data; enforcing a threshold is the job of the test that consumes it.`);
  process.exit(0);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
function parse(file) { return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
function decorators(node) { return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []; }
function decorator(node, name) {
  return decorators(node).map((d) => d.expression).find((d) => ts.isCallExpression(d) && ts.isIdentifier(d.expression) && d.expression.text === name);
}
function string(node, constants = new Map()) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return constants.get(node.text);
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => (string(s.expression, constants) ?? ':param') + s.literal.text).join('');
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = string(node.left, constants), right = string(node.right, constants);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}
function prop(object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  const found = object.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText().replace(/['"]/g, '') === name);
  return found && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}
function normalized(...parts) {
  return '/' + parts.join('/').split('?')[0].split('/').filter(Boolean).join('/');
}
function routeDefinitions() {
  const routes = [];
  for (const file of walk(apiRoot).filter((f) => f.endsWith('.controller.ts'))) {
    const source = parse(file);
    function visit(node) {
      if (ts.isClassDeclaration(node)) {
        const marker = decorator(node, 'Controller');
        if (marker) {
          const arg = marker.arguments[0];
          const prefix = ts.isObjectLiteralExpression(arg ?? source) ? string(prop(arg, 'path')) ?? '' : string(arg) ?? '';
          const versionNode = prop(arg, 'version');
          const version = versionNode?.getText(source) === 'VERSION_NEUTRAL' ? '' : `v${string(versionNode) ?? '1'}`;
          for (const member of node.members) {
            for (const d of decorators(member)) {
              const call = d.expression;
              if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !verbs.has(call.expression.text)) continue;
              const suffix = string(call.arguments[0]) ?? '';
              routes.push({ method: call.expression.text.toUpperCase(), path: normalized(version, prefix, suffix), file: relative(file) });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return routes;
}
function clientCalls() {
  const calls = [], unresolved = [];
  for (const uiRoot of uiRoots) for (const file of walk(uiRoot).filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !/[\\/]tests?[\\/]/.test(f))) {
    const source = parse(file), constants = new Map();
    function collect(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const value = string(node.initializer, constants);
        if (value !== undefined) constants.set(node.name.text, value);
      }
      ts.forEachChild(node, collect);
    }
    collect(source);
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        let method, pathArgument = 0;
        if (ts.isPropertyAccessExpression(callee) && callee.expression.getText(source) === 'apiClient' && ['get','post','put','patch','delete'].includes(callee.name.text)) method = callee.name.text.toUpperCase();
        if (ts.isIdentifier(callee) && ['serverFetch', 'fetchJson', 'fetch'].includes(callee.text)) method = string(prop(node.arguments[1], 'method'))?.toUpperCase() ?? 'GET';
        // integrationGet uses a caller-supplied origin/credential as its first
        // argument and the literal versioned endpoint as its second.
        if (ts.isIdentifier(callee) && callee.text === 'integrationGet' && file.endsWith('/developer-platform-api.ts')) { method = 'GET'; pathArgument = 1; }
        if (method) {
          const raw = string(node.arguments[pathArgument], constants);
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          if (raw === undefined) unresolved.push(`${relative(file)}:${line}`);
          else {
            let p = raw.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/proxy(?=\/)/, '');
            if (p.startsWith('/api/') && !p.startsWith('/api/v')) { ts.forEachChild(node, visit); return; }
            p = p.replace(/^\/api(?=\/v\d+\/)/, '');
            if (!p.startsWith('/')) { ts.forEachChild(node, visit); return; }
            if (!/^\/v\d+(\/|$)/.test(p) && !/^\/(health|healthz|readyz|metrics)(\/|$)/.test(p)) p = `/v1${p}`;
            let owner, clientObject;
            let parent = node.parent;
            while (parent && !ts.isSourceFile(parent)) {
              if (ts.isPropertyAssignment(parent) && parent.name && parent.parent && ts.isObjectLiteralExpression(parent.parent) && parent.parent.parent && ts.isVariableDeclaration(parent.parent.parent)) {
                const objectName = parent.parent.parent.name.getText(source);
                if (['developerPlatformApi', 'oauthApi'].includes(objectName)) { owner = parent.name.getText(source); clientObject = objectName; break; }
              }
              parent = parent.parent;
            }
            calls.push({ method, path: normalized(p), file: relative(file), line, owner, clientObject });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { calls, unresolved };
}
function matches(route, call) {
  if (route.method !== call.method) return false;
  const a = route.path.split('/'), b = call.path.split('/');
  return a.length === b.length && a.every((part, i) => part.startsWith(':') || b[i]?.startsWith(':') || part === b[i]);
}

/**
 * The module a route belongs to, derived from its controller path
 * (`apps/api/src/modules/<module>/...`) with the Batch 04 sub-groups pulled out
 * so "billing" and "risk" do not swallow their very different children:
 * `billing/analytics` and `billing/notifications` are their own groups, as are
 * `exchanges`, `execution` and `copy-trading` feature routers.
 */
function moduleOf(file) {
  const match = file.match(/apps\/api\/src\/modules\/([^/]+)\/?(.*)$/);
  if (!match) return { module: '(outside modules/)', area: '' };
  const [, top, rest] = match;
  if (top === 'billing') {
    const sub = rest.split('/')[0];
    return { module: `billing/${sub}`, area: sub };
  }
  return { module: top, area: rest.split('/')[0] ?? '' };
}

const routes = routeDefinitions();
const { calls, unresolved } = clientCalls();
const unused = routes.filter((route) => !calls.some((call) => matches(route, call)));
const developerRoutes = routes.filter((route) => route.file.includes('/developer-platform/'));
const uiDeveloperUsage = new Set();
for (const dir of uiRoots) for (const file of walk(dir).filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !/[\\/]tests?[\\/]/.test(f))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const match of src.matchAll(/\b(developerPlatformApi|oauthApi)\.(\w+)\s*\(/g)) uiDeveloperUsage.add(`${match[1]}.${match[2]}`);
}
const developerClient = calls.filter((call) => call.file.endsWith('/developer-platform-api.ts'));
const developerReferenced = developerRoutes.filter((route) => developerClient.some((call) => matches(route, call)));
// The end-user consent/grant screens use oauthApi in the customer app, rather
// than the admin wrapper. Count those real call sites without treating either
// a wrapper or the machine-only integration routes as a reachable screen.
const developerUsed = developerRoutes.filter((route) => calls.some((call) => call.owner && call.clientObject && uiDeveloperUsage.has(`${call.clientObject}.${call.owner}`) && matches(route, call)));

/** Per-module totals: routes, covered, uncovered, plus the files involved. */
function moduleSummary() {
  const modules = new Map();
  for (const route of routes) {
    const { module } = moduleOf(route.file);
    const entry = modules.get(module) ?? { module, routes: 0, covered: 0, uncovered: 0, files: new Set() };
    entry.routes += 1;
    entry.files.add(route.file);
    if (unused.includes(route)) entry.uncovered += 1;
    else entry.covered += 1;
    modules.set(module, entry);
  }
  return [...modules.values()]
    .map((entry) => ({ ...entry, files: [...entry.files].sort() }))
    .sort((a, b) => b.uncovered - a.uncovered || a.module.localeCompare(b.module));
}

const summary = moduleSummary();
const sortRoutes = (list) => list.slice().sort((a, b) => a.file.localeCompare(b.file) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

if (options.json) {
  const filtered = options.modules.length === 0
    ? unused
    : unused.filter((route) => options.modules.includes(moduleOf(route.file).module));
  const document = {
    generatedBy: 'apps/admin-web/scripts/ui-route-coverage.mjs',
    totals: {
      controllerRoutes: routes.length,
      referenced: routes.length - unused.length,
      uncovered: unused.length,
      unresolvedComputedCalls: unresolved.length,
    },
    developerPlatform: {
      routes: developerRoutes.length,
      withClientWrapper: developerReferenced.length,
      calledByUi: developerUsed.length,
      uncalledByUi: developerRoutes
        .filter((route) => !developerUsed.includes(route))
        .map((route) => ({ method: route.method, path: route.path, file: route.file })),
    },
    // The module filter narrows this list only; totals and the summary always
    // describe the whole repository so a filtered run cannot masquerade as
    // full coverage.
    filter: options.modules,
    uncovered: sortRoutes(filtered).map((route) => ({
      method: route.method,
      path: route.path,
      file: route.file,
      module: moduleOf(route.file).module,
    })),
    modules: summary.map((entry) => ({
      module: entry.module,
      routes: entry.routes,
      covered: entry.covered,
      uncovered: entry.uncovered,
      files: entry.files,
    })),
    unresolved: unresolved.slice().sort(),
  };
  console.log(JSON.stringify(document, null, 2));
  process.exit(0);
}

console.log(`Static inventory: ${routes.length} controller routes; ${routes.length - unused.length} have a literal web/admin client reference; ${unused.length} have none.`);
console.log(`Developer platform: ${developerReferenced.length}/${developerRoutes.length} have client wrappers; ${developerUsed.length}/${developerRoutes.length} are called by a UI component.`);
console.log(`${unresolved.length} computed client calls could not be classified. Wrapper references do not establish UI reachability or runtime correctness.\n`);

if (options.summary) {
  const width = Math.max(...summary.map((entry) => entry.module.length), 'module'.length);
  console.log(`${'module'.padEnd(width)}  routes  covered  uncovered`);
  for (const entry of summary) {
    console.log(`${entry.module.padEnd(width)}  ${String(entry.routes).padStart(6)}  ${String(entry.covered).padStart(7)}  ${String(entry.uncovered).padStart(9)}`);
  }
  console.log('');
}

let group = '';
for (const route of sortRoutes(unused)) {
  if (route.file !== group) { group = route.file; console.log(`\n${group}`); }
  console.log(`  ${route.method.padEnd(6)} ${route.path}`);
}
