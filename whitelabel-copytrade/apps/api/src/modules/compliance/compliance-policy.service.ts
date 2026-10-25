// # Responsibility: resolve tenant and platform compliance policy records and jurisdiction controls.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma, type CompliancePolicyRecord } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
    // Invalid configured defaults are not silently transformed into permissive policy evidence.
    this.transactionThresholds(this.defaultPolicy.transactionThresholds);
    this.riskThresholds(this.defaultPolicy.riskThresholds);
    this.policyRules(this.defaultPolicy.rules);
  }

  async getEffectivePolicy(params: { tenantId?: string; jurisdiction?: string; userId?: string }): Promise<CompliancePolicy> {
    const jurisdiction = this.jurisdiction(params.jurisdiction || Jurisdiction.DEFAULT);
    try {
      if (params.tenantId) {
        const tenantPolicy = await this.prisma.compliancePolicyRecord.findFirst({
          where: { tenantId: params.tenantId, jurisdiction, isActive: true }, orderBy: { createdAt: 'desc' },
        });
        if (tenantPolicy) return this.mapToPolicy(tenantPolicy);
        const tenant = await this.prisma.tenant.findUnique({ where: { id: params.tenantId }, select: { countryCode: true } });
        if (tenant?.countryCode) {
          const countryPolicy = await this.prisma.compliancePolicyRecord.findFirst({
            where: { tenantId: null, jurisdiction: tenant.countryCode.toUpperCase(), isActive: true },
            orderBy: { createdAt: 'desc' },
          });
          if (countryPolicy) return this.mapToPolicy(countryPolicy);
        }
      }
      const platformPolicy = await this.prisma.compliancePolicyRecord.findFirst({
        where: { tenantId: null, jurisdiction, isActive: true }, orderBy: { createdAt: 'desc' },
      });
      if (platformPolicy) return this.mapToPolicy(platformPolicy);
      const globalPolicy = await this.prisma.compliancePolicyRecord.findFirst({
        where: { tenantId: null, jurisdiction: Jurisdiction.DEFAULT, isActive: true }, orderBy: { createdAt: 'desc' },
      });
      if (globalPolicy) return this.mapToPolicy(globalPolicy);
    } catch (error) {
      this.logger.warn(`Compliance policy evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    // Only confirmed absence permits the explicitly configured platform default, never a failed read.
    return { ...structuredClone(this.defaultPolicy), jurisdiction };
  }

  async getPolicyForTenant(tenantId: string, jurisdiction?: string): Promise<CompliancePolicy> {
    return this.getEffectivePolicy({ tenantId, jurisdiction });
  }

  async getPlatformPolicy(jurisdiction?: string): Promise<CompliancePolicy> {
    return this.getEffectivePolicy({ jurisdiction });
  }

  async listPolicies(params: { tenantId?: string; jurisdiction?: string; isActive?: boolean }): Promise<CompliancePolicy[]> {
    const where: Prisma.CompliancePolicyRecordWhereInput = {};
    if (params.tenantId) where.tenantId = params.tenantId;
    if (params.jurisdiction) where.jurisdiction = params.jurisdiction.toUpperCase();
    if (params.isActive !== undefined) where.isActive = params.isActive;
    const records = await this.prisma.compliancePolicyRecord.findMany({ where, orderBy: { createdAt: 'desc' } });
    return records.map((record) => this.mapToPolicy(record));
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
    transactionThresholds?: CompliancePolicy['transactionThresholds'];
    riskThresholds?: CompliancePolicy['riskThresholds'];
    highRiskCountries?: string[];
    blockedCountries?: string[];
    reverificationIntervalDays?: number;
    manualReviewRequired?: boolean;
    rules?: CompliancePolicy['rules'];
    actorId: string;
  }): Promise<CompliancePolicy> {
    const jurisdiction = this.jurisdiction(input.jurisdiction);
    const transactionThresholds = this.transactionThresholds(complianceJsonInput(input.transactionThresholds ?? this.defaultPolicy.transactionThresholds));
    const riskThresholds = this.riskThresholds(complianceJsonInput(input.riskThresholds ?? this.defaultPolicy.riskThresholds));
    const rules = this.policyRules(complianceJsonInput(input.rules ?? this.defaultPolicy.rules));
    const data: Omit<Prisma.CompliancePolicyRecordUncheckedCreateInput, 'id'> = {
      tenantId: input.tenantId ?? null, jurisdiction, policyVersion: input.policyVersion,
      kycRequired: input.kycRequired ?? true, amlRequired: input.amlRequired ?? true,
      sanctionsRequired: input.sanctionsRequired ?? true, pepRequired: input.pepRequired ?? false, eddRequired: input.eddRequired ?? false,
      transactionThresholds: complianceJsonInput(transactionThresholds), riskThresholds: complianceJsonInput(riskThresholds),
      highRiskCountries: input.highRiskCountries ?? this.defaultPolicy.highRiskCountries,
      blockedCountries: input.blockedCountries ?? this.defaultPolicy.blockedCountries,
      reverificationIntervalDays: input.reverificationIntervalDays ?? this.defaultPolicy.reverificationIntervalDays,
      manualReviewRequired: input.manualReviewRequired ?? false, rules: complianceJsonInput(rules), isActive: true,
      updatedAt: new Date(),
    };
    const existing = await this.prisma.compliancePolicyRecord.findFirst({
      where: { tenantId: input.tenantId ?? null, jurisdiction, policyVersion: input.policyVersion },
    });
    const record = existing
      ? await this.prisma.compliancePolicyRecord.update({ where: { id: existing.id, tenantId: input.tenantId ?? null }, data })
      : await this.prisma.compliancePolicyRecord.create({ data: { ...data, id: randomUUID() } });
    // Required persistence failure propagates; it must never manufacture a successful policy update.
    return this.mapToPolicy(record);
  }

  async isCountryBlocked(countryCode: string, policy?: CompliancePolicy): Promise<boolean> {
    return (policy || this.defaultPolicy).blockedCountries.includes(countryCode.toUpperCase());
  }

  async isCountryHighRisk(countryCode: string, policy?: CompliancePolicy): Promise<boolean> {
    return (policy || this.defaultPolicy).highRiskCountries.includes(countryCode.toUpperCase());
  }

  async requiresKyc(params: { tenantId?: string; jurisdiction?: string }): Promise<boolean> {
    return (await this.getEffectivePolicy(params)).kycRequired;
  }

  async requiresAml(params: { tenantId?: string; jurisdiction?: string }): Promise<boolean> {
    return (await this.getEffectivePolicy(params)).amlRequired;
  }

  private jurisdiction(value: string): string {
    const jurisdiction = value.toUpperCase();
    if (!Object.values(Jurisdiction).some((member) => member === jurisdiction) && !/^[A-Z]{2}$/.test(jurisdiction)) {
      throw new BadRequestException('Unsupported compliance jurisdiction');
    }
    return jurisdiction;
  }

  private transactionThresholds(value: unknown): CompliancePolicy['transactionThresholds'] {
    const record = complianceObject(value);
    if (!record) throw new Error('Compliance transaction thresholds must be an object');
    const readAmount = (key: 'reviewAmount' | 'blockAmount'): string | undefined => {
      const amount = record[key];
      if (amount === undefined) return this.defaultPolicy.transactionThresholds[key];
      if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) throw new Error('Invalid compliance transaction threshold');
      return amount;
    };
    const currency = record.currency ?? this.defaultPolicy.transactionThresholds.currency;
    if (typeof currency !== 'string' || !currency) throw new Error('Invalid compliance threshold currency');
    const multiplier = record.highRiskMultiplier ?? this.defaultPolicy.transactionThresholds.highRiskMultiplier;
    if (multiplier !== undefined && (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 0)) {
      throw new Error('Invalid compliance risk multiplier');
    }
    return { reviewAmount: readAmount('reviewAmount'), blockAmount: readAmount('blockAmount'), currency, highRiskMultiplier: multiplier };
  }

  private riskThresholds(value: unknown): CompliancePolicy['riskThresholds'] {
    const record = complianceObject(value);
    if (!record) throw new Error('Compliance risk thresholds must be an object');
    const number = (key: keyof CompliancePolicy['riskThresholds']): number => {
      const threshold = record[key] ?? this.defaultPolicy.riskThresholds[key];
      if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
        throw new Error('Invalid compliance risk threshold');
      }
      return threshold;
    };
    const thresholds = { lowMax: number('lowMax'), mediumMax: number('mediumMax'), highMax: number('highMax'), criticalMin: number('criticalMin'),
      blockScore: number('blockScore'), reviewScore: number('reviewScore') };
    if (thresholds.lowMax > thresholds.mediumMax || thresholds.mediumMax > thresholds.highMax
      || thresholds.highMax >= thresholds.criticalMin || thresholds.reviewScore > thresholds.blockScore) {
      throw new Error('Compliance risk thresholds must be ordered');
    }
    return thresholds;
  }

  private policyRules(value: unknown): CompliancePolicy['rules'] {
    if (!Array.isArray(value)) throw new Error('Compliance rules must be an array');
    const entries: unknown[] = value;
    return entries.map((entry) => {
      const rule = complianceObject(entry);
      if (!rule || typeof rule.ruleId !== 'string' || typeof rule.enabled !== 'boolean' || typeof rule.description !== 'string') {
        throw new Error('Invalid compliance rule');
      }
      const optionalNumber = (key: 'weight' | 'threshold'): number | undefined => {
        const number = rule[key];
        if (number === undefined) return undefined;
        if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) throw new Error('Invalid compliance rule numeric value');
        return number;
      };
      return { ruleId: rule.ruleId, enabled: rule.enabled, description: rule.description,
        weight: optionalNumber('weight'), threshold: optionalNumber('threshold') };
    });
  }

  private mapToPolicy(raw: CompliancePolicyRecord): CompliancePolicy {
    return {
      id: raw.id, tenantId: raw.tenantId, jurisdiction: this.jurisdiction(raw.jurisdiction), policyVersion: raw.policyVersion,
      kycRequired: raw.kycRequired, amlRequired: raw.amlRequired, sanctionsRequired: raw.sanctionsRequired,
      pepRequired: raw.pepRequired, eddRequired: raw.eddRequired,
      transactionThresholds: this.transactionThresholds(raw.transactionThresholds), riskThresholds: this.riskThresholds(raw.riskThresholds),
      highRiskCountries: raw.highRiskCountries, blockedCountries: raw.blockedCountries,
      reverificationIntervalDays: raw.reverificationIntervalDays, manualReviewRequired: raw.manualReviewRequired,
      rules: this.policyRules(raw.rules), isActive: raw.isActive, createdAt: raw.createdAt.toISOString(), updatedAt: raw.updatedAt.toISOString(),
    };
  }
}

// # Responsibility: narrow compliance JSON values before accessing metadata or writing canonical JSON columns.
export function complianceObject(value: unknown): Record<string, unknown> | null {
  return isComplianceObject(value) ? value : null;
}

export function complianceJsonInput(value: unknown): Prisma.InputJsonValue {
  assertFiniteComplianceEvidence(value, new WeakSet<object>());
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Compliance evidence is not JSON serializable');
  const parsed: unknown = JSON.parse(serialized);
  if (parsed === null || !isComplianceJsonValue(parsed)) throw new Error('Invalid compliance JSON evidence');
  return parsed;
}

function isComplianceJsonValue(value: unknown): value is Prisma.InputJsonValue | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    const entries: unknown[] = value;
    return entries.every((entry) => isComplianceJsonValue(entry));
  }
  const object = complianceObject(value);
  return object !== null && Object.values(object).every((entry) => isComplianceJsonValue(entry));
}

function isComplianceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertFiniteComplianceEvidence(value: unknown, seen: WeakSet<object>): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite compliance JSON evidence');
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Circular compliance JSON evidence');
    seen.add(value);
    const entries: unknown[] = value;
    entries.forEach((entry) => assertFiniteComplianceEvidence(entry, seen));
    seen.delete(value);
    return;
  }
  const object = complianceObject(value);
  if (object) {
    if (seen.has(object)) throw new Error('Circular compliance JSON evidence');
    seen.add(object);
    Object.values(object).forEach((entry) => assertFiniteComplianceEvidence(entry, seen));
    seen.delete(object);
  }
}
