import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CustodyTransaction } from '@/api/custody-admin-api';
import {
  SUBMIT_CONFIRMATION_PHRASE,
  describeEvaluationFailure,
  describeSubmitFailure,
  evaluationMatches,
  validateSubmission,
  type EvaluationSnapshot,
} from '@/features/custody/withdrawal-submit';
import { WithdrawalQueueTable } from '@/features/custody/withdrawal-queue';
import { ApiError } from '@/lib/api-error';

const source = readFileSync(resolve(process.cwd(), 'src/features/custody/withdrawal-queue.tsx'), 'utf8');

function transaction(overrides: Partial<CustodyTransaction> = {}): CustodyTransaction {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: 'tenant-1',
    walletId: 'wallet-1',
    assetId: 'USDT',
    networkId: 'ethereum',
    direction: 'OUTBOUND',
    amount: '250.00',
    transactionHash: null,
    blockHash: null,
    blockNumber: null,
    providerReference: null,
    status: 'CONFIRMING',
    confirmationCount: 2,
    requiredConfirmationCount: 12,
    estimatedFee: '0.80',
    actualFee: null,
    feeAsset: 'USDT',
    feeReference: null,
    sourceWorkflowType: 'WITHDRAWAL',
    sourceWorkflowId: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:01:00.000Z',
    ...overrides,
  };
}

describe('withdrawal queue view states', () => {
  it('shows a live loading status before the first response', () => {
    const html = renderToStaticMarkup(<WithdrawalQueueTable rows={[]} loading error={null} />);

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Loading the withdrawal queue');
  });

  it('keeps the loaded rows visible while a refresh is in flight', () => {
    const html = renderToStaticMarkup(<WithdrawalQueueTable rows={[transaction()]} loading error={null} />);

    expect(html).not.toContain('Loading the withdrawal queue');
    expect(html).toContain('1111111');
  });

  it('renders the API error as an alert instead of an empty queue', () => {
    const html = renderToStaticMarkup(
      <WithdrawalQueueTable rows={[]} loading={false} error="The withdrawal queue could not be loaded." />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('The withdrawal queue could not be loaded.');
    expect(html).not.toContain('No withdrawals in the queue');
  });

  it('renders an explicit empty state rather than a blank table', () => {
    const html = renderToStaticMarkup(<WithdrawalQueueTable rows={[]} loading={false} error={null} />);

    expect(html).toContain('No withdrawals in the queue');
    expect(html).toContain('once they reach the custody ledger');
  });

  it('renders the amount as the API decimal string and the confirmation progress', () => {
    const html = renderToStaticMarkup(<WithdrawalQueueTable rows={[transaction()]} loading={false} error={null} />);

    expect(html).toContain('250.00 USDT');
    expect(html).toContain('2/12');
    expect(html).toContain('CONFIRMING');
    // A float conversion would have produced 250 or 250.0 here.
    expect(html).not.toContain('>250<');
  });

  it('renders an unavailable amount as unavailable rather than zero', () => {
    const html = renderToStaticMarkup(
      <WithdrawalQueueTable rows={[transaction({ amount: '' })]} loading={false} error={null} />,
    );

    expect(html).toContain('Unavailable');
    expect(html).not.toContain('>0<');
  });
});

describe('submission validation', () => {
  const valid = { custodyWithdrawalId: '11111111-1111-1111-1111-111111111111', operatorId: 'op-1', phrase: SUBMIT_CONFIRMATION_PHRASE };

  it('accepts a well-formed submission', () => {
    expect(validateSubmission(valid)).toEqual({ ok: true, errors: {} });
  });

  it('refuses an empty or non-UUID withdrawal id', () => {
    expect(validateSubmission({ ...valid, custodyWithdrawalId: '' }).errors.custodyWithdrawalId).toContain('Enter the custody withdrawal ID');
    expect(validateSubmission({ ...valid, custodyWithdrawalId: '0xabc' }).errors.custodyWithdrawalId).toContain('exactly as shown');
  });

  it('refuses a missing operator identity instead of sending an empty one', () => {
    expect(validateSubmission({ ...valid, operatorId: '   ' }).ok).toBe(false);
  });

  it('requires the exact typed confirmation phrase', () => {
    expect(validateSubmission({ ...valid, phrase: 'submit withdrawal' }).errors.phrase).toContain(SUBMIT_CONFIRMATION_PHRASE);
    expect(validateSubmission({ ...valid, phrase: '' }).ok).toBe(false);
  });

  it('reports every problem at once, not just the first', () => {
    const result = validateSubmission({ custodyWithdrawalId: '', operatorId: '', phrase: 'nope' });

    expect(Object.keys(result.errors).sort()).toEqual(['custodyWithdrawalId', 'operatorId', 'phrase']);
  });
});

describe('backend error mapping', () => {
  it('names the permission problem for 403 without leaking the server text', () => {
    const message = describeSubmitFailure(new ApiError(403, 'FORBIDDEN', 'Guard rejected'));

    expect(message).toBe('You do not have permission to submit withdrawals for this organisation.');
    expect(message).not.toContain('Guard rejected');
  });

  it('distinguishes a missing withdrawal from a wrong-state withdrawal', () => {
    expect(describeSubmitFailure(new ApiError(404, 'NOT_FOUND', 'No withdrawal'))).toContain('does not exist for this organisation');
    expect(describeSubmitFailure(new ApiError(409, 'INVALID_STATE', 'State'))).toContain('not in a state that can be submitted');
  });

  it('uses the API explanation for a refused body and keeps it human', () => {
    expect(describeSubmitFailure(new ApiError(422, 'VALIDATION_ERROR', 'Amount exceeds the single withdrawal limit'))).toBe(
      'Amount exceeds the single withdrawal limit',
    );
  });

  it('falls back to "not confirmed" copy for an unknown failure, never a raw throw', () => {
    const message = describeSubmitFailure(new Error('ECONNRESET at 10.0.0.4:443'));

    expect(message).toContain('could not be submitted');
    expect(message).not.toContain('ECONNRESET');
  });

  it('treats an evaluation failure as unevaluated, not approved', () => {
    expect(describeEvaluationFailure(new Error('timeout'))).toContain('unevaluated, not as approved');
    expect(describeEvaluationFailure(new ApiError(403, 'FORBIDDEN', 'x'))).toContain('permission');
  });
});

describe('policy evaluation freshness', () => {
  const snapshot: EvaluationSnapshot = {
    assetId: 'USDT',
    networkId: 'ethereum',
    amount: '250.00',
    destinationAddress: '0xabc',
    eligible: true,
  };

  it('matches only when every evaluated value is still on screen', () => {
    expect(evaluationMatches(snapshot, { assetId: 'USDT', networkId: 'ethereum', amount: '250.00', destinationAddress: '0xabc' })).toBe(true);
    expect(evaluationMatches(snapshot, { assetId: 'USDT', networkId: 'ethereum', amount: '2500.00', destinationAddress: '0xabc' })).toBe(false);
    expect(evaluationMatches(snapshot, { assetId: 'USDT', networkId: 'ethereum', amount: '250.00', destinationAddress: '0xdef' })).toBe(false);
  });

  it('never matches an ineligible result or a missing one', () => {
    expect(evaluationMatches({ ...snapshot, eligible: false }, { assetId: 'USDT', networkId: 'ethereum', amount: '250.00', destinationAddress: '0xabc' })).toBe(false);
    expect(evaluationMatches(null, { assetId: 'USDT', networkId: 'ethereum', amount: '250.00', destinationAddress: '0xabc' })).toBe(false);
  });
});

describe('withdrawal queue wiring', () => {
  it('sends an idempotency key with the submission and reuses it for a retry of the same withdrawal', () => {
    expect(source).toContain('custodyAdminApi.submitWithdrawal');
    expect(source).toContain('submissionKey.current.key');
    expect(source).toContain('crypto.randomUUID()');
    // The key must be scoped to the withdrawal id so a different withdrawal gets a new one.
    expect(source).toMatch(/submissionKey\.current\?\.identity !== identity/);
  });

  it('validates before sending and maps the failure through the shared classifier', () => {
    expect(source).toContain('const validation = validateSubmission(submission);');
    expect(source.indexOf('if (!validation.ok) return;')).toBeLessThan(source.indexOf('custodyAdminApi.submitWithdrawal'));
    expect(source).toContain('describeSubmitFailure(caught)');
    expect(source).toContain('describeEvaluationFailure(caught)');
  });

  it('announces async results and focuses them for screen-reader users', () => {
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('submitStatusRef.current?.focus()');
    expect(source).toContain('evaluationResultRef.current?.focus()');
  });

  it('renders no approve, reject or hold control, because no such route exists', () => {
    expect(source).not.toMatch(/>\s*Approve\s*</);
    expect(source).not.toMatch(/>\s*Reject\s*</);
    expect(source).not.toMatch(/>\s*Hold\s*</);
    expect(source).not.toContain('/withdrawals/approve');
  });

  it('does not log tokens or secrets to the console', () => {
    expect(source).not.toContain('console.log');
  });
});
