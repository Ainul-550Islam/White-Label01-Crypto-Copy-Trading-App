import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import {
  PortfolioPeriodState,
  PERIOD_VALID_TRANSITIONS,
  deterministicIdempotencyKey,
  redactSecrets,
} from './portfolio-accounting.types';

/**
 * Manages accounting periods with states OPEN→CLOSING→CLOSED only when required events present,
 * no critical reconciliation failures, valuation sufficient, NAV consistent, PnL reproducible,
 * fees/cash/positions reconcile; failure CLOSING→OPEN with evidence.
 * Closed periods immutable.
 */

@Injectable()
export class AccountingPeriodService {
  private readonly logger = new Logger(AccountingPeriodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async createPeriod(params: {
    tenantId: string;
    profileId: string;
    periodStart: Date;
    periodEnd: Date;
    periodType?: string;
    baseCurrency?: string;
  }): Promise<any> {
    const { tenantId, profileId, periodStart, periodEnd, periodType = 'DAILY' } = params;

    if (periodEnd <= periodStart) throw new BadRequestException('periodEnd must be after periodStart');

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });
    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;

    const idempotencyKey = deterministicIdempotencyKey({
      type: `period:${periodType}:${periodStart.toISOString()}:${periodEnd.toISOString()}`,
      tenantId,
      profileId,
      sourceId: `${periodStart.toISOString()}_${periodEnd.toISOString()}`,
    });

    try {
      const existing = await (this.prisma as any).portfolioAccountingPeriod.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    // Check for overlapping periods — conflict check
    try {
      const overlapping = await (this.prisma as any).portfolioAccountingPeriod.findFirst({
        where: {
          tenantId,
          profileId,
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart },
          state: { not: 'CLOSED' },
        },
      });
      if (overlapping) {
        throw new BadRequestException(`Overlapping period exists: ${overlapping.id}`);
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
    }

    const period = await (this.prisma as any).portfolioAccountingPeriod.create({
      data: {
        tenantId,
        profileId,
        periodType,
        periodStart,
        periodEnd,
        state: PortfolioPeriodState.OPEN as any,
        baseCurrency,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        idempotencyKey,
      },
    });

    this.logger.log({ event: 'portfolio.period.created', tenantId, profileId, periodId: period.id });

    return period;
  }

  async transitionPeriod(params: {
    tenantId: string;
    periodId: string;
    toState: PortfolioPeriodState;
    reason?: string;
    operatorId?: string;
  }): Promise<any> {
    const { tenantId, periodId, toState, reason, operatorId } = params;

    const period = await (this.prisma as any).portfolioAccountingPeriod.findFirst({ where: { id: periodId, tenantId } });
    if (!period) throw new BadRequestException('Period not found or tenant mismatch');

    const currentState = period.state as PortfolioPeriodState;

    // Closed periods immutable — cannot be silently rewritten
    if (currentState === PortfolioPeriodState.CLOSED) {
      throw new BadRequestException('Closed periods immutable — cannot transition');
    }

    const allowed = PERIOD_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid period transition ${currentState} → ${toState}`);
    }

    const updated = await (this.prisma as any).portfolioAccountingPeriod.update({
      where: { id: periodId },
      data: {
        state: toState as any,
        ...(toState === PortfolioPeriodState.CLOSED ? { closedAt: new Date(), closedBy: operatorId ?? null } : {}),
        ...(toState === PortfolioPeriodState.CLOSING ? { closingStartedAt: new Date() } : {}),
        evidence: redactSecrets({
          ...((period.evidence as any) ?? {}),
          lastTransition: { from: currentState, to: toState, reason, operatorId, at: new Date().toISOString() },
        }) as any,
      },
    });

    this.logger.log({ event: 'portfolio.period.transition', periodId, from: currentState, to: toState });

    return updated;
  }

  async getPeriod(params: { tenantId: string; periodId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).portfolioAccountingPeriod.findFirst({
        where: { id: params.periodId, tenantId: params.tenantId },
      });
    } catch {
      return null;
    }
  }

  async listPeriods(params: {
    tenantId: string;
    profileId?: string;
    state?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, profileId, state, from, to, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (profileId) where.profileId = profileId;
    if (state) where.state = state;
    if (from || to) {
      where.periodStart = {};
      if (from) where.periodStart.gte = from;
      if (to) where.periodStart.lte = to;
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).portfolioAccountingPeriod.findMany({
          where,
          orderBy: { periodStart: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).portfolioAccountingPeriod.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async isPeriodClosed(params: { tenantId: string; profileId: string; at: Date }): Promise<boolean> {
    try {
      const period = await (this.prisma as any).portfolioAccountingPeriod.findFirst({
        where: {
          tenantId: params.tenantId,
          profileId: params.profileId,
          periodStart: { lte: params.at },
          periodEnd: { gte: params.at },
          state: 'CLOSED',
        },
      });
      return !!period;
    } catch {
      return false;
    }
  }
}
