/**
 * The error envelope produced by the API. Mirrors
 * `common/filters/global-exception.filter.ts` so both sides agree on shape.
 */
export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
    requestId?: string;
    timestamp?: string;
    path?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Array<{ field: string; message: string }>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromBody(status: number, body: unknown): ApiError {
    const envelope = body as Partial<ApiErrorBody>;

    if (envelope?.error?.code) {
      return new ApiError(
        status,
        envelope.error.code,
        envelope.error.message ?? 'The request could not be completed.',
        envelope.error.details,
        envelope.error.requestId,
      );
    }

    return new ApiError(status, 'UNKNOWN_ERROR', 'The request could not be completed.');
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
