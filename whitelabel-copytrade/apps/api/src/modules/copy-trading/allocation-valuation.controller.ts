// # Responsibility: serves the persisted, per-quote-asset portfolio valuation the allocation preview needs, tenant-scoped and permission-decorated.
//
// GAP-60. The allocation preview route below is preview-only by design and takes its total from the
// caller, which is why it labels its output CLIENT_SUPPLIED_UNVERIFIED. That label protects the
// customer: the arithmetic is exact but the starting figure is their claim, not a fact. This route is
// the fact, when one is needed - it reads the tenant's persisted positions and values them per quote
// asset, or reports UNAVAILABLE with a reason.
//
// It does not value across quote assets and it does not convert. Two groups are two totals because
// there is no FX rate in this service and inventing one would be an invented number.

import { BadRequestException, Controller, Get, Query, Request } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { authTenantId } from '../../common/guards/request-principal';
import {
  AllocationValuationRepository,
  PersistedPortfolioValuation,
} from './allocation-valuation.repository';

interface ValuationRequestPrincipal {
  user?: Record<string, unknown> | null;
}

const QUOTE_ASSET_PATTERN = /^[A-Z0-9]{2,16}$/;

@Controller('copy-trading')
export class AllocationValuationController {
  constructor(private readonly valuationRepository: AllocationValuationRepository) {}

  /**
   * `GET /v1/copy-trading/portfolio-valuation`
   *
   * `quoteAsset` selects one group and is required, because the caller is about to allocate against
   * this figure and a portfolio-wide summary would invite summing groups that are not the same
   * money. `accountId` narrows the read to a single trading account, which is also tenant-checked:
   * an account id from another tenant simply matches no positions.
   */
  @Get('portfolio-valuation')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getValuation(
    @Request() req: ValuationRequestPrincipal,
    @Query('quoteAsset') quoteAsset?: string,
    @Query('accountId') accountId?: string,
    @Query('includeSimulated') includeSimulated?: string,
  ): Promise<PersistedPortfolioValuation & { executable: false; reason: string }> {
    const tenantId = authTenantId(req);
    const requested = (quoteAsset ?? '').trim().toUpperCase();
    if (!QUOTE_ASSET_PATTERN.test(requested)) {
      throw new BadRequestException('quoteAsset is required, for example USDT: two to sixteen letters or digits');
    }
    if (accountId !== undefined && accountId !== '' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
      throw new BadRequestException('accountId must be a UUID when supplied');
    }
    if (includeSimulated !== undefined && includeSimulated !== 'true' && includeSimulated !== 'false') {
      throw new BadRequestException('includeSimulated must be true or false when supplied');
    }

    const valuation = await this.valuationRepository.loadPersistedPortfolioValuation({
      tenantId,
      quoteAsset: requested,
      accountId: accountId && accountId !== '' ? accountId : null,
      includeSimulated: includeSimulated === 'true',
    });

    return {
      ...valuation,
      executable: false,
      reason:
        valuation.state === 'AVAILABLE'
          ? 'Persisted valuation only; no order or transfer has been created.'
          : valuation.reason ?? 'Portfolio valuation is unavailable.',
    };
  }
}
