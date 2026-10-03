import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ResearchRepository } from './research-repository';

/**
 * Filters signals by symbol, side, strategy policy, cooldown, duplicate event, market state, and risk constraints before downstream handoff.
 * A rejected signal must include an explicit reason/rule reference.
 */
@Injectable()
export class SignalFilterService {
  private readonly logger = new Logger(SignalFilterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly researchRepo: ResearchRepository,
  ) {}

  async filterSignal(input: {
    tenantId: string;
    signalId: string;
    allowedSymbols?: string[] | null;
    blockedSymbols?: string[] | null;
    allowedSides?: string[] | null;
    cooldownMs?: number | null;
    /** The user filtering/publishing the signal; checked for compliance blocks with the version's author. */
    actorUserId?: string | null;
  }): Promise<{ allowed: boolean; reason: string | null; ruleId: string | null; filteredState: string }> {
    const signal = await (this.prisma as any).researchSignal.findFirst({ where: { id: input.signalId, tenantId: input.tenantId } });
    if (!signal) throw new Error(`Signal ${input.signalId} not found`);

    // Symbol filter
    if (input.blockedSymbols && input.blockedSymbols.includes(signal.symbol)) {
      await this.rejectSignal(input.tenantId, input.signalId, `Symbol ${signal.symbol} is blocked`, 'BLOCKED_SYMBOL');
      return { allowed: false, reason: `Symbol ${signal.symbol} is blocked`, ruleId: 'BLOCKED_SYMBOL', filteredState: 'FILTERED' };
    }

    if (input.allowedSymbols && input.allowedSymbols.length > 0 && !input.allowedSymbols.includes(signal.symbol)) {
      await this.rejectSignal(input.tenantId, input.signalId, `Symbol ${signal.symbol} not in allowed list`, 'ALLOWED_SYMBOL');
      return { allowed: false, reason: `Symbol ${signal.symbol} not in allowed list`, ruleId: 'ALLOWED_SYMBOL', filteredState: 'FILTERED' };
    }

    // Allowed side
    if (input.allowedSides && input.allowedSides.length > 0 && !input.allowedSides.includes(signal.side)) {
      await this.rejectSignal(input.tenantId, input.signalId, `Side ${signal.side} not allowed`, 'ALLOWED_SIDE');
      return { allowed: false, reason: `Side ${signal.side} not allowed`, ruleId: 'ALLOWED_SIDE', filteredState: 'FILTERED' };
    }

    // Cooldown check - prevent duplicate signals within cooldown
    if (input.cooldownMs && input.cooldownMs > 0) {
      const cooldownSince = new Date(Date.now() - input.cooldownMs);
      const recentDuplicate = await (this.prisma as any).researchSignal.findFirst({
        where: {
          tenantId: input.tenantId,
          strategyVersionId: signal.strategyVersionId,
          symbol: signal.symbol,
          side: signal.side,
          state: 'PUBLISHED',
          createdAt: { gte: cooldownSince },
          id: { not: signal.id },
        },
      });

      if (recentDuplicate) {
        await this.rejectSignal(input.tenantId, input.signalId, `Cooldown active: duplicate signal within ${input.cooldownMs}ms, recent=${recentDuplicate.id}`, 'COOLDOWN');
        return { allowed: false, reason: `Cooldown active: duplicate signal within ${input.cooldownMs}ms`, ruleId: 'COOLDOWN', filteredState: 'FILTERED' };
      }
    }

    // Strategy state check - strategy version must be PUBLISHED
    const strategyVersion = await this.researchRepo.findStrategyVersionById(signal.strategyVersionId, input.tenantId);
    if (!strategyVersion) {
      await this.rejectSignal(input.tenantId, input.signalId, 'Strategy version not found', 'STRATEGY_NOT_FOUND');
      return { allowed: false, reason: 'Strategy version not found', ruleId: 'STRATEGY_NOT_FOUND', filteredState: 'REJECTED' };
    }

    if (!['PUBLISHED','FROZEN'].includes(strategyVersion.status)) {
      await this.rejectSignal(input.tenantId, input.signalId, `Strategy version status ${strategyVersion.status} not allowed for signal publishing`, 'STRATEGY_STATE');
      return { allowed: false, reason: `Strategy version status ${strategyVersion.status} not allowed`, ruleId: 'STRATEGY_STATE', filteredState: 'REJECTED' };
    }

    // Risk constraints - the version's risk profile may block symbols. Only an
    // array counts: a string used to match substrings ('BTC-USDT,ETH' blocked
    // 'ETH') and anything else threw into an empty catch and allowed.
    const blockedByProfile = (strategyVersion.riskProfile as { blockedSymbols?: unknown } | null)?.blockedSymbols;
    if (Array.isArray(blockedByProfile) && blockedByProfile.includes(signal.symbol)) {
      await this.rejectSignal(input.tenantId, input.signalId, `Symbol ${signal.symbol} blocked by risk profile`, 'RISK_BLOCKED_SYMBOL');
      return { allowed: false, reason: `Symbol ${signal.symbol} blocked by risk profile`, ruleId: 'RISK_BLOCKED_SYMBOL', filteredState: 'REJECTED' };
    }

    // Compliance: an open BLOCK case on the version's author or on the user
    // acting now stops the signal. This used to match ANY open BLOCK case in
    // the tenant (one blocked customer stopped every research signal) and to
    // ignore lookup errors. A failed lookup now propagates (no publish).
    const subjects = [strategyVersion.createdBy, input.actorUserId].filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (subjects.length > 0) {
      const complianceCase = await this.prisma.complianceCase.findFirst({
        where: { tenantId: input.tenantId, userId: { in: subjects }, decision: 'BLOCK', state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } },
        select: { id: true },
      });
      if (complianceCase) {
        await this.rejectSignal(input.tenantId, input.signalId, 'Compliance BLOCK prevents signal', 'COMPLIANCE_BLOCK');
        return { allowed: false, reason: 'Compliance BLOCK prevents signal', ruleId: 'COMPLIANCE_BLOCK', filteredState: 'REJECTED' };
      }
    }

    // Exchange capability - a known, non-tradeable symbol is rejected; an
    // unknown symbol is allowed with a warning (research may precede venue
    // listing). A failed lookup propagates instead of allowing.
    const tradingSymbol = await this.prisma.tradingSymbol.findFirst({ where: { tenantId: input.tenantId, symbol: signal.symbol } });
    if (!tradingSymbol) {
      this.logger.warn(`Symbol ${signal.symbol} not found in trading symbols tenant=${input.tenantId} - allowing but flagged`);
    } else if (!tradingSymbol.isTradeable) {
      await this.rejectSignal(input.tenantId, input.signalId, `Symbol ${signal.symbol} not tradeable`, 'EXCHANGE_NOT_TRADEABLE');
      return { allowed: false, reason: `Symbol ${signal.symbol} not tradeable`, ruleId: 'EXCHANGE_NOT_TRADEABLE', filteredState: 'REJECTED' };
    }

    // Time validity - check expiry
    if (signal.expiresAt && new Date(signal.expiresAt).getTime() < Date.now()) {
      await this.rejectSignal(input.tenantId, input.signalId, 'Signal expired', 'EXPIRED');
      return { allowed: false, reason: 'Signal expired', ruleId: 'EXPIRED', filteredState: 'EXPIRED' };
    }

    // Duplicate event - check if same signalKey already published
    const duplicateEvent = await (this.prisma as any).researchSignal.findFirst({
      where: { tenantId: input.tenantId, signalKey: signal.signalKey, state: 'PUBLISHED', id: { not: signal.id } },
    });
    if (duplicateEvent) {
      await this.rejectSignal(input.tenantId, input.signalId, `Duplicate event: signalKey ${signal.signalKey} already published as ${duplicateEvent.id}`, 'DUPLICATE_EVENT');
      return { allowed: false, reason: `Duplicate event: signalKey ${signal.signalKey} already published`, ruleId: 'DUPLICATE_EVENT', filteredState: 'FILTERED' };
    }

    this.logger.log(`Signal filter passed tenant=${input.tenantId} signal=${input.signalId} symbol=${signal.symbol} side=${signal.side}`);

    return { allowed: true, reason: null, ruleId: null, filteredState: 'VALID' };
  }

  private async rejectSignal(tenantId: string, signalId: string, reason: string, ruleId: string): Promise<void> {
    try {
      await (this.prisma as any).researchSignal.update({ where: { id: signalId, tenantId }, data: { state: 'REJECTED', updatedAt: new Date() } });

      await this.researchRepo.createAuditLog({
        tenantId,
        event: 'SIGNAL_REJECTED',
        signalId,
        result: 'REJECTED',
        safeMetadata: { reason, ruleId },
      });

      this.logger.log(`Signal rejected tenant=${tenantId} signal=${signalId} reason=${reason} rule=${ruleId}`);
    } catch {}
  }
}
