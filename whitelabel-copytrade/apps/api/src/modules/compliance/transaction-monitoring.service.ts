import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompliancePolicyService } from './compliance-policy.service';
import { ComplianceAuditService } from './compliance-audit.service';
import { ComplianceCaseRepository } from './compliance-case.repository';
import { RiskLevel, ComplianceDecision, ComplianceCaseType } from './compliance.types';
import { randomUUID } from 'crypto';

/**
 * Transaction monitoring based on canonical sources: Payment/Refund/Payout/Fee/Trading
 * Emits monitoring signals for review/block per configured policy. No second financial ledger.
 */
@Injectable()
export class TransactionMonitoringService {
  private readonly logger = new Logger(TransactionMonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: CompliancePolicyService,
    private readonly auditService: ComplianceAuditService,
    private readonly caseRepository: ComplianceCaseRepository,
  ) {}

  async evaluateTransaction(params: {
    tenantId: string;
    userId: string;
    sourceType: 'PAYMENT' | 'REFUND' | 'PAYOUT' | 'FEE' | 'TRADING' | 'INVOICE';
    sourceId: string;
    amount: string;
    currency: string;
    jurisdiction?: string;
    idempotencyKey?: string;
    safeMetadata?: Record<string, any>;
  }): Promise<{
    signalId?: string;
    decision: ComplianceDecision;
    riskLevel: RiskLevel;
    ruleIds: string[];
    caseId?: string;
    idempotencyKey: string;
  }> {
    const jurisdiction = params.jurisdiction || 'DEFAULT';
    const idempotencyKey = params.idempotencyKey || `tx_mon_${params.tenantId}_${params.sourceType}_${params.sourceId}_${Date.now()}`;

    // Idempotency
    try {
      const existing = await (this.prisma as any).transactionMonitoringSignal?.findFirst({ where: { idempotencyKey } });
      if (existing) {
        this.logger.log(`Idempotent tx monitoring return key=${idempotencyKey}`);
        return {
          signalId: existing.id,
          decision: existing.decision as ComplianceDecision,
          riskLevel: existing.riskLevel as RiskLevel,
          ruleIds: existing.ruleId ? [existing.ruleId] : [],
          caseId: existing.caseId || undefined,
          idempotencyKey,
        };
      }
    } catch {}

    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId, jurisdiction });
    const amountNum = parseFloat(params.amount || '0');

    let decision: ComplianceDecision = ComplianceDecision.ALLOW;
    let riskLevel: RiskLevel = RiskLevel.LOW;
    let triggeredRule: string | null = null;
    let safeSummary = `Transaction ${params.sourceType} ${params.sourceId} amount [REDACTED] ${params.currency} tenant ${params.tenantId}`;

    // Rule: TRANSACTION_AMOUNT_BLOCK
    const blockThreshold = parseFloat(policy.transactionThresholds.blockAmount || '50000');
    const reviewThreshold = parseFloat(policy.transactionThresholds.reviewAmount || '10000');
    const highRiskMultiplier = policy.transactionThresholds.highRiskMultiplier || 0.5;

    // Adjust thresholds for high-risk countries
    const user = await this.getUser(params.userId);
    const isHighRiskCountry = user?.countryCode ? await this.policyService.isCountryHighRisk(user.countryCode, policy) : false;
    const effectiveBlockThreshold = isHighRiskCountry ? blockThreshold * highRiskMultiplier : blockThreshold;
    const effectiveReviewThreshold = isHighRiskCountry ? reviewThreshold * highRiskMultiplier : reviewThreshold;

    if (amountNum >= effectiveBlockThreshold) {
      decision = ComplianceDecision.BLOCK;
      riskLevel = RiskLevel.CRITICAL;
      triggeredRule = 'TRANSACTION_AMOUNT_BLOCK';
      safeSummary = `Transaction blocked: amount exceeds block threshold ${effectiveBlockThreshold} ${policy.transactionThresholds.currency} (original ${blockThreshold}), highRiskCountry=${isHighRiskCountry}`;
    } else if (amountNum >= effectiveReviewThreshold) {
      decision = ComplianceDecision.REVIEW_REQUIRED;
      riskLevel = RiskLevel.HIGH;
      triggeredRule = 'TRANSACTION_AMOUNT_REVIEW';
      safeSummary = `Transaction review required: amount exceeds review threshold ${effectiveReviewThreshold} ${policy.transactionThresholds.currency}, highRiskCountry=${isHighRiskCountry}`;
    }

    // Rule: RAPID_ACCOUNT_CHANGES / UNUSUAL_TRADING_ACTIVITY from canonical sources
    if (decision === ComplianceDecision.ALLOW) {
      const recentSignals = await this.getRecentSignals(params.tenantId, params.userId, 60 * 60 * 1000); // last hour
      if (recentSignals.length >= 5) {
        decision = ComplianceDecision.REVIEW_REQUIRED;
        riskLevel = RiskLevel.MEDIUM;
        triggeredRule = 'UNUSUAL_TRADING_ACTIVITY';
        safeSummary = `Unusual activity: ${recentSignals.length} signals in last hour for user ${params.userId}`;
      }
    }

    // Only persist signal if not ALLOW, or if policy requires audit of all
    let signalId: string | undefined;
    let caseId: string | undefined;

    if (decision !== ComplianceDecision.ALLOW || triggeredRule) {
      const id = randomUUID();
      signalId = id;

      try {
        const signal = await (this.prisma as any).transactionMonitoringSignal?.create({
          data: {
            id,
            tenantId: params.tenantId,
            userId: params.userId,
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            ruleId: triggeredRule || 'NO_RULE',
            riskLevel,
            decision,
            safeSummary: safeSummary.substring(0, 1000),
            idempotencyKey,
            safeMetadata: params.safeMetadata || {},
            createdAt: new Date(),
          },
        });
        if (signal) signalId = signal.id;
      } catch (e: any) {
        if (e.code === 'P2002') {
          const existing = await (this.prisma as any).transactionMonitoringSignal?.findFirst({ where: { idempotencyKey } });
          if (existing) {
            signalId = existing.id;
          }
        } else {
          this.logger.warn(`Failed to persist monitoring signal: ${e.message}`);
        }
      }

      await this.auditService.recordMonitoringSignal(params.tenantId, params.userId, signalId || id, triggeredRule || 'NO_RULE', riskLevel);

      // Create compliance case if BLOCK or REVIEW_REQUIRED per explicit policy - no auto freeze without auditable action
      if ([ComplianceDecision.BLOCK, ComplianceDecision.REVIEW_REQUIRED, ComplianceDecision.RESTRICT].includes(decision)) {
        try {
          const complianceCase = await this.caseRepository.createCase({
            tenantId: params.tenantId,
            userId: params.userId,
            caseType: ComplianceCaseType.TRANSACTION_REVIEW,
            riskLevel,
            safeSummary,
            ruleIds: triggeredRule ? [triggeredRule] : [],
            sourceRefs: [{ type: params.sourceType, id: params.sourceId, amount: '[REDACTED]', currency: params.currency }],
            idempotencyKey: `case_tx_mon_${params.tenantId}_${params.sourceId}`,
            metadata: { decision, riskLevel, sourceType: params.sourceType },
          });
          caseId = complianceCase.id;

          // Update signal with caseId
          try {
            await (this.prisma as any).transactionMonitoringSignal?.update({
              where: { id: signalId },
              data: { caseId },
            });
          } catch {}
        } catch (e: any) {
          this.logger.warn(`Failed to create case for tx monitoring: ${e.message}`);
        }
      }
    }

    return {
      signalId,
      decision,
      riskLevel,
      ruleIds: triggeredRule ? [triggeredRule] : [],
      caseId,
      idempotencyKey,
    };
  }

  async evaluateFromCanonicalSources(params: { tenantId: string; userId: string; fromDate?: Date; toDate?: Date }): Promise<{ evaluated: number; signals: number; cases: number }> {
    let evaluated = 0;
    let signals = 0;
    let cases = 0;

    try {
      // Read from canonical billing/payment sources - never second ledger
      // Invoice, Payment, Refund, Payout, Fee, Trading - reuse existing tables if available

      const from = params.fromDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = params.toDate || new Date();

      // Example: evaluate payments
      let payments: any[] = [];
      try {
        payments = await (this.prisma as any).payment?.findMany({
          where: { tenantId: params.tenantId, createdAt: { gte: from, lte: to } },
          take: 100,
          orderBy: { createdAt: 'desc' },
        }) || [];
      } catch {}

      for (const payment of payments) {
        evaluated++;
        const result = await this.evaluateTransaction({
          tenantId: params.tenantId,
          userId: payment.userId || params.userId,
          sourceType: 'PAYMENT',
          sourceId: payment.id,
          amount: payment.amount?.toString() || payment.amountCents?.toString() || '0',
          currency: payment.currency || 'USD',
          idempotencyKey: `canon_pay_${payment.id}`,
        });
        if (result.signalId) signals++;
        if (result.caseId) cases++;
      }

      // Evaluate invoices
      let invoices: any[] = [];
      try {
        invoices = await (this.prisma as any).invoice?.findMany({
          where: { tenantId: params.tenantId, createdAt: { gte: from, lte: to } },
          take: 100,
          orderBy: { createdAt: 'desc' },
        }) || [];
      } catch {}

      for (const invoice of invoices) {
        evaluated++;
        const result = await this.evaluateTransaction({
          tenantId: params.tenantId,
          userId: invoice.userId || params.userId,
          sourceType: 'INVOICE',
          sourceId: invoice.id,
          amount: invoice.totalAmount?.toString() || invoice.amountDue?.toString() || '0',
          currency: invoice.currency || 'USD',
          idempotencyKey: `canon_inv_${invoice.id}`,
        });
        if (result.signalId) signals++;
        if (result.caseId) cases++;
      }
    } catch (e: any) {
      this.logger.warn(`Evaluate from canonical sources failed: ${e.message}`);
    }

    return { evaluated, signals, cases };
  }

  async listSignals(tenantId: string, filters?: { userId?: string; ruleId?: string; riskLevel?: RiskLevel; decision?: ComplianceDecision; fromDate?: Date; toDate?: Date; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    try {
      const where: any = { tenantId };
      if (filters?.userId) where.userId = filters.userId;
      if (filters?.ruleId) where.ruleId = filters.ruleId;
      if (filters?.riskLevel) where.riskLevel = filters.riskLevel;
      if (filters?.decision) where.decision = filters.decision;
      if (filters?.fromDate || filters?.toDate) {
        where.createdAt = {};
        if (filters.fromDate) where.createdAt.gte = filters.fromDate;
        if (filters.toDate) where.createdAt.lte = filters.toDate;
      }

      const [data, total] = await Promise.all([
        (this.prisma as any).transactionMonitoringSignal?.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }) || [],
        (this.prisma as any).transactionMonitoringSignal?.count({ where }) || 0,
      ]);

      return { data, total };
    } catch {
      return { data: [], total: 0 };
    }
  }

  async resolveSignal(signalId: string, tenantId: string, reviewerId: string, resolution: string): Promise<any | null> {
    try {
      const updated = await (this.prisma as any).transactionMonitoringSignal?.update({
        where: { id: signalId },
        data: { resolved: true, resolvedAt: new Date(), resolvedBy: reviewerId },
      });

      await this.auditService.record({
        tenantId,
        action: 'MONITORING_SIGNAL_RESOLVED',
        actorId: reviewerId,
        safeMetadata: { signalId, resolution: resolution.substring(0, 500) },
      });

      return updated || null;
    } catch (e: any) {
      this.logger.warn(`Resolve signal failed: ${e.message}`);
      return null;
    }
  }

  private async getUser(userId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).user?.findUnique({ where: { id: userId }, select: { countryCode: true } });
    } catch {
      return null;
    }
  }

  private async getRecentSignals(tenantId: string, userId: string, windowMs: number): Promise<any[]> {
    try {
      const since = new Date(Date.now() - windowMs);
      return await (this.prisma as any).transactionMonitoringSignal?.findMany({
        where: { tenantId, userId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      }) || [];
    } catch {
      return [];
    }
  }
}
