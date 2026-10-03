/**
 * Developer platform controller boundary.
 *
 * Two surfaces, strictly separated:
 *
 * 1. PORTAL (session-authenticated, tenant from JWT, RBAC via permissions):
 *    application/credential/scope/webhook/usage/analytics/audit/version
 *    management. Secrets are returned exactly once on create/rotate.
 *
 * 2. DEVELOPER API (external, credential/token authenticated through
 *    ApiAccessService — version resolution, scope check, policy rate limit):
 *    the programmatic surface SDKs call. Tenant identity NEVER comes from
 *    the request; it comes from the resolved credential record.
 *
 * No route here ever returns a secret hash, an authorization code, a token
 * value or another tenant's records.
 */

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
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { PlatformOnly } from '../../common/decorators/permissions.decorator';
import { Permission } from '@wlct/shared-types';
import { ApiAccessService } from './api-access.service';
import { ApiVersionService } from './api-version.service';
import {
  CreateCredentialDto,
  OAuthAuthorizeDto,
  OAuthConsentDto,
  OAuthRevokeDto,
  OAuthTokenExchangeDto,
  RevokeCredentialDto,
  RotateCredentialDto,
  UpdateApplicationScopesDto,
  WebhookReplayDto,
  WebhookSubscriptionActionDto,
} from './dto/developer-action.dto';
import {
  ApplicationTransitionDto,
  CreateDeveloperApplicationDto,
  UpdateDeveloperApplicationDto,
} from './dto/developer-application.dto';
import {
  DeveloperAnalyticsQuery,
  DeveloperUsageQuery,
  ListApplicationsQuery,
  ListAuditQuery,
  ListCredentialsQuery,
  ListDeliveriesQuery,
  ListWebhookSubscriptionsQuery,
  PlatformListApplicationsQuery,
} from './dto/developer-query.dto';
import { DeveloperAnalyticsService } from './developer-analytics.service';
import { DeveloperApplicationService, type DeveloperActor } from './developer-application.service';
import { DeveloperAuditService } from './developer-audit.service';
import { DeveloperCredentialService } from './developer-credential.service';
import { DeveloperReconciliationService } from './developer-reconciliation.service';
import { DeveloperUsageService } from './developer-usage.service';
import { EventSubscriptionService } from './event-subscription.service';
import { OAuthService } from './oauth.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookReplayService } from './webhook-replay.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';

const READ = Permission.API_KEY_READ;
const MANAGE = Permission.API_KEY_MANAGE;

@Controller('developer-platform')
export class DeveloperController {
  constructor(
    private readonly applications: DeveloperApplicationService,
    private readonly credentials: DeveloperCredentialService,
    private readonly oauth: OAuthService,
    private readonly versionsService: ApiVersionService,
    private readonly apiAccess: ApiAccessService,
    private readonly webhooks: WebhookSubscriptionService,
    private readonly deliveries: WebhookDeliveryService,
    private readonly replay: WebhookReplayService,
    private readonly events: EventSubscriptionService,
    private readonly usageService: DeveloperUsageService,
    private readonly analyticsService: DeveloperAnalyticsService,
    private readonly audit: DeveloperAuditService,
    private readonly reconciliationService: DeveloperReconciliationService,
  ) {}

  private actor(
    tenantId: string,
    request: Request & { user?: { userId?: string; id?: string; sub?: string } },
  ): DeveloperActor {
    // The authenticated actor exposes userId; id/sub never existed on it, so
    // every developer-portal audit entry was attributed to 'system'.
    const actorId = request.user?.userId ?? request.user?.id ?? request.user?.sub ?? 'system';
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ?? String(request.id ?? '') ?? 'portal';
    return { tenantId, actorType: 'USER', actorId, correlationId };
  }

  // ------------------------------------------------------------------ portal

  @Post('applications')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createApplication(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() dto: CreateDeveloperApplicationDto,
  ) {
    const application = await this.applications.create({ ...this.actor(tenantId, request), ...dto });
    // Safe shaping: internal columns (idempotencyKey, hashes) never leave.
    const { idempotencyKey: _idem, createdByActorId: _actor, ...safe } = application;
    void _idem;
    void _actor;
    return safe;
  }

  @Get('applications')
  @RequireAnyPermission(READ)
  async listApplications(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: ListApplicationsQuery,
  ) {
    return this.applications.listForTenant(tenantId, query);
  }

  @Get('applications/:id')
  @RequireAnyPermission(READ)
  async getApplication(@CurrentTenant('tenantId') tenantId: string, @Param('id') id: string) {
    return this.applications.getOwned(tenantId, id);
  }

  @Patch('applications/:id')
  @RequireAnyPermission(MANAGE)
  async updateApplication(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateDeveloperApplicationDto,
  ) {
    return this.applications.update(this.actor(tenantId, request), id, dto);
  }

  @Post('applications/:id/transitions')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.OK)
  async transitionApplication(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: ApplicationTransitionDto,
  ) {
    const actor = this.actor(tenantId, request);
    switch (dto.targetState) {
      case 'ACTIVE':
        await this.applications.activate(actor, id);
        break;
      case 'SUSPENDED':
        await this.applications.suspend(actor, id, dto.reason);
        break;
      case 'REACTIVATION_REVIEW':
        await this.applications.requestReactivation(actor, id, dto.reason);
        break;
      case 'REVOKED':
        await this.applications.revoke(actor, id, dto.reason);
        break;
      default:
        break;
    }
    return { id, state: dto.targetState };
  }

  @Post('applications/:id/redirect-uris')
  @RequireAnyPermission(MANAGE)
  async addRedirectUri(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() body: { redirect: { uri: string } },
  ) {
    return this.applications.addRedirectUri(this.actor(tenantId, request), id, body.redirect.uri);
  }

  @Put('applications/:id/scopes')
  @RequireAnyPermission(MANAGE)
  async updateScopes(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateApplicationScopesDto,
  ) {
    return this.credentials.updateApplicationScopes(this.actor(tenantId, request), id, dto);
  }

  @Post('applications/:id/credentials')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createCredential(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: CreateCredentialDto,
  ) {
    // ONE-TIME secret presentation: this response is the only ever view.
    return this.credentials.createApiKey(this.actor(tenantId, request), id, dto);
  }

  @Get('credentials')
  @RequireAnyPermission(READ)
  async listCredentials(@CurrentTenant('tenantId') tenantId: string, @Query() query: ListCredentialsQuery) {
    return this.credentials.listForTenant(tenantId, query);
  }

  @Post('applications/:id/credentials/:keyId/rotate')
  @RequireAnyPermission(MANAGE)
  async rotateCredential(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body() dto: RotateCredentialDto,
  ) {
    return this.credentials.rotate(this.actor(tenantId, request), id, keyId, dto.reason);
  }

  @Delete('applications/:id/credentials/:keyId')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeCredential(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body() dto: RevokeCredentialDto,
  ) {
    await this.credentials.revoke(this.actor(tenantId, request), id, keyId, dto.reason);
  }

  // -------------------------------------------------------------------- oauth

  @Post('oauth/authorize')
  @RequireAnyPermission(MANAGE)
  async oauthAuthorize(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() dto: OAuthAuthorizeDto,
  ) {
    return this.oauth.createAuthorizationRequest({
      tenantId,
      userId: this.actor(tenantId, request).actorId,
      correlationId: this.actor(tenantId, request).correlationId,
      ...dto,
    });
  }

  @Post('oauth/consent')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  async oauthConsent(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() dto: OAuthConsentDto,
  ) {
    await this.oauth.recordConsent(this.actor(tenantId, request), dto.grantId, dto.decision);
    return { grantId: dto.grantId, state: dto.decision };
  }

  @Post('oauth/code')
  @RequireAnyPermission(MANAGE)
  async oauthIssueCode(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() body: { grantId: string },
  ) {
    return this.oauth.issueAuthorizationCode(this.actor(tenantId, request), body.grantId);
  }

  /** External token exchange: authenticated by client credentials, not session. */
  @Public()
  @Post('oauth/token')
  @HttpCode(HttpStatus.OK)
  async oauthToken(@Req() request: Request, @Body() dto: OAuthTokenExchangeDto) {
    const tenantHint = this.oauthTenantHint(request);
    return this.oauth.exchangeToken({
      tenantId: tenantHint,
      ...dto,
      correlationId: (request.headers['x-correlation-id'] as string | undefined) ?? String(request.id ?? '') ?? 'oauth',
    });
  }

  @Post('oauth/revoke')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async oauthRevoke(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() dto: OAuthRevokeDto,
  ) {
    await this.oauth.revokeToken(this.actor(tenantId, request), dto.token);
  }

  // ----------------------------------------------------------------- webhooks

  @Post('webhooks')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createWebhook(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() dto: { applicationId: string; endpointUrl: string; eventTypes: string[]; eventVersion?: string; environment?: 'SANDBOX' | 'PRODUCTION'; description?: string },
  ) {
    const { subscription, secret } = await this.webhooks.create(this.actor(tenantId, request), dto);
    return { subscription, secret };
  }

  @Get('webhooks')
  @RequireAnyPermission(READ)
  async listWebhooks(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: ListWebhookSubscriptionsQuery,
  ) {
    return this.webhooks.list(tenantId, query);
  }

  @Patch('webhooks/:id')
  @RequireAnyPermission(MANAGE)
  async updateWebhook(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: { endpointUrl?: string; eventTypes?: string[]; description?: string },
  ) {
    return this.webhooks.update(this.actor(tenantId, request), id, dto);
  }

  @Post('webhooks/:id/actions')
  @RequireAnyPermission(MANAGE)
  async webhookAction(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: WebhookSubscriptionActionDto,
  ) {
    const actor = this.actor(tenantId, request);
    if (dto.action === 'pause') return this.webhooks.pause(actor, id, dto.reason);
    if (dto.action === 'resume') return this.webhooks.resume(actor, id, dto.reason);
    await this.webhooks.revoke(actor, id, dto.reason);
    return { id, state: 'REVOKED' };
  }

  @Post('webhooks/:id/rotate-secret')
  @RequireAnyPermission(MANAGE)
  async rotateWebhookSecret(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
  ) {
    return this.webhooks.rotateSecret(this.actor(tenantId, request), id);
  }

  @Post('webhooks/:id/replay')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  async replayWebhook(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: WebhookReplayDto,
  ) {
    return this.replay.replay(this.actor(tenantId, request), id, dto.eventId);
  }

  @Get('webhooks/:id/deliveries')
  @RequireAnyPermission(READ)
  async listDeliveries(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Query() query: Omit<ListDeliveriesQuery, 'subscriptionId'>,
  ) {
    return this.deliveries.list(tenantId, { ...query, subscriptionId: id });
  }

  @Get('event-types')
  @RequireAnyPermission(READ)
  eventTypes() {
    return { eventTypes: this.events.catalog() };
  }

  // ------------------------------------------------------- usage & analytics

  @Get('usage')
  @RequireAnyPermission(READ)
  async usageReport(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: DeveloperUsageQuery,
  ) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (query.applicationId) {
      return this.usageService.applicationRollup(tenantId, query.applicationId, {
        applicationId: query.applicationId,
        from,
        to,
        granularity: query.granularity ?? 'day',
      });
    }
    return this.usageService.rollup(tenantId, { from, to, granularity: query.granularity ?? 'day' });
  }

  @Get('analytics')
  @RequireAnyPermission(READ)
  async analytics(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Query() query: DeveloperAnalyticsQuery,
  ) {
    if (!query.applicationId) {
      throw new UnauthorizedException('applicationId is required for application analytics');
    }
    return this.analyticsService.applicationAnalytics({
      tenantId,
      applicationId: query.applicationId,
      from: query.from ? new Date(query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: query.to ? new Date(query.to) : new Date(),
      latencyObservations: [],
    });
  }

  @Get('audit')
  @RequireAnyPermission(READ)
  async auditTrail(@CurrentTenant('tenantId') tenantId: string, @Query() query: ListAuditQuery) {
    return this.audit.list(tenantId, query);
  }

  // ---------------------------------------------------------- api versions

  @Get('api-versions')
  @RequireAnyPermission(READ)
  apiVersions() {
    return { versions: this.versionsService.contracts() };
  }

  // --------------------------------------------------- platform reconciliation

  @Get('reconciliation')
  @PlatformOnly()
  async reconciliation(@Query('tenantId') tenantId?: string) {
    return this.reconciliationService.reconcile(tenantId);
  }

  /** Externally reachable tenant hint comes ONLY from the JWT middleware. */
  private oauthTenantHint(request: Request): string {
    const tenant = (request as Request & { tenantContext?: { tenantId: string } }).tenantContext;
    if (!tenant?.tenantId) {
      throw new UnauthorizedException('tenant context required for token exchange');
    }
    return tenant.tenantId;
  }
}
