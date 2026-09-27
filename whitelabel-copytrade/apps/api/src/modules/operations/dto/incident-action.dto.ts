import { IsString, IsOptional, IsEnum, IsUUID, IsDateString, IsObject, IsInt, Min } from 'class-validator';
import { OperationalIncidentSeverity, OperationalIncidentState, OperationalActionType } from '../operations.types';

/**
 * Validated DTOs for incident acknowledgement, escalation, resolution, suppression,
 * reopening, ownership changes, and controlled incident actions.
 * Clients must not be allowed to provide trusted system state.
 */

export class CreateIncidentDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsString()
  type!: string;

  @IsEnum(OperationalIncidentSeverity)
  severity!: OperationalIncidentSeverity;

  @IsString()
  title!: string;

  @IsString()
  summary!: string;

  @IsString()
  source!: string;

  @IsString()
  affectedComponent!: string;

  @IsOptional()
  @IsString()
  affectedCapability?: string;

  @IsOptional()
  @IsString()
  scopeTarget?: string;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class AcknowledgeIncidentDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class ResolveIncidentDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class SuppressIncidentDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsDateString()
  suppressUntil?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class ReopenIncidentDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class EscalateIncidentDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class AssignIncidentDto {
  @IsUUID()
  operatorId!: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class OperatorActionDto {
  @IsEnum(OperationalActionType)
  actionType!: OperationalActionType;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  preconditions?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  requestId?: string;

  // Client must NOT be allowed to provide trusted system state
  // No fields for: status, result, auditReference, idempotencyKey, fingerprint, evidence with secrets
}

export class RecoveryActionDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  incidentId?: string;

  @IsOptional()
  @IsString()
  maintenanceWindowId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class ExecuteRecoveryDto {
  @IsOptional()
  @IsString()
  correlationId?: string;
}
