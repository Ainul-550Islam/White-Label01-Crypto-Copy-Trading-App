// # Responsibility: scans rendered customer/admin/mobile UI copy for developer-facing notes and placeholder-only text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['apps/web/src', 'apps/admin-web/src', 'apps/mobile/lib'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.dart', '.arb']);
const skippedDirectories = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules', 'out', 'tests', '__tests__']);
const prohibited = /\b(?:hardcoded|canonical|todo)\b|\bround\s+\d+\b|\bpart\s+\d+\b/i;
const placeholderOnly = /^(?:\s*(?:placeholder|coming soon|to be determined|tbd|lorem ipsum|insert .+ here|enter .+ here)\s*[.!…]*\s*)$/i;
// A public-metrics contract test requires this exact failure state. It describes
// the missing source evidence to customers; every other use of "canonical" remains blocked.
const requiredCustomerCopy = new Set(['Canonical fill provenance could not be verified.']);

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...collectFiles(path.join(directory, entry.name)));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      if (/\.(?:spec|test)\.[^.]+$/i.test(entry.name)) continue;
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function maskComments(source) {
  const chars = [...source];
  let state = 'code';
  let quote = '';
  for (let i = 0; i < chars.length; i += 1) {
    const current = chars[i];
    const next = chars[i + 1];
    if (state === 'line-comment') {
      if (current === '\n') state = 'code';
      else chars[i] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 1;
        state = 'code';
      } else if (current !== '\n') chars[i] = ' ';
      continue;
    }
    if (state === 'string') {
      if (current === '\\') { i += 1; continue; }
      if (current === quote) state = 'code';
      continue;
    }
    if (current === '"' || current === "'" || current === '`') {
      state = 'string';
      quote = current;
      continue;
    }
    if (current === '/' && next === '/') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 1;
      state = 'line-comment';
    } else if (current === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 1;
      state = 'block-comment';
    }
  }
  return chars.join('');
}

function stringValues(source) {
  const values = [];
  const literal = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  for (const match of source.matchAll(literal)) values.push({ value: match[2], index: match.index });
  // JSX children are rendered without quotes; comments have already been removed.
  const jsxText = />\s*([^<>\n][^<>]*?)\s*</g;
  for (const match of source.matchAll(jsxText)) {
    const renderedText = match[1].trim();
    // JSX expressions are JavaScript, not JSX text nodes; their string literals
    // are already inspected by the literal pass above.
    if (renderedText.startsWith('{') && renderedText.endsWith('}')) continue;
    values.push({ value: match[1], index: match.index + match[0].indexOf(match[1]) });
  }
  return values;
}

const violations = [];
for (const relativeRoot of roots) {
  for (const file of collectFiles(path.join(root, relativeRoot))) {
    const source = fs.readFileSync(file, 'utf8');
    let values;
    if (path.extname(file) === '.arb') {
      try {
        const json = JSON.parse(source);
        values = Object.entries(json)
          .filter(([key]) => !key.startsWith('@'))
          .map(([, value]) => ({ value: String(value), index: 0 }));
      } catch (error) {
        violations.push(`${path.relative(root, file)}:1: invalid ARB JSON (${error.message})`);
        continue;
      }
    } else {
      values = stringValues(maskComments(source));
    }

    for (const { value, index } of values) {
      const normalized = value.replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      if (requiredCustomerCopy.has(normalized)) continue;
      if (!prohibited.test(normalized) && !placeholderOnly.test(normalized)) continue;
      const line = source.slice(0, index).split('\n').length;
      violations.push(`${path.relative(root, file)}:${line}: ${JSON.stringify(normalized)}`);
    }
  }
}

if (violations.length) {
  console.error(`User-facing copy leaks found (${violations.length}):`);
  for (const violation of [...new Set(violations)].sort()) console.error(violation);
  process.exitCode = 1;
} else {
  console.log('User-facing UI copy contains no developer notes or placeholder-only text.');
}
