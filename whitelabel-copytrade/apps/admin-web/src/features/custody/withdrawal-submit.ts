// # Responsibility: validation and failure classification for the custody withdrawal queue, kept pure so the rules are testable without a DOM.
//
// Two things can go wrong with a withdrawal submission and both are silent if
// they are only handled inside a component:
//
//  1. The operator submits the wrong thing - an empty id, or a wallet address
//     pasted into the id field. That must be caught before the request.
//  2. The request fails in a way that means something specific: 403 (not your
//     job), 404 (no such withdrawal in this tenant), 409 (it is not in a state
//     that can be submitted), 422 (the body was refused). Collapsing all four
//     into "something went wrong" trains operators to retry a request that
//     will never succeed.
//
// The API's own message is used when it explains the failure; otherwise one of
// the sentences below is shown. A raw server error never reaches the operator.
import { ApiError } from '@/lib/api-error';

/** Typed by the operator so a mis-click cannot broadcast a withdrawal. */
export const SUBMIT_CONFIRMATION_PHRASE = 'SUBMIT WITHDRAWAL';

export interface SubmissionInput {
  custodyWithdrawalId: string;
  operatorId: string;
  phrase: string;
}

export type SubmissionField = keyof SubmissionInput;

export interface SubmissionValidation {
  ok: boolean;
  errors: Partial<Record<SubmissionField, string>>;
}

/** A withdrawal id from this platform is a UUID; anything else is a paste mistake. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateSubmission(input: SubmissionInput): SubmissionValidation {
  const errors: Partial<Record<SubmissionField, string>> = {};
  const id = input.custodyWithdrawalId.trim();

  if (id === '') errors.custodyWithdrawalId = 'Enter the custody withdrawal ID to submit.';
  else if (!UUID.test(id)) errors.custodyWithdrawalId = 'Enter the withdrawal ID exactly as shown in the request, without spaces.';

  if (input.operatorId.trim() === '') errors.operatorId = 'The operator identity is missing from your session. Sign in again.';

  if (input.phrase !== SUBMIT_CONFIRMATION_PHRASE) {
    errors.phrase = `Type ${SUBMIT_CONFIRMATION_PHRASE} exactly to confirm.`;
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Turns a failure into the sentence the operator should read. `ApiError`
 * carries the API's own message, which is already user-facing copy; the status
 * mapping only applies when there is no message to show.
 */
export function describeSubmitFailure(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'You do not have permission to submit withdrawals for this organisation.';
    if (caught.status === 404) return 'That withdrawal does not exist for this organisation. Check the ID.';
    if (caught.status === 409) return 'This withdrawal is not in a state that can be submitted. Reload it before trying again.';
    if (caught.status === 422) return caught.message || 'The withdrawal details were refused. Check the amount and destination.';
    if (caught.code !== 'UNKNOWN_ERROR' && caught.message) return caught.message;
  }
  return 'The withdrawal could not be submitted. It may not have been sent; check the withdrawal state before retrying.';
}

/** Same treatment for the policy evaluation, which fails closed and explains why. */
export function describeEvaluationFailure(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'You do not have permission to evaluate withdrawals for this organisation.';
    if (caught.status === 422) return caught.message || 'The evaluation inputs were refused. Check the asset, network, amount and destination.';
    if (caught.code !== 'UNKNOWN_ERROR' && caught.message) return caught.message;
  }
  return 'The policy evaluation could not be completed. Treat the withdrawal as unevaluated, not as approved.';
}

/**
 * A withdrawal is only safe to submit when the last evaluation passed for the
 * exact values on screen. Comparing the inputs (not just "was evaluated") stops
 * an operator editing the amount after a green result and submitting anyway.
 */
export interface EvaluationSnapshot {
  assetId: string;
  networkId: string;
  amount: string;
  destinationAddress: string;
  eligible: boolean;
}

export function evaluationMatches(
  snapshot: EvaluationSnapshot | null,
  current: Omit<EvaluationSnapshot, 'eligible'>,
): boolean {
  if (!snapshot) return false;
  return (
    snapshot.eligible &&
    snapshot.assetId === current.assetId &&
    snapshot.networkId === current.networkId &&
    snapshot.amount === current.amount &&
    snapshot.destinationAddress === current.destinationAddress
  );
}
