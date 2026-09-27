import { IsString, IsOptional, IsEnum, IsUUID, IsObject } from 'class-validator';
import { OperationalReconciliationType, OperationalDependencyType } from '../operations.types';

/**
 * Validated DTOs for readiness checks, dependency rechecks, reconciliation triggers,
 * recovery requests, and operator diagnostics. Must allow requests only, never direct
 * authoritative state mutation.
 */

export class TriggerReadinessCheckDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  // Forbidden: isReady, state, blockingReasons, evidence — server computed
}

export class TriggerDependencyCheckDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsEnum(OperationalDependencyType)
  dependencyType?: OperationalDependencyType;

  @IsOptional()
  @IsString()
  correlationId?: string;

  // Forbidden: state, latency, error — server computed
}

export class TriggerReconciliationDto {
  @IsEnum(OperationalReconciliationType)
  type!: OperationalReconciliationType;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  // Forbidden: status, subsystemResults, failureDetails — server computed via delegation
}

export class TriggerQueueCheckDto {
  @IsOptional()
  @IsString()
  queueName?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class TriggerJobCheckDto {
  @IsOptional()
  @IsString()
  jobName?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class RequestRecoveryDto {
  @IsString()
  planId!: string;

  @IsOptional()
  @IsString()
  incidentId?: string;

  @IsOptional()
  @IsString()
  maintenanceWindowId?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  // Forbidden: state, steps result, failureReason — server managed
}

export class ApproveRecoveryDto {
  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class OperatorDiagnosticDto {
  @IsOptional()
  @IsString()
  component?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  // Diagnostic request only — no direct state mutation allowed
}
