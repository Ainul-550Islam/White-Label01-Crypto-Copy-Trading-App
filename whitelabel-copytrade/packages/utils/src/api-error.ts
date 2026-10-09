// # single ApiError helper consumed by web and admin-web
export interface ApiErrorFieldDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  success?: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
    timestamp?: string;
    path?: string;
  } | string;
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
  timestamp?: string;
  path?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFieldDetails(value: unknown): ApiErrorFieldDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const details: ApiErrorFieldDetail[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.field !== 'string' || typeof item.message !== 'string') continue;
    details.push({ field: item.field, message: item.message });
  }
  return details.length > 0 ? details : undefined;
}

/**
 * The shared, transport-neutral representation of an API failure.
 *
 * `fromBody` accepts the Nest response envelope and older top-level BFF errors. It never throws
 * while inspecting an untrusted response body; malformed error payloads become a generic error
 * rather than leaking their shape or causing the error handler itself to fail.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorFieldDetail[],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static fromBody(status: number, body: unknown): ApiError {
    const root = isRecord(body) ? body : undefined;
    const nested = root && isRecord(root.error) ? root.error : undefined;
    const stringError = root && typeof root.error === 'string' ? root.error : undefined;

    const codeValue = nested?.code ?? root?.code;
    const messageValue = nested?.message ?? root?.message ?? stringError;
    const detailsValue = nested?.details ?? root?.details;
    const requestIdValue = nested?.requestId ?? root?.requestId;

    const code = typeof codeValue === 'string' && codeValue.trim() !== ''
      ? codeValue.trim()
      : 'UNKNOWN_ERROR';
    const message = typeof messageValue === 'string' && messageValue.trim() !== ''
      ? messageValue.trim()
      : 'The request could not be completed.';
    const details = readFieldDetails(detailsValue);
    const requestId = typeof requestIdValue === 'string' && requestIdValue.trim() !== ''
      ? requestIdValue.trim()
      : undefined;

    return new ApiError(status, code, message, details, requestId);
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.code === 'TOKEN_EXPIRED' || this.code === 'TOKEN_INVALID';
  }

  /** Field errors keyed by field name, ready to bind to form inputs. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      map[detail.field] = detail.message;
    }
    return map;
  }
}
