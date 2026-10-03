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
  | 'AUTHENTICATION_FAILED'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

/**
 * Backend codes whose message is only a restatement of the HTTP status. For
 * every other backend code the message is specific (for example
 * KYC_REQUIRED or EXCHANGE_CREDENTIALS_INVALID) and is shown as-is: the API's
 * exception filters only ever emit safe, user-facing messages.
 */
const GENERIC_BACKEND_CODES = new Set([
  '',
  'UNKNOWN',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INSUFFICIENT_PERMISSIONS',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'INTERNAL_SERVER_ERROR',
  'SERVER_ERROR',
  'SERVICE_UNAVAILABLE',
  'RATE_LIMITED',
  'TOO_MANY_REQUESTS',
]);

const AUTHENTICATION_FAILURE_CODES = new Set(['INVALID_CREDENTIALS', 'TWO_FACTOR_INVALID', 'TWO_FACTOR_REQUIRED']);

/**
 * True when a 401 body says the submitted password or code was wrong, as
 * opposed to the session having expired. Such a request must not be retried
 * after a token refresh: that would count as a second failed attempt.
 */
export function isAuthenticationFailureBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const top = body as { code?: unknown; error?: unknown };
  const inner = top.error && typeof top.error === 'object' ? (top.error as { code?: unknown }) : undefined;
  const code = inner?.code ?? top.code;
  return typeof code === 'string' && AUTHENTICATION_FAILURE_CODES.has(code.toUpperCase());
}

export class ApiError extends Error {
  status: number;
  code: ApiErrorCode;
  /** The backend's own error code (ErrorCode in @wlct/shared-types), when it sent one. */
  backendCode?: string;
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
    interface ErrorFields {
      message?: unknown;
      error?: unknown;
      code?: unknown;
      details?: unknown;
      errors?: Array<{ field?: string; message: string }>;
    }
    // The API wraps failures as { success: false, error: { code, message, details } };
    // older handlers and the BFF may return the fields at the top level.
    const raw = body as ErrorFields | undefined;
    const inner =
      raw && typeof raw === 'object' && raw.error && typeof raw.error === 'object'
        ? (raw.error as ErrorFields)
        : undefined;
    const payload: ErrorFields | undefined = inner ?? (typeof raw === 'object' && raw !== null ? raw : undefined);
    const innerDetails = inner?.details as { errors?: Array<{ field?: string; message: string }> } | undefined;
    const listedErrors = payload?.errors ?? innerDetails?.errors;

    let message = 'An unexpected error occurred';
    let code: ApiErrorCode = 'UNKNOWN';
    let fieldErrors: Record<string, string[]> | undefined;
    let backendCode = '';

    if (typeof payload === 'object' && payload !== null) {
      if (typeof payload.message === 'string' && payload.message.length > 0) {
        message = payload.message;
      } else if (typeof payload.error === 'string' && payload.error.length > 0) {
        message = payload.error;
      }

      // Map backend error codes to frontend codes
      backendCode = typeof payload.code === 'string' ? payload.code.toUpperCase() : '';
      if (status === 401) {
        code = AUTHENTICATION_FAILURE_CODES.has(backendCode) ? 'AUTHENTICATION_FAILED' : 'UNAUTHORIZED';
      } else if (status === 402) code = 'ENTITLEMENT_REQUIRED';
      else if (status === 403) {
        if (backendCode.includes('TENANT')) code = 'TENANT_ISOLATION';
        else if (backendCode.includes('ENTITLEMENT') || backendCode === 'FEATURE_DISABLED') code = 'ENTITLEMENT_REQUIRED';
        else code = 'FORBIDDEN';
      } else if (status === 404) code = 'NOT_FOUND';
      else if (status === 409) code = 'CONFLICT';
      else if (status === 422) code = 'VALIDATION_ERROR';
      else if (status === 429) code = 'RATE_LIMITED';
      else if (status === 503) {
        code = backendCode.includes('MAINTENANCE') || backendCode === 'EXECUTION_DISABLED' ? 'MAINTENANCE' : 'SERVICE_UNAVAILABLE';
      } else if (status >= 500) code = 'SERVER_ERROR';
      else if (backendCode.includes('VALIDATION')) code = 'VALIDATION_ERROR';

      if (listedErrors && Array.isArray(listedErrors)) {
        fieldErrors = {};
        for (const err of listedErrors) {
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
    apiError.backendCode = backendCode || undefined;
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
    return this.code === 'MAINTENANCE';
  }

  /** True when the backend sent a domain-specific code whose message explains the failure. */
  hasSpecificMessage(): boolean {
    return Boolean(this.backendCode) && !GENERIC_BACKEND_CODES.has(this.backendCode ?? '') && this.message.length > 0;
  }

  getUserMessage(): string {
    if (this.hasSpecificMessage() && this.code !== 'SERVER_ERROR' && this.code !== 'UNAUTHORIZED') {
      return this.message;
    }
    switch (this.code) {
      case 'UNAUTHORIZED':
        return 'Your session has expired. Please sign in again.';
      case 'FORBIDDEN':
        return 'You do not have permission to perform this action.';
      case 'TENANT_ISOLATION':
        return 'Access denied. This resource belongs to another tenant.';
      case 'ENTITLEMENT_REQUIRED':
        return 'This feature requires an upgraded plan.';
      case 'AUTHENTICATION_FAILED':
        return 'The details you entered are not correct. Please try again.';
      case 'SERVICE_UNAVAILABLE':
        return 'A required service is temporarily unavailable. Please try again shortly.';
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
