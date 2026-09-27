import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@wlct/shared-types';

import { FeatureFlagsService } from '../feature-flags.service';
import { FEATURE_FLAG_KEY } from '../../../common/constants/metadata.constants';
import { AppException } from '../../../common/errors/app.exception';
import type { AppRequest } from '../../../common/types/request.types';

/**
 * Enforces `@RequireFeature('key')`. Runs after tenant resolution so the flag
 * is always evaluated against a server-derived tenant.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFlag = this.reflector.getAllAndOverride<string | undefined>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredFlag) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AppRequest>();
    const tenantId = request.tenantContext?.tenantId;

    if (!tenantId) {
      throw new AppException({
        code: ErrorCode.TENANT_NOT_FOUND,
        message: 'No organisation could be resolved for this request.',
      });
    }

    const enabled = request.actor
      ? await this.featureFlags.isEnabledForUser(tenantId, request.actor.userId, requiredFlag)
      : await this.featureFlags.isEnabled(tenantId, requiredFlag);

    if (!enabled) {
      throw new AppException({
        code: ErrorCode.FEATURE_DISABLED,
        message: 'This feature is not enabled for your organisation.',
        context: { feature: requiredFlag },
      });
    }

    return true;
  }
}
