import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { FEATURE_FLAG_KEY } from '../constants/metadata.constants';
import { FeatureDisabledException } from '../errors/app.exception';
import { FeatureFlagsService } from '../../modules/feature-flags/feature-flags.service';
import type { AppRequest } from '../types/request.types';

/**
 * Enforces `@RequireFeature('flag_key')`. Flags are evaluated per tenant and
 * cached in Redis, so the hot path is a single cache lookup rather than a
 * database query. No latency figure is claimed or guaranteed.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flagKey = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!flagKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AppRequest>();
    const tenantId = request.tenantContext?.tenantId;

    if (!tenantId) {
      throw new FeatureDisabledException(flagKey);
    }

    const enabled = await this.featureFlags.isEnabled(tenantId, flagKey);
    if (!enabled) {
      throw new FeatureDisabledException(flagKey);
    }

    return true;
  }
}
