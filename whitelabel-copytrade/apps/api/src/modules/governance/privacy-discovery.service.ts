import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GovernancePolicyService } from './governance-policy.service';
import { DataInventoryService } from './data-inventory.service';
import { DataClassificationService } from './data-classification.service';
import { DataClassification } from './governance.types';

export interface DiscoveryResult {
  tenantId: string;
  subjectUserId: string;
  correlationId: string;
  generatedAt: string;
  totalRecords: number;
  recordsBySystem: Record<string, number>;
  recordsByClass: Record<DataClassification, number>;
  locations: Array<{ sourceSystem: string; sourceTable: string; sourceId: string; dataClasses: DataClassification[]; jurisdiction: string }>;
  policyVersion: string;
  isDeterministic: boolean;
  sourceReferences: string[];
}

@Injectable()
export class PrivacyDiscoveryService {
  private readonly logger = new Logger(PrivacyDiscoveryService.name);

  constructor(
    private readonly inventory: DataInventoryService,
    private readonly classification: DataClassificationService,
    private readonly policyService: GovernancePolicyService,
  ) {}

  async discoverForSubject(params: {
    tenantId: string;
    subjectUserId: string;
    jurisdiction: string;
    correlationId: string;
  }): Promise<DiscoveryResult> {
    if (!params.tenantId || !params.subjectUserId) throw new BadRequestException('tenantId and subjectUserId required');
    this.policyService.validateJurisdiction(params.jurisdiction);

    const inventoryRecords = await this.inventory.listForSubject(params.tenantId, params.subjectUserId);

    const recordsBySystem: Record<string, number> = {};
    const recordsByClass: Record<string, number> = {} as any;
    const locations: DiscoveryResult['locations'] = [];
    const sourceReferences: string[] = [];

    for (const rec of inventoryRecords) {
      recordsBySystem[rec.sourceSystem] = (recordsBySystem[rec.sourceSystem] ?? 0) + 1;
      for (const dc of rec.dataClasses) {
        recordsByClass[dc] = (recordsByClass[dc] ?? 0) + 1;
      }
      locations.push({
        sourceSystem: rec.sourceSystem,
        sourceTable: rec.sourceTable,
        sourceId: rec.sourceId,
        dataClasses: rec.dataClasses,
        jurisdiction: rec.jurisdiction,
      });
      sourceReferences.push(`${rec.sourceSystem}:${rec.sourceTable}:${rec.sourceId}`);
    }

    // Deterministic sort for reproducibility
    locations.sort((a, b) => {
      if (a.sourceSystem !== b.sourceSystem) return a.sourceSystem.localeCompare(b.sourceSystem);
      if (a.sourceTable !== b.sourceTable) return a.sourceTable.localeCompare(b.sourceTable);
      return a.sourceId.localeCompare(b.sourceId);
    });
    sourceReferences.sort();

    const result: DiscoveryResult = {
      tenantId: params.tenantId,
      subjectUserId: params.subjectUserId,
      correlationId: params.correlationId,
      generatedAt: new Date().toISOString(),
      totalRecords: inventoryRecords.length,
      recordsBySystem,
      recordsByClass: recordsByClass as any,
      locations,
      policyVersion: this.policyService.getPolicyVersion(),
      isDeterministic: true,
      sourceReferences,
    };

    this.logger.log(`discovery tenant=${params.tenantId} subject=${params.subjectUserId} total=${result.totalRecords} corr=${params.correlationId}`);
    return result;
  }

  assertAuthorizedForSubject(requestTenantId: string, recordTenantId: string, requestSubject: string, recordSubject: string): void {
    this.policyService.assertTenantIsolation(requestTenantId, recordTenantId);
    if (requestSubject !== recordSubject) {
      throw new BadRequestException('subject isolation violation');
    }
  }
}
