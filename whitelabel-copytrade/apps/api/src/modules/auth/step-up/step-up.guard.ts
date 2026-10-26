// # Denies sensitive routes unless the caller presents a single-use, action-bound step-up proof, consuming it atomically and auditing both outcomes.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type StepUpAction } from '@wlct/shared-types';

import { REQUIRE_STEP_UP_KEY } from './require-step-up.decorator';
import { StepUpAuthService } from '../step-up-auth.service';
import { AppException } from '../../../common/errors/app.exception';
import type { AppRequest } from '../../../common/types/request.types';

/**
 * The route-side half of step-up authentication.
 *
 * It CONSUMES the proof. A guard that merely checked freshness would leave the
 * grant usable for the rest of its window, which is the replay this whole
 * mechanism exists to stop: an attacker who captures one authorised request
 * could repeat it. Consuming means the same proof cannot authorise two
 * operations, and a retried request needs a fresh verification - which is the
 * correct cost for rotating an API key.
 *
 * The audit record is written by the service (`consumeForRoute`) so an allowed
 * and a refused attempt are described the same way, with the store's own reason
 * code, in one place.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stepUpAuth: StepUpAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<StepUpAction | undefined>(REQUIRE_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const actor = request.actor ?? null;
    const allowed = await this.stepUpAuth.consumeForRoute(actor, action, {
      ipHash: request.ipHash,
      requestId: request.requestId,
      userAgent: request.headers['user-agent'] ?? null,
      path: request.originalUrl.split('?')[0],
      method: request.method,
    });
    if (allowed) return true;
    if (!actor) throw new AppException({ code: ErrorCode.UNAUTHORIZED });
    throw new ForbiddenException({
      code: ErrorCode.STEP_UP_REQUIRED,
      message: 'A fresh verification is required for this action.',
      action,
    });
  }
}
