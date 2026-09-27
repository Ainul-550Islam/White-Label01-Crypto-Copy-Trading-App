import type { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';

export interface AuditRecordInput {
  tenantId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  actorEmail?: string | null;
  action: AuditAction | string;
  outcome: AuditOutcome;
  resourceType?: string | null;
  resourceId?: string | null;
  description?: string | null;
  changes?: Record<string, { before: unknown; after: unknown }> | null;
  metadata?: Record<string, unknown> | null;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  operationId?: string | null;
}

export interface ListAuditLogsFilter {
  tenantId?: string;
  actorId?: string;
  action?: string;
  outcome?: AuditOutcome;
  resourceType?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
}

export interface AuditLogEntity {
  id: string;
  tenantId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  outcome: AuditOutcome;
  resourceType: string | null;
  resourceId: string | null;
  description: string | null;
  changes: unknown;
  metadata: unknown;
  ipHash: string | null;
  userAgent: string | null;
  requestId: string | null;
  correlationId: string | null;
  operationId: string | null;
  createdAt: Date;
}
