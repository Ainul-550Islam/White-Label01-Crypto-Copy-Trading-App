// # NEW — Displays case evidence, screening hits, notes, and approve/reject/escalate actions
// # NEW — evidence, notes, decision, escalation UI
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { AmlScreeningPanel, type AmlScreeningMatch } from './aml-screening-panel';
import {
  ComplianceAuditTimeline,
  type ComplianceAuditTimelineEvent,
} from './compliance-audit-timeline';

export interface ComplianceCaseEvidenceItem {
  id: string;
  evidenceType: string;
  referenceId: string;
  referenceType: string;
  safeDescription: string;
  addedBy: string | null;
  createdAt: string;
}

export interface ComplianceCaseNoteItem {
  id: string;
  safeNote: string;
  authorId: string | null;
  createdAt: string;
}

export interface ComplianceCaseRecord {
  id: string;
  tenantId: string;
  userId: string;
  caseType: string;
  state: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  severity: string;
  safeSummary: string;
  assignedTo: string | null;
  jurisdiction: string | null;
  ruleIds?: string[];
  evidence?: ComplianceCaseEvidenceItem[];
  notes?: ComplianceCaseNoteItem[];
  screeningMatches?: AmlScreeningMatch[];
  auditEvents?: ComplianceAuditTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceCaseDetailProps {
  caseRecord: ComplianceCaseRecord;
}

export function validateComplianceDecisionRationale(rationale: string): {
  valid: boolean;
  error?: string;
} {
  if (!rationale || rationale.trim().length < 10) {
    return {
      valid: false,
      error: 'Compliance review decisions require a rationale of at least 10 characters.',
    };
  }
  return { valid: true };
}

export function ComplianceCaseDetail({ caseRecord }: ComplianceCaseDetailProps): JSX.Element {
  const router = useRouter();
  const [noteText, setNoteText] = useState<string>('');
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | 'HOLD' | 'ESCALATE'>('APPROVE');
  const [rationale, setRationale] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (noteText.trim().length < 5) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post(`/compliance/cases/${caseRecord.id}/notes`, {
          safeNote: noteText.trim(),
        });
        setNoteText('');
        setStatusMessage('Case note saved and audited.');
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError ? err.message : (err as Error).message || 'Failed to add note.',
        );
      }
    });
  };

  const handleSubmitDecision = (e: React.FormEvent) => {
    e.preventDefault();
    if (rationale.trim().length < 10) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        if (decision === 'ESCALATE') {
          await apiClient.post(`/compliance/cases/${caseRecord.id}/escalate`, {
            reason: rationale.trim(),
          });
        } else {
          await apiClient.post(`/compliance/cases/${caseRecord.id}/decision`, {
            decision,
            reason: rationale.trim(),
          });
        }
        setRationale('');
        setStatusMessage(`Case decision (${decision}) recorded with immutable audit entry.`);
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError
            ? err.message
            : (err as Error).message || 'Failed to record case decision.',
        );
      }
    });
  };

  return (
    <div data-testid="compliance-case-detail" style={{ display: 'grid', gap: theme.space(5) }}>
      {errorMessage && (
        <p role="alert" style={{ color: 'var(--wlct-color-danger)', fontSize: 13, margin: 0 }}>
          {errorMessage}
        </p>
      )}
      {statusMessage && (
        <p role="status" style={{ fontSize: 13, margin: 0 }}>
          {statusMessage}
        </p>
      )}

      <Card
        title={`Case ${caseRecord.id} · ${caseRecord.caseType}`}
        description={caseRecord.safeSummary}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: theme.space(3),
            fontSize: 13,
          }}
        >
          <div>
            <strong>Status:</strong> <Badge tone="info">{caseRecord.state}</Badge>
          </div>
          <div>
            <strong>Risk / Severity:</strong>{' '}
            <Badge tone="danger">
              {caseRecord.riskLevel} · {caseRecord.severity}
            </Badge>
          </div>
          <div>
            <strong>Subject User:</strong> <code>{caseRecord.userId}</code>
          </div>
          <div>
            <strong>Assigned Reviewer:</strong> {caseRecord.assignedTo ?? 'Unassigned'}
          </div>
          <div>
            <strong>Jurisdiction:</strong> {caseRecord.jurisdiction ?? 'GLOBAL'}
          </div>
          <div>
            <strong>Opened:</strong> {formatDateTime(caseRecord.createdAt)}
          </div>
        </div>
      </Card>

      {/* AML / Sanctions Screening Panel */}
      <AmlScreeningPanel
        userId={caseRecord.userId}
        providerReference={`case-${caseRecord.id}`}
        screeningStatus={caseRecord.state}
        matches={caseRecord.screeningMatches ?? []}
      />

      {/* Evidence & Notes */}
      <Card
        title="Case Evidence & Reviewer Notes"
        description="PII-safe case evidence links and reviewer annotations."
      >
        <div style={{ display: 'grid', gap: theme.space(4) }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Evidence Items</div>
            {(caseRecord.evidence ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: theme.color.textMuted }}>
                No external evidence attachments linked yet.
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {(caseRecord.evidence ?? []).map((ev) => (
                  <li key={ev.id}>
                    <strong>{ev.evidenceType}</strong> ({ev.referenceType}:{ev.referenceId}) —{' '}
                    {ev.safeDescription}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Reviewer Notes</div>
            {(caseRecord.notes ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: theme.color.textMuted }}>
                No reviewer notes recorded yet.
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {(caseRecord.notes ?? []).map((n) => (
                  <li key={n.id}>
                    {n.safeNote} — <em>{n.authorId ?? 'Reviewer'}</em> ({formatDateTime(n.createdAt)})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleAddNote} style={{ display: 'flex', gap: 8 }}>
            <input
              aria-label="Add case note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add PII-safe reviewer note (min 5 chars)..."
              style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
            />
            <button
              type="submit"
              disabled={pending || noteText.trim().length < 5}
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              Add Note
            </button>
          </form>
        </div>
      </Card>

      {/* Approve / Reject / Hold / Escalate Decision Form */}
      <Card
        title="Compliance Review Decision"
        description="Every compliance decision requires a mandatory rationale and writes an immutable audit event."
      >
        <form
          onSubmit={handleSubmitDecision}
          data-testid="compliance-decision-form"
          style={{ display: 'grid', gap: theme.space(3) }}
        >
          <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              Decision Action:{' '}
              <select
                aria-label="Decision action"
                value={decision}
                onChange={(e) =>
                  setDecision(e.target.value as 'APPROVE' | 'REJECT' | 'HOLD' | 'ESCALATE')
                }
                style={{ fontSize: 12, padding: '6px 8px', marginLeft: 6 }}
              >
                <option value="APPROVE">APPROVE (Clear Restrictions)</option>
                <option value="REJECT">REJECT (Enforce Account Block)</option>
                <option value="HOLD">HOLD (Freeze Withdrawals)</option>
                <option value="ESCALATE">ESCALATE (Senior MLRO Review)</option>
              </select>
            </label>
          </div>
          <label style={{ fontSize: 12 }}>
            Mandatory Rationale (min 10 chars)
            <textarea
              aria-label="Decision rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              placeholder="Document the regulatory and factual basis for this decision..."
              style={{ width: '100%', fontSize: 12, padding: '6px 8px', marginTop: 4 }}
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={pending || rationale.trim().length < 10}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.color.border}`,
                cursor: 'pointer',
              }}
            >
              {pending ? 'Recording…' : `Submit ${decision} Decision`}
            </button>
          </div>
        </form>
      </Card>

      {/* Chronological Compliance Audit Timeline */}
      <Card
        title="Compliance Audit Timeline"
        description="Chronological immutable audit log for this case."
      >
        <ComplianceAuditTimeline events={caseRecord.auditEvents ?? []} />
      </Card>
    </div>
  );
}

export default ComplianceCaseDetail;
