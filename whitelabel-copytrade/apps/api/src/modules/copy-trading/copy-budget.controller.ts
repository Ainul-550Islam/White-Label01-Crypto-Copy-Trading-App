// # Exposes the follower's global active-copy budget: read the cap, committed exposure and remainder, and set the cap.
import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { authTenantId, authUserIdOrNull } from '../../common/guards/request-principal';
import { CopyBudgetService, type CopyBudgetView } from './copy-budget.service';
import { ReduceCopyBudgetDto, UpsertCopyBudgetDto } from './dto/copy-budget.dto';

interface AuthenticatedRequest {
  user?: Record<string, unknown> | null;
  headers?: Record<string, string | string[] | undefined>;
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

  /** A self-service reduction can only make the caller's budget stricter. */
  @Post('budget/reduce')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async reduceBudget(@Req() req: AuthenticatedRequest, @Body() body: ReduceCopyBudgetDto): Promise<CopyBudgetView> {
    const { tenantId, userId } = this.principal(req);
    const key = req.headers?.['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new BadRequestException('A valid idempotency key is required.');
    }
    return this.copyBudgetService.reduceLimit({ tenantId, userId, maxActiveExposure: body.maxActiveExposure, currency: body.currency, idempotencyKey: key });
  }

  @Put('budget')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async putBudget(@Req() req: AuthenticatedRequest, @Body() body: UpsertCopyBudgetDto): Promise<CopyBudgetView> {
    const { tenantId, userId } = this.principal(req);
    const key = req.headers?.['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new BadRequestException('A valid idempotency key is required.');
    }
    // Legacy PUT used to widen/clear caps without step-up or concurrency
    // protection. Keep it tighten-only until a fully protected widening flow is
    // available. Do not silently clear a per-trader cap or infer a currency.
    if (body.perTraderCap !== undefined || !body.currency) {
      throw new BadRequestException('Only a total-cap reduction with an explicit currency is supported.');
    }
    return this.copyBudgetService.reduceLimit({
      tenantId, userId, maxActiveExposure: body.maxActiveExposure,
      currency: body.currency, idempotencyKey: key,
    });
  }
}
