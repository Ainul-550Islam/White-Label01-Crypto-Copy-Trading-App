import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuditAction,
  Permission,
  type AuthenticatedActor,
  type PaginatedResult,
  type SubscriptionPlanDto,
} from '@wlct/shared-types';

import { PlansService } from './plans.service';
import { CreatePlanDto, ListPlansDto, UpdatePlanDto } from './dto/plan.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { Audited } from '../../common/decorators/audit.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Billing - plans')
@Controller({ path: 'billing/plans', version: '1' })
@ApiStandardResponses()
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLAN_READ)
  @ApiOperation({
    summary: 'List subscription plans visible to the caller',
    description:
      'Platform operators see the whole catalogue; a tenant sees the platform plans it can buy plus the plans it owns.',
  })
  @ApiOkResponse({ description: 'Paginated plans.' })
  async list(
    @Query() query: ListPlansDto,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<PaginatedResult<SubscriptionPlanDto>> {
    return this.plans.list(query, {
      tenantId: actor.tenantId,
      isPlatformUser: actor.isPlatformUser,
    });
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLAN_READ)
  @ApiOperation({ summary: 'Fetch a plan by id' })
  @ApiOkResponse({ description: 'The plan.' })
  async findById(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<SubscriptionPlanDto> {
    return this.plans.findById(id, {
      tenantId: actor.tenantId,
      isPlatformUser: actor.isPlatformUser,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.PLAN_MANAGE)
  @Audited(AuditAction.PLAN_CREATED, 'SubscriptionPlan')
  @ApiOperation({ summary: 'Create a subscription plan' })
  @ApiCreatedResponse({ description: 'The created plan.' })
  async create(
    @Body() dto: CreatePlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<SubscriptionPlanDto> {
    return this.plans.create(
      dto,
      { tenantId: actor.tenantId, isPlatformUser: actor.isPlatformUser },
      {
        actorId: actor.userId,
        auditTenantId: tenantId,
        ipHash: meta.ipHash,
        requestId: meta.requestId,
      },
    );
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLAN_MANAGE)
  @Audited(AuditAction.PLAN_UPDATED, 'SubscriptionPlan')
  @ApiOperation({ summary: 'Update a subscription plan' })
  @ApiOkResponse({ description: 'The updated plan.' })
  async update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<SubscriptionPlanDto> {
    return this.plans.update(
      id,
      dto,
      { tenantId: actor.tenantId, isPlatformUser: actor.isPlatformUser },
      {
        actorId: actor.userId,
        auditTenantId: tenantId,
        ipHash: meta.ipHash,
        requestId: meta.requestId,
      },
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLAN_MANAGE)
  @Audited(AuditAction.PLAN_UPDATED, 'SubscriptionPlan')
  @ApiOperation({
    summary: 'Archive a subscription plan',
    description: 'Refused while the plan still has trialing, active or past-due subscribers.',
  })
  @ApiOkResponse({ description: 'Archive acknowledgement.' })
  async archive(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ id: string; archived: true }> {
    return this.plans.archive(
      id,
      { tenantId: actor.tenantId, isPlatformUser: actor.isPlatformUser },
      {
        actorId: actor.userId,
        auditTenantId: tenantId,
        ipHash: meta.ipHash,
        requestId: meta.requestId,
      },
    );
  }
}
