// # Responsibility: exposes tenant-authorized trader benchmark observations without disclosing private trader records.

import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Request } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { authRoles, authTenantId, authUserIdOrNull, hasAdminRole } from '../../common/guards/request-principal';
import { TraderProfileService } from './trader-profile.service';
import { PerformanceBenchmarkService } from './performance-benchmark.service';

@Controller('copy-trading')
export class PerformanceBenchmarkController {
  constructor(
    private readonly traderProfileService: TraderProfileService,
    private readonly benchmarkService: PerformanceBenchmarkService,
  ) {}

  @Get('traders/:traderId/benchmark')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getBenchmark(@Request() req: any, @Param('traderId') traderId: string, @Query('benchmarkKey') benchmarkKey?: string) {
    const tenantId = authTenantId(req);
    const userId = authUserIdOrNull(req);
    const roles = authRoles(req);
    if (!userId) throw new BadRequestException('userId required');
    if (benchmarkKey !== undefined && (benchmarkKey.trim().length === 0 || benchmarkKey.trim().length > 64)) {
      throw new BadRequestException('benchmarkKey must contain 1 to 64 characters');
    }

    const profile = await this.traderProfileService.getProfile(tenantId, traderId);
    if (!profile || (!profile.isPublic && profile.userId !== userId && !hasAdminRole(roles))) {
      throw new NotFoundException('Trader profile not found');
    }

    return this.benchmarkService.getTraderBenchmarkSeries(tenantId, traderId, benchmarkKey?.trim());
  }
}
