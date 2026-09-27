/**
 * RLS Gate Service
 * Validates tenant/RLS coverage against current schema and RLS artifacts
 * before production release. Must fail closed if protected tenant-scoped models
 * are missing required database-level coverage according to policy.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RlsGateResult, RlsGateStatus } from './production.types';

export interface RlsGateInput {
  schemaPath: string;
  rlsDirectory: string;
  coverageFilePath: string;
  correlationId: string;
}

export class RlsGateService {
  private readonly tenantScopedModelPatterns: RegExp[] = [
    /tenantId\s+String/i,
    /@@index\(\[tenantId/i,
  ];

  private readonly protectedModels: string[] = [
    'User',
    'TenantSetting',
    'KycProfile',
    'ExchangeAccount',
    'CopySubscription',
    'Order',
    'Position',
    'PortfolioSnapshot',
    'Subscription',
    'Payment',
    'Invoice',
    'Notification',
    'AuditLog',
    'SecurityEvent',
    'ComplianceCase',
    'RiskConfiguration',
    'CustodyWallet',
    'CustodyWithdrawal',
    'AccountBalanceSnapshot',
    'ReconciliationDiscrepancy',
    'ClientRelationship',
    'TenantDomain',
    'Role',
    'RefreshToken',
    'BacktestRun',
    'PaperTradingSession',
    'ExecutionOrder',
    'ExecutionIncident',
  ];

  async validate(input: RlsGateInput): Promise<RlsGateResult> {
    const checkedAt = new Date().toISOString();
    const schemaContent = this.loadSchema(input.schemaPath);
    const coverage = this.loadCoverage(input.coverageFilePath);
    const rlsArtifactsExist = this.checkRlsArtifacts(input.rlsDirectory);

    if (!schemaContent) {
      return {
        status: RlsGateStatus.ARTIFACT_MISSING,
        coveredModels: [],
        uncoveredModels: this.protectedModels,
        missingPolicies: this.protectedModels.map((model) => ({
          table: this.modelToTable(model),
          model,
          expectedPolicy: `tenant_isolation policy for ${model}`,
        })),
        coveragePercent: 0,
        totalTenantScopedModels: this.protectedModels.length,
        rlsArtifactsFound: false,
        failureReason: 'Prisma schema not found, cannot validate RLS coverage',
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    if (!rlsArtifactsExist) {
      return {
        status: RlsGateStatus.ARTIFACT_MISSING,
        coveredModels: [],
        uncoveredModels: this.protectedModels,
        missingPolicies: this.protectedModels.map((model) => ({
          table: this.modelToTable(model),
          model,
          expectedPolicy: `tenant_isolation policy for ${model}`,
        })),
        coveragePercent: 0,
        totalTenantScopedModels: this.protectedModels.length,
        rlsArtifactsFound: false,
        failureReason: 'RLS artifacts missing in rls directory',
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    const tenantScopedModelsInSchema = this.extractTenantScopedModels(schemaContent);
    const coveredModels: string[] = [];
    const uncoveredModels: string[] = [];
    const missingPolicies: Array<{ table: string; model: string; expectedPolicy: string }> = [];

    for (const protectedModel of this.protectedModels) {
      const isInSchema = tenantScopedModelsInSchema.includes(protectedModel) || schemaContent.includes(`model ${protectedModel}`);
      if (!isInSchema) continue;

      const isCovered = coverage.some(
        (c) => c.model === protectedModel || c.table === this.modelToTable(protectedModel),
      );

      if (isCovered) {
        coveredModels.push(protectedModel);
      } else {
        uncoveredModels.push(protectedModel);
        missingPolicies.push({
          table: this.modelToTable(protectedModel),
          model: protectedModel,
          expectedPolicy: `tenant_isolation policy for ${protectedModel}`,
        });
      }
    }

    const totalChecked = coveredModels.length + uncoveredModels.length;
    const coveragePercent = totalChecked === 0 ? 100 : Math.round((coveredModels.length / totalChecked) * 100);

    if (uncoveredModels.length > 0) {
      return {
        status: RlsGateStatus.FAILED_CLOSED,
        coveredModels,
        uncoveredModels,
        missingPolicies,
        coveragePercent,
        totalTenantScopedModels: totalChecked,
        rlsArtifactsFound: true,
        failureReason: `RLS coverage incomplete: ${uncoveredModels.length} protected models missing RLS policy: ${uncoveredModels.join(', ')}`,
        checkedAt,
        correlationId: input.correlationId,
      };
    }

    return {
      status: RlsGateStatus.COVERAGE_COMPLETE,
      coveredModels,
      uncoveredModels: [],
      missingPolicies: [],
      coveragePercent,
      totalTenantScopedModels: totalChecked,
      rlsArtifactsFound: true,
      checkedAt,
      correlationId: input.correlationId,
    };
  }

  private loadSchema(schemaPath: string): string | null {
    if (!fs.existsSync(schemaPath)) return null;
    return fs.readFileSync(schemaPath, 'utf8');
  }

  private loadCoverage(coverageFilePath: string): Array<{ table: string; model: string }> {
    if (!fs.existsSync(coverageFilePath)) return [];
    try {
      const content = fs.readFileSync(coverageFilePath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.covered && Array.isArray(parsed.covered)) return parsed.covered;
      return [];
    } catch {
      return [];
    }
  }

  private checkRlsArtifacts(rlsDirectory: string): boolean {
    if (!fs.existsSync(rlsDirectory)) return false;
    const requiredFiles = ['enable.sql', 'rls_coverage.json'];
    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(rlsDirectory, file))) {
        return false;
      }
    }
    return true;
  }

  private extractTenantScopedModels(schemaContent: string): string[] {
    const models: string[] = [];
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/gs;
    let match: RegExpExecArray | null;
    while ((match = modelRegex.exec(schemaContent)) !== null) {
      const modelName = match[1];
      const body = match[2];
      if (body.includes('tenantId')) {
        models.push(modelName);
      }
    }
    return models;
  }

  private modelToTable(model: string): string {
    return model
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }

  mustBlockDeployment(result: RlsGateResult): boolean {
    return result.status === RlsGateStatus.FAILED_CLOSED ||
           result.status === RlsGateStatus.ARTIFACT_MISSING ||
           result.status === RlsGateStatus.COVERAGE_INCOMPLETE;
  }
}
