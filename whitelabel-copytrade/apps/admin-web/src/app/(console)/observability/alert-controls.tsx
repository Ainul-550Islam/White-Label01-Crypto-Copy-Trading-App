'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

/**
 * The only two controls this console is allowed to carry: acknowledge an
 * open alert, and (with ceremony) force-resolve one.
 *
 * Their meaning, stated where an operator clicks: ACKNOWLEDGE records "a
 * human has this" and changes nothing else - the alert stays as open as the
 * condition that raised it, and the gate table above the buttons keeps
 * saying NOT READY while the cause persists. FORCE-RESOLVE closes the
 * operational record despite the publisher still observing the condition;
 * it exists for the rare "the venue says it is fixed, our feed disagrees"
 * mornings, and it demands the typed phrase plus a 20-character reason
 * because it is the one button on this page that dismisses evidence.
 *
 * No optimistic state: both actions post to the API and reload the
 * server-rendered panels. A button that greys out before the server said
 * "accepted" would be the alert-panel equivalent of the trade button that
 * lies, and this platform already refused to build one of those.
 */

const FORCE_RESOLVE_PHRASE = 'FORCE RESOLVE ALERT';

interface AlertRow {
  id: string;
  state: string;
  title: string;
}

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  background: 'transparent',
  color: 'inherit',
  width: '100%',
};

const buttonStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: 'var(--wlct-color-danger)',
  color: 'var(--wlct-color-danger)',
};

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return (error as Error).message || 'The request could not be completed.';
}

export function AlertControls({ alert }: { alert: AlertRow }): JSX.Element {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'ack' | 'force'>('none');
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = (): void => {
    setMode('none');
    setReason('');
    setPhrase('');
    setError(null);
  };

  const submit = (): void => {
    const path =
      mode === 'ack' ? `/observability/alerts/${alert.id}/acknowledge` : `/observability/alerts/${alert.id}/force-resolve`;
    const body = mode === 'ack' ? { reason } : { reason, confirmPhrase: phrase };
    startTransition(async () => {
      setError(null);
      try {
        await apiClient.post(path, body);
        close();
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  if (alert.state === 'RESOLVED') {
    return <Badge tone="neutral">resolved</Badge>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {alert.state === 'OPEN' ? (
          <button type="button" style={buttonStyle} onClick={() => setMode('ack')} disabled={pending}>
            Acknowledge
          </button>
        ) : null}
        <button type="button" style={dangerButtonStyle} onClick={() => setMode('force')} disabled={pending}>
          Force-resolve
        </button>
      </div>

      {mode !== 'none' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.md }}
        >
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {mode === 'ack'
              ? 'Acknowledge: records who has it. Does not resolve the alert or change any trading state.'
              : `Force-resolve: close WITHOUT an observed recovery. Type "${FORCE_RESOLVE_PHRASE}" and give the reason.`}
          </div>
          <input
            style={inputStyle}
            placeholder={mode === 'ack' ? 'Who/what is on it (min 5 chars)' : 'Why this may close now (min 20 chars)'}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
          />
          {mode === 'force' ? (
            <input
              style={inputStyle}
              placeholder={FORCE_RESOLVE_PHRASE}
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              maxLength={64}
            />
          ) : null}
          {error ? (
            <div style={{ color: 'var(--wlct-color-danger)', fontSize: 12 }} role="alert">
              {error}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" style={buttonStyle} disabled={pending}>
              {pending ? 'Submitting...' : 'Confirm'}
            </button>
            <button type="button" style={buttonStyle} onClick={close} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
