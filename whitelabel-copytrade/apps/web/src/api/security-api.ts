import { apiClient } from './api-client';

export interface MfaStatus {
  enabled: boolean;
  method?: string;
  enrolledAt?: string;
  lastUsedAt?: string;
}

export interface Session {
  id: string;
  device?: string;
  ip?: string;
  location?: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface Device {
  id: string;
  fingerprint: string;
  name?: string;
  trusted: boolean;
  lastSeenAt: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface ApiKeyCreated extends ApiKey {
  secret: string; // only shown once when backend allows
}

export const securityApi = {
  getMfaStatus: () => apiClient.get<MfaStatus>('/security/mfa/status'),

  enrollMfa: () => apiClient.post<{ qrCodeUrl: string; secret: string; recoveryCodes: string[] }>('/security/mfa/enroll'),

  verifyMfaEnroll: (code: string) => apiClient.post<void>('/security/mfa/enroll/verify', { code }),

  disableMfa: (code: string) => apiClient.post<void>('/security/mfa/disable', { code }),

  listSessions: () => apiClient.get<Session[]>('/security/sessions'),

  revokeSession: (id: string) => apiClient.delete<void>(`/security/sessions/${id}`),

  revokeAllOtherSessions: () => apiClient.post<void>('/security/sessions/revoke-others'),

  listDevices: () => apiClient.get<Device[]>('/security/devices'),

  trustDevice: (id: string) => apiClient.post<Device>(`/security/devices/${id}/trust`),

  revokeDevice: (id: string) => apiClient.delete<void>(`/security/devices/${id}`),

  listApiKeys: () => apiClient.get<ApiKey[]>('/security/api-keys'),

  createApiKey: (data: { name: string; scopes: string[]; expiresAt?: string }) =>
    apiClient.post<ApiKeyCreated>('/security/api-keys', data),

  revokeApiKey: (id: string) => apiClient.delete<void>(`/security/api-keys/${id}`),

  getSecurityPolicy: () =>
    apiClient.get<{
      mfaRequired: boolean;
      sessionTimeoutMinutes: number;
      passwordPolicy: { minLength: number; requireUppercase: boolean; requireNumbers: boolean };
    }>('/security/policy'),
};
