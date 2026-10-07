// # Responsibility: exposes authenticated, self-service user-wide concurrent position and open-order limit settings.

import { Body, Controller, Get, Req, ForbiddenException, Put } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { authTenantId, authUserIdOrNull } from '../../common/guards/request-principal';
import { PositionLimitService } from '../risk/position-limit.service';
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
  async updateMyLimits(@Req() req: PositionLimitRequest, @Body() dto: UpdateUserPositionLimitDto) {
    const tenantId = authTenantId(req);
    const userId = authUserIdOrNull(req);
    if (!userId) throw new ForbiddenException('Authenticated user required.');

    const requestIdValue = req.requestId ?? req.id ?? req.headers?.['x-request-id'];
    const requestId = typeof requestIdValue === 'string' ? requestIdValue : null;
    return this.positionLimitService.updateMyLimits({ tenantId, userId, patch: dto, requestId });
  }
}
