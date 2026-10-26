// # Serves the caller's own positions with their liquidation-distance bucket, worst first.
//
// THE BUCKET IS DERIVED, NOT INVENTED
// -----------------------------------
// Every row comes from `LiquidationRiskService`, which already refuses to invent a
// liquidation price: when the canonical position has no authoritative liquidation
// level the state is UNKNOWN and the reason says so. This controller maps that state
// to the customer's four buckets and keeps UNKNOWN as its own bucket - a customer who
// is told "safe" because we could not compute anything would size a position on a
// number nobody has.
//
// Scope is the caller: the route reads the caller's own trading accounts and asks the
// risk service per account, so one follower can never see another's exposure, and the
// tenant is taken from the JWT rather than from a query parameter.
import { Controller, Get } from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LiquidationRiskService } from './liquidation-risk.service';

/** The customer-facing buckets. UNKNOWN is a bucket, never a reassurance. */
export type LiquidationBucket = 'SAFE' | 'WATCH' | 'DANGER' | 'CRITICAL' | 'UNKNOWN';

export interface LiquidationAlertView {
  positionId: string;
  accountId: string;
  symbol: string;
  side: string;
  quantity: string;
  markPrice: string | null;
  liquidationPrice: string | null;
  distancePercent: string | null;
  bucket: LiquidationBucket;
  reason: string;
  severity: string;
}

const BUCKET_ORDER: Record<LiquidationBucket, number> = {
  CRITICAL: 4,
  DANGER: 3,
  WATCH: 2,
  UNKNOWN: 1,
  SAFE: 0,
};

/** Risk state -> customer bucket. `UNKNOWN`/`STALE` stay unknown: they are not safety. */
function toBucket(state: unknown): LiquidationBucket {
  switch (String(state ?? '').toUpperCase()) {
    case 'NORMAL':
      return 'SAFE';
    case 'WATCH':
    case 'ELEVATED':
      return 'WATCH';
    case 'HIGH':
      return 'DANGER';
    case 'CRITICAL':
    case 'BLOCKED':
      return 'CRITICAL';
    default:
      return 'UNKNOWN';
  }
}

@Controller('risk/liquidation-alerts')
export class LiquidationAlertController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liquidationRisk: LiquidationRiskService,
  ) {}

  /**
   * One row per open position, worst bucket first.
   *
   * A failure to evaluate one account does not blank the screen: the account's rows
   * are reported as UNKNOWN with the reason, because "the margin check failed" is
   * information the customer needs and an empty list would read as "nothing at risk".
   */
  @Get()
  @RequireAnyPermission(Permission.POSITION_READ, Permission.PORTFOLIO_READ)
  async list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ): Promise<{ data: LiquidationAlertView[]; total: number; unknownCount: number }> {
    const accounts = await this.prisma.tradingAccount.findMany({
      where: { tenantId, userId: user.userId, deletedAt: null },
      select: { id: true },
    });

    const rows: LiquidationAlertView[] = [];
    for (const account of accounts) {
      try {
        // The risk result is keyed by account and symbol, not by position id, so the
        // position rows are read here and joined by symbol. Nothing is invented: a
        // result whose position cannot be found keeps the symbol and reports the
        // account-level id, and its side/quantity stay empty rather than being
        // guessed from the risk numbers.
        const positions = await this.prisma.position.findMany({
          where: { tenantId, accountId: account.id },
          select: { id: true, symbol: true, side: true, quantity: true },
        });
        const bySymbol = new Map(positions.map((position) => [position.symbol, position]));

        const results = await this.liquidationRisk.evaluateLiquidationRisk({
          tenantId,
          accountId: account.id,
        });
        for (const result of results) {
          const position = result.symbol ? bySymbol.get(result.symbol) : undefined;
          rows.push({
            positionId: position?.id ?? `account:${account.id}:${result.symbol ?? 'unknown'}`,
            accountId: account.id,
            symbol: result.symbol ?? '',
            side: position ? String(position.side) : '',
            quantity: position?.quantity?.toString() ?? '0',
            markPrice: result.markPrice,
            liquidationPrice: result.liquidationPrice,
            distancePercent: result.distancePercent,
            bucket: toBucket(result.state),
            reason: result.reason,
            severity: String(result.severity),
          });
        }
      } catch {
        // Never silently drop an account: an unreadable account is UNKNOWN exposure.
        rows.push({
          positionId: `account:${account.id}`,
          accountId: account.id,
          symbol: '',
          side: '',
          quantity: '0',
          markPrice: null,
          liquidationPrice: null,
          distancePercent: null,
          bucket: 'UNKNOWN',
          reason: 'Margin health could not be evaluated for this account, so this is unknown rather than safe.',
          severity: 'UNKNOWN',
        });
      }
    }

    rows.sort((left, right) => BUCKET_ORDER[right.bucket] - BUCKET_ORDER[left.bucket]);
    return {
      data: rows,
      total: rows.length,
      unknownCount: rows.filter((row) => row.bucket === 'UNKNOWN').length,
    };
  }
}
