// # Responsibility: declare validated API inputs while keeping arbitrary extension metadata unknown until runtime narrowing.
// # Validates case review decisions and mandatory rationale
import { IsOptional, IsString, IsEnum, IsNotEmpty, MaxLength, IsObject } from 'class-validator';
import { ComplianceDecision } from '../compliance.types';

export class AssignCaseDto {
  @IsString()
  @IsNotEmpty()
  reviewerId: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class EscalateCaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class AddEvidenceDto {
  @IsString()
  @IsNotEmpty()
  evidenceType: string;

  @IsString()
  @IsNotEmpty()
  referenceId: string;

  @IsString()
  @IsNotEmpty()
  referenceType: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  safeDescription?: string;
}

export class AddNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  safeNote: string;
}

export class MakeDecisionDto {
  @IsEnum(ComplianceDecision)
  decision: ComplianceDecision;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsObject()
  safeMetadata?: Record<string, unknown>;
}

export class RequestEDDDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString({ each: true })
  requiredDocuments?: string[];

  @IsOptional()
  @IsObject()
  safeMetadata?: Record<string, unknown>;
}

export class RequestReverificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString()
  levelName?: string;
}

export class RequestHoldDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsObject()
  safeMetadata?: Record<string, unknown>;
}

export class RequestReleaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsObject()
  safeMetadata?: Record<string, unknown>;
}

export class ResolveCaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsEnum(ComplianceDecision)
  decision?: ComplianceDecision;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CloseCaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class EvaluateTransactionDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  sourceType: string;

  @IsString()
  @IsNotEmpty()
  sourceId: string;

  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsObject()
  safeMetadata?: Record<string, unknown>;
}

export class ResolveSignalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  resolution: string;
}
