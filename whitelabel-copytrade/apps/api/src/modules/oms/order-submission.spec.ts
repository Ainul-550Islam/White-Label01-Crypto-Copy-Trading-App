/**
 * Phase 3: the OMS producer half of SUBMIT_ORDER, and the result recorder.
 *
 * Pinned here:
 *  - the job id is deterministic and legal for BullMQ (no single ':');
 *  - exposure is computed from the canonical ledger and is INCOMPLETE when a
 *    non-flat position has no mark;
 *  - LIVE / stop orders are refused with a typed reason, never enqueued;
 *  - the engine's outcome vocabulary maps onto platform order states, with
 *    UNKNOWN left for reconciliation rather than guessed;
 *  - the recorder writes the order, the intent and the copy execution, and a
 *    FILLED copy execution is never moved backwards.
 */

import { Prisma } from '@prisma/client';

import {
  SubmitOrderRefused,
  buildSubmitOrderJob,
  buildSubmitSpecification,
  clientOrderIdFromJobId,
  computeSubmitExposure,
  submitOrderJobId,
  type SubmitOrderJobInput,
} from './order-submission.payload';
import {
  OrderSubmissionResultService,
  interpretSubmission,
  parseSubmissionResult,
  type SubmissionResultView,
} from './order-submission-result.service';
import { OrderIntentState } from './oms.types';

const SPEC = buildSubmitSpecification({
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  marketType: 'SPOT',
  priceTick: new Prisma.Decimal('0.010000000000'),
  quantityStep: new Prisma.Decimal('0.000010000000'),
  minQuantity: new Prisma.Decimal('0.00001'),
  maxQuantity: null,
  minNotional: new Prisma.Decimal('10.000000'),
  isTradeable: true,
  pricePrecision: 2,
  quantityPrecision: 5,
});

function jobInput(overrides: Partial<SubmitOrderJobInput> = {}): SubmitOrderJobInput {
  return {
    tenantId: 't-1',
    accountId: 'a-1',
    orderId: 'o-1',
    clientOrderId: 'oms0123456789abcdef0123456789abcdef',
    symbol: 'BTC-USDT',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: new Prisma.Decimal('0.010000000000'),
    price: new Prisma.Decimal('50000.000000000000'),
    timeInForce: 'GTC',
    reduceOnly: false,
    strategyId: null,
    riskDecisionId: 'r-1',
    environment: 'PAPER',
    specification: SPEC,
    exposure: { positionQuantity: '0', symbolExposureNotional: '0', accountExposureNotional: '0', complete: true },
    omsIntentId: 'i-1',
    metadata: { copyExecutionId: 'c-1', 'bad.key': 'x' },
    ...overrides,
  };
}

describe('SUBMIT_ORDER producer helpers', () => {
  it('job ids are deterministic, reversible and contain no colon', () => {
    const id = submitOrderJobId('oms0123');
    expect(id).toBe('oms-submit-oms0123');
    expect(id.includes(':')).toBe(false);
    expect(clientOrderIdFromJobId(id)).toBe('oms0123');
    expect(clientOrderIdFromJobId('other-job')).toBeNull();
    expect(clientOrderIdFromJobId(undefined)).toBeNull();
  });

  it('specification decimals are plain strings (no exponent, no float)', () => {
    expect(SPEC).toMatchObject({ priceTick: '0.01', quantityStep: '0.00001', minQuantity: '0.00001', minNotional: '10', maxQuantity: null });
    expect(() => buildSubmitSpecification({ ...(SPEC as any), marketType: 'OPTIONS' })).toThrow(/Unsupported market type/);
  });

  it('exposure sums marked positions and flags an unmarked one as incomplete', () => {
    const exposure = computeSubmitExposure(
      [
        { symbolId: 's-btc', quantity: '0.5', markPrice: '50000' },
        { symbolId: 's-btc', quantity: '-0.2', markPrice: '50000' },
        { symbolId: 's-eth', quantity: '-2', markPrice: '3000' },
        { symbolId: 's-sol', quantity: '0', markPrice: null },
      ],
      's-btc',
    );
    expect(exposure).toEqual({
      positionQuantity: '0.3',
      symbolExposureNotional: '35000',
      accountExposureNotional: '41000',
      complete: true,
    });
    const incomplete = computeSubmitExposure([{ symbolId: 's-eth', quantity: '1', markPrice: null }], 's-btc');
    expect(incomplete.complete).toBe(false);
  });

  it('builds a PAPER job with plain decimals and filtered metadata', () => {
    const job = buildSubmitOrderJob(jobInput());
    expect(job).toMatchObject({
      quantity: '0.01',
      price: '50000',
      environment: 'PAPER',
      riskDecisionId: 'r-1',
      omsIntentId: 'i-1',
      metadata: { copyExecutionId: 'c-1' },
    });
    expect((job.metadata as Record<string, string>)['bad.key']).toBeUndefined();
  });

  it.each([
    [{ environment: 'LIVE' }, 'LIVE_SUBMISSION_NOT_WIRED'],
    [{ orderType: 'STOP' }, 'ORDER_TYPE_NOT_SUPPORTED'],
    [{ side: 'HOLD' }, 'SIDE_INVALID'],
    [{ timeInForce: 'DAY' }, 'TIME_IN_FORCE_NOT_SUPPORTED'],
    [{ price: null }, 'PRICE_REQUIRED'],
  ] as Array<[Partial<SubmitOrderJobInput>, string]>)('refuses %j with %s', (patch, code) => {
    try {
      buildSubmitOrderJob(jobInput(patch));
      throw new Error('expected refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(SubmitOrderRefused);
      expect((error as SubmitOrderRefused).code).toBe(code);
    }
  });
});

function result(overrides: Partial<SubmissionResultView> = {}): SubmissionResultView {
  return {
    tenantId: 't-1',
    platformOrderId: 'o-1',
    omsIntentId: 'i-1',
    clientOrderId: 'oms0123456789abcdef0123456789abcdef',
    outcome: 'ACCEPTED',
    engineOrderId: 'eng-1',
    exchangeOrderId: 'paper-1',
    orderStatus: 'FILLED',
    filledQuantity: '0.01',
    averageFillPrice: '50000',
    cumulativeFee: '0.5',
    feeCurrency: 'USDT',
    errorCode: null,
    message: null,
    latencyMicros: 42,
    isSimulated: true,
    ...overrides,
  };
}

describe('submission result interpretation', () => {
  it('parses a worker receipt (object or JSON string) and ignores anything else', () => {
    const raw = { ...result(), platformOrderId: 'o-1', tenantId: 't-1' };
    expect(parseSubmissionResult(raw)?.platformOrderId).toBe('o-1');
    expect(parseSubmissionResult(JSON.stringify(raw))?.outcome).toBe('ACCEPTED');
    expect(parseSubmissionResult({ verified: true })).toBeNull();
    expect(parseSubmissionResult('not json')).toBeNull();
    expect(parseSubmissionResult({ ...raw, filledQuantity: '1e3' })?.filledQuantity).toBe('0');
  });

  it.each([
    [{ outcome: 'ACCEPTED', orderStatus: 'FILLED' }, { kind: 'accepted', orderStatus: 'FILLED' }],
    [{ outcome: 'ACCEPTED', orderStatus: 'PARTIALLY_FILLED' }, { kind: 'accepted', orderStatus: 'PARTIALLY_FILLED' }],
    [{ outcome: 'ACCEPTED', orderStatus: 'ACKNOWLEDGED' }, { kind: 'accepted', orderStatus: 'ACKNOWLEDGED' }],
    [{ outcome: 'DUPLICATE', orderStatus: 'FILLED' }, { kind: 'accepted', orderStatus: 'FILLED' }],
    [{ outcome: 'DUPLICATE', orderStatus: 'UNKNOWN' }, { kind: 'unknown' }],
    [{ outcome: 'REJECTED_LOCALLY', errorCode: 'VALIDATION_FAILED', message: 'bad tick' }, { kind: 'rejected', code: 'VALIDATION_FAILED', reason: 'bad tick' }],
    [{ outcome: 'REJECTED_BY_EXCHANGE' }, { kind: 'rejected', code: 'REJECTED_BY_EXCHANGE' }],
    [{ outcome: 'DRY_RUN' }, { kind: 'rejected', code: 'DRY_RUN' }],
    [{ outcome: 'UNKNOWN' }, { kind: 'unknown' }],
  ] as Array<[Partial<SubmissionResultView>, Record<string, unknown>]>)('%j -> %j', (patch, expected) => {
    expect(interpretSubmission(result(patch))).toMatchObject(expected);
  });
});

function fakeRecorder(order: Record<string, unknown> | null) {
  const orderUpdates: any[] = [];
  const copyUpdates: any[] = [];
  const transitions: any[] = [];
  const acks: any[] = [];
  const prisma = {
    order: {
      findFirst: jest.fn(async () => order),
      update: jest.fn(async (args: any) => {
        orderUpdates.push(args);
        return { ...order, ...args.data };
      }),
      findMany: jest.fn(async () => []),
    },
    copyExecution: {
      updateMany: jest.fn(async (args: any) => {
        copyUpdates.push(args);
        return { count: 1 };
      }),
    },
  };
  const ackService = { processAckFromExecutionEvent: jest.fn(async (args: any) => acks.push(args)) };
  const lifecycle = { transition: jest.fn(async (args: any) => transitions.push(args)) };
  const queue = { getQueue: jest.fn(() => ({ getJob: jest.fn(async () => null) })) };
  const service = new OrderSubmissionResultService(prisma as any, ackService as any, lifecycle as any, queue as any);
  return { service, prisma, orderUpdates, copyUpdates, transitions, acks };
}

const ORDER = {
  id: 'o-1',
  tenantId: 't-1',
  clientOrderId: 'oms0123456789abcdef0123456789abcdef',
  status: 'SUBMITTED',
  venue: 'PAPER',
  metadata: { omsIntentId: 'i-1', copyExecutionId: 'c-1' },
};

describe('OrderSubmissionResultService', () => {
  it('a filled result updates the order, acks and fills the intent, and fills the copy execution', async () => {
    const { service, orderUpdates, copyUpdates, transitions, acks } = fakeRecorder(ORDER);
    const verdict = await service.recordResult(result());
    expect(verdict).toEqual({ kind: 'accepted', orderStatus: 'FILLED' });
    expect(orderUpdates[0].data).toMatchObject({ status: 'FILLED', exchangeOrderId: 'paper-1', filledQuantity: '0.01', averageFillPrice: '50000' });
    expect(orderUpdates[0].data.metadata).toMatchObject({ omsIntentId: 'i-1', engineOutcome: 'ACCEPTED', engineOrderId: 'eng-1' });
    expect(acks[0]).toMatchObject({ status: 'ACKNOWLEDGED', clientOrderId: ORDER.clientOrderId, source: 'EXECUTION_ENGINE_SIMULATED' });
    expect(transitions[0]).toMatchObject({ intentId: 'i-1', toState: OrderIntentState.FILLED });
    expect(copyUpdates[0]).toMatchObject({ where: { id: 'c-1', tenantId: 't-1' }, data: { status: 'FILLED', followerOrderId: 'o-1' } });
  });

  it('a rejection marks the order REJECTED, rejects the intent via ack, and the copy execution never regresses from FILLED', async () => {
    const { service, orderUpdates, copyUpdates, acks, transitions } = fakeRecorder(ORDER);
    await service.recordResult(result({ outcome: 'REJECTED_LOCALLY', orderStatus: 'UNKNOWN', errorCode: 'VALIDATION_FAILED', message: 'tick' }));
    expect(orderUpdates[0].data).toMatchObject({ status: 'REJECTED', rejectionCode: 'VALIDATION_FAILED', rejectionReason: 'tick' });
    expect(acks[0]).toMatchObject({ status: 'REJECTED', providerErrorCode: 'VALIDATION_FAILED' });
    expect(transitions).toHaveLength(0);
    expect(copyUpdates[0].where).toMatchObject({ id: 'c-1', NOT: { status: 'FILLED' } });
    expect(copyUpdates[0].data.status).toBe('REJECTED');
  });

  it('an UNKNOWN outcome leaves the order SUBMITTED and flags reconciliation - nothing is guessed', async () => {
    const { service, orderUpdates, acks, copyUpdates } = fakeRecorder(ORDER);
    await service.recordResult(result({ outcome: 'UNKNOWN', orderStatus: 'UNKNOWN' }));
    expect(orderUpdates[0].data.status).toBeUndefined();
    expect(orderUpdates[0].data).toMatchObject({ reconciliationState: 'UNKNOWN' });
    expect(acks).toHaveLength(0);
    expect(copyUpdates).toHaveLength(0);
  });

  it('a result for an order this tenant does not have is ignored', async () => {
    const { service, orderUpdates } = fakeRecorder(null);
    await service.recordResult(result());
    expect(orderUpdates).toHaveLength(0);
  });

  it('a terminal job failure marks order FAILED, intent FAILED and copy execution FAILED', async () => {
    const { service, orderUpdates, transitions, copyUpdates } = fakeRecorder(ORDER);
    await service.recordFailure({ tenantId: 't-1', clientOrderId: ORDER.clientOrderId, reason: 'ENGINE_UNREACHABLE' });
    expect(orderUpdates[0].data).toMatchObject({ status: 'FAILED', rejectionCode: 'SUBMISSION_JOB_FAILED' });
    expect(transitions[0]).toMatchObject({ intentId: 'i-1', toState: OrderIntentState.FAILED });
    expect(copyUpdates[0].data).toMatchObject({ status: 'FAILED' });
  });

  it('a failure for an already-resolved order changes nothing', async () => {
    const { service, orderUpdates } = fakeRecorder({ ...ORDER, status: 'FILLED' });
    await service.recordFailure({ tenantId: 't-1', clientOrderId: ORDER.clientOrderId, reason: 'late' });
    expect(orderUpdates).toHaveLength(0);
  });
});
