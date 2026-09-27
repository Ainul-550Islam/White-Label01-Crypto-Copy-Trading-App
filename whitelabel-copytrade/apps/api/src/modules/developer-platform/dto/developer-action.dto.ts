/**
 * Validated DTOs for credentials, scope changes, OAuth consent/revocation,
 * webhook actions, replay actions and API-version actions. Outcomes of
 * privileged operations (issued secrets, delivery results, approval state)
 * are structurally impossible to supply from the client: the DTOs carry
 * intent only.
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { DELIVERY_TRANSITIONS, OAUTH_GRANT_TRANSITIONS } from '../developer.types';

// --- Credentials -----------------------------------------------------------

export class CreateCredentialDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString()
  scopes?: string[];
}

export class RotateCredentialDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$|^devkey_[0-9a-f]{40}$/)
  keyId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RevokeCredentialDto {
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$|^devkey_[0-9a-f]{40}$/)
  keyId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// --- Scopes -----------------------------------------------------------------

export class UpdateApplicationScopesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @IsString()
  @Matches(/^[a-z]+:(read|write|execute|manage|request)$/, { each: true })
  scopes!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// --- OAuth -------------------------------------------------------------------

export class OAuthAuthorizeDto {
  @IsString()
  @Matches(/^dev_[0-9a-f]{32}$/)
  clientId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(512)
  redirectUri!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  state!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString()
  requestedScopes?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9\-_.~]{43,128}$/)
  codeChallenge?: string;

  @IsOptional()
  @IsIn(['S256'])
  codeChallengeMethod?: 'S256';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  nonce?: string;
}

export class OAuthConsentDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  grantId!: string;

  @IsIn(Object.keys(OAUTH_GRANT_TRANSITIONS))
  decision!: 'GRANTED' | 'DENIED';
}

export class OAuthTokenExchangeDto {
  @IsString()
  @Matches(/^dev_[0-9a-f]{32}$/)
  clientId!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(128)
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(512)
  redirectUri!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9\-_.~]{43,128}$/)
  codeVerifier?: string;

  /** Client secret presented for confidential clients; verified by digest. */
  @IsOptional()
  @IsString()
  @MinLength(32)
  clientSecret?: string;
}

export class OAuthRevokeDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;
}

// --- Webhooks -----------------------------------------------------------------

export class CreateWebhookSubscriptionDto {
  @IsString()
  @Matches(/^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9\/\-._~%]*$/, {
    message: 'webhook endpoints must be https',
  })
  endpointUrl!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @IsString()
  eventTypes!: string[];

  @IsOptional()
  @IsIn(['v1', 'v2'])
  eventVersion?: string;

  @IsOptional()
  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment?: 'SANDBOX' | 'PRODUCTION';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class UpdateWebhookSubscriptionDto {
  @IsOptional()
  @IsString()
  @Matches(/^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9\/\-._~%]*$/)
  endpointUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @IsString()
  eventTypes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class WebhookSubscriptionActionDto {
  @IsIn(Object.keys(DELIVERY_TRANSITIONS))
  action!: 'pause' | 'resume' | 'revoke';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class WebhookReplayDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  eventId!: string;
}

export class WebhookTestDeliveryDto {
  @IsBoolean()
  includeSignature!: boolean;
}

// --- API versions -------------------------------------------------------------

export class ApiVersionResolveDto {
  @IsIn(['v1', 'v2', 'v999'])
  version!: string;
}
