// # Responsibility: exposes authenticated, self-service user-wide concurrent position and open-order limit settings.

import { BadRequestException, Body, Controller, Get, Req, ForbiddenException, Put } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { authTenantId, authUserIdOrNull } from '../../common/guards/request-principal';
import { PositionLimitService } from '../risk/position-limit.service';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { UpdateUserPositionLimitDto } from './dto/user-position-limit.dto';

interface PositionLimitRequest {
  user?: Record<string, unknown> | null;
  requestId?: unknown;
  id?: unknown;
  headers?: Record<string, unknown>;
}

@Controller('risk-management')
export class UserPositionLimitController {
  constructor(private readonly positionLimitService: PositionLimitService) {}

  @Get('my-position-limits')
  @RequireAnyPermission(Permission.RISK_READ, Permission.PORTFOLIO_READ)
  async getMyLimits(@Req() req: PositionLimitRequest) {
    const tenantId = authTenantId(req);
    const userId = authUserIdOrNull(req);
    if (!userId) throw new ForbiddenException('Authenticated user required.');
    return this.positionLimitService.getMyLimits({ tenantId, userId });
  }

  @Put('my-position-limits')
  @RequireAnyPermission(Permission.EXECUTION_SUBMIT, Permission.RISK_CONFIG_UPDATE)
  @RequireStepUp('USER_POSITION_LIMIT_UPDATE')
  async updateMyLimits(@Req() req: PositionLimitRequest, @Body() dto: UpdateUserPositionLimitDto) {
    const tenantId = authTenantId(req);
    const userId = authUserIdOrNull(req);
    if (!userId) throw new ForbiddenException('Authenticated user required.');
    const idempotencyKey = req.headers?.['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey) || dto.expectedUpdatedAt === undefined) {
      throw new BadRequestException('A valid retry key and observed limit version are required.');
    }
    const requestIdValue = req.requestId ?? req.id ?? req.headers?.['x-request-id'];
    const requestId = typeof requestIdValue === 'string' ? requestIdValue : null;
    const patch = {
      ...(dto.maxConcurrentPositions !== undefined ? { maxConcurrentPositions: dto.maxConcurrentPositions } : {}),
      ...(dto.maxOpenOrders !== undefined ? { maxOpenOrders: dto.maxOpenOrders } : {}),
    };
    return this.positionLimitService.updateMyLimits({ tenantId, userId, patch, requestId, idempotencyKey, expectedUpdatedAt: dto.expectedUpdatedAt });
  }
}
