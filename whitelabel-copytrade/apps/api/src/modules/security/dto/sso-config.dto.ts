import { IsOptional, IsString, IsBoolean, IsArray, IsEnum, IsNotEmpty, MaxLength, IsUrl, IsEmail } from 'class-validator';
import { SsoProvider } from '../security.types';

/**
 * Validated SSO configuration DTOs for SAML/OIDC metadata, issuer, audience, domains, enforcement, and JIT settings.
 * Never accept or return client secrets in plaintext after creation.
 */

export class CreateSamlConfigDto {
  @IsEnum(SsoProvider)
  providerType: SsoProvider = SsoProvider.SAML;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  issuer: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  entityId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  ssoUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  acsUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  audience?: string;

  @IsString()
  @IsNotEmpty()
  certificate: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsBoolean()
  enforced?: boolean = false;

  @IsOptional()
  @IsBoolean()
  jitEnabled?: boolean = false;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  defaultRole?: string;
}

export class CreateOidcConfigDto {
  @IsEnum(SsoProvider)
  providerType: SsoProvider = SsoProvider.OIDC;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  issuer: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  clientId: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  audience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  discoveryUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  jwksUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ssoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsBoolean()
  enforced?: boolean = false;

  @IsOptional()
  @IsBoolean()
  jitEnabled?: boolean = false;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  defaultRole?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}

export class UpdateSsoConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  issuer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  entityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ssoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  acsUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  audience?: string;

  @IsOptional()
  @IsString()
  certificate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsBoolean()
  enforced?: boolean;

  @IsOptional()
  @IsBoolean()
  jitEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  defaultRole?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}

export class SsoLoginInitiateDto {
  @IsOptional()
  @IsEnum(SsoProvider)
  providerType?: SsoProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  redirectUri: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  nonce?: string;
}

export class SsoCallbackDto {
  @IsOptional()
  @IsEnum(SsoProvider)
  providerType?: SsoProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  state: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  samlResponse?: string;

  @IsOptional()
  @IsString()
  idToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  nonce?: string;
}

export class SsoConfigQueryDto {
  @IsOptional()
  @IsEnum(SsoProvider)
  providerType?: SsoProvider;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
