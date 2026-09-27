import { IsOptional, IsString, IsArray, IsNotEmpty, MaxLength, IsDateString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiKeyState } from '../security.types';

/**
 * Validated API-key creation/list/rotate/revoke DTOs with scope restrictions and expiration rules.
 * Client cannot set unrestricted platform permissions, assign another tenant, assign PLATFORM_MANAGE unless authorized, retrieve existing raw secret.
 */

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  scopes: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ipAllowlist?: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}

export class ListApiKeyDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEnum(ApiKeyState)
  state?: ApiKeyState;

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

export class RotateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}

export class RevokeApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ApiKeyValidateDto {
  @IsString()
  @IsNotEmpty()
  apiKey: string;
}
