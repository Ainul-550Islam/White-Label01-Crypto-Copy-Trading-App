import { IsString, IsEnum, IsOptional, IsBoolean, IsArray, IsUUID, MinLength, MaxLength, IsNotEmpty, IsIn, ArrayMaxSize, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ExchangeVenue, ExchangeEnvironment, ExchangeAccountState } from '../exchange.types';

export class CreateExchangeAccountDto {
  @IsEnum(ExchangeVenue, { message: `venue must be one of ${Object.values(ExchangeVenue).join(', ')}` })
  venue!: ExchangeVenue;

  @IsEnum(ExchangeEnvironment, { message: `environment must be one of ${Object.values(ExchangeEnvironment).join(', ')}` })
  environment!: ExchangeEnvironment;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsString()
  @MinLength(8, { message: 'API key must be at least 8 characters' })
  @MaxLength(128)
  apiKey!: string;

  @IsString()
  @MinLength(8, { message: 'API secret must be at least 8 characters' })
  @MaxLength(256)
  apiSecret!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  passphrase?: string;

  @IsOptional()
  @IsIn(['ENVELOPE_DB', 'SECRET_MANAGER', 'ENVIRONMENT'], { message: 'credentialSource must be ENVELOPE_DB, SECRET_MANAGER, or ENVIRONMENT' })
  credentialSource?: 'ENVELOPE_DB' | 'SECRET_MANAGER' | 'ENVIRONMENT' = 'ENVELOPE_DB';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  credentialRef?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  ipAllowlist?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}

export class UpdateExchangeAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  privateStreamEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  ipAllowlist?: string[];
}

export class EnableExchangeAccountDto {
  @IsOptional()
  @IsBoolean()
  liveTradingRequested?: boolean = false;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DisableExchangeAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class RevokeExchangeAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  confirmation?: string;
}

export class RotateCredentialsDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  apiKey!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  apiSecret!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  passphrase?: string;

  @IsOptional()
  @IsIn(['ENVELOPE_DB', 'SECRET_MANAGER', 'ENVIRONMENT'])
  credentialSource?: 'ENVELOPE_DB' | 'SECRET_MANAGER' | 'ENVIRONMENT' = 'ENVELOPE_DB';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  credentialRef?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}

export class ListExchangeAccountsDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEnum(ExchangeVenue)
  venue?: ExchangeVenue;

  @IsOptional()
  @IsEnum(ExchangeEnvironment)
  environment?: ExchangeEnvironment;

  @IsOptional()
  @IsEnum(ExchangeAccountState)
  status?: ExchangeAccountState;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}

export class ExchangeAccountSafeResponseDto {
  accountId!: string;
  tenantId!: string;
  userId!: string | null;
  venue!: ExchangeVenue;
  environment!: ExchangeEnvironment;
  label!: string;
  maskedApiKey!: string;
  status!: ExchangeAccountState;
  connectionState!: string;
  healthState!: string;
  capabilities!: string[];
  isSandbox!: boolean;
  liveTradingEnabled!: boolean;
  credentialRef!: string | null;
  credentialSource!: string;
  lastVerifiedAt!: string | null;
  lastSyncAt!: string | null;
  lastErrorCode!: string | null;
  createdAt!: string;
  updatedAt!: string;
}
