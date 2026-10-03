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
