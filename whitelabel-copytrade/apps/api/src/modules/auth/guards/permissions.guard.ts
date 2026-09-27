import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ErrorCode,
  SecurityEventType,
  SecuritySeverity,
  hasAllPermissions,
  hasAnyPermission,
  type Permission,
} from '@wlct/shared-types';

import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
  PLATFORM_ONLY_KEY,
} from '../../../common/constants/metadata.constants';
import { AppException } from '../../../common/errors/app.exception';
import { PermissionsService } from '../../rbac/permissions.service';
import { SecurityEventService as SecurityEventsService } from '../../security/security-event.service';
import type { PermissionMode } from '../../../common/decorators/permissions.decorator';
import type { AppRequest } from '../../../common/types/request.types';

/**
 * Permission enforcement.
 *
 * Checks run against the *live* permission set from the RBAC cache rather than
 * the snapshot embedded in the JWT, so revoking a role takes effect within the
 * cache TTL instead of the token lifetime. Denials are recorded as security
 * events, which is how privilege-escalation probing becomes visible.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic && !platformOnly && (!required || required.length === 0)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AppRequest>();
    const actor = request.actor;

    if (!actor) {
      throw new AppException({ code: ErrorCode.UNAUTHORIZED });
    }

    if (platformOnly && !actor.isPlatformUser) {
      await this.denied(request, ['platform:manage'], 'platform_only');
      throw new AppException({
        code: ErrorCode.INSUFFICIENT_PERMISSIONS,
        message: 'This endpoint is restricted to platform administrators.',
      });
    }

    if (!required || required.length === 0) {
      return true;
    }

    const access = await this.permissions.getEffectiveAccess(actor.userId);
    const mode =
      this.reflector.getAllAndOverride<PermissionMode>(PERMISSIONS_MODE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'all';

    const granted =
      mode === 'any'
        ? hasAnyPermission(access.permissionKeys, required)
        : hasAllPermissions(access.permissionKeys, required);

    if (!granted) {
      await this.denied(request, required, mode);
      throw new AppException({
        code: ErrorCode.INSUFFICIENT_PERMISSIONS,
        message: 'You do not have permission to perform this action.',
        context: { required, mode },
      });
    }

    // Keep the request-scoped actor in sync with the authoritative set.
    actor.permissions = access.permissionKeys;
    actor.roles = access.roleKeys;

    return true;
  }

  private async denied(
    request: AppRequest,
    required: readonly string[],
    mode: string,
  ): Promise<void> {
    await this.securityEvents.record({
      tenantId: request.tenantContext?.tenantId ?? null,
      userId: request.actor?.userId ?? null,
      type: SecurityEventType.PERMISSION_ESCALATION_ATTEMPT,
      severity: SecuritySeverity.LOW,
      description: 'A request was denied because the caller lacked the required permissions.',
      ipHash: request.ipHash,
      userAgent: request.headers['user-agent'] ?? null,
      requestId: request.requestId,
      metadata: {
        path: request.originalUrl.split('?')[0],
        method: request.method,
        required,
        mode,
      },
    });
  }
}
