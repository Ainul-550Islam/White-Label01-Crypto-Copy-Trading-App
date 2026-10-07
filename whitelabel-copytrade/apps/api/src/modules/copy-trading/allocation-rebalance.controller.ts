// # Responsibility: exposes authenticated preview-only allocation arithmetic and explicitly marks client-supplied valuation inputs as unverified.

import { BadRequestException, Body, Controller, ForbiddenException, Post, Request } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { authTenantId, authUserIdOrNull } from '../../common/guards/request-principal';
import { AllocationRebalancePreviewDto } from './dto/allocation-rebalance.dto';
import { AllocationRebalanceService } from './allocation-rebalance.service';

interface RebalanceRequestPrincipal {
  user?: Record<string, unknown> | null;
}

@Controller('copy-trading')
export class AllocationRebalanceController {
  constructor(private readonly rebalanceService: AllocationRebalanceService) {}

  @Post('allocation-rebalance/preview')
  @RequirePermissions(Permission.STRATEGY_READ)
  preview(@Request() req: RebalanceRequestPrincipal, @Body() dto: AllocationRebalancePreviewDto) {
    // Both values come from the authenticated request context; no client tenant selector is accepted.
    authTenantId(req);
    if (!authUserIdOrNull(req)) throw new ForbiddenException('Authenticated user required');
    try {
      return {
        ...this.rebalanceService.preview({ totalValue: dto.totalValue, allocations: dto.allocations }),
        inputProvenance: 'CLIENT_SUPPLIED_UNVERIFIED',
      };
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
