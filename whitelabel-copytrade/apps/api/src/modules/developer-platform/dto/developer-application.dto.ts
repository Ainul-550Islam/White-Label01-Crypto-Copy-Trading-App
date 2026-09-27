/**
 * Validated DTOs for developer application registration and lifecycle.
 * Trusted fields (state, client id, credential data, audit history, approval
 * results) are NEVER client-suppliable: they are either omitted entirely or
 * `readonly` server-resolved outputs that are ignored on input.
 */

import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { APPLICATION_TRANSITIONS, type ApplicationState } from '../developer.types';

export class RedirectUriDto {
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  uri!: string;

  @IsOptional()
  @IsBoolean()
  primary?: boolean;
}

export class CreateDeveloperApplicationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(2000)
  description!: string;

  @IsArray()
  @ArrayMaxSize(16)
  @IsString()
  @Matches(/^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9\/\-._~%]*$|^http:\/\/localhost(:\d+)?[A-Za-z0-9\/\-._~%]*$/, {
    message: 'redirect URIs must be https (localhost http allowed only in development)',
  })
  redirectUris!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString()
  requestedScopes?: string[];

  @IsOptional()
  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment?: 'SANDBOX' | 'PRODUCTION';

  /** Free-form natural key for deterministic client ids (e.g. a slug). */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9\-_.]{2,63}$/)
  naturalKey?: string;
}

export class UpdateDeveloperApplicationDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString()
  @Matches(/^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9\/\-._~%]*$|^http:\/\/localhost(:\d+)?[A-Za-z0-9\/\-._~%]*$/)
  redirectUris?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  homePageUrl?: string;
}

export class ApplicationTransitionDto {
  @IsIn(Object.keys(APPLICATION_TRANSITIONS))
  targetState!: ApplicationState;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class AddRedirectUriDto {
  @ValidateNested()
  redirect!: RedirectUriDto;
}

export class ApplicationResponseDto {
  readonly id!: string;
  readonly tenantId!: string;
  readonly name!: string;
  readonly description!: string;
  readonly clientId!: string;
  readonly state!: ApplicationState;
  readonly redirectUris!: string[];
  readonly scopes!: string[];
  readonly environment!: string;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
  /** Never serialized: credential secrets, audit history, approval results. */
  readonly clientSecretHash!: undefined;
  readonly audit!: undefined;
}
