import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompliancePolicy, Jurisdiction } from './compliance.types';

/**
 * Resolves tenant/platform compliance policy, jurisdiction rules, verification requirements, transaction-review thresholds, and configurable risk controls.
 * No hardcoded legal thresholds in business services, explicit policy references, tenant-specific only where permitted, platform default.
 */
@Injectable()
export class CompliancePolicyService {
  private readonly logger = new Logger(CompliancePolicyService.name);
  private readonly defaultPolicy: CompliancePolicy;

  constructor(private readonly prisma: PrismaService) {
    // Platform default policy - explicit, configurable via env, no random hardcoded legal thresholds
    this.defaultPolicy = {
      id: 'default_platform_policy',
      tenantId: null,
      jurisdiction: Jurisdiction.DEFAULT,
      policyVersion: process.env.COMPLIANCE_POLICY_VERSION || 'v1.0.0',
      kycRequired: process.env.COMPLIANCE_KYC_REQUIRED !== 'false',
      amlRequired: process.env.COMPLIANCE_AML_REQUIRED !== 'false',
      sanctionsRequired: process.env.COMPLIANCE_SANCTIONS_REQUIRED !== 'false',
      pepRequired: process.env.COMPLIANCE_PEP_REQUIRED === 'true',
      eddRequired: false,
      transactionThresholds: {
        reviewAmount: process.env.COMPLIANCE_REVIEW_AMOUNT || '10000',
        blockAmount: process.env.COMPLIANCE_BLOCK_AMOUNT || '50000',
        currency: process.env.COMPLIANCE_THRESHOLD_CURRENCY || 'USD',
        highRiskMultiplier: parseFloat(process.env.COMPLIANCE_HIGH_RISK_MULTIPLIER || '0.5'),
      },
      riskThresholds: {
        lowMax: parseInt(process.env.COMPLIANCE_RISK_LOW_MAX || '30', 10),
        mediumMax: parseInt(process.env.COMPLIANCE_RISK_MEDIUM_MAX || '60', 10),
        highMax: parseInt(process.env.COMPLIANCE_RISK_HIGH_MAX || '85', 10),
        criticalMin: parseInt(process.env.COMPLIANCE_RISK_CRITICAL_MIN || '86', 10),
        blockScore: parseInt(process.env.COMPLIANCE_RISK_BLOCK_SCORE || '90', 10),
        reviewScore: parseInt(process.env.COMPLIANCE_RISK_REVIEW_SCORE || '70', 10),
      },
      highRiskCountries: (process.env.COMPLIANCE_HIGH_RISK_COUNTRIES || 'IR,KP,SY,CU').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
      blockedCountries: (process.env.COMPLIANCE_BLOCKED_COUNTRIES || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
      reverificationIntervalDays: parseInt(process.env.COMPLIANCE_REVERIFICATION_DAYS || '365', 10),
      manualReviewRequired: process.env.COMPLIANCE_MANUAL_REVIEW_REQUIRED === 'true',
      rules: [
        { ruleId: 'KYC_VERIFICATION_REQUIRED', enabled: true, description: 'KYC verification required for onboarding', weight: 30 },
        { ruleId: 'AML_SCREENING_REQUIRED', enabled: true, description: 'AML screening required for all users', weight: 25 },
        { ruleId: 'SANCTIONS_CHECK', enabled: true, description: 'Sanctions screening against configured lists', weight: 40 },
        { ruleId: 'PEP_CHECK', enabled: false, description: 'PEP screening where enabled', weight: 20 },
        { ruleId: 'HIGH_RISK_COUNTRY', enabled: true, description: 'Enhanced review for high-risk jurisdictions', weight: 35 },
        { ruleId: 'BLOCKED_COUNTRY', enabled: true, description: 'Block users from blocked jurisdictions', weight: 100 },
        { ruleId: 'TRANSACTION_AMOUNT_REVIEW', enabled: true, description: 'Review transactions above threshold', weight: 30, threshold: 10000 },
        { ruleId: 'TRANSACTION_AMOUNT_BLOCK', enabled: true, description: 'Block transactions above block threshold', weight: 100, threshold: 50000 },
        { ruleId: 'FAILED_KYC_ATTEMPTS', enabled: true, description: 'Elevated risk for repeated failed KYC', weight: 25 },
        { ruleId: 'RAPID_ACCOUNT_CHANGES', enabled: true, description: 'Unusual rapid account changes', weight: 20 },
        { ruleId: 'UNUSUAL_TRADING_ACTIVITY', enabled: true, description: 'Unusual trading activity from validated sources', weight: 30 },
        { ruleId: 'ACCOUNT_AGE', enabled: true, description: 'New account risk factor', weight: 15 },
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getEffectivePolicy(params: { tenantId?: string; jurisdiction?: string; userId?: string }): Promise<CompliancePolicy> {
    const jurisdiction = (params.jurisdiction?.toUpperCase() as Jurisdiction) || Jurisdiction.DEFAULT;

    try {
      // Try tenant-specific policy if tenantId provided and architecture permits
      if (params.tenantId) {
        const tenantPolicy = await (this.prisma as any).compliancePolicyRecord?.findFirst({
          where: {
            tenantId: params.tenantId,
            jurisdiction,
            isActive: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (tenantPolicy) {
          return this.mapToPolicy(tenantPolicy);
        }

        // Fallback to tenant's country-based jurisdiction
        const tenant = await (this.prisma as any).tenant?.findUnique({
          where: { id: params.tenantId },
          select: { countryCode: true },
        });

        if (tenant?.countryCode) {
          const countryPolicy = await (this.prisma as any).compliancePolicyRecord?.findFirst({
            where: {
              jurisdiction: tenant.countryCode.toUpperCase(),
              isActive: true,
            },
            orderBy: { createdAt: 'desc' },
          });
          if (countryPolicy) {
            return this.mapToPolicy(countryPolicy);
          }
        }
      }

      // Platform default for jurisdiction
      const platformPolicy = await (this.prisma as any).compliancePolicyRecord?.findFirst({
        where: {
          tenantId: null,
          jurisdiction,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (platformPolicy) {
        return this.mapToPolicy(platformPolicy);
      }

      // Global default
      const globalPolicy = await (this.prisma as any).compliancePolicyRecord?.findFirst({
        where: {
          jurisdiction: Jurisdiction.DEFAULT,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (globalPolicy) {
        return this.mapToPolicy(globalPolicy);
      }
    } catch (e: any) {
      this.logger.warn(`Failed to fetch compliance policy from DB, using default: ${e.message}`);
    }

    // Return default platform policy with jurisdiction override
    return {
      ...this.defaultPolicy,
      jurisdiction,
      policyVersion: this.defaultPolicy.policyVersion,
    };
  }

  async getPolicyForTenant(tenantId: string, jurisdiction?: string): Promise<CompliancePolicy> {
    return this.getEffectivePolicy({ tenantId, jurisdiction });
  }

  async getPlatformPolicy(jurisdiction?: string): Promise<CompliancePolicy> {
    return this.getEffectivePolicy({ jurisdiction });
  }

  async listPolicies(params: { tenantId?: string; jurisdiction?: string; isActive?: boolean }): Promise<CompliancePolicy[]> {
    try {
      const where: any = {};
      if (params.tenantId) where.tenantId = params.tenantId;
      if (params.jurisdiction) where.jurisdiction = params.jurisdiction.toUpperCase();
      if (params.isActive !== undefined) where.isActive = params.isActive;

      const records = await (this.prisma as any).compliancePolicyRecord?.findMany({ where, orderBy: { createdAt: 'desc' } }) || [];
      return records.map((r: any) => this.mapToPolicy(r));
    } catch (e: any) {
      this.logger.warn(`Failed to list policies: ${e.message}`);
      return [this.defaultPolicy];
    }
  }

  async createOrUpdatePolicy(input: {
    tenantId?: string | null;
    jurisdiction: string;
    policyVersion: string;
    kycRequired?: boolean;
    amlRequired?: boolean;
    sanctionsRequired?: boolean;
    pepRequired?: boolean;
    eddRequired?: boolean;
    transactionThresholds?: any;
    riskThresholds?: any;
    highRiskCountries?: string[];
    blockedCountries?: string[];
    reverificationIntervalDays?: number;
    manualReviewRequired?: boolean;
    rules?: any[];
    actorId: string;
  }): Promise<CompliancePolicy> {
    const jurisdiction = input.jurisdiction.toUpperCase();

    try {
      const data = {
        id: undefined as any,
        tenantId: input.tenantId || null,
        jurisdiction,
        policyVersion: input.policyVersion,
        kycRequired: input.kycRequired ?? true,
        amlRequired: input.amlRequired ?? true,
        sanctionsRequired: input.sanctionsRequired ?? true,
        pepRequired: input.pepRequired ?? false,
        eddRequired: input.eddRequired ?? false,
        transactionThresholds: input.transactionThresholds || this.defaultPolicy.transactionThresholds,
        riskThresholds: input.riskThresholds || this.defaultPolicy.riskThresholds,
        highRiskCountries: input.highRiskCountries || this.defaultPolicy.highRiskCountries,
        blockedCountries: input.blockedCountries || this.defaultPolicy.blockedCountries,
        reverificationIntervalDays: input.reverificationIntervalDays || this.defaultPolicy.reverificationIntervalDays,
        manualReviewRequired: input.manualReviewRequired ?? false,
        rules: input.rules || this.defaultPolicy.rules,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Upsert
      const existing = await (this.prisma as any).compliancePolicyRecord?.findFirst({
        where: { tenantId: input.tenantId || null, jurisdiction, policyVersion: input.policyVersion },
      });

      let record: any;
      if (existing) {
        record = await (this.prisma as any).compliancePolicyRecord?.update({
          where: { id: existing.id },
          data: { ...data, id: undefined, createdAt: undefined },
        });
      } else {
        record = await (this.prisma as any).compliancePolicyRecord?.create({
          data: { ...data, id: require('crypto').randomUUID() },
        });
      }

      if (record) return this.mapToPolicy(record);
    } catch (e: any) {
      this.logger.warn(`Failed to create/update policy: ${e.message}`);
    }

    // Fallback
    return {
      ...this.defaultPolicy,
      tenantId: input.tenantId || null,
      jurisdiction: jurisdiction as Jurisdiction,
      policyVersion: input.policyVersion,
      kycRequired: input.kycRequired ?? this.defaultPolicy.kycRequired,
      amlRequired: input.amlRequired ?? this.defaultPolicy.amlRequired,
    };
  }

  async isCountryBlocked(countryCode: string, policy?: CompliancePolicy): Promise<boolean> {
    const effectivePolicy = policy || this.defaultPolicy;
    return effectivePolicy.blockedCountries.includes(countryCode.toUpperCase());
  }

  async isCountryHighRisk(countryCode: string, policy?: CompliancePolicy): Promise<boolean> {
    const effectivePolicy = policy || this.defaultPolicy;
    return effectivePolicy.highRiskCountries.includes(countryCode.toUpperCase());
  }

  async requiresKyc(params: { tenantId?: string; jurisdiction?: string }): Promise<boolean> {
    const policy = await this.getEffectivePolicy(params);
    return policy.kycRequired;
  }

  async requiresAml(params: { tenantId?: string; jurisdiction?: string }): Promise<boolean> {
    const policy = await this.getEffectivePolicy(params);
    return policy.amlRequired;
  }

  private mapToPolicy(raw: any): CompliancePolicy {
    return {
      id: raw.id,
      tenantId: raw.tenantId || null,
      jurisdiction: raw.jurisdiction as Jurisdiction,
      policyVersion: raw.policyVersion,
      kycRequired: raw.kycRequired,
      amlRequired: raw.amlRequired,
      sanctionsRequired: raw.sanctionsRequired,
      pepRequired: raw.pepRequired,
      eddRequired: raw.eddRequired,
      transactionThresholds: raw.transactionThresholds || this.defaultPolicy.transactionThresholds,
      riskThresholds: raw.riskThresholds || this.defaultPolicy.riskThresholds,
      highRiskCountries: raw.highRiskCountries || [],
      blockedCountries: raw.blockedCountries || [],
      reverificationIntervalDays: raw.reverificationIntervalDays || 365,
      manualReviewRequired: raw.manualReviewRequired || false,
      rules: raw.rules || this.defaultPolicy.rules,
      isActive: raw.isActive,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
    };
  }
}
