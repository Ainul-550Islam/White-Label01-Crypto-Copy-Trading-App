'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

/**
 * The two controls the risk console is allowed to carry.
 *
 * Splitting them out as one small client island keeps the rule visible in
 * the code, not just the docs: this file can engage a stop, acknowledge a
 * trigger, and clear a switch. It cannot edit a limit, submit, cancel or
 * approve an order, and it holds no data beyond what the server page hands
 * it. Every action posts to the API and reloads the server-rendered panels;
 * there is no optimistic switch state anywhere, because a green tick that
 * the engine has not seen yet is the one lie this screen must never tell.
 *
 * The clear form asks for the typed confirmation phrase and a >=20-character
 * reason because the API demands exactly that, not as decoration: an operator
 * who cannot be bothered to type the phrase is an operator telling the system
 * they should not be clearing the protection yet.
 */

export interface SwitchRow {
  id: string;
  scope: string;
  target: string | null;
  isEngaged: boolean;
  status: string;
  requiresExplicitClear: boolean;
}

const CLEAR_PHRASE = 'CLEAR RISK PROTECTION';

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

// -----------------------------------------------------------------------------
// Engage
// -----------------------------------------------------------------------------

export function RiskSwitchControls({
  accounts,
}: {
  accounts: Array<{ id: string; label: string }>;
}): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'ACCOUNT' | 'STRATEGY' | 'SYMBOL'>('ACCOUNT');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    setError(null);
    setNote(null);
    startTransition(async () => {
      try {
        await apiClient.post('/risk/kill-switches/engage', {
          scope,
          target: target.trim(),
          reason: reason.trim(),
        });
        setNote('Switch engaged. The engine applies it on its next sync; the durable row is already in force.');
        setReason('');
        setTarget('');
        setOpen(false);
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: theme.space(2) }}>
      <button type="button" style={dangerButtonStyle} onClick={() => setOpen((v) => !v)}>
        {open ? 'Cancel' : 'Engage a stop'}
      </button>
      {note && (
        <span style={{ fontSize: 12, color: 'var(--wlct-color-success, inherit)' }}>{note}</span>
      )}
      {open && (
        <div
          style={{
            display: 'grid',
            gap: theme.space(2),
            width: 360,
            padding: theme.space(3),
            border: `1px solid ${theme.color.border}`,
            borderRadius: theme.radius.md,
            textAlign: 'left',
          }}
        >
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Scope
            <select
              style={inputStyle}
              value={scope}
              onChange={(event) => {
                setScope(event.target.value as 'ACCOUNT' | 'STRATEGY' | 'SYMBOL');
                setTarget('');
              }}
            >
              <option value="ACCOUNT">ACCOUNT - halt one trading account</option>
              <option value="STRATEGY">STRATEGY - halt one strategy instance</option>
              <option value="SYMBOL">SYMBOL - halt one symbol for the org</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Target
            {scope === 'ACCOUNT' ? (
              <select style={inputStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">choose an account…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            ) : (
              <input
                style={inputStyle}
                value={target}
                placeholder={scope === 'SYMBOL' ? 'e.g. BTC-USDT' : 'strategy id (uuid)'}
                onChange={(e) => setTarget(e.target.value)}
              />
            )}
          </label>
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Reason (at least 10 characters, audited)
            <textarea
              style={{ ...inputStyle, minHeight: 64 }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</p>}
          <button
            type="button"
            style={dangerButtonStyle}
            disabled={pending || target.trim() === '' || reason.trim().length < 10}
            onClick={submit}
          >
            {pending ? 'Engaging…' : 'Engage switch'}
          </button>
          <p style={{ margin: 0, fontSize: 11, color: theme.color.textMuted }}>
            Engaging halts new risk in scope for every strategy attached to it. Risk-reducing
            orders keep flowing by design - a halt that traps positions open is a worse failure
            than a halt.
          </p>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Per-row acknowledge / clear
// -----------------------------------------------------------------------------

export function RiskSwitchRowActions({ row }: { row: SwitchRow }): JSX.Element {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'ack' | 'clear'>('none');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!row.isEngaged) {
    return <span style={{ fontSize: 12, color: theme.color.textMuted }}>—</span>;
  }

  const close = (): void => {
    setMode('none');
    setReason('');
    setConfirm('');
    setError(null);
  };

  const run = (path: string, body: Record<string, string>): void => {
    setError(null);
    startTransition(async () => {
      try {
        await apiClient.post(path, body);
        close();
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  if (mode === 'none') {
    return (
      <span style={{ display: 'inline-flex', gap: theme.space(2) }}>
        {row.status === 'TRIGGERED' && (
          <button type="button" style={buttonStyle} onClick={() => setMode('ack')}>
            Acknowledge
          </button>
        )}
        <button type="button" style={buttonStyle} onClick={() => setMode('clear')}>
          Clear…
        </button>
      </span>
    );
  }

  const reasonReady = reason.trim().length >= (mode === 'ack' ? 10 : 20);
  const clearReady = mode === 'ack' || confirm === CLEAR_PHRASE;

  return (
    <div style={{ display: 'grid', gap: theme.space(1), minWidth: 260, textAlign: 'left' }}>
      <Badge tone={mode === 'clear' ? 'warning' : 'info'}>
        {mode === 'ack'
          ? 'Acknowledge: what did you review?'
          : row.requiresExplicitClear
            ? 'Clear: this ends an automatic halt'
            : 'Clear: this releases a manual halt'}
      </Badge>
      <textarea
        style={{ ...inputStyle, minHeight: 48 }}
        placeholder={
          mode === 'ack'
            ? 'min 10 chars - what was checked'
            : 'min 20 chars - why the halt can end now'
        }
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mode === 'clear' && (
        <input
          style={inputStyle}
          placeholder={`type exactly: ${CLEAR_PHRASE}`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      )}
      {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</p>}
      <span style={{ display: 'inline-flex', gap: theme.space(2) }}>
        <button
          type="button"
          style={dangerButtonStyle}
          disabled={pending || !reasonReady || !clearReady}
          onClick={() =>
            run(
              `/risk/kill-switches/${row.id}/${mode === 'ack' ? 'acknowledge' : 'clear'}`,
              mode === 'ack' ? { reason: reason.trim() } : { reason: reason.trim(), confirm },
            )
          }
        >
          {pending ? 'Working…' : mode === 'ack' ? 'Record acknowledgement' : 'Clear switch'}
        </button>
        <button type="button" style={buttonStyle} onClick={close}>
          Cancel
        </button>
      </span>
      {mode === 'clear' && row.requiresExplicitClear && row.status === 'TRIGGERED' && (
        <p style={{ margin: 0, fontSize: 11, color: theme.color.textMuted }}>
          The API will refuse a clear until this switch is acknowledged first - there is no
          single-step path from an engine trip back to trading.
        </p>
      )}
    </div>
  );
}
