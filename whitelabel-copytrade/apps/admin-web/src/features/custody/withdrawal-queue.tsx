'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  custodyAdminApi,
  type CustodyTransaction,
  type WithdrawalEligibility,
} from '@/api/custody-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';

import { formatAmount, isPositiveAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';
import {
  SUBMIT_CONFIRMATION_PHRASE,
  describeEvaluationFailure,
  describeSubmitFailure,
  evaluationMatches,
  validateSubmission,
  type EvaluationSnapshot,
  type SubmissionInput,
} from './withdrawal-submit';

/**
 * The withdrawal queue and the two controls the API actually exposes.
 *
 * There is deliberately no approve / reject / hold button here. The service
 * layer defines DTOs for those decisions, but no route on custody.controller
 * serves them at this commit, and a button that posts to a route which does not
 * exist is a fake success state. What the API does provide, and what this page
 * therefore offers, is:
 *
 *   POST custody/withdrawals/evaluate  - would this withdrawal pass policy?
 *   POST custody/withdrawals/submit    - hand a reviewed withdrawal to the
 *                                        chain adapter (one-way; the proof of
 *                                        intent is a typed phrase plus a stable
 *                                        Idempotency-Key)
 *
 * The queue itself is read from custody/transactions filtered to OUTBOUND, which
 * is the same table the API's withdrawal orchestration writes to.
 */
export function WithdrawalQueue({ operatorId }: { operatorId: string }): JSX.Element {
  const queue = useResource(
    () => custodyAdminApi.listTransactions({ direction: 'OUTBOUND', limit: 25 }),
    [],
    { errorMessage: 'The withdrawal queue could not be loaded.' },
  );

  const [evaluationInput, setEvaluationInput] = useState({ walletId: '', assetId: '', networkId: '', amount: '', destinationAddress: '' });
  const [evaluation, setEvaluation] = useState<(WithdrawalEligibility & { snapshot: EvaluationSnapshot }) | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState('');
  const evaluationResultRef = useRef<HTMLDivElement>(null);

  const [submission, setSubmission] = useState<SubmissionInput>({ custodyWithdrawalId: '', operatorId, phrase: '' });
  const [submissionErrors, setSubmissionErrors] = useState<Partial<Record<keyof SubmissionInput, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitMessage, setSubmitMessage] = useState('');
  const submitStatusRef = useRef<HTMLParagraphElement>(null);
  const submissionKey = useRef<{ identity: string; key: string } | null>(null);

  useEffect(() => {
    if (evaluation || evaluationError) evaluationResultRef.current?.focus();
  }, [evaluation, evaluationError]);

  useEffect(() => {
    if (submitMessage || submitError) submitStatusRef.current?.focus();
  }, [submitMessage, submitError]);

  async function evaluate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setEvaluationError('');
    setEvaluation(null);

    const amount = evaluationInput.amount.trim();
    if (!isPositiveAmount(amount)) {
      setEvaluationError('Enter the withdrawal amount as a positive decimal, for example 250.00.');
      return;
    }
    if (!evaluationInput.assetId.trim() || !evaluationInput.networkId.trim() || !evaluationInput.destinationAddress.trim()) {
      setEvaluationError('Asset, network and destination address are all required for a policy result.');
      return;
    }

    setEvaluating(true);
    try {
      const result = await custodyAdminApi.evaluateWithdrawal(
        {
          assetId: evaluationInput.assetId.trim(),
          networkId: evaluationInput.networkId.trim(),
          amount,
          destinationAddress: evaluationInput.destinationAddress.trim(),
          walletId: evaluationInput.walletId.trim() || null,
          operatorId,
        },
        crypto.randomUUID(),
      );
      setEvaluation({
        ...result,
        snapshot: {
          assetId: evaluationInput.assetId.trim(),
          networkId: evaluationInput.networkId.trim(),
          amount,
          destinationAddress: evaluationInput.destinationAddress.trim(),
          eligible: result.eligible,
        },
      });
    } catch (caught) {
      setEvaluationError(describeEvaluationFailure(caught));
    } finally {
      setEvaluating(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitError('');
    setSubmitMessage('');

    const validation = validateSubmission(submission);
    setSubmissionErrors(validation.errors);
    if (!validation.ok) return;

    const identity = submission.custodyWithdrawalId.trim();
    // A retried submission of the same withdrawal reuses its key, so a timeout
    // that was actually accepted cannot submit the withdrawal twice.
    if (submissionKey.current?.identity !== identity) {
      submissionKey.current = { identity, key: crypto.randomUUID() };
    }

    setSubmitting(true);
    try {
      await custodyAdminApi.submitWithdrawal(
        { custodyWithdrawalId: identity, operatorId: submission.operatorId.trim() },
        submissionKey.current.key,
      );
      setSubmitMessage('The withdrawal was accepted for submission. Track its state in the queue below.');
      setSubmission({ custodyWithdrawalId: '', operatorId, phrase: '' });
      submissionKey.current = null;
      queue.reload();
    } catch (caught) {
      setSubmitError(describeSubmitFailure(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const rows = queue.data?.data ?? [];
  const currentEvaluation = evaluation && evaluationMatches(evaluation.snapshot, {
    assetId: evaluationInput.assetId.trim(),
    networkId: evaluationInput.networkId.trim(),
    amount: evaluationInput.amount.trim(),
    destinationAddress: evaluationInput.destinationAddress.trim(),
  });

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card
        title="Withdrawal queue"
        description="Outbound custody movements and their observation state. A withdrawal in CONFIRMING is on chain and cannot be recalled from here."
      >
        <WithdrawalQueueTable rows={rows} loading={queue.loading} error={queue.error} />
      </Card>

      <Card
        title="Policy evaluation"
        description="Ask the API whether a proposed withdrawal would pass policy for this organisation. This is a check, not an authorisation: it moves no funds."
      >
        <form onSubmit={(event) => void evaluate(event)} aria-label="Evaluate a withdrawal against policy" style={{ display: 'grid', gap: theme.space(3) }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3) }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Asset
              <input required value={evaluationInput.assetId} onChange={(event) => setEvaluationInput((current) => ({ ...current, assetId: event.target.value }))} disabled={evaluating} placeholder="USDT" />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Network
              <input required value={evaluationInput.networkId} onChange={(event) => setEvaluationInput((current) => ({ ...current, networkId: event.target.value }))} disabled={evaluating} placeholder="ethereum" />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Amount
              <input required inputMode="decimal" value={evaluationInput.amount} onChange={(event) => setEvaluationInput((current) => ({ ...current, amount: event.target.value }))} disabled={evaluating} placeholder="250.00" />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Wallet ID (optional)
              <input value={evaluationInput.walletId} onChange={(event) => setEvaluationInput((current) => ({ ...current, walletId: event.target.value }))} disabled={evaluating} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Destination address
              <input required value={evaluationInput.destinationAddress} onChange={(event) => setEvaluationInput((current) => ({ ...current, destinationAddress: event.target.value }))} disabled={evaluating} placeholder="0x…" />
            </label>
          </div>
          <div>
            <button type="submit" disabled={evaluating}>{evaluating ? 'Evaluating…' : 'Evaluate against policy'}</button>
          </div>
        </form>

        <div ref={evaluationResultRef} tabIndex={-1} aria-live="polite" style={{ marginTop: theme.space(4) }}>
          {evaluationError && <ErrorNotice title="Evaluation not completed" message={evaluationError} />}
          {evaluation && (
            <div style={{ display: 'grid', gap: theme.space(3) }}>
              <p style={{ margin: 0, fontSize: 14 }}>
                <Badge tone={evaluation.eligible ? 'success' : 'danger'}>{evaluation.eligible ? 'Eligible' : 'Not eligible'}</Badge>{' '}
                {evaluation.eligible
                  ? 'The policy checks passed for the values entered.'
                  : 'The policy refused this withdrawal. The blocking reasons below are the API’s own findings.'}
              </p>
              <DataTable
                rows={evaluation.checks}
                rowKey={(row) => row.check}
                emptyTitle="The API returned no checks"
                emptyDescription="Treat an empty result as unevaluated, not as approved."
                columns={[
                  { key: 'check', header: 'Check', render: (row) => row.check },
                  { key: 'passed', header: 'Result', render: (row) => <Badge tone={row.passed ? 'success' : 'danger'}>{row.passed ? 'Passed' : 'Failed'}</Badge> },
                  { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
                ]}
              />
              {evaluation.blockingReasons.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: theme.space(5), fontSize: 13, color: theme.color.danger }}>
                  {evaluation.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              {!currentEvaluation && evaluation.eligible && (
                <p role="note" style={{ margin: 0, fontSize: 13, color: theme.color.warning }}>
                  The values changed since this result was returned. Evaluate again before relying on it.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Submit a withdrawal for broadcast"
        description="Hands one reviewed custody withdrawal to the chain adapter. The API records the submission; it cannot be undone from the console."
      >
        <form onSubmit={(event) => void submit(event)} aria-label="Submit a custody withdrawal" style={{ display: 'grid', gap: theme.space(3) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, maxWidth: 420 }}>
            Custody withdrawal ID
            <input
              required
              value={submission.custodyWithdrawalId}
              onChange={(event) => setSubmission((current) => ({ ...current, custodyWithdrawalId: event.target.value }))}
              disabled={submitting}
              aria-invalid={submissionErrors.custodyWithdrawalId ? true : undefined}
              aria-describedby={submissionErrors.custodyWithdrawalId ? 'withdrawal-id-error' : undefined}
            />
          </label>
          {submissionErrors.custodyWithdrawalId && (
            <p id="withdrawal-id-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{submissionErrors.custodyWithdrawalId}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, maxWidth: 420 }}>
            {`Type ${SUBMIT_CONFIRMATION_PHRASE} to confirm`}
            <input
              required
              value={submission.phrase}
              onChange={(event) => setSubmission((current) => ({ ...current, phrase: event.target.value }))}
              disabled={submitting}
              aria-invalid={submissionErrors.phrase ? true : undefined}
              aria-describedby={submissionErrors.phrase ? 'withdrawal-phrase-error' : undefined}
            />
          </label>
          {submissionErrors.phrase && (
            <p id="withdrawal-phrase-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{submissionErrors.phrase}</p>
          )}
          {submissionErrors.operatorId && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{submissionErrors.operatorId}</p>
          )}

          <p ref={submitStatusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>
            {submitMessage}
          </p>
          {submitError && <ErrorNotice title="Submission not confirmed" message={submitError} />}

          <div>
            <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit withdrawal'}</button>
          </div>
        </form>

        {rows.length === 0 && queue.data && (
          <EmptyState title="Nothing awaiting submission" description="The queue is empty, so there is no withdrawal to hand to the chain adapter." />
        )}
      </Card>
    </div>
  );
}

/**
 * Pure view of the queue: no fetching, no state. Kept separate so the loading,
 * error and empty states are exercised directly by the tests rather than only
 * being reachable through a container that fires requests on mount.
 */
export function WithdrawalQueueTable({
  rows,
  loading,
  error,
}: {
  rows: CustodyTransaction[];
  loading: boolean;
  error: string | null;
}): JSX.Element {
  if (loading && rows.length === 0) {
    return <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading the withdrawal queue…</p>;
  }
  if (error) {
    return <ErrorNotice title="Withdrawal queue unavailable" message={error} />;
  }
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      emptyTitle="No withdrawals in the queue"
      emptyDescription="New withdrawal requests appear here once they reach the custody ledger."
      columns={[
        { key: 'id', header: 'Transaction', render: (row) => <code style={{ fontSize: 12 }}>{row.id.slice(0, 8)}</code> },
        { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.amount, { symbol: row.assetId }) },
        { key: 'network', header: 'Network', render: (row) => row.networkId },
        { key: 'confirmations', header: 'Confirmations', align: 'right', render: (row) => `${row.confirmationCount}/${row.requiredConfirmationCount}` },
        { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
        { key: 'created', header: 'Created', render: (row) => formatDateTime(row.createdAt) },
      ]}
    />
  );
}
