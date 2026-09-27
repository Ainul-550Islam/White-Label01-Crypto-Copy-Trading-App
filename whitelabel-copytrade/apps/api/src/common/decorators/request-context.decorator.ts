import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest } from '../types/request.types';

export interface RequestMetadata {
  requestId: string;
  /** Part 9: the cross-service correlation id (echoed on the response
   *  header; falls back to requestId for calls that arrived without one). */
  correlationId: string;
  ipHash: string;
  ip: string;
  userAgent: string | null;
  locale: string;
  method: string;
  path: string;
}

/** RequestMetadata deliberately does NOT carry the operation id as a
 *  separate field for callers: for an HTTP request the operation IS the
 *  request. Queue-side code that splits a request into several operations
 *  owns its operation ids locally (see the maintenance jobs). */

/** Injects request metadata needed by audit logging and security analytics. */
export const RequestMeta = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestMetadata => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    return {
      requestId: request.requestId,
      correlationId: request.correlationId,
      ipHash: request.ipHash,
      ip: request.ip ?? 'unknown',
      userAgent: request.headers['user-agent'] ?? null,
      locale: request.locale,
      method: request.method,
      path: request.originalUrl.split('?')[0],
    };
  },
);
