import { apiClient } from './api-client';

export interface LoginRequest {
  email: string;
  password: string;
  tenantSlug?: string;
}

export interface LoginResponse {
  user: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
  requiresMfa?: boolean;
  mfaToken?: string;
}

export interface MfaChallengeRequest {
  mfaToken: string;
  code: string;
  method?: 'TOTP' | 'RECOVERY';
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
    displayName?: string;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  entitlements: Record<string, boolean>;
}

export const authApi = {
  login: (data: LoginRequest) => apiClient.post<LoginResponse>('/v1/auth/login', data),

  logout: () => apiClient.post<void>('/v1/auth/logout'),

  getSession: () => apiClient.get<SessionResponse>('/v1/auth/session'),

  refresh: () => apiClient.post<void>('/v1/auth/refresh'),

  mfaChallenge: (data: MfaChallengeRequest) => apiClient.post<LoginResponse>('/v1/auth/two-factor/challenge', data),

  mfaEnroll: () => apiClient.post<{ secret?: string; qrCodeUrl?: string; recoveryCodes?: string[] }>('/v1/auth/two-factor/enroll'),

  mfaVerifyEnroll: (code: string) => apiClient.post<void>('/v1/auth/two-factor/verify', { code }),

  mfaDisable: (code: string) => apiClient.post<void>('/v1/auth/two-factor/disable', { code }),
};
