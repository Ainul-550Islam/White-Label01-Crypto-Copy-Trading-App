'use client';

import { useState, useTransition, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { ApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

/**
 * The client-side controls of the SLO console. Their complete power, stated
 * so nobody has to read the API to know what a click can do:
 *
 * - EVALUATE ALL / EVALUATE NOW re-runs the measurement. They append rows to
 *   the evidence log and may fold burn alerts; they change no trading state.
 * - FLUSH EXPORTS runs one tick of the OTLP exporter early. It changes WHEN
 *   evidence leaves the process, never WHAT it says, and against a dead
 *   collector it fails exactly once and reports it, same as the loop.
 * - PUBLISH VERSION appends a NEW definition version. Old versions stay
 *   queryable forever; publishing the identical definition is a no-op with
 *   no phantom version; the action is audited with before/after fields. The
 *   objective is typed as a STRING ("99.5") end to end - floats are refused
 *   by the API on purpose because a promise that has been through IEEE-754
 *   is not the promise anyone configured.
 *
 * There is deliberately NO control here for arming or disarming fault
 * injection, editing a stored version, deleting evidence, or pruning
 * history: the first is environment-only and the rest do not exist as
 * routes at all. No optimistic states on any control - the panel shows what
 * the server said, after the server said it.
 */

const buttonStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
};

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  background: 'transparent',
  color: 'inherit',
  width: '100%',
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--wlct-color-text-muted)',
  display: 'block',
  marginBottom: 2,
};

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return (error as Error).message || 'The request could not be completed.';
}

interface EvaluateResult {
  evaluated: number;
  alertingSloIds: string[];
  skipped?: Array<{ sloId: string; error: string }>;
}

function postAndRefresh<T>(path: string, body?: unknown): Promise<T> {
  return apiClient.post<T>(path, body);
}

export function EvaluateAllButton(): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (): void => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<EvaluateResult>('/operational/slos/evaluate-all');
        setResult(
          `evaluated ${String(out.evaluated)};` +
            (out.alertingSloIds.length > 0 ? ` paging: ${out.alertingSloIds.join(', ')}` : ' nothing paging') +
            (out.skipped && out.skipped.length > 0 ? `; skipped: ${out.skipped.map((s) => s.sloId).join(', ')}` : ''),
        );
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {result !== null && <span style={{ fontSize: 12 }}>{result}</span>}
      {error !== null && (
        <span style={{ fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</span>
      )}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? 'Evaluating…' : 'Evaluate all now'}
      </button>
    </span>
  );
}

export function RunNowButton({ sloId }: { sloId: string }): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (): void => {
    setMessage(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<EvaluateResult>(
          `/operational/slos/${encodeURIComponent(sloId)}/evaluate`,
        );
        setMessage(
          out.evaluated === 0
            ? 'skipped (disabled?)'
            : out.alertingSloIds.length > 0
              ? 'evaluated: paging'
              : 'evaluated',
        );
        router.refresh();
      } catch (caught) {
        setMessage(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {message !== null && <span style={{ fontSize: 12 }}>{message}</span>}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? '…' : 'Evaluate now'}
      </button>
    </span>
  );
}

export function FlushExportButton(): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (): void => {
    setMessage(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<{ exported: number; outcome: string }>(
          '/operational/tracing/flush',
        );
        setMessage(`exported ${String(out.exported)} · ${out.outcome}`);
        router.refresh();
      } catch (caught) {
        setMessage(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {message !== null && <span style={{ fontSize: 12 }}>{message}</span>}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? 'Flushing…' : 'Run export tick'}
      </button>
    </span>
  );
}

interface DefinitionLike {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
}

const FRESHNESS_INDICATORS = new Set([
  'market_data_freshness',
  'risk_state_freshness',
  'queue_freshness',
  'reconciliation_freshness',
]);

const OBJECTIVE_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function SloConfigForm({ definition }: { definition: DefinitionLike }): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [objective, setObjective] = useState(definition.objective);
  const [windowMinutes, setWindowMinutes] = useState(String(definition.windowMinutes));
  const [shortWindowMinutes, setShortWindowMinutes] = useState(String(definition.shortWindowMinutes));
  const [owner, setOwner] = useState(definition.owner);
  const [description, setDescription] = useState(definition.description);
  const [goodEvent, setGoodEvent] = useState(definition.goodEvent);
  const [badEvent, setBadEvent] = useState(definition.badEvent);
  const [warningBurnPpm, setWarningBurnPpm] = useState(String(definition.warningBurnPpm));
  const [criticalBurnPpm, setCriticalBurnPpm] = useState(String(definition.criticalBurnPpm));
  const [maxAgeMicros, setMaxAgeMicros] = useState(definition.maxAgeMicros ?? '');
  const [latencyThresholdMicros, setLatencyThresholdMicros] = useState(
    definition.latencyThresholdMicros ?? '',
  );
  const [enabled, setEnabled] = useState(definition.enabled);

  const fresh = FRESHNESS_INDICATORS.has(definition.indicator);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    setNote(null);

    // Client-side mirrors of the server rules, to stop obvious fumbles
    // before a round trip. The server remains the authority; nothing here
    // is trusted past this form.
    if (!OBJECTIVE_RE.test(objective.trim())) {
      setError('Objective must be a decimal string with at most 4 fraction digits (e.g. "99.5").');
      return;
    }
    const body: Record<string, unknown> = {
      objective: objective.trim(),
      windowMinutes: Number(windowMinutes),
      shortWindowMinutes: Number(shortWindowMinutes),
      owner: owner.trim(),
      description: description.trim(),
      goodEvent: goodEvent.trim(),
      badEvent: badEvent.trim(),
      warningBurnPpm: Number(warningBurnPpm),
      criticalBurnPpm: Number(criticalBurnPpm),
      enabled,
    };
    if (fresh && maxAgeMicros.trim() !== '') {
      body.maxAgeMicros = maxAgeMicros.trim();
    }
    if (definition.indicator === 'latency_threshold_compliance' && latencyThresholdMicros.trim() !== '') {
      body.latencyThresholdMicros = latencyThresholdMicros.trim();
    }
    if (fresh && maxAgeMicros.trim() === '') {
      setError('This freshness objective requires an age budget (maxAgeMicros).');
      return;
    }

    startTransition(async () => {
      try {
        // publishConfig answers with the full status view - the version and
        // checksum live on its `definition`. A byte-identical publish is a
        // no-op answered with the CURRENT status, so the note says
        // "at version" rather than claiming a bump that did not happen.
        const out = await postAndRefresh<{ definition: { version: number; checksum: string } }>(
          `/operational/slos/${encodeURIComponent(definition.sloId)}/config`,
          body,
        );
        const bumped = out.definition.version > definition.version;
        setNote(
          `${bumped ? 'Published' : 'No-op (identical definition), still at'} v${String(
            out.definition.version,
          )} · checksum ${out.definition.checksum.slice(0, 12)}…`,
        );
        setOpen(false);
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  if (!open) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {note !== null && <span style={{ fontSize: 12 }}>{note}</span>}
        {error !== null && (
          <span style={{ fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</span>
        )}
        <button type="button" style={buttonStyle} onClick={() => setOpen(true)}>
          Publish version
        </button>
      </span>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        marginTop: theme.space(2),
        padding: theme.space(3),
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        display: 'grid',
        gap: theme.space(2),
        minWidth: 320,
      }}
    >
      <p style={{ fontSize: 12, margin: 0, color: 'var(--wlct-color-text-muted)' }}>
        Appends v{String(definition.version + 1)} for <strong>{definition.sloId}</strong>. This
        cannot rewrite history, only extend it. The API may answer with the SAME version if the
        definition is byte-identical (no phantom versions).
      </p>
      <label>
        <span style={labelStyle}>Objective (percent string)</span>
        <input style={inputStyle} value={objective} onChange={(e) => setObjective(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Window (minutes, 5–10080)</span>
          <input style={inputStyle} inputMode="numeric" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Short window (minutes)</span>
          <input style={inputStyle} inputMode="numeric" value={shortWindowMinutes} onChange={(e) => setShortWindowMinutes(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Warning burn (ppm)</span>
          <input style={inputStyle} inputMode="numeric" value={warningBurnPpm} onChange={(e) => setWarningBurnPpm(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Critical burn (ppm)</span>
          <input style={inputStyle} inputMode="numeric" value={criticalBurnPpm} onChange={(e) => setCriticalBurnPpm(e.target.value)} />
        </label>
      </div>
      <label>
        <span style={labelStyle}>Owner</span>
        <input style={inputStyle} value={owner} onChange={(e) => setOwner(e.target.value)} />
      </label>
      <label>
        <span style={labelStyle}>Description</span>
        <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Good event (counting rule, in words)</span>
          <input style={inputStyle} value={goodEvent} onChange={(e) => setGoodEvent(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Bad event (counting rule, in words)</span>
          <input style={inputStyle} value={badEvent} onChange={(e) => setBadEvent(e.target.value)} />
        </label>
      </div>
      {fresh && (
        <label>
          <span style={labelStyle}>Max age (microseconds, required for freshness)</span>
          <input style={inputStyle} inputMode="numeric" value={maxAgeMicros} onChange={(e) => setMaxAgeMicros(e.target.value)} />
        </label>
      )}
      {definition.indicator === 'latency_threshold_compliance' && (
        <label>
          <span style={labelStyle}>Latency threshold (microseconds)</span>
          <input
            style={inputStyle}
            inputMode="numeric"
            value={latencyThresholdMicros}
            onChange={(e) => setLatencyThresholdMicros(e.target.value)}
          />
        </label>
      )}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span style={{ fontSize: 13 }}>Evaluation enabled</span>
      </label>
      {error !== null && (
        <p style={{ fontSize: 12, color: 'var(--wlct-color-danger)', margin: 0 }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={buttonStyle} onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" style={buttonStyle} disabled={pending}>
          {pending ? 'Publishing…' : 'Publish version'}
        </button>
      </div>
    </form>
  );
}
