import { PAGINATION_DEFAULTS } from '@wlct/config';
import type { PaginatedResult, PaginationMeta, SortOrder } from '@wlct/shared-types';

export interface NormalisedPagination {
  page: number;
  limit: number;
  skip: number;
  take: number;
  sortBy?: string;
  sortOrder: SortOrder;
  search?: string;
}

export interface PaginationInput {
  page?: number | string;
  limit?: number | string;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
}

function toPositiveInt(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * Clamps client supplied paging parameters. `allowedSortFields` protects the
 * ORDER BY clause from arbitrary column injection.
 */
export function normalisePagination(
  input: PaginationInput = {},
  allowedSortFields: readonly string[] = [],
): NormalisedPagination {
  const page = toPositiveInt(input.page, PAGINATION_DEFAULTS.PAGE);
  const requestedLimit = toPositiveInt(input.limit, PAGINATION_DEFAULTS.LIMIT);
  const limit = Math.min(requestedLimit, PAGINATION_DEFAULTS.MAX_LIMIT);
  const sortOrder: SortOrder = input.sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const sortBy =
    input.sortBy && allowedSortFields.includes(input.sortBy) ? input.sortBy : undefined;
  const search = input.search?.trim() ? input.search.trim().slice(0, 128) : undefined;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
    sortBy,
    sortOrder,
    search,
  };
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  totalItems: number,
): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(totalItems / limit) : 0;
  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalItems > 0,
  };
}

export function paginated<TItem>(
  items: TItem[],
  page: number,
  limit: number,
  totalItems: number,
): PaginatedResult<TItem> {
  return { items, pagination: buildPaginationMeta(page, limit, totalItems) };
}
