import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { RateLimitService } from './rate-limit.service';
import { EnforcementContextBuilder } from './enforcement.context';
import { EnforcementAuditService } from './enforcement.audit';
import {
  EnforcementDecisionCode,
  type EnforcementActor,
  type QuotaCheckResult,
} from './enforcement.types';
import { RateLimitExceededError } from './enforcement.errors';
import type { AppRequest } from '../../../common/types/request.types';

/**
 * API-layer runtime rate-limit guard.
 *
 * Flow:
 *   request → resolve tenant → resolve active plan → resolve
 *   maxApiRequestsPerMinute → invoke rate-limit service → allow OR reject
 *
 * The guard integrates with NestJS's guard pipeline so existing controllers
 * are protected without modification.  The rate limit is dynamic per-tenant,
 * never globally hardcoded.
 */
@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly audit: EnforcementAuditService,
    @InjectPinoLogger(ApiRateLimitGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();

    const tenantContext = request.tenantContext;
    if (!tenantContext) {
      // No tenant context means the request is not authenticated or is public.
      // Public endpoints are protected by a global throttler, not this guard.
      return true;
    }

    const actor: EnforcementActor = {
      userId: request.actor?.userId ?? 'anonymous',
      tenantId: tenantContext.tenantId,
      roles: request.actor?.roles ?? [],
      ipHash: request.ipHash,
      requestId: request.requestId,
      correlationId: request.correlationId,
    };

    const billingCtx = await this.contextBuilder.resolveBillingContext(actor.tenantId);

    const result = await this.rateLimitService.checkAndIncrement({
      tenantId: actor.tenantId,
      limitKey: 'maxApiRequestsPerMinute',
      maximum: billingCtx.planLimits.maxApiRequestsPerMinute,
      scopeId: actor.userId,
    });

    // Build a minimal context for the audit call.
    const enforcementCtx = {
      tenant: billingCtx,
      actor,
    };

    await this.audit.logRateLimitCheck(enforcementCtx, result, actor.userId);

    if (!result.allowed) {
      throw new RateLimitExceededError({
        limitKey: 'maxApiRequestsPerMinute',
        currentUsage: result.currentUsage,
        configuredMaximum: result.configuredMaximum!,
        windowStart: result.windowStart ? new Date(result.windowStart) : undefined,
        windowEnd: result.windowEnd ? new Date(result.windowEnd) : undefined,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }

    return true;
  }
}
