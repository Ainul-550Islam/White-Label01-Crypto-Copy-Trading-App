import { IsOptional, IsString, IsEnum, IsInt, Min, Max, IsDateString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import {
  OperationalIncidentState,
  OperationalIncidentSeverity,
  OperationalMaintenanceState,
  OperationalMaintenanceScope,
  OperationalReconciliationType,
  OperationalReconciliationRunState,
  OperationalRecoveryState,
  OperationalActionType,
  OperationalDependencyType,
  OperationalDependencyState,
  OperationalDegradationLevel,
  OperationalAuditEventType,
} from '../operations.types';

/**
 * Validated query/filter DTOs for incidents, dependencies, reconciliations, jobs, queues,
 * maintenance windows, operational metrics, and audit records with tenant-safe pagination and filtering.
 */

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class IncidentQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OperationalIncidentState)
  state?: OperationalIncidentState;

  @IsOptional()
  @IsEnum(OperationalIncidentSeverity)
  severity?: OperationalIncidentSeverity;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  affectedComponent?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  fingerprint?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class DependencyQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OperationalDependencyType)
  dependencyType?: OperationalDependencyType;

  @IsOptional()
  @IsEnum(OperationalDependencyState)
  state?: OperationalDependencyState;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ReconciliationQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OperationalReconciliationType)
  type?: OperationalReconciliationType;

  @IsOptional()
  @IsEnum(OperationalReconciliationRunState)
  status?: OperationalReconciliationRunState;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class MaintenanceQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OperationalMaintenanceScope)
  scope?: OperationalMaintenanceScope;

  @IsOptional()
  @IsEnum(OperationalMaintenanceState)
  state?: OperationalMaintenanceState;

  @IsOptional()
  @IsString()
  scopeTarget?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class RecoveryQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsEnum(OperationalRecoveryState)
  state?: OperationalRecoveryState;

  @IsOptional()
  @IsString()
  incidentId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ActionQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OperationalActionType)
  actionType?: OperationalActionType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class DegradationQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  serviceName?: string;

  @IsOptional()
  @IsEnum(OperationalDegradationLevel)
  level?: OperationalDegradationLevel;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AuditQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OperationalAuditEventType)
  eventType?: OperationalAuditEventType;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class MetricsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class ReadinessQueryDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
