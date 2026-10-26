// # Denies sensitive routes unless the same tenant/user/session/device has a fresh proof for the exact action, auditing both outcomes.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditActorType, AuditOutcome, ErrorCode, type StepUpAction } from '@wlct/shared-types';

import { REQUIRE_STEP_UP_KEY } from './require-step-up.decorator';
import { StepUpService } from './step-up.service';
import { AuditService } from '../../audit/audit.service';
import type { AppRequest } from '../../../common/types/request.types';
import { AppException } from '../../../common/errors/app.exception';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stepUp: StepUpService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<StepUpAction | undefined>(REQUIRE_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    const actor = request.actor;
    const allowed = actor ? await this.stepUp.isFresh(actor, action) : false;
    await this.audit.recordImmediate({
      tenantId: actor?.tenantId ?? request.tenantContext?.tenantId ?? null,
      actorType: AuditActorType.USER,
      actorId: actor?.userId ?? null,
      action: allowed ? 'STEP_UP_ROUTE_ALLOWED' : 'STEP_UP_ROUTE_DENIED',
      outcome: allowed ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
      resourceType: 'SensitiveOperation',
      description: allowed
        ? 'Fresh step-up proof accepted.'
        : 'Sensitive operation refused without a fresh action-bound proof.',
      ipHash: request.ipHash,
      userAgent: request.headers['user-agent'] ?? null,
      requestId: request.requestId,
      metadata: { action, path: request.originalUrl.split('?')[0], method: request.method },
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
