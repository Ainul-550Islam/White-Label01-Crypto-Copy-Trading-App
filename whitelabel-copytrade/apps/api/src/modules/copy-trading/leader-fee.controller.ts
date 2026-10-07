// # Responsibility: exposes tenant-scoped public fee disclosures and administrator-only policy-version writes.

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { authRoles, authTenantId, authUserIdOrNull, hasAdminRole } from '../../common/guards/request-principal';
import { LeaderFeeService } from './leader-fee.service';
import { SetLeaderFeePolicyDto } from './dto/leader-fee.dto';

type LeaderFeeRequest = { user?: Record<string, unknown> | null };

@Controller('copy-trading/leader-fees')
export class LeaderFeeController {
  constructor(private readonly leaderFeeService: LeaderFeeService) {}

  @Get('traders/:traderId')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getPublicPolicy(
    @Request() request: LeaderFeeRequest,
    @Param('traderId', new ParseUUIDPipe()) traderId: string,
    @Query('currency') currency?: string,
  ) {
    return this.leaderFeeService.getPublicPolicy(authTenantId(request), traderId, currency ?? 'USD');
  }

  @Get('traders/:traderId/history')
  @RequireAnyPermission(Permission.TENANT_UPDATE, Permission.PLATFORM_MANAGE)
  async listPolicyHistory(
    @Request() request: LeaderFeeRequest,
    @Param('traderId', new ParseUUIDPipe()) traderId: string,
    @Query('currency') currency?: string,
  ) {
    const { tenantId } = this.operatorContext(request);
    return { data: await this.leaderFeeService.listPolicyHistory(tenantId, traderId, currency ?? 'USD') };
  }

  @Post('traders/:traderId')
  @RequireAnyPermission(Permission.TENANT_UPDATE, Permission.PLATFORM_MANAGE)
  async setPolicy(
    @Request() request: LeaderFeeRequest,
    @Param('traderId', new ParseUUIDPipe()) traderId: string,
    @Body() body: SetLeaderFeePolicyDto,
  ) {
    const { tenantId, userId } = this.operatorContext(request);
    return this.leaderFeeService.setPolicy(tenantId, traderId, userId, body);
  }

  private operatorContext(request: LeaderFeeRequest): { tenantId: string; userId: string } {
    const tenantId = authTenantId(request);
    const userId = authUserIdOrNull(request);
    if (!userId || !hasAdminRole(authRoles(request))) {
      throw new ForbiddenException('A tenant or platform administrator is required.');
    }
    if (!tenantId) throw new BadRequestException('Tenant context is required.');
    return { tenantId, userId };
  }
}
