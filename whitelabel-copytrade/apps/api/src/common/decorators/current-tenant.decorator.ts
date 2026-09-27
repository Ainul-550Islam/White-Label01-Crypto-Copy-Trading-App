import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest, TenantContext } from '../types/request.types';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Injects the resolved tenant context. The value is derived server-side from
 * the JWT (authenticated calls) or the request host (public calls) - never from
 * a client supplied tenant id.
 */
export const CurrentTenant = createParamDecorator(
  (property: keyof TenantContext | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const tenant = request.tenantContext;
    if (!tenant) {
      throw new AppException({
        code: ErrorCode.TENANT_NOT_FOUND,
        message: 'No organisation could be resolved for this request.',
      });
    }
    return property ? tenant[property] : tenant;
  },
);

/** Shorthand for the most common need: the tenant id string. */
export const TenantId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<AppRequest>();
  const tenant = request.tenantContext;
  if (!tenant) {
    throw new AppException({
      code: ErrorCode.TENANT_NOT_FOUND,
      message: 'No organisation could be resolved for this request.',
    });
  }
  return tenant.tenantId;
});
