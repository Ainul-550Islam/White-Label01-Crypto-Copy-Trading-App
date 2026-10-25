// # Responsibility: compute tenant-bound risk evidence from canonical sources and retain persisted JSON provenance without fake successful fallbacks.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { KycProfile, ComplianceScreeningRequest, TransactionMonitoringSignal } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompliancePolicyService, complianceJsonInput, complianceObject } from './compliance-policy.service';
import { ComplianceAuditService } from './compliance-audit.service';
import { RiskLevel, RiskScore, ComplianceDecision, AmlState, type CompliancePolicy } from './compliance.types';
import { randomUUID } from 'crypto';

/**
 * Computes explicit, rule-based risk score per user with policy version and explicit ruleIds.
 * Inputs: KYC status, AML result, account age, transaction history, country risk, failed attempts, trading behavior.
 * No opaque magic numbers.
 */
@Injectable()
export class RiskScoringService {
  private readonly logger = new Logger(RiskScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: CompliancePolicyService,
    private readonly auditService: ComplianceAuditService,
  ) {}

  async calculateRiskScore(params: { tenantId: string; userId: string; jurisdiction?: string; idempotencyKey?: string }): Promise<RiskScore> {
    const jurisdiction = params.jurisdiction || 'DEFAULT';
    const idempotencyKey = params.idempotencyKey || `risk_${params.tenantId}_${params.userId}_${Date.now()}`;

    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId, jurisdiction });

    const contributingRules: { ruleId: string; weight: number; score: number; description: string }[] = [];
    let totalScore = 0;
    let totalWeight = 0;

    // Gather inputs
    const kycProfile = await this.getKycProfile(params.tenantId, params.userId);
    const amlRequests = await this.getAmlRequests(params.tenantId, params.userId);
    const user = await this.getUser(params.tenantId, params.userId);
    if (!user) throw new BadRequestException('Risk-scoring user not found for this tenant');
    const transactionSignals = await this.getTransactionSignals(params.tenantId, params.userId);
    const failedKycAttempts = await this.getFailedKycAttempts(params.tenantId, params.userId);

    // Rule: KYC_VERIFICATION_REQUIRED
    const kycRule = policy.rules.find((r) => r.ruleId === 'KYC_VERIFICATION_REQUIRED');
    if (kycRule?.enabled) {
      let score = 0;
      if (!kycProfile || kycProfile.status === 'NOT_STARTED') score = 80;
      else if (kycProfile.status === 'PENDING' || kycProfile.status === 'IN_REVIEW') score = 50;
      else if (kycProfile.status === 'REJECTED') score = 100;
      else if (kycProfile.status === 'EXPIRED') score = 70;
      else if (kycProfile.status === 'APPROVED') score = 0;

      contributingRules.push({ ruleId: 'KYC_VERIFICATION_REQUIRED', weight: kycRule.weight ?? 30, score, description: kycRule.description });
      totalScore += score * (kycRule.weight ?? 30);
      totalWeight += kycRule.weight ?? 30;
    }

    // Rule: AML_SCREENING_REQUIRED
    const amlRule = policy.rules.find((r) => r.ruleId === 'AML_SCREENING_REQUIRED');
    if (amlRule?.enabled) {
      let score = 0;
      const latestAml = amlRequests[0];
      if (!latestAml) score = 60;
      else if (latestAml.amlState === AmlState.MATCH) score = 100;
      else if (latestAml.amlState === AmlState.BLOCKED) score = 100;
      else if (latestAml.amlState === AmlState.POTENTIAL_MATCH) score = 70;
      else if (latestAml.amlState === AmlState.REVIEW_REQUIRED) score = 60;
      else if (latestAml.amlState === AmlState.PROVIDER_UNAVAILABLE) score = 40;
      else if (latestAml.amlState === AmlState.CLEAR) score = 0;

      contributingRules.push({ ruleId: 'AML_SCREENING_REQUIRED', weight: amlRule.weight ?? 25, score, description: amlRule.description });
      totalScore += score * (amlRule.weight ?? 25);
      totalWeight += amlRule.weight ?? 25;
    }

    // Rule: SANCTIONS_CHECK
    const sanctionsRule = policy.rules.find((r) => r.ruleId === 'SANCTIONS_CHECK');
    if (sanctionsRule?.enabled) {
      let score = 0;
      const hasMatch = amlRequests.some((r) => r.amlState === AmlState.MATCH || r.amlState === AmlState.BLOCKED);
      if (hasMatch) score = 100;
      contributingRules.push({ ruleId: 'SANCTIONS_CHECK', weight: sanctionsRule.weight ?? 40, score, description: sanctionsRule.description });
      totalScore += score * (sanctionsRule.weight ?? 40);
      totalWeight += sanctionsRule.weight ?? 40;
    }

    // Rule: HIGH_RISK_COUNTRY
    const highRiskRule = policy.rules.find((r) => r.ruleId === 'HIGH_RISK_COUNTRY');
    if (highRiskRule?.enabled && user?.countryCode) {
      const isHighRisk = await this.policyService.isCountryHighRisk(user.countryCode, policy);
      const score = isHighRisk ? 80 : 0;
      contributingRules.push({ ruleId: 'HIGH_RISK_COUNTRY', weight: highRiskRule.weight ?? 35, score, description: `${highRiskRule.description} country=${user.countryCode}` });
      totalScore += score * (highRiskRule.weight ?? 35);
      totalWeight += highRiskRule.weight ?? 35;
    }

    // Rule: BLOCKED_COUNTRY
    const blockedRule = policy.rules.find((r) => r.ruleId === 'BLOCKED_COUNTRY');
    if (blockedRule?.enabled && user?.countryCode) {
      const isBlocked = await this.policyService.isCountryBlocked(user.countryCode, policy);
      const score = isBlocked ? 100 : 0;
      contributingRules.push({ ruleId: 'BLOCKED_COUNTRY', weight: blockedRule.weight ?? 100, score, description: `${blockedRule.description} country=${user.countryCode}` });
      totalScore += score * (blockedRule.weight ?? 100);
      totalWeight += blockedRule.weight ?? 100;
    }

    // Rule: FAILED_KYC_ATTEMPTS
    const failedKycRule = policy.rules.find((r) => r.ruleId === 'FAILED_KYC_ATTEMPTS');
    if (failedKycRule?.enabled) {
      let score = 0;
      if (failedKycAttempts >= 3) score = 80;
      else if (failedKycAttempts >= 2) score = 50;
      else if (failedKycAttempts >= 1) score = 20;
      contributingRules.push({ ruleId: 'FAILED_KYC_ATTEMPTS', weight: failedKycRule.weight ?? 25, score, description: `${failedKycRule.description} attempts=${failedKycAttempts}` });
      totalScore += score * (failedKycRule.weight ?? 25);
      totalWeight += failedKycRule.weight ?? 25;
    }

    // Rule: TRANSACTION_AMOUNT_REVIEW / UNUSUAL_TRADING_ACTIVITY
    const txRule = policy.rules.find((r) => r.ruleId === 'UNUSUAL_TRADING_ACTIVITY');
    if (txRule?.enabled) {
      let score = 0;
      if (transactionSignals.length > 5) score = 60;
      else if (transactionSignals.length > 2) score = 30;
      contributingRules.push({ ruleId: 'UNUSUAL_TRADING_ACTIVITY', weight: txRule.weight ?? 30, score, description: `${txRule.description} signals=${transactionSignals.length}` });
      totalScore += score * (txRule.weight ?? 30);
      totalWeight += txRule.weight ?? 30;
    }

    // Rule: ACCOUNT_AGE
    const ageRule = policy.rules.find((r) => r.ruleId === 'ACCOUNT_AGE');
    if (ageRule?.enabled && user?.createdAt) {
      const ageDays = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      let score = 0;
      if (ageDays < 1) score = 50;
      else if (ageDays < 7) score = 30;
      else if (ageDays < 30) score = 10;
      contributingRules.push({ ruleId: 'ACCOUNT_AGE', weight: ageRule.weight ?? 15, score, description: `${ageRule.description} ageDays=${ageDays.toFixed(1)}` });
      totalScore += score * (ageRule.weight ?? 15);
      totalWeight += ageRule.weight ?? 15;
    }

    const finalScore = totalWeight > 0 ? Math.min(100, Math.round(totalScore / totalWeight)) : 0;
    const riskLevel = this.mapScoreToRiskLevel(finalScore, policy);

    const riskScore: RiskScore = {
      userId: params.userId,
      tenantId: params.tenantId,
      score: finalScore,
      riskLevel,
      contributingRules,
      policyVersion: policy.policyVersion,
      calculatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      methodology: 'weighted_rule_based_v1',
    };

    // Persist
    try {
      await this.prisma.riskScoreRecord.create({
        data: {
          id: randomUUID(),
          tenantId: params.tenantId,
          userId: params.userId,
          score: finalScore,
          riskLevel,
          ruleIds: contributingRules.map((r) => r.ruleId),
          policyVersion: policy.policyVersion,
          // RiskScoreRecord keeps rules, methodology and context in contributingFactors.
          contributingFactors: complianceJsonInput({ rules: contributingRules, methodology: 'weighted_rule_based_v1', jurisdiction, totalWeight }),
          calculatedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          idempotencyKey,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to persist risk score: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }

    await this.auditService.recordRiskScoreCalculated(params.tenantId, params.userId, finalScore, riskLevel, contributingRules.map((r) => r.ruleId));

    return riskScore;
  }

  async getLatestScore(tenantId: string, userId: string): Promise<RiskScore | null> {
    const record = await this.prisma.riskScoreRecord.findFirst({
      where: { tenantId, userId },
      orderBy: { calculatedAt: 'desc' },
    });

    if (!record) return null;
    if (!Number.isSafeInteger(record.score) || record.score < 0 || record.score > 100) throw new Error('Persisted risk score is invalid');

    const factors = complianceObject(record.contributingFactors);
    if (!factors || !Array.isArray(factors.rules) || typeof factors.methodology !== 'string') {
      throw new Error('Persisted risk-score provenance is unavailable or malformed');
    }
    const rules: unknown[] = factors.rules;
    const contributingRules: RiskScore['contributingRules'] = rules.map((entry) => {
      const rule = complianceObject(entry);
      if (!rule || typeof rule.ruleId !== 'string' || typeof rule.weight !== 'number' || !Number.isFinite(rule.weight)
        || rule.weight < 0 || typeof rule.score !== 'number' || !Number.isFinite(rule.score) || rule.score < 0 || rule.score > 100 || typeof rule.description !== 'string') {
        throw new Error('Persisted risk-score rule provenance is malformed');
      }
      return { ruleId: rule.ruleId, weight: rule.weight, score: rule.score, description: rule.description };
    });
    const riskLevel = Object.values(RiskLevel).find((value) => value === record.riskLevel);
    if (!riskLevel) throw new Error('Persisted risk level is invalid');

    return {
      userId: record.userId,
      tenantId: record.tenantId,
      score: record.score,
      riskLevel,
      contributingRules,
      policyVersion: record.policyVersion,
      calculatedAt: new Date(record.calculatedAt).toISOString(),
      expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : undefined,
      methodology: factors.methodology,
    };
  }

  async evaluateDecision(params: { tenantId: string; userId: string; jurisdiction?: string }): Promise<{ decision: ComplianceDecision; riskLevel: RiskLevel; riskScore: number; reasonCodes: string[]; ruleIds: string[] }> {
    const riskScore = await this.calculateRiskScore(params);
    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId, jurisdiction: params.jurisdiction });

    let decision: ComplianceDecision = ComplianceDecision.ALLOW;
    const reasonCodes: string[] = [];

    if (riskScore.score >= (policy.riskThresholds.blockScore || 90)) {
      decision = ComplianceDecision.BLOCK;
      reasonCodes.push('RISK_SCORE_BLOCK');
    } else if (riskScore.score >= (policy.riskThresholds.reviewScore || 70)) {
      decision = ComplianceDecision.REVIEW_REQUIRED;
      reasonCodes.push('RISK_SCORE_REVIEW');
    } else if (riskScore.riskLevel === RiskLevel.HIGH) {
      decision = ComplianceDecision.RESTRICT;
      reasonCodes.push('HIGH_RISK');
    }

    // Blocked country overrides
    const user = await this.getUser(params.tenantId, params.userId);
    if (user?.countryCode && (await this.policyService.isCountryBlocked(user.countryCode, policy))) {
      decision = ComplianceDecision.BLOCK;
      reasonCodes.push('BLOCKED_COUNTRY');
    }

    return {
      decision,
      riskLevel: riskScore.riskLevel,
      riskScore: riskScore.score,
      reasonCodes,
      ruleIds: riskScore.contributingRules.map((r) => r.ruleId),
    };
  }

  private mapScoreToRiskLevel(score: number, policy: CompliancePolicy): RiskLevel {
    if (score <= policy.riskThresholds.lowMax) return RiskLevel.LOW;
    if (score <= policy.riskThresholds.mediumMax) return RiskLevel.MEDIUM;
    if (score <= policy.riskThresholds.highMax) return RiskLevel.HIGH;
    if (score >= policy.riskThresholds.criticalMin) return RiskLevel.CRITICAL;
    return RiskLevel.UNKNOWN;
  }

  private async getKycProfile(tenantId: string, userId: string): Promise<KycProfile | null> {
    return await this.prisma.kycProfile.findFirst({ where: { tenantId, userId } });
  }

  private async getAmlRequests(tenantId: string, userId: string): Promise<ComplianceScreeningRequest[]> {
    return await this.prisma.complianceScreeningRequest.findMany({
      where: { tenantId, userId, type: { in: ['AML', 'TRANSACTION'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  private async getUser(tenantId: string, userId: string): Promise<{ createdAt: Date; countryCode: string | null } | null> {
    // The user's country lives on UserProfile (User has no countryCode column).
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { createdAt: true, profile: { select: { countryCode: true } } },
    });
    return user ? { createdAt: user.createdAt, countryCode: user.profile?.countryCode ?? null } : null;
  }

  private async getTransactionSignals(tenantId: string, userId: string): Promise<TransactionMonitoringSignal[]> {
    return await this.prisma.transactionMonitoringSignal.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  private async getFailedKycAttempts(tenantId: string, userId: string): Promise<number> {
    const count = await this.prisma.complianceScreeningRequest.count({
      where: { tenantId, userId, type: 'KYC', kycState: 'REJECTED' },
    });
    return count;
  }
}
