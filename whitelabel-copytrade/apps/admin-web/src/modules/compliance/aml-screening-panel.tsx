// # NEW — Displays screening match details and disposition controls
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { theme } from '@/lib/theme';

export interface AmlScreeningMatch {
  id: string;
  listName: string;
  matchCategory: 'SANCTIONS' | 'PEP' | 'WATCHLIST' | 'ADVERSE_MEDIA';
  confidenceScore: number;
  matchedEntityLabel: string;
  jurisdiction?: string | null;
  disposition: 'PENDING_REVIEW' | 'TRUE_MATCH' | 'FALSE_POSITIVE' | 'ESCALATED';
}

export interface AmlScreeningPanelProps {
  userId: string;
  providerReference?: string | null;
  screeningStatus: string;
  matches: AmlScreeningMatch[];
}

export function AmlScreeningPanel({
  userId,
  providerReference,
  screeningStatus,
  matches,
}: AmlScreeningPanelProps): JSX.Element {
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleRescreen = () => {
    if (!providerReference) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post(`/compliance/aml/rescreen/${providerReference}`, {
          userId,
        });
        setStatusMessage('AML/Sanctions rescreen request submitted.');
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError ? err.message : (err as Error).message || 'AML rescreen failed.',
        );
      }
    });
  };

  return (
    <div
      data-testid="aml-screening-panel"
      style={{
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        padding: theme.space(4),
        display: 'grid',
        gap: theme.space(3),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            AML / Sanctions / PEP Screening Status: <Badge tone="info">{screeningStatus}</Badge>
          </div>
          <div style={{ fontSize: 12, color: theme.color.textMuted, marginTop: 2 }}>
            Subject User: <code>{userId}</code> · Provider Ref:{' '}
            <code>{providerReference ?? 'NONE'}</code>
          </div>
        </div>
        {providerReference && (
          <button
            type="button"
            disabled={pending}
            onClick={handleRescreen}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: theme.radius.md,
              border: `1px solid ${theme.color.border}`,
              cursor: 'pointer',
            }}
          >
            {pending ? 'Rescreening…' : 'Trigger AML Rescreen'}
          </button>
        )}
      </div>

      {errorMessage && (
        <p role="alert" style={{ color: 'var(--wlct-color-danger)', fontSize: 12, margin: 0 }}>
          {errorMessage}
        </p>
      )}
      {statusMessage && (
        <p role="status" style={{ fontSize: 12, margin: 0 }}>
          {statusMessage}
        </p>
      )}

      {matches.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.color.textMuted }}>
          No sanctions, PEP, or watchlist hits recorded for this subject.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: theme.space(2) }}>
          {matches.map((m) => (
            <div
              key={m.id}
              data-testid={`aml-match-${m.id}`}
              style={{
                padding: theme.space(3),
                border: `1px solid ${theme.color.border}`,
                borderRadius: theme.radius.sm,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {m.matchCategory} · {m.listName} ({m.confidenceScore}% confidence)
                </div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>
                  Matched Label: {m.matchedEntityLabel}
                  {m.jurisdiction ? ` · Jurisdiction: ${m.jurisdiction}` : ''}
                </div>
              </div>
              <Badge tone={m.disposition === 'TRUE_MATCH' ? 'danger' : 'warning'}>
                {m.disposition}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
