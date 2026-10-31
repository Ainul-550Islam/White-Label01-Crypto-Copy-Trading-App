// # Responsibility: the operator console for profit-share statements — generates a statement for a follower/trader pair and period from posted ledger entries, shows the ledger-derived lines, and finalizes a draft behind a step-up proof minted at submit time.
'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  asStatements,
  isValidPeriod,
  isUuid,
  profitShareStatementAdminApi,
  type ProfitShareStatement,
} from '@/api/profit-share-statement-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { addAmounts, formatAmount } from '@/features/shared/money';
import { StepUpDialog } from '@/features/developer/step-up-dialog';

/**
 * Profit-share statements.
 *
 * Every number on this screen comes from `billing_ledger_entries`: the API derives
 * `grossProfit`, `profitShareAmount` and each line from POSTED entries and stores
 * them as decimal strings. This console formats those strings and sums NOTHING —
 * `addAmounts` is used only to check that the lines add up to the stated fee, and a
 * mismatch is reported as a warning rather than corrected, because a console that
 * "fixes" a ledger total in the browser is the worst possible place to disagree
 * with the ledger.
 *
 * There is no admin list route, so the screen works from what the two admin routes
 * return. An empty result is a real answer: the period had no posted performance
 * fees, and the screen says exactly that instead of showing an empty table.
 */
type FieldName = 'followerUserId' | 'traderUserId' | 'periodStart' | 'periodEnd';

interface GeneratedResult {
  statements: ProfitShareStatement[];
  /** True when the API answered with an empty array: no posted performance fees. */
  empty: boolean;
}

function localDayToIso(value: string, endOfDay: boolean): string {
  // A `date` input is a local calendar day. The period's end is exclusive, so it is
  // sent as the start of the following day rather than 23:59:59, which would drop
  // a fee posted in the last second.
  const date = new Date(`${value}T${endOfDay ? '00:00:00' : '00:00:00'}`);
  if (!Number.isFinite(date.getTime())) return '';
  if (endOfDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function ProfitShareStatementAdminConsole(): JSX.Element {
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [generated, setGenerated] = useState<GeneratedResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{
    kind: 'generate' | 'finalize';
    input: { followerUserId: string; traderUserId: string; periodStart: string; periodEnd: string; correction?: boolean } | { statementId: string };
    key: string;
  } | null>(null);
  const [verificationError, setVerificationError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError('');
    setMessage('');
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const followerUserId = String(data.get('followerUserId') ?? '').trim();
    const traderUserId = String(data.get('traderUserId') ?? '').trim();
    const startDay = String(data.get('periodStart') ?? '').trim();
    const endDay = String(data.get('periodEnd') ?? '').trim();
    const correction = data.get('correction') === 'on';

    const periodStart = startDay ? localDayToIso(startDay, false) : '';
    const periodEnd = endDay ? localDayToIso(endDay, false) : '';

    const next: Partial<Record<FieldName, string>> = {};
    if (!isUuid(followerUserId)) next.followerUserId = 'Enter the follower user id (a UUID).';
    if (!isUuid(traderUserId)) next.traderUserId = 'Enter the trader user id (a UUID).';
    if (!startDay) next.periodStart = 'Choose the first day of the period.';
    if (!endDay) next.periodEnd = 'Choose the day after the last day of the period.';
    if (!next.periodStart && !next.periodEnd && !isValidPeriod(periodStart, periodEnd)) {
      next.periodEnd = 'The period end must be after its start.';
    }

    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending({
      kind: 'generate',
      input: { followerUserId, traderUserId, periodStart, periodEnd, correction },
      key: crypto.randomUUID(),
    });
  }

  function requestFinalize(statement: ProfitShareStatement): void {
    setError('');
    setMessage('');
    setPending({ kind: 'finalize', input: { statementId: statement.id }, key: crypto.randomUUID() });
  }

  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setVerificationError('');
    try {
      await profitShareStatementAdminApi.requestStepUp(method, value, crypto.randomUUID());
    } catch {
      setVerificationError('Verification was not accepted. Try again.');
      setBusy(false);
      return;
    }

    const intent = pending;
    setPending(null);
    try {
      if (intent.kind === 'generate') {
        const input = intent.input as { followerUserId: string; traderUserId: string; periodStart: string; periodEnd: string; correction?: boolean };
        const answer = await profitShareStatementAdminApi.generate(input, intent.key);
        const statements = asStatements(answer);
        setGenerated({ statements, empty: statements.length === 0 });
        setMessage(
          statements.length === 0
            ? 'No posted performance fees fall in that period, so no statement was created. That is a result, not a failure.'
            : `Generated and finalized ${statements.length} statement(s).`,
        );
      } else {
        const input = intent.input as { statementId: string };
        const finalized = await profitShareStatementAdminApi.finalize(input.statementId, intent.key);
        setGenerated((current) =>
          current === null
            ? current
            : { ...current, statements: current.statements.map((row) => (row.id === finalized.id ? finalized : row)) },
        );
        setMessage('The statement is finalized. Finalized amounts are immutable; a correction creates a new version.');
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(caught.message);
      } else if (caught instanceof ApiError && caught.status === 422) {
        const mapped: Partial<Record<FieldName, string>> = {};
        for (const detail of caught.details ?? []) {
          if (detail.field === 'followerUserId' || detail.field === 'traderUserId' || detail.field === 'periodStart' || detail.field === 'periodEnd') {
            mapped[detail.field] = detail.message;
          }
        }
        setFieldErrors(mapped);
        if (Object.keys(mapped).length === 0) setError(caught.message);
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError('Generating or finalizing a statement requires a platform administrator and a fresh verification.');
      } else {
        setError('The statement was not generated. No finalized statement was created.');
      }
    } finally {
      setBusy(false);
    }
  }

  const statements = generated?.statements ?? [];

  return (
    <div style={{ display: 'grid', gap: theme.space(4) }}>
      <Card
        title="Generate a statement"
        description="Statements are built only from SETTLED performance-fee accruals and their POSTED ledger entries. A period with no posted fees produces no statement."
      >
        <form onSubmit={submit} aria-label="Generate a profit-share statement" style={{ display: 'grid', gap: theme.space(3), maxWidth: 560 }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Follower user id
            <input
              name="followerUserId"
              required
              placeholder="00000000-0000-4000-8000-000000000000"
              disabled={busy}
              aria-invalid={fieldErrors.followerUserId ? true : undefined}
              aria-describedby={fieldErrors.followerUserId ? 'statement-follower-error' : undefined}
            />
          </label>
          {fieldErrors.followerUserId && (
            <p id="statement-follower-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.followerUserId}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Trader user id
            <input
              name="traderUserId"
              required
              placeholder="00000000-0000-4000-8000-000000000000"
              disabled={busy}
              aria-invalid={fieldErrors.traderUserId ? true : undefined}
              aria-describedby={fieldErrors.traderUserId ? 'statement-trader-error' : undefined}
            />
          </label>
          {fieldErrors.traderUserId && (
            <p id="statement-trader-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.traderUserId}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            First day of the period
            <input
              name="periodStart"
              type="date"
              required
              disabled={busy}
              aria-invalid={fieldErrors.periodStart ? true : undefined}
              aria-describedby={fieldErrors.periodStart ? 'statement-start-error' : undefined}
            />
          </label>
          {fieldErrors.periodStart && (
            <p id="statement-start-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.periodStart}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Day after the last day
            <input
              name="periodEnd"
              type="date"
              required
              disabled={busy}
              aria-invalid={fieldErrors.periodEnd ? true : undefined}
              aria-describedby={fieldErrors.periodEnd ? 'statement-end-error' : 'statement-end-hint'}
            />
          </label>
          <p id="statement-end-hint" style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
            The end of a period is exclusive, so this day is not billed. A fee posted during it belongs to the next statement.
          </p>
          {fieldErrors.periodEnd && (
            <p id="statement-end-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.periodEnd}</p>
          )}

          <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
            <input name="correction" type="checkbox" disabled={busy} />
            This is a correction of an already-finalized period
          </label>

          <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
          {error && <ErrorNotice title="Statement not generated" message={error} />}

          <div>
            <button type="submit" disabled={busy}>{busy ? 'Working…' : 'Generate and finalize'}</button>
          </div>
        </form>
      </Card>

      <Card title="Generated statements" description="Amounts are copied from the posted ledger lines that produced them. Finalized amounts are immutable.">
        {generated === null && (
          <EmptyState
            title="Nothing generated yet"
            description="Generate a statement above. Only statements produced during this session are listed: the API exposes no platform-wide statement list."
          />
        )}
        {generated?.empty && (
          <EmptyState
            title="No posted performance fees in that period"
            description="Nothing was accrued and settled with a posted ledger entry, so no statement exists for it. Widen the period or check the pair."
          />
        )}
        {statements.map((statement) => {
          const lineTotal = addAmounts((statement.lines ?? []).map((line) => line.feeAmount));
          const matches = lineTotal === null ? null : lineTotal === statement.profitShareAmount;
          return (
            <div key={statement.id} style={{ display: 'grid', gap: theme.space(3), marginBottom: theme.space(5) }}>
              <div style={{ display: 'grid', gap: theme.space(3), gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                <StatTile label="Status" value={<Badge tone={toneForStatus(statement.status)}>{statement.status}</Badge>} />
                <StatTile label="Version" value={String(statement.version)} />
                <StatTile label="Currency" value={statement.currency} />
                <StatTile label="Gross profit" value={formatAmount(statement.grossProfit, { symbol: statement.currency })} />
                <StatTile label="Profit share" value={formatAmount(statement.profitShareAmount, { symbol: statement.currency })} />
                <StatTile label="High-water mark" value={formatAmount(statement.highWaterMark, { symbol: statement.currency })} />
                <StatTile label="Period" value={`${formatDateTime(statement.periodStart)} → ${formatDateTime(statement.periodEnd)}`} hint="The end is exclusive." />
              </div>

              {matches === false && (
                <ErrorNotice
                  title="Statement lines do not add up to the stated fee"
                  message="The lines shown are the ones the API derived from posted ledger entries, and they do not sum to the statement total. Do not treat this statement as verified; raise it before it is used for billing."
                />
              )}

              {(statement.lines ?? []).length > 0 ? (
                <DataTable
                  rows={statement.lines ?? []}
                  rowKey={(line) => line.id}
                  columns={[
                    { key: 'ledger', header: 'Ledger entry', render: (line) => line.sourceLedgerId },
                    { key: 'profit', header: 'Profit', render: (line) => formatAmount(line.profitAmount, { symbol: line.currency }) },
                    { key: 'fee', header: 'Fee', render: (line) => formatAmount(line.feeAmount, { symbol: line.currency }) },
                    { key: 'posted', header: 'Posted', render: (line) => formatDateTime(line.postedAt) },
                  ]}
                />
              ) : (
                <EmptyState title="No ledger lines" description="This statement was created without any posted ledger lines to show." />
              )}

              <div style={{ display: 'flex', gap: theme.space(2) }}>
                <button
                  type="button"
                  disabled={busy || statement.status !== 'DRAFT'}
                  onClick={() => requestFinalize(statement)}
                >
                  Finalize statement
                </button>
                <span style={{ fontSize: 12, color: theme.color.textMuted }}>
                  {statement.status === 'DRAFT'
                    ? 'Finalizing locks the amounts permanently.'
                    : 'Only a draft statement can be finalized.'}
                </span>
              </div>
            </div>
          );
        })}
      </Card>

      {pending && (
        <StepUpDialog
          description={
            pending.kind === 'generate'
              ? 'Generating a statement finalizes ledger-derived amounts for a billing period. Verify to continue.'
              : 'Finalizing a statement makes its amounts immutable. Verify to continue.'
          }
          busy={busy}
          error={verificationError}
          onCancel={() => { setPending(null); setVerificationError(''); }}
          onVerify={verify}
        />
      )}
    </div>
  );
}
