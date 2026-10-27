#!/usr/bin/env node
/**
 * Static route inventory. "Referenced" means a literal API call exists in a
 * web/admin module, NOT that a reachable UI invokes it. Computed paths and
 * indirect clients cannot be proven here; they are reported separately.
 * No generated file or package is required beyond the repo's TypeScript.
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
console.log(`Static inventory: ${routes.length} controller routes; ${routes.length - unused.length} have a literal web/admin client reference; ${unused.length} have none.`);
console.log(`Developer platform: ${developerReferenced.length}/${developerRoutes.length} have client wrappers; ${developerUsed.length}/${developerRoutes.length} are called by a UI component.`);
console.log(`${unresolved.length} computed client calls could not be classified. Wrapper references do not establish UI reachability or runtime correctness.\n`);
let group = '';
for (const route of unused.sort((a, b) => a.file.localeCompare(b.file) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method))) {
  if (route.file !== group) { group = route.file; console.log(`\n${group}`); }
  console.log(`  ${route.method.padEnd(6)} ${route.path}`);
}
