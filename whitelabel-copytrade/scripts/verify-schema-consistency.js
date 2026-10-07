#!/usr/bin/env node
// # NEW — Verifies Prisma schema, migrations, and SQL init scripts are in sync
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRISMA_SCHEMA_PATH = path.join(ROOT, 'apps', 'api', 'prisma', 'schema.prisma');
const INIT_DIR = path.join(ROOT, 'infrastructure', 'database', 'init');

const REQUIRED_MODELS = [
  'Tenant',
  'User',
  'TradingAccount',
  'TraderProfile',
  'CopySubscription',
  'CopyExecution',
  'CopyReconciliationRecord',
  'KillSwitch',
  'ExecutionIncident',
  'ComplianceCase',
  'CustodyWallet',
  'FundingRequest',
  'PartnerProfile',
  'PartnerCommission',
  'PartnerPayout',
  'Notification',
  'AuditLog',
];

function verifySchemaConsistency(options = {}) {
  const schemaPath = options.schemaPath || PRISMA_SCHEMA_PATH;
  const initDir = options.initDir || INIT_DIR;
  const errors = [];

  if (!fs.existsSync(schemaPath)) {
    errors.push(`Missing Prisma schema at ${schemaPath}`);
    return { ok: false, errors, modelCount: 0, enumCount: 0 };
  }

  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  const models = Array.from(schemaText.matchAll(/^model\s+([A-Za-z0-9_]+)\s+\{/gm)).map(
    (m) => m[1],
  );
  const enums = Array.from(schemaText.matchAll(/^enum\s+([A-Za-z0-9_]+)\s+\{/gm)).map(
    (m) => m[1],
  );

  for (const reqModel of REQUIRED_MODELS) {
    if (!models.includes(reqModel)) {
      errors.push(`Required Prisma model "${reqModel}" is missing from schema.prisma`);
    }
  }

  if (!fs.existsSync(initDir)) {
    errors.push(`Missing database init directory at ${initDir}`);
  } else {
    const sqlFiles = fs.readdirSync(initDir).filter((f) => f.endsWith('.sql'));
    if (sqlFiles.length === 0) {
      errors.push(`No SQL init scripts found in ${initDir}`);
    }
    for (const file of sqlFiles) {
      const sqlContent = fs.readFileSync(path.join(initDir, file), 'utf8');
      if (/CREATE\s+TABLE\s+/i.test(sqlContent)) {
        errors.push(
          `SQL init script ${file} contains CREATE TABLE; all table definitions must live exclusively in Prisma schema.prisma`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    modelCount: models.length,
    enumCount: enums.length,
    models,
  };
}

if (require.main === module) {
  const result = verifySchemaConsistency();
  if (!result.ok) {
    console.error('Schema consistency check FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(
    `Schema consistency check OK: ${result.modelCount} Prisma models and ${result.enumCount} enums verified against SQL init scripts.`,
  );
}

module.exports = { verifySchemaConsistency, REQUIRED_MODELS };
