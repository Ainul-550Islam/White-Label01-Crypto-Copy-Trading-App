// # Enforces that every @RequireStepUp route is a mutating route that also carries permission metadata, that its action is declared in the shared catalog, and that exactly one step-up guard is registered.
/**
 * Step-up path guard.
 *
 * `@RequireStepUp('SOMETHING')` is a promise: this route mutates money or
 * credentials, so the caller must have proved themselves *for this operation*
 * seconds ago. Four ways that promise silently stops being true, all of which
 * have been seen in this codebase:
 *
 *   1. The action string is not in `STEP_UP_ACTIONS`. The type is checked at
 *      compile time only while the file keeps its import; a plain string in a
 *      controller that stopped importing the type still compiles and the guard
 *      then compares against a value nothing can ever be issued for.
 *   2. The decorator sits on a GET. A proof is consumed by the guard, so a
 *      step-up on a read burns the user's proof and returns stale data - and it
 *      is a sign the route underneath is a mutation wearing the wrong verb.
 *   3. The route has no permission metadata, so any authenticated user reaches
 *      the handler and the step-up is the only gate on it. Step-up is a second
 *      factor, never the first: it must sit on top of an authorisation.
 *   4. The guard is registered twice (an APP_GUARD plus a local @UseGuards in a
 *      controller): the first consumes the proof and the second refuses, so the
 *      route is permanently unusable. This is the failure that made step-up
 *      look "enabled" while every sensitive action 403'd.
 *
 * It also fails when a declared action is used nowhere, because an action that
 * can be proved but reaches no route is a documented capability that does not
 * exist.
 *
 * Usage: node scripts/check-step-up-paths.mjs [--list]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const API_SRC = path.join(root, 'apps', 'api', 'src');
const CATALOG = path.join(root, 'packages', 'shared-types', 'src', 'step-up.ts');

const listOnly = process.argv.includes('--list');

/**
 * Controllers where a step-up route legitimately has no permission metadata.
 * Step-up is still the SECOND factor here: these routes act on the caller's own
 * account only (the principal comes from the JWT, no id parameter names a
 * user), which is exactly what `check-route-authorization.js` records for the
 * same controller. Anything else must carry a permission decorator.
 */
const SELF_SERVICE = {
  'modules/auth/two-factor.controller.ts':
    "self-service 2FA: the caller disables or re-issues codes for their own account",
};

const ROUTE = /^\s*@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/;
const STEP_UP = /@RequireStepUp\(\s*(['"`])([A-Z0-9_]+)\1\s*\)/;
const ANY_PERMISSION = /@(RequirePermissions|RequireAnyPermission|PlatformOnly)\s*\(/;
const CLASS_DECL = /^export (abstract )?class [A-Za-z0-9_]+/;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function declaredActions() {
  const source = fs.readFileSync(CATALOG, 'utf8');
  const block = source.slice(source.indexOf('STEP_UP_ACTIONS'), source.indexOf('as const'));
  const actions = [...block.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  return new Set(actions);
}

/** A decorator line, or the tail of a multi-line decorator call. */
function isDecoratorLine(line) {
  const text = line.trim();
  if (text === '') return false;
  if (text.startsWith('@')) return true;
  if (text.startsWith('*') || text.startsWith('/*') || text.startsWith('//')) return true;
  return text === '})' || text.startsWith('}') || text.endsWith(',') || text.endsWith(')');
}

/** Decorators directly above a line, stopping at a blank line or a doc comment. */
function decoratorBlockAbove(lines, index) {
  const block = [];
  for (let i = index - 1; i >= 0; i--) {
    const text = lines[i].trim();
    if (text === '') break;
    if (text.startsWith('*') || text.startsWith('/*') || text.startsWith('//')) {
      if (block.length === 0) continue;
      break;
    }
    if (text.startsWith('@') || text === '});' || text.startsWith('}')) {
      block.push(text);
      continue;
    }
    if (/[;,{]$/.test(text)) {
      block.push(text);
      continue;
    }
    break;
  }
  return block.join('\n');
}

function classDecorators(lines) {
  const classLine = lines.findIndex((line) => CLASS_DECL.test(line));
  if (classLine < 0) return '';
  return decoratorBlockAbove(lines, classLine);
}

const actions = declaredActions();
const failures = [];
const observed = [];
const usedActions = new Set();
let guardRegistrations = 0;
let localGuardUses = 0;

for (const file of walk(API_SRC, [])) {
  const relative = path.relative(API_SRC, file);
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');

  for (const match of source.matchAll(/useExisting:\s*StepUpGuard|provide:\s*APP_GUARD,\s*useClass:\s*StepUpGuard/g)) {
    guardRegistrations += 1;
    void match;
  }
  for (const match of source.matchAll(/@UseGuards\([^)]*StepUpGuard/g)) {
    localGuardUses += 1;
    void match;
  }

  if (!relative.endsWith('.controller.ts')) continue;

  const classBlock = classDecorators(lines);
  const classDecorated = ANY_PERMISSION.test(classBlock);

  for (let i = 0; i < lines.length; i++) {
    if (!STEP_UP.test(lines[i])) continue;

    const action = lines[i].match(STEP_UP)[2];
    usedActions.add(action);
    if (!actions.has(action)) {
      failures.push(`${relative}:${i + 1}: @RequireStepUp('${action}') is not declared in STEP_UP_ACTIONS`);
    }

    // The decorator block this line belongs to: contiguous decorator lines
    // above and below it. TypeScript decorators are order-independent, and this
    // codebase writes @RequireStepUp above the @Post in some controllers and
    // below it in others, so the route verb is looked up in the whole block.
    let blockStart = i;
    while (blockStart - 1 >= 0 && isDecoratorLine(lines[blockStart - 1])) blockStart -= 1;
    let blockEnd = i;
    while (blockEnd + 1 < lines.length && isDecoratorLine(lines[blockEnd + 1])) blockEnd += 1;

    let routeLine = -1;
    for (let j = blockStart; j <= blockEnd; j++) {
      if (ROUTE.test(lines[j])) {
        routeLine = j;
        break;
      }
    }
    if (routeLine < 0) {
      failures.push(`${relative}:${i + 1}: @RequireStepUp('${action}') is not attached to a route handler`);
      continue;
    }
    const verb = lines[routeLine].match(ROUTE)[1];
    const routePath = lines[routeLine].match(ROUTE)[3] ?? '';
    observed.push({ file: relative, verb, routePath, action, line: i + 1 });

    if (verb === 'Get') {
      failures.push(
        `${relative}:${routeLine + 1}: @RequireStepUp('${action}') decorates a GET (${verb} '${routePath}'); a consumed proof on a read burns the user's verification`,
      );
    }

    const handlerBlock = lines.slice(blockStart, blockEnd + 1).join('\n');
    if (!classDecorated && !ANY_PERMISSION.test(handlerBlock) && !SELF_SERVICE[relative]) {
      failures.push(
        `${relative}:${routeLine + 1}: @RequireStepUp('${action}') route has no permission metadata (class or handler); step-up must sit on top of an authorisation`,
      );
    }
  }
}

if (guardRegistrations !== 1) {
  failures.push(
    `apps/api/src: StepUpGuard must be registered exactly once as an APP_GUARD (found ${guardRegistrations})`,
  );
}
if (localGuardUses > 0) {
  failures.push(
    `apps/api/src: StepUpGuard is also applied per-controller ${localGuardUses} time(s); the global guard would have consumed the proof already`,
  );
}

/**
 * Actions that are deliberately declared before any route requires them.
 *
 * Batch 04 owns the routes for these; the union has to contain them on both
 * branches or a proof issued by one deployment is unreadable by the other. They are
 * named here rather than silently exempted, so this list is the review point: an
 * entry that stays here for long enough to ship is an action nobody gated.
 */
const RESERVED_FOR_BATCH_04 = new Set([
  'AUDIT_EXPORT',
  'DATA_DELETION_REQUEST',
  'FEE_SCHEDULE_PUBLISH',
  'FEATURE_FLAG_LIVE_TOGGLE',
  'STATEMENT_REGENERATE',
]);

for (const action of actions) {
  if (RESERVED_FOR_BATCH_04.has(action)) continue;
  if (!usedActions.has(action)) {
    failures.push(`packages/shared-types/src/step-up.ts: '${action}' is declared but no route requires it`);
  }
}
for (const [file, reason] of Object.entries(SELF_SERVICE)) {
  if (!observed.some((entry) => entry.file === file)) {
    failures.push(`${file}: listed as self-service (${reason}) but requires no step-up; drop the exemption`);
  }
}
if (observed.length === 0) {
  failures.push('apps/api/src: no @RequireStepUp route found; the sensitive-operation gate covers nothing');
}

if (listOnly) {
  for (const entry of observed) {
    console.log(`${entry.verb.padEnd(6)} ${entry.routePath.padEnd(40)} ${entry.action.padEnd(26)} ${entry.file}:${entry.line}`);
  }
  console.log(`${observed.length} step-up route(s), ${actions.size} declared action(s)`);
}

if (failures.length > 0) {
  console.error('Step-up path checks failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Step-up paths are valid: ${observed.length} route(s) across ${new Set(observed.map((o) => o.file)).size} controller(s) require a single-use proof.`,
);
