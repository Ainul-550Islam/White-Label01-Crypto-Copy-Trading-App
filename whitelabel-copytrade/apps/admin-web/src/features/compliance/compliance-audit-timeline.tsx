// # NEW — Renders chronological compliance audit timeline
// # NEW — immutable audit timeline component
'use client';
import type { JSX } from 'react';

import React from 'react';
import { Badge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';

export interface ComplianceAuditTimelineEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  decision?: string | null;
  rationale?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface ComplianceAuditTimelineProps {
  events: ComplianceAuditTimelineEvent[];
}

export function sortComplianceAuditEventsChronologically(
  events: ReadonlyArray<ComplianceAuditTimelineEvent>,
): ComplianceAuditTimelineEvent[] {
  return [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function ComplianceAuditTimeline({ events }: ComplianceAuditTimelineProps): JSX.Element {
  const sorted = sortComplianceAuditEventsChronologically(events);

  return (
    <div data-testid="compliance-audit-timeline" style={{ display: 'grid', gap: theme.space(3) }}>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 13, color: theme.color.textMuted }}>
          No compliance audit events recorded yet.
        </div>
      ) : (
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gap: theme.space(3),
          }}
        >
          {sorted.map((ev) => (
            <li
              key={ev.id}
              data-testid={`compliance-audit-event-${ev.id}`}
              style={{
                borderLeft: `3px solid ${theme.color.border}`,
                paddingLeft: theme.space(3),
                display: 'grid',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Badge tone="neutral">{ev.eventType}</Badge>
                {ev.decision && <Badge tone="info">{ev.decision}</Badge>}
                <span style={{ fontSize: 12, color: theme.color.textMuted }}>
                  {formatDateTime(ev.createdAt)} · Actor: <code>{ev.actorId ?? 'SYSTEM'}</code>
                </span>
              </div>
              {ev.rationale && (
                <div style={{ fontSize: 13 }}>
                  <strong>Rationale:</strong> {ev.rationale}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default ComplianceAuditTimeline;
