import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompliancePolicyService } from './compliance-policy.service';
import { ComplianceAuditService } from './compliance-audit.service';
import { RiskLevel, RiskScore, ComplianceDecision, KycState, AmlState, sanitizeMetadata } from './compliance.types';
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
    const kycProfile = await this.getKycProfile(params.userId);
    const amlRequests = await this.getAmlRequests(params.tenantId, params.userId);
    const user = await this.getUser(params.userId);
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

      contributingRules.push({ ruleId: 'KYC_VERIFICATION_REQUIRED', weight: kycRule.weight || 30, score, description: kycRule.description });
      totalScore += score * (kycRule.weight || 30);
      totalWeight += kycRule.weight || 30;
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

      contributingRules.push({ ruleId: 'AML_SCREENING_REQUIRED', weight: amlRule.weight || 25, score, description: amlRule.description });
      totalScore += score * (amlRule.weight || 25);
      totalWeight += amlRule.weight || 25;
    }

    // Rule: SANCTIONS_CHECK
    const sanctionsRule = policy.rules.find((r) => r.ruleId === 'SANCTIONS_CHECK');
    if (sanctionsRule?.enabled) {
      let score = 0;
      const hasMatch = amlRequests.some((r: any) => r.amlState === AmlState.MATCH || r.amlState === AmlState.BLOCKED);
      if (hasMatch) score = 100;
      contributingRules.push({ ruleId: 'SANCTIONS_CHECK', weight: sanctionsRule.weight || 40, score, description: sanctionsRule.description });
      totalScore += score * (sanctionsRule.weight || 40);
      totalWeight += sanctionsRule.weight || 40;
    }

    // Rule: HIGH_RISK_COUNTRY
    const highRiskRule = policy.rules.find((r) => r.ruleId === 'HIGH_RISK_COUNTRY');
    if (highRiskRule?.enabled && user?.countryCode) {
      const isHighRisk = await this.policyService.isCountryHighRisk(user.countryCode, policy);
      const score = isHighRisk ? 80 : 0;
      contributingRules.push({ ruleId: 'HIGH_RISK_COUNTRY', weight: highRiskRule.weight || 35, score, description: `${highRiskRule.description} country=${user.countryCode}` });
      totalScore += score * (highRiskRule.weight || 35);
      totalWeight += highRiskRule.weight || 35;
    }

    // Rule: BLOCKED_COUNTRY
    const blockedRule = policy.rules.find((r) => r.ruleId === 'BLOCKED_COUNTRY');
    if (blockedRule?.enabled && user?.countryCode) {
      const isBlocked = await this.policyService.isCountryBlocked(user.countryCode, policy);
      const score = isBlocked ? 100 : 0;
      contributingRules.push({ ruleId: 'BLOCKED_COUNTRY', weight: blockedRule.weight || 100, score, description: `${blockedRule.description} country=${user.countryCode}` });
      totalScore += score * (blockedRule.weight || 100);
      totalWeight += blockedRule.weight || 100;
    }

    // Rule: FAILED_KYC_ATTEMPTS
    const failedKycRule = policy.rules.find((r) => r.ruleId === 'FAILED_KYC_ATTEMPTS');
    if (failedKycRule?.enabled) {
      let score = 0;
      if (failedKycAttempts >= 3) score = 80;
      else if (failedKycAttempts >= 2) score = 50;
      else if (failedKycAttempts >= 1) score = 20;
      contributingRules.push({ ruleId: 'FAILED_KYC_ATTEMPTS', weight: failedKycRule.weight || 25, score, description: `${failedKycRule.description} attempts=${failedKycAttempts}` });
      totalScore += score * (failedKycRule.weight || 25);
      totalWeight += failedKycRule.weight || 25;
    }

    // Rule: TRANSACTION_AMOUNT_REVIEW / UNUSUAL_TRADING_ACTIVITY
    const txRule = policy.rules.find((r) => r.ruleId === 'UNUSUAL_TRADING_ACTIVITY');
    if (txRule?.enabled) {
      let score = 0;
      if (transactionSignals.length > 5) score = 60;
      else if (transactionSignals.length > 2) score = 30;
      contributingRules.push({ ruleId: 'UNUSUAL_TRADING_ACTIVITY', weight: txRule.weight || 30, score, description: `${txRule.description} signals=${transactionSignals.length}` });
      totalScore += score * (txRule.weight || 30);
      totalWeight += txRule.weight || 30;
    }

    // Rule: ACCOUNT_AGE
    const ageRule = policy.rules.find((r) => r.ruleId === 'ACCOUNT_AGE');
    if (ageRule?.enabled && user?.createdAt) {
      const ageDays = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      let score = 0;
      if (ageDays < 1) score = 50;
      else if (ageDays < 7) score = 30;
      else if (ageDays < 30) score = 10;
      contributingRules.push({ ruleId: 'ACCOUNT_AGE', weight: ageRule.weight || 15, score, description: `${ageRule.description} ageDays=${ageDays.toFixed(1)}` });
      totalScore += score * (ageRule.weight || 15);
      totalWeight += ageRule.weight || 15;
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
      await (this.prisma as any).riskScoreRecord?.create({
        data: {
          id: randomUUID(),
          tenantId: params.tenantId,
          userId: params.userId,
          score: finalScore,
          riskLevel,
          ruleIds: contributingRules.map((r) => r.ruleId),
          contributingRules,
          policyVersion: policy.policyVersion,
          methodology: 'weighted_rule_based_v1',
          calculatedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          idempotencyKey,
          safeMetadata: { jurisdiction, totalWeight },
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to persist risk score: ${e.message}`);
    }

    await this.auditService.recordRiskScoreCalculated(params.tenantId, params.userId, finalScore, riskLevel, contributingRules.map((r) => r.ruleId));

    return riskScore;
  }

  async getLatestScore(tenantId: string, userId: string): Promise<RiskScore | null> {
    try {
      const record = await (this.prisma as any).riskScoreRecord?.findFirst({
        where: { tenantId, userId },
        orderBy: { calculatedAt: 'desc' },
      });

      if (!record) return null;

      return {
        userId: record.userId,
        tenantId: record.tenantId,
        score: record.score,
        riskLevel: record.riskLevel as RiskLevel,
        contributingRules: record.contributingRules || [],
        policyVersion: record.policyVersion,
        calculatedAt: new Date(record.calculatedAt).toISOString(),
        expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : undefined,
        methodology: record.methodology || 'weighted_rule_based_v1',
      };
    } catch {
      return null;
    }
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
    const user = await this.getUser(params.userId);
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

  private mapScoreToRiskLevel(score: number, policy: any): RiskLevel {
    if (score <= policy.riskThresholds.lowMax) return RiskLevel.LOW;
    if (score <= policy.riskThresholds.mediumMax) return RiskLevel.MEDIUM;
    if (score <= policy.riskThresholds.highMax) return RiskLevel.HIGH;
    if (score >= policy.riskThresholds.criticalMin) return RiskLevel.CRITICAL;
    return RiskLevel.UNKNOWN;
  }

  private async getKycProfile(userId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).kycProfile?.findUnique({ where: { userId } });
    } catch {
      return null;
    }
  }

  private async getAmlRequests(tenantId: string, userId: string): Promise<any[]> {
    try {
      return await (this.prisma as any).complianceScreeningRequest?.findMany({
        where: { tenantId, userId, type: { in: ['AML', 'TRANSACTION'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }) || [];
    } catch {
      return [];
    }
  }

  private async getUser(userId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).user?.findUnique({ where: { id: userId }, select: { countryCode: true, createdAt: true } });
    } catch {
      return null;
    }
  }

  private async getTransactionSignals(tenantId: string, userId: string): Promise<any[]> {
    try {
      return await (this.prisma as any).transactionMonitoringSignal?.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }) || [];
    } catch {
      return [];
    }
  }

  private async getFailedKycAttempts(tenantId: string, userId: string): Promise<number> {
    try {
      const count = await (this.prisma as any).complianceScreeningRequest?.count({
        where: { tenantId, userId, type: 'KYC', kycState: 'REJECTED' },
      });
      return count || 0;
    } catch {
      return 0;
    }
  }
}
