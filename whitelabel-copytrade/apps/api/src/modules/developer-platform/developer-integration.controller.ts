import { Controller, Get, Param, Query, Req, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import type { AppRequest } from '../../common/types/request.types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ApiAccessService, type DeveloperAccessDecision } from './api-access.service';
import { DeveloperErrorFilter } from './developer-error.filter';
import { DeveloperUsageService } from './developer-usage.service';
import { DEVELOPER_ERROR_CODES as C, DeveloperError } from './developer.types';

type Endpoint = 'integration.client' | 'integration.profile';

/** Read-only developer integration routes. The server-resolved tenant, persisted
 * application environment/pin, grant and scopes are enforced on every call. */
@Controller('developer-platform/integration/:environment')
@UseFilters(new DeveloperErrorFilter())
export class DeveloperIntegrationController {
  constructor(private readonly access: ApiAccessService, private readonly prisma: PrismaService, private readonly usage: DeveloperUsageService) {}

  private async authorize(req: AppRequest, res: Response, environment: string, version: string | undefined, endpoint: Endpoint) {
    const tenant = req.tenantContext;
    if (!tenant) throw new DeveloperError(C.TENANT_MISMATCH, 'tenant could not be resolved');
    if (environment !== 'sandbox' && environment !== 'production') throw new DeveloperError(C.VALIDATION, 'invalid environment');
    const headerVersion = typeof req.headers['x-api-version'] === 'string' ? req.headers['x-api-version'] : undefined;
    if ((version !== undefined && (typeof version !== 'string' || version.length > 32)) || (headerVersion && headerVersion.length > 32)) throw new DeveloperError(C.VALIDATION, 'invalid API version');
    if (version && headerVersion && version !== headerVersion) throw new DeveloperError(C.VALIDATION, 'conflicting API versions');
    let decision: DeveloperAccessDecision;
    try {
      const now = new Date();
      decision = await this.access.authorize({
        resolvedTenantId: tenant.tenantId, expectedEnvironment: environment === 'production' ? 'PRODUCTION' : 'SANDBOX',
        authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
        requiredScope: 'profile:read', apiVersion: version ?? headerVersion ?? '', endpointClass: endpoint,
        nowIso: now.toISOString(), nowSeconds: Math.floor(now.getTime() / 1000),
      });
    } catch (error) {
      // A rate limit is attributable only after the server recognized the key,
      // app and pin. Unrecognized credentials are not assigned to any app.
      if (error instanceof DeveloperError && error.code === C.RATE_LIMITED &&
          error.detail?.tenantId === tenant.tenantId && typeof error.detail?.applicationId === 'string' && typeof error.detail?.apiVersion === 'string') {
        await this.usage.recordIntegrationRequest({ tenantId: tenant.tenantId, applicationId: error.detail.applicationId,
          apiVersion: error.detail.apiVersion, endpoint, outcome: 'rate_limited' });
      }
      throw error;
    }
    for (const [name, value] of Object.entries({ ...decision.versionHeaders, ...decision.rateLimitHeaders })) res.setHeader(name, value);
    res.setHeader('Cache-Control', 'no-store');
    return decision;
  }

  private async record<T>(decision: DeveloperAccessDecision, endpoint: Endpoint, work: () => Promise<T> | T): Promise<T> {
    let result: T;
    try { result = await work(); }
    catch (error) {
      await this.usage.recordIntegrationRequest({ tenantId: decision.tenantId, applicationId: decision.applicationId,
        apiVersion: decision.apiVersion, endpoint, outcome: error instanceof DeveloperError ? '4xx' : '5xx' });
      throw error;
    }
    await this.usage.recordIntegrationRequest({ tenantId: decision.tenantId, applicationId: decision.applicationId,
      apiVersion: decision.apiVersion, endpoint, outcome: 'ok' });
    return result;
  }

  @Public()
  @Get('client')
  async client(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response,
    @Param('environment') environment: string, @Query('version') version?: string) {
    const decision = await this.authorize(req, res, environment, version, 'integration.client');
    return this.record(decision, 'integration.client', () => this.prisma.withTenantRls(decision.tenantId, async (tx) => {
      const application = await tx.developerApplication.findFirst({
        where: { id: decision.applicationId, tenantId: decision.tenantId, state: 'ACTIVE' },
        select: { clientId: true, name: true, environment: true },
      });
      if (!application) throw new DeveloperError(C.NOT_FOUND, 'application not found');
      return { clientId: application.clientId, name: application.name, environment: application.environment, apiVersion: decision.apiVersion };
    }));
  }

  @Public()
  @Get('profile')
  async profile(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response,
    @Param('environment') environment: string, @Query('version') version?: string) {
    const decision = await this.authorize(req, res, environment, version, 'integration.profile');
    return this.record(decision, 'integration.profile', async () => {
      if (decision.identityType !== 'OAUTH_TOKEN' || !decision.userId) throw new DeveloperError(C.CODE_INVALID, 'user authorization required');
      const userId = decision.userId;
      const user = await this.prisma.withTenantRls(decision.tenantId, (tx) => tx.user.findFirst({
        where: { id: userId, tenantId: decision.tenantId, status: 'ACTIVE', deletedAt: null },
        select: { id: true, email: true, profile: { select: { displayName: true, locale: true } } },
      }));
      if (!user) throw new DeveloperError(C.NOT_FOUND, 'profile not found');
      return { id: user.id, email: user.email, displayName: user.profile?.displayName ?? null, locale: user.profile?.locale ?? null };
    });
  }
}
