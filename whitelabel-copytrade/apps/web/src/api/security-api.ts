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

/**
 * Step-up: the second factor for a single sensitive action.
 *
 * A step-up proof is bound to (session, action) and is single-use, so it cannot be
 * hoarded: the dialog asks for a code, receives a proof, and the very next request
 * for that action consumes it. Anything else - retrying the request first, keeping
 * the proof for later, reusing it for a second action - is refused by the API, and
 * the dialog surfaces that refusal rather than looping.
 */
export type StepUpMethod = 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE';

export interface StepUpProof {
  proofId: string;
  action: string;
  method: StepUpMethod;
  expiresAt: string;
  ttlSeconds: number;
}

export interface StepUpProofInput {
  action: string;
  method: StepUpMethod;
  code?: string;
  password?: string;
  recoveryCode?: string;
}

/** True when an API error is the 403 that means "prove it is you, then retry". */
export function isStepUpRequired(error: unknown): boolean {
  const candidate = error as { status?: number; code?: string; body?: { code?: string } } | null;
  if (!candidate) return false;
  const code = candidate.code ?? candidate.body?.code;
  return code === 'STEP_UP_REQUIRED' || (candidate.status === 403 && String(code ?? '').includes('STEP_UP'));
}

export const stepUpApi = {
  issue: (input: StepUpProofInput): Promise<StepUpProof> =>
    apiClient.post<StepUpProof>('/v1/auth/step-up', {
      action: input.action,
      method: input.method,
      ...(input.code ? { code: input.code } : {}),
      ...(input.password ? { password: input.password } : {}),
      ...(input.recoveryCode ? { recoveryCode: input.recoveryCode } : {}),
    }),

  status: (action: string): Promise<{ fresh: boolean; action: string | null; expiresAt: string | null }> =>
    apiClient.get<{ fresh: boolean; action: string | null; expiresAt: string | null }>('/v1/auth/step-up/status', {
      searchParams: { action },
    }),
};

/**
 * Withdrawal destinations: the customer's own address allowlist.
 *
 * `status` is the authority on whether an address may receive funds. A PENDING
 * address is NOT usable, and the UI must show the countdown rather than a
 * disabled checkbox the customer cannot explain.
 */
export type WithdrawalDestinationStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface WithdrawalDestination {
  id: string;
  network: string;
  address: string;
  label: string;
  status: WithdrawalDestinationStatus;
  activatesAt: string;
  revokedAt: string | null;
  createdAt: string;
  remainingCooldownMs: number;
}

export interface WithdrawalDestinationMutation {
  ok: boolean;
  code: string;
  message: string;
  destination?: WithdrawalDestination;
  remainingCooldownMs?: number | null;
}

export const withdrawalDestinationApi = {
  list: async (): Promise<WithdrawalDestination[]> => {
    const page = await apiClient.get<{ data: WithdrawalDestination[]; total: number }>('/v1/custody/destinations');
    return page?.data ?? [];
  },

  /** Requires a fresh step-up proof for PAYOUT_CREATE; call stepUpApi.issue first. */
  add: (input: { network: string; address: string; label: string }): Promise<WithdrawalDestinationMutation> =>
    apiClient.post<WithdrawalDestinationMutation>('/v1/custody/destinations', input),

  revoke: (id: string, reason?: string): Promise<WithdrawalDestinationMutation> =>
    apiClient.delete<WithdrawalDestinationMutation>(`/v1/custody/destinations/${encodeURIComponent(id)}`, {
      ...(reason ? { body: { reason } } : {}),
    }),
};

/**
 * Account recovery. These three calls are the public flow, so they must work
 * without a session: `skipAuthRefresh` keeps a 401 (or a 429) from triggering a
 * refresh loop on a signed-out browser.
 */
export interface RecoveryRequestResponse {
  accepted: true;
  message: string;
  deliveryQueued: boolean;
}

export interface RecoveryVerifyResponse {
  valid: boolean;
  reason: string | null;
  message: string;
}

export interface RecoveryCompleteResponse {
  status: string;
  reason: string | null;
  message: string;
  sessionsRevoked: number;
  requiresTwoFactorEnrolment: boolean;
}

export const accountRecoveryApi = {
  request: (email: string): Promise<RecoveryRequestResponse> =>
    apiClient.post<RecoveryRequestResponse>('/v1/auth/recovery/request', { email }, { skipAuthRefresh: true }),

  verify: (token: string): Promise<RecoveryVerifyResponse> =>
    apiClient.post<RecoveryVerifyResponse>('/v1/auth/recovery/verify', { token }, { skipAuthRefresh: true }),

  complete: (token: string, newPassword: string): Promise<RecoveryCompleteResponse> =>
    apiClient.post<RecoveryCompleteResponse>(
      '/v1/auth/recovery/complete',
      { token, newPassword },
      { skipAuthRefresh: true },
    ),
};
