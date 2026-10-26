// # Responsibility: defines validated request data for the Batch 04 API capability.
// # Validates customer-owned privacy access, export, and deletion requests without accepting user or tenant identifiers.
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DataAccessRequestDto {
  @IsIn(['ACCESS', 'EXPORT', 'DELETION'])
  requestType!: 'ACCESS' | 'EXPORT' | 'DELETION';

  @IsString()
  @MinLength(2)
  @MaxLength(16)
  jurisdiction!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @IsString()
  @MinLength(16)
  @MaxLength(255)
  idempotencyKey!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(255)
  correlationId!: string;
}

export class DataExportRequestDto {
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  correlationId!: string;
}
