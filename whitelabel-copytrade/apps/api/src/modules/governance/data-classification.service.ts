import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataClassification } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface DataClassificationRecord {
  id: string;
  tenantId: string;
  sourceSystem: string;
  sourceTable: string;
  sourceField: string;
  dataClass: DataClassification;
  jurisdiction: string;
  sensitivityScore: number;
  piiFlag: boolean;
  regulatedFlag: boolean;
  classifiedAt: string;
  classifiedBy: string;
  policyVersion: string;
  correlationId: string;
}

@Injectable()
export class DataClassificationService {
  private readonly logger = new Logger(DataClassificationService.name);
  private readonly classificationRules: Map<string, DataClassification>;

  constructor(
    private readonly config: ConfigService,
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
  ) {
    this.classificationRules = this.buildRules();
  }

  private buildRules(): Map<string, DataClassification> {
    const map = new Map<string, DataClassification>();
    map.set('email', DataClassification.PII);
    map.set('phone', DataClassification.PII);
    map.set('address', DataClassification.PII);
    map.set('government_id_reference', DataClassification.KYC_SENSITIVE);
    map.set('identity_reference', DataClassification.KYC_SENSITIVE);
    map.set('kyc_metadata', DataClassification.KYC_SENSITIVE);
    map.set('kyc_document_reference', DataClassification.KYC_SENSITIVE);
    map.set('aml_evidence', DataClassification.REGULATED);
    map.set('compliance_case_reference', DataClassification.REGULATED);
    map.set('transaction_reference', DataClassification.FINANCIAL);
    map.set('invoice_reference', DataClassification.FINANCIAL);
    map.set('billing_ledger_reference', DataClassification.FINANCIAL);
    map.set('portfolio_position', DataClassification.FINANCIAL);
    map.set('balance_reference', DataClassification.FINANCIAL);
    map.set('payment_metadata', DataClassification.FINANCIAL);
    map.set('password_hash', DataClassification.SECURITY_SENSITIVE);
    map.set('secret_reference', DataClassification.SECURITY_SENSITIVE);
    map.set('api_key_reference', DataClassification.SECURITY_SENSITIVE);
    map.set('session_information', DataClassification.SECURITY_SENSITIVE);
    map.set('device_information', DataClassification.SECURITY_SENSITIVE);
    map.set('ip_address', DataClassification.PII);
    map.set('withdrawal_destination', DataClassification.FINANCIAL);
    return map;
  }

  classifyField(fieldName: string, sourceSystem: string): DataClassification {
    if (!fieldName) throw new BadRequestException('fieldName required');
    const normalized = fieldName.toLowerCase().trim();
    if (this.classificationRules.has(normalized)) {
      return this.classificationRules.get(normalized)!;
    }
    if (normalized.includes('email') || normalized.includes('phone') || normalized.includes('pii')) return DataClassification.PII;
    if (normalized.includes('kyc') || normalized.includes('government') || normalized.includes('identity')) return DataClassification.KYC_SENSITIVE;
    if (normalized.includes('transaction') || normalized.includes('balance') || normalized.includes('invoice') || normalized.includes('ledger') || normalized.includes('portfolio')) return DataClassification.FINANCIAL;
    if (normalized.includes('aml') || normalized.includes('compliance') || normalized.includes('audit') || normalized.includes('regulatory')) return DataClassification.REGULATED;
    if (normalized.includes('password') || normalized.includes('secret') || normalized.includes('key') || normalized.includes('token') || normalized.includes('credential')) return DataClassification.SECURITY_SENSITIVE;
    return DataClassification.INTERNAL;
  }

  async classifyRecord(params: {
    tenantId: string;
    sourceSystem: string;
    sourceTable: string;
    sourceField: string;
    jurisdiction: string;
    correlationId: string;
    classifiedBy: string;
  }): Promise<DataClassificationRecord> {
    this.policyService.validateJurisdiction(params.jurisdiction);
    if (!params.tenantId) throw new BadRequestException('tenantId required');
    const dataClass = this.classifyField(params.sourceField, params.sourceSystem);
    const record: DataClassificationRecord = {
      id: `dcls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      sourceSystem: params.sourceSystem,
      sourceTable: params.sourceTable,
      sourceField: params.sourceField,
      dataClass,
      jurisdiction: params.jurisdiction.toUpperCase(),
      sensitivityScore: this.sensitivityScore(dataClass),
      piiFlag: dataClass === DataClassification.PII || dataClass === DataClassification.KYC_SENSITIVE,
      regulatedFlag: [DataClassification.FINANCIAL, DataClassification.REGULATED, DataClassification.KYC_SENSITIVE].includes(dataClass),
      classifiedAt: new Date().toISOString(),
      classifiedBy: params.classifiedBy,
      policyVersion: this.policyService.getPolicyVersion(),
      correlationId: params.correlationId,
    };

    try {
      await (this.prisma as any).governanceDataClassification?.create?.({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          sourceSystem: record.sourceSystem,
          sourceTable: record.sourceTable,
          sourceField: record.sourceField,
          dataClass: record.dataClass,
          jurisdiction: record.jurisdiction,
          sensitivityScore: record.sensitivityScore,
          piiFlag: record.piiFlag,
          regulatedFlag: record.regulatedFlag,
          classifiedAt: new Date(record.classifiedAt),
          classifiedBy: record.classifiedBy,
          policyVersion: record.policyVersion,
          correlationId: record.correlationId,
        },
      });
    } catch {
      this.logger.debug(`classification persist skipped id=${record.id}`);
    }

    this.logger.log(`classified tenant=${params.tenantId} field=${params.sourceField} class=${dataClass} corr=${params.correlationId}`);
    return record;
  }

  private sensitivityScore(dc: DataClassification): number {
    switch (dc) {
      case DataClassification.PUBLIC:
        return 10;
      case DataClassification.INTERNAL:
        return 30;
      case DataClassification.CONFIDENTIAL:
        return 60;
      case DataClassification.PII:
        return 80;
      case DataClassification.FINANCIAL:
        return 85;
      case DataClassification.KYC_SENSITIVE:
        return 90;
      case DataClassification.SECURITY_SENSITIVE:
        return 95;
      case DataClassification.REGULATED:
        return 90;
      case DataClassification.RESTRICTED:
        return 95;
      default:
        return 50;
    }
  }

  async listClassifications(tenantId: string): Promise<DataClassificationRecord[]> {
    if (!tenantId) throw new BadRequestException('tenantId required');
    try {
      const rows = await (this.prisma as any).governanceDataClassification?.findMany?.({
        where: { tenantId },
        orderBy: { classifiedAt: 'desc' },
        take: 500,
      });
      if (rows) {
        return rows.map((r: any) => ({
          id: r.id,
          tenantId: r.tenantId,
          sourceSystem: r.sourceSystem,
          sourceTable: r.sourceTable,
          sourceField: r.sourceField,
          dataClass: r.dataClass,
          jurisdiction: r.jurisdiction,
          sensitivityScore: r.sensitivityScore,
          piiFlag: r.piiFlag,
          regulatedFlag: r.regulatedFlag,
          classifiedAt: r.classifiedAt instanceof Date ? r.classifiedAt.toISOString() : r.classifiedAt,
          classifiedBy: r.classifiedBy,
          policyVersion: r.policyVersion,
          correlationId: r.correlationId,
        }));
      }
    } catch {
      this.logger.debug(`listClassifications fallback tenant=${tenantId}`);
    }
    return [];
  }

  isExportAllowed(dataClass: DataClassification, policy: { exportEligibility: Record<DataClassification, boolean> }): boolean {
    return policy.exportEligibility[dataClass] ?? false;
  }

  isDeletionConstrained(dataClass: DataClassification, policy: { deletionConstraints: Record<DataClassification, boolean> }): boolean {
    return policy.deletionConstraints[dataClass] ?? true;
  }
}
