import {
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { ErrorCode, type ApiErrorResponse, type ValidationErrorDetail } from '@wlct/shared-types';
import { redact } from '@wlct/utils';

import { AppException } from '../errors/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

/**
 * Single exit point for every unhandled error.
 *
 * Guarantees:
 *   - the response body always matches {@link ApiErrorResponse};
 *   - stack traces and internal context never reach the client;
 *   - 5xx responses are logged at error level with full (redacted) context, so
 *     an operator can correlate a user-reported requestId with the root cause.
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: AppConfigService,
    @InjectPinoLogger(GlobalExceptionFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<AppRequest>();
    const response = ctx.getResponse();

    const resolved = this.resolveException(exception);

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: resolved.code,
        message: resolved.message,
        statusCode: resolved.statusCode,
        ...(resolved.details ? { details: resolved.details } : {}),
      },
      meta: {
        requestId: request?.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
        version: this.config.defaultApiVersion,
      },
    };

    const logContext = {
      event: 'request.failed',
      requestId: request?.requestId,
      tenantId: request?.tenantContext?.tenantId,
      userId: request?.actor?.userId,
      method: request?.method,
      path: request?.originalUrl?.split('?')[0],
      statusCode: resolved.statusCode,
      errorCode: resolved.code,
      context: resolved.context ? redact(resolved.context) : undefined,
    };

    if (resolved.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { ...logContext, stack: resolved.stack },
        `Unhandled error: ${resolved.internalMessage}`,
      );
    } else if (resolved.statusCode === HttpStatus.TOO_MANY_REQUESTS) {
      this.logger.warn(logContext, 'Rate limit triggered');
    } else {
      this.logger.info(logContext, `Request rejected: ${resolved.code}`);
    }

    httpAdapter.reply(response, body, resolved.statusCode);
  }

  private resolveException(exception: unknown): {
    statusCode: number;
    code: ErrorCode | string;
    message: string;
    details?: ValidationErrorDetail[];
    context?: Record<string, unknown>;
    stack?: string;
    internalMessage: string;
  } {
    if (exception instanceof AppException) {
      const payload = exception.getResponse() as { message: string };
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: payload.message,
        details: exception.details,
        context: {
          ...(exception.context ?? {}),
          ...(exception.internalCause instanceof Error
            ? { cause: exception.internalCause.message }
            : {}),
        },
        stack: exception.stack,
        internalMessage: payload.message,
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests. Please slow down and try again shortly.',
        internalMessage: 'Throttler limit exceeded',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : ((raw as { message?: string | string[] }).message ?? exception.message);

      return {
        statusCode: status,
        code: this.mapStatusToCode(status),
        message: Array.isArray(message) ? message.join('; ') : message,
        stack: exception.stack,
        internalMessage: exception.message,
      };
    }

    // Anything else is a genuine bug: never leak its message to the client.
    const error = exception instanceof Error ? exception : new Error(String(exception));
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
      stack: error.stack,
      internalMessage: error.message,
    };
  }

  private mapStatusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.PAYLOAD_TOO_LARGE;
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return status >= 500 ? ErrorCode.INTERNAL_SERVER_ERROR : ErrorCode.BAD_REQUEST;
    }
  }
}
