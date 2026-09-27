/**
 * Validated tenant/partner/platform queries for applications, credentials,
 * webhooks, usage, analytics, API versions and audit records. Pagination is
 * always bounded; filters are whitelisted; trusted outcomes are never
 * queryable into existence.
 */

import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class DeveloperPaginationQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor?: string;
}

export class ListApplicationsQuery extends DeveloperPaginationQuery {
  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'SUSPENDED', 'REACTIVATION_REVIEW', 'REVOKED'])
  state?: string;

  @IsOptional()
  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment?: string;
}

/** Platform-staff listing across tenants; requires platform RBAC upstream. */
export class PlatformListApplicationsQuery extends ListApplicationsQuery {
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class ListCredentialsQuery extends DeveloperPaginationQuery {
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'REVOKED', 'EXPIRED'])
  status?: string;
}

export class ListWebhookSubscriptionsQuery extends DeveloperPaginationQuery {
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED', 'REVOKED'])
  status?: string;
}

export class ListDeliveriesQuery extends DeveloperPaginationQuery {
  @IsUUID()
  subscriptionId!: string;

  @IsOptional()
  @IsIn(['QUEUED', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'EXHAUSTED', 'CANCELLED'])
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventId?: string;
}

export class DeveloperUsageQuery {
  @IsUUID()
  applicationId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(['minute', 'hour', 'day'])
  granularity?: 'minute' | 'hour' | 'day';
}

export class DeveloperAnalyticsQuery extends DeveloperUsageQuery {
  @IsOptional()
  @IsIn(['v1', 'v2'])
  apiVersion?: string;
}

export class ListAuditQuery extends DeveloperPaginationQuery {
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;
}

export class ListGrantsQuery extends DeveloperPaginationQuery {
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @IsOptional()
  @IsIn(['PENDING_CONSENT', 'GRANTED', 'DENIED', 'REVOKED'])
  state?: string;
}
