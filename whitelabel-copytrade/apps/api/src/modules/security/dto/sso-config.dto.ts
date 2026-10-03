import {
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  Max,
  MaxLength,
  Min,
  MinLength,
  ArrayMaxSize,
} from 'class-validator';
import { SsoProvider } from '../security.types';

/**
 * Validated SSO configuration DTOs for SAML/OIDC metadata, issuer, audience, domains, enforcement, and JIT settings.
 * Never accept or return client secrets in plaintext after creation: clientSecret is write-only, stored
 * envelope-encrypted, and reported back only as `hasClientSecret`.
 *
 * Every URL is additionally checked by the service (https only; http loopback only with
 * SSO_ALLOW_INSECURE_HTTP=true outside production) and every SAML certificate is parsed as X.509.
 */

const TOKEN_AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'none'] as const;
const ASYMMETRIC_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'] as const;

export class CreateSamlConfigDto {
  @IsEnum(SsoProvider)
  providerType: SsoProvider = SsoProvider.SAML;

  /** IdP entity ID; the assertion Issuer must equal it. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  issuer: string;

  /** SP entity ID (our Audience). */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  entityId?: string;

  /** IdP SSO endpoint (HTTP-Redirect binding). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  ssoUrl: string;

  /** Our Assertion Consumer Service URL (…/v1/auth/sso/saml/acs on the tenant host). */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  acsUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  audience?: string;

  /** IdP signing certificate(s), PEM. Several blocks may be supplied during a rotation. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32768)
  certificate: string;

  /** Where the ACS sends the browser with the one-time hand-off (the web BFF callback). */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  redirectUri?: string;

  @IsOptional()
  @IsBoolean()
  wantResponseSigned?: boolean;

  /** Opt-in: require encrypted assertions (needs spDecryptionPrivateKey + spEncryptionCertificate). */
  @IsOptional()
  @IsBoolean()
  wantAssertionsEncrypted?: boolean;

  /** SP RSA private key (PEM, >= 2048 bits). Write-only: encrypted at rest, never returned. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  spDecryptionPrivateKey?: string;

  /** Certificate of that key (PEM), given to the IdP as the SP encryption certificate. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  spEncryptionCertificate?: string;

  /** Single Logout: the IdP SingleLogoutService URL (HTTP-Redirect binding). Empty string turns SLO off. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  sloUrl?: string;

  /** Single Logout: our SingleLogoutService URL (…/v1/auth/sso/saml/slo on the tenant host). */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoutCallbackUrl?: string;

  /** Single Logout: SP RSA signing key (PEM, >= 2048 bits). Write-only: encrypted at rest, never returned. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  spSigningPrivateKey?: string;

  /** Single Logout: certificate of that key (PEM), given to the IdP to verify our logout messages. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  spSigningCertificate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  clockSkewSec?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
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

  /** Issuer URL; discovery must report exactly this issuer. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  issuer: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  clientId: string;

  /** Write-only. Required unless tokenEndpointAuthMethod is "none" (public client with PKCE). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  clientSecret?: string;

  /** The exact redirect URI registered at the IdP (the web BFF callback). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  redirectUri: string;

  @IsOptional()
  @IsIn(TOKEN_AUTH_METHODS as unknown as string[])
  tokenEndpointAuthMethod?: (typeof TOKEN_AUTH_METHODS)[number];

  @IsOptional()
  @IsBoolean()
  pkceRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  clockSkewSec?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  maxAuthAgeSec?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsIn(ASYMMETRIC_ALGORITHMS as unknown as string[], { each: true })
  allowedAlgorithms?: string[];

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
  @ArrayMaxSize(50)
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
  @ArrayMaxSize(20)
  @IsString({ each: true })
  scopes?: string[];
}

/** Partial update: only the fields present are changed. */
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
  @MaxLength(32768)
  certificate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  clientId?: string;

  /** Write-only; replaces the stored secret. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  redirectUri?: string;

  @IsOptional()
  @IsIn(TOKEN_AUTH_METHODS as unknown as string[])
  tokenEndpointAuthMethod?: (typeof TOKEN_AUTH_METHODS)[number];

  @IsOptional()
  @IsBoolean()
  pkceRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  clockSkewSec?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  maxAuthAgeSec?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsIn(ASYMMETRIC_ALGORITHMS as unknown as string[], { each: true })
  allowedAlgorithms?: string[];

  @IsOptional()
  @IsBoolean()
  wantResponseSigned?: boolean;

  /** Opt-in: require encrypted assertions (needs spDecryptionPrivateKey + spEncryptionCertificate). */
  @IsOptional()
  @IsBoolean()
  wantAssertionsEncrypted?: boolean;

  /** SP RSA private key (PEM, >= 2048 bits). Write-only: encrypted at rest, never returned. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  spDecryptionPrivateKey?: string;

  /** Certificate of that key (PEM), given to the IdP as the SP encryption certificate. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  spEncryptionCertificate?: string;

  /** Single Logout: the IdP SingleLogoutService URL (HTTP-Redirect binding). Empty string turns SLO off. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  sloUrl?: string;

  /** Single Logout: our SingleLogoutService URL (…/v1/auth/sso/saml/slo on the tenant host). */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoutCallbackUrl?: string;

  /** Single Logout: SP RSA signing key (PEM, >= 2048 bits). Write-only: encrypted at rest, never returned. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  spSigningPrivateKey?: string;

  /** Single Logout: certificate of that key (PEM), given to the IdP to verify our logout messages. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  spSigningCertificate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  discoveryUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  jwksUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
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
  @ArrayMaxSize(20)
  @IsString({ each: true })
  scopes?: string[];
}

export class SsoConfigQueryDto {
  @IsOptional()
  @IsEnum(SsoProvider)
  providerType?: SsoProvider;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
