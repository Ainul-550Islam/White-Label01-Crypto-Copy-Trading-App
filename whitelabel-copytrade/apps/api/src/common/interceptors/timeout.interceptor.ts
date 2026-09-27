import {
  Injectable,
  RequestTimeoutException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { throwError, timeout, catchError, type Observable, TimeoutError } from 'rxjs';

import { DEFAULT_REQUEST_TIMEOUT_MS } from '../constants/request.constants';
import { REQUEST_TIMEOUT_KEY } from '../constants/metadata.constants';

/**
 * Bounds handler execution time. Without this, a slow exchange or database call
 * can pin a worker thread and cascade into a platform-wide outage.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const configured = this.reflector.getAllAndOverride<number>(REQUEST_TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const timeoutMs = configured ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException('The request took too long to complete.'),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
