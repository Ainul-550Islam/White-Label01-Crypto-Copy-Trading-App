import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { ErrorCode } from '@wlct/shared-types';

import { AppException } from '../errors/app.exception';
import type { AppRequest } from '../types/request.types';

/**
 * Rate limiting keyed by the real client identity rather than the proxy IP.
 *
 * Authenticated traffic is bucketed per user so one noisy customer cannot
 * exhaust a shared NAT allowance for everyone behind the same egress IP;
 * anonymous traffic falls back to the forwarded IP address.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as AppRequest;

    if (request.actor?.userId) {
      return `user:${request.actor.userId}`;
    }

    const forwarded = request.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : undefined;

    const ip = forwardedIp ?? request.ip ?? 'unknown';
    const tenantId = request.tenantContext?.tenantId ?? 'no-tenant';
    return `ip:${tenantId}:${ip}`;
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new AppException({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message: `Too many requests. Try again in ${Math.ceil(
        throttlerLimitDetail.timeToBlockExpire,
      )} seconds.`,
      context: {
        limit: throttlerLimitDetail.limit,
        ttl: throttlerLimitDetail.ttl,
      },
    });
  }
}
