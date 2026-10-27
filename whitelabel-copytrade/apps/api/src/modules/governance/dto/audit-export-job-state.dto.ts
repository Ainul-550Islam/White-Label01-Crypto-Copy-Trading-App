// # Responsibility: declares the wire shape of an audit-export job poll, field for field identical to the admin-web AuditExportJobState contract.
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * The frozen client contract for `GET /v1/governance/audit/export/:jobId`.
 *
 * The admin console polls this shape while a large export runs on the audit
 * queue: it reads `state` until `completed`, then verifies `result` against
 * its own SHA-256 and hash-chain recomputation before offering the download.
 * The field names, the manifest field set and the state vocabulary are
 * therefore not ours to rename: they are spelled exactly as
 * `apps/admin-web/src/api/business-admin-api.ts` declares them, and the zod
 * schema below is the server-side statement of the same contract.
 */

export const AUDIT_EXPORT_ENTITY_TYPES = [
  'REQUEST',
  'REPORT',
  'EVIDENCE_PACKAGE',
  'LEGAL_HOLD',
  'RETENTION_CANDIDATE',
  'CONSENT',
] as const;
export type AuditExportEntityType = (typeof AUDIT_EXPORT_ENTITY_TYPES)[number];

export const AUDIT_EXPORT_JOB_STATES = [
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
  'unknown',
] as const;
export type AuditExportJobStateName = (typeof AUDIT_EXPORT_JOB_STATES)[number];

export class AuditExportFiltersDto {
  @ApiProperty({ required: false, type: String })
  actorId?: string;

  @ApiProperty({ required: false, type: String })
  actionType?: string;

  @ApiProperty({ required: false, type: String })
  subjectUserId?: string;

  @ApiProperty({ required: false, enum: AUDIT_EXPORT_ENTITY_TYPES })
  entityType?: AuditExportEntityType;

  @ApiProperty({ required: false, type: String })
  entityId?: string;

  @ApiProperty({ required: false, type: String })
  outcome?: string;
}

export class AuditExportManifestDto {
  @ApiProperty({ type: String })
  format!: string;

  @ApiProperty({ type: String })
  sha256!: string;

  @ApiProperty({ type: Number })
  rowCount!: number;

  @ApiProperty({ type: String })
  chainTip!: string;

  @ApiProperty({ type: String })
  tenantId!: string;

  @ApiProperty({ type: String })
  periodStart!: string;

  @ApiProperty({ type: String })
  periodEndExclusive!: string;

  @ApiProperty({ type: AuditExportFiltersDto })
  filters!: AuditExportFiltersDto;
}

export class AuditExportResultDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  tenantId!: string;

  @ApiProperty({ type: String })
  fileHash!: string;

  @ApiProperty({ type: String })
  fileContents!: string;

  @ApiProperty({ type: Number })
  recordCount!: number;

  @ApiProperty({ type: AuditExportFiltersDto })
  filtersApplied!: AuditExportFiltersDto;

  @ApiProperty({ type: AuditExportManifestDto })
  manifest!: AuditExportManifestDto;
}

export class AuditExportJobStateDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  tenantId!: string;

  @ApiProperty({ enum: AUDIT_EXPORT_JOB_STATES })
  state!: AuditExportJobStateName;

  @ApiProperty({ required: false, type: AuditExportResultDto })
  result?: AuditExportResultDto;

  @ApiProperty({ required: false, type: String })
  failureReason?: string;
}

export const auditExportFiltersSchema = z.object({
  actorId: z.string().min(1).max(128).optional(),
  actionType: z.string().min(1).max(64).optional(),
  subjectUserId: z.string().min(1).max(128).optional(),
  entityType: z.enum(AUDIT_EXPORT_ENTITY_TYPES).optional(),
  entityId: z.string().min(1).max(128).optional(),
  outcome: z.string().min(1).max(64).optional(),
});

export const auditExportManifestSchema = z.object({
  format: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  rowCount: z.number().int().nonnegative(),
  chainTip: z.string().regex(/^[0-9a-f]{64}$/),
  tenantId: z.string().min(1),
  periodStart: z.string().min(1),
  periodEndExclusive: z.string().min(1),
  filters: auditExportFiltersSchema,
});

export const auditExportResultSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  fileContents: z.string(),
  recordCount: z.number().int().nonnegative(),
  filtersApplied: auditExportFiltersSchema,
  manifest: auditExportManifestSchema,
});

export const auditExportJobStateSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  state: z.enum(AUDIT_EXPORT_JOB_STATES),
  result: auditExportResultSchema.optional(),
  failureReason: z.string().min(1).optional(),
});
