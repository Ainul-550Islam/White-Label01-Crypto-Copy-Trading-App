// # Verifies OMS intent -> Order -> queue dispatch -> SUBMITTED transition
import './order-submission.spec';
import {
  submitOrderJobId,
  clientOrderIdFromJobId,
  buildSubmitSpecification,
} from './order-submission.service';
import { formatExecutionCommandPayload } from './execution-handoff.service';

describe('OMS Intent -> Order -> Queue Dispatch -> SUBMITTED Handoff (GAP-18)', () => {
  test('generates deterministic BullMQ-safe job IDs and round-trips clientOrderId', () => {
    const jobId = submitOrderJobId('cid-555');
    expect(jobId).toBe('oms-submit-cid-555');
    expect(clientOrderIdFromJobId(jobId)).toBe('cid-555');
  });

  test('builds plain-decimal submit specifications and formats execution command payloads', () => {
    const spec = buildSubmitSpecification({
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      marketType: 'SPOT',
      priceTick: '0.01',
      quantityStep: '0.0001',
      minQuantity: '0.001',
      maxQuantity: '100',
      minNotional: '10',
      isTradeable: true,
      pricePrecision: 2,
      quantityPrecision: 4,
    });
    expect(spec.minNotional).toBe('10');

    const cmd = formatExecutionCommandPayload({
      tenantId: 'tenant-1',
      orderId: 'ord-555',
      clientOrderId: 'cid-555',
      exchangeAccountId: 'ex-acc-1',
      venue: 'BINANCE',
      symbol: 'btc-usdt',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: '0.05',
      price: '61250.00',
    });
    expect(cmd.symbol).toBe('BTC/USDT');
    expect(cmd.commandType).toBe('SUBMIT_ORDER');
    expect(cmd.idempotencyKey).toBe('exec-cmd:tenant-1:ord-555:cid-555');
  });
});
