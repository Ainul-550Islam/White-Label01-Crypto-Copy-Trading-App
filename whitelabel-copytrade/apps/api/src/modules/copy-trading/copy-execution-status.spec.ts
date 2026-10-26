// # Verifies the copy-execution lifecycle: only allowed edges are accepted, terminal states are immutable, retry count and backoff are shown exactly as stored, and the timeline query is tenant-scoped.
import { CopyExecutionRepository } from './copy-execution.repository';
import { CopyExecutionStatus } from './copy-trading.types';
import {
  COPY_EXECUTION_TRANSITIONS,
  COPY_RETRY_BASE_DELAY_MS,
  COPY_RETRY_MAX_DELAY_MS,
  allowedNextCopyExecutionStatuses,
  buildCopyExecutionTimeline,
  canTransitionCopyExecution,
  copyFailureReasonText,
  copyRetryDelayMs,
  isTerminalCopyExecutionStatus,
  nextCopyRetryAt,
} from './copy-execution-status';

/**
 * The two things this file has to make impossible:
 *
 *  1. A copy execution moving somewhere the pipeline never produces - the old
 *     guard only protected FILLED, so `MAPPED -> FILLED` and a re-write of a
 *     BLOCKED row both went through.
 *  2. A customer timeline that recomputes the numbers on the way to the screen.
 *     Retry counts, attempt numbers and "next retry at" are read from the row
 *     and the one backoff function, so the timeline cannot disagree with the
 *     ledger.
 */

describe('copy execution lifecycle table', () => {
  it('advances forward through the pipeline', () => {
    expect(canTransitionCopyExecution(CopyExecutionStatus.PENDING, CopyExecutionStatus.VALIDATED)).toBe(true);
    expect(canTransitionCopyExecution(CopyExecutionStatus.VALIDATED, CopyExecutionStatus.MAPPED)).toBe(true);
    expect(canTransitionCopyExecution(CopyExecutionStatus.MAPPED, CopyExecutionStatus.RISK_CHECKED)).toBe(true);
    expect(canTransitionCopyExecution(CopyExecutionStatus.RISK_CHECKED, CopyExecutionStatus.ROUTED)).toBe(true);
    expect(canTransitionCopyExecution(CopyExecutionStatus.ROUTED, CopyExecutionStatus.SUBMITTED)).toBe(true);
    expect(canTransitionCopyExecution(CopyExecutionStatus.SUBMITTED, CopyExecutionStatus.FILLED)).toBe(true);
  });

  it('refuses an edge that skips a stage and every backwards edge', () => {
    expect(canTransitionCopyExecution(CopyExecutionStatus.PENDING, CopyExecutionStatus.FILLED)).toBe(false);
    expect(canTransitionCopyExecution(CopyExecutionStatus.MAPPED, CopyExecutionStatus.FILLED)).toBe(false);
    expect(canTransitionCopyExecution(CopyExecutionStatus.SUBMITTED, CopyExecutionStatus.PENDING)).toBe(false);
    expect(canTransitionCopyExecution(CopyExecutionStatus.RISK_CHECKED, CopyExecutionStatus.MAPPED)).toBe(false);
  });

  it('treats every outcome state as terminal and immutable', () => {
    for (const status of [
      CopyExecutionStatus.FILLED,
      CopyExecutionStatus.FAILED,
      CopyExecutionStatus.REJECTED,
      CopyExecutionStatus.SKIPPED,
      CopyExecutionStatus.BLOCKED,
    ]) {
      expect(isTerminalCopyExecutionStatus(status)).toBe(true);
      expect(COPY_EXECUTION_TRANSITIONS[status]).toEqual([]);
      for (const target of Object.values(CopyExecutionStatus)) {
        if (target === status) continue;
        expect(canTransitionCopyExecution(status, target)).toBe(false);
      }
    }
    expect(isTerminalCopyExecutionStatus(CopyExecutionStatus.ROUTED)).toBe(false);
  });

  it('refuses an unknown status instead of defaulting to allowed', () => {
    expect(canTransitionCopyExecution('WHATEVER', CopyExecutionStatus.FILLED)).toBe(false);
    expect(canTransitionCopyExecution(CopyExecutionStatus.PENDING, 'WHATEVER')).toBe(false);
    expect(allowedNextCopyExecutionStatuses('WHATEVER')).toEqual([]);
  });

  it('exposes the allowed next statuses the timeline renders', () => {
    expect(allowedNextCopyExecutionStatuses(CopyExecutionStatus.ROUTED)).toEqual([
      CopyExecutionStatus.SUBMITTED,
      CopyExecutionStatus.FILLED,
      CopyExecutionStatus.BLOCKED,
      CopyExecutionStatus.REJECTED,
      CopyExecutionStatus.FAILED,
    ]);
    expect(allowedNextCopyExecutionStatuses(CopyExecutionStatus.FILLED)).toEqual([]);
  });
});

describe('copy retry backoff', () => {
  it('doubles from the base delay and caps, all in integer milliseconds', () => {
    expect(copyRetryDelayMs(1)).toBe(COPY_RETRY_BASE_DELAY_MS);
    expect(copyRetryDelayMs(2)).toBe(10_000);
    expect(copyRetryDelayMs(3)).toBe(20_000);
    expect(copyRetryDelayMs(4)).toBe(40_000);
    expect(copyRetryDelayMs(50)).toBe(COPY_RETRY_MAX_DELAY_MS);
    expect(Number.isInteger(copyRetryDelayMs(7))).toBe(true);
  });

  it('refuses a nonsensical attempt number rather than returning NaN', () => {
    expect(() => copyRetryDelayMs(0)).toThrow(/attempt/);
    expect(() => copyRetryDelayMs(1.5)).toThrow(/attempt/);
    expect(() => copyRetryDelayMs(-3)).toThrow(/attempt/);
  });

  it('computes "next retry at" from the failure time, and refuses an unparseable one', () => {
    expect(nextCopyRetryAt('2026-10-26T09:00:00.000Z', 1)).toBe('2026-10-26T09:00:05.000Z');
    expect(nextCopyRetryAt('2026-10-26T09:00:00.000Z', 3)).toBe('2026-10-26T09:00:20.000Z');
    expect(nextCopyRetryAt('not-a-date', 2)).toBeNull();
  });
});

describe('customer wording for failure codes', () => {
  it('maps known codes and keeps the diagnostic detail', () => {
    expect(copyFailureReasonText('SLIPPAGE_TOLERANCE_EXCEEDED')).toBe('The price moved further than your slippage tolerance allowed.');
    expect(copyFailureReasonText('BLOCKED_BUDGET_EXHAUSTED')).toBe('This copy would have exceeded your active-copy budget.');
    expect(copyFailureReasonText('ORDER_REJECTED: POST_ONLY would cross')).toBe(
      'The exchange rejected the order. (POST_ONLY would cross)',
    );
  });

  it('falls back to the code itself, never to a shrug', () => {
    expect(copyFailureReasonText('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(copyFailureReasonText(null)).toBeNull();
    expect(copyFailureReasonText('   ')).toBeNull();
  });
});

describe('copy execution timeline', () => {
  const base = {
    subscriptionId: 'sub-1',
    followerQuantity: '0.5',
    followerPrice: '50000',
    executionIntent: {},
  };

  it('orders attempts and shows the stored retry count verbatim', () => {
    const timeline = buildCopyExecutionTimeline([
      { ...base, id: 'exec-1', status: CopyExecutionStatus.FAILED, failureReason: 'ORDER_REJECTED: crossed', retryCount: 0, createdAt: '2026-10-26T09:00:00.000Z', updatedAt: '2026-10-26T09:00:00.000Z' },
      { ...base, id: 'exec-1', status: CopyExecutionStatus.FILLED, failureReason: null, retryCount: 1, createdAt: '2026-10-26T09:00:00.000Z', updatedAt: '2026-10-26T09:00:30.000Z' },
    ]);

    expect(timeline).not.toBeNull();
    expect(timeline!.terminal).toBe(true);
    expect(timeline!.currentStatus).toBe(CopyExecutionStatus.FILLED);
    expect(timeline!.entries.map((entry) => entry.status)).toEqual([CopyExecutionStatus.FAILED, CopyExecutionStatus.FILLED]);
    // attempt = retryCount + 1, read from the row and not recomputed from position.
    expect(timeline!.entries.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(timeline!.entries.map((entry) => entry.retryCount)).toEqual([0, 1]);
    expect(timeline!.entries[0].failureReasonText).toBe('The exchange rejected the order. (crossed)');
    expect(timeline!.entries[1].failureReasonText).toBeNull();
    // The old attempt is not offered a "next retry" it already had.
    expect(timeline!.entries[0].nextRetryAt).toBeNull();
  });

  it('offers a next-retry time only for the latest failed attempt', () => {
    const timeline = buildCopyExecutionTimeline([
      { ...base, id: 'exec-9', status: CopyExecutionStatus.FAILED, failureReason: 'RATE_LIMITED', retryCount: 2, createdAt: '2026-10-26T09:00:00.000Z', updatedAt: '2026-10-26T09:00:00.000Z' },
    ]);
    expect(timeline!.terminal).toBe(true);
    expect(timeline!.entries[0].attempt).toBe(3);
    expect(timeline!.entries[0].nextRetryAt).toBe('2026-10-26T09:00:20.000Z');
    expect(timeline!.entries[0].failureReasonText).toBe('The exchange rate limit was reached, so the copy was delayed.');
  });

  it('never rewrites the quantity or price it was given', () => {
    const timeline = buildCopyExecutionTimeline([
      { ...base, followerQuantity: '0.000000000001', followerPrice: '50000.123456', id: 'exec-2', status: CopyExecutionStatus.ROUTED, failureReason: null, retryCount: 0, createdAt: '2026-10-26T09:00:00.000Z', updatedAt: '2026-10-26T09:00:00.000Z' },
    ]);
    expect(timeline!.entries[0].followerQuantity).toBe('0.000000000001');
    expect(timeline!.entries[0].followerPrice).toBe('50000.123456');
    expect(timeline!.terminal).toBe(false);
  });

  it('returns null for an empty chain rather than an empty timeline', () => {
    expect(buildCopyExecutionTimeline([])).toBeNull();
  });
});

describe('CopyExecutionRepository enforces the machine and tenant scope', () => {
  interface QueryArgs {
    where: Record<string, unknown>;
  }

  interface UpdateArgs {
    data: Record<string, unknown>;
  }
  function build(existing: Record<string, unknown> | null) {
    let current = existing;
    const tx = {
      copyExecution: {
        findFirst: jest.fn(async (args: QueryArgs) => (current && current.id === args.where.id && current.tenantId === args.where.tenantId ? current : null)),
        update: jest.fn(async ({ data }: UpdateArgs) => {
          current = { ...current, ...data };
          return current;
        }),
      },
      copySubscription: { findFirst: jest.fn(async () => ({ strategyId: 'strategy-1' })) },
    };
    const prisma = { withTenantRls: jest.fn(async (_tenantId: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
    const outbox = { append: jest.fn(async () => ({ id: 'outbox-1' })) };
    return { repo: new CopyExecutionRepository(prisma as never, outbox as never), tx, outbox };
  }

  const row = {
    id: 'exec-1',
    tenantId: 'tenant-1',
    subscriptionId: 'sub-1',
    followerId: 'user-1',
    traderId: 'trader-1',
    status: CopyExecutionStatus.FILLED,
    executionIntent: { symbol: 'BTC-USDT', side: 'BUY' },
    followerQuantity: '0.5',
  };

  it('refuses to rewrite a terminal FILLED row', async () => {
    const { repo, tx, outbox } = build({ ...row });
    const result = await repo.updateStatus('exec-1', 'tenant-1', CopyExecutionStatus.FAILED, { failureReason: 'late failure' });
    expect(result).toMatchObject({ status: CopyExecutionStatus.FILLED });
    expect(tx.copyExecution.update).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('refuses to rewrite a BLOCKED row, which the old guard let through', async () => {
    const { repo, tx } = build({ ...row, status: CopyExecutionStatus.BLOCKED });
    const result = await repo.updateStatus('exec-1', 'tenant-1', CopyExecutionStatus.SUBMITTED);
    expect(result).toMatchObject({ status: CopyExecutionStatus.BLOCKED });
    expect(tx.copyExecution.update).not.toHaveBeenCalled();
  });

  it('refuses an edge that skips the pipeline', async () => {
    const { repo, tx } = build({ ...row, status: CopyExecutionStatus.MAPPED });
    const result = await repo.updateStatus('exec-1', 'tenant-1', CopyExecutionStatus.FILLED);
    expect(result).toMatchObject({ status: CopyExecutionStatus.MAPPED });
    expect(tx.copyExecution.update).not.toHaveBeenCalled();
  });

  it('accepts a legal edge and records the retry count increment exactly once', async () => {
    const { repo, tx, outbox } = build({ ...row, status: CopyExecutionStatus.SUBMITTED });
    await repo.updateStatus('exec-1', 'tenant-1', CopyExecutionStatus.FAILED, { failureReason: 'ORDER_REJECTED' });
    expect(tx.copyExecution.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'exec-1', tenantId: 'tenant-1' },
      data: expect.objectContaining({ status: CopyExecutionStatus.FAILED, retryCount: { increment: 1 } }),
    }));
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it("returns null for another tenant's execution instead of updating it", async () => {
    const { repo, tx } = build({ ...row, status: CopyExecutionStatus.SUBMITTED });
    const result = await repo.updateStatus('exec-1', 'tenant-2', CopyExecutionStatus.FAILED, { failureReason: 'x' });
    expect(result).toBeNull();
    expect(tx.copyExecution.update).not.toHaveBeenCalled();
  });
});
