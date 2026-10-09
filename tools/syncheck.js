#!/usr/bin/env node
// Syntax-only TypeScript gate.
//
// tsconfig.spec.json only type-checks files reachable from a spec, and the production graph cannot
// be type-checked in this container (OOM). This gate closes the gap for individual files: it runs
// TypeScript's own parser and reports syntactic diagnostics, so a file that no project compiles
// still cannot be committed with a syntax error.
//
// It is deliberately NOT a type check. "OK" here means "parses", nothing more.
//
// Usage: node /home/user/tools/syncheck.js <file.ts> [more.ts ...]
'use strict';
const fs = require('fs');
const path = require('path');

let ts;
const candidates = [
  '/home/user/repo/whitelabel-copytrade/node_modules/typescript',
  '/home/user/repo/whitelabel-copytrade/apps/api/node_modules/typescript',
];
for (const c of candidates) {
  try {
    ts = require(c);
    break;
  } catch {
    /* keep looking */
  }
}
if (!ts) {
  console.error('FATAL: typescript not found; run npm install in the monorepo first.');
  process.exit(2);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: syncheck.js <file.ts> [...]');
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.log(`MISS ${file} (no such file)`);
    failed++;
    continue;
  }
  const source = fs.readFileSync(abs, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
    fileName: abs,
    reportDiagnostics: true,
  });
  const diagnostics = (output.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length === 0) {
    console.log(`OK   ${file}`);
    continue;
  }
  failed++;
  console.log(`SYNTAX ERROR  ${file}`);
  for (const d of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    if (d.start === undefined) {
      console.log(`    TS${d.code}: ${message}`);
      continue;
    }
    const { line, character } = ts.getLineAndCharacterOfPosition(
      ts.createSourceFile(abs, source, ts.ScriptTarget.ES2022, true),
      d.start,
    );
    console.log(`    ${line + 1}:${character + 1}  TS${d.code}: ${message}`);
  }
}

console.log(failed === 0 ? `\nAll ${files.length} file(s) parse.` : `\n${failed} of ${files.length} file(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
