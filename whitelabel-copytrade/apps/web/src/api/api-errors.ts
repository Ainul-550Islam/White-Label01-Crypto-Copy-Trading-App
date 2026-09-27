/**
 * Structured API error normalization for validation, authorization,
 * tenant isolation, entitlement, rate-limit, maintenance, and server errors.
 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'MAINTENANCE'
  | 'ENTITLEMENT_REQUIRED'
  | 'TENANT_ISOLATION'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export class ApiError extends Error {
  status: number;
  code: ApiErrorCode;
  correlationId?: string;
  details?: unknown;
  fieldErrors?: Record<string, string[]>;

  constructor(status: number, message: string, code: ApiErrorCode = 'UNKNOWN', correlationId?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }

  static fromBody(status: number, body: unknown, correlationId?: string): ApiError {
    const payload = body as {
      message?: string;
      error?: string;
      code?: string;
      details?: unknown;
      errors?: Array<{ field?: string; message: string }>;
    } | undefined;

    let message = 'An unexpected error occurred';
    let code: ApiErrorCode = 'UNKNOWN';
    let fieldErrors: Record<string, string[]> | undefined;

    if (typeof payload === 'object' && payload !== null) {
      message = payload.message ?? payload.error ?? message;

      // Map backend error codes to frontend codes
      const backendCode = (payload.code ?? '').toUpperCase();
      if (status === 401) code = 'UNAUTHORIZED';
      else if (status === 403) {
        if (backendCode.includes('TENANT')) code = 'TENANT_ISOLATION';
        else if (backendCode.includes('ENTITLEMENT')) code = 'ENTITLEMENT_REQUIRED';
        else code = 'FORBIDDEN';
      } else if (status === 404) code = 'NOT_FOUND';
      else if (status === 409) code = 'CONFLICT';
      else if (status === 422) code = 'VALIDATION_ERROR';
      else if (status === 429) code = 'RATE_LIMITED';
      else if (status === 503) code = 'MAINTENANCE';
      else if (status >= 500) code = 'SERVER_ERROR';
      else if (backendCode.includes('VALIDATION')) code = 'VALIDATION_ERROR';

      if (payload.errors && Array.isArray(payload.errors)) {
        fieldErrors = {};
        for (const err of payload.errors) {
          const field = err.field ?? '_global';
          if (!fieldErrors[field]) fieldErrors[field] = [];
          fieldErrors[field].push(err.message);
        }
      }
    }

    // Scrub sensitive data from error messages
    const scrubbedMessage = ApiError.scrubMessage(message);

    const apiError = new ApiError(status, scrubbedMessage, code, correlationId, payload?.details);
    apiError.fieldErrors = fieldErrors;
    return apiError;
  }

  private static scrubMessage(message: string): string {
    // Never expose internal secrets in UI
    const patterns = [
      /database connection string/gi,
      /jwt/gi,
      /api[_-]?key/gi,
      /private[_-]?key/gi,
      /secret/gi,
      /credential/gi,
      /BEGIN RSA PRIVATE KEY/gi,
      /BEGIN PRIVATE KEY/gi,
    ];
    let scrubbed = message;
    for (const pattern of patterns) {
      if (pattern.test(scrubbed) && scrubbed.length > 100) {
        return 'An internal error occurred. Please try again or contact support.';
      }
    }
    // Truncate overly long messages that might contain stack traces
    if (scrubbed.length > 500) {
      scrubbed = scrubbed.slice(0, 500) + '...';
    }
    return scrubbed;
  }

  isUnauthorized(): boolean {
    return this.status === 401 || this.code === 'UNAUTHORIZED';
  }

  isForbidden(): boolean {
    return this.status === 403 || this.code === 'FORBIDDEN' || this.code === 'TENANT_ISOLATION';
  }

  isNotFound(): boolean {
    return this.status === 404;
  }

  isValidation(): boolean {
    return this.status === 422 || this.code === 'VALIDATION_ERROR';
  }

  isRateLimited(): boolean {
    return this.status === 429 || this.code === 'RATE_LIMITED';
  }

  isMaintenance(): boolean {
    return this.status === 503 || this.code === 'MAINTENANCE';
  }

  getUserMessage(): string {
    switch (this.code) {
      case 'UNAUTHORIZED':
        return 'Your session has expired. Please sign in again.';
      case 'FORBIDDEN':
        return 'You do not have permission to perform this action.';
      case 'TENANT_ISOLATION':
        return 'Access denied. This resource belongs to another tenant.';
      case 'ENTITLEMENT_REQUIRED':
        return 'This feature requires an upgraded plan.';
      case 'NOT_FOUND':
        return 'The requested resource was not found.';
      case 'CONFLICT':
        return 'A conflict occurred. The resource may have been modified.';
      case 'VALIDATION_ERROR':
        return 'Please check your input and try again.';
      case 'RATE_LIMITED':
        return 'Too many requests. Please wait and try again.';
      case 'MAINTENANCE':
        return 'The service is temporarily under maintenance. Please try again later.';
      case 'TIMEOUT':
        return 'The request timed out. Please try again.';
      case 'NETWORK_ERROR':
        return 'Network error. Please check your connection.';
      case 'SERVER_ERROR':
        return 'An unexpected server error occurred. Please try again.';
      default:
        return this.message;
    }
  }
}
