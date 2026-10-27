import { assertStepUpProof } from './step-up-proof';
// # Responsibility: provides the Batch 04 client API integration for this interface.
// # Typed administrative API methods for audit exports, retention, branding, feature flags, abuse reviews, KPI, and readiness routes.
import { apiClient } from '@/lib/api-client';

export interface AuditExportFilters {
  actorId?: string;
  actionType?: string;
  subjectUserId?: string;
  entityType?: 'REQUEST' | 'REPORT' | 'EVIDENCE_PACKAGE' | 'LEGAL_HOLD' | 'RETENTION_CANDIDATE' | 'CONSENT';
  entityId?: string;
  outcome?: string;
}

export interface AuditExportResult {
  id: string;
  tenantId: string;
  fileHash: string;
  fileContents: string;
  recordCount: number;
  filtersApplied: AuditExportFilters;
  manifest: { format: string; sha256: string; rowCount: number; chainTip: string; tenantId: string; periodStart: string; periodEndExclusive: string; filters: AuditExportFilters };
}

export interface TenantContextResponse { id: string; tenantId?: string; name?: string; }
export interface SetTenantFlag { key: string; enabled: boolean; rolloutPercentage?: number; metadata?: Record<string, unknown>; }
export interface TenantFeatureFlagRow { key: string; enabled: boolean; rolloutPercentage: number | null; metadata: Record<string, unknown>; }
export interface AuditExportQueued { id: string; tenantId: string; status: 'QUEUED'; statusPath: string; submittedAt: string; }
export interface AuditExportJobState { id: string; tenantId: string; state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown'; result?: AuditExportResult; failureReason?: string; }

async function setTenantFlag(payload: SetTenantFlag, idempotencyKey: string): Promise<void> {
  const result = await apiClient.put<unknown>('/v1/feature-flags', payload, { idempotencyKey });
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid feature flag response');
  const row = result as Record<string, unknown>;
  if (row.key !== payload.key || row.enabled !== payload.enabled ||
      (payload.rolloutPercentage !== undefined && row.rolloutPercentage !== payload.rolloutPercentage)) {
    throw new Error('Invalid feature flag response');
  }
}

export const businessAdminApi = {
  currentTenant: () => apiClient.get<TenantContextResponse>('/v1/tenants/current'),
  currentActor: () => apiClient.get<{ id: string; userId?: string }>('/v1/users/me'),
  createAuditExport: (request: { tenantId: string; periodStart: string; periodEnd: string; correlationId: string; operatorId: string; filters: AuditExportFilters }, idempotencyKey: string) =>
    apiClient.post<AuditExportResult | AuditExportQueued>('/v1/governance/audit/export', request, { idempotencyKey }),
  verifyAuditExport: async (method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string) => {
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', { action: 'AUDIT_EXPORT', method, ...(method === 'TOTP' ? { code: value } : method === 'PASSWORD' ? { password: value } : { recoveryCode: value }) }, { idempotencyKey });
    assertStepUpProof(proof, 'AUDIT_EXPORT', method);
  },
  getAuditExportJob: (jobId: string) => apiClient.get<AuditExportJobState>(`/v1/governance/audit/export/${encodeURIComponent(jobId)}`),
  getRetentionPolicies: (jurisdiction: string) => apiClient.get<unknown[]>('/v1/governance/retention/policies', { searchParams: { jurisdiction } }),
  updateTenantBranding: (payload: Record<string, string | null>) => apiClient.patch<unknown>('/v1/tenants/current/branding', payload),
  getTenantFeatureFlags: () => apiClient.get<TenantFeatureFlagRow[]>('/v1/feature-flags'),
  setTenantFeatureFlag: setTenantFlag,
  setTenantLiveFeatureFlag: setTenantFlag,
  verifyStepUp: async (payload: { method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE'; action: 'FEATURE_FLAG_LIVE_TOGGLE'; code?: string; password?: string; recoveryCode?: string }, idempotencyKey: string) => {
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, payload.action, payload.method);
  },
  listReferralAbuseCases: () => apiClient.get<unknown[]>('/v1/partner/referral-abuse/reviews'),
  resolveReferralAbuseCase: (caseId: string, decision: 'APPROVE' | 'REJECT', note: string, correlationId: string) =>
    apiClient.post(`/v1/partner/referral-abuse/reviews/${encodeURIComponent(caseId)}/decision`, { decision, note, correlationId }),
  getBusinessKpis: () => apiClient.get<unknown>('/v1/admin/analytics/kpi'),
  getCommercialReadiness: () => apiClient.get<unknown>('/v1/admin/ops/commercial-readiness'),
};
