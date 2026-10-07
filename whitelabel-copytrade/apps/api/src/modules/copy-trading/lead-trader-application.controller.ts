// # Responsibility: exposes applicant-owned submission/history routes and tenant-admin-only application review routes.

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { LeadTraderApplicationStatus } from '@prisma/client';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { authRoles, authTenantId, authUserIdOrNull, hasAdminRole } from '../../common/guards/request-principal';
import { limitParam, pageParam } from '../../common/dto/pagination-params';
import {
  ReviewLeadTraderApplicationDto,
  SubmitLeadTraderApplicationDto,
} from './dto/lead-trader-application.dto';
import { LeadTraderApplicationService } from './lead-trader-application.service';

const APPLICATION_STATUSES: LeadTraderApplicationStatus[] = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'];
type LeadTraderRequest = { user?: Record<string, unknown> | null };

@Controller('copy-trading/lead-trader-applications')
export class LeadTraderApplicationController {
  constructor(private readonly applicationService: LeadTraderApplicationService) {}

  @Post()
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async submit(@Request() request: LeadTraderRequest, @Body() body: SubmitLeadTraderApplicationDto) {
    const { tenantId, userId } = this.applicantContext(request);
    return this.applicationService.apply(tenantId, userId, body);
  }

  @Get('mine')
  @RequirePermissions(Permission.STRATEGY_READ)
  async listMine(@Request() request: LeadTraderRequest) {
    const { tenantId, userId } = this.applicantContext(request);
    return { data: await this.applicationService.listMine(tenantId, userId) };
  }

  @Get('admin')
  @RequireAnyPermission(Permission.TENANT_UPDATE, Permission.PLATFORM_MANAGE)
  async listQueue(
    @Request() request: LeadTraderRequest,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { tenantId } = this.operatorContext(request);
    const parsedStatus = APPLICATION_STATUSES.find((candidate) => candidate === status);
    if (status && !parsedStatus) {
      throw new BadRequestException('Unsupported application queue status.');
    }
    return this.applicationService.listQueue({
      tenantId,
      status: parsedStatus,
      page: pageParam(page),
      limit: limitParam(limit, 20),
    });
  }

  @Post(':applicationId/start-review')
  @RequireAnyPermission(Permission.TENANT_UPDATE, Permission.PLATFORM_MANAGE)
  async startReview(@Request() request: LeadTraderRequest, @Param('applicationId', new ParseUUIDPipe()) applicationId: string) {
    const { tenantId, userId } = this.operatorContext(request);
    return this.applicationService.startReview(tenantId, applicationId, userId);
  }

  @Post(':applicationId/decision')
  @RequireAnyPermission(Permission.TENANT_UPDATE, Permission.PLATFORM_MANAGE)
  async decide(
    @Request() request: LeadTraderRequest,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: ReviewLeadTraderApplicationDto,
  ) {
    const { tenantId, userId } = this.operatorContext(request);
    return this.applicationService.transition(tenantId, applicationId, userId, body.decision, body.decisionReason);
  }

  private applicantContext(request: LeadTraderRequest): { tenantId: string; userId: string } {
    const tenantId = authTenantId(request);
    const userId = authUserIdOrNull(request);
    if (!userId) throw new ForbiddenException('Authenticated user context is required.');
    return { tenantId, userId };
  }

  private operatorContext(request: LeadTraderRequest): { tenantId: string; userId: string } {
    const tenantId = authTenantId(request);
    const userId = authUserIdOrNull(request);
    const roles = authRoles(request);
    if (!userId || !hasAdminRole(roles)) throw new ForbiddenException('A tenant or platform administrator is required.');
    return { tenantId, userId };
  }
}
