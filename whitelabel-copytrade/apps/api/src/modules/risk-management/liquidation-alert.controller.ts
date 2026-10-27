import { Controller, Get } from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LiquidationRiskService } from './liquidation-risk.service';

export type LiquidationBucket = 'SAFE' | 'WATCH' | 'DANGER' | 'CRITICAL' | 'UNKNOWN';
export interface LiquidationAlertView {
  positionId: string;
  accountId: string;
  symbol: string;
  side: string;
  quantity: string | null;
  markPrice: string | null;
  liquidationPrice: string | null;
  distancePercent: string | null;
  bucket: LiquidationBucket;
  reason: string;
  severity: string;
  sourceUpdatedAt: string | null;
  containsSimulatedFills: boolean | null;
}

const ORDER: Record<LiquidationBucket, number> = { CRITICAL: 4, DANGER: 3, WATCH: 2, UNKNOWN: 1, SAFE: 0 };
function bucket(state: unknown, authoritative: boolean): LiquidationBucket {
  // A spot 'NORMAL' result is not evidence of distance from liquidation. Nor
  // can missing/non-authoritative price evidence be promoted to a safe state.
  if (!authoritative) return 'UNKNOWN';
  switch (String(state ?? '').toUpperCase()) {
    case 'NORMAL': return 'SAFE';
    case 'WATCH': case 'ELEVATED': return 'WATCH';
    case 'HIGH': return 'DANGER';
    case 'CRITICAL': case 'BLOCKED': return 'CRITICAL';
    default: return 'UNKNOWN';
  }
}

@Controller('risk/liquidation-alerts')
export class LiquidationAlertController {
  constructor(private readonly prisma: PrismaService, private readonly liquidationRisk: LiquidationRiskService) {}

  @Get()
  @RequireAnyPermission(Permission.POSITION_READ, Permission.PORTFOLIO_READ)
  async list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedActor):
    Promise<{ tenantId: string; userId: string; data: LiquidationAlertView[]; total: number; unknownCount: number }> {
    const accounts = await this.prisma.withTenantRls(tenantId, (tx) => tx.tradingAccount.findMany({
      where: { tenantId, userId: user.userId, deletedAt: null }, select: { id: true },
    }));
    const rows: LiquidationAlertView[] = [];
    for (const account of accounts) {
      try {
        const positions = await this.prisma.withTenantRls(tenantId, (tx) => tx.position.findMany({
          // A sync can reopen a nonzero quantity without clearing closedAt;
          // hiding that inconsistency would falsely report no position.
          where: { tenantId, accountId: account.id, quantity: { not: 0 } },
          select: { id: true, symbol: true, side: true, quantity: true, markPrice: true, updatedAt: true, closedAt: true, containsSimulatedFills: true },
        }));
        // Risk results are joined only when there is exactly one result for a
        // symbol. An empty, partial or ambiguous evaluation is UNKNOWN, never an
        // empty/healthy panel. Position ownership comes from the scoped query.
        const results = await this.liquidationRisk.evaluateLiquidationRisk({ tenantId, accountId: account.id });
        for (const position of positions) {
          const matching = results.filter((result) => result.symbol === position.symbol && result.accountId === account.id);
          const result = matching.length === 1 ? matching[0] : null;
          const validNumber = (value: unknown): value is string => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
          const positive = (value: unknown): value is string => validNumber(value) && /[1-9]/.test(value);
          const age = Date.now() - position.updatedAt.getTime();
          const verified = Boolean(result?.isAuthoritative && positive(result.liquidationPrice) &&
            positive(result.markPrice) && result.markPrice === position.markPrice?.toString() &&
            validNumber(result.distancePercent) && !position.containsSimulatedFills && position.closedAt === null &&
            Number.isFinite(age) && age >= 0 && age <= 15 * 60 * 1000);
          const classification = result && verified ? bucket(result.state, true) : 'UNKNOWN';
          rows.push({
            positionId: position.id, accountId: account.id, symbol: position.symbol, side: String(position.side),
            quantity: position.quantity.toString(), markPrice: position.markPrice?.toString() ?? null,
            liquidationPrice: verified ? result!.liquidationPrice : null,
            distancePercent: verified ? result!.distancePercent : null,
            bucket: classification,
            reason: classification === 'UNKNOWN' ? 'Liquidation distance is not available from authoritative evidence.' : 'Liquidation risk was evaluated.',
            severity: classification === 'UNKNOWN' ? 'UNKNOWN' : String(result?.severity ?? 'UNKNOWN'),
            sourceUpdatedAt: position.updatedAt.toISOString(), containsSimulatedFills: position.containsSimulatedFills,
          });
        }
      } catch {
        // Even a failed position read must remain visibly unknown; never invent
        // a zero position or expose a raw provider/storage exception.
        rows.push({ positionId: `account:${account.id}`, accountId: account.id, symbol: '', side: '', quantity: null,
          markPrice: null, liquidationPrice: null, distancePercent: null, bucket: 'UNKNOWN',
          reason: 'Liquidation risk could not be evaluated for this account.', severity: 'UNKNOWN',
          sourceUpdatedAt: null, containsSimulatedFills: null });
      }
    }
    rows.sort((a, b) => ORDER[b.bucket] - ORDER[a.bucket]);
    return { tenantId, userId: user.userId, data: rows, total: rows.length, unknownCount: rows.filter((row) => row.bucket === 'UNKNOWN').length };
  }
}
