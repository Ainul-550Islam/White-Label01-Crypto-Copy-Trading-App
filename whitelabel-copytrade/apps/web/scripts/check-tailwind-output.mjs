// # Verifies the production stylesheet contains generated Tailwind utilities.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(root, '.next', 'static');
if (!fs.existsSync(staticDir)) throw new Error(`Missing built static directory: ${staticDir}`);

// Next.js versions/layouts may emit styles in static/css or static/chunks.
const cssSearchDirs = ['css', 'chunks'].map((directory) => path.join(staticDir, directory));
const cssFiles = [];
function collectCss(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectCss(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.css')) cssFiles.push(fullPath);
  }
}
for (const directory of cssSearchDirs) {
  if (fs.existsSync(directory)) collectCss(directory);
}
if (cssFiles.length === 0) {
  throw new Error(
    `No production CSS files found under ${cssSearchDirs.join(' or ')}`,
  );
}

const css = cssFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const checks = [
  ['no raw @tailwind directive', !/@tailwind\b/.test(css)],
  ['.flex utility', /\.flex\s*\{/.test(css)],
  ['.grid utility', /\.grid\s*\{/.test(css)],
  ['.px-4 utility', /\.px-4\s*\{/.test(css)],
  ['.bg-primary utility', /\.bg-primary\s*\{/.test(css)],
];
const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length > 0) {
  console.error(`Tailwind output checks failed: ${failed.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('Tailwind production output verified.');
}
