import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Starts an SSO login. The tenant is resolved from the request host, never
 * from the body; the redirect URI always comes from the tenant's
 * configuration.
 */
export class SsoStartDto {
  @ApiPropertyOptional({
    enum: ['OIDC', 'SAML'],
    description:
      "Omit to start the tenant's enabled provider (with both enabled: the enforced one, otherwise OIDC).",
  })
  @IsOptional()
  @IsIn(['OIDC', 'SAML'])
  providerType?: 'OIDC' | 'SAML';

  @ApiProperty({
    description:
      'Stable identifier generated and stored by the client. The login can only be completed from this device.',
    example: 'web-6E9F1C7A-2B34-4A11-9E7C-D0F2A1B3C4D5',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'Device id contains unsupported characters' })
  deviceId!: string;

  @ApiPropertyOptional({
    description: 'App-relative path to return to after login (for example /dashboard).',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  returnTo?: string;
}

/**
 * Completes an SSO login with the values the IdP redirect delivered to the
 * client (state and code, or an error) plus the binding secret returned by
 * start. The OIDC code is redeemed server-side; the SAML code is the
 * one-time hand-off issued by the ACS.
 */
export class SsoCallbackDto {
  @ApiProperty({ description: 'The state / RelayState value from the redirect.' })
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  @Matches(OPAQUE_PATTERN, { message: 'state is malformed' })
  state!: string;

  @ApiPropertyOptional({ description: 'Authorization code (OIDC) or hand-off code (SAML).' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @ApiPropertyOptional({ description: 'Error code returned by the IdP instead of a code.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;

  @ApiPropertyOptional({ description: 'IdP error description (never stored or logged).' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  errorDescription?: string;

  @ApiProperty({ description: 'The binding secret returned by start.' })
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  @Matches(OPAQUE_PATTERN, { message: 'binding token is malformed' })
  bindingToken!: string;

  @ApiProperty({ description: 'The device id used at start.' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'Device id contains unsupported characters' })
  deviceId!: string;

  @ApiPropertyOptional({ example: 'Customer Web' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceName?: string;

  @ApiPropertyOptional({ enum: ['ios', 'android', 'web', 'desktop'] })
  @IsOptional()
  @IsIn(['ios', 'android', 'web', 'desktop'])
  platform?: string;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;
}
