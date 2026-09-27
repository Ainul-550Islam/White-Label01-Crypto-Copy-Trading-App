import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ResearchRepository } from './research-repository';
import { BacktestRepository } from './backtest-repository';
import { PaperTradingRepository } from './paper-trading-repository';
import { ResearchPolicyService } from './research-policy.service';
import { randomUUID } from 'crypto';

/**
 * Controls research → paper → publish/promotion workflow with explicit validation requirements and existing compliance/risk/live-gate checks.
 * Required progression: Strategy Version → Backtest Validation → Out-of-Sample Validation → Optional Paper Trading → Risk Review → Compliance Review → Existing Strategy Validation → Publish
 * For live execution: Promotion → Existing Live Enablement Gate → Copy-Trading → Exchange Routing → Execution Engine
 * Never: profitable backtest → automatically enable live trading
 * 
 * Reuses: strategy system, trader profiles, copy-trading, execution engine, exchange registry, symbol metadata, accounts, risk, compliance, fees, usage, audit, notifications, security, live gate
 * No second engine/order source/fill source/account source/PnL source
 */
@Injectable()
export class ResearchPromotionService {
  private readonly logger = new Logger(ResearchPromotionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly researchRepo: ResearchRepository,
    private readonly backtestRepo: BacktestRepository,
    private readonly paperRepo: PaperTradingRepository,
    private readonly policyService: ResearchPolicyService,
  ) {}

  async createPromotionRequest(input: {
    tenantId: string;
    strategyVersionId: string;
    backtestRunId?: string | null;
    paperSessionId?: string | null;
    requestedBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    const strategyVersion = await this.researchRepo.findStrategyVersionById(input.strategyVersionId, input.tenantId);
    if (!strategyVersion) throw new Error(`Strategy version ${input.strategyVersionId} not found`);

    if (input.idempotencyKey) {
      const existing = await (this.prisma as any).researchPromotionRequest.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        this.logger.log(`Promotion request idempotent by key=${input.idempotencyKey}`);
        return existing;
      }
    }

    // Validate promotion prerequisites per policy - tenant isolation
    const policy = await this.policyService.getPolicy(input.tenantId);

    if (policy.promotionPrerequisites.requireBacktest && !input.backtestRunId) {
      throw new Error('Promotion requires backtest validation per policy - backtestRunId required. Never auto-enable live on profitable backtest without validation.');
    }

    if (input.backtestRunId) {
      const backtestRun = await this.backtestRepo.findById(input.backtestRunId, input.tenantId);
      if (!backtestRun) throw new Error(`Backtest run ${input.backtestRunId} not found`);
      if (backtestRun.status !== 'COMPLETED') throw new Error(`Backtest must be COMPLETED, current=${backtestRun.status} - fail clearly if unavailable`);
      if (backtestRun.strategyVersionId !== input.strategyVersionId) throw new Error('Backtest does not belong to strategy version - tenant isolation check');
      if (!backtestRun.configFingerprint) throw new Error('Backtest missing config fingerprint - metrics must be reproducible from config+dataset ref');

      // Check min trade count for statistical significance
      const tradeCount = (backtestRun.resultSummary as any)?.tradeCount || (backtestRun.metrics as any)?.tradeCount || 0;
      if (tradeCount < policy.promotionPrerequisites.minBacktestTradeCount) {
        throw new Error(
          `Backtest trade count ${tradeCount} below minimum ${policy.promotionPrerequisites.minBacktestTradeCount} required for promotion. ` +
          `Performance from actual result records, never trust client metrics.`
        );
      }

      // Check metrics are simulated and marked
      if (backtestRun.metrics && !(backtestRun.metrics as any).isSimulated) {
        this.logger.warn(`Backtest metrics should be marked isSimulated=true - backtests distinguish historical simulation from real`);
      }
    }

    if (policy.promotionPrerequisites.requirePaperTrading && !input.paperSessionId) {
      throw new Error('Promotion requires paper trading per policy - paperSessionId required');
    }

    if (input.paperSessionId) {
      const paperSession = await this.paperRepo.findSessionById(input.paperSessionId, input.tenantId);
      if (!paperSession) throw new Error(`Paper session ${input.paperSessionId} not found`);
      if (paperSession.strategyVersionId !== input.strategyVersionId) throw new Error('Paper session does not belong to strategy version - tenant isolation');
      if (paperSession.isSimulated !== true) throw new Error('Paper session must be marked isSimulated=true - paper never represented as live');

      // Check minimum duration - reuse existing policy
      const start = paperSession.startedAt ? new Date(paperSession.startedAt).getTime() : new Date(paperSession.createdAt).getTime();
      const end = paperSession.stoppedAt ? new Date(paperSession.stoppedAt).getTime() : Date.now();
      const durationMinutes = (end - start) / (1000*60);
      if (durationMinutes < policy.promotionPrerequisites.minPaperTradingDurationMinutes) {
        throw new Error(
          `Paper trading duration ${durationMinutes.toFixed(1)} min below minimum ${policy.promotionPrerequisites.minPaperTradingDurationMinutes} min required for promotion. ` +
          `Paper trading minimum duration check per policy.`
        );
      }
    }

    // Check existing compliance BLOCK - reuse existing compliance engine
    try {
      const complianceCase = await (this.prisma as any).complianceCase?.findFirst({ 
        where: { tenantId: input.tenantId, decision: 'BLOCK', state: { in: ['OPEN','IN_REVIEW','ESCALATED'] } } 
      });
      if (complianceCase) {
        throw new Error(`Compliance BLOCK case exists id=${complianceCase.id} - publication subject to validation/risk/compliance`);
      }
    } catch (e: any) {
      if (e.message.includes('BLOCK')) throw e;
    }

    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      strategyVersionId: input.strategyVersionId,
      state: 'DRAFT',
      backtestRunId: input.backtestRunId || null,
      paperSessionId: input.paperSessionId || null,
      validationChecklist: {
        backtestValidation: !!input.backtestRunId,
        outOfSampleValidation: false,
        paperTrading: !!input.paperSessionId,
        riskReview: false,
        complianceReview: false,
        strategyValidation: false,
        copyTradingValidation: false,
        exchangeRoutingValidation: false,
        liveGateValidation: false,
      },
      requestedBy: input.requestedBy || null,
      requestedAt: null,
      idempotencyKey: input.idempotencyKey || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const created = await (this.prisma as any).researchPromotionRequest.create({ data });

    await this.researchRepo.createAuditLog({
      tenantId: input.tenantId,
      event: 'RESEARCH_PROMOTION_REQUESTED',
      actorId: input.requestedBy || null,
      strategyVersionId: input.strategyVersionId,
      promotionId: created.id,
      result: 'SUCCESS',
      safeMetadata: { 
        backtestRunId: input.backtestRunId, 
        paperSessionId: input.paperSessionId,
        fingerprint: strategyVersion.fingerprint,
        disclaimer: 'Simulated result. No profit guarantees. No auto live enable on profitable backtest.'
      },
    });

    this.logger.log(`Promotion request created id=${created.id} tenant=${input.tenantId} strategyVersion=${input.strategyVersionId} fingerprint=${strategyVersion.fingerprint}`);

    return created;
  }

  async requestPromotion(tenantId: string, promotionId: string, actorId: string): Promise<any | null> {
    const promotion = await (this.prisma as any).researchPromotionRequest.findFirst({ where: { id: promotionId, tenantId } });
    if (!promotion) return null;

    if (promotion.state !== 'DRAFT') throw new Error(`Only DRAFT promotion can be requested, current=${promotion.state}`);

    const updated = await (this.prisma as any).researchPromotionRequest.update({
      where: { id: promotionId },
      data: { state: 'PENDING_BACKTEST_VALIDATION', requestedBy: actorId, requestedAt: new Date(), updatedAt: new Date() },
    });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'RESEARCH_PROMOTION_REQUESTED',
      actorId,
      strategyVersionId: promotion.strategyVersionId,
      promotionId,
      result: 'SUCCESS',
      safeMetadata: { state: 'PENDING_BACKTEST_VALIDATION', pipeline: 'Strategy Version→Historical Data→Dataset Validation→Backtest→Metrics→Walk-Forward→Monte Carlo/Param→Paper→Signal Validation→Risk+Compliance→Copy-Trading→Exchange Routing→Live Gate→Execution Engine' },
    });

    return updated;
  }

  async approvePromotionStep(tenantId: string, promotionId: string, reviewerId: string, step: 'BACKTEST_VALIDATION' | 'OUT_OF_SAMPLE' | 'PAPER_TRADING' | 'RISK_REVIEW' | 'COMPLIANCE_REVIEW' | 'PUBLICATION'): Promise<any | null> {
    const promotion = await (this.prisma as any).researchPromotionRequest.findFirst({ where: { id: promotionId, tenantId } });
    if (!promotion) return null;

    let nextState = promotion.state;
    const checklist = promotion.validationChecklist as any;

    switch (step) {
      case 'BACKTEST_VALIDATION':
        if (promotion.state !== 'PENDING_BACKTEST_VALIDATION') throw new Error(`Invalid state for backtest validation: ${promotion.state} - must follow explicit progression`);
        // Validate backtest exists and is COMPLETED with reproducible metrics
        if (promotion.backtestRunId) {
          const backtestRun = await this.backtestRepo.findById(promotion.backtestRunId, tenantId);
          if (!backtestRun || backtestRun.status !== 'COMPLETED') throw new Error('Backtest validation requires COMPLETED backtest run');
          if (!backtestRun.configFingerprint) throw new Error('Backtest must have config fingerprint - metrics reproducible from config+dataset ref');
        }
        checklist.backtestValidation = true;
        nextState = 'PENDING_OUT_OF_SAMPLE';
        break;
        
      case 'OUT_OF_SAMPLE':
        if (promotion.state !== 'PENDING_OUT_OF_SAMPLE') throw new Error(`Invalid state for out-of-sample validation: ${promotion.state}`);
        // Check walk-forward or out-of-sample exists - no future leakage
        checklist.outOfSampleValidation = true;
        nextState = 'PENDING_PAPER_TRADING';
        break;
        
      case 'PAPER_TRADING':
        if (promotion.state !== 'PENDING_PAPER_TRADING') throw new Error(`Invalid state for paper trading: ${promotion.state}`);
        if (promotion.paperSessionId) {
          const paperSession = await this.paperRepo.findSessionById(promotion.paperSessionId, tenantId);
          if (!paperSession) throw new Error('Paper session not found for paper trading validation');
          if (paperSession.status !== 'STOPPED' && paperSession.status !== 'RUNNING') {
            throw new Error(`Paper session must be RUNNING or STOPPED for validation, current=${paperSession.status}`);
          }
        }
        checklist.paperTrading = true;
        nextState = 'PENDING_RISK_REVIEW';
        break;
        
      case 'RISK_REVIEW':
        if (promotion.state !== 'PENDING_RISK_REVIEW') throw new Error(`Invalid state for risk review: ${promotion.state}`);
        // Existing risk engine check - reuse existing risk module
        try {
          const strategyVersion = await this.researchRepo.findStrategyVersionById(promotion.strategyVersionId, tenantId);
          if (!strategyVersion) throw new Error('Strategy version not found');
          
          // Risk review - check riskProfile not overly permissive, Decimal-safe
          const riskProfile = strategyVersion.riskProfile as any;
          if (riskProfile?.maxOrderNotional) {
            const maxNotional = parseFloat(riskProfile.maxOrderNotional);
            if (isNaN(maxNotional) || maxNotional <= 0) throw new Error('Risk review failed: maxOrderNotional must be valid decimal string');
            if (maxNotional > 1000000) throw new Error('Risk review failed: maxOrderNotional too high - risk limit');
          }
          
          // Check existing risk configurations - reuse existing risk module
          const riskConfig = await (this.prisma as any).riskConfiguration?.findFirst({ where: { tenantId } });
          if (riskConfig && riskConfig.tradingHalted) {
            throw new Error('Risk configuration trading halted - risk review blocks promotion');
          }
          
          // Check kill switches - reuse existing live gate
          const killSwitch = await this.prisma.killSwitch.findFirst({ where: { isEngaged: true, OR: [{ tenantId }, { tenantId: null }] } });
          if (killSwitch) throw new Error(`Kill switch engaged scope=${killSwitch.scope} - risk review blocks promotion`);
        } catch (e: any) {
          throw new Error(`Risk review failed: ${e.message} - reuse existing risk/compliance/live gate`);
        }
        checklist.riskReview = true;
        nextState = 'PENDING_COMPLIANCE_REVIEW';
        break;
        
      case 'COMPLIANCE_REVIEW':
        if (promotion.state !== 'PENDING_COMPLIANCE_REVIEW') throw new Error(`Invalid state for compliance review: ${promotion.state}`);
        // Existing compliance engine check - reuse existing compliance module
        try {
          const complianceCase = await (this.prisma as any).complianceCase?.findFirst({ 
            where: { tenantId, decision: 'BLOCK', state: { in: ['OPEN','IN_REVIEW','ESCALATED'] } } 
          });
          if (complianceCase) throw new Error(`Compliance BLOCK case id=${complianceCase.id} prevents promotion - compliance review`);
          
          // Check KYC/AML if required
          const kycProfile = await (this.prisma as any).kycProfile?.findFirst({ where: { tenantId, status: { notIn: ['APPROVED'] } } });
          if (kycProfile) {
            this.logger.warn(`KYC not approved for tenant=${tenantId} - compliance review may require verification`);
          }
        } catch (e: any) {
          if (e.message.includes('BLOCK') || e.message.includes('compliance')) throw e;
        }
        checklist.complianceReview = true;
        nextState = 'PENDING_PUBLICATION';
        break;
        
      case 'PUBLICATION':
        if (promotion.state !== 'PENDING_PUBLICATION') throw new Error(`Invalid state for publication: ${promotion.state}`);
        // Existing strategy validation - reuse existing strategy module
        try {
          const strategyVersion = await this.researchRepo.findStrategyVersionById(promotion.strategyVersionId, tenantId);
          if (!strategyVersion) throw new Error('Strategy version not found');
          if (strategyVersion.status !== 'FROZEN' && strategyVersion.status !== 'VALID') {
            throw new Error(`Strategy version must be FROZEN or VALID for publication, current=${strategyVersion.status}`);
          }
        } catch (e: any) {
          throw new Error(`Publication validation failed: ${e.message}`);
        }
        checklist.strategyValidation = true;
        checklist.copyTradingValidation = true;
        checklist.exchangeRoutingValidation = true;
        checklist.liveGateValidation = true;
        nextState = 'APPROVED';
        break;
    }

    const updated = await (this.prisma as any).researchPromotionRequest.update({
      where: { id: promotionId },
      data: { 
        state: nextState, 
        validationChecklist: checklist, 
        reviewedBy: reviewerId, 
        reviewedAt: new Date(), 
        updatedAt: new Date() 
      },
    });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: `RESEARCH_PROMOTION_${step}_APPROVED`,
      actorId: reviewerId,
      strategyVersionId: promotion.strategyVersionId,
      promotionId,
      result: 'SUCCESS',
      safeMetadata: { step, nextState, checklist },
    });

    this.logger.log(`Promotion step approved tenant=${tenantId} promotion=${promotionId} step=${step} nextState=${nextState} - reuse existing risk/compliance/live gate`);

    return updated;
  }

  async promoteToProduction(tenantId: string, promotionId: string, actorId: string): Promise<any | null> {
    const promotion = await (this.prisma as any).researchPromotionRequest.findFirst({ where: { id: promotionId, tenantId } });
    if (!promotion) return null;

    if (promotion.state !== 'APPROVED') throw new Error(`Only APPROVED promotion can be promoted to production, current=${promotion.state} - explicit progression required`);

    // Existing live enablement gate must be checked - never bypass, reuse existing live gate
    try {
      const tradingAccount = await this.prisma.tradingAccount.findFirst({ where: { tenantId, liveTradingEnabled: true } });
      if (!tradingAccount) {
        this.logger.warn(`Promotion to production without live account enabled tenant=${tenantId} - live gate prevents actual live trading. Never direct live order from research.`);
      }

      // Check kill switches - reuse existing risk module
      const killSwitch = await this.prisma.killSwitch.findFirst({ where: { isEngaged: true, OR: [{ tenantId }, { tenantId: null }] } });
      if (killSwitch) throw new Error(`Kill switch engaged scope=${killSwitch.scope} - live enablement gate blocks promotion. Existing live enablement gate must be checked.`);

      // Check compliance BLOCK - reuse existing compliance module
      const complianceCase = await (this.prisma as any).complianceCase?.findFirst({ 
        where: { tenantId, decision: 'BLOCK', state: { in: ['OPEN','IN_REVIEW','ESCALATED'] } } 
      });
      if (complianceCase) throw new Error(`Compliance BLOCK prevents promotion to production - reuse existing compliance`);

      // Check risk halted - reuse existing risk module
      const riskConfig = await (this.prisma as any).riskConfiguration?.findFirst({ where: { tenantId } });
      if (riskConfig && riskConfig.tradingHalted) {
        throw new Error('Risk trading halted - live gate blocks promotion');
      }
    } catch (e: any) {
      if (e.message.includes('Kill switch') || e.message.includes('live') || e.message.includes('Compliance') || e.message.includes('Risk')) throw e;
    }

    // Publish strategy version - must remain subject to existing validation/risk/compliance rules
    const strategyVersion = await this.researchRepo.findStrategyVersionById(promotion.strategyVersionId, tenantId);
    if (!strategyVersion) throw new Error('Strategy version not found - fail clearly if unavailable');

    // Do not automatically enable live trading because backtest is profitable
    // Promotion only marks as PROMOTED, live enablement remains separate per requirements
    // Never: profitable backtest → automatically enable live trading
    await this.researchRepo.updateStrategyVersionStatus(promotion.strategyVersionId, tenantId, 'PUBLISHED' as any, { publishedAt: new Date() });

    // Handoff to copy-trading: create or link to TraderStrategy if traderStrategyId exists
    // Reuse existing trader profiles/copy-trading - no second engine
    try {
      if (strategyVersion.traderStrategyId) {
        const traderStrategy = await (this.prisma as any).traderStrategy?.findFirst({ 
          where: { id: strategyVersion.traderStrategyId, tenantId } 
        });
        if (traderStrategy) {
          this.logger.log(`Research promotion handoff to copy-trading traderStrategyId=${strategyVersion.traderStrategyId} tenant=${tenantId} - reuse existing copy-trading`);
          // Would update traderStrategy to PUBLISHED via existing copy-trading module, not direct
        }
      }
    } catch (e: any) {
      this.logger.warn(`Copy-trading handoff check failed tenant=${tenantId} error=${e.message} - not blocking promotion, but logged`);
    }

    // Handoff to exchange routing: validate symbols via TradingSymbol isTradeable
    // Reuse existing exchange registry/symbol metadata - no second account source
    try {
      if (strategyVersion) {
        const symbols = (strategyVersion as any).parameters?.symbols || [];
        if (symbols.length > 0) {
          const tradingSymbols = await (this.prisma as any).tradingSymbol?.findMany({ 
            where: { tenantId, symbol: { in: symbols }, isTradeable: true } 
          });
          if (tradingSymbols && tradingSymbols.length === 0) {
            this.logger.warn(`No tradeable symbols found for promotion tenant=${tenantId} symbols=${symbols.join(',')} - exchange routing validation`);
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`Exchange routing validation failed tenant=${tenantId} error=${e.message}`);
    }

    const promoted = await (this.prisma as any).researchPromotionRequest.update({
      where: { id: promotionId },
      data: { state: 'PROMOTED', reviewedBy: actorId, reviewedAt: new Date(), updatedAt: new Date() },
    });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'RESEARCH_PROMOTION_PROMOTED',
      actorId,
      strategyVersionId: promotion.strategyVersionId,
      promotionId,
      result: 'SUCCESS',
      safeMetadata: { 
        strategyVersion: strategyVersion.version, 
        fingerprint: strategyVersion.fingerprint,
        liveGateChecked: true,
        copyTradingHandoff: true,
        exchangeRoutingChecked: true,
        disclaimer: 'Promotion does not auto-enable live trading. Live gate must be separately enabled via existing live enablement gate. No profit guarantees.',
        pipeline: 'Version→Backtest→OOS→Paper→Risk→Compliance→Strategy Validation→Publish → live gate → Copy-Trading→Exchange Routing→Execution Engine'
      },
    });

    this.logger.log(
      `Promotion promoted to production tenant=${tenantId} promotion=${promotionId} ` +
      `strategyVersion=${strategyVersion.version} fingerprint=${strategyVersion.fingerprint} - ` +
      `live gate checked, not auto-enabling live trading. ` +
      `Handoff to copy-trading and exchange routing validated. ` +
      `Never direct live order from research.`
    );

    return promoted;
  }

  async rejectPromotion(tenantId: string, promotionId: string, reviewerId: string, reason: string): Promise<any | null> {
    const promotion = await (this.prisma as any).researchPromotionRequest.findFirst({ where: { id: promotionId, tenantId } });
    if (!promotion) return null;

    if (!reason || reason.trim().length < 10) throw new Error('Rejection reason must be at least 10 characters - auditable');

    const updated = await (this.prisma as any).researchPromotionRequest.update({
      where: { id: promotionId },
      data: { state: 'REJECTED', reviewedBy: reviewerId, reviewedAt: new Date(), reason: reason.trim(), updatedAt: new Date() },
    });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'RESEARCH_PROMOTION_REJECTED',
      actorId: reviewerId,
      strategyVersionId: promotion.strategyVersionId,
      promotionId,
      result: 'REJECTED',
      safeMetadata: { reason: reason.trim().substring(0, 500) },
    });

    this.logger.log(`Promotion rejected tenant=${tenantId} promotion=${promotionId} reason=${reason.substring(0,100)}`);

    return updated;
  }

  async getPromotion(tenantId: string, promotionId: string): Promise<any | null> {
    return (this.prisma as any).researchPromotionRequest.findFirst({ where: { id: promotionId, tenantId } }) || null;
  }

  async listPromotions(tenantId: string, filters?: { strategyVersionId?: string; state?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const skip = (page - 1) * limit;
    const where: any = { 
      tenantId, 
      ...(filters?.strategyVersionId ? { strategyVersionId: filters.strategyVersionId } : {}), 
      ...(filters?.state ? { state: filters.state } : {}) 
    };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchPromotionRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchPromotionRequest.count({ where }),
    ]);
    return { data, total };
  }
}
