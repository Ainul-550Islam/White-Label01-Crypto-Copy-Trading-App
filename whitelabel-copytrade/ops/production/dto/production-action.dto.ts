/**
 * Production Action DTOs
 * Validated deployment-plan/start/approve/verify requests and rollback requests.
 * Clients cannot provide trusted deployment status, artifact digest, migration success or security-gate result.
 */

import { IsString, IsEnum, IsOptional, IsArray, IsBoolean, IsUUID, IsNotEmpty, MinLength, MaxLength, IsObject } from 'class-validator';
import { EnvironmentName, DeploymentStrategy } from '../production.types';

export class CreateDeploymentPlanDto {
  @IsString()
  @IsNotEmpty()
  releaseId: string;

  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsString()
  @IsNotEmpty()
  currentMigrationId: string;

  @IsOptional()
  @IsEnum(DeploymentStrategy)
  strategy?: DeploymentStrategy;

  @IsArray()
  @IsString({ each: true })
  targetServices: string[];

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsOptional()
  @IsString()
  approvalReference?: string;
}

export class StartDeploymentDto {
  @IsString()
  @IsNotEmpty()
  deploymentId: string;

  @IsString()
  @IsNotEmpty()
  releaseId: string;

  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  operatorId: string;

  @IsOptional()
  @IsString()
  approvalReference?: string;

  @IsBoolean()
  backupVerified: boolean;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;
}

export class ApproveDeploymentDto {
  @IsString()
  @IsNotEmpty()
  deploymentId: string;

  @IsString()
  @IsNotEmpty()
  releaseId: string;

  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsString()
  @IsNotEmpty()
  approvedBy: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;

  @IsString()
  @IsNotEmpty()
  approvalReference: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsBoolean()
  requiresMfa: boolean;

  @IsOptional()
  @IsString()
  mfaToken?: string;
}

export class VerifyDeploymentDto {
  @IsString()
  @IsNotEmpty()
  deploymentId: string;

  @IsString()
  @IsNotEmpty()
  releaseId: string;

  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsString()
  @IsNotEmpty()
  expectedMigrationId: string;

  @IsString()
  @IsNotEmpty()
  expectedImageDigest: string;

  @IsString()
  @IsNotEmpty()
  apiBaseUrl: string;

  @IsOptional()
  @IsString()
  frontendBaseUrl?: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  verifiedBy: string;
}

export class RollbackDeploymentDto {
  @IsString()
  @IsNotEmpty()
  rollbackId: string;

  @IsString()
  @IsNotEmpty()
  deploymentId: string;

  @IsString()
  @IsNotEmpty()
  fromReleaseId: string;

  @IsString()
  @IsNotEmpty()
  toReleaseId: string;

  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  operatorId: string;

  @IsString()
  @IsNotEmpty()
  targetArtifactDigest: string;

  @IsString()
  @IsNotEmpty()
  currentMigrationId: string;

  @IsString()
  @IsNotEmpty()
  targetMigrationId: string;

  @IsOptional()
  @IsString()
  approvedBy?: string;
}

export class CreateBackupDto {
  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsEnum(['DATABASE', 'OBJECT_STORAGE', 'CONFIGURATION'] as any)
  type: 'DATABASE' | 'OBJECT_STORAGE' | 'CONFIGURATION';

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  createdBy: string;

  @IsString()
  @IsNotEmpty()
  location: string;
}

export class VerifyBackupDto {
  @IsString()
  @IsNotEmpty()
  backupId: string;

  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsString()
  @IsNotEmpty()
  backupCreatedAt: string;

  @IsString()
  @IsNotEmpty()
  backupLocation: string;

  @IsString()
  @IsNotEmpty()
  backupChecksum: string;

  @IsOptional()
  @IsString()
  verifiedBy?: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;
}

export class VerifyRestoreDto {
  @IsString()
  @IsNotEmpty()
  restoreId: string;

  @IsString()
  @IsNotEmpty()
  backupId: string;

  @IsString()
  @IsNotEmpty()
  backupLocation: string;

  @IsString()
  @IsNotEmpty()
  targetEnvironment: string;

  @IsString()
  @IsNotEmpty()
  expectedMigrationId: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  verifiedBy: string;
}

export class DisasterRecoveryDto {
  @IsString()
  @IsNotEmpty()
  drId: string;

  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsString()
  @IsNotEmpty()
  backupCreatedAt: string;

  @IsString()
  @IsNotEmpty()
  failureDetectedAt: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  triggeredBy: string;
}

export class ProductionReadinessDto {
  @IsEnum(EnvironmentName)
  environment: EnvironmentName;

  @IsString()
  @IsNotEmpty()
  releaseId: string;

  @IsString()
  @IsNotEmpty()
  currentMigrationId: string;

  @IsString()
  @IsNotEmpty()
  expectedMigrationId: string;

  @IsBoolean()
  backupVerified: boolean;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  assessedBy: string;
}
