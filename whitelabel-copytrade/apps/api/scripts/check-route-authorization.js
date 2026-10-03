#!/usr/bin/env node
/**
 * Route authorization guard.
 *
 * The global PermissionsGuard allows any authenticated user through a route
 * that carries no permission metadata. In the round-4 audit 400 routes in 21
 * controllers were in that state (GDPR deletion, legal holds, partner payouts,
 * maintenance mode, risk policy, kill switches, provider enable/disable, ...),
 * and the payment webhooks lacked @Public() so every provider callback got
 * 401. This script fails when a route has neither class- nor handler-level
 * metadata (@RequirePermissions, @RequireAnyPermission, @PlatformOnly,
 * @Public, @AllowAnyAuthenticated), unless its controller is listed below
 * with the exact number of reviewed routes and the reason they may stay
 * undecorated.
 *
 * Usage: node scripts/check-route-authorization.js [--list]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');
const MARKER = /@(RequirePermissions|RequireAnyPermission|PlatformOnly|Public|AllowAnyAuthenticated)\s*\(/;
const ROUTE = /^\s*@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/;
const SIGNATURE = /^\s*(?:public\s+|protected\s+)?(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/;

/**
 * Reviewed controllers whose undecorated routes are intentional. `routes` is
 * the exact number of undecorated routes: adding one fails the check so it
 * gets reviewed.
 */
const REVIEWED = {
  'modules/client-lifecycle/client-lifecycle.controller.ts': {
    routes: 46,
    reason: 'ownership and staff checks enforced in-handler (client-lifecycle.authorization.spec.ts)',
  },
  'modules/portfolio-accounting/portfolio-accounting.controller.ts': {
    routes: 25,
    reason: 'ownership and staff checks enforced in-handler (portfolio-accounting.authorization.spec.ts)',
  },
  'modules/notifications/notifications.controller.ts': {
    routes: 6,
    reason: "self-service: the caller's own notifications and preferences",
  },
  'modules/auth/two-factor.controller.ts': { routes: 4, reason: "self-service: the caller's own 2FA" },
  'modules/auth/auth.controller.ts': { routes: 3, reason: 'self-service: logout, me, change-password' },
  'modules/auth/sessions.controller.ts': { routes: 3, reason: "self-service: the caller's own sessions" },
  'modules/auth/sso/sso-auth.controller.ts': {
    routes: 1,
    reason: "self-service: POST auth/sso/logout-url, the IdP logout URL of the caller's own current session",
  },
  'modules/users/users.controller.ts': { routes: 2, reason: 'self-service: GET/PATCH users/me' },
  'modules/feature-flags/feature-flags.controller.ts': {
    routes: 1,
    reason: 'flags resolved for the caller (read-only)',
  },
};

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

function scan(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const classLine = lines.findIndex((l) => /^export (abstract )?class /.test(l));
  if (classLine < 0) return null;
  // Class decorators: the contiguous decorator block right above `export class`
  // (doc comments are skipped so that prose mentioning a decorator does not count).
  let classDeco = '';
  for (let i = classLine - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) {
      if (t.startsWith('*/')) continue;
      if (classDeco !== '' && (t.startsWith('*') || t.startsWith('/*'))) break;
      continue;
    }
    if (/^import\b|^\}/.test(t) || /;\s*$/.test(t)) break;
    classDeco = t + '\n' + classDeco;
  }
  const classCovered = MARKER.test(classDeco);
  const routes = [];
  for (let i = classLine + 1; i < lines.length; i++) {
    const m = ROUTE.exec(lines[i]);
    if (!m) continue;
    let deco = '';
    // Look backwards over the decorator block and forwards to the signature.
    for (let j = i - 1; j > classLine; j--) {
      const t = lines[j].trim();
      if (t === '' || t === '}' || t.endsWith(';') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) break;
      deco += t + '\n';
    }
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j];
      if (!t.trim().startsWith('@') && SIGNATURE.test(t)) break;
      deco += t.trim() + '\n';
    }
    routes.push({ method: m[1].toUpperCase(), path: m[3] || '', line: i + 1, covered: classCovered || MARKER.test(deco) });
  }
  return { routes };
}

function main() {
  const list = process.argv.includes('--list');
  const files = walk(SRC, []).sort();
  const problems = [];
  let total = 0;
  let open = 0;
  const seenReviewed = new Set();
  for (const file of files) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const result = scan(file);
    if (!result) continue;
    total += result.routes.length;
    const undecorated = result.routes.filter((r) => !r.covered);
    open += undecorated.length;
    if (list && undecorated.length > 0) {
      console.log(`${String(undecorated.length).padStart(3)}/${String(result.routes.length).padEnd(3)} ${rel}`);
      for (const r of undecorated) console.log(`        ${r.method} ${r.path}  (line ${r.line})`);
    }
    const reviewed = REVIEWED[rel];
    if (reviewed) {
      seenReviewed.add(rel);
      if (undecorated.length !== reviewed.routes) {
        problems.push(
          `${rel}: ${undecorated.length} undecorated routes, reviewed count is ${reviewed.routes} (${reviewed.reason}). ` +
            'Decorate new routes or review and update the count.',
        );
      }
      continue;
    }
    for (const r of undecorated) {
      problems.push(`${rel}:${r.line} ${r.method} ${r.path} has no permission metadata (open to every authenticated user)`);
    }
  }
  for (const rel of Object.keys(REVIEWED)) {
    if (!seenReviewed.has(rel)) problems.push(`${rel}: listed as reviewed but not found; remove the entry`);
  }
  if (problems.length > 0) {
    console.error(`Route authorization check FAILED (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `Route authorization check OK: ${total} routes in ${files.length} controllers; ${open} undecorated, all in reviewed controllers.`,
  );
}

main();
