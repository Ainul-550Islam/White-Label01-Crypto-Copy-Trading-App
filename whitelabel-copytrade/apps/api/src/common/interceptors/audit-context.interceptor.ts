import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap, type Observable } from 'rxjs';
import { AuditActorType, AuditOutcome, type AuditAction } from '@wlct/shared-types';

import { AUDIT_ACTION_KEY } from '../constants/metadata.constants';
import { AuditService } from '../../modules/audit/audit.service';
import type { AppRequest } from '../types/request.types';

interface AuditMetadata {
  action: AuditAction;
  resourceType?: string;
}

/**
 * Emits an audit record for routes annotated with `@Audited(...)`.
 *
 * Writes are queued (BullMQ) rather than awaited so the audit trail never adds
 * latency to the request path, and a slow audit sink cannot fail a mutation.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const metadata = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AppRequest>();

    return next.handle().pipe(
      tap({
        next: (result: unknown) => {
          void this.auditService.record({
            tenantId: request.tenantContext?.tenantId ?? null,
            actorType: request.actor ? AuditActorType.USER : AuditActorType.SYSTEM,
            actorId: request.actor?.userId ?? null,
            action: metadata.action,
            outcome: AuditOutcome.SUCCESS,
            resourceType: metadata.resourceType ?? null,
            resourceId: extractResourceId(result, request),
            ipHash: request.ipHash,
            userAgent: request.headers['user-agent'] ?? null,
            requestId: request.requestId,
            correlationId: request.correlationId,
            operationId: request.requestId,
            metadata: {
              method: request.method,
              path: request.originalUrl.split('?')[0],
            },
          });
        },
        error: (error: unknown) => {
          void this.auditService.record({
            tenantId: request.tenantContext?.tenantId ?? null,
            actorType: request.actor ? AuditActorType.USER : AuditActorType.SYSTEM,
            actorId: request.actor?.userId ?? null,
            action: metadata.action,
            outcome: AuditOutcome.FAILURE,
            resourceType: metadata.resourceType ?? null,
            resourceId: typeof request.params?.id === 'string' ? request.params.id : null,
            ipHash: request.ipHash,
            userAgent: request.headers['user-agent'] ?? null,
            requestId: request.requestId,
            correlationId: request.correlationId,
            operationId: request.requestId,
            metadata: {
              method: request.method,
              path: request.originalUrl.split('?')[0],
              errorName: error instanceof Error ? error.name : 'UnknownError',
            },
          });
        },
      }),
    );
  }
}

function extractResourceId(result: unknown, request: AppRequest): string | null {
  if (result && typeof result === 'object' && 'id' in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === 'string') {
      return id;
    }
  }
  if (typeof request.params?.id === 'string') {
    return request.params.id;
  }
  return null;
}
