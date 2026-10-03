import { apiClient } from './api-client';

/**
 * Authentication API.
 *
 * Sign-in, the second factor, refresh and sign-out go through this app's own
 * route handlers (/api/auth/*): they are the only code that may see tokens,
 * and they store them in httpOnly cookies. Everything else goes through the
 * authenticated proxy to the backend (/v1/auth/*, /v1/tenants/public-config).
 * Every body below matches the backend DTO exactly - the API rejects unknown
 * fields (forbidNonWhitelisted).
 */

export interface LoginRequest {
  email: string;
  password: string;
}

/** What /api/auth/login returns to the browser (never a token). */
export interface LoginResponse {
  requiresMfa: boolean;
  /** Second-factor methods the backend accepts, e.g. ['TOTP', 'RECOVERY_CODE']. */
  methods?: string[];
  redirectTo?: string;
}

export interface MfaChallengeRequest {
  code: string;
  method?: 'TOTP' | 'RECOVERY';
  trustDevice?: boolean;
}

export interface MfaChallengeResponse {
  redirectTo: string;
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
    permissions: string[];
    displayName?: string;
    avatarUrl?: string;
    mfaEnabled: boolean;
    status: string;
    emailVerified: boolean;
    isPlatformUser: boolean;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  entitlements: Record<string, boolean>;
}

export interface MfaEnrollResponse {
  secret?: string;
  qrCodeUrl?: string;
  otpauthUrl?: string;
  recoveryCodes?: string[];
}

export interface MfaDisableRequest {
  password: string;
  code?: string;
  recoveryCode?: string;
}

/** GET /v1/auth/me (UserResponseDto). */
interface MeResponse {
  id: string;
  tenantId: string;
  email: string;
  emailVerifiedAt: string | null;
  status: string;
  isPlatformUser: boolean;
  twoFactorEnabled: boolean;
  profile: { displayName: string | null; avatarUrl: string | null; firstName: string | null; lastName: string | null } | null;
  roles: Array<{ key: string }>;
  permissions: string[];
}

/** GET /v1/tenants/public-config (TenantPublicConfigDto). */
interface PublicTenantConfig {
  tenantId: string;
  slug: string;
  name: string;
  features: Record<string, boolean>;
}

/** POST /v1/auth/two-factor/setup (TwoFactorSetupResponseDto). */
interface TwoFactorSetupResponse {
  method: string;
  secretIssuedAt: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
}

/** The manual-entry secret is the `secret` parameter of the otpauth:// URI. */
export function secretFromOtpauthUrl(otpauthUrl: string): string | undefined {
  const query = otpauthUrl.split('?')[1];
  if (!query) return undefined;
  const value = new URLSearchParams(query).get('secret');
  return value ?? undefined;
}

export function toSessionResponse(me: MeResponse, config: PublicTenantConfig): SessionResponse {
  const displayName =
    me.profile?.displayName ??
    ([me.profile?.firstName, me.profile?.lastName].filter(Boolean).join(' ') || undefined);
  return {
    user: {
      id: me.id,
      email: me.email,
      tenantId: me.tenantId,
      roles: (me.roles ?? []).map((role) => role.key),
      permissions: me.permissions ?? [],
      displayName: displayName ?? undefined,
      avatarUrl: me.profile?.avatarUrl ?? undefined,
      mfaEnabled: me.twoFactorEnabled === true,
      status: me.status,
      emailVerified: Boolean(me.emailVerifiedAt),
      isPlatformUser: me.isPlatformUser === true,
    },
    tenant: {
      id: config.tenantId,
      slug: config.slug,
      name: config.name,
    },
    entitlements: config.features ?? {},
  };
}

export const authApi = {
  login: (data: LoginRequest) =>
    apiClient.app.post<LoginResponse>('/api/auth/login', { email: data.email, password: data.password }),

  logout: () => apiClient.app.post<{ redirectTo: string }>('/api/auth/logout'),

  /**
   * Starts single sign-on for this host's tenant. Returns only the IdP URL to
   * navigate to; the binding secret stays in an httpOnly cookie (Part 11).
   * Without a providerType the API starts the tenant's enabled provider
   * (OIDC or SAML), so one "Sign in with SSO" button serves both.
   */
  ssoStart: (data: { providerType?: 'OIDC' | 'SAML'; returnTo?: string } = {}) =>
    apiClient.app.post<{ authorizationUrl: string }>('/api/auth/sso/start', {
      ...(data.providerType ? { providerType: data.providerType } : {}),
      ...(data.returnTo ? { returnTo: data.returnTo } : {}),
    }),

  getSession: async (): Promise<SessionResponse> => {
    const [me, config] = await Promise.all([
      apiClient.get<MeResponse>('/v1/auth/me'),
      apiClient.get<PublicTenantConfig>('/v1/tenants/public-config'),
    ]);
    return toSessionResponse(me, config);
  },

  refresh: () => apiClient.app.post<Record<string, never>>('/api/auth/refresh'),

  mfaChallenge: (data: MfaChallengeRequest) =>
    apiClient.app.post<MfaChallengeResponse>('/api/auth/two-factor', {
      code: data.code,
      method: data.method ?? 'TOTP',
      ...(data.trustDevice !== undefined ? { trustDevice: data.trustDevice } : {}),
    }),

  mfaEnroll: async (password: string): Promise<MfaEnrollResponse> => {
    const res = await apiClient.post<TwoFactorSetupResponse>('/v1/auth/two-factor/setup', { password });
    return {
      secret: secretFromOtpauthUrl(res.otpauthUrl),
      qrCodeUrl: res.qrCodeDataUrl,
      otpauthUrl: res.otpauthUrl,
      recoveryCodes: res.recoveryCodes,
    };
  },

  mfaVerifyEnroll: (code: string) =>
    apiClient.post<{ enabled: boolean }>('/v1/auth/two-factor/confirm', { code: code.replace(/\s+/g, '') }),

  mfaDisable: (data: MfaDisableRequest) =>
    apiClient.post<{ enabled: boolean }>('/v1/auth/two-factor/disable', {
      password: data.password,
      ...(data.recoveryCode ? { recoveryCode: data.recoveryCode } : { code: data.code }),
    }),
};
