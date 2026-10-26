// # Exposes the follower's global active-copy budget: read the cap, committed exposure and remainder, and set the cap.
import { BadRequestException, Body, Controller, Get, Put, Req, UnprocessableEntityException } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { authTenantId, authUserIdOrNull } from '../../common/guards/request-principal';
import { CopyBudgetService, type CopyBudgetView } from './copy-budget.service';
import { UpsertCopyBudgetDto } from './dto/copy-budget.dto';

interface AuthenticatedRequest {
  user?: Record<string, unknown> | null;
}

/**
 * `/v1/copy-trading/budget`.
 *
 * Tenant scope comes from the JWT only (`authTenantId`) and the user from the
 * same principal - neither is accepted as a parameter, so one follower can
 * never read or raise another follower's budget, in this tenant or any other.
 * Reading needs `copy_subscription:read`; changing the cap is a money decision
 * and needs `copy_subscription:manage`.
 */
@Controller('copy-trading')
export class CopyBudgetController {
  constructor(private readonly copyBudgetService: CopyBudgetService) {}

  private principal(req: AuthenticatedRequest): { tenantId: string; userId: string } {
    const tenantId = authTenantId(req);
    const userId = authUserIdOrNull(req);
    if (!userId) throw new BadRequestException('userId required');
    return { tenantId, userId };
  }

  @Get('budget')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  async getBudget(@Req() req: AuthenticatedRequest): Promise<CopyBudgetView> {
    const { tenantId, userId } = this.principal(req);
    return this.copyBudgetService.getView(tenantId, userId);
  }

  @Put('budget')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async putBudget(@Req() req: AuthenticatedRequest, @Body() body: UpsertCopyBudgetDto): Promise<CopyBudgetView> {
    const { tenantId, userId } = this.principal(req);
    try {
      return await this.copyBudgetService.upsertLimits({
        tenantId,
        userId,
        maxActiveExposure: body.maxActiveExposure,
        perTraderCap: body.perTraderCap ?? null,
        currency: body.currency ?? 'USDT',
      });
    } catch (error) {
      // The only refusal the service raises is "above the tenant ceiling", and it
      // is a 422 rather than a 500: it is the customer's input that is wrong, and
      // the message names the ceiling so the form can show it.
      throw new UnprocessableEntityException((error as Error).message);
    }
  }
}
