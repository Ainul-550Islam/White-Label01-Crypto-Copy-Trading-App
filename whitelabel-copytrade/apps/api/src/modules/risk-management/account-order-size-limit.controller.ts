// # Responsibility: authenticated owner-only account order-size limits with action-bound step-up and durable retries.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Put, Query, Req } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { authTenantId, authUserIdOrNull } from '../../common/guards/request-principal';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { AccountOrderSizeLimitService, type AccountOrderSizeUpdate } from './account-order-size-limit.service';
import { AccountOrderSizeListDto, UpdateAccountOrderSizeLimitDto } from './dto/account-order-size-limit.dto';

interface LimitRequest {
  user?: Record<string, unknown> | null;
  requestId?: unknown;
  id?: unknown;
  headers?: Record<string, unknown>;
}

@Controller('risk-management/my-account-order-limits')
export class AccountOrderSizeLimitController {
  constructor(private readonly service: AccountOrderSizeLimitService) {}

  private owner(req: LimitRequest) {
    const tenantId = authTenantId(req);
    const userId = authUserIdOrNull(req);
    if (!userId) throw new ForbiddenException('Authenticated user required.');
    return { tenantId, userId };
  }

  @Get()
  @RequireAnyPermission(Permission.RISK_READ, Permission.PORTFOLIO_READ)
  async list(@Req() req: LimitRequest, @Query() query: AccountOrderSizeListDto) {
    return this.service.list({ ...this.owner(req), page: query.page ? Number(query.page) : 1, limit: query.limit ? Number(query.limit) : 20 });
  }

  @Get(':accountId')
  @RequireAnyPermission(Permission.RISK_READ, Permission.PORTFOLIO_READ)
  async get(@Req() req: LimitRequest, @Param('accountId') accountId: string) {
    return this.service.get({ ...this.owner(req), accountId });
  }

  @Put(':accountId')
  @RequireAnyPermission(Permission.EXECUTION_SUBMIT, Permission.RISK_CONFIG_UPDATE)
  @RequireStepUp('USER_ACCOUNT_ORDER_LIMIT_UPDATE')
  async update(@Req() req: LimitRequest, @Param('accountId') accountId: string, @Body() dto: UpdateAccountOrderSizeLimitDto) {
    const idempotencyKey = req.headers?.['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('A valid retry key is required.');
    }
    const requestId = req.requestId ?? req.id ?? req.headers?.['x-request-id'];
    return this.service.update({ ...this.owner(req), accountId, input: dto as AccountOrderSizeUpdate, idempotencyKey,
      requestId: typeof requestId === 'string' ? requestId : null });
  }
}
