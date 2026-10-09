# API - bootstrap, config and common layer

Entrypoint, configuration service, Swagger, and the cross-cutting filters, guards, interceptors, pipes and middleware.

73 files. Part of the complete source dump - see `docs/source/README.md`.

---

FILE: apps/api/.eslintrc.cjs

```javascript
/** ESLint configuration for the NestJS API. */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // Both projects: the build config covers src, the spec config covers the
    // *.spec.ts files that the build config excludes so they stay out of dist.
    project: ['tsconfig.json', 'tsconfig.spec.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.cjs', 'dist', 'node_modules', 'prisma/generated'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
};
```

FILE: apps/api/.prettierrc

```text
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true,
  "arrowParens": "always"
}
```

FILE: apps/api/nest-cli.json

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "entryFile": "main",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json",
    "plugins": [
      {
        "name": "@nestjs/swagger",
        "options": {
          "classValidatorShim": true,
          "introspectComments": true
        }
      }
    ]
  }
}
```

FILE: apps/api/package.json

```json
{
  "name": "@wlct/api",
  "version": "1.0.0",
  "private": true,
  "description": "NestJS API gateway for the white-label copy-trading platform",
  "main": "dist/main.js",
  "scripts": {
    "prebuild": "rimraf dist",
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main.js",
    "lint": "eslint \"{src,test}/**/*.ts\" --max-warnings=0",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "jest --passWithNoTests",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json --passWithNoTests",
    "prisma:generate": "dotenv -e ../../.env -- prisma generate",
    "prisma:migrate": "dotenv -e ../../.env -- prisma migrate dev",
    "prisma:deploy": "dotenv -e ../../.env -- prisma migrate deploy",
    "prisma:reset": "dotenv -e ../../.env -- prisma migrate reset --force",
    "prisma:studio": "dotenv -e ../../.env -- prisma studio",
    "db:seed": "dotenv -e ../../.env -- ts-node --transpile-only prisma/seed.ts",
    "worker": "node dist/worker.js",
    "worker:dev": "ts-node --transpile-only src/worker.ts"
  },
  "prisma": {
    "seed": "dotenv -e ../../.env -- ts-node --transpile-only prisma/seed.ts"
  },
  "dependencies": {
    "@nestjs/bullmq": "^10.2.1",
    "@nestjs/common": "^10.4.4",
    "@nestjs/config": "^3.2.3",
    "@nestjs/core": "^10.4.4",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.4.4",
    "@nestjs/platform-socket.io": "^10.4.4",
    "@nestjs/schedule": "^4.1.1",
    "@nestjs/swagger": "^7.4.2",
    "@nestjs/terminus": "^10.2.3",
    "@nestjs/throttler": "^6.2.1",
    "@nestjs/websockets": "^10.4.4",
    "@node-saml/node-saml": "^5.1.0",
    "@prisma/client": "^5.22.0",
    "@socket.io/redis-adapter": "^8.3.0",
    "@wlct/config": "1.0.0",
    "@wlct/shared-types": "1.0.0",
    "@wlct/utils": "1.0.0",
    "@wlct/validation": "1.0.0",
    "@xmldom/xmldom": "^0.8.15",
    "argon2": "^0.41.1",
    "bullmq": "^5.13.2",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "compression": "^1.7.4",
    "cookie-parser": "^1.4.6",
    "express": "^4.21.0",
    "helmet": "^7.1.0",
    "ioredis": "^5.4.1",
    "jose": "^5.10.0",
    "nestjs-pino": "^4.1.0",
    "nodemailer": "^6.9.15",
    "otplib": "^12.0.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pino": "^9.4.0",
    "pino-http": "^10.3.0",
    "qrcode": "^1.5.4",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "socket.io": "^4.8.0",
    "stripe": "^14.25.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/schematics": "^10.1.4",
    "@nestjs/testing": "^10.4.4",
    "@types/compression": "^1.7.5",
    "@types/cookie-parser": "^1.4.7",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.13",
    "@types/node": "^20.14.10",
    "@types/nodemailer": "^6.4.16",
    "@types/passport-jwt": "^4.0.1",
    "@types/qrcode": "^1.5.5",
    "@types/supertest": "^6.0.2",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "dotenv-cli": "^7.4.2",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-prettier": "^5.2.1",
    "jest": "^29.7.0",
    "pino-pretty": "^11.2.2",
    "prettier": "^3.3.3",
    "prisma": "^5.22.0",
    "rimraf": "^5.0.7",
    "source-map-support": "^0.5.21",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.5.4",
    "xml-crypto": "^6.3.2"
  },
  "jest": {
    "moduleFileExtensions": [
      "js",
      "json",
      "ts"
    ],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "collectCoverageFrom": [
      "**/*.(t|j)s"
    ],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node",
    "globalSetup": "<rootDir>/../test/sso-test-keys.global-setup.js",
    "moduleNameMapper": {
      "^@wlct/shared-types$": "<rootDir>/../../../packages/shared-types/src",
      "^@wlct/config$": "<rootDir>/../../../packages/config/src",
      "^@wlct/utils$": "<rootDir>/../../../packages/utils/src",
      "^@wlct/validation$": "<rootDir>/../../../packages/validation/src",
      "^src/(.*)$": "<rootDir>/$1"
    }
  },
  "optionalDependencies": {
    "firebase-admin": "^13.10.0"
  }
}
```

FILE: apps/api/scripts/check-prisma-literals.js

```javascript
#!/usr/bin/env node
/**
 * Static check for Prisma calls that bypass the generated types.
 *
 * Much of the API calls Prisma through `(this.prisma as any).model.op({...})`,
 * which turns off type checking: an unknown column, a missing required column or
 * an enum value that does not exist only fails at runtime (and is often swallowed
 * by a surrounding try/catch). This script parses every non-spec source file and,
 * for each `<receiver>.<prismaModel>.<operation>({ ... })` call with an object
 * literal argument, checks against the Prisma DMMF:
 *
 *   - UNKNOWN   keys under data/create/update/where/orderBy/select that are not
 *               fields of the model (including keys inside conditional spreads
 *               such as `...(cond ? { closedBy } : {})`);
 *   - MISSING   required scalar fields without a default in create data;
 *   - ENUM      string literals (direct, `'X' as any`, both branches of a
 *               conditional, `{ in: [...] }`, `{ not: 'X' }`, `{ equals: 'X' }`)
 *               given to an enum field that are not values of that enum.
 *
 * Dynamically built objects (`const data: any = {}; data.x = ...`) cannot be seen
 * statically and must be reviewed by hand.
 *
 * Usage: node scripts/check-prisma-literals.js [srcDir]   (default: ./src)
 * Exit code 1 when findings exist. `scan()` is exported for the jest spec.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const OPERATIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
const CHECKED_ARGS = new Set(['data', 'create', 'update', 'where', 'orderBy', 'select']);
const LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT', '_count']);
const ENUM_FILTER_KEYS = new Set(['in', 'notIn', 'not', 'equals']);

/** Builds `{ modelsByDelegate, enums }` from a Prisma DMMF datamodel. */
function loadDatamodel(dmmf) {
  const modelsByDelegate = new Map();
  for (const model of dmmf.datamodel.models) {
    const delegate = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    modelsByDelegate.set(delegate, {
      name: model.name,
      fields: new Map(model.fields.map((f) => [f.name, f])),
    });
  }
  const enums = new Map(
    dmmf.datamodel.enums.map((e) => [e.name, new Set(e.values.map((v) => v.name))]),
  );
  return { modelsByDelegate, enums };
}

function listSourceFiles(dir) {
  const files = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$|\.d\.ts$/.test(entry.name)) {
        files.push(full);
      }
    }
  })(dir);
  return files.sort();
}

function propertyName(prop) {
  if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
  if (
    ts.isPropertyAssignment(prop) &&
    prop.name &&
    (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
  )
    return prop.name.text;
  return null;
}

function unwrap(expr) {
  let current = expr;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

/** Object literals reachable from a spread: `...{a}`, `...(c ? {a} : {b})`, `...(c && {a})`. */
function spreadObjects(expr) {
  const node = unwrap(expr);
  if (!node) return [];
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isConditionalExpression(node))
    return [...spreadObjects(node.whenTrue), ...spreadObjects(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  )
    return spreadObjects(node.right);
  return [];
}

/** All (key, property) pairs of an object literal, including those inside conditional spreads. */
function collectProperties(obj) {
  const result = [];
  let hasOpaqueSpread = false;
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const nested = spreadObjects(prop.expression);
      if (nested.length === 0) hasOpaqueSpread = true;
      for (const inner of nested) {
        const collected = collectProperties(inner);
        result.push(...collected.properties.map((entry) => ({ ...entry, conditional: true })));
        if (collected.hasOpaqueSpread) hasOpaqueSpread = true;
      }
      continue;
    }
    const key = propertyName(prop);
    if (key) result.push({ key, prop, conditional: false });
  }
  return { properties: result, hasOpaqueSpread };
}

/** String literals a value expression can evaluate to (for enum checks). */
function literalValues(expr) {
  const node = unwrap(expr);
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return [{ value: node.text, node }];
  if (ts.isConditionalExpression(node))
    return [...literalValues(node.whenTrue), ...literalValues(node.whenFalse)];
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap((element) => literalValues(element));
  if (ts.isObjectLiteralExpression(node)) {
    const values = [];
    for (const prop of node.properties) {
      const key = propertyName(prop);
      if (key && ENUM_FILTER_KEYS.has(key) && ts.isPropertyAssignment(prop))
        values.push(...literalValues(prop.initializer));
    }
    return values;
  }
  return [];
}

/**
 * Scans a source directory and returns findings as strings:
 *   `<relative path>:<line> <Model>.<operation> <arg>.<key>`            (unknown key)
 *   `<relative path>:<line> <Model>.<operation> MISSING.<field>`        (required field absent)
 *   `<relative path>:<line> <Model>.<operation> ENUM.<field>=<value>`   (invalid enum value)
 */
function scan(srcDir, dmmf) {
  const { modelsByDelegate, enums } = loadDatamodel(dmmf);
  const findings = [];
  for (const file of listSourceFiles(srcDir)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const relative = path.relative(srcDir, file).split(path.sep).join('/');
    const at = (node) =>
      `${relative}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        OPERATIONS.has(node.expression.name.text)
      ) {
        const operation = node.expression.name.text;
        const receiver = unwrap(node.expression.expression);
        const delegate =
          receiver && ts.isPropertyAccessExpression(receiver) ? receiver.name.text : null;
        const model = delegate ? modelsByDelegate.get(delegate) : null;
        const arg = unwrap(node.arguments[0]);
        if (model && arg && ts.isObjectLiteralExpression(arg)) {
          for (const argProp of arg.properties) {
            const argName = propertyName(argProp);
            if (!argName || !CHECKED_ARGS.has(argName) || !ts.isPropertyAssignment(argProp))
              continue;
            let body = unwrap(argProp.initializer);
            if (body && ts.isArrayLiteralExpression(body)) body = unwrap(body.elements[0]);
            if (!body || !ts.isObjectLiteralExpression(body)) continue;

            const { properties, hasOpaqueSpread } = collectProperties(body);
            const isCreateData =
              (argName === 'data' && (operation === 'create' || operation === 'createMany')) ||
              (argName === 'create' && operation === 'upsert');

            if (isCreateData && !hasOpaqueSpread) {
              const given = new Set(
                properties.filter((entry) => !entry.conditional).map((entry) => entry.key),
              );
              const satisfiedByRelation = new Set();
              for (const field of model.fields.values()) {
                if (field.kind === 'object' && given.has(field.name))
                  for (const fk of field.relationFromFields || []) satisfiedByRelation.add(fk);
              }
              for (const field of model.fields.values()) {
                if (
                  field.kind === 'object' ||
                  !field.isRequired ||
                  field.hasDefaultValue ||
                  field.isUpdatedAt
                )
                  continue;
                if (given.has(field.name) || satisfiedByRelation.has(field.name)) continue;
                findings.push(`${at(body)} ${model.name}.${operation} MISSING.${field.name}`);
              }
            }

            for (const { key, prop } of properties) {
              if (LOGICAL_KEYS.has(key)) continue;
              if (argName === 'where' && key.includes('_')) continue; // compound unique selector, e.g. tenantId_key
              const field = model.fields.get(key);
              if (!field) {
                findings.push(`${at(prop)} ${model.name}.${operation} ${argName}.${key}`);
                continue;
              }
              if (
                field.kind === 'enum' &&
                ts.isPropertyAssignment(prop) &&
                (argName === 'data' ||
                  argName === 'create' ||
                  argName === 'update' ||
                  argName === 'where')
              ) {
                const allowed = enums.get(field.type);
                if (!allowed) continue;
                for (const { value, node: literal } of literalValues(prop.initializer)) {
                  if (!allowed.has(value))
                    findings.push(`${at(literal)} ${model.name}.${operation} ENUM.${key}=${value}`);
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

module.exports = { scan, loadDatamodel, listSourceFiles };

if (require.main === module) {
  const srcDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'src'));
  const { Prisma } = require('@prisma/client');
  const findings = scan(srcDir, Prisma.dmmf);
  if (findings.length > 0) {
    console.error(`Prisma literal check: ${findings.length} finding(s) in ${srcDir}`);
    for (const finding of findings) console.error(`  ${finding}`);
    console.error(
      'Fix the field/enum names against prisma/schema.prisma (keep extra data in the model Json columns).',
    );
    process.exit(1);
  }
  console.log(`Prisma literal check: OK (${listSourceFiles(srcDir).length} files)`);
}
```

FILE: apps/api/scripts/check-route-authorization.js

```javascript
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
```

FILE: apps/api/src/app.module.ts

```typescript
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppConfigModule } from './config/app-config.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { I18nModule } from './infrastructure/i18n/i18n.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AuditModule } from './modules/audit/audit.module';
import { SecurityModule } from './modules/security/security.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { BillingModule } from './modules/billing/billing.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { DatasetsModule } from './modules/datasets/datasets.module';
import { RiskModule } from './modules/risk/risk.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { ExchangesModule } from './modules/exchanges/exchanges.module';
import { CopyTradingModule } from './modules/copy-trading/copy-trading.module';
import { ResearchModule } from './modules/research/research.module';
import { RiskManagementModule } from './modules/risk-management/risk-management.module';
import { OmsModule } from './modules/oms/oms.module';
import { OperationsModule } from './modules/operations/operations.module';
import { PortfolioAccountingModule } from './modules/portfolio-accounting/portfolio-accounting.module';
import { ClientLifecycleModule } from './modules/client-lifecycle/client-lifecycle.module';
import { CustodyModule } from './modules/custody/custody.module';
import { DeveloperModule } from './modules/developer-platform/developer.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { MobileReleaseModule } from './modules/mobile-release/mobile-release.module';
import { PartnerModule } from './modules/partners/partner.module';
import { ProviderModule } from './modules/providers/provider.module';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { AuditContextInterceptor } from './common/interceptors/audit-context.interceptor';
import { GlobalValidationPipe } from './common/pipes/global-validation.pipe';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { TenantGuard } from './modules/tenants/guards/tenant.guard';
import { FeatureFlagGuard } from './modules/feature-flags/guards/feature-flag.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { TraceMiddleware } from './infrastructure/tracing/trace.middleware';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';

/**
 * Root module.
 *
 * Cross-cutting behaviour is registered once here as global providers so that
 * feature modules stay focused on their domain:
 *   - validation pipe        -> rejects malformed input before controllers run
 *   - exception filters      -> uniform, stack-trace-free error envelopes
 *   - response interceptor   -> uniform success envelopes
 *   - guards (order matters) -> throttling, then authN, then tenancy, then authZ
 */
@Module({
  imports: [
    AppConfigModule,
    // Dynamic on purpose: see the comment in logger.module.ts. Calling
    // forRoot() here (rather than importing a statically configured module)
    // guarantees every @InjectPinoLogger context has been registered first.
    LoggerModule.forRoot(),
    PrismaModule,
    RedisModule,
    CryptoModule,
    I18nModule,
    RateLimitModule,
    ScheduleModule.forRoot(),
    QueueModule,
    HealthModule,
    AuditModule,
    SecurityModule,
    RbacModule,
    TenantsModule,
    UsersModule,
    AuthModule,
    FeatureFlagsModule,
    BillingModule,
    ComplianceModule,
    NotificationsModule,
    RealtimeModule,
    ExecutionModule,
    StrategyModule,
    DatasetsModule,
    RiskModule,
    ObservabilityModule,
    ExchangesModule,
    CopyTradingModule,
    ResearchModule,
    RiskManagementModule,
    OmsModule,
    OperationsModule,
    PortfolioAccountingModule,
    ClientLifecycleModule,
    CustodyModule,
    DeveloperModule,
    GovernanceModule,
    MobileReleaseModule,
    PartnerModule,
    ProviderModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
    // Guards execute in registration order.
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureFlagGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      // TraceMiddleware FIRST: the server span brackets the whole pipeline
      // (correlation and tenant resolution included), so a 401 from the
      // auth guard is still a span with a status - requests that never reach
      // a handler are precisely the ones an incident review asks about.
      .apply(TraceMiddleware, RequestContextMiddleware, TenantResolutionMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```

FILE: apps/api/src/common/__fixtures__/in-memory-prisma.fixture-spec.ts

```typescript
/**
 * TEST-ONLY in-memory stand-in for the Prisma client delegates used through
 * `(prisma as any).<model>`. Excluded from the production build by the
 * `**\/*spec.ts` pattern of tsconfig.build.json and not collected by jest
 * (the testRegex only matches `.spec.ts`).
 *
 * It models the parts of Prisma 5 that tenant-scoping depends on:
 *  - `update({ where })` matches EVERY field of `where` (extended unique
 *    where), so `{ id, tenantId }` with the wrong tenant raises P2025 exactly
 *    like the real client instead of updating the row;
 *  - `create` enforces the unique indexes passed to the constructor (P2002),
 *    the way the database's unique indexes do: a string entry is a
 *    single-column unique, a string[] entry a composite unique (for example
 *    `['tenantId', 'idempotencyKey']`, the per-tenant idempotency index). As
 *    in PostgreSQL, a row with NULL in any indexed column never conflicts;
 *  - `create` assigns a random UUID `id` when the data has none, like the
 *    schema's `@default(uuid())` (`seed` stores exactly what it is given);
 *  - `findMany` honours `orderBy` (single field), `skip` and `take`;
 *  - filters: equality, `null`, `not`, `lt`/`lte`/`gt`/`gte`, `in`, `OR`, `AND`.
 */

import { randomUUID } from 'crypto';

export type Row = Record<string, any>;

function isPlainObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

function comparable(value: any): any {
  return value instanceof Date ? value.getTime() : value;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

export function rowMatches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === 'AND') {
      const all = Array.isArray(condition) ? condition : [condition];
      if (!all.every((c: Row) => rowMatches(row, c))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!(condition as Row[]).some((c) => rowMatches(row, c))) return false;
      continue;
    }
    const value = row[key];
    if (condition === null) {
      if (!isNullish(value)) return false;
      continue;
    }
    if (isPlainObject(condition)) {
      if ('not' in condition) {
        if (condition.not === null ? isNullish(value) : comparable(value) === comparable(condition.not)) return false;
      }
      if ('in' in condition && !(condition.in as any[]).map(comparable).includes(comparable(value))) return false;
      if (isNullish(value) && ('lt' in condition || 'lte' in condition || 'gt' in condition || 'gte' in condition)) return false;
      if ('lt' in condition && !(comparable(value) < comparable(condition.lt))) return false;
      if ('lte' in condition && !(comparable(value) <= comparable(condition.lte))) return false;
      if ('gt' in condition && !(comparable(value) > comparable(condition.gt))) return false;
      if ('gte' in condition && !(comparable(value) >= comparable(condition.gte))) return false;
      continue;
    }
    if (comparable(value) !== comparable(condition)) return false;
  }
  return true;
}

export class InMemoryPrisma {
  private readonly tables = new Map<string, Row[]>();

  /**
   * @param uniques per delegate, its unique indexes: a column name for a
   *   single-column unique, a column list for a composite unique.
   */
  constructor(private readonly uniques: Record<string, Array<string | string[]>> = {}) {
    return new Proxy(this, {
      get: (target, prop: string | symbol) => {
        if (typeof prop === 'symbol' || prop in target) return (target as any)[prop];
        return target.delegate(prop);
      },
    });
  }

  rows(delegate: string): Row[] {
    if (!this.tables.has(delegate)) this.tables.set(delegate, []);
    return this.tables.get(delegate)!;
  }

  seed(delegate: string, data: Row): Row {
    this.assertUnique(delegate, data);
    const row = { ...data };
    this.rows(delegate).push(row);
    return { ...row };
  }

  private assertUnique(delegate: string, data: Row): void {
    for (const index of this.uniques[delegate] ?? []) {
      const columns = Array.isArray(index) ? index : [index];
      if (columns.some((column) => isNullish(data[column]))) continue;
      const clash = this.rows(delegate).some((row) =>
        columns.every((column) => comparable(row[column]) === comparable(data[column])),
      );
      if (clash) {
        const fields = columns.map((column) => `\`${column}\``).join(',');
        throw Object.assign(new Error(`Unique constraint failed on the fields: (${fields})`), {
          code: 'P2002',
          meta: { target: [...columns] },
        });
      }
    }
  }

  private delegate(name: string) {
    const table = () => this.rows(name);
    return {
      create: async ({ data }: { data: Row }) => this.seed(name, data.id === undefined ? { id: randomUUID(), ...data } : data),
      findFirst: async ({ where }: { where?: Row } = {}) => {
        const found = table().find((row) => rowMatches(row, where));
        return found ? { ...found } : null;
      },
      findMany: async ({ where, orderBy, skip, take }: { where?: Row; orderBy?: Row; skip?: number; take?: number } = {}) => {
        let result = table().filter((row) => rowMatches(row, where)).map((row) => ({ ...row }));
        if (orderBy) {
          const [field, direction] = Object.entries(orderBy)[0];
          const sign = direction === 'desc' ? -1 : 1;
          result = result.sort((a, b) => {
            const x = comparable(a[field]);
            const y = comparable(b[field]);
            return x === y ? 0 : x < y ? -sign : sign;
          });
        }
        const start = skip ?? 0;
        return result.slice(start, take === undefined ? undefined : start + take);
      },
      count: async ({ where }: { where?: Row } = {}) => table().filter((row) => rowMatches(row, where)).length,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = table().find((r) => rowMatches(r, where));
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        const targets = table().filter((row) => rowMatches(row, where));
        for (const row of targets) Object.assign(row, data);
        return { count: targets.length };
      },
    };
  }
}
```

FILE: apps/api/src/common/constants/metadata.constants.ts

```typescript
/** Reflector metadata keys. Centralised to avoid typo-driven security holes. */
export const IS_PUBLIC_KEY = 'auth:isPublic';
export const PERMISSIONS_KEY = 'auth:permissions';
export const PERMISSIONS_MODE_KEY = 'auth:permissionsMode';
export const ROLES_KEY = 'auth:roles';
export const PLATFORM_ONLY_KEY = 'auth:platformOnly';
export const SKIP_TENANT_KEY = 'tenant:skipResolution';
export const FEATURE_FLAG_KEY = 'feature:flag';
export const AUDIT_ACTION_KEY = 'audit:action';
export const SKIP_RESPONSE_TRANSFORM_KEY = 'response:skipTransform';
export const REQUEST_TIMEOUT_KEY = 'request:timeoutMs';
export const IDEMPOTENT_KEY = 'request:idempotent';
export const REQUIRE_FRESH_AUTH_KEY = 'auth:requireFresh';
```

FILE: apps/api/src/common/constants/request.constants.ts

```typescript
/** Keys used to stash request-scoped state on the Express request object. */
export const REQUEST_ID_PROPERTY = 'requestId';
export const REQUEST_START_TIME_PROPERTY = 'startTime';
export const REQUEST_TENANT_PROPERTY = 'tenantContext';
export const REQUEST_ACTOR_PROPERTY = 'actor';
export const REQUEST_LOCALE_PROPERTY = 'locale';
export const REQUEST_IP_HASH_PROPERTY = 'ipHash';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
```

FILE: apps/api/src/common/decimal-string.spec.ts

```typescript
// # Responsibility: regression tests for exact decimal-string arithmetic with no binary floating-point conversion.
//
// Two jobs, and the first is the original one: the Layer 1 functions in this module are imported
// across the API, so their observable behaviour is pinned here rather than left to whatever the
// next refactor assumes. The block below this header is that contract, unchanged.
//
// The second job is coverage for the arbitrary-scale `Decimal` layer added on top of Layer 1:
// exact arithmetic, the five rounding modes, venue step/tick snapping, and the regression where
// the previous hand-rolled BigInt helpers silently fell back to `parseFloat` (triggered by
// `String(1e-7 / 100) === '1e-9'`, which their parser could not tokenise).

import {
  DECIMAL_FACTOR,
  DECIMAL_SCALE,
  Decimal,
  DecimalError,
  bpsOf,
  clampDecimal,
  dec,
  decimalFromScaled12,
  divideDecimalStrings,
  formatDecimalString,
  isDecimalString,
  maxDecimal,
  minDecimal,
  multiplyDecimalStrings,
  parseDecimalString,
} from './decimal-string';

describe('decimal-string arithmetic', () => {
  it('round-trips decimal values while preserving significant precision', () => {
    expect(formatDecimalString(parseDecimalString('0.000000000001'), 12)).toBe('0.000000000001');
    expect(formatDecimalString(parseDecimalString('-125.340000000000'), 8)).toBe('-125.34');
  });

  it('rejects exponent notation, non-string input and excess precision', () => {
    expect(() => parseDecimalString('1e-8')).toThrow(TypeError);
    expect(() => parseDecimalString('0.1234567890123')).toThrow(TypeError);
    expect(() => parseDecimalString(1 as unknown as string)).toThrow(TypeError);
  });

  it('validates unknown decimal input without throwing or floating-point conversion', () => {
    expect(isDecimalString('12.5')).toBe(true);
    expect(isDecimalString('1e-8')).toBe(false);
    expect(isDecimalString('0.1234567890123')).toBe(false);
    expect(isDecimalString(null)).toBe(false);
    expect(isDecimalString('9'.repeat(81))).toBe(false);
  });

  it('multiplies and divides with deterministic half-away-from-zero rounding', () => {
    expect(formatDecimalString(multiplyDecimalStrings(parseDecimalString('1.25'), parseDecimalString('2.4')))).toBe('3');
    expect(formatDecimalString(divideDecimalStrings(parseDecimalString('1'), parseDecimalString('3')), 12)).toBe('0.333333333333');
    expect(formatDecimalString(divideDecimalStrings(parseDecimalString('-1'), parseDecimalString('6')), 12)).toBe('-0.166666666667');
  });
});

describe('Decimal (Layer 2): parsing', () => {
  it('parses integers, fixed point, signs and exponent notation exactly', () => {
    expect(Decimal.parse('0').toString()).toBe('0');
    expect(Decimal.parse('42').toString()).toBe('42');
    expect(Decimal.parse('0.001').toString()).toBe('0.001');
    expect(Decimal.parse('-1.50').toString()).toBe('-1.5');
    expect(Decimal.parse('1e-7').toString()).toBe('0.0000001');
    expect(Decimal.parse('1e-9').toString()).toBe('0.000000001');
    expect(Decimal.parse('2.5E+3').toString()).toBe('2500');
    expect(Decimal.parse('.5').toString()).toBe('0.5');
    expect(Decimal.parse('5.').toString()).toBe('5');
    expect(Decimal.parse('+3.25').toString()).toBe('3.25');
  });

  it('never emits exponent notation, even for tiny values', () => {
    // The regression that broke the copy-sizing path: 1e-7 / 100.
    const tiny = Decimal.parse('1e-7').div(100, 18);
    expect(tiny.toString()).toBe('0.000000001');
    expect(tiny.toString()).not.toMatch(/e/i);
    expect(Decimal.parse('0.000000000000000001').toString()).toBe('0.000000000000000001');
  });

  it('parses beyond Layer 1 precision, which is the reason Layer 2 exists', () => {
    // Layer 1's pattern admits at most 12 fractional digits.
    expect(isDecimalString('0.000000000000000001')).toBe(false);
    // Layer 2 holds it exactly.
    expect(Decimal.parse('0.000000000000000001').toString()).toBe('0.000000000000000001');
  });

  it('rejects non-finite and malformed input', () => {
    expect(() => Decimal.parse('')).toThrow(DecimalError);
    expect(() => Decimal.parse('abc')).toThrow(DecimalError);
    expect(() => Decimal.parse('1.2.3')).toThrow(DecimalError);
    expect(() => Decimal.parse('.' as never)).toThrow(DecimalError);
    expect(() => Decimal.parse(NaN)).toThrow(DecimalError);
    expect(() => Decimal.parse(Infinity)).toThrow(DecimalError);
  });

  it('exact string maths beats the float equivalent', () => {
    // Every finite double round-trips through its shortest decimal form, so a
    // float input parses - but to the float's value, not the intended one. That
    // is why financial call sites pass strings.
    expect(Decimal.parse(String(0.1 + 0.2)).toString()).toBe('0.30000000000000004');
    expect(Decimal.parse(String(0.1 + 0.2)).eq('0.3')).toBe(false);
    expect(Decimal.parse('0.1').add('0.2').eq('0.3')).toBe(true);
    expect(Decimal.parse('0.1').add('0.2').toString()).toBe('0.3');
  });

  it('tryParse and isDecimal are non-throwing', () => {
    expect(Decimal.tryParse('nope')).toBeNull();
    expect(Decimal.tryParse(null)).toBeNull();
    expect(Decimal.tryParse('1.5')!.toString()).toBe('1.5');
    expect(Decimal.isDecimal('1e-9')).toBe(true);
    expect(Decimal.isDecimal('x')).toBe(false);
  });
});

describe('Decimal (Layer 2): arithmetic is exact', () => {
  it('adds and subtracts without float drift', () => {
    expect(dec('0.1').add('0.2').toString()).toBe('0.3');
    expect(dec('1.005').sub('1').toString()).toBe('0.005');
    expect(dec('0.3').sub('0.1').toString()).toBe('0.2');
    expect(dec('1e-9').add('1e-9').toString()).toBe('0.000000002');
  });

  it('multiplies exactly at full precision', () => {
    expect(dec('0.0000123456789').mul('1').toString()).toBe('0.0000123456789');
    expect(dec('60000').mul('0.001').toString()).toBe('60');
    expect(dec('1e-7').mul('1e-9').toString()).toBe('0.0000000000000001');
  });

  it('divides with an explicit scale and rounding mode', () => {
    expect(dec('1').div('3', 4).toString()).toBe('0.3333');
    expect(dec('1').div('3', 2, 'FLOOR').toString()).toBe('0.33');
    expect(dec('2').div('3', 2, 'CEIL').toString()).toBe('0.67');
    expect(dec('0.15').div('0.1', 2).toString()).toBe('1.5');
    expect(dec('100').div('3', 0, 'HALF_UP').toString()).toBe('33');
    expect(() => dec('1').div('0')).toThrow(DecimalError);
  });

  it('compares exactly, including across scales and signs', () => {
    expect(dec('0.1').add('0.2').cmp('0.3')).toBe(0);
    expect(dec('1.0').cmp('1')).toBe(0);
    expect(dec('-2').cmp('-1')).toBe(-1);
    expect(dec('1e-9').gt('0')).toBe(true);
    expect(dec('5').lte('5')).toBe(true);
  });

  it('applies HALF_EVEN (banker) rounding', () => {
    expect(dec('2.5').toFixed(0, 'HALF_EVEN')).toBe('2');
    expect(dec('3.5').toFixed(0, 'HALF_EVEN')).toBe('4');
    expect(dec('2.5').toFixed(0, 'HALF_UP')).toBe('3');
    expect(dec('-2.5').toFixed(0, 'HALF_UP')).toBe('-3');
    expect(dec('-2.5').toFixed(0, 'FLOOR')).toBe('-3');
    expect(dec('-2.5').toFixed(0, 'DOWN')).toBe('-2');
  });
});

describe('Decimal (Layer 2): venue precision normalisation', () => {
  it('floors a size down to the step and refuses to return zero', () => {
    expect(Decimal.floorToStep('0.00123', '0.001')!.toString()).toBe('0.001');
    // A size below one step must not silently become an order.
    expect(Decimal.floorToStep('0.0005', '0.001')).toBeNull();
    expect(Decimal.floorToStep('0', '0.001')).toBeNull();
    expect(Decimal.floorToStep('7.9', '1')!.toString()).toBe('7');
    // An 18-dp step is representable in Layer 2 and not in Layer 1.
    expect(isDecimalString('0.000000000000000001')).toBe(false);
    expect(Decimal.floorToStep('0.0000123456789', '0.000000000000000001')!.toString()).toBe('0.0000123456789');
  });

  it('snaps prices to a tick in the requested direction', () => {
    expect(Decimal.roundToTick('60000.007', '0.01', 'FLOOR').toString()).toBe('60000');
    expect(Decimal.roundToTick('60000.001', '0.01', 'CEIL').toString()).toBe('60000.01');
    expect(Decimal.roundToTick('60000.005', '0.01').toString()).toBe('60000.01');
    expect(Decimal.ceilToTick('60000.00', '0.01').toString()).toBe('60000');
    expect(Decimal.floorToTick('60000.009', '0.01').toString()).toBe('60000');
  });

  it('rejects an invalid step instead of returning the raw size', () => {
    expect(Decimal.floorToStep('1', '0')).toBeNull();
    expect(Decimal.floorToStep('1', '-0.1')).toBeNull();
  });
});

describe('Decimal (Layer 2): helpers', () => {
  it('computes basis points exactly', () => {
    expect(bpsOf('60000', 50).toString()).toBe('300');
    expect(bpsOf('0.00001234', 100).toString()).toBe('0.0000001234');
    expect(() => bpsOf('1', -1)).toThrow(DecimalError);
  });

  it('clamps, mins and maxes', () => {
    expect(clampDecimal('5', '1', '10').toString()).toBe('5');
    expect(clampDecimal('0', '1', '10').toString()).toBe('1');
    expect(clampDecimal('99', '1', '10').toString()).toBe('10');
    expect(() => clampDecimal('5', '10', '1')).toThrow(DecimalError);
    expect(maxDecimal('1', '2', '3').toString()).toBe('3');
    expect(minDecimal('1', '2', '3').toString()).toBe('1');
  });

  it('round-trips to scaled bigint only when exact', () => {
    expect(dec('1.23').toScaledBigInt(2)).toBe(123n);
    expect(() => dec('1.234').toScaledBigInt(2)).toThrow(DecimalError);
    expect(dec('100').toScaledBigInt(0)).toBe(100n);
  });

  it('normalises away trailing zeros but keeps zero canonical', () => {
    expect(dec('1.5000').normalize().toString()).toBe('1.5');
    expect(dec('0.000').toString()).toBe('0');
    expect(dec('-0.0').toString()).toBe('0');
  });
});

describe('Layer 1 <-> Layer 2 interop', () => {
  it('bridges to 12-place scaled units only when exact', () => {
    expect(dec('1.5').toScaled12Exact()).toBe(parseDecimalString('1.5'));
    expect(decimalFromScaled12(parseDecimalString('1.5')).toString()).toBe('1.5');
    // 18 dp does not fit, and must throw rather than silently truncate.
    expect(dec('0.000000000000000001').fitsLayer1()).toBe(false);
    expect(() => dec('0.000000000000000001').toScaled12Exact()).toThrow(DecimalError);
    expect(dec('1.5').fitsLayer1()).toBe(true);
  });

  it('round-trips a Layer 1 value through Layer 2 losslessly', () => {
    for (const text of ['0', '1', '-1', '0.1', '60000.123456789', '-0.000000000001', '99999999.999999999999']) {
      const scaled = parseDecimalString(text);
      const roundTripped = decimalFromScaled12(scaled);
      expect(roundTripped.toString()).toBe(Decimal.parse(text).toString());
      expect(roundTripped.toScaled12Exact()).toBe(scaled);
    }
  });
});

describe('Layer 1 (frozen): existing exports behave as the API already depends on', () => {
  it('DECIMAL_SCALE and DECIMAL_FACTOR stay at 12 places', () => {
    expect(DECIMAL_SCALE).toBe(12);
    expect(DECIMAL_FACTOR).toBe(1_000_000_000_000n);
  });

  it('isDecimalString accepts plain 12-dp input and rejects anything else', () => {
    expect(isDecimalString('0')).toBe(true);
    expect(isDecimalString('123')).toBe(true);
    expect(isDecimalString('-0.5')).toBe(true);
    expect(isDecimalString('0.123456789012')).toBe(true);
    // 13 places, exponent form, leading zeros and junk are all rejected.
    expect(isDecimalString('0.1234567890123')).toBe(false);
    expect(isDecimalString('1e-7')).toBe(false);
    expect(isDecimalString('007')).toBe(false);
    expect(isDecimalString('')).toBe(false);
    expect(isDecimalString(null)).toBe(false);
    expect(isDecimalString(undefined)).toBe(false);
    expect(isDecimalString(5)).toBe(false);
  });

  it('parseDecimalString scales exactly and throws on bad input', () => {
    expect(parseDecimalString('1')).toBe(DECIMAL_FACTOR);
    expect(parseDecimalString('1.5')).toBe(DECIMAL_FACTOR + DECIMAL_FACTOR / 2n);
    expect(parseDecimalString('-1')).toBe(-DECIMAL_FACTOR);
    expect(parseDecimalString('0')).toBe(0n);
    expect(() => parseDecimalString('1e-7')).toThrow(TypeError);
    expect(() => parseDecimalString('0.1234567890123')).toThrow(TypeError);
  });

  it('formatDecimalString trims trailing zeros and honours outputPlaces', () => {
    expect(formatDecimalString(DECIMAL_FACTOR)).toBe('1');
    expect(formatDecimalString(DECIMAL_FACTOR + DECIMAL_FACTOR / 2n)).toBe('1.5');
    expect(formatDecimalString(0n)).toBe('0');
    expect(formatDecimalString(parseDecimalString('-0.00000001'))).toBe('-0.00000001');
    expect(formatDecimalString(parseDecimalString('1.123456789'), 2)).toBe('1.12');
    expect(formatDecimalString(parseDecimalString('1.5'), 0)).toBe('1');
    expect(() => formatDecimalString(0n, 13)).toThrow(RangeError);
    expect(() => formatDecimalString(0n, -1)).toThrow(RangeError);
  });

  it('divideDecimalStrings and multiplyDecimalStrings round half away from zero', () => {
    expect(divideDecimalStrings(parseDecimalString('1'), parseDecimalString('3')))
      .toBe(parseDecimalString('0.333333333333'));
    expect(() => divideDecimalStrings(1n, 0n)).toThrow(RangeError);
    expect(multiplyDecimalStrings(parseDecimalString('2'), parseDecimalString('3')))
      .toBe(parseDecimalString('6'));
    expect(multiplyDecimalStrings(parseDecimalString('0.1'), parseDecimalString('3')))
      .toBe(parseDecimalString('0.3'));
    expect(multiplyDecimalStrings(parseDecimalString('-2'), parseDecimalString('0.5')))
      .toBe(parseDecimalString('-1'));
  });
});
```

FILE: apps/api/src/common/decimal-string.ts

```typescript
// # Responsibility: exact decimal-string arithmetic for trading, risk, and fee calculations.
//
// This is the ONE canonical module for money, prices, quantities and rates on the
// API. It exposes two layers over the same representation, and a call site picks
// the layer that matches what it knows about the value.
//
//   Layer 1 - fixed scale 12 (DECIMAL_SCALE).
//     `parseDecimalString` / `formatDecimalString` / `divideDecimalStrings` /
//     `multiplyDecimalStrings`. Fast, allocation-light, and the convention most
//     of the API already speaks: every value is a bigint of 12-place scaled
//     units. Use it when the value provably fits 12 decimal places.
//
//   Layer 2 - arbitrary scale (`Decimal`).
//     An exact `unscaled * 10^-scale` value with an explicit scale, so it can
//     represent a venue step of 1e-18 without silently truncating, and with the
//     rounding modes that directional decisions need (a size floors DOWN, a
//     slippage ceiling rounds UP). Use it wherever a value crosses the venue
//     precision boundary or needs deterministic rounding.
//
// WHY BOTH, AND WHY THEY ARE NOT DUPLICATES
// ----------------------------------------
// Layer 1 cannot express what the copy-execution path needs: its pattern admits
// at most 12 fractional digits (`\d{1,12}`), and a venue that quotes a quantity
// step of 0.000000000000000001 is not representable at all. Neither layer 1
// helper can round in a chosen direction, and size snapping must floor - any
// other direction can over-allocate a follower's balance. Rather than fork a
// second decimal library, the arbitrary-precision layer lives here, next to the
// fixed-scale one it supersedes, and `Decimal.toScaled12Exact()` bridges back.
//
// INVARIANTS
// ----------
//   1. No operation ever uses `number` for a value. `number` input is accepted
//      for ergonomics and parsed at its shortest round-trip decimal, which is the
//      float's value and not necessarily the intended one; financial call sites
//      must pass strings. No arithmetic here is performed on a `number`.
//   2. Parsing is total over exact decimal and scientific-notation input and
//      throws `DecimalError` on anything else. It never degrades to a float.
//   3. `Decimal.toString()` / `.toFixed()` never emit exponent notation, so the
//      result is always safe to hand to an exchange REST/WS API.
//   4. Rounding is explicit at every point where precision is lost. Size snapping
//      floors; price snapping takes a direction; division requires a scale.
//   5. Layer 1's exported signatures and behaviour are frozen - they predate this
//      module's Layer 2 and are depended on across the API.

// =============================================================================
// Layer 1 - fixed scale 12 (frozen).
// =============================================================================

export const DECIMAL_SCALE = 12;
export const DECIMAL_FACTOR = 1_000_000_000_000n;
const DECIMAL_STRING_PATTERN = /^([+-]?)(0|[1-9]\d*)(?:\.(\d{1,12}))?$/;

/** Returns whether unknown input is a plain, exactly representable decimal string. */
export function isDecimalString(input: unknown): input is string {
  return typeof input === 'string' && input.length <= 80 && DECIMAL_STRING_PATTERN.test(input.trim());
}

/** Parse a base-10 decimal string into a 12-place scaled integer without floating point. */
export function parseDecimalString(input: string): bigint {
  if (typeof input !== 'string' || input.length > 80) {
    throw new TypeError('Decimal value must be a string of at most 80 characters');
  }
  const match = DECIMAL_STRING_PATTERN.exec(input.trim());
  if (!match) throw new TypeError('Decimal value must be a plain base-10 string with at most 12 decimal places');
  const sign = match[1] === '-' ? -1n : 1n;
  const fractional = (match[3] ?? '').padEnd(DECIMAL_SCALE, '0');
  return sign * (BigInt(match[2]) * DECIMAL_FACTOR + BigInt(fractional || '0'));
}

/** Format a 12-place scaled integer as a non-exponential decimal string. */
export function formatDecimalString(value: bigint, outputPlaces = 8): string {
  if (!Number.isInteger(outputPlaces) || outputPlaces < 0 || outputPlaces > DECIMAL_SCALE) {
    throw new RangeError('outputPlaces must be an integer from 0 through 12');
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const integer = absolute / DECIMAL_FACTOR;
  const fraction = (absolute % DECIMAL_FACTOR).toString().padStart(DECIMAL_SCALE, '0');
  const retained = fraction.slice(0, outputPlaces);
  const result = outputPlaces === 0 ? integer.toString() : `${integer}.${retained}`;
  const trimmed = result.includes('.') ? result.replace(/0+$/, '').replace(/\.$/, '') : result;
  return `${negative && absolute !== 0n ? '-' : ''}${trimmed}`;
}

/** Rounded division of two scaled values, returning another scaled value. */
export function divideDecimalStrings(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Cannot divide by zero');
  const scaledNumerator = numerator * DECIMAL_FACTOR;
  const quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const shouldRound = absRemainder * 2n >= absDenominator;
  if (!shouldRound) return quotient;
  const sign = (scaledNumerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  return quotient + sign;
}

/** Multiply two scaled values and round half away from zero back to 12 places. */
export function multiplyDecimalStrings(left: bigint, right: bigint): bigint {
  const product = left * right;
  const quotient = product / DECIMAL_FACTOR;
  const remainder = product % DECIMAL_FACTOR;
  if ((remainder < 0n ? -remainder : remainder) * 2n < DECIMAL_FACTOR) return quotient;
  return quotient + (product < 0n ? -1n : 1n);
}

// =============================================================================
// Layer 2 - arbitrary scale, explicit rounding.
// =============================================================================

/** How a value is rounded when digits must be discarded. */
export type RoundingMode = 'FLOOR' | 'CEIL' | 'DOWN' | 'HALF_UP' | 'HALF_EVEN';

/** Thrown for any value this module refuses to represent. Never caught to continue. */
export class DecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalError';
  }
}

/** Digits per bigint limb do not exist here; these bound absurd input instead. */
const MAX_SCALE = 1_000;
const MAX_DIGITS = 10_000;
const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new DecimalError(`pow10 requires a non-negative integer, got ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

/** Truncating division that floors toward negative infinity. */
function divFloor(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new DecimalError('Division by zero');
  const quotient = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? quotient - 1n : quotient;
}

/** Truncating division that ceils toward positive infinity. */
function divCeil(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new DecimalError('Division by zero');
  const quotient = a / b;
  return a % b !== 0n && a < 0n === b < 0n ? quotient + 1n : quotient;
}

/**
 * An exact decimal: `unscaled * 10^-scale`, with `scale >= 0`.
 *
 * Addition and subtraction rescale to the larger scale and are always exact.
 * Multiplication is exact. Division is the only deliberately lossy operation and
 * therefore requires the caller to state a target scale and rounding mode.
 */
export class Decimal {
  /** Value = unscaled * 10^-scale. */
  readonly unscaled: bigint;
  /** Number of fractional digits held. Always >= 0. */
  readonly scale: number;

  private constructor(unscaled: bigint, scale: number) {
    this.unscaled = unscaled;
    this.scale = scale;
  }

  // ---------------------------------------------------------------- factories

  static readonly ZERO = new Decimal(0n, 0);
  static readonly ONE = new Decimal(1n, 0);

  /** Build from already-scaled units. Prefer {@link parse} for textual input. */
  static fromUnscaled(unscaled: bigint, scale = 0): Decimal {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw new DecimalError(`Invalid scale: ${scale}`);
    }
    return new Decimal(unscaled, scale);
  }

  /**
   * Parse an exact decimal.
   *
   * Accepts integers, fixed point (`"0.001"`), signs and scientific notation
   * (`"1e-9"`, `"2.5E+3"`) - all exactly, never through a float. Rejects `NaN`,
   * `Infinity`, empty strings and bare `.`/`+`.
   *
   * `number` input is accepted for ergonomics but is inherently lossy: a
   * fractional double parses at its shortest round-trip decimal, which is the
   * value the *float* holds, not necessarily the intended one (`0.1 + 0.2`
   * becomes `0.30000000000000004`, not `0.3`). Financial call sites must pass
   * strings; this module never performs arithmetic on a `number`.
   */
  static parse(value: string | number | bigint | Decimal): Decimal {
    if (value instanceof Decimal) return value;
    if (typeof value === 'bigint') return new Decimal(value, 0);

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new DecimalError(`Cannot parse non-finite number: ${value}`);
      }
      if (Number.isInteger(value) && Number.isSafeInteger(value)) {
        return new Decimal(BigInt(value), 0);
      }
      return Decimal.parse(value.toString());
    }

    const raw = String(value).trim();
    if (raw.length === 0) throw new DecimalError('Cannot parse an empty string');
    if (raw.length > MAX_DIGITS) throw new DecimalError('Decimal input too long');

    const match = DECIMAL_RE.exec(raw);
    if (!match) throw new DecimalError(`Invalid decimal: "${raw}"`);

    const sign = match[1];
    const intPart = match[2] ?? '';
    const fracPart = match[3] ?? '';
    const expPart = match[4];

    if (intPart === '' && fracPart === '') {
      throw new DecimalError(`Invalid decimal: "${raw}"`);
    }

    const exponent = expPart ? Number(expPart) : 0;
    if (!Number.isSafeInteger(exponent)) {
      throw new DecimalError(`Invalid exponent in "${raw}"`);
    }

    const digits = intPart + fracPart;
    const unscaledAbs = digits.length > 0 ? BigInt(digits) : 0n;
    // Value = digits * 10^(exponent - fracPart.length)
    const netExponent = exponent - fracPart.length;

    let unscaled = sign === '-' ? -unscaledAbs : unscaledAbs;
    let scale: number;

    if (netExponent >= 0) {
      unscaled *= pow10(netExponent);
      scale = 0;
    } else {
      scale = -netExponent;
    }

    if (scale > MAX_SCALE) {
      throw new DecimalError(`Scale ${scale} exceeds the supported maximum`);
    }

    return new Decimal(unscaled, scale);
  }

  /** Parse, returning `null` instead of throwing. For optional input. */
  static tryParse(value: unknown): Decimal | null {
    if (value === null || value === undefined) return null;
    const acceptable =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      value instanceof Decimal;
    if (!acceptable) return null;
    try {
      return Decimal.parse(value as string | number | bigint | Decimal);
    } catch {
      return null;
    }
  }

  /** True when the value is an exact decimal this module can parse. */
  static isDecimal(value: unknown): boolean {
    return Decimal.tryParse(value) !== null;
  }

  // ------------------------------------------------------------ normalisation

  /** Rescale two values to a common scale. Exact in both directions here. */
  private static align(a: Decimal, b: Decimal): [bigint, bigint, number] {
    const scale = Math.max(a.scale, b.scale);
    return [a.unscaled * pow10(scale - a.scale), b.unscaled * pow10(scale - b.scale), scale];
  }

  /** Rescale this value to `scale`, applying `mode` when digits must be lost. */
  rescale(scale: number, mode: RoundingMode = 'HALF_UP'): Decimal {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw new DecimalError(`Invalid target scale: ${scale}`);
    }
    if (scale >= this.scale) {
      return new Decimal(this.unscaled * pow10(scale - this.scale), scale);
    }

    const drop = this.scale - scale;
    const divisor = pow10(drop);
    const remainder = this.unscaled % divisor;
    let quotient = this.unscaled / divisor;

    if (remainder !== 0n) {
      const negative = this.unscaled < 0n;
      const absRemainder = remainder < 0n ? -remainder : remainder;
      const twiceAbsRemainder = absRemainder * 2n;

      switch (mode) {
        case 'DOWN':
          break; // truncate toward zero
        case 'FLOOR':
          if (negative) quotient -= 1n;
          break;
        case 'CEIL':
          if (!negative) quotient += 1n;
          break;
        case 'HALF_UP':
          if (twiceAbsRemainder >= divisor) quotient += negative ? -1n : 1n;
          break;
        case 'HALF_EVEN':
          if (twiceAbsRemainder > divisor || (twiceAbsRemainder === divisor && quotient % 2n !== 0n)) {
            quotient += negative ? -1n : 1n;
          }
          break;
        default: {
          const exhaustive: never = mode;
          throw new DecimalError(`Unknown rounding mode: ${String(exhaustive)}`);
        }
      }
    }

    return new Decimal(quotient, scale);
  }

  /** Drop trailing fractional zeros so canonical output stays minimal. */
  normalize(): Decimal {
    let unscaled = this.unscaled;
    let scale = this.scale;
    if (unscaled === 0n) return Decimal.ZERO;
    while (scale > 0 && unscaled % 10n === 0n) {
      unscaled /= 10n;
      scale -= 1;
    }
    return new Decimal(unscaled, scale);
  }

  // --------------------------------------------------------------- arithmetic

  add(other: Decimal | string | number | bigint): Decimal {
    const o = Decimal.parse(other as never);
    const [a, b, scale] = Decimal.align(this, o);
    return new Decimal(a + b, scale).normalize();
  }

  sub(other: Decimal | string | number | bigint): Decimal {
    const o = Decimal.parse(other as never);
    const [a, b, scale] = Decimal.align(this, o);
    return new Decimal(a - b, scale).normalize();
  }

  /** Exact multiplication - no rounding, no precision loss. */
  mul(other: Decimal | string | number | bigint): Decimal {
    const o = Decimal.parse(other as never);
    return new Decimal(this.unscaled * o.unscaled, this.scale + o.scale).normalize();
  }

  /**
   * Division. `scale` is the fractional digits of the result and `mode` decides
   * the final digit, because division is the only operation that loses precision
   * by construction and the caller must say how much it wants.
   */
  div(other: Decimal | string | number | bigint, scale = 18, mode: RoundingMode = 'HALF_UP'): Decimal {
    const o = Decimal.parse(other as never);
    if (o.unscaled === 0n) throw new DecimalError('Division by zero');

    // (a / 10^as) / (b / 10^bs) = (a * 10^bs) / (b * 10^as); scale the numerator
    // by 10^scale to land the quotient on the requested number of digits.
    const numerator = this.unscaled * pow10(o.scale) * pow10(scale);
    const denominator = o.unscaled * pow10(this.scale);

    if (mode === 'FLOOR') return new Decimal(divFloor(numerator, denominator), scale).normalize();
    if (mode === 'CEIL') return new Decimal(divCeil(numerator, denominator), scale).normalize();

    const quotient = divFloor(numerator, denominator);
    const remainder = numerator - quotient * denominator;
    if (remainder === 0n) return new Decimal(quotient, scale).normalize();

    // Recompute with one guard digit so HALF_* modes see the true tail instead of
    // deciding from an already-truncated value.
    const extraNumerator = this.unscaled * pow10(o.scale) * pow10(scale + 1);
    const extraQuotient = divFloor(extraNumerator, denominator);
    return new Decimal(extraQuotient, scale + 1).rescale(scale, mode).normalize();
  }

  // -------------------------------------------------------------- comparisons

  /** -1, 0 or 1. Exact; never through a float. */
  cmp(other: Decimal | string | number | bigint): -1 | 0 | 1 {
    const o = Decimal.parse(other as never);
    const [a, b] = Decimal.align(this, o);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  eq(other: Decimal | string | number | bigint): boolean { return this.cmp(other) === 0; }
  gt(other: Decimal | string | number | bigint): boolean { return this.cmp(other) > 0; }
  gte(other: Decimal | string | number | bigint): boolean { return this.cmp(other) >= 0; }
  lt(other: Decimal | string | number | bigint): boolean { return this.cmp(other) < 0; }
  lte(other: Decimal | string | number | bigint): boolean { return this.cmp(other) <= 0; }

  isZero(): boolean { return this.unscaled === 0n; }
  isPositive(): boolean { return this.unscaled > 0n; }
  isNegative(): boolean { return this.unscaled < 0n; }

  abs(): Decimal { return this.unscaled < 0n ? new Decimal(-this.unscaled, this.scale) : this; }
  neg(): Decimal { return new Decimal(-this.unscaled, this.scale); }

  // ------------------------------------------------------ step / tick snapping

  /**
   * Snap a size DOWN to a multiple of `step`, or `null` when the result is zero
   * or `step` is unusable.
   *
   * Flooring is the safe direction for quantities: it can only reduce exposure.
   * Returning `null` rather than `0` matters because a zero-sized order is not a
   * small order, it is an invalid one, and the caller has to decide what to do
   * about a size that vanishes at the venue's precision.
   */
  static floorToStep(value: Decimal | string, step: Decimal | string): Decimal | null {
    const v = Decimal.parse(value as never);
    const s = Decimal.parse(step as never);
    if (s.isZero() || s.isNegative()) return null;
    const steps = v.div(s, 0, 'FLOOR');
    const snapped = steps.mul(s).normalize();
    return snapped.isZero() ? null : snapped;
  }

  /**
   * Snap a price to a multiple of `tick` in the requested direction:
   *   - BUY ceiling   -> 'CEIL'  (never pay more than the bound allows)
   *   - SELL floor    -> 'FLOOR'
   *   - reference px  -> 'HALF_UP'
   */
  static roundToTick(
    value: Decimal | string,
    tick: Decimal | string,
    direction: RoundingMode = 'HALF_UP',
  ): Decimal {
    const v = Decimal.parse(value as never);
    const t = Decimal.parse(tick as never);
    if (t.isZero() || t.isNegative()) return v;
    const steps = v.div(t, 0, direction);
    return steps.mul(t).normalize();
  }

  /** Next tick boundary at or above `value`. */
  static ceilToTick(value: Decimal | string, tick: Decimal | string): Decimal {
    return Decimal.roundToTick(value, tick, 'CEIL');
  }

  /** Previous tick boundary at or below `value`. */
  static floorToTick(value: Decimal | string, tick: Decimal | string): Decimal {
    return Decimal.roundToTick(value, tick, 'FLOOR');
  }

  // ------------------------------------------------------------------- output

  /** Canonical plain-decimal string. Never exponent notation. `"0"` for zero. */
  toString(): string {
    if (this.unscaled === 0n) return '0';
    const negative = this.unscaled < 0n;
    const digits = (negative ? -this.unscaled : this.unscaled).toString();

    if (this.scale === 0) return (negative ? '-' : '') + digits;

    const padded = digits.padStart(this.scale + 1, '0');
    const intPart = padded.slice(0, -this.scale);
    const fracPart = padded.slice(-this.scale).replace(/0+$/, '');
    const body = fracPart ? `${intPart}.${fracPart}` : intPart;
    return (negative ? '-' : '') + body;
  }

  /** Fixed-point string carrying exactly `dp` fractional digits. */
  toFixed(dp: number, mode: RoundingMode = 'HALF_UP'): string {
    const rounded = this.rescale(dp, mode);
    const negative = rounded.unscaled < 0n;
    const digits = (negative ? -rounded.unscaled : rounded.unscaled).toString();
    if (dp === 0) return (negative ? '-' : '') + digits;
    const padded = digits.padStart(dp + 1, '0');
    return `${negative ? '-' : ''}${padded.slice(0, -dp)}.${padded.slice(-dp)}`;
  }

  /** Exact bigint of `value * 10^dp`; throws when digits would be lost. */
  toScaledBigInt(dp: number): bigint {
    const scaled = this.rescale(dp, 'DOWN');
    if (!scaled.eq(this)) {
      throw new DecimalError(`Cannot represent ${this.toString()} exactly at scale ${dp}`);
    }
    return scaled.unscaled;
  }

  // ------------------------------------------------------ Layer 1 interop

  /**
   * Convert to the Layer 1 representation (12-place scaled bigint), throwing when
   * the value does not fit. Silently truncating here would let a value that
   * needs 18 decimal places enter the fixed-scale world as a different number.
   */
  toScaled12Exact(): bigint {
    return this.toScaledBigInt(DECIMAL_SCALE);
  }

  /** True when this value is exactly representable in Layer 1. */
  fitsLayer1(): boolean {
    try {
      this.toScaled12Exact();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lossy escape hatch for display and non-financial comparison only. Never use
   * the result in a decision or hand it to a venue.
   */
  toNumber(): number {
    return Number(this.toString());
  }

  toJSON(): string {
    return this.toString();
  }
}

/** Shorthand for {@link Decimal.parse}, so call sites stay short and consistent. */
export function dec(value: string | number | bigint | Decimal): Decimal {
  return Decimal.parse(value);
}

/** Build a {@link Decimal} from Layer 1 units without going through a string. */
export function decimalFromScaled12(scaled: bigint): Decimal {
  return Decimal.fromUnscaled(scaled, DECIMAL_SCALE);
}

/** Largest of the given values. Throws on an empty list. */
export function maxDecimal(...values: Array<Decimal | string | number>): Decimal {
  if (values.length === 0) throw new DecimalError('maxDecimal requires at least one value');
  return values.map((value) => Decimal.parse(value as never)).reduce((a, b) => (a.gte(b) ? a : b));
}

/** Smallest of the given values. Throws on an empty list. */
export function minDecimal(...values: Array<Decimal | string | number>): Decimal {
  if (values.length === 0) throw new DecimalError('minDecimal requires at least one value');
  return values.map((value) => Decimal.parse(value as never)).reduce((a, b) => (a.lte(b) ? a : b));
}

/** Clamp `value` into `[lo, hi]`. Throws when `lo > hi`. */
export function clampDecimal(
  value: Decimal | string,
  lo: Decimal | string,
  hi: Decimal | string,
): Decimal {
  const v = Decimal.parse(value as never);
  const l = Decimal.parse(lo as never);
  const h = Decimal.parse(hi as never);
  if (l.gt(h)) throw new DecimalError('clampDecimal: lower bound exceeds upper bound');
  if (v.lt(l)) return l;
  if (v.gt(h)) return h;
  return v;
}

/**
 * Basis points of a value, exact at every step.
 * 50 bps of 60000 is 300, with no float rounding anywhere in between.
 */
export function bpsOf(value: Decimal | string, bps: number | string): Decimal {
  const v = Decimal.parse(value as never);
  const b = Decimal.parse(bps as never);
  if (b.isNegative()) throw new DecimalError('bpsOf: basis points must not be negative');
  return v.mul(b).div(10_000, 18, 'HALF_UP').normalize();
}
```

FILE: apps/api/src/common/decorators/api-standard-responses.decorator.ts

```typescript
import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../dto/api-response.dto';

/**
 * Documents the error envelopes that any endpoint may return, so the generated
 * OpenAPI document matches what the exception filter actually produces.
 */
export const ApiStandardResponses = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiResponse({
      status: 400,
      description: 'Malformed request.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 401,
      description: 'Missing, expired or invalid access token.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 403,
      description: 'Authenticated but not permitted (RBAC, tenancy or feature flag).',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 422,
      description: 'Validation failed. `error.details` lists the offending fields.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 429,
      description: 'Rate limit exceeded.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
    ApiResponse({
      status: 500,
      description: 'Unexpected server error. Quote the `meta.requestId` in support tickets.',
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
  );
```

FILE: apps/api/src/common/decorators/audit.decorator.ts

```typescript
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { AuditAction } from '@wlct/shared-types';
import { AUDIT_ACTION_KEY } from '../constants/metadata.constants';

/**
 * Declares the audit action produced by a route. The audit interceptor uses it
 * to emit a record automatically when the handler resolves successfully.
 */
export const Audited = (action: AuditAction, resourceType?: string): CustomDecorator<string> =>
  SetMetadata(AUDIT_ACTION_KEY, { action, resourceType });
```

FILE: apps/api/src/common/decorators/current-tenant.decorator.ts

```typescript
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest, TenantContext } from '../types/request.types';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Injects the resolved tenant context. The value is derived server-side from
 * the JWT (authenticated calls) or the request host (public calls) - never from
 * a client supplied tenant id.
 */
export const CurrentTenant = createParamDecorator(
  (property: keyof TenantContext | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const tenant = request.tenantContext;
    if (!tenant) {
      throw new AppException({
        code: ErrorCode.TENANT_NOT_FOUND,
        message: 'No organisation could be resolved for this request.',
      });
    }
    return property ? tenant[property] : tenant;
  },
);

/** Shorthand for the most common need: the tenant id string. */
export const TenantId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<AppRequest>();
  const tenant = request.tenantContext;
  if (!tenant) {
    throw new AppException({
      code: ErrorCode.TENANT_NOT_FOUND,
      message: 'No organisation could be resolved for this request.',
    });
  }
  return tenant.tenantId;
});
```

FILE: apps/api/src/common/decorators/current-user.decorator.ts

```typescript
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedActor } from '@wlct/shared-types';
import type { AppRequest } from '../types/request.types';
import { UnauthorizedException } from '../errors/app.exception';

/**
 * Injects the authenticated actor. Throws instead of returning undefined so a
 * controller can never silently operate without an identity.
 */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedActor | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const actor = request.actor;
    if (!actor) {
      throw new UnauthorizedException();
    }
    return property ? actor[property] : actor;
  },
);
```

FILE: apps/api/src/common/decorators/feature-flag.decorator.ts

```typescript
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import { FEATURE_FLAG_KEY } from '../constants/metadata.constants';

/**
 * Gates a route behind a tenant feature flag. The FeatureFlagGuard resolves the
 * flag for the request's tenant and returns FEATURE_DISABLED when it is off.
 */
export const RequireFeature = (flagKey: string): CustomDecorator<string> =>
  SetMetadata(FEATURE_FLAG_KEY, flagKey);
```

FILE: apps/api/src/common/decorators/index.ts

```typescript
export * from './public.decorator';
export * from './permissions.decorator';
export * from './current-user.decorator';
export * from './current-tenant.decorator';
export * from './request-context.decorator';
export * from './audit.decorator';
export * from './feature-flag.decorator';
export * from './api-standard-responses.decorator';
export * from './zod-body.decorator';
```

FILE: apps/api/src/common/decorators/permissions.decorator.ts

```typescript
import { SetMetadata, applyDecorators, type CustomDecorator } from '@nestjs/common';
import type { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY, PLATFORM_ONLY_KEY } from '../constants/metadata.constants';

export type PermissionMode = 'all' | 'any';

/** Requires the caller to hold every listed permission. */
export const RequirePermissions = (...permissions: Permission[]): CustomDecorator<string> =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'all' satisfies PermissionMode),
  ) as CustomDecorator<string>;

/** Requires at least one of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]): CustomDecorator<string> =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'any' satisfies PermissionMode),
  ) as CustomDecorator<string>;

/** Restricts a route to platform staff (super admins), regardless of tenant. */
export const PlatformOnly = (): CustomDecorator<string> => SetMetadata(PLATFORM_ONLY_KEY, true);

/**
 * Explicitly open a route to any authenticated user of the tenant, overriding
 * a class-level permission default. Use only for self-service or banner-style
 * reads whose handler scopes the data to the caller.
 */
export const AllowAnyAuthenticated = (): CustomDecorator<string> => SetMetadata(PERMISSIONS_KEY, []);
```

FILE: apps/api/src/common/decorators/public.decorator.ts

```typescript
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants/metadata.constants';

/**
 * Marks a route as reachable without an access token. Authentication is
 * deny-by-default: every endpoint requires a valid JWT unless it opts out here.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
```

FILE: apps/api/src/common/decorators/request-context.decorator.ts

```typescript
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest } from '../types/request.types';

export interface RequestMetadata {
  requestId: string;
  /** Part 9: the cross-service correlation id (echoed on the response
   *  header; falls back to requestId for calls that arrived without one). */
  correlationId: string;
  ipHash: string;
  ip: string;
  userAgent: string | null;
  locale: string;
  method: string;
  path: string;
}

/** RequestMetadata deliberately does NOT carry the operation id as a
 *  separate field for callers: for an HTTP request the operation IS the
 *  request. Queue-side code that splits a request into several operations
 *  owns its operation ids locally (see the maintenance jobs). */

/** Injects request metadata needed by audit logging and security analytics. */
export const RequestMeta = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestMetadata => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    return {
      requestId: request.requestId,
      correlationId: request.correlationId,
      ipHash: request.ipHash,
      ip: request.ip ?? 'unknown',
      userAgent: request.headers['user-agent'] ?? null,
      locale: request.locale,
      method: request.method,
      path: request.originalUrl.split('?')[0],
    };
  },
);
```

FILE: apps/api/src/common/decorators/zod-body.decorator.ts

```typescript
import { Body, Param, Query } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

/**
 * Validates a request body with a zod schema from `@wlct/validation`, which
 * keeps a single validation source of truth shared with the web and mobile
 * clients. Swagger documentation still comes from the DTO classes.
 */
export const ZodBody = (schema: ZodSchema): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

/** Query-string equivalent of {@link ZodBody}. */
export const ZodQuery = (schema: ZodSchema): ParameterDecorator =>
  Query(new ZodValidationPipe(schema));

/** Route-parameter equivalent of {@link ZodBody}. */
export const ZodParam = (property: string, schema: ZodSchema): ParameterDecorator =>
  Param(property, new ZodValidationPipe(schema));
```

FILE: apps/api/src/common/dto/api-response.dto.ts

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Swagger models mirroring the runtime envelopes in `@wlct/shared-types`. */

export class ResponseMetaDto {
  @ApiProperty({ example: '7f3c1d2e-0f8a-4a3b-9c1a-1d2e3f4a5b6c' })
  requestId!: string;

  @ApiProperty({ example: '2026-09-05T09:15:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '1' })
  version!: string;
}

export class ValidationErrorDetailDto {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'isEmail' })
  constraint!: string;

  @ApiProperty({ example: 'Must be a valid email address' })
  message!: string;
}

export class ApiErrorBodyDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'The submitted data failed validation.' })
  message!: string;

  @ApiProperty({ example: 422 })
  statusCode!: number;

  @ApiPropertyOptional({ type: [ValidationErrorDetailDto] })
  details?: ValidationErrorDetailDto[];
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ApiErrorBodyDto })
  error!: ApiErrorBodyDto;

  @ApiProperty({ type: ResponseMetaDto })
  meta!: ResponseMetaDto;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 137 })
  totalItems!: number;

  @ApiProperty({ example: 7 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;
}
```

FILE: apps/api/src/common/dto/index.ts

```typescript
export * from './api-response.dto';
export * from './pagination-query.dto';
```

FILE: apps/api/src/common/dto/pagination-params.spec.ts

```typescript
import { ValidationException } from '../errors/app.exception';

import { boundedIntParam, limitParam, pageParam } from './pagination-params';

/**
 * The copy-trading, custody and research list endpoints read pagination from
 * an untyped query with `parseInt`: `?page=0` became a negative skip (Prisma
 * UnknownRequestError -> HTTP 500), `?limit=1000000` an unbounded read, and
 * `?page=abc` NaN (a generic 400 without field detail).
 */
describe('pagination params for untyped @Query() handlers', () => {
  it('uses the handler default when the parameter is absent', () => {
    expect(pageParam(undefined)).toBe(1);
    expect(pageParam('')).toBe(1);
    expect(limitParam(undefined, 50)).toBe(50);
    expect(limitParam(undefined)).toBe(20);
  });

  it('parses valid integers', () => {
    expect(pageParam('3')).toBe(3);
    expect(limitParam('100')).toBe(100);
    expect(limitParam(' 25 ')).toBe(25);
  });

  it.each(['abc', '1.5', '-3', '2e3', '0x10'])('rejects page=%s with a validation error, not NaN', (raw) => {
    expect(() => pageParam(raw)).toThrow(ValidationException);
  });

  it('rejects page 0, limit 0 and limit above the maximum', () => {
    expect(() => pageParam('0')).toThrow(ValidationException);
    expect(() => limitParam('0')).toThrow(ValidationException);
    expect(() => limitParam('101')).toThrow(ValidationException);
  });

  it('rejects repeated parameters (?page=1&page=2 arrives as an array)', () => {
    expect(() => pageParam(['1', '2'])).toThrow(ValidationException);
  });

  it('bounded optional integers keep "absent" as undefined and enforce the range', () => {
    expect(boundedIntParam(undefined, 'limit', 1, 1000)).toBeUndefined();
    expect(boundedIntParam('500', 'limit', 1, 1000)).toBe(500);
    expect(() => boundedIntParam('1001', 'limit', 1, 1000)).toThrow(ValidationException);
    expect(() => boundedIntParam('x', 'limit', 1, 1000)).toThrow(ValidationException);
  });
});
```

FILE: apps/api/src/common/dto/pagination-params.ts

```typescript
import { PAGINATION_DEFAULTS } from '@wlct/config';

import { ValidationException } from '../errors/app.exception';

/**
 * Pagination for handlers that still read an untyped `@Query() query: any`
 * (copy-trading, custody and research controllers).
 *
 * Those handlers used `query.page ? parseInt(query.page) : 1`. Measured on
 * PostgreSQL 16 with Prisma 5.22:
 *   - `?page=0` / `?page=-3` -> negative `skip` -> PrismaClientUnknownRequestError,
 *     which no filter maps -> HTTP 500;
 *   - `?limit=1000000` -> accepted, an unbounded read (the custody and research
 *     services do not clamp);
 *   - `?page=abc` -> `take`/`skip` NaN -> a generic 400 with no field detail.
 * These helpers apply the same rules as PaginationQueryDto
 * (page >= 1, 1 <= limit <= MAX_LIMIT) and fail with the same field-level
 * ValidationException (422) a DTO-validated endpoint would return, before any
 * database call.
 */
function parsePositiveInt(raw: unknown, field: 'page' | 'limit'): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) {
    throw new ValidationException([
      { field, constraint: 'isInt', message: `${field} must be an integer` },
    ]);
  }
  return Number.parseInt(text.trim(), 10);
}

export function pageParam(raw: unknown, fallback: number = PAGINATION_DEFAULTS.PAGE): number {
  const page = parsePositiveInt(raw, 'page');
  if (page === undefined) return fallback;
  if (page < 1) {
    throw new ValidationException([{ field: 'page', constraint: 'min', message: 'page must be at least 1' }]);
  }
  return page;
}

export function limitParam(raw: unknown, fallback: number = PAGINATION_DEFAULTS.LIMIT): number {
  const limit = parsePositiveInt(raw, 'limit');
  if (limit === undefined) return fallback;
  if (limit < 1) {
    throw new ValidationException([{ field: 'limit', constraint: 'min', message: 'limit must be at least 1' }]);
  }
  if (limit > PAGINATION_DEFAULTS.MAX_LIMIT) {
    throw new ValidationException([
      {
        field: 'limit',
        constraint: 'max',
        message: `limit must not exceed ${PAGINATION_DEFAULTS.MAX_LIMIT}`,
      },
    ]);
  }
  return limit;
}

/**
 * Optional integer with explicit bounds, for limits that are not page sizes
 * (e.g. candle counts forwarded to an exchange). Absent -> undefined so the
 * downstream default applies.
 */
export function boundedIntParam(raw: unknown, field: string, min: number, max: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) {
    throw new ValidationException([{ field, constraint: 'isInt', message: `${field} must be an integer` }]);
  }
  const value = Number.parseInt(text.trim(), 10);
  if (value < min || value > max) {
    throw new ValidationException([
      { field, constraint: 'range', message: `${field} must be between ${min} and ${max}` },
    ]);
  }
  return value;
}
```

FILE: apps/api/src/common/dto/pagination-query.dto.ts

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PAGINATION_DEFAULTS } from '@wlct/config';

/** Shared query DTO for every list endpoint. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION_DEFAULTS.PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = PAGINATION_DEFAULTS.PAGE;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PAGINATION_DEFAULTS.MAX_LIMIT,
    default: PAGINATION_DEFAULTS.LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT, {
    message: `limit must not exceed ${PAGINATION_DEFAULTS.MAX_LIMIT}`,
  })
  limit: number = PAGINATION_DEFAULTS.LIMIT;

  @ApiPropertyOptional({ description: 'Field to sort by. Unknown fields are ignored.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder must be "asc" or "desc"' })
  sortOrder: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Free-text search term.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
```

FILE: apps/api/src/common/errors/app.exception.ts

```typescript
import { HttpException } from '@nestjs/common';
import { ERROR_CODE_HTTP_STATUS, ErrorCode, type ValidationErrorDetail } from '@wlct/shared-types';

export interface AppExceptionOptions {
  /** Machine readable code the clients switch on. */
  code: ErrorCode;
  /** Human readable, safe-to-display message. */
  message?: string;
  /** Overrides the default status mapped from the code. */
  statusCode?: number;
  /** Field level validation problems. */
  details?: ValidationErrorDetail[];
  /** Internal-only diagnostic context; logged, never serialised to clients. */
  cause?: unknown;
  /** Extra structured context for logs and audit records. */
  context?: Record<string, unknown>;
}

/**
 * Base exception for every deliberate failure raised by application code.
 *
 * Two rules make this safe by construction:
 *   1. `message` is always something we are happy to show a end user.
 *   2. `cause`/`context` never leave the process; the exception filter strips
 *      them from the HTTP response and forwards them to the logger only.
 */
export class AppException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: ValidationErrorDetail[];
  public readonly context?: Record<string, unknown>;
  public readonly internalCause?: unknown;

  constructor(options: AppExceptionOptions) {
    const status = options.statusCode ?? ERROR_CODE_HTTP_STATUS[options.code] ?? 500;
    const message = options.message ?? defaultMessageFor(options.code);
    super({ code: options.code, message, statusCode: status }, status);
    this.name = 'AppException';
    this.code = options.code;
    this.details = options.details;
    this.context = options.context;
    this.internalCause = options.cause;
  }
}

function defaultMessageFor(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.UNAUTHORIZED:
      return 'Authentication is required to access this resource.';
    case ErrorCode.INVALID_CREDENTIALS:
      return 'The email address or password is incorrect.';
    case ErrorCode.FORBIDDEN:
    case ErrorCode.INSUFFICIENT_PERMISSIONS:
      return 'You do not have permission to perform this action.';
    case ErrorCode.NOT_FOUND:
      return 'The requested resource was not found.';
    case ErrorCode.CONFLICT:
      return 'The request conflicts with the current state of the resource.';
    case ErrorCode.VALIDATION_ERROR:
      return 'The submitted data failed validation.';
    case ErrorCode.RATE_LIMIT_EXCEEDED:
      return 'Too many requests. Please slow down and try again shortly.';
    case ErrorCode.INTERNAL_SERVER_ERROR:
      return 'An unexpected error occurred. Please try again later.';
    default:
      return 'The request could not be completed.';
  }
}

// -----------------------------------------------------------------------------
// Convenience subclasses for the most frequent failures
// -----------------------------------------------------------------------------

export class ValidationException extends AppException {
  constructor(details: ValidationErrorDetail[], message = 'The submitted data failed validation.') {
    super({ code: ErrorCode.VALIDATION_ERROR, message, details });
    this.name = 'ValidationException';
  }
}

export class NotFoundException extends AppException {
  constructor(resource: string, identifier?: string) {
    super({
      code: ErrorCode.NOT_FOUND,
      message: `${resource} was not found.`,
      context: identifier ? { resource, identifier } : { resource },
    });
    this.name = 'NotFoundException';
  }
}

export class ConflictException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: ErrorCode.CONFLICT, message, context });
    this.name = 'ConflictException';
  }
}

export class UnauthorizedException extends AppException {
  constructor(code: ErrorCode = ErrorCode.UNAUTHORIZED, message?: string) {
    super({ code, message });
    this.name = 'UnauthorizedException';
  }
}

export class ForbiddenException extends AppException {
  constructor(code: ErrorCode = ErrorCode.FORBIDDEN, message?: string, context?: Record<string, unknown>) {
    super({ code, message, context });
    this.name = 'ForbiddenException';
  }
}

export class TenantIsolationException extends AppException {
  constructor(context: Record<string, unknown>) {
    super({
      code: ErrorCode.TENANT_MISMATCH,
      message: 'The requested resource does not belong to your organisation.',
      context,
    });
    this.name = 'TenantIsolationException';
  }
}

export class FeatureDisabledException extends AppException {
  constructor(featureKey: string) {
    super({
      code: ErrorCode.FEATURE_DISABLED,
      message: 'This feature is not enabled for your organisation.',
      context: { featureKey },
    });
    this.name = 'FeatureDisabledException';
  }
}

export class ServiceUnavailableException extends AppException {
  constructor(service: string, cause?: unknown) {
    super({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'A dependent service is temporarily unavailable. Please retry shortly.',
      context: { service },
      cause,
    });
    this.name = 'ServiceUnavailableException';
  }
}
```

FILE: apps/api/src/common/errors/index.ts

```typescript
export * from './app.exception';
```

FILE: apps/api/src/common/errors/prisma-not-found.ts

```typescript
import { Prisma } from '@prisma/client';

/**
 * True when `error` is Prisma's "record to update/delete does not exist"
 * (P2025) - the one storage error that legitimately means "not found".
 *
 * Repository update/delete methods that answer `null` (or `false`) for a
 * missing row use this to keep that answer while letting every other storage
 * failure propagate: a lost connection, a statement timeout or an RLS denial
 * is an error, not "not found", and the global PrismaExceptionFilter maps it
 * to the right HTTP status without leaking the driver message.
 *
 * Besides the real PrismaClientKnownRequestError, any error object carrying
 * `code: 'P2025'` is recognised (test doubles raise plain objects, and some
 * suites replace @prisma/client entirely, so the class may be absent).
 */
export function isRecordNotFound(error: unknown): boolean {
  const KnownRequestError = (Prisma as { PrismaClientKnownRequestError?: unknown } | undefined)
    ?.PrismaClientKnownRequestError;
  if (typeof KnownRequestError === 'function' && error instanceof (KnownRequestError as new (...args: never[]) => object)) {
    return (error as { code?: unknown }).code === 'P2025';
  }
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';
}
```

FILE: apps/api/src/common/fail-soft-reads.spec.ts

```typescript
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Prisma } from '@prisma/client';

import { isRecordNotFound } from './errors/prisma-not-found';
import { PaymentRepository } from '../modules/billing/payments/payment.repository';
import { AccountRestrictionService } from '../modules/client-lifecycle/account-restriction.service';
import { AccountingPeriodService } from '../modules/portfolio-accounting/accounting-period.service';
import { SessionSecurityService } from '../modules/security/session-security.service';
import { SsoProviderFactory } from '../modules/security/sso-provider.factory';
import { CopySubscriptionRepository } from '../modules/copy-trading/copy-subscription.repository';
import { DependencyHealthService } from '../modules/operations/dependency-health.service';
import { OperationalMetricsService } from '../modules/operations/operational-metrics.service';
import { CostBasisService } from '../modules/portfolio-accounting/cost-basis.service';
import { ReconciliationOrchestratorService } from '../modules/operations/reconciliation-orchestrator.service';

/**
 * Fail-soft reads (round 8).
 *
 * A database read that fails is an error, not "no rows". Before this change
 * about 300 data-access methods caught every storage error and answered an
 * empty list, null, 0 or false, so an outage looked like "nothing there" -
 * and four of those answers failed OPEN: a restriction check said "not
 * restricted", a closed-period check said "open", a session-revocation check
 * said "not revoked" and an SSO-enforcement check said "not enforced".
 *
 * The methods now let the error propagate (the global PrismaExceptionFilter
 * maps it to a status without leaking the driver message); update/delete
 * methods keep `null`/`false` only for Prisma P2025 (record not found).
 *
 * The last block is a guard: it scans every non-spec module file for the
 * catch-everything-and-answer-empty shape and compares the result with an
 * explicit allowlist, so a new fail-soft read cannot be added silently.
 */

const STORAGE_DOWN = new Error('connection terminated unexpectedly');

describe('isRecordNotFound', () => {
  it('recognises Prisma P2025 as "not found"', () => {
    const known = new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
      code: 'P2025',
      clientVersion: 'test',
    });
    expect(isRecordNotFound(known)).toBe(true);
    expect(isRecordNotFound({ code: 'P2025' })).toBe(true);
  });

  it('treats every other failure as an error', () => {
    const unique = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(isRecordNotFound(unique)).toBe(false);
    expect(isRecordNotFound(STORAGE_DOWN)).toBe(false);
    expect(isRecordNotFound({ code: '57014' })).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
    expect(isRecordNotFound(undefined)).toBe(false);
    expect(isRecordNotFound('P2025')).toBe(false);
  });
});

describe('fail-open checks now fail closed (the error propagates)', () => {
  it('AccountRestrictionService.hasRestriction: a failed read is not "no restriction"', async () => {
    const prisma = { accountRestriction: { findFirst: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new AccountRestrictionService(prisma as any, {} as any);
    await expect(
      service.hasRestriction({ tenantId: 't1', accountId: 'a1', restrictionType: 'TRADING_BLOCK' as any }),
    ).rejects.toBe(STORAGE_DOWN);
  });

  it('AccountRestrictionService.hasRestriction still answers true/false from a successful read', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 'r1' }).mockResolvedValueOnce(null);
    const service = new AccountRestrictionService({ accountRestriction: { findFirst } } as any, {} as any);
    const params = { tenantId: 't1', accountId: 'a1', restrictionType: 'TRADING_BLOCK' as any };
    await expect(service.hasRestriction(params)).resolves.toBe(true);
    await expect(service.hasRestriction(params)).resolves.toBe(false);
  });

  it('AccountingPeriodService.isPeriodClosed: a failed read is not "period open"', async () => {
    const prisma = { portfolioAccountingPeriod: { findFirst: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new AccountingPeriodService(prisma as any, {} as any);
    await expect(service.isPeriodClosed({ tenantId: 't1', profileId: 'p1', at: new Date() })).rejects.toBe(STORAGE_DOWN);
  });

  it('SessionSecurityService.isSessionRevoked: a failed read is not "not revoked"', async () => {
    const prisma = { userSession: { findUnique: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const cache = { get: jest.fn().mockResolvedValue(null) };
    const service = new SessionSecurityService(prisma as any, {} as any, {} as any, {} as any, cache as any);
    await expect(service.isSessionRevoked('s1')).rejects.toBe(STORAGE_DOWN);
  });

  it('SessionSecurityService.isSessionRevoked still honours the cache and the stored revokedAt', async () => {
    const findUnique = jest.fn().mockResolvedValue({ revokedAt: new Date() });
    const cache = { get: jest.fn().mockResolvedValueOnce({ reason: 'x' }).mockResolvedValueOnce(null) };
    const service = new SessionSecurityService({ userSession: { findUnique } } as any, {} as any, {} as any, {} as any, cache as any);
    await expect(service.isSessionRevoked('s1')).resolves.toBe(true);
    await expect(service.isSessionRevoked('s1')).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('SessionSecurityService.revokeAllSessions: a failed read is not "0 sessions revoked"', async () => {
    const prisma = { userSession: { findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new SessionSecurityService(prisma as any, {} as any, {} as any, {} as any, { set: jest.fn() } as any);
    await expect(service.revokeAllSessions({ userId: 'u1', tenantId: 't1', reason: 'password_changed' })).rejects.toBe(
      STORAGE_DOWN,
    );
  });

  it('SsoProviderFactory.isSsoEnforced / listTenantProviders: a failed read is not "SSO not enforced"', async () => {
    const prisma = {
      ssoConfiguration: {
        findFirst: jest.fn().mockRejectedValue(STORAGE_DOWN),
        findMany: jest.fn().mockRejectedValue(STORAGE_DOWN),
      },
    };
    const factory = new SsoProviderFactory(prisma as any, {} as any, {} as any);
    await expect(factory.isSsoEnforced('t1')).rejects.toBe(STORAGE_DOWN);
    await expect(factory.listTenantProviders('t1')).rejects.toBe(STORAGE_DOWN);
  });
});

describe('fail-soft reads now propagate', () => {
  it('PaymentRepository lookups used by webhooks and idempotent retries do not report "no such payment" on failure', async () => {
    const prisma = { payment: { findFirst: jest.fn().mockRejectedValue(STORAGE_DOWN), findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const repository = new PaymentRepository(prisma as any);
    await expect(repository.findByIdempotencyKey('idem-1', 't1')).rejects.toBe(STORAGE_DOWN);
    await expect(repository.findByProviderPaymentId('pi_1', 'STRIPE' as any)).rejects.toBe(STORAGE_DOWN);
    await expect(repository.list({ tenantId: 't1' } as any)).rejects.toBe(STORAGE_DOWN);
  });

  it('PaymentRepository still answers null for a payment that is really absent', async () => {
    const prisma = { payment: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(new PaymentRepository(prisma as any).findByIdempotencyKey('idem-1', 't1')).resolves.toBeNull();
  });

  it('CostBasisService does not compute FIFO cost basis against an unread lot list', async () => {
    const prisma = { portfolioPositionLot: { findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const policy = { resolvePolicy: jest.fn().mockResolvedValue({}) };
    const service = new CostBasisService(prisma as any, {} as any, policy as any);
    await expect(
      service.calculateCostBasisForFill({
        tenantId: 't1',
        profileId: 'p1',
        fill: {},
        symbol: 'BTCUSDT',
        quantity: '1',
        price: '100',
        side: 'SELL',
        occurredAt: new Date(),
        accountingEventId: 'e1',
      }),
    ).rejects.toBe(STORAGE_DOWN);
  });

  it('OperationalMetricsService does not publish zeros as measured observations', async () => {
    const prisma = { operationalIncident: { findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new OperationalMetricsService(prisma as any);
    await expect(service.calculateMetrics({ tenantId: 't1', from: new Date(Date.now() - 3600_000), to: new Date() })).rejects.toBe(
      STORAGE_DOWN,
    );
  });
});

describe('update methods keep "not found" only for P2025', () => {
  it('CopySubscriptionRepository.updateState answers null for a missing row', async () => {
    const prisma = { copySubscription: { update: jest.fn().mockRejectedValue({ code: 'P2025' }) } };
    await expect(new CopySubscriptionRepository(prisma as any).updateState('s1', 't1', 'PAUSED' as any)).resolves.toBeNull();
  });

  it('CopySubscriptionRepository.updateState propagates any other failure', async () => {
    const prisma = { copySubscription: { update: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    await expect(new CopySubscriptionRepository(prisma as any).updateState('s1', 't1', 'PAUSED' as any)).rejects.toBe(
      STORAGE_DOWN,
    );
  });
});

describe('health and reconciliation report a failed read as a failure, not as clean', () => {
  it('DependencyHealthService.checkRisk is UNKNOWN (not HEALTHY with 0 policies) when the read fails', async () => {
    const prisma = { institutionalRiskPolicy: { count: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new DependencyHealthService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    const result = await service.checkRisk('t1');
    expect(result.state).toBe('UNKNOWN');
    expect(result.errorCode).toBe('RISK_CHECK_FAILED');
  });

  it('DependencyHealthService.checkRisk is HEALTHY with the real count when the read succeeds', async () => {
    const prisma = { institutionalRiskPolicy: { count: jest.fn().mockResolvedValue(3) } };
    const service = new DependencyHealthService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    const result = await service.checkRisk('t1');
    expect(result.state).toBe('HEALTHY');
    expect(result.evidence).toEqual(expect.objectContaining({ policyCount: 3 }));
  });

  it('ReconciliationOrchestratorService: an unreadable OMS order table is FAILED, not SUCCEEDED with 0 mismatches', async () => {
    const prisma = { omsOrderIntent: { findMany: jest.fn().mockRejectedValue(STORAGE_DOWN) } };
    const service = new ReconciliationOrchestratorService(prisma as any, {} as any, {} as any, {} as any);
    const result = await (service as any).reconcileOmsOrder('t1');
    expect(result.status).toBe('FAILED');
    expect(result.itemsChecked).toBe(0);
  });

  it('ReconciliationOrchestratorService: a readable table still reconciles', async () => {
    const prisma = { omsOrderIntent: { findMany: jest.fn().mockResolvedValue([{ id: 'o1' }]) } };
    const service = new ReconciliationOrchestratorService(prisma as any, {} as any, {} as any, {} as any);
    const result = await (service as any).reconcileOmsOrder('t1');
    expect(result.status).toBe('SUCCEEDED');
    expect(result.mismatchesFound).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Guard: the catch-everything-and-answer-empty shape, per module file.
// ---------------------------------------------------------------------------

const MODULES_ROOT = join(__dirname, '..', 'modules');

/**
 * Every remaining `try { ... } catch { [log;] return <empty>; }` in a module
 * file, with the reason it is not a fail-soft storage read. Counts are exact:
 * adding a site fails this spec, and so does removing one without updating
 * the list (so the list cannot drift from the code).
 */
const ALLOWED_TRY_CATCH_EMPTY: Record<string, { count: number; reason: string }> = {
  'billing/analytics/analytics-cache.service.ts': { count: 4, reason: 'cache get/invalidate; a cache miss or failure falls back to computing the value' },
  'billing/analytics/revenue-cohort.service.ts': { count: 1, reason: 'cohort key derivation from a date (pure computation)' },
  'billing/entitlements/entitlement.resolver.ts': { count: 3, reason: 'EntitlementResolver is exported but not registered in any Nest module (no route reaches it)' },
  'billing/fees/fee-analytics.service.ts': { count: 1, reason: 'parsing a decimal string into minor units' },
  'billing/fees/payout-provider.factory.ts': { count: 1, reason: 'provider availability probe; unavailable is the fail-closed answer' },
  'billing/finance/invoice-number.service.ts': { count: 2, reason: 'Redis sequence readers with no callers (numbers are allocated elsewhere)' },
  'billing/limits/limit.resolver.ts': { count: 3, reason: 'LimitResolver is exported but not registered in any Nest module (no route reaches it)' },
  'billing/notifications/notification-worker.service.ts': { count: 1, reason: 'worker loop: logs the (now propagated) repository error and retries on the next tick' },
  'billing/notifications/push-notification.service.ts': { count: 1, reason: 'optional firebase-admin module import' },
  'billing/payments/payment-provider.factory.ts': { count: 1, reason: 'provider enabled flag from config; disabled is the fail-closed answer' },
  'billing/payments/webhook.signature.ts': { count: 2, reason: 'reading id/type fields from an already-parsed provider event' },
  'oms/allocation.service.ts': { count: 1, reason: 'multi-step write flow that logs its failure (write side, not a read)' },
  'oms/execution-latency.service.ts': { count: 1, reason: 'parsing a microsecond string' },
  'oms/execution-quality.service.ts': { count: 1, reason: 'parsing a scaled decimal' },
  'oms/order-submission-result.service.ts': { count: 1, reason: 'JSON.parse of a queue return value' },
  'compliance/compliance-case.repository.ts': { count: 1, reason: 'reviewer assignment write flow that logs its failure (write side)' },
  'compliance/transaction-monitoring.service.ts': { count: 1, reason: 'signal acknowledgement updateMany that logs its failure (write side)' },
  'copy-trading/copy-execution.repository.ts': { count: 1, reason: 'status-transition write that logs its failure (write side)' },
  'copy-trading/copy-execution.service.ts': { count: 5, reason: 'fail-closed pre-trade guards: a failed lookup BLOCKS the leader event and logs it' },
  'custody/custody-audit.service.ts': { count: 1, reason: 'audit record create that logs its failure (write side)' },
  'exchanges/exchange-rate-limit.service.ts': { count: 1, reason: 'rate-limit state from the cache (status read, not storage)' },
  'exchanges/exchange-symbol.service.ts': { count: 1, reason: 'symbol string parsing' },
  'exchanges/secret-store.ts': { count: 1, reason: 'reading VAULT_TOKEN_FILE; a missing token then fails closed with NOT_CONFIGURED' },
  'governance/compliance-report-template.service.ts': { count: 1, reason: 'in-memory template lookup' },
  'health/trading-readiness.service.ts': { count: 1, reason: 'queue-depth samples from Redis for a metrics sampler' },
  'mobile-release/mobile-artifact-verification.service.ts': { count: 1, reason: 'timingSafeEqual on hex digests of different length' },
  'mobile-release/mobile-build-validation.service.ts': { count: 1, reason: 'file existence check on the build host' },
  'observability/observability.mapper.ts': { count: 3, reason: 'JSON.parse of stored evidence text' },
  'observability/observability.service.ts': { count: 1, reason: 'queue-depth samples from Redis for a dashboard' },
  'operations/incident-escalation.service.ts': { count: 2, reason: 'escalation sweep and transition: cron-driven, logged, retried on the next run' },
  'portfolio-accounting/attribution.service.ts': { count: 1, reason: 'derived attribution record create that logs its failure (write side)' },
  'portfolio-accounting/performance.service.ts': { count: 1, reason: 'derived performance record create that logs its failure (write side)' },
  'portfolio-accounting/valuation.service.ts': { count: 1, reason: 'derived valuation record create that logs its failure (write side)' },
  'providers/provider-webhook.service.ts': { count: 4, reason: 'webhook signature verification (false = reject) and body parsing' },
  'research/market-data-service.ts': { count: 1, reason: 'market-data provider availability probe (gated provider)' },
  'research/research-repository.ts': { count: 1, reason: 'research audit-log create (write side)' },
  'risk/risk-state.service.ts': { count: 1, reason: 'parsing a stored policy document' },
  'security/sso-flow.types.ts': { count: 1, reason: 'URL parsing' },
};

/**
 * Every remaining promise-style `.catch(() => <empty>)` in a module file.
 * None of them swallows a read the caller then treats as data.
 */
const ALLOWED_PROMISE_CATCH_EMPTY: Record<string, { count: number; reason: string }> = {
  'billing/finance/vies-vat.client.ts': { count: 1, reason: 'parsing a provider response body' },
  'billing/notifications/email-notification.provider.ts': { count: 1, reason: 'optional nodemailer module import' },
  'billing/notifications/push-notification.service.ts': { count: 1, reason: 'optional firebase-admin module import' },
  'billing/notifications/twilio-sms.provider.ts': { count: 1, reason: 'parsing a provider response body' },
  'billing/payments/checkout.service.ts': { count: 1, reason: 'secondary mark-failed write inside an error path that then reports the failure' },
  'billing/saas-admin/tenant-feature-access.service.ts': { count: 1, reason: 'best-effort audit of a read-only feature check' },
  'datasets/dataset-ingestion.service.ts': { count: 2, reason: 'secondary writes inside an error path that then throws ServiceUnavailable' },
  'developer-platform/developer.module.ts': { count: 1, reason: 'draining a webhook test response body' },
  'exchanges/secret-store.ts': { count: 2, reason: 'parsing a Vault response body' },
  'oms/fill-management.service.ts': { count: 1, reason: 'canonical-order fallback path (round 7 item B), not the primary read' },
  'oms/order-submission-result.service.ts': { count: 3, reason: 'queue-events close on shutdown and BullMQ job lookups (a removed job is absent)' },
  'operations/dependency-health.service.ts': { count: 1, reason: 'checkOms: a failed count is reported as MISCONFIGURED, not as healthy' },
  'operations/job-health.service.ts': { count: 1, reason: 'queue-depth metadata (unused by the evaluation)' },
  'operations/reconciliation-orchestrator.service.ts': { count: 1, reason: 'lock acquisition: no lock means the run is skipped and logged' },
  'operations/reconciliation-schedule.service.ts': { count: 1, reason: 'lock acquisition: no lock means the run is skipped and logged' },
  'operations/recovery-plan.service.ts': { count: 2, reason: 'lock acquisition, and a Redis health probe that reports ok:false' },
  'partners/partner-settlement.service.ts': { count: 1, reason: 'in-memory ledger fallback path after a failed transaction' },
  'providers/provider-health.service.ts': { count: 1, reason: 'buyer-gated payment-provider HTTP probe' },
  'queue/processors/maintenance.processor.ts': { count: 2, reason: 'best-effort SLO sample counters' },
  'queue/queue.service.ts': { count: 1, reason: 'best-effort tracing sidecar capture' },
  'worker/trade-execution.processor.ts': { count: 2, reason: 'best-effort SLO sample counters' },
};

function listModuleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listModuleFiles(full));
    } else if (name.endsWith('.ts') && !name.includes('.spec.') && !name.includes('fixture')) {
      out.push(full);
    }
  }
  return out;
}

function skipString(s: string, i: number): number {
  const quote = s[i];
  i += 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && c === '$' && s[i + 1] === '{') {
      i = matchBrace(s, i + 1) + 1;
      continue;
    }
    if (c === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** Index of the `}` matching the `{` at `open` (strings, template literals and comments skipped). */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(s, i);
      continue;
    }
    if (s.startsWith('//', i)) {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

const EMPTY_RETURN =
  /^return\s*(\[\]|null|undefined|0|false|\{\s*\}|\{[^{}]*:\s*\[\][^{}]*\}|\{\s*(data|items)\s*:\s*\[\][^{}]*\})\s*;?$/;

function stripComments(code: string): string {
  return code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function countTryCatchEmpty(source: string): number {
  let count = 0;
  const tryRe = /\btry\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = tryRe.exec(source)) !== null) {
    const tryOpen = m.index + m[0].length - 1;
    const tryClose = matchBrace(source, tryOpen);
    if (tryClose < 0) continue;
    const catchHead = /^\s*catch\s*(\(\s*(\w+)[^)]*\))?\s*\{/.exec(source.slice(tryClose + 1));
    if (!catchHead) continue;
    const catchOpen = tryClose + 1 + catchHead[0].length - 1;
    const catchClose = matchBrace(source, catchOpen);
    const body = stripComments(source.slice(catchOpen + 1, catchClose)).trim();
    const statements = body
      .split(/;\s*\n|\n/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    const rest = statements.filter((x) => !x.startsWith('this.logger') && !x.startsWith('logger'));
    if (rest.length === 1 && EMPTY_RETURN.test(rest.join(' '))) count += 1;
  }
  return count;
}

const PROMISE_CATCH_EMPTY = /\.catch\(\s*(\([^)]*\))?\s*=>\s*(\[\]|null|0|false|undefined|'0'|\(\{|\{\s*\}|null as any)/g;

function scan(counter: (source: string) => number): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of listModuleFiles(MODULES_ROOT)) {
    const n = counter(readFileSync(file, 'utf8'));
    if (n > 0) found[relative(MODULES_ROOT, file).split('\\').join('/')] = n;
  }
  return found;
}

function expectedCounts(list: Record<string, { count: number; reason: string }>): Record<string, number> {
  return Object.fromEntries(Object.entries(list).map(([file, entry]) => [file, entry.count]));
}

describe('guard: no new fail-soft reads in module code', () => {
  it('every try/catch that answers an empty value is on the reviewed allowlist (exact counts)', () => {
    expect(scan(countTryCatchEmpty)).toEqual(expectedCounts(ALLOWED_TRY_CATCH_EMPTY));
  });

  it('every promise .catch that answers an empty value is on the reviewed allowlist (exact counts)', () => {
    expect(scan((source) => (source.match(PROMISE_CATCH_EMPTY) ?? []).length)).toEqual(
      expectedCounts(ALLOWED_PROMISE_CATCH_EMPTY),
    );
  });

  it('every allowlist entry states a reason', () => {
    for (const entry of [...Object.values(ALLOWED_TRY_CATCH_EMPTY), ...Object.values(ALLOWED_PROMISE_CATCH_EMPTY)]) {
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('the scanner sees the shape it guards against (self-test)', () => {
    const failSoft = "async f() {\n  try {\n    return await this.prisma.x.findMany();\n  } catch {\n    return [];\n  }\n}\n";
    const logged = "async f() {\n  try {\n    return await this.prisma.x.findFirst();\n  } catch (e) {\n    this.logger.warn(`x ${e}`);\n    return null;\n  }\n}\n";
    const rethrow = "async f() {\n  try {\n    return await this.prisma.x.findMany();\n  } catch (e) {\n    this.logger.warn('x');\n    throw e;\n  }\n}\n";
    const braceInString = "async f() {\n  try {\n    const s = `{${'}'}`;\n    return s;\n  } catch {\n    return { data: [], total: 0 };\n  }\n}\n";
    expect(countTryCatchEmpty(failSoft)).toBe(1);
    expect(countTryCatchEmpty(logged)).toBe(1);
    expect(countTryCatchEmpty(rethrow)).toBe(0);
    expect(countTryCatchEmpty(braceInString)).toBe(1);
    expect('await this.prisma.x.findMany().catch(() => []);'.match(PROMISE_CATCH_EMPTY)?.length).toBe(1);
  });
});
```

FILE: apps/api/src/common/filters/global-exception.filter.ts

```typescript
import {
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { ErrorCode, type ApiErrorResponse, type ValidationErrorDetail } from '@wlct/shared-types';
import { redact } from '@wlct/utils';

import { AppException } from '../errors/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Single exit point for every unhandled error.
 *
 * Guarantees:
 *   - the response body always matches {@link ApiErrorResponse};
 *   - stack traces and internal context never reach the client;
 *   - 5xx responses are logged at error level with full (redacted) context, so
 *     an operator can correlate a user-reported requestId with the root cause.
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: AppConfigService,
    @InjectPinoLogger(GlobalExceptionFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<AppRequest>();
    const response = ctx.getResponse();

    const resolved = this.resolveException(exception);

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: resolved.code,
        message: resolved.message,
        statusCode: resolved.statusCode,
        ...(resolved.details ? { details: resolved.details } : {}),
      },
      meta: {
        requestId: request?.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
        version: this.config.defaultApiVersion,
      },
    };

    const logContext = {
      event: 'request.failed',
      requestId: request?.requestId,
      tenantId: request?.tenantContext?.tenantId,
      userId: request?.actor?.userId,
      method: request?.method,
      path: request?.originalUrl?.split('?')[0],
      statusCode: resolved.statusCode,
      errorCode: resolved.code,
      context: resolved.context ? redact(resolved.context) : undefined,
    };

    if (resolved.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { ...logContext, stack: resolved.stack },
        `Unhandled error: ${resolved.internalMessage}`,
      );
    } else if (resolved.statusCode === HttpStatus.TOO_MANY_REQUESTS) {
      this.logger.warn(logContext, 'Rate limit triggered');
    } else {
      this.logger.info(logContext, `Request rejected: ${resolved.code}`);
    }

    httpAdapter.reply(response, body, resolved.statusCode);
  }

  private resolveException(exception: unknown): {
    statusCode: number;
    code: ErrorCode | string;
    message: string;
    details?: ValidationErrorDetail[];
    context?: Record<string, unknown>;
    stack?: string;
    internalMessage: string;
  } {
    if (exception instanceof AppException) {
      const payload = exception.getResponse() as { message: string };
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: payload.message,
        details: exception.details,
        context: {
          ...(exception.context ?? {}),
          ...(exception.internalCause instanceof Error
            ? { cause: exception.internalCause.message }
            : {}),
        },
        stack: exception.stack,
        internalMessage: payload.message,
      };
    }

    const providerFailure = this.resolveExchangeProviderError(exception);
    if (providerFailure) {
      return providerFailure;
    }

    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests. Please slow down and try again shortly.',
        internalMessage: 'Throttler limit exceeded',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : ((raw as { message?: string | string[] }).message ?? exception.message);

      return {
        statusCode: status,
        code: this.mapStatusToCode(status),
        message: Array.isArray(message) ? message.join('; ') : message,
        stack: exception.stack,
        internalMessage: exception.message,
      };
    }

    // Anything else is a genuine bug: never leak its message to the client.
    const error = exception instanceof Error ? exception : new Error(String(exception));
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
      stack: error.stack,
      internalMessage: error.message,
    };
  }

  /**
   * A venue refusing a key, throttling us or being unreachable is an expected
   * outcome of talking to an exchange, not a bug in this service, so it must
   * reach the client as the matching 4xx/503 instead of a generic 500. The
   * error is recognised by name so the common layer never imports a feature
   * module, and only a fixed, safe message is returned - never the venue's
   * raw response text.
   */
  private resolveExchangeProviderError(exception: unknown): {
    statusCode: number;
    code: ErrorCode;
    message: string;
    context: Record<string, unknown>;
    stack?: string;
    internalMessage: string;
  } | null {
    if (!(exception instanceof Error) || exception.name !== 'ExchangeProviderError') {
      return null;
    }
    const providerCode = String((exception as Error & { code?: unknown }).code ?? 'UNKNOWN');
    const venue = (exception as Error & { venue?: unknown }).venue;
    const mapped = GlobalExceptionFilter.EXCHANGE_PROVIDER_ERROR_MAP[providerCode] ?? {
      code: ErrorCode.EXCHANGE_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The exchange could not be reached. Please try again shortly.',
    };
    return {
      statusCode: mapped.status,
      code: mapped.code,
      message: mapped.message,
      context: { providerCode, ...(typeof venue === 'string' ? { venue } : {}) },
      stack: exception.stack,
      internalMessage: exception.message,
    };
  }

  private static readonly EXCHANGE_PROVIDER_ERROR_MAP: Readonly<
    Record<string, { code: ErrorCode; status: number; message: string }>
  > = Object.freeze({
    AUTH_FAILED: {
      code: ErrorCode.EXCHANGE_CREDENTIALS_INVALID,
      status: HttpStatus.BAD_REQUEST,
      message: 'The exchange rejected these API credentials. Check the key, secret and environment.',
    },
    INVALID_CREDENTIALS: {
      code: ErrorCode.EXCHANGE_CREDENTIALS_INVALID,
      status: HttpStatus.BAD_REQUEST,
      message: 'The exchange rejected these API credentials. Check the key, secret and environment.',
    },
    ENVIRONMENT_MISMATCH: {
      code: ErrorCode.EXCHANGE_CREDENTIALS_INVALID,
      status: HttpStatus.BAD_REQUEST,
      message: 'These credentials belong to a different exchange environment (live vs testnet).',
    },
    PERMISSION_DENIED: {
      code: ErrorCode.EXCHANGE_PERMISSION_DENIED,
      status: HttpStatus.FORBIDDEN,
      message: 'The API key does not have the permissions this action needs.',
    },
    WITHDRAWAL_NOT_ALLOWED: {
      code: ErrorCode.EXCHANGE_PERMISSION_DENIED,
      status: HttpStatus.FORBIDDEN,
      message: 'API keys with withdrawal permission are refused. Create a key without withdrawal rights.',
    },
    NOT_SUPPORTED: {
      code: ErrorCode.EXCHANGE_NOT_SUPPORTED,
      status: HttpStatus.BAD_REQUEST,
      message: 'This exchange or feature is not supported.',
    },
    RATE_LIMITED: {
      code: ErrorCode.EXCHANGE_RATE_LIMITED,
      status: HttpStatus.TOO_MANY_REQUESTS,
      message: 'The exchange is rate limiting requests. Please try again shortly.',
    },
    NETWORK_ERROR: {
      code: ErrorCode.EXCHANGE_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The exchange could not be reached. Please try again shortly.',
    },
    TIMEOUT: {
      code: ErrorCode.EXCHANGE_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The exchange did not respond in time. Please try again shortly.',
    },
    SERVER_ERROR: {
      code: ErrorCode.EXCHANGE_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The exchange could not be reached. Please try again shortly.',
    },
    PROVIDER_UNAVAILABLE: {
      code: ErrorCode.EXCHANGE_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The exchange could not be reached. Please try again shortly.',
    },
    CLOCK_DRIFT: {
      code: ErrorCode.EXCHANGE_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The exchange refused the request because of a clock difference. Please try again shortly.',
    },
  });

  private mapStatusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.PAYLOAD_TOO_LARGE;
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return status >= 500 ? ErrorCode.INTERNAL_SERVER_ERROR : ErrorCode.BAD_REQUEST;
    }
  }
}
```

FILE: apps/api/src/common/filters/index.ts

```typescript
export * from './global-exception.filter';
export * from './prisma-exception.filter';
```

FILE: apps/api/src/common/filters/prisma-exception.filter.spec.ts

```typescript
import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { PinoLogger } from 'nestjs-pino';

import type { AppConfigService } from '../../config/app-config.service';

import { PrismaExceptionFilter, postgresSqlState } from './prisma-exception.filter';

/**
 * The P2023 fixtures are the exact code/meta/message Prisma 5.22 produced on
 * PostgreSQL 16 for `traderProfile.findFirst({ where: { id: 'not-a-uuid' } })`.
 * Before the fix this fell through to the default branch: HTTP 500 for any
 * request with a malformed id in a path parameter that has no ParseUuidPipe.
 */
describe('PrismaExceptionFilter', () => {
  function run(exception: Error) {
    const reply = jest.fn();
    const filter = new PrismaExceptionFilter(
      { httpAdapter: { reply } } as unknown as HttpAdapterHost,
      { defaultApiVersion: '1' } as unknown as AppConfigService,
      { error: jest.fn() } as unknown as PinoLogger,
    );
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ requestId: 'req-1' }), getResponse: () => ({}) }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    const [, body, status] = reply.mock.calls[0] as [unknown, { error: { code: string; message: string } }, number];
    return { status, body };
  }

  const known = (code: string, message: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '5.22.0', meta });

  const UUID_MESSAGE =
    'Error creating UUID, invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `n` at 1';

  it('maps a malformed UUID (P2023) to 400 without leaking the driver message', () => {
    const { status, body } = run(
      known('P2023', `\nInvalid \`prisma.traderProfile.findFirst()\` invocation:\n\nInconsistent column data: ${UUID_MESSAGE}`, {
        modelName: 'TraderProfile',
        message: UUID_MESSAGE,
      }),
    );
    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('A malformed identifier was supplied.');
    expect(JSON.stringify(body)).not.toContain('TraderProfile');
  });

  it('keeps other P2023 data inconsistencies as 500', () => {
    const { status } = run(known('P2023', 'Inconsistent column data: Could not convert value "abc" of the field `amount`'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('keeps the existing mappings', () => {
    expect(run(known('P2002', 'Unique constraint failed')).status).toBe(HttpStatus.CONFLICT);
    expect(run(known('P2025', 'Record not found')).status).toBe(HttpStatus.NOT_FOUND);
    expect(run(new Prisma.PrismaClientValidationError('Argument `take` is missing.', { clientVersion: '5.22.0' })).status).toBe(
      HttpStatus.BAD_REQUEST,
    );
    expect(run(known('P2010', 'Raw query failed')).status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  // Exact shape produced by Prisma 5.22 on PostgreSQL 17 (round-7 probe: FORCE ROW LEVEL SECURITY
  // on custody_wallets, insert by a NOBYPASSRLS role without app.tenant_id).
  const unknown = (sqlState: string, text: string) =>
    new Prisma.PrismaClientUnknownRequestError(
      `\nInvalid \`prisma.custodyWallet.create()\` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${sqlState}", message: "${text}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
      { clientVersion: '5.22.0' },
    );

  it('maps a row-level security rejection (SQLSTATE 42501) to 403 without leaking the table', () => {
    const { status, body } = run(unknown('42501', 'new row violates row-level security policy for table \\"custody_wallets\\"'));
    expect(status).toBe(HttpStatus.FORBIDDEN);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('The operation is not permitted in this tenant context.');
    expect(JSON.stringify(body)).not.toContain('custody_wallets');
    expect(JSON.stringify(body)).not.toContain('row-level');
  });

  it('maps serialization failures and deadlocks to 409 and statement timeouts to 503', () => {
    expect(run(unknown('40001', 'could not serialize access due to concurrent update')).status).toBe(HttpStatus.CONFLICT);
    expect(run(unknown('40P01', 'deadlock detected')).status).toBe(HttpStatus.CONFLICT);
    expect(run(unknown('57014', 'canceling statement due to statement timeout')).status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('keeps any other unknown request error a generic 500', () => {
    const { status, body } = run(unknown('22P02', 'invalid input syntax for type json'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error.message).toBe('An unexpected database error occurred.');
    expect(run(new Prisma.PrismaClientUnknownRequestError('engine said something odd', { clientVersion: '5.22.0' })).status).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('extracts the SQLSTATE and nothing else', () => {
    expect(postgresSqlState(unknown('42501', 'x'))).toBe('42501');
    expect(postgresSqlState(new Prisma.PrismaClientUnknownRequestError('no code here', { clientVersion: '5.22.0' }))).toBeUndefined();
  });
});
```

FILE: apps/api/src/common/filters/prisma-exception.filter.ts

```typescript
import { Catch, HttpStatus, Injectable, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorCode, type ApiErrorResponse } from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Translates Prisma engine errors into safe API responses.
 *
 * Database driver messages routinely contain table names, column names and
 * sometimes parameter values, so they are logged but never returned.
 */
@Injectable()
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: AppConfigService,
    @InjectPinoLogger(PrismaExceptionFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: Error, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<AppRequest>();
    const response = ctx.getResponse();

    const mapped = this.map(exception);

    this.logger.error(
      {
        event: 'database.error',
        requestId: request?.requestId,
        tenantId: request?.tenantContext?.tenantId,
        userId: request?.actor?.userId,
        prismaCode:
          exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : undefined,
        sqlState:
          exception instanceof Prisma.PrismaClientUnknownRequestError ? postgresSqlState(exception) : undefined,
        statusCode: mapped.statusCode,
        stack: exception.stack,
      },
      `Prisma error: ${exception.message.split('\n')[0]}`,
    );

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        statusCode: mapped.statusCode,
      },
      meta: {
        requestId: request?.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
        version: this.config.defaultApiVersion,
      },
    };

    httpAdapter.reply(response, body, mapped.statusCode);
  }

  private map(exception: Error): { statusCode: number; code: ErrorCode; message: string } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'A record with these details already exists.',
          };
        case 'P2003':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation references a record that does not exist.',
          };
        case 'P2025':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            code: ErrorCode.NOT_FOUND,
            message: 'The requested resource was not found.',
          };
        case 'P2023':
          // A malformed UUID in a path/query value (e.g. GET /traders/abc)
          // reaches the engine as "Inconsistent column data: Error creating
          // UUID". That is a client error; 312 path parameters across the
          // controllers have no ParseUuidPipe, and this used to be a 500.
          // Any other P2023 (stored data not matching the schema) stays a 500.
          if (isMalformedUuid(exception)) {
            return {
              statusCode: HttpStatus.BAD_REQUEST,
              code: ErrorCode.BAD_REQUEST,
              message: 'A malformed identifier was supplied.',
            };
          }
          return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'An unexpected database error occurred.',
          };
        case 'P2034':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation conflicted with a concurrent change. Please retry.',
          };
        default:
          return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'An unexpected database error occurred.',
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      // Errors the engine has no P-code for arrive here with the PostgreSQL SQLSTATE inside the
      // message (verified on PostgreSQL 17 / Prisma 5.22: an RLS WITH CHECK rejection is
      // `PostgresError { code: "42501", message: "new row violates row-level security policy
      // for table ..." }`). Only the SQLSTATE is used; the message is logged, never returned.
      switch (postgresSqlState(exception)) {
        case '42501':
          // insufficient_privilege - raised by row-level security when the row is outside the
          // transaction's tenant (app.tenant_id). Refused, never a 500 that invites retries.
          return {
            statusCode: HttpStatus.FORBIDDEN,
            code: ErrorCode.FORBIDDEN,
            message: 'The operation is not permitted in this tenant context.',
          };
        case '40001':
        case '40P01':
          // serialization_failure / deadlock_detected - the transaction lost a race.
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation conflicted with a concurrent change. Please retry.',
          };
        case '57014':
          // query_canceled - statement_timeout or an operator cancel.
          return {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            code: ErrorCode.SERVICE_UNAVAILABLE,
            message: 'The database did not answer in time. Please retry shortly.',
          };
        default:
          return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'An unexpected database error occurred.',
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'The request could not be processed due to invalid parameters.',
      };
    }

    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'The database is temporarily unavailable. Please retry shortly.',
    };
  }
}

/**
 * The PostgreSQL SQLSTATE embedded in an unknown-request error's message
 * (`PostgresError { code: "42501", ... }`), or undefined when there is none.
 */
export function postgresSqlState(exception: Prisma.PrismaClientUnknownRequestError): string | undefined {
  const match = /PostgresError\s*\{\s*code:\s*\\?"([0-9A-Z]{5})\\?"/.exec(exception.message);
  return match ? match[1] : undefined;
}

function isMalformedUuid(exception: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = exception.meta as { message?: unknown } | undefined;
  const text = `${exception.message} ${typeof meta?.message === 'string' ? meta.message : ''}`;
  return /Error creating UUID/i.test(text);
}
```

FILE: apps/api/src/common/guards/bind-tenant-params.guard.spec.ts

```typescript
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { BindTenantParamsGuard } from './bind-tenant-params.guard';

/**
 * Governance DTOs take tenantId as an ordinary body/query field. The global
 * TenantGuard binds the tenant from the verified token but never looked at
 * those fields, so any user could name another tenant. This guard pins them.
 */
function run(request: Record<string, unknown>): boolean {
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return new BindTenantParamsGuard().canActivate(context);
}

describe('BindTenantParamsGuard', () => {
  it('fills a missing tenantId in body and query with the bound tenant', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: {}, body: { reason: 'x' } };
    expect(run(request)).toBe(true);
    expect(request.query).toEqual({ tenantId: 't-1' });
    expect(request.body).toEqual({ reason: 'x', tenantId: 't-1' });
  });

  it('treats null and empty string as missing, so an optional field never means "all tenants"', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: { tenantId: '' }, body: { tenantId: null } };
    run(request);
    expect(request.query.tenantId).toBe('t-1');
    expect(request.body.tenantId).toBe('t-1');
  });

  it('rejects another tenant in the body', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: {}, body: { tenantId: 't-2' } };
    expect(() => run(request)).toThrow(ForbiddenException);
  });

  it('rejects another tenant in the query', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: { tenantId: 't-2' }, body: {} };
    expect(() => run(request)).toThrow(ForbiddenException);
  });

  it('passes a matching tenantId unchanged', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: { tenantId: 't-1' }, body: { tenantId: 't-1' } };
    expect(run(request)).toBe(true);
  });

  it('prefers the resolved tenant context (a platform operator selection) over the token tenant', () => {
    const request = {
      tenantContext: { tenantId: 't-selected' },
      actor: { tenantId: 't-home' },
      query: {},
      body: { tenantId: 't-selected' },
    };
    expect(run(request)).toBe(true);
    expect(request.query).toEqual({ tenantId: 't-selected' });
  });

  it('falls back to the actor tenant and refuses when there is no tenant at all', () => {
    const withActor = { actor: { tenantId: 't-home' }, query: {}, body: {} };
    run(withActor);
    expect(withActor.body).toEqual({ tenantId: 't-home' });
    expect(() => run({ query: {}, body: {} })).toThrow(ForbiddenException);
  });

  it('leaves array and non-object bodies alone', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: {}, body: ['a'] };
    expect(run(request)).toBe(true);
    expect(request.body).toEqual(['a']);
  });
});
```

FILE: apps/api/src/common/guards/bind-tenant-params.guard.ts

```typescript
import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AppRequest } from '../types/request.types';

/**
 * Binds `tenantId` in the request body and query string to the tenant the
 * global TenantGuard resolved from the verified token (or, for platform
 * operators, the tenant they explicitly selected).
 *
 * Some controllers take `tenantId` as an ordinary body/query field and hand it
 * straight to their services. Without this guard, any authenticated user could
 * name another tenant's id and act on that tenant's data. With it:
 * - a `tenantId` that differs from the bound tenant is rejected (403);
 * - a missing `tenantId` is filled in with the bound tenant, so an optional
 *   field can never mean "all tenants".
 *
 * Apply with `@UseGuards(BindTenantParamsGuard)` only on controllers whose
 * body/query DTOs declare `tenantId` (the filled value must pass
 * whitelist validation). Controller-level guards run after the global
 * JwtAuthGuard/TenantGuard/PermissionsGuard and before validation pipes.
 */
@Injectable()
export class BindTenantParamsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    const bound = request.tenantContext?.tenantId ?? request.actor?.tenantId;
    if (!bound) throw new ForbiddenException('Tenant context required');

    this.bind(request.query as unknown, bound, 'query');
    this.bind(request.body as unknown, bound, 'body');
    return true;
  }

  private bind(container: unknown, tenantId: string, where: 'query' | 'body'): void {
    if (container === null || typeof container !== 'object' || Array.isArray(container)) return;
    const record = container as Record<string, unknown>;
    const supplied = record.tenantId;
    if (supplied === undefined || supplied === null || supplied === '') {
      record.tenantId = tenantId;
      return;
    }
    if (supplied !== tenantId) {
      throw new ForbiddenException(`tenantId in ${where} does not match the authenticated tenant`);
    }
  }
}
```

FILE: apps/api/src/common/guards/controller-authorization.spec.ts

```typescript
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { Permission, SYSTEM_ROLE_DEFINITIONS, SystemRole } from '@wlct/shared-types';
import { PermissionsGuard } from '../../modules/auth/guards/permissions.guard';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, PLATFORM_ONLY_KEY } from '../constants/metadata.constants';
import { BindTenantParamsGuard } from './bind-tenant-params.guard';
import { GovernanceController } from '../../modules/governance/governance.controller';
import { PartnerController } from '../../modules/partners/partner.controller';
import { OperationsController } from '../../modules/operations/operations.controller';
import { OmsController } from '../../modules/oms/oms.controller';
import { RiskManagementController } from '../../modules/risk-management/risk.controller';
import { BillingNotificationController } from '../../modules/billing/notifications/billing-notification.controller';
import { ProviderController } from '../../modules/providers/provider.controller';
import { ResearchController } from '../../modules/research/research.controller';
import { WebhookController } from '../../modules/billing/payments/webhook.controller';
import { SsoAuthController } from '../../modules/auth/sso/sso-auth.controller';
import { DeveloperController } from '../../modules/developer-platform/developer.controller';

/**
 * Authorization audit (round 4). Every controller below used to carry no
 * permission metadata at all, so each of its routes was open to any
 * authenticated user of any role (and, where tenantId came from the body or
 * query, of any tenant): a FOLLOWER could execute GDPR deletions, release
 * legal holds, trigger partner payouts, enter maintenance mode, rewrite the
 * risk policy, clear kill switches, disable providers or publish research
 * signals. The payment webhooks had the opposite defect: without @Public()
 * the global JwtAuthGuard answered 401 to every Stripe/NowPayments callback.
 *
 * These tests drive the real PermissionsGuard with the real system role
 * definitions against every route of the real controllers.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Ctor = abstract new (...args: never[]) => object;

interface Route {
  controller: Ctor;
  handler: string;
  method: Method;
  path: string;
}

const METHOD_NAMES: Partial<Record<RequestMethod, Method>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

function handlers(controller: Ctor): Record<string, object> {
  return controller.prototype as unknown as Record<string, object>;
}

function routesOf(controller: Ctor): Route[] {
  const proto = handlers(controller);
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const fn = proto[name];
      if (typeof fn !== 'function') return null;
      const rawPath = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
      if (rawPath === undefined || method === undefined) return null;
      const path = rawPath === '/' ? '' : rawPath.replace(/^\//, '');
      return { controller, handler: name, method: METHOD_NAMES[method] ?? 'GET', path } as Route;
    })
    .filter((r): r is Route => r !== null);
}

function route(controller: Ctor, method: Method, path: string): Route {
  const found = routesOf(controller).find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`route ${method} ${path} missing on ${controller.name}`);
  return found;
}

interface Actor {
  userId: string;
  tenantId: string;
  isPlatformUser: boolean;
  roles: string[];
  permissions: string[];
}

const TENANT_ROLES: SystemRole[] = [
  SystemRole.TENANT_ADMIN,
  SystemRole.TRADER,
  SystemRole.FOLLOWER,
  SystemRole.SUPPORT,
  SystemRole.FINANCE,
  SystemRole.COMPLIANCE,
];

function roleActor(role: SystemRole): Actor {
  const def = SYSTEM_ROLE_DEFINITIONS.find((d) => d.key === role);
  if (!def) throw new Error(`role ${role} missing`);
  return {
    userId: `user-${role}`,
    tenantId: 'tenant-1',
    isPlatformUser: role === SystemRole.SUPER_ADMIN,
    roles: [role],
    permissions: [...def.permissions] as string[],
  };
}

/** Holds every permission but is not platform staff: PlatformOnly must still refuse it. */
const WILDCARD_TENANT_USER: Actor = {
  userId: 'user-wildcard',
  tenantId: 'tenant-1',
  isPlatformUser: false,
  roles: ['CUSTOM'],
  permissions: ['*'],
};

async function allowed(r: Route, actor: Actor | undefined): Promise<boolean> {
  const guard = new PermissionsGuard(
    new Reflector(),
    {
      getEffectiveAccess: async () => ({
        permissionKeys: actor?.permissions ?? [],
        roleKeys: actor?.roles ?? [],
      }),
    } as never,
    { record: async () => undefined } as never,
  );
  const request = {
    actor: actor ? { ...actor, permissions: [...actor.permissions], roles: [...actor.roles] } : undefined,
    headers: {},
    originalUrl: `/api/v1/${r.path}`,
    method: r.method,
    tenantContext: actor ? { tenantId: actor.tenantId } : undefined,
  };
  const context = {
    getType: () => 'http',
    getHandler: () => handlers(r.controller)[r.handler],
    getClass: () => r.controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch {
    return false;
  }
}

/** Tenant roles (never platform) the guard lets through, sorted. */
async function tenantRolesAllowed(r: Route): Promise<SystemRole[]> {
  const out: SystemRole[] = [];
  for (const role of TENANT_ROLES) {
    if (await allowed(r, roleActor(role))) out.push(role);
  }
  return out.sort();
}

function sorted(...roles: SystemRole[]): SystemRole[] {
  return [...roles].sort();
}

const { TENANT_ADMIN: TA, TRADER: TR, FOLLOWER: FO, SUPPORT: SU, FINANCE: FI, COMPLIANCE: CO } = SystemRole;
const SUPER_ADMIN = roleActor(SystemRole.SUPER_ADMIN);

const AUDITED: Array<{ controller: Ctor; routeCount: number; followerRoutes: Array<[Method, string]> }> = [
  { controller: GovernanceController, routeCount: 47, followerRoutes: [] },
  { controller: PartnerController, routeCount: 47, followerRoutes: [] },
  {
    controller: OperationsController,
    routeCount: 48,
    followerRoutes: [['GET', 'maintenance/current']],
  },
  { controller: OmsController, routeCount: 35, followerRoutes: [] },
  { controller: RiskManagementController, routeCount: 28, followerRoutes: [] },
  {
    controller: BillingNotificationController,
    routeCount: 18,
    followerRoutes: [
      ['GET', 'inbox'],
      ['GET', 'inbox/unread-count'],
      ['PUT', 'inbox/:id/read'],
      ['PUT', 'inbox/read-all'],
      ['GET', 'preferences'],
      ['PUT', 'preferences'],
      ['PUT', 'preferences/bulk'],
    ],
  },
  { controller: ProviderController, routeCount: 11, followerRoutes: [] },
  { controller: ResearchController, routeCount: 51, followerRoutes: [] },
];

describe('controller authorization (audited controllers)', () => {
  describe.each(AUDITED)('$controller.name', ({ controller, routeCount, followerRoutes }) => {
    const routes = routesOf(controller);

    it('exposes the expected number of routes (a new route must be classified here)', () => {
      expect(routes).toHaveLength(routeCount);
    });

    it('carries explicit permission metadata on every route', () => {
      const reflector = new Reflector();
      const open = routes.filter((r) => {
        const targets = [handlers(controller)[r.handler] as () => void, controller];
        const required = reflector.getAllAndOverride<unknown>(PERMISSIONS_KEY, targets);
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        return required === undefined && isPublic !== true;
      });
      expect(open.map((r) => `${r.method} ${r.path}`)).toEqual([]);
    });

    it('lets a FOLLOWER reach only the self-service routes', async () => {
      const follower = roleActor(FO);
      const reachable: string[] = [];
      for (const r of routes) {
        if (await allowed(r, follower)) reachable.push(`${r.method} ${r.path}`);
      }
      expect(reachable.sort()).toEqual(followerRoutes.map(([m, p]) => `${m} ${p}`).sort());
    });

    it('still lets platform super admins through every route', async () => {
      for (const r of routes) {
        expect(await allowed(r, SUPER_ADMIN)).toBe(true);
      }
    });
  });

  describe('governance (GDPR, retention, legal holds, regulatory reports)', () => {
    it('reads need compliance:read (COMPLIANCE only; TENANT_ADMIN deliberately lacks compliance:*)', async () => {
      expect(await tenantRolesAllowed(route(GovernanceController, 'GET', 'privacy-requests'))).toEqual([CO]);
      expect(await tenantRolesAllowed(route(GovernanceController, 'GET', 'legal-holds/active'))).toEqual([CO]);
    });

    it('writes need compliance:write', async () => {
      expect(await tenantRolesAllowed(route(GovernanceController, 'POST', 'privacy-requests'))).toEqual([CO]);
      expect(await tenantRolesAllowed(route(GovernanceController, 'POST', 'legal-holds'))).toEqual([CO]);
    });

    it.each([
      'privacy-requests/:id/deletion-execute',
      'retention/:id/action',
      'legal-holds/:id/release',
      'reports/:id/certification/:certId/certify',
      'evidence-packages/:id/finalize',
    ])('irreversible step %s needs compliance:write AND compliance:reviewer', async (path) => {
      const r = route(GovernanceController, 'POST', path);
      expect(await tenantRolesAllowed(r)).toEqual([CO]);
      const writerOnly: Actor = { ...roleActor(CO), permissions: [Permission.COMPLIANCE_WRITE] };
      const reviewerOnly: Actor = { ...roleActor(CO), permissions: [Permission.COMPLIANCE_REVIEWER] };
      expect(await allowed(r, writerOnly)).toBe(false);
      expect(await allowed(r, reviewerOnly)).toBe(false);
    });

    it('audit export needs compliance:read AND audit_log:read', async () => {
      const r = route(GovernanceController, 'POST', 'audit/export');
      const readOnly: Actor = { ...roleActor(CO), permissions: [Permission.COMPLIANCE_READ] };
      expect(await allowed(r, readOnly)).toBe(false);
      expect(await tenantRolesAllowed(r)).toEqual([CO]);
    });

    it('binds body/query tenantId to the authenticated tenant', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, GovernanceController) as unknown[] | undefined;
      expect(guards).toContain(BindTenantParamsGuard);
    });
  });

  describe('partners (platform reseller programme)', () => {
    it('refuses every tenant role and a wildcard non-platform user on every route', async () => {
      for (const r of routesOf(PartnerController)) {
        expect(await tenantRolesAllowed(r)).toEqual([]);
        expect(await allowed(r, WILDCARD_TENANT_USER)).toBe(false);
      }
    });

    it('reads accept platform:read_metrics, payouts and transfers need platform:manage', async () => {
      const metricsOnly: Actor = { ...SUPER_ADMIN, permissions: [Permission.PLATFORM_READ_METRICS] };
      expect(await allowed(route(PartnerController, 'GET', ':id/payouts'), metricsOnly)).toBe(true);
      expect(await allowed(route(PartnerController, 'GET', ''), metricsOnly)).toBe(true);
      expect(await allowed(route(PartnerController, 'POST', ':id/payouts'), metricsOnly)).toBe(false);
      expect(await allowed(route(PartnerController, 'POST', ':id/tenants/transfer'), metricsOnly)).toBe(false);
      expect(Reflect.getMetadata(PLATFORM_ONLY_KEY, PartnerController)).toBe(true);
    });
  });

  describe('operations', () => {
    it('reads need operations:read', async () => {
      expect(await tenantRolesAllowed(route(OperationsController, 'GET', 'incidents'))).toEqual(sorted(TA, SU, CO));
      expect(await tenantRolesAllowed(route(OperationsController, 'GET', 'recovery/runs'))).toEqual(sorted(TA, SU, CO));
    });

    it.each([
      ['POST', 'maintenance/enter'],
      ['POST', 'maintenance/exit'],
      ['POST', 'recovery/runs/:id/execute'],
      ['POST', 'degradations/clear'],
      ['POST', 'incidents/:id/resolve'],
    ] as Array<[Method, string]>)('%s %s needs operations:alerts_update (TENANT_ADMIN)', async (m, p) => {
      expect(await tenantRolesAllowed(route(OperationsController, m, p))).toEqual([TA]);
    });

    it('the customer maintenance notice is open to every signed-in role', async () => {
      expect(await tenantRolesAllowed(route(OperationsController, 'GET', 'maintenance/current'))).toEqual(
        sorted(...TENANT_ROLES),
      );
    });

    it('declares maintenance/current before maintenance/:id so Express matches the static segment', () => {
      const order = routesOf(OperationsController).map((r) => `${r.method} ${r.path}`);
      expect(order.indexOf('GET maintenance/current')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('GET maintenance/current')).toBeLessThan(order.indexOf('GET maintenance/:id'));
    });
  });

  describe('oms (no ownership checks, so no customer access)', () => {
    it('tenant-wide order data needs trading:read or compliance:read', async () => {
      for (const p of ['intents', 'fills', 'trades', 'orders', 'audit', 'allocations']) {
        expect(await tenantRolesAllowed(route(OmsController, 'GET', p))).toEqual(sorted(TA, CO));
      }
    });

    it.each([
      ['POST', 'intents'],
      ['POST', 'intents/:id/route'],
      ['POST', 'orders/cancel'],
      ['POST', 'orders/replace'],
      ['POST', 'operational/recovery'],
      ['POST', 'post-trade/:intentId'],
    ] as Array<[Method, string]>)('%s %s needs trading:manage', async (m, p) => {
      expect(await tenantRolesAllowed(route(OmsController, m, p))).toEqual([TA]);
    });
  });

  describe('risk-management (mirrors /risk)', () => {
    it('reads need risk:read', async () => {
      expect(await tenantRolesAllowed(route(RiskManagementController, 'GET', 'dashboard'))).toEqual(
        sorted(TA, TR, SU, CO),
      );
    });

    it('policy changes need risk:config:update', async () => {
      expect(await tenantRolesAllowed(route(RiskManagementController, 'POST', 'policy'))).toEqual([TA]);
    });

    it('trigger/request/acknowledge need risk:kill_switch_update', async () => {
      for (const p of ['breaker/trigger', 'breaker/:id/acknowledge', 'kill-switch/request', 'kill-switch/:id/acknowledge']) {
        expect(await tenantRolesAllowed(route(RiskManagementController, 'POST', p))).toEqual(sorted(TA, TR, CO));
      }
    });

    it('clearing a breaker or kill switch needs risk:protection_clear', async () => {
      for (const p of ['breaker/:id/clear', 'kill-switch/:id/clear']) {
        expect(await tenantRolesAllowed(route(RiskManagementController, 'POST', p))).toEqual([TA]);
      }
    });

    it('the pre-trade check needs execution:submit or risk:config:update', async () => {
      expect(await tenantRolesAllowed(route(RiskManagementController, 'POST', 'check'))).toEqual(sorted(TA, TR));
    });
  });

  describe('billing notifications', () => {
    it('history needs subscription:read or invoice:read', async () => {
      expect(await tenantRolesAllowed(route(BillingNotificationController, 'GET', 'history'))).toEqual(
        sorted(TA, SU, FI),
      );
    });

    it('outbound webhook subscriptions need tenant:update', async () => {
      for (const [m, p] of [
        ['GET', 'webhooks'],
        ['POST', 'webhooks'],
        ['POST', 'webhooks/:id/rotate-secret'],
        ['DELETE', 'webhooks/:id'],
      ] as Array<[Method, string]>) {
        expect(await tenantRolesAllowed(route(BillingNotificationController, m, p))).toEqual([TA]);
      }
    });

    it('worker and cross-tenant reconciliation are platform-only', async () => {
      for (const [m, p] of [
        ['POST', 'worker/process'],
        ['GET', 'worker/stuck'],
        ['GET', 'reconciliation/:tenantId'],
        ['POST', 'reconciliation/all'],
      ] as Array<[Method, string]>) {
        const r = route(BillingNotificationController, m, p);
        expect(await tenantRolesAllowed(r)).toEqual([]);
        expect(await allowed(r, WILDCARD_TENANT_USER)).toBe(false);
      }
    });
  });

  describe('providers', () => {
    it('is platform-only', async () => {
      for (const r of routesOf(ProviderController)) {
        expect(await tenantRolesAllowed(r)).toEqual([]);
        expect(await allowed(r, WILDCARD_TENANT_USER)).toBe(false);
      }
      const metricsOnly: Actor = { ...SUPER_ADMIN, permissions: [Permission.PLATFORM_READ_METRICS] };
      expect(await allowed(route(ProviderController, 'GET', 'health'), metricsOnly)).toBe(true);
      expect(await allowed(route(ProviderController, 'POST', 'actions/enable-disable'), metricsOnly)).toBe(false);
    });
  });

  describe('research', () => {
    it.each([
      ['POST', 'datasets', [TA]],
      ['GET', 'datasets', [TA, TR, SU, CO]],
      ['POST', 'datasets/:datasetId/validate', [TA]],
      ['GET', 'market-data/candles', [TA, TR, SU, CO]],
      ['POST', 'backtests', [TA, TR]],
      ['POST', 'backtests/monte-carlo', [TA, TR]],
      ['GET', 'backtests/:runId', [TA, TR, CO]],
      ['POST', 'paper-sessions/:sessionId/orders', [TA, TR]],
      ['GET', 'paper-sessions', [TA, TR, SU, CO]],
      ['GET', 'strategy-versions/:versionId', [TA, TR, CO]],
      ['POST', 'strategy-versions/:versionId/publish', [TA, TR]],
      ['POST', 'signals/:signalId/publish', [TA, TR]],
      ['GET', 'signals', [TA, TR, CO]],
      ['POST', 'promotions/:promotionId/request', [TA, TR]],
      ['POST', 'promotions/:promotionId/approve', [TA]],
      ['POST', 'promotions/:promotionId/promote', [TA]],
    ] as Array<[Method, string, SystemRole[]]>)('%s %s', async (m, p, roles) => {
      expect(await tenantRolesAllowed(route(ResearchController, m, p))).toEqual(sorted(...roles));
    });
  });

  describe('payment webhooks', () => {
    it('Stripe and NowPayments callbacks pass the guards without a user (signature is the authentication)', async () => {
      for (const p of ['stripe', 'nowpayments']) {
        const r = route(WebhookController, 'POST', p);
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlers(WebhookController)[r.handler])).toBe(true);
        expect(await allowed(r, undefined)).toBe(true);
      }
    });

    it('the signature-bypassing test endpoint is not public and is platform-only', async () => {
      const r = route(WebhookController, 'POST', 'stripe/test');
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlers(WebhookController)[r.handler])).toBeUndefined();
      expect(await allowed(r, undefined)).toBe(false);
      expect(await allowed(r, WILDCARD_TENANT_USER)).toBe(false);
      expect(await tenantRolesAllowed(r)).toEqual([]);
      expect(await allowed(r, SUPER_ADMIN)).toBe(true);
    });
  });
});

describe('handler identity fixes', () => {
  function billingController(overrides: Record<string, unknown> = {}) {
    const inApp = {
      listNotifications: jest.fn(async () => []),
      getUnreadCount: jest.fn(async () => 0),
      markRead: jest.fn(async () => ({ ok: true })),
      markAllRead: jest.fn(async () => ({ count: 0 })),
    };
    const prefs = {
      getPreferences: jest.fn(async () => []),
      updatePreference: jest.fn(async () => ({})),
      updatePreferencesBulk: jest.fn(async () => []),
    };
    const ctrl = new BillingNotificationController(
      {} as never,
      prefs as never,
      {} as never,
      {} as never,
      {} as never,
      inApp as never,
    );
    Object.assign(ctrl, overrides);
    return { ctrl, inApp, prefs };
  }

  const followerReq = (extra: Record<string, unknown> = {}) => ({
    user: { userId: 'user-7', tenantId: 'tenant-1', permissions: roleActor(FO).permissions, isPlatformUser: false },
    ...extra,
  });

  it('billing inbox uses the actor userId (it used to read user.id and resolve every inbox to "unknown")', async () => {
    const { ctrl, inApp } = billingController();
    const res = await ctrl.getInbox(followerReq(), {} as never);
    expect(inApp.listNotifications).toHaveBeenCalledWith('tenant-1', 'user-7', expect.any(Object));
    expect(res.userId).toBe('user-7');
    await ctrl.markAllRead(followerReq());
    expect(inApp.markAllRead).toHaveBeenCalledWith('tenant-1', 'user-7');
  });

  it('refuses to guess a user when the actor has no userId', async () => {
    const { ctrl, inApp } = billingController();
    await expect(ctrl.getUnreadCount({ user: { tenantId: 'tenant-1' } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(inApp.getUnreadCount).not.toHaveBeenCalled();
  });

  it('preference writes are scoped to the caller', async () => {
    const { ctrl, prefs } = billingController();
    await ctrl.updatePreference(followerReq(), { eventKey: 'invoice.paid', channel: 'EMAIL', enabled: false } as never);
    expect(prefs.updatePreference).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-7' }));
  });

  it("reading another user's preferences needs tenant:update", async () => {
    const { ctrl, prefs } = billingController();
    await expect(ctrl.getPreferences(followerReq(), 'user-other')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prefs.getPreferences).not.toHaveBeenCalled();

    await ctrl.getPreferences(followerReq(), 'user-7');
    expect(prefs.getPreferences).toHaveBeenLastCalledWith('tenant-1', 'user-7');

    const admin = {
      user: { userId: 'admin-1', tenantId: 'tenant-1', permissions: roleActor(TA).permissions, isPlatformUser: false },
    };
    await ctrl.getPreferences(admin, 'user-other');
    expect(prefs.getPreferences).toHaveBeenLastCalledWith('tenant-1', 'user-other');
  });

  it('developer-portal audit entries are attributed to the real user, not "system"', () => {
    const ctrl = Object.create(DeveloperController.prototype) as {
      actor: (tenantId: string, request: unknown) => { actorId: string; actorType: string };
    };
    const result = ctrl.actor('tenant-1', { user: { userId: 'user-9' }, headers: {}, id: 'req-1' });
    expect(result.actorId).toBe('user-9');
    expect(result.actorType).toBe('USER');
  });

  it('the SSO routes (moved to modules/auth/sso in Part 11) take the tenant only from the host and pass no client-supplied tenant or user through', async () => {
    const complete = jest.fn(async () => ({ result: { tokens: { accessToken: 'a' }, user: { id: 'user-1' }, sessionId: 's' }, returnTo: null }));
    const start = jest.fn(async () => ({ providerType: 'OIDC', authorizationUrl: 'https://idp/authorize', bindingToken: 'b', expiresIn: 600 }));
    const ctrl = new SsoAuthController({ complete, start } as never);
    const tenant = { tenantId: 'tenant-host', slug: 'acme', status: 'ACTIVE', source: 'subdomain', defaultLocale: 'en', defaultCurrency: 'USD' };
    const meta = { requestId: 'r', correlationId: 'c', ipHash: 'ip', ip: '1.2.3.4', userAgent: 'ua', locale: 'en', method: 'POST', path: '/' };
    const forgedBody = { state: 's', code: 'c', bindingToken: 'b', deviceId: 'd', tenantId: 'tenant-evil', userId: 'admin-1' };
    await ctrl.callback(forgedBody as never, tenant as never, meta as never);
    const [tenantArg, input] = complete.mock.calls[0] as unknown as [{ tenantId: string }, Record<string, unknown>];
    expect(tenantArg.tenantId).toBe('tenant-host');
    expect(input).not.toHaveProperty('tenantId');
    expect(input).not.toHaveProperty('userId');
    await ctrl.start({ providerType: 'OIDC', deviceId: 'd', tenantId: 'tenant-evil' } as never, tenant as never, meta as never);
    expect((start.mock.calls[0] as unknown as [{ tenantId: string }])[0].tenantId).toBe('tenant-host');

    // All three are public (no JWT yet) and on a strict throttle.
    for (const method of ['start', 'callback', 'samlAcs'] as const) {
      const handler = SsoAuthController.prototype[method];
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadataKeys(handler).some((key: unknown) => String(key).startsWith('THROTTLER:LIMIT'))).toBe(true);
    }
  });

  it('the SAML ACS answers 303 to the configured completion URI, or a generic 401 when the login is unknown', async () => {
    const consumeSamlResponse = jest
      .fn()
      .mockResolvedValueOnce({ redirectTo: 'https://acme.app.test/api/auth/sso/callback?state=s&code=h' })
      .mockResolvedValueOnce({ redirectTo: null });
    const ctrl = new SsoAuthController({ consumeSamlResponse } as never);
    const res = () => {
      const r: Record<string, jest.Mock> = {};
      r.setHeader = jest.fn(() => r);
      r.redirect = jest.fn(() => r);
      r.status = jest.fn(() => r);
      r.json = jest.fn(() => r);
      return r;
    };
    const tenant = { tenantId: 'tenant-host' };
    const meta = { requestId: 'r', ipHash: 'ip', userAgent: 'ua', locale: 'en' };
    const ok = res();
    await ctrl.samlAcs({ body: { SAMLResponse: 'x', RelayState: 's', tenantId: 'evil' } } as never, ok as never, tenant as never, meta as never);
    expect(consumeSamlResponse).toHaveBeenLastCalledWith(tenant, { SAMLResponse: 'x', RelayState: 's' }, expect.any(Object));
    expect(ok.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(ok.redirect).toHaveBeenCalledWith(303, 'https://acme.app.test/api/auth/sso/callback?state=s&code=h');
    const unknown = res();
    await ctrl.samlAcs({ body: {} } as never, unknown as never, tenant as never, meta as never);
    expect(unknown.status).toHaveBeenCalledWith(401);
    expect(unknown.redirect).not.toHaveBeenCalled();
    expect(JSON.stringify(unknown.json.mock.calls)).not.toMatch(/tenant|user|exist/i);
  });
});
```

FILE: apps/api/src/common/guards/feature-flag.guard.ts

```typescript
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { FEATURE_FLAG_KEY } from '../constants/metadata.constants';
import { FeatureDisabledException } from '../errors/app.exception';
import { FeatureFlagsService } from '../../modules/feature-flags/feature-flags.service';
import type { AppRequest } from '../types/request.types';

/**
 * Enforces `@RequireFeature('flag_key')`. Flags are evaluated per tenant and
 * cached in Redis, so the hot path is a single cache lookup rather than a
 * database query. No latency figure is claimed or guaranteed.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flagKey = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!flagKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AppRequest>();
    const tenantId = request.tenantContext?.tenantId;

    if (!tenantId) {
      throw new FeatureDisabledException(flagKey);
    }

    const enabled = await this.featureFlags.isEnabled(tenantId, flagKey);
    if (!enabled) {
      throw new FeatureDisabledException(flagKey);
    }

    return true;
  }
}
```

FILE: apps/api/src/common/guards/index.ts

```typescript
export * from './throttler-behind-proxy.guard';
export * from './feature-flag.guard';
export * from './internal-service.guard';
```

FILE: apps/api/src/common/guards/internal-service.guard.ts

```typescript
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { HEADER_INTERNAL_TOKEN } from '@wlct/config';
import { safeCompare } from '@wlct/utils';
import { ErrorCode } from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import { AppException } from '../errors/app.exception';
import type { AppRequest } from '../types/request.types';

/**
 * Protects endpoints that only internal services (trading engine, market data,
 * notification worker) may call. In production this sits behind mTLS as well;
 * the shared token is the application-layer second factor.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const header = request.headers[HEADER_INTERNAL_TOKEN];
    const token = Array.isArray(header) ? header[0] : header;

    if (!token || !safeCompare(token, this.config.internalServiceToken)) {
      throw new AppException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Internal service authentication failed.',
      });
    }

    return true;
  }
}
```

FILE: apps/api/src/common/guards/request-principal.spec.ts

```typescript
import { ForbiddenException } from '@nestjs/common';
import {
  authPermissions,
  authRoles,
  authTenantId,
  authTenantIdOrNull,
  authUserIdOrNull,
  isPlatformPrincipal,
  principal,
  resolveTargetTenant,
  hasAdminRole,
} from './request-principal';

/** Shape produced by JwtStrategy.validate. */
function jwtUser(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      userId: 'user-1',
      tenantId: 'tenant-a',
      sessionId: 's',
      roles: ['TENANT_ADMIN'],
      permissions: ['risk:read'],
      isPlatformUser: false,
      tokenId: 'j',
      ...overrides,
    },
    headers: { 'x-tenant-id': 'tenant-b' },
    query: { tenantId: 'tenant-b' },
  };
}

describe('request-principal', () => {
  it('takes the tenant from the token and ignores x-tenant-id / query', () => {
    expect(authTenantId(jwtUser())).toBe('tenant-a');
  });

  it('refuses a request whose token carries no tenant, even with a header', () => {
    const req = { user: { userId: 'u' }, headers: { 'x-tenant-id': 'tenant-b' } };
    expect(() => authTenantId(req as any)).toThrow(ForbiddenException);
    expect(authTenantIdOrNull(req as any)).toBeNull();
    expect(() => authTenantId({ headers: { 'x-tenant-id': 'tenant-b' } } as any)).toThrow(
      'Tenant context required',
    );
  });

  it('reads userId from the JWT principal and the legacy id/sub shapes', () => {
    expect(authUserIdOrNull(jwtUser())).toBe('user-1');
    expect(authUserIdOrNull({ user: { id: 'legacy' } })).toBe('legacy');
    expect(authUserIdOrNull({ user: { sub: 'subject' } })).toBe('subject');
    expect(authUserIdOrNull({ user: {} })).toBeNull();
    expect(authUserIdOrNull(undefined)).toBeNull();
  });

  it('platform reach is the server-side flag only', () => {
    expect(isPlatformPrincipal(jwtUser({ isPlatformUser: true }))).toBe(true);
    // TENANT_ADMIN contains "admin"; a tenant can also create a role literally
    // named PLATFORM_ADMIN. Neither may unlock other tenants.
    expect(isPlatformPrincipal(jwtUser({ roles: ['TENANT_ADMIN'] }))).toBe(false);
    expect(isPlatformPrincipal(jwtUser({ roles: ['PLATFORM_ADMIN', 'platform_admin'] }))).toBe(
      false,
    );
    expect(
      isPlatformPrincipal(jwtUser({ permissions: ['platform:manage', 'PLATFORM_MANAGE'] })),
    ).toBe(false);
    expect(isPlatformPrincipal(jwtUser({ isPlatformUser: 'true' }))).toBe(false);
  });

  it('resolveTargetTenant: own tenant by default, cross-tenant only for platform', () => {
    expect(resolveTargetTenant(jwtUser())).toBe('tenant-a');
    expect(resolveTargetTenant(jwtUser(), 'tenant-a')).toBe('tenant-a');
    expect(() => resolveTargetTenant(jwtUser(), 'tenant-b')).toThrow('Cross-tenant access refused');
    expect(resolveTargetTenant(jwtUser({ isPlatformUser: true }), 'tenant-b')).toBe('tenant-b');
    expect(() => resolveTargetTenant({ user: { userId: 'u' } })).toThrow('Tenant context required');
  });

  it('normalises role and permission lists', () => {
    expect(
      authRoles({ user: { roles: ['A', { key: 'B' }, { role: { key: 'C' } }, 7, null] } }),
    ).toEqual(['A', 'B', 'C']);
    expect(authPermissions({ user: { permissions: 'not-a-list' } })).toEqual([]);
  });

  it('principal() requires both tenant and user', () => {
    expect(principal(jwtUser())).toEqual({
      tenantId: 'tenant-a',
      userId: 'user-1',
      roles: ['TENANT_ADMIN'],
      permissions: ['risk:read'],
      isPlatformUser: false,
    });
    expect(() => principal({ user: { tenantId: 't' } })).toThrow('Authenticated user required');
  });
});

describe('hasAdminRole', () => {
  it('accepts the canonical upper-case system role keys', () => {
    expect(hasAdminRole(['TRADER', 'TENANT_ADMIN'])).toBe(true);
    expect(hasAdminRole(['SUPER_ADMIN'])).toBe(true);
  });

  it('still accepts the legacy lower-case keys and module-specific extras', () => {
    expect(hasAdminRole(['tenant_admin'])).toBe(true);
    expect(hasAdminRole(['research_admin'])).toBe(false);
    expect(hasAdminRole(['research_admin'], ['research_admin'])).toBe(true);
  });

  it('is exact: look-alikes and non-admin roles are refused', () => {
    expect(hasAdminRole(['FOLLOWER', 'TRADER', 'SUPPORT', 'COMPLIANCE'])).toBe(false);
    expect(hasAdminRole(['Tenant_Admin', 'TENANT_ADMIN_X', 'admins'])).toBe(false);
    expect(hasAdminRole([])).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
  });
});
```

FILE: apps/api/src/common/guards/request-principal.ts

```typescript
import { ForbiddenException } from '@nestjs/common';

/**
 * Identity of the caller, read only from what the JWT strategy put on
 * `req.user` (see modules/auth/strategies/jwt.strategy.ts):
 *   { userId, tenantId, sessionId, roles, permissions, isPlatformUser, tokenId }
 *
 * Rules (docs/SECURITY.md, contributing rule 3 "never trust a client-supplied
 * tenant id"):
 *  - The tenant comes from the verified token. `x-tenant-id` headers, query
 *    strings and bodies are never a source of the caller's tenant.
 *  - "Platform" means the server-side `isPlatformUser` flag loaded from the
 *    user row. Role keys and permission strings are tenant-editable data and
 *    must not grant cross-tenant reach.
 */
export interface RequestPrincipal {
  tenantId: string;
  userId: string;
  roles: string[];
  permissions: string[];
  isPlatformUser: boolean;
}

type AnyRequest = { user?: Record<string, unknown> | null } | null | undefined;

function user(req: AnyRequest): Record<string, unknown> {
  const u = req?.user;
  return u && typeof u === 'object' ? u : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        const nested =
          e.role && typeof e.role === 'object'
            ? (e.role as Record<string, unknown>).key
            : undefined;
        return nonEmptyString(e.key) ?? nonEmptyString(nested) ?? '';
      }
      return '';
    })
    .filter((s) => s.length > 0);
}

/** Tenant of the authenticated caller, or null when the token carries none. */
export function authTenantIdOrNull(req: AnyRequest): string | null {
  return nonEmptyString(user(req).tenantId);
}

/** Tenant of the authenticated caller; 403 when absent (never a header fallback). */
export function authTenantId(req: AnyRequest): string {
  const tenantId = authTenantIdOrNull(req);
  if (!tenantId) throw new ForbiddenException('Tenant context required');
  return tenantId;
}

/** User id of the authenticated caller, or null. Accepts the legacy `id`/`sub` shapes. */
export function authUserIdOrNull(req: AnyRequest): string | null {
  const u = user(req);
  return nonEmptyString(u.userId) ?? nonEmptyString(u.id) ?? nonEmptyString(u.sub);
}

/** Server-side platform flag only. */
export function isPlatformPrincipal(req: AnyRequest): boolean {
  return user(req).isPlatformUser === true;
}

export function authRoles(req: AnyRequest): string[] {
  return stringList(user(req).roles);
}

/**
 * Administrative role check for in-controller authorisation.
 *
 * System role keys are upper case (`SystemRole` in @wlct/shared-types:
 * SUPER_ADMIN, TENANT_ADMIN). Several controllers compared against
 * lower-case keys ('admin', 'tenant_admin', 'platform_admin') that no seeded
 * role has, so real administrators were refused. Matching is exact and
 * case-sensitive on the canonical keys; the legacy lower-case keys are still
 * accepted for tenants that created custom roles with those names, and
 * `extraRoles` lets a module add its own (e.g. research_admin). Tenant scope
 * is unaffected: it always comes from the token.
 */
export const ADMIN_ROLE_KEYS: readonly string[] = ['SUPER_ADMIN', 'TENANT_ADMIN', 'admin', 'tenant_admin', 'platform_admin'];

export function hasAdminRole(roles: readonly string[] | undefined | null, extraRoles: readonly string[] = []): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((r) => ADMIN_ROLE_KEYS.includes(r) || extraRoles.includes(r));
}

export function authPermissions(req: AnyRequest): string[] {
  return stringList(user(req).permissions);
}

/**
 * Resolve the tenant a request may act on. A requested tenant different from
 * the caller's own is allowed only for platform principals; everyone else gets
 * 403. With no requested tenant, the caller's own tenant is used.
 */
export function resolveTargetTenant(req: AnyRequest, requested?: string | null): string {
  const own = authTenantIdOrNull(req);
  const wanted = nonEmptyString(requested ?? null);
  if (wanted && wanted !== own) {
    if (isPlatformPrincipal(req)) return wanted;
    throw new ForbiddenException('Cross-tenant access refused');
  }
  if (!own) throw new ForbiddenException('Tenant context required');
  return own;
}

export function principal(req: AnyRequest): RequestPrincipal {
  const userId = authUserIdOrNull(req);
  if (!userId) throw new ForbiddenException('Authenticated user required');
  return {
    tenantId: authTenantId(req),
    userId,
    roles: authRoles(req),
    permissions: authPermissions(req),
    isPlatformUser: isPlatformPrincipal(req),
  };
}
```

FILE: apps/api/src/common/guards/throttler-behind-proxy.guard.ts

```typescript
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { ErrorCode } from '@wlct/shared-types';

import { AppException } from '../errors/app.exception';
import type { AppRequest } from '../types/request.types';

/**
 * Rate limiting keyed by the real client identity rather than the proxy IP.
 *
 * Authenticated traffic is bucketed per user so one noisy customer cannot
 * exhaust a shared NAT allowance for everyone behind the same egress IP;
 * anonymous traffic falls back to the forwarded IP address.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as AppRequest;

    if (request.actor?.userId) {
      return `user:${request.actor.userId}`;
    }

    const forwarded = request.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : undefined;

    const ip = forwardedIp ?? request.ip ?? 'unknown';
    const tenantId = request.tenantContext?.tenantId ?? 'no-tenant';
    return `ip:${tenantId}:${ip}`;
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new AppException({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message: `Too many requests. Try again in ${Math.ceil(
        throttlerLimitDetail.timeToBlockExpire,
      )} seconds.`,
      context: {
        limit: throttlerLimitDetail.limit,
        ttl: throttlerLimitDetail.ttl,
      },
    });
  }
}
```

FILE: apps/api/src/common/idempotency-tenant-scope.spec.ts

```typescript
// # Verifies tenant-scoped idempotency across all repositories and Prisma lookups
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

import { InMemoryPrisma } from './__fixtures__/in-memory-prisma.fixture-spec';
import { PayoutRepository } from '../modules/billing/fees/payout.repository';
import { BillingLedgerRepository } from '../modules/billing/finance/billing-ledger.repository';
import { NotificationJobRepository } from '../modules/billing/notifications/notification-job.repository';
import { UsageEventRepository } from '../modules/billing/usage/usage-event.repository';
import { ComplianceCaseRepository } from '../modules/compliance/compliance-case.repository';
import { ClientProfileRepository } from '../modules/client-lifecycle/client-profile.repository';
import { CopyExecutionRepository } from '../modules/copy-trading/copy-execution.repository';
import { CopySubscriptionRepository } from '../modules/copy-trading/copy-subscription.repository';
import { WalletRepository } from '../modules/custody/wallet.repository';
import { AccountingEventRepository } from '../modules/portfolio-accounting/accounting-event.repository';

/**
 * Idempotency keys are scoped to the tenant (round 7, migration
 * 20260924000000_per_tenant_idempotency_keys):
 *
 *  1. behaviour - a key that tenant A already used, replayed by tenant B,
 *     creates tenant B's own row; it never returns (or mutates) tenant A's row,
 *     and it no longer fails on a platform-wide unique index. A replay by the
 *     same tenant still returns that tenant's original row.
 *  2. guard - every Prisma lookup in apps/api/src whose `where` uses an
 *     idempotency key carries `tenantId` as a TOP-LEVEL condition (inside an
 *     `OR` branch it would not scope the other branches), except the
 *     documented platform-level lookups;
 *  3. guard - schema.prisma has no field-level `idempotencyKey @unique` on a
 *     model whose tenantId is non-null; those models carry
 *     `@@unique([tenantId, idempotencyKey])`.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PER_TENANT = ['tenantId', 'idempotencyKey'];

interface ScopeCase {
  name: string;
  delegate: string;
  create: (prisma: any, tenantId: string, idempotencyKey: string, variant: string) => Promise<unknown>;
}

const CASES: ScopeCase[] = [
  {
    name: 'billing PayoutRepository.create',
    delegate: 'payout',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new PayoutRepository(prisma).create({
        settlementId: `settlement-${variant}`,
        beneficiaryId: `beneficiary-${variant}`,
        beneficiaryType: 'TRADER' as any,
        tenantId,
        amount: '10.00',
        currency: 'USD',
        destination: { type: 'BANK', reference: `dest-${variant}` } as any,
        provider: 'MANUAL' as any,
        status: 'PENDING' as any,
        idempotencyKey,
      }),
  },
  {
    name: 'billing BillingLedgerRepository.createEntry',
    delegate: 'billingLedgerEntry',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new BillingLedgerRepository(prisma).createEntry({
        tenantId,
        accountCategory: 'REVENUE' as any,
        entryType: 'CREDIT' as any,
        amount: { amount: '5.00', currency: 'USD' } as any,
        sourceType: 'INVOICE' as any,
        sourceId: `source-${variant}`,
        idempotencyKey,
        description: `entry ${variant}`,
      }),
  },
  {
    name: 'billing NotificationJobRepository.create',
    delegate: 'billingNotificationJob',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new NotificationJobRepository(prisma).create({
        tenantId,
        recipient: { email: `${variant}@demo.test` },
        eventKey: 'INVOICE_ISSUED' as any,
        channel: 'EMAIL' as any,
        templateKey: 'invoice-issued',
        locale: 'en',
        priority: 'NORMAL' as any,
        category: 'BILLING' as any,
        deliveryStatus: 'PENDING' as any,
        maxAttempts: 3,
        idempotencyKey,
        safePayload: {},
      }),
  },
  {
    name: 'billing UsageEventRepository.create',
    delegate: 'usageEvent',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new UsageEventRepository(prisma).create({
        tenantId,
        meterKey: 'api_calls' as any,
        scope: 'TENANT' as any,
        quantity: 1,
        unit: 'COUNT' as any,
        sourceType: 'test',
        sourceId: `source-${variant}`,
        sourceEventId: `event-${variant}`,
        periodId: '2026-10',
        periodType: 'MONTHLY' as any,
        periodStart: new Date('2026-10-01T00:00:00Z'),
        periodEnd: new Date('2026-11-01T00:00:00Z'),
        timestamp: new Date('2026-10-02T00:00:00Z'),
        idempotencyKey,
        processingState: 'PENDING' as any,
        dimensions: {},
      }),
  },
  {
    name: 'compliance ComplianceCaseRepository.createCase',
    delegate: 'complianceCase',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new ComplianceCaseRepository(prisma).createCase({
        tenantId,
        userId: `user-${variant}`,
        caseType: 'AML_REVIEW' as any,
        safeSummary: `case ${variant}`,
        idempotencyKey,
      }),
  },
  {
    name: 'client-lifecycle ClientProfileRepository.createProfile',
    delegate: 'clientProfile',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new ClientProfileRepository(prisma).createProfile({ tenantId, displayName: `client ${variant}`, idempotencyKey }),
  },
  {
    name: 'copy-trading CopySubscriptionRepository.create',
    delegate: 'copySubscription',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new CopySubscriptionRepository(prisma).create({
        tenantId,
        followerId: `follower-${variant}`,
        traderId: `trader-${variant}`,
        strategyId: `strategy-${variant}`,
        allocationMode: 'FIXED_AMOUNT' as any,
        allocationAmount: '100',
        idempotencyKey,
      }),
  },
  {
    name: 'copy-trading CopyExecutionRepository.create',
    delegate: 'copyExecution',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new CopyExecutionRepository(prisma).create({
        tenantId,
        leaderEventId: `leader-event-${variant}`,
        subscriptionId: `subscription-${variant}`,
        followerId: `follower-${variant}`,
        traderId: `trader-${variant}`,
        sizingMode: 'FIXED_AMOUNT' as any,
        leaderQuantity: '1',
        idempotencyKey,
      }),
  },
  {
    name: 'custody WalletRepository.createWallet',
    delegate: 'custodyWallet',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new WalletRepository(prisma).createWallet({ tenantId, assetId: `asset-${variant}`, networkId: `network-${variant}`, idempotencyKey }),
  },
  {
    name: 'portfolio-accounting AccountingEventRepository.createEvent',
    delegate: 'portfolioAccountingEvent',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new AccountingEventRepository(prisma).createEvent({
        tenantId,
        profileId: `profile-${variant}`,
        eventType: 'TRADE',
        sourceType: 'fill',
        sourceId: `fill-${variant}`,
        sourceTimestamp: new Date('2026-10-02T00:00:00Z'),
        calculationVersion: 'v1',
        policyVersion: 'v1',
        idempotencyKey,
      }),
  },
];

describe('idempotency keys are tenant-scoped', () => {
  describe.each(CASES)('$name', ({ delegate, create }) => {
    let prisma: any;

    beforeEach(() => {
      prisma = new InMemoryPrisma({ [delegate]: [PER_TENANT] });
    });

    it("creates tenant B's own row for a key tenant A already used, leaving tenant A's row untouched", async () => {
      await create(prisma, TENANT_A, 'k-shared', 'a');
      const rowA = { ...prisma.rows(delegate)[0] };
      expect(rowA).toMatchObject({ tenantId: TENANT_A, idempotencyKey: 'k-shared' });

      await create(prisma, TENANT_B, 'k-shared', 'b');

      const rows = prisma.rows(delegate);
      expect(rows).toHaveLength(2);
      const rowB = rows.find((row: any) => row.tenantId === TENANT_B);
      expect(rowB).toMatchObject({ tenantId: TENANT_B, idempotencyKey: 'k-shared' });
      expect(rowB.id).not.toBe(rowA.id);
      expect(rows.find((row: any) => row.id === rowA.id)).toEqual(rowA);
    });

    it("replays the same tenant's original row for its own repeated key", async () => {
      await create(prisma, TENANT_A, 'k-shared', 'a');
      await create(prisma, TENANT_B, 'k-shared', 'b');
      const rowA = prisma.rows(delegate).find((row: any) => row.tenantId === TENANT_A);

      await create(prisma, TENANT_A, 'k-shared', 'a');

      expect(prisma.rows(delegate)).toHaveLength(2);
      expect(prisma.rows(delegate).filter((row: any) => row.tenantId === TENANT_A)).toEqual([rowA]);
    });
  });
});

describe('CopySubscriptionRepository replay vs duplicate-active rule', () => {
  const input = (idempotencyKey: string) => ({
    tenantId: TENANT_A,
    followerId: 'follower-1',
    traderId: 'trader-1',
    strategyId: 'strategy-1',
    allocationMode: 'FIXED_AMOUNT' as any,
    allocationAmount: '100',
    idempotencyKey,
  });

  it('replays the original for a retry with the same key, but still refuses a second active subscription under a new key', async () => {
    const prisma: any = new InMemoryPrisma({ copySubscription: [PER_TENANT] });
    const repo = new CopySubscriptionRepository(prisma);
    const first = await repo.create(input('k-1'));

    await expect(repo.create(input('k-1'))).resolves.toMatchObject({ id: first.id });
    await expect(repo.create(input('k-2'))).rejects.toThrow(/Duplicate active subscription/);
    expect(prisma.rows('copySubscription')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Static guards
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..', '..');
const SRC = join(API_ROOT, 'src');

/**
 * Lookups that are legitimately key-only, with the reason. Anything else that
 * filters by an idempotency key without a top-level tenantId fails the guard.
 */
const PLATFORM_LEVEL_LOOKUPS: Record<string, string> = {
  'modules/billing/saas-admin/tenant-provisioning.service.ts:tenant':
    'the tenants table itself: provisioning runs before the tenant exists, the key lives in tenant.metadata',
};

const CALL = /(?:prisma|tx|client|this\.db|db)(?:\s+as\s+any\))?\??\.\s*(\w+)\??\.(findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|findMany|upsert|update|updateMany|delete|deleteMany|count)\s*\(/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('spec.ts')) out.push(path);
  }
  return out;
}

function balanced(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/** The keys written at the top level of an object literal (`{ a, b: 1, ...c }` -> a, b). */
function topLevelKeys(objectText: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let token = '';
  for (let i = 0; i < objectText.length; i++) {
    const ch = objectText[i];
    if ('{[('.includes(ch)) {
      depth++;
      if (depth > 1) token = '';
      continue;
    }
    if ('}])'.includes(ch)) {
      if (depth === 1 && token.trim()) keys.push(token.trim());
      depth--;
      token = '';
      continue;
    }
    if (depth !== 1) continue;
    if (ch === ':' || ch === ',') {
      if (token.trim()) keys.push(token.trim());
      token = '';
      if (ch === ':') {
        // skip the value up to the next top-level comma
        let d = 0;
        let j = i + 1;
        for (; j < objectText.length; j++) {
          const c = objectText[j];
          if ('{[('.includes(c)) d++;
          else if ('}])'.includes(c)) {
            if (d === 0) break;
            d--;
          } else if (c === ',' && d === 0) break;
        }
        i = j - 1;
      }
      continue;
    }
    token += ch;
  }
  return keys.map((key) => key.replace(/^\.\.\./, '').replace(/['"]/g, '')).filter((key) => /^\w+$/.test(key));
}

interface Lookup {
  file: string;
  line: number;
  model: string;
  method: string;
  scoped: boolean;
}

function idempotencyLookups(): Lookup[] {
  const lookups: Lookup[] = [];
  for (const path of sourceFiles(SRC)) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(CALL)) {
      const argStart = (match.index ?? 0) + match[0].length - 1;
      const args = text.slice(argStart, balanced(text, argStart, '(', ')') + 1);
      const where = /where\s*:\s*\{/.exec(args);
      if (!where) continue;
      const objectStart = where.index + where[0].length - 1;
      const objectText = args.slice(objectStart, balanced(args, objectStart, '{', '}') + 1);
      if (!/idempotencyKey/.test(objectText)) continue;
      lookups.push({
        file: relative(SRC, path).split('\\').join('/'),
        line: text.slice(0, match.index).split('\n').length,
        model: match[1],
        method: match[2],
        scoped: topLevelKeys(objectText).includes('tenantId'),
      });
    }
  }
  return lookups;
}

describe('idempotency tenant-scope guards', () => {
  it('finds the idempotency lookups at all (the scanner is not silently blind)', () => {
    const lookups = idempotencyLookups();
    expect(lookups.length).toBeGreaterThanOrEqual(80);
    expect(lookups.some((l) => l.model === 'payout')).toBe(true);
    expect(lookups.some((l) => l.model === 'mobileBuild')).toBe(true);
  });

  it('topLevelKeys sees an OR-nested tenantId as NOT scoping the lookup', () => {
    expect(topLevelKeys('{ OR: [{ idempotencyKey }, { snapshotId, tenantId }] }')).toEqual(['OR']);
    expect(topLevelKeys('{ tenantId, OR: [{ idempotencyKey }, { snapshotId }] }')).toEqual(['tenantId', 'OR']);
    expect(topLevelKeys('{ tenantId: params.tenantId ?? null, idempotencyKey }')).toEqual(['tenantId', 'idempotencyKey']);
    expect(topLevelKeys("{ metadata: { path: ['a'], equals: x } }")).toEqual(['metadata']);
  });

  it('every idempotency lookup carries a top-level tenantId, except the documented platform-level ones', () => {
    const unscoped = idempotencyLookups()
      .filter((lookup) => !lookup.scoped)
      .filter((lookup) => !PLATFORM_LEVEL_LOOKUPS[`${lookup.file}:${lookup.model}`])
      .map((lookup) => `${lookup.file}:${lookup.line} ${lookup.model}.${lookup.method}`);
    expect(unscoped).toEqual([]);
  });

  it('no idempotency lookup still uses findUnique on the key alone', () => {
    const keyOnlyUnique = idempotencyLookups().filter((lookup) => /^findUnique/.test(lookup.method));
    expect(keyOnlyUnique).toEqual([]);
  });

  it('schema: tenant-owned models carry @@unique([tenantId, idempotencyKey]) instead of a global key unique', () => {
    const schema = readFileSync(join(API_ROOT, 'prisma', 'schema.prisma'), 'utf8');
    const offenders: string[] = [];
    let perTenant = 0;
    for (const model of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)) {
      const [, name, body] = model;
      const idem = /^\s+idempotencyKey\s+[^\n]*$/m.exec(body)?.[0];
      const tenant = /^\s+tenantId\s+String(\??)/m.exec(body);
      if (!idem || !tenant || tenant[1] === '?') continue;
      if (/\s@unique\b/.test(idem)) offenders.push(`${name}: field-level @unique on idempotencyKey`);
      if (/@@unique\(\[tenantId, idempotencyKey\]\)/.test(body)) perTenant++;
    }
    expect(offenders).toEqual([]);
    expect(perTenant).toBe(68);
  });

  it('the migration that moves the indexes exists and only swaps indexes', () => {
    const sql = readFileSync(
      join(API_ROOT, 'prisma', 'migrations', '20260924000000_per_tenant_idempotency_keys', 'migration.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const drops = statements.filter((statement) => /^DROP INDEX "\w+_idempotency_key_key"$/.test(statement));
    const creates = statements.filter((statement) =>
      /^CREATE UNIQUE INDEX "\w+" ON "\w+"\("tenant_id", "idempotency_key"\)$/.test(statement),
    );
    expect(drops).toHaveLength(68);
    expect(creates).toHaveLength(68);
    expect(statements).toHaveLength(136);
  });
});
```

FILE: apps/api/src/common/interceptors/audit-context.interceptor.ts

```typescript
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap, type Observable } from 'rxjs';
import { AuditActorType, AuditOutcome, type AuditAction } from '@wlct/shared-types';

import { AUDIT_ACTION_KEY } from '../constants/metadata.constants';
import { AuditService } from '../../modules/audit/audit.service';
import type { AppRequest } from '../types/request.types';

interface AuditMetadata {
  action: AuditAction;
  resourceType?: string;
}

/**
 * Emits an audit record for routes annotated with `@Audited(...)`.
 *
 * Writes are queued (BullMQ) rather than awaited so the audit trail never adds
 * latency to the request path, and a slow audit sink cannot fail a mutation.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const metadata = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AppRequest>();

    return next.handle().pipe(
      tap({
        next: (result: unknown) => {
          void this.auditService.record({
            tenantId: request.tenantContext?.tenantId ?? null,
            actorType: request.actor ? AuditActorType.USER : AuditActorType.SYSTEM,
            actorId: request.actor?.userId ?? null,
            action: metadata.action,
            outcome: AuditOutcome.SUCCESS,
            resourceType: metadata.resourceType ?? null,
            resourceId: extractResourceId(result, request),
            ipHash: request.ipHash,
            userAgent: request.headers['user-agent'] ?? null,
            requestId: request.requestId,
            correlationId: request.correlationId,
            operationId: request.requestId,
            metadata: {
              method: request.method,
              path: request.originalUrl.split('?')[0],
            },
          });
        },
        error: (error: unknown) => {
          void this.auditService.record({
            tenantId: request.tenantContext?.tenantId ?? null,
            actorType: request.actor ? AuditActorType.USER : AuditActorType.SYSTEM,
            actorId: request.actor?.userId ?? null,
            action: metadata.action,
            outcome: AuditOutcome.FAILURE,
            resourceType: metadata.resourceType ?? null,
            resourceId: typeof request.params?.id === 'string' ? request.params.id : null,
            ipHash: request.ipHash,
            userAgent: request.headers['user-agent'] ?? null,
            requestId: request.requestId,
            correlationId: request.correlationId,
            operationId: request.requestId,
            metadata: {
              method: request.method,
              path: request.originalUrl.split('?')[0],
              errorName: error instanceof Error ? error.name : 'UnknownError',
            },
          });
        },
      }),
    );
  }
}

function extractResourceId(result: unknown, request: AppRequest): string | null {
  if (result && typeof result === 'object' && 'id' in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === 'string') {
      return id;
    }
  }
  if (typeof request.params?.id === 'string') {
    return request.params.id;
  }
  return null;
}
```

FILE: apps/api/src/common/interceptors/index.ts

```typescript
export * from './response-transform.interceptor';
export * from './timeout.interceptor';
export * from './audit-context.interceptor';
```

FILE: apps/api/src/common/interceptors/response-transform.interceptor.ts

```typescript
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { ApiSuccessResponse } from '@wlct/shared-types';

import { SKIP_RESPONSE_TRANSFORM_KEY } from '../constants/metadata.constants';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Wraps every successful handler result in the platform success envelope so
 * clients can rely on one shape. Streaming/file routes opt out with
 * `@SetMetadata(SKIP_RESPONSE_TRANSFORM_KEY, true)`.
 */
@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T> | T>
{
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<T> | T> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AppRequest>();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        meta: {
          requestId: request.requestId ?? 'unknown',
          timestamp: new Date().toISOString(),
          version: this.config.defaultApiVersion,
        },
      })),
    );
  }
}
```

FILE: apps/api/src/common/interceptors/timeout.interceptor.ts

```typescript
import {
  Injectable,
  RequestTimeoutException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { throwError, timeout, catchError, type Observable, TimeoutError } from 'rxjs';

import { DEFAULT_REQUEST_TIMEOUT_MS } from '../constants/request.constants';
import { REQUEST_TIMEOUT_KEY } from '../constants/metadata.constants';

/**
 * Bounds handler execution time. Without this, a slow exchange or database call
 * can pin a worker thread and cascade into a platform-wide outage.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const configured = this.reflector.getAllAndOverride<number>(REQUEST_TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const timeoutMs = configured ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException('The request took too long to complete.'),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
```

FILE: apps/api/src/common/middleware/index.ts

```typescript
export * from './request-context.middleware';
export * from './tenant-resolution.middleware';
```

FILE: apps/api/src/common/middleware/request-context.middleware.ts

```typescript
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { HEADER_CORRELATION_ID, HEADER_REQUEST_ID } from '@wlct/config';

import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Establishes per-request context before anything else runs:
 *   - a correlation id (accepted from an upstream proxy only if it is a UUID,
 *     so a client cannot inject arbitrary text into log fields) and the same
 *     id propagated to Python services and queue payloads (Part 9);
 *   - a keyed hash of the client IP, used everywhere instead of the raw address
 *     to limit personal data retention;
 *   - the negotiated locale for i18n.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly crypto: CryptoService,
    private readonly config: AppConfigService,
  ) {}

  use(req: AppRequest, res: Response, next: NextFunction): void {
    const incomingId = req.headers[HEADER_REQUEST_ID];
    const candidate = Array.isArray(incomingId) ? incomingId[0] : incomingId;
    const requestId = candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();

    req.requestId = requestId;
    req.id = requestId;

    const incomingCorrelation = req.headers[HEADER_CORRELATION_ID];
    const correlationCandidate = Array.isArray(incomingCorrelation)
      ? incomingCorrelation[0]
      : incomingCorrelation;
    req.correlationId =
      correlationCandidate && UUID_PATTERN.test(correlationCandidate) ? correlationCandidate : requestId;
    res.setHeader(HEADER_CORRELATION_ID, req.correlationId);
    req.startTime = Date.now();
    req.ipHash = this.crypto.hashIp(req.ip ?? 'unknown');
    req.locale = this.negotiateLocale(req.headers['accept-language']);

    res.setHeader(HEADER_REQUEST_ID, requestId);

    next();
  }

  private negotiateLocale(header: string | string[] | undefined): string {
    const supported = this.config.supportedLocales;
    const fallback = this.config.defaultLocale;
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) {
      return fallback;
    }

    const ranked = raw
      .split(',')
      .map((part) => {
        const [tag, qualityPart] = part.trim().split(';q=');
        const quality = qualityPart ? Number.parseFloat(qualityPart) : 1;
        return { tag: tag.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
      })
      .sort((a, b) => b.quality - a.quality);

    for (const { tag } of ranked) {
      const base = tag.split('-')[0];
      if (supported.includes(tag)) {
        return tag;
      }
      if (supported.includes(base)) {
        return base;
      }
    }

    return fallback;
  }
}
```

FILE: apps/api/src/common/middleware/tenant-resolution.middleware.ts

```typescript
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { HEADER_TENANT_SLUG } from '@wlct/config';
import { extractSubdomain } from '@wlct/utils';

import { AppConfigService } from '../../config/app-config.service';
import { TenantResolverService } from '../../modules/tenants/tenant-resolver.service';
import type { AppRequest, TenantContext } from '../types/request.types';

/**
 * Resolves the tenant for *unauthenticated* traffic (login, registration,
 * public branding) from trustworthy transport-level signals, in priority order:
 *
 *   1. custom domain           -> app.acme-capital.com
 *   2. platform sub-domain     -> acme.copytrade.app
 *   3. X-Tenant-Slug header    -> native mobile clients that cannot use DNS
 *   4. configured default slug -> single-brand deployments
 *
 * The header is the weakest signal, so it is only honoured when it resolves to
 * an ACTIVE tenant, and any authenticated request later has this value replaced
 * by the tenant id embedded in the verified JWT (see TenantGuard). A client can
 * therefore never read another brand's data by forging a header.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantResolver: TenantResolverService,
    private readonly config: AppConfigService,
  ) {}

  async use(req: AppRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const context = await this.resolve(req);
      if (context) {
        req.tenantContext = context;
      }
    } catch {
      // Tenant resolution must never break the request pipeline; downstream
      // guards decide whether a missing tenant context is fatal for the route.
    }
    next();
  }

  private async resolve(req: AppRequest): Promise<TenantContext | null> {
    const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? '';
    const hostname = host.split(',')[0].trim().split(':')[0].toLowerCase();

    if (hostname) {
      const subdomain = extractSubdomain(hostname, this.config.platformRootDomain);
      if (subdomain) {
        const bySubdomain = await this.tenantResolver.resolveBySlug(subdomain);
        if (bySubdomain) {
          return { ...bySubdomain, source: 'subdomain' };
        }
      } else if (!this.isPlatformHost(hostname)) {
        const byDomain = await this.tenantResolver.resolveByDomain(hostname);
        if (byDomain) {
          return { ...byDomain, source: 'domain' };
        }
      }
    }

    const headerValue = req.headers[HEADER_TENANT_SLUG];
    const slug = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (slug) {
      const byHeader = await this.tenantResolver.resolveBySlug(slug.trim().toLowerCase());
      if (byHeader) {
        return { ...byHeader, source: 'header' };
      }
    }

    const fallback = await this.tenantResolver.resolveBySlug(this.config.defaultTenantSlug);
    return fallback ? { ...fallback, source: 'default' } : null;
  }

  private isPlatformHost(hostname: string): boolean {
    return (
      hostname === this.config.platformRootDomain ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local')
    );
  }
}
```

FILE: apps/api/src/common/payment-amount.spec.ts

```typescript
// # Contract-tests exact minor-unit and NOWPayments invoice amount conversions.
import { nowPaymentsInvoiceAmountToNumber, paymentAmountToMinorUnits } from './payment-amount';

describe('exact payment amount conversions', () => {
  it.each([
    ['49.99', 'USD', 4999],
    ['100', 'JPY', 100],
    ['0.00000001', 'BTC', 1],
    ['0.000000000000000001', 'ETH', 1],
    ['1.230000', 'USDT', 1230000],
    ['0.000001', 'TRX', 1],
  ])('scales %s %s to an exact safe integer', (amount, currency, expected) => {
    expect(paymentAmountToMinorUnits(amount, currency)).toBe(expected);
  });

  it('rejects precision beyond the configured currency scale instead of rounding', () => {
    expect(() => paymentAmountToMinorUnits('1.001', 'USD')).toThrow(/represent .* exactly at scale 2/);
    expect(() => paymentAmountToMinorUnits('0.0000000000000000001', 'ETH')).toThrow(/supported maximum|exactly at scale/);
  });

  it('rejects invalid currencies, negative amounts, and values beyond the safe integer range', () => {
    expect(() => paymentAmountToMinorUnits('1.00', 'UNKNOWN')).toThrow(/scale is not configured/);
    expect(() => paymentAmountToMinorUnits('-0.01', 'USD')).toThrow(/must not be negative/);
    expect(() => paymentAmountToMinorUnits('90071992547409.92', 'USD')).toThrow(/safe minor-unit range/);
    expect(() => paymentAmountToMinorUnits(1.23, 'USD')).toThrow(/exact decimal string/);
  });

  it('allows a NOWPayments invoice JSON number only when its decimal round-trip is exact', () => {
    expect(nowPaymentsInvoiceAmountToNumber('49.99')).toBe(49.99);
    expect(nowPaymentsInvoiceAmountToNumber('1.2300')).toBe(1.23);
    expect(() => nowPaymentsInvoiceAmountToNumber('1.230000000000000001')).toThrow(/losslessly/);
    expect(nowPaymentsInvoiceAmountToNumber('0.0000000000000000001')).toBe(1e-19);
    expect(() => nowPaymentsInvoiceAmountToNumber('0')).toThrow(/greater than zero/);
    expect(() => nowPaymentsInvoiceAmountToNumber(1.23)).toThrow(/exact decimal string/);
  });
});
```

FILE: apps/api/src/common/payment-amount.ts

```typescript
// # Converts payment decimal strings into exact minor units and safe provider-required numbers.
import { Decimal } from './decimal-string';

const CURRENCY_SCALE: Readonly<Record<string, number>> = Object.freeze({
  AUD: 2,
  BHD: 3,
  BIF: 0,
  BNB: 18,
  BTC: 8,
  CAD: 2,
  CLP: 0,
  DOGE: 8,
  DJF: 0,
  EUR: 2,
  GBP: 2,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  LTC: 8,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  TRX: 6,
  UGX: 0,
  USD: 2,
  USDC: 6,
  USDT: 6,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  ETH: 18,
});

/**
 * Returns a safely representable integer count of currency minor units.
 * The decimal is scaled with BigInt and rejected rather than rounded when its precision exceeds
 * the configured currency scale or the resulting integer exceeds JavaScript's exact integer range.
 */
export function paymentAmountToMinorUnits(amountValue: unknown, currencyValue: unknown): number {
  if (typeof amountValue !== 'string' || amountValue.trim() === '') {
    throw new TypeError('Payment amount must be a non-empty exact decimal string');
  }
  if (typeof currencyValue !== 'string' || currencyValue.trim() === '') {
    throw new TypeError('Payment currency must be a non-empty string');
  }

  const currency = currencyValue.trim().toUpperCase();
  const scale = CURRENCY_SCALE[currency];
  if (scale === undefined) {
    throw new TypeError(`Minor-unit scale is not configured for ${currency}`);
  }

  const amount = Decimal.parse(amountValue);
  if (amount.isNegative()) throw new TypeError('Payment amount must not be negative');
  const minorUnits = amount.toScaledBigInt(scale);
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Payment amount exceeds the exact safe minor-unit range');
  }
  return Number(minorUnits);
}

/**
 * NOWPayments' invoice endpoint requires `price_amount` to be a JSON number. This conversion is
 * permitted only when its JSON round-trip decimal is identical to the authoritative input string.
 */
export function nowPaymentsInvoiceAmountToNumber(amountValue: unknown): number {
  if (typeof amountValue !== 'string' || amountValue.trim() === '') {
    throw new TypeError('NOWPayments invoice amount must be a non-empty exact decimal string');
  }

  const exactAmount = Decimal.parse(amountValue);
  if (exactAmount.isNegative() || exactAmount.isZero()) {
    throw new TypeError('NOWPayments invoice amount must be greater than zero');
  }

  const numericAmount = Number(exactAmount.toString());
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new RangeError('NOWPayments invoice amount is outside the supported JSON number range');
  }
  if (!Decimal.parse(numericAmount.toString()).eq(exactAmount)) {
    throw new RangeError('NOWPayments invoice amount cannot be represented losslessly as a JSON number');
  }
  return numericAmount;
}
```

FILE: apps/api/src/common/pipes/global-validation.pipe.ts

```typescript
import { Injectable, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { ValidationErrorDetail } from '@wlct/shared-types';

import { ValidationException } from '../errors/app.exception';

/**
 * Global class-validator pipe for DTO based endpoints.
 *
 * Hardening choices:
 *   - `whitelist` strips unknown properties (mass-assignment protection).
 *   - `forbidNonWhitelisted` rejects requests that try to send them at all.
 *   - `transform` produces real class instances so `@Type` conversions apply.
 *   - errors are flattened into the platform's ValidationErrorDetail contract.
 */
@Injectable()
export class GlobalValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
      validationError: { target: false, value: false },
      exceptionFactory: (errors: ValidationError[]) =>
        new ValidationException(flattenValidationErrors(errors)),
    });
  }
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationErrorDetail[] {
  const details: ValidationErrorDetail[] = [];

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      for (const [constraint, message] of Object.entries(error.constraints)) {
        details.push({ field: path, constraint, message });
      }
    }

    if (error.children && error.children.length > 0) {
      details.push(...flattenValidationErrors(error.children, path));
    }
  }

  return details;
}
```

FILE: apps/api/src/common/pipes/index.ts

```typescript
export * from './global-validation.pipe';
export * from './zod-validation.pipe';
export * from './parse-uuid.pipe';
```

FILE: apps/api/src/common/pipes/parse-uuid.pipe.ts

```typescript
import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ValidationException } from '../errors/app.exception';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates UUID route parameters before they reach Prisma. Postgres raises a
 * type error for malformed uuids, which would otherwise surface as a 500.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new ValidationException([
        {
          field: metadata.data ?? 'id',
          constraint: 'isUuid',
          message: 'Must be a valid UUID',
        },
      ]);
    }
    return value.toLowerCase();
  }
}
```

FILE: apps/api/src/common/pipes/zod-validation.pipe.ts

```typescript
import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodSchema } from 'zod';
import type { ValidationErrorDetail } from '@wlct/shared-types';

import { ValidationException } from '../errors/app.exception';

/**
 * Runs a zod schema over an incoming payload and converts failures into the
 * platform's standard validation error envelope.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new ValidationException(toValidationDetails(result.error));
  }
}

export function toValidationDetails(error: ZodError): ValidationErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    constraint: issue.code,
    message: issue.message,
  }));
}
```

FILE: apps/api/src/common/rate-limit/rate-limit.module.ts

```typescript
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Distributed rate limiting.
 *
 * Counters live in Redis so the limit is enforced across every API replica -
 * an in-memory limiter would let an attacker multiply their allowance by the
 * number of pods behind the load balancer.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService, RedisService],
      useFactory: (config: AppConfigService, redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.rateLimitTtlSeconds * 1000,
            limit: config.rateLimitEnabled ? config.rateLimitMax : Number.MAX_SAFE_INTEGER,
          },
          {
            name: 'auth',
            ttl: config.rateLimitAuthTtlSeconds * 1000,
            limit: config.rateLimitEnabled ? config.rateLimitAuthMax : Number.MAX_SAFE_INTEGER,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
        // Health probes and internal traffic bypass the limiter.
        skipIf: (context) => {
          const request = context.switchToHttp().getRequest<{ path?: string; ip?: string }>();
          const path = request?.path ?? '';
          if (path.startsWith('/health')) {
            return true;
          }
          return false;
        },
        errorMessage: 'Too many requests. Please slow down and try again shortly.',
      }),
    }),
  ],
  providers: [RedisThrottlerStorage],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
```

FILE: apps/api/src/common/rate-limit/redis-throttler.storage.ts

```typescript
import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

import { RedisService } from '../../infrastructure/redis/redis.service';

/**
 * Redis backed sliding-window counter for @nestjs/throttler.
 *
 * The increment and the TTL are applied in one round trip; the block key is a
 * separate short-lived entry so a blocked caller stays blocked even if their
 * window counter expires.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.client;
    const counterKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    const blockTtl = await client.pttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockTtl / 1000),
      };
    }

    const pipeline = client.multi();
    pipeline.incr(counterKey);
    pipeline.pttl(counterKey);
    const results = await pipeline.exec();

    const totalHits = Number(results?.[0]?.[1] ?? 1);
    let remainingTtl = Number(results?.[1]?.[1] ?? -1);

    if (remainingTtl < 0) {
      await client.pexpire(counterKey, ttl);
      remainingTtl = ttl;
    }

    if (totalHits > limit) {
      const effectiveBlock = blockDuration > 0 ? blockDuration : ttl;
      await client.set(blockKey, '1', 'PX', effectiveBlock);
      return {
        totalHits,
        timeToExpire: Math.ceil(remainingTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(effectiveBlock / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(remainingTtl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
```

FILE: apps/api/src/common/types/request.types.ts

```typescript
import type { Request } from 'express';
import type { AuthenticatedActor } from '@wlct/shared-types';

export interface TenantContext {
  tenantId: string;
  slug: string;
  status: string;
  /** How the tenant was identified; useful for auditing spoof attempts. */
  source: 'jwt' | 'domain' | 'subdomain' | 'header' | 'default';
  defaultLocale: string;
  defaultCurrency: string;
}

/** Express request enriched by the middleware/guard pipeline. */
export interface AppRequest extends Request {
  requestId: string;
  /** Part 9: cross-service correlation id. Always set - the middleware
   *  accepts an inbound x-correlation-id only when it is a UUID and
   *  otherwise mints one, exactly like requestId. */
  correlationId: string;
  startTime: number;
  ipHash: string;
  locale: string;
  tenantContext?: TenantContext;
  actor?: AuthenticatedActor;
}
```

FILE: apps/api/src/config/app-config.module.ts

```typescript
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { validateEnvironment } from './env.validation';

/**
 * Loads and validates environment configuration exactly once, then exposes it
 * through a strongly typed service.
 *
 * The rule this module exists to enforce is that no other file reads
 * `process.env` unvalidated - and it has exactly two exceptions, both of which
 * describe the built artefact rather than the deployment: `APP_VERSION` and
 * `GIT_COMMIT_SHA`, read in `modules/health/health.service.ts`. They are absent
 * from this schema on purpose (a build stamp is not a configuration knob, and a
 * default here would fabricate a commit that never happened), they are documented
 * in the root `.env.example`, and `apps/api/src/config/env-example-coverage.spec.ts`
 * refuses a third exception silently appearing: any direct `process.env` read
 * outside this package must be either a schema key or named in that file. The
 * sentence used to read "Nothing else in the codebase reads `process.env`
 * directly", which had been untrue for two of them.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
      validate: validateEnvironment,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService, ConfigModule],
})
export class AppConfigModule {}
```

FILE: apps/api/src/config/app-config.service.ts

```typescript
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv, NodeEnvironment } from '@wlct/config';
import { parseDurationToMs, parseDurationToSeconds } from '@wlct/utils';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls?: Record<string, never>;
  keyPrefix: string;
  maxRetriesPerRequest: number | null;
  enableReadyCheck: boolean;
}

/**
 * Typed, memoised accessor over the validated environment.
 *
 * Every consumer depends on this class instead of `ConfigService.get(...)`,
 * which removes stringly-typed lookups and gives a single place to derive
 * computed values (durations in ms, Redis connection objects, CORS validators).
 */
@Injectable()
export class AppConfigService {
  private readonly env: AppEnv;

  constructor(private readonly configService: ConfigService) {
    // `validate()` in AppConfigModule has already coerced and checked every
    // variable, so reads go through ConfigService to pick up the parsed values
    // (numbers, booleans, arrays) rather than the raw strings in process.env.
    this.env = new Proxy({} as AppEnv, {
      get: (_target, property: string | symbol) =>
        typeof property === 'string' ? this.configService.get(property) : undefined,
    }) as AppEnv;
  }

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------

  get nodeEnv(): NodeEnvironment {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get appName(): string {
    return this.env.APP_NAME;
  }

  get port(): number {
    return this.env.API_PORT;
  }

  get host(): string {
    return this.env.API_HOST;
  }

  get globalPrefix(): string {
    return this.env.API_GLOBAL_PREFIX;
  }

  get defaultApiVersion(): string {
    return this.env.API_DEFAULT_VERSION;
  }

  get publicUrl(): string {
    return this.env.API_PUBLIC_URL;
  }

  get adminWebUrl(): string {
    return this.env.ADMIN_WEB_URL;
  }

  get trustProxyHops(): number {
    return this.env.TRUST_PROXY_HOPS;
  }

  get platformRootDomain(): string {
    return this.env.PLATFORM_ROOT_DOMAIN;
  }

  get defaultTenantSlug(): string {
    return this.env.DEFAULT_TENANT_SLUG;
  }

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get databaseLogQueries(): boolean {
    return this.env.DATABASE_LOG_QUERIES;
  }

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------

  get redisOptions(): RedisConnectionOptions {
    return {
      host: this.env.REDIS_HOST,
      port: this.env.REDIS_PORT,
      password: this.env.REDIS_PASSWORD || undefined,
      db: this.env.REDIS_DB,
      tls: this.env.REDIS_TLS ? {} : undefined,
      keyPrefix: this.env.REDIS_KEY_PREFIX,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  }

  /**
   * BullMQ requires `maxRetriesPerRequest: null` and no key prefix collisions.
   *
   * The prefix is stripped by rebuilding the object rather than by destructuring
   * it away: an unused binding is dead weight the linter is right to flag, and
   * naming the retained fields makes it obvious that dropping `keyPrefix` is the
   * whole point of the method.
   */
  get queueRedisOptions(): Omit<RedisConnectionOptions, 'keyPrefix'> {
    const options = this.redisOptions;
    return {
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      tls: options.tls,
      maxRetriesPerRequest: options.maxRetriesPerRequest,
      enableReadyCheck: options.enableReadyCheck,
    };
  }

  get redisKeyPrefix(): string {
    return this.env.REDIS_KEY_PREFIX;
  }

  // ---------------------------------------------------------------------------
  // JWT
  // ---------------------------------------------------------------------------

  get jwtAlgorithm(): AppEnv['JWT_ALGORITHM'] {
    return this.env.JWT_ALGORITHM;
  }

  get jwtUsesAsymmetricKeys(): boolean {
    return this.env.JWT_ALGORITHM.startsWith('RS');
  }

  get jwtAccessSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtAccessVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtRefreshSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get jwtRefreshVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get accessTokenTtl(): string {
    return this.env.JWT_ACCESS_TTL;
  }

  get accessTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_ACCESS_TTL);
  }

  get refreshTokenTtl(): string {
    return this.env.JWT_REFRESH_TTL;
  }

  get refreshTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_REFRESH_TTL);
  }

  get refreshTokenTtlMs(): number {
    return parseDurationToMs(this.env.JWT_REFRESH_TTL);
  }

  get jwtIssuer(): string {
    return this.env.JWT_ISSUER;
  }

  get jwtAudience(): string {
    return this.env.JWT_AUDIENCE;
  }

  get maxActiveSessionsPerUser(): number {
    return this.env.MAX_ACTIVE_SESSIONS_PER_USER;
  }

  // ---------------------------------------------------------------------------
  // Password & account protection
  // ---------------------------------------------------------------------------

  get passwordMinLength(): number {
    return this.env.PASSWORD_MIN_LENGTH;
  }

  get argon2Options(): { memoryCost: number; timeCost: number; parallelism: number } {
    return {
      memoryCost: this.env.ARGON2_MEMORY_COST,
      timeCost: this.env.ARGON2_TIME_COST,
      parallelism: this.env.ARGON2_PARALLELISM,
    };
  }

  get loginMaxFailedAttempts(): number {
    return this.env.LOGIN_MAX_FAILED_ATTEMPTS;
  }

  get loginFailedWindowSeconds(): number {
    return this.env.LOGIN_FAILED_WINDOW_SECONDS;
  }

  get accountLockoutSeconds(): number {
    return this.env.ACCOUNT_LOCKOUT_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // Encryption
  // ---------------------------------------------------------------------------

  get encryptionMasterKeyBase64(): string {
    return this.env.ENCRYPTION_MASTER_KEY_BASE64;
  }

  get encryptionKeyId(): string {
    return this.env.ENCRYPTION_KEY_ID;
  }

  get encryptionPreviousKeys(): Record<string, string> {
    return this.env.ENCRYPTION_PREVIOUS_KEYS_JSON ?? {};
  }

  get encryptionProvider(): 'local' | 'kms' {
    return this.env.ENCRYPTION_PROVIDER;
  }

  get blindIndexKeyBase64(): string {
    return this.env.BLIND_INDEX_KEY_BASE64;
  }

  // ---------------------------------------------------------------------------
  // Two factor
  // ---------------------------------------------------------------------------

  get twoFactorIssuer(): string {
    return this.env.TWO_FACTOR_ISSUER;
  }

  get twoFactorWindow(): number {
    return this.env.TWO_FACTOR_WINDOW;
  }

  get twoFactorDigits(): number {
    return this.env.TWO_FACTOR_DIGITS;
  }

  get twoFactorPeriod(): number {
    return this.env.TWO_FACTOR_PERIOD;
  }

  get twoFactorRecoveryCodeCount(): number {
    return this.env.TWO_FACTOR_RECOVERY_CODES;
  }

  get twoFactorChallengeTtl(): string {
    return this.env.TWO_FACTOR_CHALLENGE_TTL;
  }

  get twoFactorChallengeTtlSeconds(): number {
    return parseDurationToSeconds(this.env.TWO_FACTOR_CHALLENGE_TTL);
  }

  get twoFactorMaxChallengeAttempts(): number {
    return this.env.TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS;
  }

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  get corsEnabled(): boolean {
    return this.env.CORS_ENABLED;
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS;
  }

  get corsCredentials(): boolean {
    return this.env.CORS_CREDENTIALS;
  }

  get corsAllowedHeaders(): string[] {
    return this.env.CORS_ALLOWED_HEADERS;
  }

  get corsExposedHeaders(): string[] {
    return this.env.CORS_EXPOSED_HEADERS;
  }

  /**
   * Allows configured origins plus any tenant custom domain that resolves under
   * the platform root domain. Unknown origins are rejected rather than echoed.
   */
  get corsOriginValidator(): (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => void {
    const allowList = new Set(this.corsOrigins);
    const rootDomain = this.platformRootDomain;
    const allowAnyInDev = !this.isProduction;

    return (origin, callback) => {
      if (!origin) {
        // Same-origin, curl, and mobile apps send no Origin header.
        callback(null, true);
        return;
      }
      if (allowList.has(origin)) {
        callback(null, true);
        return;
      }
      try {
        const { hostname, protocol } = new URL(origin);
        if (protocol === 'https:' && (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`))) {
          callback(null, true);
          return;
        }
        if (allowAnyInDev && (hostname === 'localhost' || hostname === '127.0.0.1')) {
          callback(null, true);
          return;
        }
      } catch {
        callback(null, false);
        return;
      }
      callback(null, false);
    };
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  get rateLimitEnabled(): boolean {
    return this.env.RATE_LIMIT_ENABLED;
  }

  get rateLimitTtlSeconds(): number {
    return this.env.RATE_LIMIT_TTL_SECONDS;
  }

  get rateLimitMax(): number {
    return this.env.RATE_LIMIT_MAX;
  }

  get rateLimitAuthTtlSeconds(): number {
    return this.env.RATE_LIMIT_AUTH_TTL_SECONDS;
  }

  get rateLimitAuthMax(): number {
    return this.env.RATE_LIMIT_AUTH_MAX;
  }

  get rateLimitTrustedIps(): string[] {
    return this.env.RATE_LIMIT_TRUSTED_IPS;
  }

  // ---------------------------------------------------------------------------
  // Swagger
  // ---------------------------------------------------------------------------

  get swaggerEnabled(): boolean {
    return this.env.SWAGGER_ENABLED;
  }

  get swaggerPath(): string {
    return this.env.SWAGGER_PATH;
  }

  get swaggerTitle(): string {
    return this.env.SWAGGER_TITLE;
  }

  get swaggerDescription(): string {
    return this.env.SWAGGER_DESCRIPTION;
  }

  get swaggerVersion(): string {
    return this.env.SWAGGER_VERSION;
  }

  get swaggerCredentials(): { user?: string; password?: string } {
    return { user: this.env.SWAGGER_USER, password: this.env.SWAGGER_PASSWORD };
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  get logLevel(): AppEnv['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get logFormat(): 'json' | 'pretty' {
    return this.env.LOG_FORMAT;
  }

  get logRequestBody(): boolean {
    return this.env.LOG_REQUEST_BODY;
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  get wsEnabled(): boolean {
    return this.env.WS_ENABLED;
  }

  get wsPath(): string {
    return this.env.WS_PATH;
  }

  get wsNamespace(): string {
    return this.env.WS_NAMESPACE;
  }

  get wsPingIntervalMs(): number {
    return this.env.WS_PING_INTERVAL_MS;
  }

  get wsPingTimeoutMs(): number {
    return this.env.WS_PING_TIMEOUT_MS;
  }

  get wsMaxConnectionsPerUser(): number {
    return this.env.WS_MAX_CONNECTIONS_PER_USER;
  }

  get wsRedisAdapterEnabled(): boolean {
    return this.env.WS_REDIS_ADAPTER;
  }

  // ---------------------------------------------------------------------------
  // Queues
  // ---------------------------------------------------------------------------

  get queuePrefix(): string {
    return this.env.QUEUE_PREFIX;
  }

  get queueDefaultAttempts(): number {
    return this.env.QUEUE_DEFAULT_ATTEMPTS;
  }

  get queueBackoffMs(): number {
    return this.env.QUEUE_BACKOFF_MS;
  }

  get queueRemoveOnComplete(): number {
    return this.env.QUEUE_REMOVE_ON_COMPLETE;
  }

  get queueRemoveOnFail(): number {
    return this.env.QUEUE_REMOVE_ON_FAIL;
  }

  get queueConcurrency(): number {
    return this.env.QUEUE_CONCURRENCY;
  }

  get queueRunInlineWorkers(): boolean {
    return this.env.QUEUE_RUN_INLINE_WORKERS;
  }

  // ---------------------------------------------------------------------------
  // Part 11: trading-worker plane + read-replica policy
  // ---------------------------------------------------------------------------

  get workerEnabled(): boolean {
    return this.env.WORKER_ENABLED;
  }

  private workerIdMemo: string | null = null;

  /** Composed identity when not configured; set WORKER_ID per replica in the
   * deployment so a restart reclaims its own partition claims.
   *
   * MEMOIZED on purpose: the composition contains a fresh UUID, and several
   * consumers compare this id across calls (claim value round-trips, the
   * registry self-check "did my ping list ME"). A getter that returned a
   * new identity per read would make every such comparison false - the
   * worker would never see itself in its own fleet. Within one process the
   * identity is a constant; across restarts it is not. */
  get workerId(): string {
    if (this.workerIdMemo !== null) {
      return this.workerIdMemo;
    }
    const configured = this.env.WORKER_ID;
    const composed =
      configured !== undefined && configured.length > 0
        ? configured
        : `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.workerIdMemo = composed;
    return composed;
  }

  /** Config-declared fleet membership for the partition assignment; empty
   * means this single worker. Ordering is irrelevant by construction (the
   * assignment math sorts). */
  get workerMembership(): string[] {
    const raw = this.env.WORKER_MEMBERSHIP;
    const listed = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return listed.length > 0 ? listed : [this.workerId];
  }

  /** Which source drives live membership: config-declared list (Part 11)
   * or the Redis self-registration registry (Part 12). Read defensively:
   * the schema enum is the gate, and anything unrecognised boots as
   * 'config' - the pre-Part-12 behaviour - rather than throwing from a
   * hot getter the coordination loop cannot survive. */
  get workerMembershipMode(): 'config' | 'registry' {
    return this.env.WORKER_MEMBERSHIP_MODE === 'registry' ? 'registry' : 'config';
  }

  get workerMembershipTtlMs(): number {
    return this.env.WORKER_MEMBERSHIP_TTL_MS;
  }

  get workerPartitionCount(): number {
    return this.env.WORKER_PARTITION_COUNT;
  }

  get workerPartitionLeaseTtlMs(): number {
    return this.env.WORKER_PARTITION_LEASE_TTL_MS;
  }

  get workerPartitionRetryMs(): number {
    return this.env.WORKER_PARTITION_RETRY_MS;
  }

  get workerDeferDelayMs(): number {
    return this.env.WORKER_DEFER_DELAY_MS;
  }

  get workerMaxDefers(): number {
    return this.env.WORKER_MAX_DEFERS;
  }

  get workerShutdownTimeoutMs(): number {
    return this.env.WORKER_SHUTDOWN_TIMEOUT_MS;
  }

  get executionEngineUrl(): string {
    return this.env.EXECUTION_ENGINE_URL;
  }

  /** Secret: readable only where it is needed, never logged, never echoed
   * into a response - the same discipline as every token on this service. */
  get executionEngineToken(): string | undefined {
    return this.env.EXECUTION_ENGINE_TOKEN;
  }

  get databaseReadEnabled(): boolean {
    return this.env.DATABASE_READ_ENABLED;
  }

  get databaseReadUrl(): string | undefined {
    return this.env.DATABASE_READ_URL;
  }

  get databaseReadMaxLagMs(): number {
    return this.env.DATABASE_READ_MAX_LAG_MS;
  }

  // ---------------------------------------------------------------------------
  // Exchanges and internal services
  // ---------------------------------------------------------------------------

  get enabledExchanges(): string[] {
    return this.env.EXCHANGES_ENABLED;
  }

  get exchangeSandboxMode(): boolean {
    return this.env.EXCHANGE_SANDBOX_MODE;
  }

  get executionEnabled(): boolean {
    return this.env.EXECUTION_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Authenticated execution (Part 5)
  // ---------------------------------------------------------------------------
  // Note what is absent: there is no getter returning BINANCE_API_SECRET, or
  // any other raw credential. The API process never needs one. Credentials are
  // resolved inside the trading service's credential provider, and the only
  // thing this class exposes about them is whether a platform-level pair was
  // configured at all.

  get liveTradingEnabled(): boolean {
    return this.env.LIVE_TRADING_ENABLED;
  }

  get dryRun(): boolean {
    return this.env.DRY_RUN;
  }

  get paperTrading(): boolean {
    return this.env.PAPER_TRADING;
  }

  /**
   * The effective trading mode after all switches are combined.
   *
   * Resolution is deliberately pessimistic and the order of the checks is the
   * whole point: DRY_RUN wins over everything, then PAPER, and LIVE is only
   * reached when every switch explicitly permits it. There is no path through
   * this function where an unset variable produces LIVE.
   */
  get tradingMode(): 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE' {
    if (!this.env.EXECUTION_ENABLED) {
      return 'DISABLED';
    }
    if (this.env.DRY_RUN) {
      return 'DRY_RUN';
    }
    if (this.env.PAPER_TRADING) {
      return 'PAPER';
    }
    if (this.env.LIVE_TRADING_ENABLED) {
      return 'LIVE';
    }
    return 'DISABLED';
  }

  /** True when a platform-level venue credential pair is configured. */
  get hasPlatformExchangeCredentials(): boolean {
    return Boolean(this.env.BINANCE_API_KEY) && Boolean(this.env.BINANCE_API_SECRET);
  }

  get orderRequestTimeoutMs(): number {
    return this.env.ORDER_REQUEST_TIMEOUT_MS;
  }

  get orderReconciliationIntervalMs(): number {
    return this.env.ORDER_RECONCILIATION_INTERVAL_MS;
  }

  get privateStreamReconnectEnabled(): boolean {
    return this.env.PRIVATE_STREAM_RECONNECT_ENABLED;
  }

  get exchangeTimeSyncIntervalMs(): number {
    return this.env.EXCHANGE_TIME_SYNC_INTERVAL_MS;
  }

  get executionIdempotencyTtlSeconds(): number {
    return this.env.EXECUTION_IDEMPOTENCY_TTL_SECONDS;
  }

  get orderUnknownReconciliationDelayMs(): number {
    return this.env.ORDER_UNKNOWN_RECONCILIATION_DELAY_MS;
  }

  /**
   * Everything the admin UI is allowed to know about execution configuration.
   * Booleans and durations only - assembled explicitly rather than by spreading
   * the env object, so a credential can never be added to the response by
   * accident later.
   */
  get executionSafetySummary(): {
    executionEnabled: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    liveTradingEnabled: boolean;
    dryRun: boolean;
    paperTrading: boolean;
    sandboxMode: boolean;
    platformCredentialsConfigured: boolean;
    orderRequestTimeoutMs: number;
    orderReconciliationIntervalMs: number;
    orderUnknownReconciliationDelayMs: number;
    exchangeTimeSyncIntervalMs: number;
    executionIdempotencyTtlSeconds: number;
    privateStreamReconnectEnabled: boolean;
  } {
    return {
      executionEnabled: this.executionEnabled,
      tradingMode: this.tradingMode,
      liveTradingEnabled: this.liveTradingEnabled,
      dryRun: this.dryRun,
      paperTrading: this.paperTrading,
      sandboxMode: this.exchangeSandboxMode,
      platformCredentialsConfigured: this.hasPlatformExchangeCredentials,
      orderRequestTimeoutMs: this.orderRequestTimeoutMs,
      orderReconciliationIntervalMs: this.orderReconciliationIntervalMs,
      orderUnknownReconciliationDelayMs: this.orderUnknownReconciliationDelayMs,
      exchangeTimeSyncIntervalMs: this.exchangeTimeSyncIntervalMs,
      executionIdempotencyTtlSeconds: this.executionIdempotencyTtlSeconds,
      privateStreamReconnectEnabled: this.privateStreamReconnectEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy engine, paper trading and backtesting (Part 6)
  // ---------------------------------------------------------------------------
  // None of these getters can enable live trading. `strategyEngineEnabled`
  // says whether strategies run; where their signals may go is still decided
  // by `tradingMode` above, which is unchanged by anything in this section.

  get strategyEngineEnabled(): boolean {
    return this.env.STRATEGY_ENGINE_ENABLED;
  }

  get paperTradingEnabled(): boolean {
    return this.env.PAPER_TRADING_ENABLED;
  }

  get backtestEnabled(): boolean {
    return this.env.BACKTEST_ENABLED;
  }

  get strategyEventQueueSize(): number {
    return this.env.STRATEGY_EVENT_QUEUE_SIZE;
  }

  get strategyMaxInstances(): number {
    return this.env.STRATEGY_MAX_INSTANCES;
  }

  /**
   * Observation budget for one strategy dispatch, in milliseconds.
   *
   * Exceeding it increments a counter and marks the dispatch slow. It is not
   * a guarantee, and this platform makes no latency guarantee of any kind.
   */
  get strategyMaxProcessingLatencyMs(): number {
    return this.env.STRATEGY_MAX_PROCESSING_LATENCY_MS;
  }

  get signalMaxAgeMs(): number {
    return this.env.SIGNAL_MAX_AGE_MS;
  }

  get signalDedupTtlSeconds(): number {
    return this.env.SIGNAL_DEDUP_TTL_SECONDS;
  }

  /**
   * Default backtest execution assumptions.
   *
   * Returned as strings, not numbers: they are exact decimals that end up in
   * Decimal arithmetic and in the configuration hash of every run, and a
   * binary float would corrupt both.
   */
  get backtestDefaults(): {
    initialCapital: string;
    makerFee: string;
    takerFee: string;
    slippageBps: string;
  } {
    return {
      initialCapital: this.env.BACKTEST_DEFAULT_INITIAL_CAPITAL,
      makerFee: this.env.BACKTEST_DEFAULT_MAKER_FEE,
      takerFee: this.env.BACKTEST_DEFAULT_TAKER_FEE,
      slippageBps: this.env.BACKTEST_DEFAULT_SLIPPAGE_BPS,
    };
  }

  /**
   * Everything the admin UI may know about the strategy layer.
   *
   * Assembled field by field for the same reason as
   * {@link executionSafetySummary}: nothing is spread in, so a credential can
   * never arrive here by accident. `liveExecutionReachable` is stated
   * explicitly so an operator can see at a glance that enabling strategies did
   * not enable live orders.
   */
  get strategySafetySummary(): {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    liveExecutionReachable: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    backtestDefaults: {
      initialCapital: string;
      makerFee: string;
      takerFee: string;
      slippageBps: string;
    };
    disclaimer: string;
  } {
    return {
      strategyEngineEnabled: this.strategyEngineEnabled,
      paperTradingEnabled: this.paperTradingEnabled,
      backtestEnabled: this.backtestEnabled,
      liveExecutionReachable: this.tradingMode === 'LIVE',
      tradingMode: this.tradingMode,
      maxInstances: this.strategyMaxInstances,
      eventQueueSize: this.strategyEventQueueSize,
      maxProcessingLatencyMs: this.strategyMaxProcessingLatencyMs,
      signalMaxAgeMs: this.signalMaxAgeMs,
      signalDedupTtlSeconds: this.signalDedupTtlSeconds,
      backtestDefaults: this.backtestDefaults,
      disclaimer:
        'Backtest and paper results are simulated. Backtest performance is ' +
        'not indicative of future performance; paper performance is not ' +
        'indicative of live performance.',
    };
  }

  // ---------------------------------------------------------------------------
  // Historical datasets (Part 7)
  // ---------------------------------------------------------------------------
  // The dataset layer is storage and integrity. None of these getters can
  // enable live trading, and none of them describe a venue connection: an
  // ingestion job reads public archives and the backtest engine reads the
  // frozen result. What the summary exposes is *why a backtest is
  // reproducible*: which storage serves datasets, whether ingestion may run,
  // and whether runs must cite a registered dataset version.

  get datasetStorage(): {
    backend: 'local';
    localRoot: string;
    stagingRoot: string;
    maxPartitionBytes: number;
    readerBufferSize: number;
    maxEventsPerPartition: number;
    maxGapWarnings: number;
    validationEnabled: boolean;
    retentionPolicy: 'retain' | 'purge_staging_only';
  } {
    return {
      backend: this.env.DATASET_STORAGE_BACKEND,
      localRoot: this.env.DATASET_LOCAL_ROOT,
      stagingRoot: this.env.DATASET_TEMP_ROOT,
      maxPartitionBytes: this.env.DATASET_MAX_PARTITION_BYTES,
      readerBufferSize: this.env.DATASET_READER_BUFFER_SIZE,
      maxEventsPerPartition: this.env.DATASET_MAX_EVENTS_PER_PARTITION,
      maxGapWarnings: this.env.DATASET_MAX_GAP_WARNINGS,
      validationEnabled: this.env.DATASET_VALIDATION_ENABLED,
      retentionPolicy: this.env.DATASET_RETENTION_POLICY,
    };
  }

  get historicalIngestionEnabled(): boolean {
    return this.env.HISTORICAL_INGESTION_ENABLED;
  }

  get backtestDatasetRequired(): boolean {
    return this.env.BACKTEST_DATASET_REQUIRED;
  }
  /**
   * Everything the admin UI may know about the dataset layer.
   *
   * Field by field for the same reason as {@link strategySafetySummary}:
   * nothing is spread in, so a credential-shaped value cannot arrive by
   * accident. There are no credentials here to begin with - historical
   * market data is public - but the assembly discipline is what keeps it
   * that way when someone adds the next field.
   */
  get datasetSafetySummary(): {
    ingestionEnabled: boolean;
    datasetRequiredForBacktests: boolean;
    storage: {
      backend: 'local';
      localRoot: string;
      stagingRoot: string;
      maxPartitionBytes: number;
      readerBufferSize: number;
      maxEventsPerPartition: number;
      maxGapWarnings: number;
      validationEnabled: boolean;
      retentionPolicy: 'retain' | 'purge_staging_only';
    };
    note: string;
  } {
    return {
      ingestionEnabled: this.historicalIngestionEnabled,
      datasetRequiredForBacktests: this.backtestDatasetRequired,
      storage: this.datasetStorage,
      note:
        'Datasets are frozen historical market data used for backtesting. ' +
        'They are not a trading input, cannot reach a venue, and a result ' +
        'computed over them is a simulation.',
    };
  }

  // ---------------------------------------------------------------------------
  // Part 8: risk engine control plane
  // ---------------------------------------------------------------------------

  get riskEngineEnabled(): boolean {
    return this.env.RISK_ENGINE_ENABLED;
  }

  get riskFailClosed(): boolean {
    return this.env.RISK_FAIL_CLOSED;
  }

  get maxRiskStateAgeMs(): number {
    return this.env.MAX_RISK_STATE_AGE_MS;
  }

  get riskSnapshotRefreshMs(): number {
    return this.env.RISK_SNAPSHOT_REFRESH_MS;
  }

  get riskEventsRetentionDays(): number {
    return this.env.RISK_EVENTS_RETENTION_DAYS;
  }

  /**
   * The platform-default ceilings this deployment publishes as the GLOBAL
   * layer of the risk hierarchy. They are strings because they are decimal
   * money all the way down: the API never runs them through Number beyond the
   * validation the env schema already performed.
   */
  get riskPlatformCeilings(): {
    maxOrderNotional: string;
    maxPositionNotional: string;
    maxAccountExposure: string;
    maxStrategyExposure: string;
    maxSymbolExposure: string;
    maxOpenOrders: number;
    maxDailyLoss: string;
    maxStrategyDailyLoss: string;
    maxDrawdownPercent: string;
    maxOrdersPerSecond: number;
    maxOrdersPerMinute: number;
    maxCancelsPerSecond: number;
    maxCancelsPerMinute: number;
    maxPriceDeviationBps: number;
    maxConsecutiveLosses: number;
  } {
    return {
      maxOrderNotional: this.env.MAX_ORDER_NOTIONAL,
      maxPositionNotional: this.env.MAX_POSITION_NOTIONAL,
      maxAccountExposure: this.env.MAX_ACCOUNT_EXPOSURE,
      maxStrategyExposure: this.env.MAX_STRATEGY_EXPOSURE,
      maxSymbolExposure: this.env.MAX_SYMBOL_EXPOSURE,
      maxOpenOrders: this.env.MAX_OPEN_ORDERS,
      maxDailyLoss: this.env.MAX_DAILY_LOSS,
      maxStrategyDailyLoss: this.env.MAX_STRATEGY_DAILY_LOSS,
      maxDrawdownPercent: this.env.MAX_DRAWDOWN,
      maxOrdersPerSecond: this.env.MAX_ORDERS_PER_SECOND,
      maxOrdersPerMinute: this.env.MAX_ORDERS_PER_MINUTE,
      maxCancelsPerSecond: this.env.MAX_CANCELS_PER_SECOND,
      maxCancelsPerMinute: this.env.MAX_CANCELS_PER_MINUTE,
      maxPriceDeviationBps: this.env.MAX_PRICE_DEVIATION_BPS,
      maxConsecutiveLosses: this.env.MAX_CONSECUTIVE_LOSSES,
    };
  }

  /**
   * The operator's single answer to "what is the risk posture of this
   * deployment, right now". Computed from configuration (the env) plus the
   * durable switch mirror, exactly like the Part 5 execution summary -
   * nothing cached, nothing assumed, and the blocking list states ALL
   * reasons at once so nobody releases a control to see whether the next
   * one was real.
   */
  get riskSafetySummary(): {
    engineEnabled: boolean;
    failClosed: boolean;
    maxRiskStateAgeMs: number;
    snapshotRefreshMs: number;
    refreshOutpacesStaleness: boolean;
    ceilings: AppConfigService['riskPlatformCeilings'];
    note: string;
  } {
    return {
      engineEnabled: this.riskEngineEnabled,
      failClosed: this.riskFailClosed,
      maxRiskStateAgeMs: this.maxRiskStateAgeMs,
      snapshotRefreshMs: this.riskSnapshotRefreshMs,
      refreshOutpacesStaleness:
        this.riskSnapshotRefreshMs < this.maxRiskStateAgeMs,
      ceilings: this.riskPlatformCeilings,
      note:
        'Risk controls reduce operational risk but cannot guarantee against ' +
        'all losses. These ceilings are the GLOBAL layer only; the effective ' +
        'limit is the tightest applicable entry across the whole hierarchy, ' +
        'resolved inside the engine. No API route approves an order.',
    };
  }

  get tradingEngineUrl(): string {
    return this.env.TRADING_ENGINE_URL;
  }

  // ------------------------------------------------------------------
  // Part 9: observability accessors. Every value here is *publication*
  // configuration; nothing in the trading path reads them, and nothing
  // here can switch a trading safety off.
  // ------------------------------------------------------------------

  get observabilityEnabled(): boolean {
    return this.configService.get<boolean>('OBSERVABILITY_ENABLED', true);
  }

  get metricsEnabled(): boolean {
    return this.configService.get<boolean>('METRICS_ENABLED', true);
  }

  get healthEnabled(): boolean {
    return this.configService.get<boolean>('HEALTH_ENABLED', true);
  }

  get prometheusEnabled(): boolean {
    return this.configService.get<boolean>('PROMETHEUS_ENABLED', true);
  }

  get prometheusPath(): string {
    return this.configService.get<string>('PROMETHEUS_PATH', '/metrics');
  }

  /** Optional scrape secret. NEVER returned by any summary and never
   *  interpolated into a log line - callers use it only for a constant-time
   *  comparison against the presented header. */
  get metricsToken(): string | undefined {
    return this.configService.get<string>('METRICS_TOKEN') ?? undefined;
  }

  get alertingEnabled(): boolean {
    return this.configService.get<boolean>('ALERTING_ENABLED', true);
  }

  get alertDedupWindowMs(): number {
    return this.configService.get<number>('ALERT_DEDUP_WINDOW_MS', 60_000);
  }

  get queueAlertAgeMs(): number {
    return this.configService.get<number>('QUEUE_ALERT_AGE_MS', 120_000);
  }

  get metricsExportIntervalMs(): number {
    return this.configService.get<number>('METRICS_EXPORT_INTERVAL_MS', 15_000);
  }

  get healthRefreshMs(): number {
    return this.configService.get<number>('HEALTH_REFRESH_MS', 5_000);
  }

  get alertRetentionDays(): number {
    return this.configService.get<number>('ALERT_RETENTION_DAYS', 90);
  }

  get incidentRetentionDays(): number {
    return this.configService.get<number>('INCIDENT_RETENTION_DAYS', 365);
  }

  /** Trading-engine ops surface: the gate documents this service publishes
   *  for the API's trading-readiness merge. Same base URL as the health
   *  probe; distinct path, so a probe outage and a telemetry outage are
   *  distinguishable in logs without a third URL to configure. */
  get tradingEngineOpsTradingUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/health/trading`;
  }

  get tradingEngineOpsComponentsUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/health/components`;
  }

  get tradingEngineOpsMetricsUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/metrics`;
  }

  get marketDataOpsComponentsUrl(): string {
    const base = this.configService.get<string>('MARKET_DATA_URL', 'http://localhost:8002');
    return `${base.replace(/\/+$/, '')}/health/components`;
  }

  /** The sentence the operations panel shows about its own guarantees.
   *  Deliberately plain: no latency claims, no uptime claims. */
  get observabilitySafetySummary(): {
    observabilityEnabled: boolean;
    metricsEnabled: boolean;
    prometheusEnabled: boolean;
    alertingEnabled: boolean;
    alertRetentionDays: number;
    incidentRetentionDays: number;
    queueAlertAgeMs: number;
    tracingEnabled: boolean;
    sloEnabled: boolean;
    note: string;
  } {
    return {
      observabilityEnabled: this.observabilityEnabled,
      metricsEnabled: this.metricsEnabled,
      prometheusEnabled: this.prometheusEnabled,
      alertingEnabled: this.alertingEnabled,
      alertRetentionDays: this.alertRetentionDays,
      incidentRetentionDays: this.incidentRetentionDays,
      queueAlertAgeMs: this.queueAlertAgeMs,
      tracingEnabled: this.otelEnabled,
      sloEnabled: this.sloEnabled,
      note:
        'Observability describes the platform; it authorises nothing. Trading ' +
        'enforcement lives in the risk gate. Risk controls reduce operational ' +
        'risk but cannot guarantee against all losses.',
    };
  }

  // --- Part 10: reliability (tracing, SLO evaluation, fault posture) ------
  // These getters READ configuration; none of them can change it. The
  // one-way derivations (priority list parsing, multiplier -> ppm) live here
  // so every consumer sees the identical integers the validator was written
  // against, and so the ppm math happens once, in integer arithmetic.

  get otelEnabled(): boolean {
    return this.env.OTEL_ENABLED === true;
  }

  /** The collector base URL, or undefined. Never logged: an OTLP URL is not
   *  secret, but a future operator might embed one, and the surface reading
   *  this only needs "configured / not configured". */
  get otelEndpoint(): string | undefined {
    return this.env.OTEL_ENDPOINT ?? undefined;
  }

  get otelTimeoutMs(): number {
    return this.env.OTEL_TIMEOUT_MS;
  }

  get otelSampleRatio(): number {
    return this.env.OTEL_SAMPLE_RATIO;
  }

  get otelPriorityOperations(): string[] {
    return this.env.OTEL_PRIORITY_OPERATIONS.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  /** Effective arming: the guards are AND-ed here because every consumer
   *  must see the SAME truth the env validator enforced - a deployment that
   *  disabled the guard gets an unarmed injector, fail-closed in both
   *  directions. */
  get failureInjectionArmed(): boolean {
    return (
      this.env.FAILURE_INJECTION_ENABLED === true &&
      this.env.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY === true &&
      this.env.NODE_ENV !== 'production'
    );
  }

  get failureInjectionRequested(): boolean {
    return this.env.FAILURE_INJECTION_ENABLED === true;
  }

  get sloEnabled(): boolean {
    return this.env.SLO_ENABLED === true;
  }

  get sloEvaluationIntervalMinutes(): number {
    return this.env.SLO_EVALUATION_INTERVAL_MINUTES;
  }

  get sloRetentionDays(): number {
    return this.env.SLO_RETENTION_DAYS;
  }

  get sloDefaultWindowMinutes(): number {
    return this.env.SLO_DEFAULT_WINDOW_MINUTES;
  }

  /** Decimal multiplier STRING -> integer ppm, exactly (14.4 -> 14_400_000).
   *  String arithmetic on purpose: `Number('14.4') * 1e6` is
   *  14400000.000000002 in IEEE-754, and a paging threshold whose rounding
   *  depends on float history is how a 3am argument starts. */
  get sloFastBurnPpm(): number {
    return AppConfigService.decimalStringToPpm(this.env.SLO_FAST_BURN_MULTIPLIER);
  }

  get sloSlowBurnPpm(): number {
    return AppConfigService.decimalStringToPpm(this.env.SLO_SLOW_BURN_MULTIPLIER);
  }

  static decimalStringToPpm(raw: string): number {
    const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
    if (!match) {
      throw new Error(`not a plain decimal multiplier: ${JSON.stringify(raw)}`);
    }
    const whole = match[1] ?? '0';
    const fraction = (match[2] ?? '').padEnd(6, '0').slice(0, 6);
    return Number(whole) * 1_000_000 + Number(fraction);
  }

  /** Tracing posture the panel renders; secret-free by construction - the
   *  endpoint is reported as a boolean, never as text. */
  get tracingSafetySummary(): {
    enabled: boolean;
    endpointConfigured: boolean;
    sampleRatio: number;
    priorityOperations: string[];
    faultInjection: { requested: boolean; armed: boolean };
    note: string;
  } {
    return {
      enabled: this.otelEnabled,
      endpointConfigured: this.otelEndpoint !== undefined,
      sampleRatio: this.otelSampleRatio,
      priorityOperations: this.otelPriorityOperations,
      faultInjection: {
        requested: this.failureInjectionRequested,
        armed: this.failureInjectionArmed,
      },
      note:
        'Tracing correlates evidence; it authorises nothing. Sampling is ' +
        'head-based and spans may be dropped under load or export failure - ' +
        'dropped is counted, never silently lost.',
    };
  }

  get tradingEngineHealthUrl(): string {
    return `${this.env.TRADING_ENGINE_URL}${this.env.TRADING_ENGINE_HEALTH_PATH}`;
  }

  get marketDataUrl(): string {
    return this.env.MARKET_DATA_URL;
  }

  get marketDataHealthUrl(): string {
    return `${this.env.MARKET_DATA_URL}${this.env.MARKET_DATA_HEALTH_PATH}`;
  }

  get notificationServiceUrl(): string {
    return this.env.NOTIFICATION_SERVICE_URL;
  }

  get notificationServiceHealthUrl(): string {
    return `${this.env.NOTIFICATION_SERVICE_URL}${this.env.NOTIFICATION_SERVICE_HEALTH_PATH}`;
  }

  get internalServiceToken(): string {
    return this.env.INTERNAL_SERVICE_TOKEN;
  }

  // ---------------------------------------------------------------------------
  // Mail / notifications
  // ---------------------------------------------------------------------------

  get mailDriver(): AppEnv['MAIL_DRIVER'] {
    return this.env.MAIL_DRIVER;
  }

  get mailFrom(): { name: string; address: string } {
    return { name: this.env.MAIL_FROM_NAME, address: this.env.MAIL_FROM_ADDRESS };
  }

  get notificationsEnabled(): boolean {
    return this.env.NOTIFICATIONS_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Localisation
  // ---------------------------------------------------------------------------

  get defaultLocale(): string {
    return this.env.DEFAULT_LOCALE;
  }

  get supportedLocales(): string[] {
    return this.env.SUPPORTED_LOCALES;
  }

  get defaultCurrency(): string {
    return this.env.DEFAULT_CURRENCY;
  }

  get supportedCurrencies(): string[] {
    return this.env.SUPPORTED_CURRENCIES;
  }

  // ---------------------------------------------------------------------------
  // Compliance / billing providers
  // ---------------------------------------------------------------------------

  get kycProvider(): AppEnv['KYC_PROVIDER'] {
    return this.env.KYC_PROVIDER;
  }

  get billingProvider(): AppEnv['BILLING_PROVIDER'] {
    return this.env.BILLING_PROVIDER;
  }

  // ---------------------------------------------------------------------------
  // Seed
  // ---------------------------------------------------------------------------

  get seedSuperAdminEmail(): string {
    return this.env.SEED_SUPER_ADMIN_EMAIL;
  }
}
```

FILE: apps/api/src/config/env-example-coverage.spec.ts

```typescript
/**
 * The environment schema and `.env.example` are one promise in two files, so they are
 * checked against each other rather than trusted separately.
 *
 * `packages/config/src/env.schema.ts` is the single source of truth for what the API and
 * the worker will boot with: an unlisted name is ignored, a listed name is validated, and
 * `apps/api/src/config/env.validation.ts` aborts the process when the two disagree with
 * reality. `.env.example` is the only place an operator learns those names exist. A part
 * that adds a schema key and forgets the example file has therefore shipped a knob nobody
 * can find - and a part that documents a name nobody reads has shipped a lie in the file
 * people copy into production. Both directions are asserted here, in the house style of
 * `infrastructure/prisma/rls-coverage.spec.ts`: re-derive the truth from the source at
 * test time instead of importing a snapshot of it that could itself drift.
 *
 * The third check exists because of what this audit actually found. `health.service.ts`
 * reads `process.env.GIT_COMMIT_SHA` directly, outside the schema - a legitimate exception,
 * since a build stamp is not a deployment knob - except that nothing in the repository set
 * it and no file named it, so `GET /v1/health` was reporting `commit: "unknown"` for a
 * reason nobody could look up. An exception that is written down is a design; an exception
 * that is only coded is how that happened.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..', '..');

const SCHEMA_SOURCE = 'packages/config/src/env.schema.ts';
const EXAMPLE_SOURCE = '.env.example';
const MODULE_SOURCE = 'apps/api/src/config/app-config.module.ts';
const VALIDATION_SOURCE = 'apps/api/src/config/env.validation.ts';
const READ_ROOTS = ['apps/api/src', 'apps/worker/src', 'services/notification-service/src'];

const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

/** The keys the schema declares: top-level UPPER_SNAKE members of its object literal. */
function declaredKeys(source: string): string[] {
  return [...source.matchAll(/^ {4}([A-Z][A-Z0-9_]+)\s*:/gm)].map((match) => String(match[1]));
}

/** Assignments an operator actually gets: a name at column zero, not a commented mention. */
function activeAssignments(example: string): string[] {
  return [...example.matchAll(/^([A-Z][A-Z0-9_]{2,})=/gm)].map((match) => String(match[1]));
}

function walkFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        walkFiles(join(directory, entry.name), found);
      }
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

/**
 * Every `process.env.NAME` read outside `packages/config`.
 *
 * Spec files are skipped on purpose: a test that assigns an env var to build a fixture is
 * describing a scenario, not adding to the deployment surface, and forcing documentation for
 * those would bury the case this check exists for.
 */
function directEnvironmentReads(): Set<string> {
  const names = new Set<string>();
  for (const root of READ_ROOTS) {
    const absolute = join(repoRoot, root);
    if (!exists(absolute)) {
      continue;
    }
    for (const file of walkFiles(absolute)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
        names.add(String(match[1]));
      }
    }
  }
  return names;
}

function exists(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

describe('environment schema and .env.example', () => {
  const schema = read(SCHEMA_SOURCE);
  const example = read(EXAMPLE_SOURCE);
  const keys = declaredKeys(schema);
  const assigned = activeAssignments(example);

  it('declares enough keys that this check cannot pass by scanning nothing', () => {
    expect(keys.length).toBeGreaterThanOrEqual(200);
    expect(assigned.length).toBeGreaterThanOrEqual(200);
  });

  it('names every key the schema declares', () => {
    const undocumented = keys.filter((key) => !example.includes(key));
    expect(undocumented).toEqual([]);
  });

  it('assigns each name at most once, because two answers is no answer', () => {
    const counts = new Map<string, number>();
    for (const name of assigned) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    // dotenv honours the first value of a repeated key and docker compose's env_file
    // honours the last, so a name written twice in one file is a setting whose value
    // depends on which loader read it. Three names were, and two carried different values.
    expect(duplicated).toEqual([]);
  });

  it('documents or declares every name read straight off process.env', () => {
    const undeclared = [...directEnvironmentReads()].filter(
      (name) => !keys.includes(name) && !example.includes(name),
    );
    expect(undeclared).toEqual([]);
  });

  it('names every variable the compose files interpolate in the env template they read', () => {
    // Round 7: docker-compose.yml interpolated four EXECUTION_* names that no
    // example file at the repo root mentioned, so an operator could only find
    // them by reading YAML. `${NAME}`, `${NAME:-default}` and `${NAME:?msg}`
    // all count: a defaulted knob is still a knob. Each compose file is held to
    // the template its README tells operators to copy.
    const pairs: Array<{ compose: string; template: string }> = [
      { compose: 'docker-compose.yml', template: EXAMPLE_SOURCE },
      { compose: 'docker-compose.override.yml', template: EXAMPLE_SOURCE },
      { compose: 'docker-compose.observability.yml', template: EXAMPLE_SOURCE },
      { compose: 'infrastructure/staging/docker-compose.staging.yml', template: 'infrastructure/.env.staging.example' },
    ];
    let interpolated = 0;
    const undocumented: string[] = [];
    for (const { compose, template } of pairs) {
      const text = read(compose);
      const documented = read(template);
      const names = new Set([...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => String(match[1])));
      interpolated += names.size;
      for (const name of names) {
        if (!new RegExp(`\\b${name}\\b`).test(documented)) {
          undocumented.push(`${compose}: ${name}`);
        }
      }
    }
    expect(interpolated).toBeGreaterThanOrEqual(50);
    expect(undocumented).toEqual([]);
  });

  it('is wired to the boot path it claims to police', () => {
    // If `validate: validateEnvironment` were dropped from the module, every assertion
    // above would still pass while the schema stopped mattering: a parity test on a seam
    // has to check the seam is installed.
    expect(read(MODULE_SOURCE)).toContain('validate: validateEnvironment');
    expect(read(VALIDATION_SOURCE)).toContain('validateEnv(raw)');
  });
});
```

FILE: apps/api/src/config/env.validation.ts

```typescript
import { AppEnv, EnvValidationError, validateEnv } from '@wlct/config';

/**
 * Adapter between `@nestjs/config` and the shared zod environment schema.
 * Throwing here aborts the boot sequence, which is exactly what we want: an API
 * that starts with an invalid JWT secret is worse than an API that does not
 * start at all.
 */
export function validateEnvironment(raw: Record<string, unknown>): AppEnv {
  try {
    return validateEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      const details = error.failures
        .map((failure) => `  \u2022 ${failure.path}: ${failure.message}`)
        .join('\n');
      throw new Error(
        `Environment validation failed. Fix the following variables in your .env file:\n${details}\n` +
          'Tip: run "npm run keys:generate" to produce valid cryptographic material.',
      );
    }
    throw error;
  }
}
```

FILE: apps/api/src/config/swagger.config.ts

```typescript
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { AppConfigService } from './app-config.service';
import {
  HEADER_DEVICE_ID,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_REQUEST_ID,
  HEADER_TENANT_SLUG,
  HEADER_TWO_FACTOR_TOKEN,
} from '@wlct/config';

/**
 * OpenAPI documentation.
 *
 * Two deliberate decisions:
 *  1. Swagger is opt-in via SWAGGER_ENABLED and defaults to off in production.
 *     An accurate map of every endpoint is a gift to an attacker.
 *  2. When it *is* enabled in a production-like environment, it sits behind
 *     HTTP basic auth compared in constant time, so enabling docs temporarily
 *     for a partner does not expose the surface to the whole internet.
 */
export function setupSwagger(app: INestApplication, config: AppConfigService): void {
  if (!config.swaggerEnabled) {
    return;
  }

  if (config.isProduction) {
    applyDocsBasicAuth(app, config);
  }

  const builder = new DocumentBuilder()
    .setTitle(config.swaggerTitle)
    .setDescription(buildDescription(config))
    .setVersion(config.swaggerVersion)
    .setContact('Platform engineering', config.publicUrl, '')
    .setLicense('Proprietary', '')
    .addServer(config.publicUrl, 'Configured public URL')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
        description:
          'Access token returned by POST /v1/auth/login. Short lived; refresh with POST /v1/auth/refresh.',
      },
      'access-token',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: HEADER_TENANT_SLUG,
        in: 'header',
        description:
          'Selects the organisation for unauthenticated requests. Ignored once a JWT is present - the token is always authoritative.',
      },
      'tenant-slug',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: HEADER_TWO_FACTOR_TOKEN,
        in: 'header',
        description: 'Two-factor challenge token issued by the login endpoint.',
      },
      'two-factor-token',
    )
    .addGlobalParameters(
      {
        name: HEADER_DEVICE_ID,
        in: 'header',
        required: false,
        description: 'Stable per-installation device identifier used for session binding.',
        schema: { type: 'string', maxLength: 128 },
      },
      {
        name: HEADER_REQUEST_ID,
        in: 'header',
        required: false,
        description: 'Client-supplied correlation id. Echoed back on every response.',
        schema: { type: 'string', format: 'uuid' },
      },
      {
        name: HEADER_IDEMPOTENCY_KEY,
        in: 'header',
        required: false,
        description: 'Idempotency key for unsafe operations that must not be applied twice.',
        schema: { type: 'string', maxLength: 128 },
      },
    )
    .addTag('Health', 'Liveness, readiness and operator probes')
    .addTag('Auth', 'Registration, login, refresh rotation and password management')
    .addTag('Two-factor authentication', 'TOTP enrolment, confirmation and recovery codes')
    .addTag('Sessions', 'Device and session management')
    .addTag('Users', 'User directory and profile administration')
    .addTag('Tenants', 'Organisation provisioning, branding, settings and domains')
    .addTag('RBAC - roles', 'Role definitions and assignment')
    .addTag('RBAC - permissions', 'The permission catalogue')
    .addTag('Feature flags', 'Per-tenant capability toggles')
    .addTag('Billing - plans', 'Subscription plan catalogue')
    .addTag('Billing - subscription', 'Tenant subscription lifecycle')
    .addTag('Notifications', 'Notification inbox and channel preferences')
    .addTag('Audit', 'Immutable audit trail')
    .addTag('Security', 'Security events and suspicious activity');

  const document: OpenAPIObject = SwaggerModule.createDocument(app, builder.build(), {
    deepScanRoutes: true,
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  SwaggerModule.setup(config.swaggerPath, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: `${config.swaggerTitle} - API reference`,
    jsonDocumentUrl: `${config.swaggerPath}/json`,
    yamlDocumentUrl: `${config.swaggerPath}/yaml`,
  });
}

function buildDescription(config: AppConfigService): string {
  return [
    config.swaggerDescription,
    '',
    '## Multi-tenancy',
    'Every request is bound to exactly one organisation. For authenticated calls the tenant is read',
    'from the `tid` claim of the access token and a client-supplied tenant identifier can never',
    'override it. For unauthenticated calls the tenant is resolved from the custom domain, then the',
    `platform sub-domain, then the \`${HEADER_TENANT_SLUG}\` header.`,
    '',
    '## Response envelope',
    'Successful responses are wrapped as `{ "success": true, "data": ..., "meta": { "requestId", "timestamp" } }`.',
    'Errors are wrapped as `{ "success": false, "error": { "code", "message", "details", "requestId", "timestamp", "path" } }`.',
    'Stack traces are never returned outside development.',
    '',
    '## Authentication',
    'Bearer access tokens are short lived. Refresh tokens rotate on every use and are bound to a',
    'device; presenting a consumed refresh token revokes the entire token family and signs the user',
    'out everywhere.',
    '',
    '## Rate limiting',
    'Two buckets are enforced: a generous default bucket and a strict bucket on authentication',
    'endpoints. Exceeding either returns 429 with `Retry-After`.',
  ].join('\n');
}

/**
 * Constant-time basic auth in front of the docs routes. Credentials come from
 * the environment; when they are not configured in production the docs stay
 * closed rather than falling open.
 */
function applyDocsBasicAuth(app: INestApplication, config: AppConfigService): void {
  const { user, password } = config.swaggerCredentials;
  const path = `/${config.swaggerPath.replace(/^\//, '')}`;

  app.use(path, (request: Request, response: Response, next: NextFunction) => {
    if (!user || !password) {
      response.status(404).send();
      return;
    }

    const header = request.headers.authorization ?? '';
    if (!header.toLowerCase().startsWith('basic ')) {
      response.setHeader('WWW-Authenticate', 'Basic realm="API reference"');
      response.status(401).send();
      return;
    }

    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const providedUser = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
    const providedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

    if (!safeEqual(providedUser, user) || !safeEqual(providedPassword, password)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="API reference"');
      response.status(401).send();
      return;
    }

    next();
  });
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    // Compare against itself to keep the timing profile flat.
    timingSafeEqual(providedBuffer, providedBuffer);
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
```

FILE: apps/api/src/main.ts

```typescript
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { VersioningType } from '@nestjs/common';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { setupSwagger } from './config/swagger.config';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';
import { RedisService } from './infrastructure/redis/redis.service';
import { HEADER_REQUEST_ID } from '@wlct/config';

/**
 * Application entrypoint.
 *
 * Bootstrapping order matters: configuration is validated before anything else,
 * security middleware is installed before routing, and the HTTP server is only
 * opened once every module reports ready. Shutdown hooks are enabled so Prisma,
 * Redis and BullMQ can drain in-flight work during a rolling deploy.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Keep the exact request bytes on req.rawBody (applied to the parsers
    // registered with app.useBodyParser below). Payment-provider webhooks sign
    // the raw body; verifying a re-serialised JSON object never matches.
    rawBody: true,
    // The global exception filter owns error shaping; disable Nest's default.
    abortOnError: false,
  });

  const logger = app.get(PinoLogger);
  app.useLogger(logger);
  app.flushLogs();

  const config = app.get(AppConfigService);

  // Behind a load balancer the client IP must come from X-Forwarded-For, which
  // rate limiting and audit logging both depend on.
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              baseUri: ["'self'"],
              fontSrc: ["'self'", 'https:', 'data:'],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              objectSrc: ["'none'"],
              scriptSrc: ["'self'"],
              scriptSrcAttr: ["'none'"],
              styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  // Hard cap on request size: nothing this API accepts legitimately exceeds it.
  app.useBodyParser('json', { limit: '512kb' });
  app.useBodyParser('urlencoded', { limit: '512kb', extended: true });

  // Surface the correlation id on every response, including error paths.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as Request & { id?: string }).id;
    if (requestId) {
      res.setHeader(HEADER_REQUEST_ID, requestId);
    }
    next();
  });

  if (config.corsEnabled) {
    app.enableCors({
      origin: config.corsOriginValidator,
      credentials: config.corsCredentials,
      allowedHeaders: config.corsAllowedHeaders,
      exposedHeaders: config.corsExposedHeaders,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
    });
  }

  // Health routes are excluded from the global prefix so probes can hit
  // `/health*` directly. Nest matches these entries literally, so each
  // sub-route of HealthController must be listed here; the controller itself is
  // VERSION_NEUTRAL so URI versioning does not re-add a `/v1` segment.
  // `healthz` and `readyz` are the Kubernetes-conventional aliases of `/health`
  // and `/health/ready` (see HealthProbeAliasController). They must be excluded
  // here too, or they would only be reachable as `/api/v1/healthz` - which is
  // exactly the path a stock liveness probe does not use.
  app.setGlobalPrefix(config.globalPrefix, {
    exclude: [
      'health',
      'health/ready',
      'health/deep',
      'health/startup',
      'health/trading',
      'healthz',
      'readyz',
      'metrics',
    ],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.defaultApiVersion,
    prefix: 'v',
  });

  if (config.wsEnabled) {
    const redisIoAdapter = new RedisIoAdapter(app, config, app.get(RedisService));
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
  }

  setupSwagger(app, config);

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  const url = await app.getUrl();
  logger.log(
    {
      event: 'application.started',
      environment: config.nodeEnv,
      port: config.port,
      globalPrefix: config.globalPrefix,
      apiVersion: config.defaultApiVersion,
      swagger: config.swaggerEnabled ? `${url}/${config.swaggerPath}` : 'disabled',
      websocket: config.wsEnabled ? config.wsPath : 'disabled',
      executionEnabled: config.executionEnabled,
    },
    'API bootstrap complete',
  );
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet at this point, so stderr is the only sink.
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`Fatal bootstrap error: ${message}\n`);
  process.exit(1);
});
```

FILE: apps/api/src/worker.ts

```typescript
/**
 * Trading-worker bootstrap: this process consumes; it never serves.
 *
 * There is no HTTP server here by construction, not by configuration:
 * createApplicationContext builds the DI graph and stops. An operator who
 * wants to read what the worker thinks must read its logs - which carry
 * claim state and job outcomes and never carry tokens or venue payloads.
 *
 * Lifecycle, in the order it actually matters:
 *  1. configuration parses (validateEnv inside the config module) - bad
 *     config exits nonzero before anything touches Redis;
 *  2. WORKER_ENABLED is honoured: false exits nonzero rather than running a
 *     silently-idle consumer, because "started and doing nothing" is the
 *     hardest failure mode an operator has to debug;
 *  3. the engine compatibility gate runs: the execution engine must answer,
 *     report the mode this build forwards to, and expose the command set.
 *     A worker that boots ahead of its engine would otherwise queue ack-less
 *     retries against a void and blame Redis for it;
 *  4. the coordination tick starts inside the module lifecycle and claims
 *     immediately (first tick is synchronous with construction, then every
 *     WORKER_PARTITION_RETRY_MS);
 *  5. shutdown drains: BullMQ workers pause first (no new jobs), held
 *     claims release second (owners move on without a TTL wait), connections
 *     close last. The whole sequence is bounded by
 *     WORKER_SHUTDOWN_TIMEOUT_MS; past that, process exit stands on the
 *     lease TTL - degraded, correct, and the reason TTLs exist.
 */

import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppConfigService } from './config/app-config.service';
import { EngineInternalClient } from './modules/worker/engine-internal.client';
import { WorkerModule } from './modules/worker/worker.module';

/**
 * Refuse to start: say why, release what the context opened, and exit nonzero.
 *
 * Round 8 (Docker run): these paths used to set `process.exitCode = 1` and return.
 * That only ends the process once the event loop is empty, and after `app.close()`
 * something in the graph (BullMQ / ioredis handles) kept it alive, so a worker that
 * had refused its engine stayed "Up" with no consumer and restart: unless-stopped
 * never fired - exactly the "started and doing nothing" mode point 2 above forbids.
 * The close is bounded the same way the SIGTERM drain is, so a hung close cannot
 * hold the refusal hostage either.
 */
async function refuseToStart(
  app: INestApplicationContext,
  logger: Logger,
  shutdownTimeoutMs: number,
  message: string,
): Promise<never> {
  logger.error(message);
  const deadline = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, shutdownTimeoutMs);
    timer.unref();
  });
  try {
    await Promise.race([app.close(), deadline]);
  } catch (error) {
    logger.error(
      `close after refusal failed (${error instanceof Error ? error.message : 'unknown'}); exiting anyway`,
    );
  }
  process.exit(1);
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('WorkerBootstrap');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  // Same wiring as main.ts. With bufferLogs: true and no useLogger/flushLogs, every
  // Nest Logger line - including the refusal reasons below - stayed in the buffer
  // and was never written: the round-8 Docker run showed a worker closing itself
  // 50 ms after start with no reason anywhere in its output.
  app.useLogger(app.get(PinoLogger));
  app.flushLogs();
  const config = app.get(AppConfigService);

  if (!config.workerEnabled) {
    await refuseToStart(
      app,
      logger,
      config.workerShutdownTimeoutMs,
      'WORKER_ENABLED=false: this process refuses to idle. A worker that ' +
        'consumes nothing and looks healthy is an outage with extra steps.',
    );
  }

  if (config.executionEngineToken === undefined) {
    await refuseToStart(
      app,
      logger,
      config.workerShutdownTimeoutMs,
      'EXECUTION_ENGINE_TOKEN is required by the worker: it forwards commands ' +
        'into the process that holds venue credentials.',
    );
  }

  const client = app.get(EngineInternalClient);
  try {
    const status = await client.assertEngineCompatible();
    logger.log(
      `execution engine compatible: mode=${status.mode} instance=${status.instanceId} ` +
        `store=${status.store} commands=${status.commands.join(',')}`,
    );
  } catch (error) {
    await refuseToStart(
      app,
      logger,
      config.workerShutdownTimeoutMs,
      `execution engine gate failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  app.enableShutdownHooks();
  logger.log(
    `worker ${config.workerId} online: partitions=${config.workerPartitionCount} ` +
      `membership=${config.workerMembership.length} defer=${config.workerDeferDelayMs}ms ` +
      `shutdown budget=${config.workerShutdownTimeoutMs}ms`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal}: draining worker`);
    const deadline = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`shutdown exceeded ${config.workerShutdownTimeoutMs}ms`)),
        config.workerShutdownTimeoutMs,
      );
      timer.unref();
    });
    try {
      await Promise.race([app.close(), deadline]);
      logger.log('worker drained cleanly');
    } catch (error) {
      // The forced path is SAFE, not hopeful: un-acked jobs stay in their
      // queues (at-least-once), and held claims expire by TTL, which is the
      // same recovery any crash follows. The log says so loudly because
      // making it quiet would be making it a lie.
      logger.error(
        `drain incomplete (${error instanceof Error ? error.message : 'unknown'}); ` +
          'exiting anyway - claims release by TTL and unacked jobs redeliver',
      );
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  new Logger('WorkerBootstrap').error(
    `worker failed to start: ${error instanceof Error ? error.message : 'unknown'}`,
  );
  // Exit now rather than only setting exitCode: a half-built context keeps
  // Redis / BullMQ connections open, and those hold the event loop, so the
  // process would otherwise linger as a running container that consumes
  // nothing - the "started and doing nothing" failure described above. Exiting
  // nonzero lets the orchestrator's restart policy see and retry it.
  process.exit(1);
});
```

FILE: apps/api/test/jest-e2e.json

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapper": {
    "^@wlct/shared-types$": "<rootDir>/../../../packages/shared-types/src",
    "^@wlct/config$": "<rootDir>/../../../packages/config/src",
    "^@wlct/utils$": "<rootDir>/../../../packages/utils/src",
    "^@wlct/validation$": "<rootDir>/../../../packages/validation/src",
    "^src/(.*)$": "<rootDir>/../src/$1"
  }
}
```

FILE: apps/api/test/sso-test-keys.global-setup.js

```javascript
/**
 * Jest globalSetup for the API unit tests: generates fresh TEST-ONLY SAML keys
 * before any spec runs.
 *
 * The SAML and SSO specs verify real XML-DSig signatures, so they need an RSA key
 * pair and certificates. The repository never contains a private key, so each
 * test run creates a new set with scripts/generate-test-sso-keys.mjs in
 * apps/api/.generated/sso-test-keys/ (git-ignored). The specs read the keys
 * through src/modules/security/__fixtures__/saml-test-keys.fixture-spec.ts.
 *
 * Requires OpenSSL on PATH. Without it the run stops here with the generator's
 * explanation: the SAML security tests are never skipped silently.
 *
 * Jest runs this once, in the parent process, before any worker starts, so
 * parallel workers all read one complete set.
 */
const { spawnSync } = require('child_process');
const path = require('path');

module.exports = async function generateSsoTestKeys() {
  const script = path.resolve(__dirname, '..', '..', '..', 'scripts', 'generate-test-sso-keys.mjs');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const reason = result.error
      ? result.error.message
      : String(result.stderr || '').trim() || `exit ${result.status}`;
    throw new Error(
      `Could not generate the test-only SAML keys required by the SSO specs.\n${reason}\n` +
        'Run `node scripts/generate-test-sso-keys.mjs` from the repository root to see the full error.',
    );
  }
};
```

FILE: apps/api/tsconfig.build.json

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

FILE: apps/api/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "./dist",
    "baseUrl": "./",
    "paths": {
      "src/*": ["src/*"]
    },
    "strictBindCallApply": false,
    "noImplicitAny": true,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

FILE: apps/api/tsconfig.spec.json

```json
{
  "// purpose": [
    "Type context for test files only.",
    "",
    "tsconfig.json deliberately excludes **/*.spec.ts so that `nest build` emits",
    "no test code into dist. That exclusion also hides spec files from",
    "typescript-eslint's typed rules, which then refuses to parse them. Rather",
    "than turn typed linting off for tests - tests on a money path are exactly",
    "where an unnoticed `any` does damage - this config gives them a project of",
    "their own, and .eslintrc.cjs points at both."
  ],
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true,
    "types": ["node", "jest"]
  },
  "include": ["src/**/*.spec.ts"],
  "exclude": ["node_modules", "dist"]
}
```

