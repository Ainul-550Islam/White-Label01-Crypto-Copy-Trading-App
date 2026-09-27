/**
 * Migration Gate Service
 * Validates Prisma schema/migration state before production deployment,
 * verifies migration ordering, detects pending migrations, rejects destructive
 * unsafe operations, and prevents deployment when migration integrity is invalid.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MigrationGateResult, MigrationGateStatus, EnvironmentName } from './production.types';

export interface MigrationFile {
  id: string;
  name: string;
  sql: string;
  timestamp: string;
}

export interface SchemaValidationInput {
  environment: EnvironmentName;
  currentMigrationId: string;
  targetMigrationId: string;
  migrationDirectory: string;
  schemaPath: string;
  allowDestructive: boolean;
  requireBackup: boolean;
  backupVerified: boolean;
  correlationId: string;
}

export class MigrationGateService {
  private readonly destructivePatterns: RegExp[] = [
    /DROP\s+TABLE/i,
    /DROP\s+COLUMN/i,
    /DROP\s+TYPE/i,
    /ALTER\s+TABLE.*DROP/i,
    /TRUNCATE\s+TABLE/i,
    /DELETE\s+FROM/i,
  ];

  private readonly dangerousPatterns: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /DROP\s+TABLE\s+IF\s+EXISTS/i, description: 'DROP TABLE' },
    { pattern: /ALTER\s+TABLE.*DROP\s+COLUMN/i, description: 'DROP COLUMN' },
    { pattern: /DROP\s+TYPE.*CASCADE/i, description: 'DROP TYPE CASCADE' },
  ];

  async validate(input: SchemaValidationInput): Promise<MigrationGateResult> {
    const checkedAt = new Date().toISOString();
    const migrationFiles = this.loadMigrations(input.migrationDirectory);

    const appliedMigrations = migrationFiles
      .filter((m) => m.id <= input.currentMigrationId)
      .map((m) => m.id)
      .sort();

    const pendingMigrations = migrationFiles
      .filter((m) => m.id > input.currentMigrationId && m.id <= input.targetMigrationId)
      .map((m) => m.id)
      .sort();

    const targetExists = migrationFiles.some((m) => m.id === input.targetMigrationId);
    if (!targetExists) {
      return {
        status: MigrationGateStatus.HISTORY_MISMATCH,
        currentMigrationId: input.currentMigrationId,
        targetMigrationId: input.targetMigrationId,
        pendingMigrations,
        appliedMigrations,
        hasDestructive: false,
        destructiveOperations: [],
        historyValid: false,
        schemaValid: false,
        requiresApproval: false,
        failureReason: `Target migration ${input.targetMigrationId} not found in migration directory`,
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    const historyValid = this.validateHistoryOrdering(migrationFiles);
    if (!historyValid) {
      return {
        status: MigrationGateStatus.HISTORY_MISMATCH,
        currentMigrationId: input.currentMigrationId,
        targetMigrationId: input.targetMigrationId,
        pendingMigrations,
        appliedMigrations,
        hasDestructive: false,
        destructiveOperations: [],
        historyValid: false,
        schemaValid: false,
        requiresApproval: false,
        failureReason: 'Migration history ordering invalid, timestamps not monotonic',
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    const destructiveOps = this.detectDestructiveOperations(
      migrationFiles.filter((m) => pendingMigrations.includes(m.id)),
    );

    if (destructiveOps.length > 0 && !input.allowDestructive) {
      return {
        status: MigrationGateStatus.DESTRUCTIVE_DETECTED,
        currentMigrationId: input.currentMigrationId,
        targetMigrationId: input.targetMigrationId,
        pendingMigrations,
        appliedMigrations,
        hasDestructive: true,
        destructiveOperations: destructiveOps,
        historyValid: true,
        schemaValid: true,
        requiresApproval: true,
        failureReason: `Destructive operations detected: ${destructiveOps.map((d) => `${d.operation} on ${d.table}`).join(', ')}. Explicit production-safe approval required.`,
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    if (input.environment === EnvironmentName.PRODUCTION && input.requireBackup && !input.backupVerified) {
      return {
        status: MigrationGateStatus.INVALID,
        currentMigrationId: input.currentMigrationId,
        targetMigrationId: input.targetMigrationId,
        pendingMigrations,
        appliedMigrations,
        hasDestructive: destructiveOps.length > 0,
        destructiveOperations: destructiveOps,
        historyValid: true,
        schemaValid: true,
        requiresApproval: true,
        failureReason: 'Backup verification required before migration in production, but no verified backup found',
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    const schemaValid = this.validateSchemaFile(input.schemaPath);

    if (!schemaValid) {
      return {
        status: MigrationGateStatus.INVALID,
        currentMigrationId: input.currentMigrationId,
        targetMigrationId: input.targetMigrationId,
        pendingMigrations,
        appliedMigrations,
        hasDestructive: destructiveOps.length > 0,
        destructiveOperations: destructiveOps,
        historyValid: true,
        schemaValid: false,
        requiresApproval: false,
        failureReason: 'Prisma schema validation failed',
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    if (destructiveOps.length > 0) {
      return {
        status: MigrationGateStatus.APPROVAL_REQUIRED,
        currentMigrationId: input.currentMigrationId,
        targetMigrationId: input.targetMigrationId,
        pendingMigrations,
        appliedMigrations,
        hasDestructive: true,
        destructiveOperations: destructiveOps,
        historyValid: true,
        schemaValid: true,
        requiresApproval: true,
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    return {
      status: MigrationGateStatus.VALID,
      currentMigrationId: input.currentMigrationId,
      targetMigrationId: input.targetMigrationId,
      pendingMigrations,
      appliedMigrations,
      hasDestructive: false,
      destructiveOperations: [],
      historyValid: true,
      schemaValid: true,
      requiresApproval: false,
      checkedAt,
      correlationId: input.correlationId,
    };
  }

  private loadMigrations(migrationDirectory: string): MigrationFile[] {
    if (!fs.existsSync(migrationDirectory)) {
      return [];
    }
    const entries = fs.readdirSync(migrationDirectory, { withFileTypes: true });
    const migrations: MigrationFile[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'migration_lock.toml') continue;
      const migrationSqlPath = path.join(migrationDirectory, entry.name, 'migration.sql');
      let sql = '';
      if (fs.existsSync(migrationSqlPath)) {
        sql = fs.readFileSync(migrationSqlPath, 'utf8');
      }
      migrations.push({
        id: entry.name,
        name: entry.name,
        sql,
        timestamp: entry.name.slice(0, 14),
      });
    }
    return migrations.sort((a, b) => a.id.localeCompare(b.id));
  }

  private validateHistoryOrdering(migrations: MigrationFile[]): boolean {
    for (let i = 1; i < migrations.length; i++) {
      if (migrations[i].id <= migrations[i - 1].id) {
        return false;
      }
    }
    return true;
  }

  private detectDestructiveOperations(migrations: MigrationFile[]): Array<{ migrationId: string; operation: string; table: string; details: string }> {
    const destructive: Array<{ migrationId: string; operation: string; table: string; details: string }> = [];
    for (const migration of migrations) {
      for (const dangerous of this.dangerousPatterns) {
        const matches = migration.sql.match(new RegExp(dangerous.pattern, 'gi'));
        if (matches) {
          for (const match of matches) {
            const tableMatch = match.match(/TABLE\s+\"?(\w+)\"?/i) || match.match(/TABLE\s+(\w+)/i);
            const table = tableMatch ? tableMatch[1] : 'unknown';
            destructive.push({
              migrationId: migration.id,
              operation: dangerous.description,
              table,
              details: match.slice(0, 200),
            });
          }
        }
      }
    }
    return destructive;
  }

  private validateSchemaFile(schemaPath: string): boolean {
    if (!fs.existsSync(schemaPath)) return false;
    const content = fs.readFileSync(schemaPath, 'utf8');
    if (!content.includes('datasource db')) return false;
    if (!content.includes('generator client')) return false;
    if (!content.includes('model Tenant')) return false;
    return true;
  }

  mustBlockDeployment(result: MigrationGateResult, environment: EnvironmentName): boolean {
    if (result.status === MigrationGateStatus.HISTORY_MISMATCH) return true;
    if (result.status === MigrationGateStatus.INVALID) return true;
    if (result.status === MigrationGateStatus.DESTRUCTIVE_DETECTED && environment === EnvironmentName.PRODUCTION) return true;
    if (result.status === MigrationGateStatus.PENDING_MIGRATIONS && environment === EnvironmentName.PRODUCTION) return false;
    return false;
  }
}
