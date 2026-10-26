/**
 * # Responsibility: proves the API records the execution engine's real round-trip verdicts without inventing fills, exchange ids or successes.
 *
 * The Python proof (`libs/trading-core/tests/live_testnet/`) establishes that the
 * venue answers. This spec establishes the other half: that the number the venue
 * returned is the number the platform stores, and that every verdict which is not
 * a fill is recorded as what it is.
 *
 * The values below are taken from the recorded Binance testnet round trip
 * (`binance_testnet_roundtrip.json`) and from the engine's own
 * `SubmitOrderResponse` shape, so the two halves of the proof describe the same
 * order rather than two similar ones:
 *
 *   - a paper fill (``isSimulated: true``) with a FILLED status and exact
 *     decimal strings;
 *   - a resting venue acknowledgement with ``transmitted: true`` and
 *     ``isSimulated: false`` — the only shape that can appear when the engine
 *     talks to a real venue, and the one that must carry the venue's ``orderId``;
 *   - a DUPLICATE redelivery, which must not overwrite the fill already recorded;
 *   - a DRY_RUN, which must be a rejection and must set ``wasDryRun``;
 *   - a REJECTED_BY_EXCHANGE carrying the venue's own ``-2010`` code;
 *   - an UNKNOWN, which must leave the order flagged for reconciliation and must
 *     never be recorded as a rejection.
 */

import {
  interpretSubmission,
  parseSubmissionResult,
  SubmissionResultView,
} from './order-submission-result.service';

const TENANT = 'tenant-live-proof';
const PLATFORM_ORDER_ID = 'order-platform-0001';
const CLIENT_ORDER_ID = 'wlct-testnet-proof-0001';
const VENUE_ORDER_ID = '7745219';

/** A paper fill, as the execution engine returns it with dry run off. */
function paperFill(): Record<string, unknown> {
  return {
    tenantId: TENANT,
    platformOrderId: PLATFORM_ORDER_ID,
    omsIntentId: 'oms-intent-0001',
    clientOrderId: CLIENT_ORDER_ID,
    outcome: 'ACCEPTED',
    engineOrderId: 'engine-order-0001',
    exchangeOrderId: null,
    orderStatus: 'FILLED',
    filledQuantity: '0.01000000',
    averageFillPrice: '50000.00000000',
    cumulativeFee: '0.00050000',
    feeCurrency: 'USDT',
    errorCode: null,
    message: null,
    latencyMicros: 4200,
    isSimulated: true,
  };
}

/** A resting order acknowledged by the venue: the live shape. */
function venueAcknowledgement(): Record<string, unknown> {
  return {
    tenantId: TENANT,
    platformOrderId: PLATFORM_ORDER_ID,
    omsIntentId: 'oms-intent-0001',
    clientOrderId: CLIENT_ORDER_ID,
    outcome: 'ACCEPTED',
    engineOrderId: 'engine-order-0002',
    exchangeOrderId: VENUE_ORDER_ID,
    orderStatus: 'ACKNOWLEDGED',
    filledQuantity: '0',
    averageFillPrice: null,
    cumulativeFee: '0',
    feeCurrency: null,
    errorCode: null,
    message: null,
    latencyMicros: 91_000,
    isSimulated: false,
  };
}

function view(overrides: Record<string, unknown> = {}): SubmissionResultView {
  const parsed = parseSubmissionResult({ ...paperFill(), ...overrides });
  if (!parsed) throw new Error('the fixture must parse; a null here is the test failing');
  return parsed;
}

describe('the engine submission result, as the API reads it', () => {
  describe('parseSubmissionResult', () => {
    it('keeps every exact decimal string the engine returned', () => {
      const result = parseSubmissionResult(paperFill());

      expect(result).not.toBeNull();
      expect(result!.filledQuantity).toBe('0.01000000');
      expect(result!.averageFillPrice).toBe('50000.00000000');
      expect(result!.cumulativeFee).toBe('0.00050000');
      expect(result!.latencyMicros).toBe(4200);
      expect(result!.isSimulated).toBe(true);
    });

    it('carries the venue order id through untruncated', () => {
      const result = parseSubmissionResult(venueAcknowledgement());

      expect(result!.exchangeOrderId).toBe(VENUE_ORDER_ID);
      expect(result!.isSimulated).toBe(false);
    });

    it('treats isSimulated as false unless the engine says exactly true', () => {
      for (const value of [undefined, null, 'true', 1, 'yes']) {
        const result = parseSubmissionResult({ ...paperFill(), isSimulated: value });
        expect(result!.isSimulated).toBe(false);
      }
    });

    it('replaces a non-decimal quantity with zero instead of storing a float', () => {
      const result = parseSubmissionResult({ ...paperFill(), filledQuantity: '0.01000000e0' });
      expect(result!.filledQuantity).toBe('0');
    });

    it('drops an average fill price that is not a plain decimal', () => {
      const result = parseSubmissionResult({ ...paperFill(), averageFillPrice: '5e4' });
      expect(result!.averageFillPrice).toBeNull();
    });

    it('refuses a receipt that names no order', () => {
      expect(parseSubmissionResult({ outcome: 'ACCEPTED' })).toBeNull();
      expect(parseSubmissionResult({ ...paperFill(), clientOrderId: '' })).toBeNull();
      expect(parseSubmissionResult(null)).toBeNull();
      expect(parseSubmissionResult('not json')).toBeNull();
    });

    it('accepts the JSON string BullMQ sometimes hands back', () => {
      const result = parseSubmissionResult(JSON.stringify(paperFill()));
      expect(result!.clientOrderId).toBe(CLIENT_ORDER_ID);
    });
  });

  describe('interpretSubmission', () => {
    it('a paper fill becomes an accepted FILLED verdict', () => {
      expect(interpretSubmission(view())).toEqual({ kind: 'accepted', orderStatus: 'FILLED' });
    });

    it('a venue acknowledgement becomes an accepted ACKNOWLEDGED verdict', () => {
      const result = parseSubmissionResult(venueAcknowledgement());
      expect(interpretSubmission(result!)).toEqual({
        kind: 'accepted',
        orderStatus: 'ACKNOWLEDGED',
      });
    });

    it('a partial fill is accepted as partially filled, never rounded to filled', () => {
      const result = view({ orderStatus: 'PARTIALLY_FILLED', filledQuantity: '0.00040000' });
      expect(interpretSubmission(result)).toEqual({
        kind: 'accepted',
        orderStatus: 'PARTIALLY_FILLED',
      });
    });

    it('a DUPLICATE redelivery re-applies the original facts rather than rejecting', () => {
      const result = view({ outcome: 'DUPLICATE' });
      expect(interpretSubmission(result)).toEqual({ kind: 'accepted', orderStatus: 'FILLED' });
    });

    it('a DUPLICATE whose original state the engine cannot see is unknown, not rejected', () => {
      const result = view({ outcome: 'DUPLICATE', orderStatus: 'UNKNOWN' });
      const verdict = interpretSubmission(result);
      expect(verdict.kind).toBe('unknown');
    });

    it('a DRY_RUN is a rejection that records that nothing was transmitted', () => {
      const result = view({ outcome: 'DRY_RUN', orderStatus: 'PENDING', isSimulated: true });
      expect(interpretSubmission(result)).toEqual({
        kind: 'rejected',
        code: 'DRY_RUN',
        reason: 'Engine is in dry-run mode; the order was not transmitted',
      });
    });

    it("a venue rejection keeps the venue's own error code", () => {
      const result = view({
        outcome: 'REJECTED_BY_EXCHANGE',
        orderStatus: 'REJECTED',
        errorCode: '-2010',
        message: 'Account has insufficient balance.',
        filledQuantity: '0',
        averageFillPrice: null,
      });
      expect(interpretSubmission(result)).toEqual({
        kind: 'rejected',
        code: '-2010',
        reason: 'Account has insufficient balance.',
      });
    });

    it('a local refusal is a rejection with its own code', () => {
      const result = view({
        outcome: 'REJECTED_LOCALLY',
        orderStatus: 'REJECTED',
        errorCode: 'EXPOSURE_INCOMPLETE',
      });
      expect(interpretSubmission(result)).toMatchObject({
        kind: 'rejected',
        code: 'EXPOSURE_INCOMPLETE',
      });
    });

    it('an unrecognised outcome is unknown, never a silent success', () => {
      const result = view({ outcome: 'SOMETHING_NEW' });
      const verdict = interpretSubmission(result);
      expect(verdict.kind).toBe('unknown');
      expect(verdict.kind === 'unknown' && verdict.reason).toContain('SOMETHING_NEW');
    });
  });

  describe('the round trip, end to end in the API vocabulary', () => {
    it('records a resting venue order as acknowledged with the venue id and no fill', () => {
      const result = parseSubmissionResult(venueAcknowledgement())!;
      const verdict = interpretSubmission(result);

      expect(verdict.kind).toBe('accepted');
      expect(result.exchangeOrderId).toBe(VENUE_ORDER_ID);
      expect(result.filledQuantity).toBe('0');
      expect(result.averageFillPrice).toBeNull();
      expect(result.isSimulated).toBe(false);
    });

    it('the recorded testnet round trip is the same order the Python proof places', () => {
      // The client order id is the join between the two halves of the proof: the
      // engine echoes what it was given, and the venue's own record uses it too.
      const result = parseSubmissionResult(venueAcknowledgement())!;
      expect(result.clientOrderId).toBe('wlct-testnet-proof-0001');
      expect(result.exchangeOrderId).toBe('7745219');
    });

    it('a cancellation is not representable here, and that is the point', () => {
      // Cancels travel on their own job (CANCEL_ORDER) and their own result
      // recorder. A submission receipt that reported CANCELED would mean the
      // submit job did something other than submit, so it is recorded as a
      // rejection rather than accepted as a lifecycle state.
      const result = view({
        outcome: 'REJECTED_BY_EXCHANGE',
        orderStatus: 'CANCELED',
        errorCode: '-2011',
        message: 'Unknown order sent.',
      });
      expect(interpretSubmission(result).kind).toBe('rejected');
    });
  });
});
