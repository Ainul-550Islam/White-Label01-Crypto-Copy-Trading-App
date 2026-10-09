// # Responsibility: exposes authenticated preview-only allocation arithmetic and explicitly marks client-supplied valuation inputs as unverified.
//
// GAP-60. There are two ways to get a total into this arithmetic and they are not equivalent:
//
//   - the caller sends `totalValue`, in which case the arithmetic is exact and the starting figure is
//     their claim. That response says CLIENT_SUPPLIED_UNVERIFIED, and the label is the whole point:
//     it tells the reader which half of the answer came from the database and which came from them.
//   - the caller omits `totalValue` and names a `quoteAsset`, in which case the total is read from the
//     tenant's own persisted positions through `allocationRepository`. That response says
//     PERSISTED_PORTFOLIO_VALUATION and carries the `asOf` timestamp of the newest contributing
//     position, so a stale figure is visible as a stale figure.
//
// When the persisted valuation cannot be computed the route returns state UNAVAILABLE and refuses to
// do the arithmetic. It does not fall back to the client's number (that would relabel an unverified
// input as verified) and it does not use zero (that would produce a preview that says the portfolio
// is empty, which is a different and equally wrong statement).

import { BadRequestException, Body, Controller, ForbiddenException, Post, Request } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { authTenantId, authUserIdOrNull } from '../../common/guards/request-principal';
import { AllocationRebalancePreviewDto } from './dto/allocation-rebalance.dto';
import { AllocationRebalanceService, RebalancePreviewLine } from './allocation-rebalance.service';
import { AllocationValuationRepository } from './allocation-valuation.repository';

interface RebalanceRequestPrincipal {
  user?: Record<string, unknown> | null;
}

const QUOTE_ASSET_PATTERN = /^[A-Z0-9]{2,16}$/;

/** The unchanged client-supplied envelope, pinned by allocation-rebalance.controller.spec.ts. */
export interface ClientSuppliedPreviewResponse {
  totalValue: string;
  lines: RebalancePreviewLine[];
  executable: false;
  reason: string;
  inputProvenance: 'CLIENT_SUPPLIED_UNVERIFIED';
}

/** The persisted-valuation envelope, used when the caller omits `totalValue`. */
export interface PersistedPreviewResponse {
  state: 'AVAILABLE' | 'UNAVAILABLE';
  inputProvenance: 'PERSISTED_PORTFOLIO_VALUATION';
  quoteAsset: string;
  /** Newest contributing position update time; null when nothing contributed. */
  asOf: string | null;
  /** True only together with state AVAILABLE, and even then nothing has been submitted. */
  executable: false;
  totalValue: string | null;
  lines: RebalancePreviewLine[];
  reason: string;
}

@Controller('copy-trading')
export class AllocationRebalanceController {
  constructor(
    private readonly rebalanceService: AllocationRebalanceService,
    /**
     * Optional so that the arithmetic unit test can construct the controller with the service alone:
     * a controller built that way serves the client-supplied path only, and refuses the persisted one
     * with an error rather than quietly substituting the caller's number for the database's.
     */
    private readonly allocationRepository?: AllocationValuationRepository,
  ) {}

  /**
   * Returns the client-supplied envelope synchronously and the persisted one as a promise. The
   * synchronous branch is deliberate: it is the contract the existing spec pins, and a NestJS handler
   * returning a value or a promise is the same thing to the HTTP layer.
   */
  @Post('allocation-rebalance/preview')
  @RequirePermissions(Permission.STRATEGY_READ)
  preview(
    @Request() req: RebalanceRequestPrincipal,
    @Body() dto: AllocationRebalancePreviewDto,
  ): ClientSuppliedPreviewResponse | Promise<PersistedPreviewResponse> {
    // Both values come from the authenticated request context; no client tenant selector is accepted.
    const tenantId = authTenantId(req);
    if (!authUserIdOrNull(req)) throw new ForbiddenException('Authenticated user required');

    if (dto.totalValue !== undefined) {
      const totalValue = dto.totalValue;
      try {
        return {
          ...this.rebalanceService.preview({ totalValue, allocations: dto.allocations }),
          inputProvenance: 'CLIENT_SUPPLIED_UNVERIFIED' as const,
        };
      } catch (error) {
        throw asBadRequest(error);
      }
    }

    const quoteAsset = (dto.quoteAsset ?? '').trim().toUpperCase();
    if (!QUOTE_ASSET_PATTERN.test(quoteAsset)) {
      throw new BadRequestException(
        'Provide either totalValue for client-supplied arithmetic, or quoteAsset for the persisted portfolio valuation',
      );
    }

    return this.previewFromPersistedValuation(tenantId, quoteAsset, dto);
  }

  private async previewFromPersistedValuation(
    tenantId: string,
    quoteAsset: string,
    dto: AllocationRebalancePreviewDto,
  ): Promise<PersistedPreviewResponse> {
    const repository = this.allocationRepository;
    if (!repository) {
      // Fail closed and loudly: a controller with no repository cannot verify anything, and the one
      // thing it must not do is answer from the caller's numbers while claiming otherwise.
      throw new Error('Persisted portfolio valuation is not available on this controller');
    }

    const valuation = await repository.loadPersistedPortfolioValuation({
      tenantId,
      quoteAsset,
      accountId: dto.accountId ?? null,
      includeSimulated: dto.includeSimulated === 'true',
    });

    const group = valuation.quoteAssets.find((entry) => entry.quoteAsset === quoteAsset) ?? null;
    const totalValue = group?.state === 'AVAILABLE' ? group.totalValue : null;

    if (valuation.state !== 'AVAILABLE' || totalValue === null || totalValue === undefined) {
      return {
        state: 'UNAVAILABLE',
        inputProvenance: 'PERSISTED_PORTFOLIO_VALUATION',
        quoteAsset,
        asOf: valuation.asOf,
        executable: false,
        totalValue: null,
        lines: [],
        reason: valuation.reason ?? `No persisted portfolio value is available for ${quoteAsset}.`,
      };
    }

    let preview;
    try {
      preview = this.rebalanceService.preview({ totalValue, allocations: dto.allocations });
    } catch (error) {
      throw asBadRequest(error);
    }

    return {
      state: 'AVAILABLE',
      inputProvenance: 'PERSISTED_PORTFOLIO_VALUATION',
      quoteAsset,
      asOf: valuation.asOf,
      executable: false,
      totalValue: preview.totalValue,
      lines: preview.lines,
      reason: 'Preview only; the total came from persisted positions and no order or transfer has been created.',
    };
  }
}

function asBadRequest(error: unknown): unknown {
  if (error instanceof TypeError || error instanceof RangeError) return new BadRequestException(error.message);
  return error;
}
