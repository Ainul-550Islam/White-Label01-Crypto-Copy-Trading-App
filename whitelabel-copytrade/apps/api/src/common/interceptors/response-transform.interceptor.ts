import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { ApiSuccessResponse } from '@wlct/shared-types';

import { SKIP_RESPONSE_TRANSFORM_KEY } from '../constants/metadata.constants';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Wraps every successful handler result in the platform success envelope so
 * clients can rely on one shape. Streaming/file routes opt out with
 * `@SetMetadata(SKIP_RESPONSE_TRANSFORM_KEY, true)`.
 */
@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T> | T>
{
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<T> | T> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AppRequest>();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        meta: {
          requestId: request.requestId ?? 'unknown',
          timestamp: new Date().toISOString(),
          version: this.config.defaultApiVersion,
        },
      })),
    );
  }
}
