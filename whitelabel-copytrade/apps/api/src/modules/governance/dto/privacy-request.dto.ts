import { IsString, IsEnum, IsOptional, IsUUID, MinLength, IsArray, IsBoolean } from 'class-validator';
import { PrivacyRequestType, PrivacyRequestState, DataClassification, LegalHoldState, ReportState, EvidenceState, ConsentState, CertificationState, DeliveryState } from '../governance.types';

export class CreatePrivacyRequestDto {
  @IsString()
  tenantId!: string;

  @IsString()
  subjectUserId!: string;

  @IsEnum(['USER', 'CUSTOMER'] as any)
  subjectType!: 'USER' | 'CUSTOMER';

  @IsEnum(PrivacyRequestType)
  requestType!: PrivacyRequestType;

  @IsString()
  jurisdiction!: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  reason?: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsString()
  @MinLength(5)
  correlationId!: string;

  @IsString()
  createdBy!: string;
}

export class TransitionPrivacyRequestDto {
  @IsString()
  tenantId!: string;

  @IsEnum(PrivacyRequestState)
  targetState!: PrivacyRequestState;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  verificationEvidence?: string;
}

export class CreateLegalHoldDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  @MinLength(3)
  caseReference!: string;

  @IsString()
  @MinLength(10)
  reason!: string;

  @IsArray()
  @IsEnum(DataClassification, { each: true })
  affectedDataClasses!: DataClassification[];

  @IsArray()
  @IsString({ each: true })
  affectedJurisdictions!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  affectedSubjects?: string[];

  @IsString()
  createdBy!: string;

  @IsString()
  correlationId!: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class ActivateLegalHoldDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  activatedBy!: string;

  @IsString()
  correlationId!: string;
}

export class ReleaseLegalHoldDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  releasedBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

export class CaptureConsentDto {
  @IsString()
  tenantId!: string;

  @IsString()
  subjectUserId!: string;

  @IsString()
  @MinLength(3)
  purpose!: string;

  @IsString()
  version!: string;

  @IsString()
  policyReference!: string;

  @IsString()
  source!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  capturedBy!: string;

  @IsOptional()
  @IsString()
  evidenceReference?: string;
}

export class WithdrawConsentDto {
  @IsString()
  tenantId!: string;

  @IsString()
  subjectUserId!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  withdrawnBy!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class GenerateReportDto {
  @IsString()
  tenantId!: string;

  @IsString()
  reportType!: string;

  @IsString()
  jurisdiction!: string;

  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  createdBy!: string;

  @IsOptional()
  sourceData?: Record<string, unknown>;
}

export class ValidateReportDto {
  @IsString()
  tenantId!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  validatorId!: string;

  @IsOptional()
  sourceAvailability?: Record<string, boolean>;
}

export class RequestCertificationDto {
  @IsString()
  tenantId!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  requesterId!: string;
}

export class CertifyReportDto {
  @IsString()
  tenantId!: string;

  @IsString()
  reviewerId!: string;

  @IsString()
  reviewerRole!: string;

  @IsEnum(['APPROVED', 'REJECTED', 'REWORK_REQUIRED'] as any)
  decision!: 'APPROVED' | 'REJECTED' | 'REWORK_REQUIRED';

  @IsOptional()
  @IsString()
  comments?: string;

  @IsString()
  correlationId!: string;
}

export class QueueDeliveryDto {
  @IsString()
  tenantId!: string;

  @IsString()
  channel!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;
}

export class SubmitDeliveryDto {
  @IsString()
  tenantId!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;

  @IsString()
  @MinLength(10)
  deliveryEvidence!: string;
}

export class MarkDeliveredDto {
  @IsString()
  tenantId!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;

  @IsString()
  @MinLength(10)
  deliveryEvidence!: string;
}

export class MarkFailedDto {
  @IsString()
  tenantId!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;

  @IsString()
  @MinLength(10)
  failureReason!: string;
}

export class CreateEvidencePackageDto {
  @IsString()
  tenantId!: string;

  @IsString()
  caseReference!: string;

  @IsString()
  evidenceType!: string;

  @IsArray()
  @IsString({ each: true })
  sourceRecords!: string[];

  @IsArray()
  @IsString({ each: true })
  sourceReferences!: string[];

  @IsString()
  redactionPolicy!: string;

  @IsString()
  generator!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  createdBy!: string;

  @IsOptional()
  @IsString()
  auditReference?: string;
}

export class FinalizeEvidencePackageDto {
  @IsString()
  tenantId!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;
}

export class AuditExportDto {
  @IsString()
  tenantId!: string;

  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;

  @IsOptional()
  filters?: { actionType?: string; subjectUserId?: string };
}

export class EvaluateRetentionDto {
  @IsString()
  tenantId!: string;

  @IsEnum(DataClassification)
  dataClass!: DataClassification;

  @IsString()
  sourceSystem!: string;

  @IsString()
  sourceId!: string;

  @IsString()
  jurisdiction!: string;

  @IsString()
  retentionStartAt!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;
}

export class ExecuteRetentionActionDto {
  @IsString()
  tenantId!: string;

  @IsEnum(['DELETE', 'ANONYMIZE', 'REVIEW', 'PRESERVE'] as any)
  action!: 'DELETE' | 'ANONYMIZE' | 'REVIEW' | 'PRESERVE';

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

export class PrivacyDeletionCheckDto {
  @IsString()
  tenantId!: string;

  @IsString()
  subjectUserId!: string;

  @IsString()
  jurisdiction!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;
}

export class PrivacyDeletionExecuteDto {
  @IsString()
  tenantId!: string;

  @IsString()
  subjectUserId!: string;

  @IsString()
  jurisdiction!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class ReconciliationDetectDto {
  @IsString()
  tenantId!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  operatorId!: string;

  @IsOptional()
  @IsString()
  reportId?: string;
}

export class GovernanceQueryDto {
  @IsString()
  tenantId!: string;

  @IsOptional()
  @IsString()
  subjectUserId?: string;

  @IsOptional()
  @IsString()
  reportType?: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  caseReference?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
