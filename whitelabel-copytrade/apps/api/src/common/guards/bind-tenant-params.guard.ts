import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AppRequest } from '../types/request.types';

/**
 * Binds `tenantId` in the request body and query string to the tenant the
 * global TenantGuard resolved from the verified token (or, for platform
 * operators, the tenant they explicitly selected).
 *
 * Some controllers take `tenantId` as an ordinary body/query field and hand it
 * straight to their services. Without this guard, any authenticated user could
 * name another tenant's id and act on that tenant's data. With it:
 * - a `tenantId` that differs from the bound tenant is rejected (403);
 * - a missing `tenantId` is filled in with the bound tenant, so an optional
 *   field can never mean "all tenants".
 *
 * Apply with `@UseGuards(BindTenantParamsGuard)` only on controllers whose
 * body/query DTOs declare `tenantId` (the filled value must pass
 * whitelist validation). Controller-level guards run after the global
 * JwtAuthGuard/TenantGuard/PermissionsGuard and before validation pipes.
 */
@Injectable()
export class BindTenantParamsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    const bound = request.tenantContext?.tenantId ?? request.actor?.tenantId;
    if (!bound) throw new ForbiddenException('Tenant context required');

    this.bind(request.query as unknown, bound, 'query');
    this.bind(request.body as unknown, bound, 'body');
    return true;
  }

  private bind(container: unknown, tenantId: string, where: 'query' | 'body'): void {
    if (container === null || typeof container !== 'object' || Array.isArray(container)) return;
    const record = container as Record<string, unknown>;
    const supplied = record.tenantId;
    if (supplied === undefined || supplied === null || supplied === '') {
      record.tenantId = tenantId;
      return;
    }
    if (supplied !== tenantId) {
      throw new ForbiddenException(`tenantId in ${where} does not match the authenticated tenant`);
    }
  }
}
