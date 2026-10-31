// # Responsibility: typed operator client for profit-share statements — generate (or correct) a statement from posted ledger entries and finalize a draft, each behind a step-up proof minted for STATEMENT_REGENERATE.
//
// WHAT THE API ACTUALLY OFFERS
// ----------------------------
// `AdminProfitShareStatementController` has exactly two routes:
//
//   POST admin/billing/statements/generate     { followerUserId, traderUserId, periodStart, periodEnd, correction? }
//   POST admin/billing/statements/:id/finalize
//
// There is no admin list and no admin detail route. The owner-scoped
// `GET billing/statements` returns only the CALLER's own statements, so it cannot
// stand in for an operator list and is deliberately not used here: rendering it as
// "all statements" would show an operator their personal empty list and call it a
// clean period. The console therefore works from what the two routes return — the
// generated statement (with its ledger lines) and the finalized one — and the
// operator supplies the follower/trader pair and period they want to act on.
//
// The amounts in the response (`grossProfit`, `profitShareAmount`,
// `highWaterMark`, and each line's `profitAmount`/`feeAmount`) are decimal strings
// produced by the API's own Decimal arithmetic over POSTED ledger entries. This
// client formats them; it never recomputes them, and no amount is ever summed
// here.
import { apiClient } from '@/lib/api-client';
import { assertStepUpProof } from './step-up-proof';

/* ------------------------------------------------------------------ types */

/** The step-up action both admin routes name. */
export type StatementStepUpAction = 'STATEMENT_REGENERATE';

export type ProfitShareStatementStatus = 'DRAFT' | 'FINALIZED' | 'SUPERSEDED';

/** One ledger-derived line of a statement. Amounts are exact decimal strings. */
export interface ProfitShareStatementLine {
  id: string;
  statementId: string;
  /** The `billing_ledger_entries` row this line was derived from. */
  sourceLedgerId: string;
  sourceUserId: string;
  currency: string;
  profitAmount: string;
  feeAmount: string;
  postedAt: string;
}

/** A statement as the API returns it: Prisma row shape, lines included. */
export interface ProfitShareStatement {
  id: string;
  tenantId: string;
  followerUserId: string;
  traderUserId: string;
  periodStart: string;
  periodEnd: string;
  version: number;
  status: ProfitShareStatementStatus;
  currency: string;
  grossProfit: string;
  profitShareAmount: string;
  highWaterMark: string;
  roundingRule: string;
  supersedesId: string | null;
  finalizedAt: string | null;
  createdAt: string;
  lines?: ProfitShareStatementLine[];
}

export interface GenerateStatementInput {
  followerUserId: string;
  traderUserId: string;
  periodStart: string;
  periodEnd: string;
  /** True to supersede an already-finalized statement for the same period. */
  correction?: boolean;
}

const API_BASE = '/v1/admin/billing/statements';

/** The rate/period shapes the DTO enforces, re-checked so the form can explain itself. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** A period is valid when both ends parse and the end is strictly after the start. */
export function isValidPeriod(periodStart: string, periodEnd: string): boolean {
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

/**
 * The generated call answers with an ARRAY when the period contains accruals in
 * more than one currency: the API generates one statement per currency rather
 * than mixing units into a single total. A single-currency period answers with a
 * one-element array. The console must therefore always render a list, and this
 * helper is the one place that decides that.
 */
export function asStatements(value: ProfitShareStatement | ProfitShareStatement[] | null | undefined): ProfitShareStatement[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/* ----------------------------------------------------------------- client */

export const profitShareStatementAdminApi = {
  /**
   * Mints the single-use proof for a generation or finalization. Call it
   * immediately before the mutation, not when the form opens.
   */
  requestStepUp: async (method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string) => {
    const action: StatementStepUpAction = 'STATEMENT_REGENERATE';
    const payload =
      method === 'TOTP'
        ? { action, method, code: value }
        : method === 'PASSWORD'
          ? { action, method, password: value }
          : { action, method, recoveryCode: value };
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, action, method);
  },

  /**
   * Generates the statement(s) for a period from SETTLED performance-fee accruals
   * and their POSTED ledger entries, and finalizes them in the same transaction.
   * An empty array means the period had no posted performance fees — a real
   * answer, not an error, and the console says so.
   */
  generate: (input: GenerateStatementInput, idempotencyKey: string) =>
    apiClient.post<ProfitShareStatement | ProfitShareStatement[]>(
      `${API_BASE}/generate`,
      {
        followerUserId: input.followerUserId,
        traderUserId: input.traderUserId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        ...(input.correction === undefined ? {} : { correction: input.correction }),
      },
      { idempotencyKey },
    ),

  /** Finalizes a DRAFT statement. Finalized amounts are immutable by design. */
  finalize: (statementId: string, idempotencyKey: string) =>
    apiClient.post<ProfitShareStatement>(
      `${API_BASE}/${encodeURIComponent(statementId)}/finalize`,
      undefined,
      { idempotencyKey },
    ),
};
