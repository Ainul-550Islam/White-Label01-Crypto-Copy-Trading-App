import { apiClient } from './api-client';
import { authApi, MfaEnrollResponse } from './auth-api';

/**
 * Account security API.
 *
 * Everything a signed-in customer manages about their own account is
 * self-service on the backend and needs no extra permission:
 *   two-factor   GET /v1/auth/me (twoFactorEnabled), POST /v1/auth/two-factor/{setup,confirm,disable}
 *   sessions     GET /v1/auth/sessions, DELETE /v1/auth/sessions/:id,
 *                POST /v1/auth/sessions/revoke-others
 *   devices      derived from the caller's sessions (one entry per deviceId)
 * Organisation-level controls are tenant-admin features (security module):
 *   API keys     /v1/security/api-keys          api_key:read / api_key:write
 *   policy       /v1/security/policy            security_policy:read
 * Their screens handle 403 for users without those permissions.
 */

export interface MfaStatus {
  enabled: boolean;
  method?: string;
  enrolledAt?: string;
  lastUsedAt?: string;
}

export interface Session {
  id: string;
  deviceId?: string;
  device?: string;
  platform?: string;
  ip?: string;
  location?: string;
  userAgent?: string;
  trusted?: boolean;
  lastActiveAt: string;
  createdAt: string;
  expiresAt?: string;
  isCurrent: boolean;
}

export interface Device {
  id: string;
  fingerprint: string;
  name?: string;
  platform?: string;
  trusted: boolean;
  isCurrent: boolean;
  sessionIds: string[];
  lastSeenAt: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  state: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface ApiKeyCreated extends ApiKey {
  secret: string; // only shown once when backend allows
}

export interface SecurityPolicy {
  mfaRequired: boolean;
  sessionTimeoutMinutes: number;
  passwordPolicy: { minLength: number; requireUppercase: boolean; requireNumbers: boolean };
  maxConcurrentSessions?: number;
  apiKeyExpirationDays?: number;
}

/** GET /v1/auth/sessions item (SessionResponseDto). */
interface BackendSession {
  id: string;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  ipHash: string | null;
  approximateLocation: string | null;
  userAgent: string | null;
  isCurrent: boolean;
  trusted: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

/** /v1/security/api-keys record. The secret is only present on creation. */
interface BackendApiKey {
  id: string;
  name: string;
  keyId: string;
  scopes: string[];
  state: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  secret?: string;
}

/** GET /v1/security/policy (effective tenant policy). */
interface BackendSecurityPolicy {
  mfaRequired: boolean;
  sessionIdleTimeoutSec: number;
  passwordMinLength: number;
  maxConcurrentSessions?: number;
  apiKeyExpirationDays?: number;
}

export function toSession(raw: BackendSession): Session {
  return {
    id: raw.id,
    deviceId: raw.deviceId,
    device: raw.deviceName ?? raw.platform ?? undefined,
    platform: raw.platform ?? undefined,
    location: raw.approximateLocation ?? undefined,
    userAgent: raw.userAgent ?? undefined,
    trusted: raw.trusted,
    lastActiveAt: raw.lastSeenAt,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    isCurrent: raw.isCurrent,
  };
}

/** One entry per device: the backend records a session per sign-in on a device. */
export function devicesFromSessions(sessions: readonly Session[]): Device[] {
  const byDevice = new Map<string, Device>();
  for (const session of sessions) {
    const key = session.deviceId ?? session.id;
    const existing = byDevice.get(key);
    if (!existing) {
      byDevice.set(key, {
        id: key,
        fingerprint: key,
        name: session.device,
        platform: session.platform,
        trusted: session.trusted === true,
        isCurrent: session.isCurrent,
        sessionIds: [session.id],
        lastSeenAt: session.lastActiveAt,
        createdAt: session.createdAt,
      });
      continue;
    }
    existing.sessionIds.push(session.id);
    existing.trusted = existing.trusted || session.trusted === true;
    existing.isCurrent = existing.isCurrent || session.isCurrent;
    if (session.lastActiveAt > existing.lastSeenAt) existing.lastSeenAt = session.lastActiveAt;
    if (session.createdAt < existing.createdAt) existing.createdAt = session.createdAt;
  }
  return [...byDevice.values()].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

export function toApiKey(raw: BackendApiKey): ApiKey {
  return {
    id: raw.id,
    name: raw.name,
    prefix: raw.keyId,
    scopes: raw.scopes ?? [],
    state: raw.state,
    lastUsedAt: raw.lastUsedAt ?? undefined,
    expiresAt: raw.expiresAt ?? undefined,
    revokedAt: raw.revokedAt ?? undefined,
    createdAt: raw.createdAt,
  };
}

async function listSessions(): Promise<Session[]> {
  const rows = await apiClient.get<BackendSession[]>('/v1/auth/sessions');
  return (rows ?? []).filter((row) => !row.revokedAt).map(toSession);
}

export const securityApi = {
  getMfaStatus: async (): Promise<MfaStatus> => {
    const me = await apiClient.get<{ twoFactorEnabled: boolean }>('/v1/auth/me');
    return { enabled: me.twoFactorEnabled === true, method: me.twoFactorEnabled ? 'TOTP' : undefined };
  },

  enrollMfa: (password: string): Promise<MfaEnrollResponse> => authApi.mfaEnroll(password),

  verifyMfaEnroll: (code: string) => authApi.mfaVerifyEnroll(code),

  disableMfa: (data: { password: string; code?: string; recoveryCode?: string }) => authApi.mfaDisable(data),

  listSessions,

  revokeSession: (id: string) => apiClient.delete<void>(`/v1/auth/sessions/${encodeURIComponent(id)}`),

  revokeAllOtherSessions: () => apiClient.post<{ revoked: number }>('/v1/auth/sessions/revoke-others'),

  listDevices: async (): Promise<Device[]> => devicesFromSessions(await listSessions()),

  /** Signing a device out ends every session it holds. */
  revokeDevice: async (device: Pick<Device, 'sessionIds'>): Promise<void> => {
    for (const sessionId of device.sessionIds) {
      await apiClient.delete<void>(`/v1/auth/sessions/${encodeURIComponent(sessionId)}`);
    }
  },

  listApiKeys: async (): Promise<ApiKey[]> => {
    const page = await apiClient.get<{ data: BackendApiKey[]; total: number }>('/v1/security/api-keys');
    return (page?.data ?? []).map(toApiKey);
  },

  /** `scopes` are permission keys the caller holds, e.g. 'portfolio:read'. */
  createApiKey: async (data: { name: string; scopes: string[]; expiresAt?: string }): Promise<ApiKeyCreated> => {
    const raw = await apiClient.post<BackendApiKey>('/v1/security/api-keys', {
      name: data.name,
      scopes: data.scopes,
      ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
    });
    return { ...toApiKey(raw), secret: raw.secret ?? '' };
  },

  revokeApiKey: (id: string, reason?: string) =>
    apiClient.post<{ id: string; state: string }>(`/v1/security/api-keys/${encodeURIComponent(id)}/revoke`, {
      ...(reason ? { reason } : {}),
    }),

  getSecurityPolicy: async (): Promise<SecurityPolicy> => {
    const raw = await apiClient.get<BackendSecurityPolicy>('/v1/security/policy');
    return {
      mfaRequired: raw.mfaRequired,
      sessionTimeoutMinutes: Math.round((raw.sessionIdleTimeoutSec ?? 0) / 60),
      passwordPolicy: { minLength: raw.passwordMinLength, requireUppercase: true, requireNumbers: true },
      maxConcurrentSessions: raw.maxConcurrentSessions,
      apiKeyExpirationDays: raw.apiKeyExpirationDays,
    };
  },
};
