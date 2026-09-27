import { HttpException } from '@nestjs/common';
import { ERROR_CODE_HTTP_STATUS, ErrorCode, type ValidationErrorDetail } from '@wlct/shared-types';

export interface AppExceptionOptions {
  /** Machine readable code the clients switch on. */
  code: ErrorCode;
  /** Human readable, safe-to-display message. */
  message?: string;
  /** Overrides the default status mapped from the code. */
  statusCode?: number;
  /** Field level validation problems. */
  details?: ValidationErrorDetail[];
  /** Internal-only diagnostic context; logged, never serialised to clients. */
  cause?: unknown;
  /** Extra structured context for logs and audit records. */
  context?: Record<string, unknown>;
}

/**
 * Base exception for every deliberate failure raised by application code.
 *
 * Two rules make this safe by construction:
 *   1. `message` is always something we are happy to show a end user.
 *   2. `cause`/`context` never leave the process; the exception filter strips
 *      them from the HTTP response and forwards them to the logger only.
 */
export class AppException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: ValidationErrorDetail[];
  public readonly context?: Record<string, unknown>;
  public readonly internalCause?: unknown;

  constructor(options: AppExceptionOptions) {
    const status = options.statusCode ?? ERROR_CODE_HTTP_STATUS[options.code] ?? 500;
    const message = options.message ?? defaultMessageFor(options.code);
    super({ code: options.code, message, statusCode: status }, status);
    this.name = 'AppException';
    this.code = options.code;
    this.details = options.details;
    this.context = options.context;
    this.internalCause = options.cause;
  }
}

function defaultMessageFor(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.UNAUTHORIZED:
      return 'Authentication is required to access this resource.';
    case ErrorCode.INVALID_CREDENTIALS:
      return 'The email address or password is incorrect.';
    case ErrorCode.FORBIDDEN:
    case ErrorCode.INSUFFICIENT_PERMISSIONS:
      return 'You do not have permission to perform this action.';
    case ErrorCode.NOT_FOUND:
      return 'The requested resource was not found.';
    case ErrorCode.CONFLICT:
      return 'The request conflicts with the current state of the resource.';
    case ErrorCode.VALIDATION_ERROR:
      return 'The submitted data failed validation.';
    case ErrorCode.RATE_LIMIT_EXCEEDED:
      return 'Too many requests. Please slow down and try again shortly.';
    case ErrorCode.INTERNAL_SERVER_ERROR:
      return 'An unexpected error occurred. Please try again later.';
    default:
      return 'The request could not be completed.';
  }
}

// -----------------------------------------------------------------------------
// Convenience subclasses for the most frequent failures
// -----------------------------------------------------------------------------

export class ValidationException extends AppException {
  constructor(details: ValidationErrorDetail[], message = 'The submitted data failed validation.') {
    super({ code: ErrorCode.VALIDATION_ERROR, message, details });
    this.name = 'ValidationException';
  }
}

export class NotFoundException extends AppException {
  constructor(resource: string, identifier?: string) {
    super({
      code: ErrorCode.NOT_FOUND,
      message: `${resource} was not found.`,
      context: identifier ? { resource, identifier } : { resource },
    });
    this.name = 'NotFoundException';
  }
}

export class ConflictException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: ErrorCode.CONFLICT, message, context });
    this.name = 'ConflictException';
  }
}

export class UnauthorizedException extends AppException {
  constructor(code: ErrorCode = ErrorCode.UNAUTHORIZED, message?: string) {
    super({ code, message });
    this.name = 'UnauthorizedException';
  }
}

export class ForbiddenException extends AppException {
  constructor(code: ErrorCode = ErrorCode.FORBIDDEN, message?: string, context?: Record<string, unknown>) {
    super({ code, message, context });
    this.name = 'ForbiddenException';
  }
}

export class TenantIsolationException extends AppException {
  constructor(context: Record<string, unknown>) {
    super({
      code: ErrorCode.TENANT_MISMATCH,
      message: 'The requested resource does not belong to your organisation.',
      context,
    });
    this.name = 'TenantIsolationException';
  }
}

export class FeatureDisabledException extends AppException {
  constructor(featureKey: string) {
    super({
      code: ErrorCode.FEATURE_DISABLED,
      message: 'This feature is not enabled for your organisation.',
      context: { featureKey },
    });
    this.name = 'FeatureDisabledException';
  }
}

export class ServiceUnavailableException extends AppException {
  constructor(service: string, cause?: unknown) {
    super({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'A dependent service is temporarily unavailable. Please retry shortly.',
      context: { service },
      cause,
    });
    this.name = 'ServiceUnavailableException';
  }
}
