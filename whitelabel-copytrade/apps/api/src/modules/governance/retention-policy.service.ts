import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GovernancePolicyService } from './governance-policy.service';
import { DataClassification, RetentionRule, RetentionState } from './governance.types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface RetentionPolicyRecord {
  id: string;
  tenantId?: string | null;
  dataClass: DataClassification;
  jurisdiction: string;
  retentionPeriodDays: number;
  retentionStartEvent: string;
  eligibleAction: 'DELETE' | 'ANONYMIZE' | 'REVIEW' | 'PRESERVE';
  policyVersion: string;
  legalHoldOverride: boolean;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
  correlationId: string;
}

@Injectable()
export class RetentionPolicyService {
  private readonly logger = new Logger(RetentionPolicyService.name);

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async getPolicies(tenantId: string | null, jurisdiction: string): Promise<RetentionPolicyRecord[]> {
    this.policyService.validateJurisdiction(jurisdiction);
    const policy = this.policyService.buildPolicy(tenantId, jurisdiction);
    return policy.retentionRules.map((r) => ({
      id: `retpol_${r.dataClass}_${r.jurisdiction}_${r.policyVersion}`,
      tenantId,
      dataClass: r.dataClass,
      jurisdiction: r.jurisdiction,
      retentionPeriodDays: r.retentionPeriodDays,
      retentionStartEvent: r.retentionStartEvent,
      eligibleAction: r.eligibleAction,
      policyVersion: r.policyVersion,
      legalHoldOverride: r.legalHoldOverride,
      requiresApproval: r.requiresApproval,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      correlationId: `corr_${Date.now()}`,
    }));
  }

  async getPolicyForClass(tenantId: string | null, dataClass: DataClassification, jurisdiction: string): Promise<RetentionPolicyRecord> {
    this.policyService.validateJurisdiction(jurisdiction);
    const policy = this.policyService.buildPolicy(tenantId, jurisdiction);
    const rule = policy.retentionRules.find((r) => r.dataClass === dataClass && r.jurisdiction === jurisdiction.toUpperCase());
    if (!rule) throw new BadRequestException(`no retention rule for ${dataClass} in ${jurisdiction}`);
    return {
      id: `retpol_${rule.dataClass}_${rule.jurisdiction}_${rule.policyVersion}`,
      tenantId,
      dataClass: rule.dataClass,
      jurisdiction: rule.jurisdiction,
      retentionPeriodDays: rule.retentionPeriodDays,
      retentionStartEvent: rule.retentionStartEvent,
      eligibleAction: rule.eligibleAction,
      policyVersion: rule.policyVersion,
      legalHoldOverride: rule.legalHoldOverride,
      requiresApproval: rule.requiresApproval,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      correlationId: `corr_${Date.now()}`,
    };
  }

  calculateRetentionEnd(startAt: string, periodDays: number): string {
    if (!startAt) throw new BadRequestException('startAt required');
    if (!periodDays || periodDays <= 0) throw new BadRequestException('periodDays must be positive');
    const start = new Date(startAt);
    if (isNaN(start.getTime())) throw new BadRequestException('invalid startAt');
    const end = new Date(start.getTime() + periodDays * 24 * 60 * 60 * 1000);
    return end.toISOString();
  }

  evaluateRetentionState(params: { retentionEndAt: string; hasLegalHold: boolean; eligibleAction: string }): RetentionState {
    if (params.hasLegalHold) return RetentionState.BLOCKED_BY_LEGAL_HOLD;
    const now = new Date();
    const end = new Date(params.retentionEndAt);
    if (isNaN(end.getTime())) throw new BadRequestException('invalid retentionEndAt');
    if (now < end) return RetentionState.RETENTION_REQUIRED;
    if (params.eligibleAction === 'DELETE') return RetentionState.ELIGIBLE_FOR_DELETION;
    if (params.eligibleAction === 'ANONYMIZE') return RetentionState.ELIGIBLE_FOR_ANONYMIZATION;
    if (params.eligibleAction === 'PRESERVE') return RetentionState.PRESERVED;
    return RetentionState.ELIGIBLE_FOR_REVIEW;
  }

  validateNoInventedPeriod(dataClass: DataClassification, jurisdiction: string, periodDays: number): void {
    const policy = this.policyService.buildPolicy(null, jurisdiction);
    const rule = policy.retentionRules.find((r) => r.dataClass === dataClass);
    if (!rule) throw new BadRequestException(`no rule for ${dataClass}`);
    // Period must come from policy, not invented - allow exact match only, otherwise require policy version
    if (rule.retentionPeriodDays !== periodDays) {
      throw new BadRequestException(`invented retention period ${periodDays} for ${dataClass}, expected ${rule.retentionPeriodDays} from policy ${rule.policyVersion}`);
    }
  }
}
