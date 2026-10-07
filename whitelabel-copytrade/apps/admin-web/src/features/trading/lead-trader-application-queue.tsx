// # Responsibility: lets tenant-authorized operators inspect declarations, claim applications, and record auditable decisions.
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

export type AdminApplicationStatus = 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface AdminLeadTraderApplication {
  id: string;
  traderId: string;
  applicantUserId: string | null;
  reviewerUserId: string | null;
  status: AdminApplicationStatus;
  version: number;
  declaration: {
    yearsExperience?: number;
    markets?: string[];
    strategySummary?: string;
    evidenceReferences?: string[];
    riskAcknowledged?: boolean;
  };
  submittedAt: string;
  reviewedAt: string | null;
  decisionReason: string | null;
}

interface QueueResponse {
  data: AdminLeadTraderApplication[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_TONES: Record<AdminApplicationStatus, 'warning' | 'info' | 'success' | 'danger'> = {
  SUBMITTED: 'warning',
  IN_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
};

function parseQueueResponse(input: unknown): QueueResponse {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Application queue returned an invalid response.');
  }
  const root = input as Record<string, unknown>;
  if (!Array.isArray(root.data)) throw new Error('Application queue did not contain a data list.');
  const rows = root.data.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
  const data: AdminLeadTraderApplication[] = rows.map((row) => {
    const declaration = row.declaration && typeof row.declaration === 'object' && !Array.isArray(row.declaration)
      ? row.declaration as AdminLeadTraderApplication['declaration']
      : {};
    const status = row.status;
    if (status !== 'SUBMITTED' && status !== 'IN_REVIEW' && status !== 'APPROVED' && status !== 'REJECTED') {
      throw new Error('Application queue returned an unknown review status.');
    }
    if (typeof row.id !== 'string' || typeof row.traderId !== 'string' || typeof row.submittedAt !== 'string') {
      throw new Error('Application queue row is missing its tenant-scoped identifiers.');
    }
    return {
      id: row.id,
      traderId: row.traderId,
      applicantUserId: typeof row.applicantUserId === 'string' ? row.applicantUserId : null,
      reviewerUserId: typeof row.reviewerUserId === 'string' ? row.reviewerUserId : null,
      status,
      version: typeof row.version === 'number' ? row.version : 1,
      declaration,
      submittedAt: row.submittedAt,
      reviewedAt: typeof row.reviewedAt === 'string' ? row.reviewedAt : null,
      decisionReason: typeof row.decisionReason === 'string' ? row.decisionReason : null,
    };
  });
  return {
    data,
    total: typeof root.total === 'number' ? root.total : data.length,
    page: typeof root.page === 'number' ? root.page : 1,
    limit: typeof root.limit === 'number' ? root.limit : data.length,
  };
}

export function LeadTraderApplicationQueue({ initialQueue }: { initialQueue: QueueResponse }): JSX.Element {
  const [queue, setQueue] = useState(initialQueue);
  const [filter, setFilter] = useState<AdminApplicationStatus | 'ACTIVE'>('ACTIVE');
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const params = filter === 'ACTIVE' ? {} : { status: filter };
    const raw = await apiClient.get<unknown>('/copy-trading/lead-trader-applications/admin', {
      searchParams: { ...params, page: 1, limit: 50 },
    });
    setQueue(parseQueueResponse(raw));
  }, [filter]);

  useEffect(() => {
    let active = true;
    void apiClient.get<unknown>('/copy-trading/lead-trader-applications/admin', {
      searchParams: { ...(filter === 'ACTIVE' ? {} : { status: filter }), page: 1, limit: 50 },
    }).then((raw) => {
      if (active) setQueue(parseQueueResponse(raw));
    }).catch((error: unknown) => {
      if (active) setErrorMessage(error instanceof ApiError ? error.message : 'Could not refresh the application queue.');
    });
    return () => { active = false; };
  }, [filter]);

  const runAction = async (applicationId: string, action: 'claim' | 'approve' | 'reject') => {
    setPendingApplicationId(applicationId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (action === 'claim') {
        await apiClient.post(`/copy-trading/lead-trader-applications/${encodeURIComponent(applicationId)}/start-review`);
        setStatusMessage('Application claimed for review.');
      } else {
        const reason = decisionReasons[applicationId]?.trim() ?? '';
        if (action === 'reject' && reason.length < 20) {
          setErrorMessage('A rejection reason of at least 20 characters is required.');
          return;
        }
        await apiClient.post(`/copy-trading/lead-trader-applications/${encodeURIComponent(applicationId)}/decision`, {
          decision: action === 'approve' ? 'APPROVE' : 'REJECT',
          ...(reason ? { decisionReason: reason } : {}),
        });
        setStatusMessage(`Application ${action === 'approve' ? 'approved' : 'rejected'}; the decision has been recorded.`);
      }
      await loadQueue();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'The application action failed. Verify your tenant role and current review assignment.');
    } finally {
      setPendingApplicationId(null);
    }
  };

  const rows = queue.data;
  return (
    <div data-testid="lead-trader-application-queue" style={{ display: 'grid', gap: theme.space(4) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(3) }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: theme.space(2), fontSize: 13 }}>
          Application status
          <select aria-label="Filter application status" value={filter} onChange={(event) => setFilter(event.target.value as AdminApplicationStatus | 'ACTIVE')} style={{ padding: '6px 8px' }}>
            <option value="ACTIVE">Active review queue</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="IN_REVIEW">In review</option>
            <option value="APPROVED">Approved history</option>
            <option value="REJECTED">Rejected history</option>
          </select>
        </label>
        <span style={{ color: theme.color.textMuted, fontSize: 12 }}>{queue.total} application{queue.total === 1 ? '' : 's'} in this result</span>
      </div>

      {errorMessage && <p role="alert" style={{ margin: 0, color: 'var(--wlct-color-danger)', fontSize: 13 }}>{errorMessage}</p>}
      {statusMessage && <p role="status" style={{ margin: 0, fontSize: 13 }}>{statusMessage}</p>}

      {rows.length === 0 ? (
        <div style={{ border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.md, padding: theme.space(6), color: theme.color.textMuted, fontSize: 13 }}>
          No applications match this status. Queue counts reflect persisted application records only.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: theme.space(3) }}>
          {rows.map((application) => {
            const declaration = application.declaration;
            const isPending = pendingApplicationId === application.id;
            return (
              <article key={application.id} style={{ border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.md, padding: theme.space(4), display: 'grid', gap: theme.space(3) }}>
                <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(3) }}>
                  <div>
                    <strong>Application version {application.version}</strong>
                    <div style={{ color: theme.color.textMuted, fontSize: 11, marginTop: 3 }}>Trader {application.traderId} · Applicant {application.applicantUserId ?? 'deleted account'} · Submitted {new Date(application.submittedAt).toLocaleString()}</div>
                  </div>
                  <Badge tone={STATUS_TONES[application.status]}>{application.status.replace('_', ' ')}</Badge>
                </header>

                <dl style={{ margin: 0, display: 'grid', gap: theme.space(2), fontSize: 13 }}>
                  <div><dt style={{ color: theme.color.textMuted }}>Experience / markets</dt><dd style={{ margin: '3px 0 0' }}>{declaration.yearsExperience ?? 'Not stated'} years · {(declaration.markets ?? []).join(', ') || 'No market selected'}</dd></div>
                  <div><dt style={{ color: theme.color.textMuted }}>Strategy and risk summary</dt><dd style={{ margin: '3px 0 0', whiteSpace: 'pre-wrap' }}>{declaration.strategySummary ?? 'No summary supplied'}</dd></div>
                  <div><dt style={{ color: theme.color.textMuted }}>Evidence reference IDs</dt><dd style={{ margin: '3px 0 0' }}>{(declaration.evidenceReferences ?? []).join(', ') || 'None supplied'} · IDs are not verification evidence by themselves.</dd></div>
                  <div><dt style={{ color: theme.color.textMuted }}>Risk disclosure</dt><dd style={{ margin: '3px 0 0' }}>{declaration.riskAcknowledged === true ? 'Acknowledged' : 'Not acknowledged'}</dd></div>
                </dl>

                {application.decisionReason && <p style={{ margin: 0, fontSize: 13 }}><strong>Recorded decision reason: </strong>{application.decisionReason}</p>}
                {application.status === 'SUBMITTED' && (
                  <button type="button" disabled={isPending || pendingApplicationId !== null} onClick={() => void runAction(application.id, 'claim')} style={{ width: 'fit-content', padding: '7px 12px' }}>
                    {isPending ? 'Claiming…' : 'Claim for review'}
                  </button>
                )}
                {application.status === 'IN_REVIEW' && (
                  <div style={{ display: 'grid', gap: theme.space(2) }}>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      Decision reason (required for rejection; 20–1000 characters)
                      <textarea maxLength={1000} rows={3} value={decisionReasons[application.id] ?? ''} onChange={(event) => setDecisionReasons((current) => ({ ...current, [application.id]: event.target.value }))} />
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(2) }}>
                      <button type="button" disabled={isPending || pendingApplicationId !== null} onClick={() => void runAction(application.id, 'approve')} style={{ padding: '7px 12px' }}>Approve</button>
                      <button type="button" disabled={isPending || pendingApplicationId !== null} onClick={() => void runAction(application.id, 'reject')} style={{ padding: '7px 12px' }}>Reject</button>
                    </div>
                    {application.reviewerUserId && <p style={{ margin: 0, color: theme.color.textMuted, fontSize: 11 }}>Claimed by reviewer {application.reviewerUserId}; only the claimant can decide this application.</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
