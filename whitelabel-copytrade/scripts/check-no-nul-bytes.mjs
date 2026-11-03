#!/usr/bin/env node
// # Responsibility: fails when a tracked source or configuration file has been committed as NUL bytes, which is how 26 files in this repository — package.json, package-lock.json, three CI scripts among them — reached HEAD as unreadable blobs while keeping their byte counts.
//
// THE FAILURE THIS PREVENTS
// -------------------------
// An editor or transfer that writes an uninitialised buffer produces a file with
// the right SIZE and no CONTENT: every byte is 0x00. Nothing in a normal pipeline
// notices. `git diff` shows a huge blob, `git status` is clean, the file's byte
// count looks plausible, and the failure only surfaces when a build or a test
// tries to read it — which, on the commit this check was added for, was never,
// because the lockfile could not even install.
//
// WHAT COUNTS AS CORRUPTION, AND WHAT DOES NOT
// --------------------------------------------
// Text formats must not contain a NUL byte at all: JSON, YAML, TS/JS/TSX, Python,
// SQL, Markdown, shell. A single 0x00 in any of those is corruption, not style.
//
// Binary formats legitimately contain 0x00 — a PNG's compressed IDAT stream is
// full of them, and a naive "count NULs" scan reports a perfectly valid icon as
// 100% corrupt. Those extensions are skipped by name, and for the archive-ish
// formats that can contain arbitrary payloads (zip, xz, so) a size sanity check
// is not attempted at all: this check is about text that became nothing.
//
// Usage:
//   node scripts/check-no-nul-bytes.mjs           scan the tree
//   node scripts/check-no-nul-bytes.mjs --json    machine-readable output
// Exit codes: 0 clean, 1 corrupt file(s) found, 2 configuration error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Extensions that must never contain a NUL byte. */
const TEXT_EXTENSIONS = new Set([
  '.json', '.jsonl', '.yml', '.yaml', '.toml', '.ini', '.env', '.example',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.pyi', '.dart', '.rs', '.go', '.java', '.kts', '.swift',
  '.sql', '.prisma', '.graphql', '.gql',
  '.md', '.mdx', '.txt', '.csv', '.tsv', '.log',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.css', '.scss', '.html', '.xml', '.svg', '.map',
  '.tf', '.tfvars', '.hcl', '.tpl', '.arb',
  '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc', '.dockerignore',
]);

/** Extensions where 0x00 is data, not damage. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.jar',
  '.so', '.node', '.dylib', '.dll', '.exe', '.wasm', '.bin', '.dat',
  '.mp3', '.mp4', '.wav', '.webm', '.ogg',
  '.sqlite', '.db', '.pyc', '.class', '.lock', '.pack', '.idx',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'target',
  '.turbo', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
  '.dart_tool', 'Pods', '.gradle', 'out', '.expo', '.terraform',
]);

function isTextFile(name) {
  const lower = name.toLowerCase();
  const ext = path.extname(lower);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Files with no extension that are text by convention.
  if (!ext && ['dockerfile', 'makefile', 'procfile'].includes(lower)) return true;
  if (!ext && lower.startsWith('dockerfile')) return true;
  return false;
}

function isBinary(name) {
  const lower = name.toLowerCase();
  return BINARY_EXTENSIONS.has(path.extname(lower));
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** The first NUL's offset, or -1. Reads at most 8 KiB: a NUL in a header is the bug. */
function firstNulOffset(file) {
  const handle = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).indexOf(0x00);
  } finally {
    fs.closeSync(handle);
  }
}

function scan() {
  const findings = [];
  const files = walk(ROOT);
  let inspected = 0;
  for (const file of files) {
    const name = path.basename(file);
    if (isBinary(name)) continue;
    if (!isTextFile(name)) continue;
    inspected += 1;
    const offset = firstNulOffset(file);
    if (offset === -1) continue;
    const size = fs.statSync(file).size;
    findings.push({
      file: path.relative(ROOT, file).split(path.sep).join('/'),
      sizeBytes: size,
      firstNulOffset: offset,
    });
  }
  return { root: ROOT, inspected, findings };
}

function main(argv) {
  let report;
  try {
    report = scan();
  } catch (error) {
    console.error(`check-no-nul-bytes: ${error.message}`);
    return 2;
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.findings.length === 0) {
    console.log(`NO_NUL_BYTES_OK ${report.inspected} text files inspected, none contain a NUL byte`);
  } else {
    for (const finding of report.findings) {
      console.error(
        `\u00d7 ${finding.file} contains a NUL byte at offset ${finding.firstNulOffset} ` +
        `(${finding.sizeBytes} bytes): the file was committed with no readable content`,
      );
    }
    console.error(`\ncheck-no-nul-bytes: ${report.findings.length} corrupt file(s) of ${report.inspected} inspected`);
  }
  return report.findings.length === 0 ? 0 : 1;
}

export { BINARY_EXTENSIONS, TEXT_EXTENSIONS, firstNulOffset, isBinary, isTextFile, scan };

process.exitCode = main(process.argv.slice(2));
