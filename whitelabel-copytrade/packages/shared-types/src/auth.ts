import type { ISODateString, SupportedLocale, UUID } from './common';
import type { UserDto } from './user';

export interface LoginInput {
  email: string;
  password: string;
  deviceId: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  rememberDevice?: boolean;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  locale?: SupportedLocale;
  referralCode?: string;
  acceptedTerms: boolean;
  deviceId: string;
  deviceName?: string;
  platform?: string;
}

export interface TokenPairDto {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthenticatedSessionDto {
  tokens: TokenPairDto;
  user: UserDto;
  sessionId: UUID;
}

/** Returned when the password step succeeds but 2FA is still outstanding. */
export interface TwoFactorChallengeDto {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
  methods: TwoFactorMethod[];
}

export type LoginResultDto = AuthenticatedSessionDto | TwoFactorChallengeDto;

export function isTwoFactorChallenge(result: LoginResultDto): result is TwoFactorChallengeDto {
  return (result as TwoFactorChallengeDto).twoFactorRequired === true;
}

export enum TwoFactorMethod {
  TOTP = 'TOTP',
  RECOVERY_CODE = 'RECOVERY_CODE',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
}

export interface TwoFactorSetupDto {
  method: TwoFactorMethod;
  secretIssuedAt: ISODateString;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
}

export interface RefreshTokenInput {
  refreshToken: string;
  deviceId: string;
}

/** Decoded access-token payload. Never contains PII beyond the subject id. */
export interface JwtAccessPayload {
  sub: UUID;
  sid: UUID;
  tid: UUID;
  typ: 'access';
  roles: string[];
  perms: string[];
  plat: boolean;
  /**
   * The user's `sessionVersion` at the moment the token was minted.
   *
   * Bumped by the server on password change and on "sign out of all devices".
   * The auth strategy compares this claim with the stored counter on every
   * request, so those actions invalidate live access tokens immediately instead
   * of waiting for them to expire. An integer comparison is used rather than a
   * timestamp comparison because `iat` only has one-second resolution, which
   * makes any time-based check ambiguous for tokens issued in the same second
   * as the change.
   */
  sv: number;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface JwtRefreshPayload {
  sub: UUID;
  sid: UUID;
  tid: UUID;
  typ: 'refresh';
  fam: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface JwtTwoFactorPayload {
  sub: UUID;
  tid: UUID;
  typ: '2fa_challenge';
  did: string;
  jti: string;
  iat: number;
  exp: number;
}

/** Request-scoped identity assembled by the authentication guard. */
export interface AuthenticatedActor {
  userId: UUID;
  tenantId: UUID;
  sessionId: UUID;
  roles: string[];
  permissions: string[];
  isPlatformUser: boolean;
  tokenId: string;
}
