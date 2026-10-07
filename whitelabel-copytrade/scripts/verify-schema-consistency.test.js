// # NEW — Unit test for schema consistency verifier
// # NEW — deterministic schema verification tests
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifySchemaConsistency, REQUIRED_MODELS } = require('./verify-schema-consistency');

function runTests() {
  // 1. Canonical repository schema verification passes
  const res = verifySchemaConsistency();
  assert.strictEqual(res.ok, true, `Expected schema consistency OK, got: ${res.errors.join('; ')}`);
  assert.ok(res.modelCount >= REQUIRED_MODELS.length, 'Expected all required models present');
  for (const modelName of REQUIRED_MODELS) {
    assert.ok(res.models.includes(modelName), `Missing required model ${modelName}`);
  }

  // 2. Detects forbidden CREATE TABLE inside SQL init directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wlct-schema-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '99-bad.sql'),
      'CREATE TABLE rogue_table (id TEXT PRIMARY KEY);\n',
      'utf8',
    );
    const badRes = verifySchemaConsistency({ initDir: tmpDir });
    assert.strictEqual(badRes.ok, false, 'Expected CREATE TABLE in init script to fail verification');
    assert.ok(
      badRes.errors.some((e) => e.includes('CREATE TABLE')),
      'Expected error message to mention CREATE TABLE',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`PASS verify-schema-consistency.test.js (${res.modelCount} models verified)`);
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
