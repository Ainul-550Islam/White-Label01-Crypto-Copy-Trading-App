/**
 * Developer platform controller boundary.
 *
 * Management routes require a session; OAuth token exchange is public and
 * authenticates the client and authorization code.
 * OAuth code and token endpoints intentionally
 * return newly issued values once. Stored digests and ciphertext stay private.
 */

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Redirect, Req, SetMetadata, UnauthorizedException, UseFilters } from '@nestjs/common';
import type { Request } from 'express';

import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { SKIP_RESPONSE_TRANSFORM_KEY } from '../../common/constants/metadata.constants';
import { Public } from '../../common/decorators/public.decorator';
import { AllowAnyAuthenticated, RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { PlatformOnly } from '../../common/decorators/permissions.decorator';
import { Permission } from '@wlct/shared-types';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { ApiAccessService } from './api-access.service';
import { DeveloperErrorFilter } from './developer-error.filter';
import { DEVELOPER_SCOPES } from './developer.types';
import { ApiVersionService } from './api-version.service';
import { DeveloperVersionPinService } from './developer-version-pin.service';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { requireMutationKey } from './developer-mutation-intent';
import {
  CreateCredentialDto,
  CreateWebhookSubscriptionDto,
  OAuthAuthorizeDto,
  OAuthConsentDto,
  OAuthIssueCodeDto,
  OAuthRevokeDto,
  OAuthTokenExchangeDto,
  PinApiVersionDto,
  RevokeCredentialDto,
  RotateCredentialDto,
  UpdateApplicationScopesDto,
  UpdateWebhookSubscriptionDto,
  WebhookReplayDto,
  WebhookReasonDto,
  WebhookSubscriptionActionDto,
} from './dto/developer-action.dto';
import {
  AddRedirectUriDto,
  ApplicationTransitionDto,
  CreateDeveloperApplicationDto,
  UpdateDeveloperApplicationDto,
} from './dto/developer-application.dto';
import { DeveloperAnalyticsQuery, DeveloperUsageQuery, ListApplicationsQuery, ListAuditQuery, ListCredentialsQuery, ListDeliveriesQuery, ListGrantsQuery, ListWebhookSubscriptionsQuery } from './dto/developer-query.dto';
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
@UseFilters(new DeveloperErrorFilter())
export class DeveloperController {
  constructor(
    private readonly applications: DeveloperApplicationService,
    private readonly credentials: DeveloperCredentialService,
    private readonly oauth: OAuthService,
    private readonly versionsService: ApiVersionService,
    private readonly apiAccess: ApiAccessService,
    private readonly versionPins: DeveloperVersionPinService,
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

  @RequireStepUp('DEVELOPER_APPLICATION_CREATE')
  @Post('applications')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createApplication(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() dto: CreateDeveloperApplicationDto,
  ) {
    const application = await this.applications.create({ ...this.actor(tenantId, request), ...dto }, requireMutationKey(request));
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

  @RequireStepUp('DEVELOPER_APPLICATION_UPDATE')
  @Patch('applications/:id')
  @RequireAnyPermission(MANAGE)
  async updateApplication(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateDeveloperApplicationDto,
  ) {
    return this.applications.update(this.actor(tenantId, request), id, dto, requireMutationKey(request));
  }

  // Preserve the legacy multiplexed URL as a non-mutating redirect. Each
  // destination consumes a proof specific to the requested transition.
  @Post('applications/:id/transitions')
  @RequireAnyPermission(MANAGE)
  @Redirect()
  @SetMetadata(SKIP_RESPONSE_TRANSFORM_KEY, true)
  transitionApplication(@Req() request: Request, @Body() dto: ApplicationTransitionDto) {
    requireMutationKey(request);
    const routes: Record<string, string> = { ACTIVE: 'activate', SUSPENDED: 'suspend', REACTIVATION_REVIEW: 'request-reactivation', REVOKED: 'revoke' };
    const destination = routes[dto.targetState];
    const path = request.originalUrl.split('?')[0];
    if (!destination || !/^\/(?!\/)[^?#\r\n]*\/transitions$/.test(path)) throw new BadRequestException('unsupported application transition');
    return { url: `${path.slice(0, -'transitions'.length)}${destination}`, statusCode: 307 };
  }

  @RequireStepUp('DEVELOPER_APPLICATION_ACTIVATE')
  @Post('applications/:id/activate')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.OK)
  async activateApplication(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id') id: string, @Body() dto: ApplicationTransitionDto) {
    if (dto.targetState !== 'ACTIVE') throw new BadRequestException('target state does not match route');
    await this.applications.activate(this.actor(tenantId, request), id, requireMutationKey(request));
    return { id, state: 'ACTIVE' };
  }

  @RequireStepUp('DEVELOPER_APPLICATION_SUSPEND')
  @Post('applications/:id/suspend')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.OK)
  async suspendApplication(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id') id: string, @Body() dto: ApplicationTransitionDto) {
    if (dto.targetState !== 'SUSPENDED') throw new BadRequestException('target state does not match route');
    await this.applications.suspend(this.actor(tenantId, request), id, dto.reason, requireMutationKey(request));
    return { id, state: 'SUSPENDED' };
  }

  @RequireStepUp('DEVELOPER_APPLICATION_REACTIVATE')
  @Post('applications/:id/request-reactivation')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.OK)
  async requestApplicationReactivation(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id') id: string, @Body() dto: ApplicationTransitionDto) {
    if (dto.targetState !== 'REACTIVATION_REVIEW') throw new BadRequestException('target state does not match route');
    const state = await this.applications.requestReactivation(this.actor(tenantId, request), id, dto.reason, requireMutationKey(request));
    return { id, state };
  }

  @RequireStepUp('DEVELOPER_APPLICATION_REVOKE')
  @Post('applications/:id/revoke')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.OK)
  async revokeApplication(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id') id: string, @Body() dto: ApplicationTransitionDto) {
    if (dto.targetState !== 'REVOKED') throw new BadRequestException('target state does not match route');
    await this.applications.revoke(this.actor(tenantId, request), id, dto.reason, requireMutationKey(request));
    return { id, state: 'REVOKED' };
  }

  @RequireStepUp('DEVELOPER_APPLICATION_APPROVE')
  @Post('applications/:id/approve-reactivation')
  @PlatformOnly()
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.OK)
  async approveApplicationReactivation(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id') id: string, @Body() dto: ApplicationTransitionDto) {
    if (dto.targetState !== 'ACTIVE') throw new BadRequestException('target state does not match route');
    await this.applications.approveReactivation(this.actor(tenantId, request), id, requireMutationKey(request));
    return { id, state: 'ACTIVE' };
  }

  @RequireStepUp('DEVELOPER_APPLICATION_UPDATE')
  @Post('applications/:id/redirect-uris')
  @RequireAnyPermission(MANAGE)
  async addRedirectUri(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() body: AddRedirectUriDto,
  ) {
    return this.applications.addRedirectUri(this.actor(tenantId, request), id, body.redirect.uri, requireMutationKey(request));
  }

  @RequireStepUp('DEVELOPER_APPLICATION_SCOPE_CHANGE')
  @Put('applications/:id/scopes')
  @RequireAnyPermission(MANAGE)
  async updateScopes(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateApplicationScopesDto,
  ) {
    return this.credentials.updateApplicationScopes(this.actor(tenantId, request), id, dto, requireMutationKey(request));
  }

  @RequireStepUp('API_KEY_CREATE')
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
    return this.credentials.createApiKey(this.actor(tenantId, request), id, dto, requireMutationKey(request));
  }

  @Get('credentials')
  @RequireAnyPermission(READ)
  async listCredentials(@CurrentTenant('tenantId') tenantId: string, @Query() query: ListCredentialsQuery) {
    return this.credentials.listForTenant(tenantId, query);
  }

  @RequireStepUp('API_KEY_CREATE')
  @Post('applications/:id/credentials/:keyId/rotate')
  @RequireAnyPermission(MANAGE)
  async rotateCredential(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body() dto: RotateCredentialDto,
  ) {
    return this.credentials.rotate(this.actor(tenantId, request), id, keyId, dto.reason, requireMutationKey(request));
  }

  @RequireStepUp('API_KEY_REVOKE')
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
    await this.credentials.revoke(this.actor(tenantId, request), id, keyId, dto.reason, requireMutationKey(request));
  }

  // -------------------------------------------------------------------- oauth

  @Post('oauth/authorize')
  @AllowAnyAuthenticated()
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
  @AllowAnyAuthenticated()
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
  @AllowAnyAuthenticated()
  async oauthIssueCode(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() body: OAuthIssueCodeDto,
  ) {
    return this.oauth.issueAuthorizationCode(this.actor(tenantId, request), body.grantId);
  }

  @Get('oauth/grants')
  @AllowAnyAuthenticated()
  async oauthGrants(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Query() query: ListGrantsQuery) {
    return this.oauth.listUserGrants(tenantId, this.actor(tenantId, request).actorId, query.limit ?? 50, query.cursor);
  }

  @Post('oauth/grants/:id/revoke')
  @AllowAnyAuthenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  async oauthRevokeGrant(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id', ParseUuidPipe) id: string) {
    await this.oauth.revokeUserGrant(this.actor(tenantId, request), id, requireMutationKey(request));
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

  @Get('scope-catalog')
  @RequireAnyPermission(READ)
  scopeCatalog() {
    return { scopes: DEVELOPER_SCOPES.map(({ scope, category, write }) => ({ scope, category, write })) };
  }

  // ----------------------------------------------------------------- webhooks

  @RequireStepUp('WEBHOOK_CREATE')
  @Post('webhooks')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createWebhook(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Body() dto: CreateWebhookSubscriptionDto,
  ) {
    const { subscription, secret } = await this.webhooks.create(this.actor(tenantId, request), dto, requireMutationKey(request));
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

  @RequireStepUp('WEBHOOK_UPDATE')
  @Patch('webhooks/:id')
  @RequireAnyPermission(MANAGE)
  async updateWebhook(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateWebhookSubscriptionDto,
  ) {
    return this.webhooks.update(this.actor(tenantId, request), id, dto, requireMutationKey(request));
  }

  // Backwards-compatible alias: 307 preserves POST body and headers, but the
  // destination's distinct action-bound guard is always the only mutator.
  @Post('webhooks/:id/actions')
  @RequireAnyPermission(MANAGE)
  @Redirect()
  @SetMetadata(SKIP_RESPONSE_TRANSFORM_KEY, true)
  webhookAction(@Req() request: Request, @Body() dto: WebhookSubscriptionActionDto) {
    const path = request.originalUrl.split('?')[0];
    if (!['pause', 'resume', 'revoke'].includes(dto.action) || !/^\/(?!\/)[^?#\r\n]*\/actions$/.test(path)) {
      throw new BadRequestException('unsupported webhook action');
    }
    return { url: `${path.slice(0, -'actions'.length)}${dto.action}`, statusCode: 307 };
  }

  @RequireStepUp('WEBHOOK_PAUSE')
  @Post('webhooks/:id/pause')
  @RequireAnyPermission(MANAGE)
  async pauseWebhook(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id') id: string, @Body() dto: WebhookReasonDto) {
    if (dto.action && dto.action !== 'pause') throw new BadRequestException('action does not match route');
    return this.webhooks.pause(this.actor(tenantId, request), id, dto.reason, requireMutationKey(request));
  }

  @RequireStepUp('WEBHOOK_RESUME')
  @Post('webhooks/:id/resume')
  @RequireAnyPermission(MANAGE)
  async resumeWebhook(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id') id: string, @Body() dto: WebhookReasonDto) {
    if (dto.action && dto.action !== 'resume') throw new BadRequestException('action does not match route');
    return this.webhooks.resume(this.actor(tenantId, request), id, dto.reason, requireMutationKey(request));
  }

  @RequireStepUp('WEBHOOK_REVOKE')
  @Post('webhooks/:id/revoke')
  @RequireAnyPermission(MANAGE)
  async revokeWebhook(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id') id: string, @Body() dto: WebhookReasonDto) {
    if (dto.action && dto.action !== 'revoke') throw new BadRequestException('action does not match route');
    await this.webhooks.revoke(this.actor(tenantId, request), id, dto.reason, requireMutationKey(request));
    return { id, state: 'REVOKED' };
  }

  @RequireStepUp('WEBHOOK_SECRET_ROTATE')
  @Post('webhooks/:id/rotate-secret')
  @RequireAnyPermission(MANAGE)
  async rotateWebhookSecret(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
  ) {
    return this.webhooks.rotateSecret(this.actor(tenantId, request), id, requireMutationKey(request));
  }

  @RequireStepUp('WEBHOOK_REPLAY')
  @Post('webhooks/:id/replay')
  @RequireAnyPermission(MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  async replayWebhook(
    @CurrentTenant('tenantId') tenantId: string,
    @Req() request: Request & { user?: { id?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: WebhookReplayDto,
  ) {
    return this.replay.replay(this.actor(tenantId, request), id, dto.eventId, requireMutationKey(request));
  }

  @Get('webhooks/:id/deliveries')
  @RequireAnyPermission(READ)
  async listDeliveries(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Query() query: ListDeliveriesQuery,
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

  @Get('applications/:id/api-version')
  @RequireAnyPermission(READ)
  applicationVersion(@CurrentTenant('tenantId') tenantId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.versionPins.get(tenantId, id);
  }

  @RequireStepUp('DEVELOPER_APPLICATION_VERSION_PIN')
  @Put('applications/:id/api-version')
  @RequireAnyPermission(MANAGE)
  pinApplicationVersion(@CurrentTenant('tenantId') tenantId: string, @Req() request: Request,
    @Param('id', ParseUuidPipe) id: string, @Body() dto: PinApiVersionDto) {
    return this.versionPins.set(this.actor(tenantId, request), id, dto.version, requireMutationKey(request));
  }

  // --------------------------------------------------- platform reconciliation

  @Get('reconciliation')
  @PlatformOnly()
  async reconciliation(@CurrentTenant('tenantId') currentTenantId: string, @Query('tenantId') tenantId?: string) {
    const target = tenantId ?? currentTenantId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) {
      throw new BadRequestException('valid tenant ID required');
    }
    return this.reconciliationService.reconcile(target);
  }

  /** Use only the server-resolved tenant context, never a tenant id in the token request body. */
  private oauthTenantHint(request: Request): string {
    const tenant = (request as Request & { tenantContext?: { tenantId: string } }).tenantContext;
    if (!tenant?.tenantId) {
      throw new UnauthorizedException('tenant context required for token exchange');
    }
    return tenant.tenantId;
  }
}
