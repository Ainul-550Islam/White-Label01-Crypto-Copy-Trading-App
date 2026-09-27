/**
 * Primitive and envelope contracts shared by every application in the monorepo.
 * The API, the Next.js admin and (through code generation) the Flutter client
 * all derive their response handling from these shapes.
 */

/** RFC 4122 UUID v4 string. */
export type UUID = string;

/** ISO-8601 timestamp string, always serialised in UTC. */
export type ISODateString = string;

/** Decimal values crossing the wire are strings to avoid float precision loss. */
export type DecimalString = string;

export type Nullable<T> = T | null;

export interface RequestContextMeta {
  requestId: string;
  timestamp: ISODateString;
  version: string;
}

/** Successful envelope returned by every REST endpoint. */
export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta: RequestContextMeta;
}

/** Failure envelope returned by the global exception filter. */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: ValidationErrorDetail[];
  };
  meta: RequestContextMeta;
}

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

export interface ValidationErrorDetail {
  field: string;
  constraint: string;
  message: string;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

export type SortOrder = 'asc' | 'desc';

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResult<TItem> {
  items: TItem[];
  pagination: PaginationMeta;
}

export interface HealthIndicatorResult {
  status: 'up' | 'down';
  message?: string;
  responseTimeMs?: number;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error' | 'shutting_down';
  uptimeSeconds: number;
  version: string;
  environment: string;
  checks: Record<string, HealthIndicatorResult>;
}

export type SupportedLocale = 'en' | 'es' | 'ar' | 'bn' | 'tr';

export type SupportedCurrency = 'USD' | 'EUR' | 'GBP' | 'AED' | 'BDT' | 'TRY';

export interface MoneyAmount {
  amount: DecimalString;
  currency: SupportedCurrency;
}
