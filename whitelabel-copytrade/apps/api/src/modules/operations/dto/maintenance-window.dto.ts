import { IsString, IsOptional, IsEnum, IsUUID, IsDateString, IsBoolean, IsObject } from 'class-validator';
import { OperationalMaintenanceScope, OperationalMaintenanceState, OperationalDegradationLevel } from '../operations.types';

/**
 * Validated DTOs for creating/updating/cancelling maintenance windows and entering/exiting maintenance mode.
 * Must prevent clients from supplying unauthorized platform-level state.
 */

export class CreateMaintenanceWindowDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsEnum(OperationalMaintenanceScope)
  scope!: OperationalMaintenanceScope;

  @IsOptional()
  @IsString()
  scopeTarget?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  @IsOptional()
  @IsBoolean()
  isEmergency?: boolean;

  @IsOptional()
  @IsString()
  correlationId?: string;

  // Forbidden: state, actualStart, actualEnd, requestedBy, approvedBy, idempotencyKey, auditReference, conflictChecked
}

export class UpdateMaintenanceWindowDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledStart?: string;

  @IsOptional()
  @IsDateString()
  scheduledEnd?: string;

  @IsOptional()
  @IsString()
  scopeTarget?: string;
}

export class CancelMaintenanceWindowDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class EnterMaintenanceDto {
  @IsEnum(OperationalMaintenanceScope)
  scope!: OperationalMaintenanceScope;

  @IsOptional()
  @IsString()
  scopeTarget?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledStart?: string;

  @IsOptional()
  @IsDateString()
  scheduledEnd?: string;

  @IsOptional()
  @IsBoolean()
  isEmergency?: boolean;

  @IsOptional()
  @IsString()
  correlationId?: string;

  // Forbidden: actualStart, actualEnd, state manipulation
}

export class ExitMaintenanceDto {
  @IsOptional()
  @IsString()
  windowId?: string;

  @IsOptional()
  @IsEnum(OperationalMaintenanceScope)
  scope?: OperationalMaintenanceScope;

  @IsOptional()
  @IsString()
  scopeTarget?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class SetDegradationDto {
  @IsString()
  serviceName!: string;

  @IsOptional()
  @IsString()
  capability?: string;

  @IsEnum(OperationalDegradationLevel)
  level!: OperationalDegradationLevel;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  // Forbidden: allowedOperations, blockedOperations, previousLevel — server derived from policy
}

export class ClearDegradationDto {
  @IsOptional()
  @IsString()
  capability?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
