// # Responsibility: prove the NUL-byte guard catches a file committed with no readable content, stays quiet on binary files whose bytes legitimately include 0x00, and passes on the tree as committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SOURCE = new URL('./check-no-nul-bytes.mjs', import.meta.url);

/** Copy the checker into a fixture root so its walker scans the fixture. */
async function checkerFor(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wlct-nul-'));
  const scriptsDir = path.join(root, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(SOURCE, path.join(scriptsDir, 'check-no-nul-bytes.mjs'));
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return import(`${path.join(scriptsDir, 'check-no-nul-bytes.mjs')}?t=${Date.now()}${Math.random()}`);
}

test('a text file that is entirely NUL is reported with its size and offset', async () => {
  // The exact shape of the 26 corrupted files: right byte count, no content.
  const checker = await checkerFor({ 'package.json': Buffer.alloc(4820, 0) });
  const report = checker.scan();
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].file, 'package.json');
  assert.equal(report.findings[0].sizeBytes, 4820);
  assert.equal(report.findings[0].firstNulOffset, 0);
});

test('a single NUL anywhere in a TS source is enough to fail', async () => {
  const body = Buffer.from('export const a = 1;\n\u0000\nexport const b = 2;\n', 'utf8');
  const checker = await checkerFor({ 'src/a.ts': body });
  const report = checker.scan();
  assert.equal(report.findings.length, 1);
  assert.ok(report.findings[0].firstNulOffset > 0, 'the offset points at the NUL, not the start');
});

test('a PNG full of NUL bytes is not corruption', async () => {
  // A real PNG header followed by compressed data, which contains 0x00 by design.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(2048, 0),
  ]);
  const checker = await checkerFor({ 'assets/icon.png': png });
  assert.deepEqual(checker.scan().findings, []);
});

test('a clean repository passes', async () => {
  const checker = await checkerFor({
    'package.json': '{"name":"x"}\n',
    'src/a.ts': 'export const a = 1;\n',
    'README.md': '# title\n',
  });
  const report = checker.scan();
  assert.deepEqual(report.findings, []);
  // The fixture tree also contains the copy of the checker itself, so the
  // inspected count is "at least these three", never exactly three.
  assert.ok(report.inspected >= 3, `expected at least 3 inspected files, saw ${report.inspected}`);
});

test('the extension sets are disjoint for the formats that matter', () => {
  const checkerFixtures = [
    ['json', true], ['ts', true], ['py', true], ['md', true],
    ['png', false], ['so', false], ['zip', false], ['woff2', false],
  ];
  return checkerFor({}).then((checker) => {
    for (const [ext, expectedText] of checkerFixtures) {
      assert.equal(checker.TEXT_EXTENSIONS.has(`.${ext}`), expectedText, `.${ext} text-ness`);
    }
  });
});

test('the tree as committed contains no NUL byte in any text file', async () => {
  const real = await import('../scripts/check-no-nul-bytes.mjs');
  const report = real.scan();
  assert.deepEqual(report.findings.map((finding) => finding.file), []);
  assert.ok(report.inspected > 1000, `expected to inspect the whole tree, saw ${report.inspected}`);
});
