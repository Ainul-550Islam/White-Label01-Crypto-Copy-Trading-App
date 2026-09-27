import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuditAction,
  Permission,
  type AuthenticatedActor,
  type PlanLimits,
  type TenantSubscriptionDto,
} from '@wlct/shared-types';

import { SubscriptionsService } from './subscriptions.service';
import {
  AssignSubscriptionDto,
  CancelSubscriptionDto,
  ChangePlanDto,
} from './dto/subscription.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { Audited } from '../../common/decorators/audit.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';

/**
 * Subscription lifecycle for the caller's own organisation.
 *
 * There is deliberately no `:tenantId` parameter: the tenant always comes from
 * the authenticated context, which removes an entire class of cross-tenant
 * billing mistakes.
 */
@ApiTags('Billing - subscription')
@Controller({ path: 'billing/subscription', version: '1' })
@ApiStandardResponses()
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Current subscription for the organisation' })
  @ApiOkResponse({ description: 'The active subscription, or null.' })
  async current(@TenantId() tenantId: string): Promise<TenantSubscriptionDto | null> {
    return this.subscriptions.getCurrent(tenantId);
  }

  @Get('limits')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({
    summary: 'Entitlements granted by the active plan',
    description: 'Null means the organisation has no subscription and inherits platform defaults.',
  })
  @ApiOkResponse({ description: 'Plan limits.' })
  async limits(@TenantId() tenantId: string): Promise<PlanLimits | null> {
    return this.subscriptions.getLimits(tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @Audited(AuditAction.SUBSCRIPTION_CREATED, 'TenantSubscription')
  @ApiOperation({
    summary: 'Attach a subscription plan to the organisation',
    description:
      'Records the subscription against the payment provider identifiers. No card data is accepted or stored by this API.',
  })
  @ApiOkResponse({ description: 'The created subscription.' })
  async assign(
    @Body() dto: AssignSubscriptionDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantSubscriptionDto> {
    return this.subscriptions.assign(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @Audited(AuditAction.SUBSCRIPTION_UPDATED, 'TenantSubscription')
  @ApiOperation({ summary: 'Move the organisation to a different plan' })
  @ApiOkResponse({ description: 'The updated subscription.' })
  async changePlan(
    @Body() dto: ChangePlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantSubscriptionDto> {
    return this.subscriptions.changePlan(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @Audited(AuditAction.SUBSCRIPTION_CANCELED, 'TenantSubscription')
  @ApiOperation({ summary: 'Cancel the current subscription' })
  @ApiOkResponse({ description: 'The cancelled subscription.' })
  async cancel(
    @Body() dto: CancelSubscriptionDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantSubscriptionDto> {
    return this.subscriptions.cancel(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }
}
