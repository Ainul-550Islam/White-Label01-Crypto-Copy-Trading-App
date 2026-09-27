import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { HEADER_INTERNAL_TOKEN } from '@wlct/config';
import { safeCompare } from '@wlct/utils';
import { ErrorCode } from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import { AppException } from '../errors/app.exception';
import type { AppRequest } from '../types/request.types';

/**
 * Protects endpoints that only internal services (trading engine, market data,
 * notification worker) may call. In production this sits behind mTLS as well;
 * the shared token is the application-layer second factor.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const header = request.headers[HEADER_INTERNAL_TOKEN];
    const token = Array.isArray(header) ? header[0] : header;

    if (!token || !safeCompare(token, this.config.internalServiceToken)) {
      throw new AppException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Internal service authentication failed.',
      });
    }

    return true;
  }
}
