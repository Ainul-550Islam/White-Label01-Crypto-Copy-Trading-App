import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, SecurityEventType, SecuritySeverity } from '@wlct/shared-types';

import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../../../common/constants/metadata.constants';
import { AppException } from '../../../common/errors/app.exception';
import type { AppRequest, TenantContext } from '../../../common/types/request.types';
import { TenantResolverService } from '../tenant-resolver.service';
import { SecurityEventService as SecurityEventsService } from '../../security/security-event.service';

/**
 * Authoritative tenant binding.
 *
 * For authenticated requests the tenant is taken from the *verified* JWT claim
 * and overwrites whatever the middleware inferred from headers or DNS. If the
 * two disagree, the request is treated as a potential isolation attack: it is
 * rejected and a security event is recorded.
 *
 * Platform users (super admins) are permitted to operate inside another tenant,
 * but only when they explicitly select it, and every such call is auditable.
 *
 * "Disagree" means an EXPLICIT selection that contradicts the token. The
 * middleware always produces a context: when a request carries no custom
 * domain, no tenant sub-domain and no X-Tenant-Slug header it falls back to
 * DEFAULT_TENANT_SLUG with source 'default'. That fallback is an assumption
 * made by the server, not a claim made by the client, so treating it as a
 * conflict would reject every legitimate request from a tenant user who simply
 * did not send the optional header. Only 'domain', 'subdomain' and 'header'
 * carry client intent and can therefore constitute an isolation attempt.
 */
/**
 * True when the tenant context came from something the client actually asserted
 * rather than from the configured default.
 */
function isExplicitSelection(source: TenantContext['source']): boolean {
  return source === 'domain' || source === 'subdomain' || source === 'header';
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantResolver: TenantResolverService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const skipTenant = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipTenant) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AppRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Unauthenticated routes rely on the middleware-resolved context.
    if (!request.actor) {
      if (isPublic) {
        return true;
      }
      return true; // JwtAuthGuard has already rejected non-public traffic.
    }

    const jwtTenantId = request.actor.tenantId;
    const inferred = request.tenantContext;

    if (request.actor.isPlatformUser) {
      // A platform operator may work inside the tenant they explicitly selected
      // via domain, sub-domain or header; otherwise they stay in their home
      // tenant. The 'default' fallback is never treated as a selection.
      if (inferred && inferred.tenantId !== jwtTenantId && isExplicitSelection(inferred.source)) {
        return this.applyTenant(request, inferred.tenantId, inferred.source);
      }
      return this.applyTenant(request, jwtTenantId, 'jwt');
    }

    if (inferred && inferred.tenantId !== jwtTenantId && isExplicitSelection(inferred.source)) {
      await this.securityEvents.record({
        tenantId: jwtTenantId,
        userId: request.actor.userId,
        type: SecurityEventType.TENANT_ISOLATION_VIOLATION,
        severity: SecuritySeverity.HIGH,
        description: 'Request tenant context did not match the authenticated token tenant.',
        ipHash: request.ipHash,
        requestId: request.requestId,
        metadata: {
          tokenTenantId: jwtTenantId,
          requestTenantId: inferred.tenantId,
          source: inferred.source,
          path: request.originalUrl.split('?')[0],
        },
      });

      throw new AppException({
        code: ErrorCode.TENANT_MISMATCH,
        message: 'The requested resource does not belong to your organisation.',
      });
    }

    return this.applyTenant(request, jwtTenantId, 'jwt');
  }

  private async applyTenant(
    request: AppRequest,
    tenantId: string,
    source: TenantContext['source'],
  ): Promise<boolean> {
    const tenant = await this.tenantResolver.resolveById(tenantId);

    if (!tenant) {
      throw new AppException({
        code: ErrorCode.TENANT_NOT_FOUND,
        message: 'We could not identify the organisation for this request.',
      });
    }

    if (tenant.status === 'SUSPENDED' || tenant.status === 'ARCHIVED') {
      throw new AppException({
        code: ErrorCode.TENANT_SUSPENDED,
        message: 'This organisation is currently suspended.',
        context: { tenantId, status: tenant.status },
      });
    }

    request.tenantContext = { ...tenant, source };
    return true;
  }
}
