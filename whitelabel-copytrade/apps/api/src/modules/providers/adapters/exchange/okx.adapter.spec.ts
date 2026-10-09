// # Pins the OKX adapter's order-placement contract: instrument ids, margin mode, retry safety
//
// Three defects lived in this adapter at once and each is pinned here:
//
// 1. `instId` was built with `symbol.replace('-', '-')`, a no-op that read as normalisation. The
//    assertions below use symbols in the three forms callers actually pass and require the
//    `BASE-QUOTE` the venue expects, plus a refusal for anything that is not an instrument.
// 2. `tdMode` was hard-coded to `cash`, which is the spot account mode. A derivative submitted in
//    cash mode is wrong in a way that only the venue would have caught, so a derivative must now
//    carry an explicit margin mode and is refused without one.
// 3. The create request was declared non-idempotent while its body carried `clOrdId`, the venue's
//    deduplication key. That told the retry layer that a safely-repeatable order was unsafe to
//    repeat, so the flag is asserted directly.
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderObservationService } from '../../provider-observation.service';
import { OkxProductionAdapter } from './okx.adapter';

const CONTEXT = {
  apiKey: 'k',
  apiSecret: 's',
  passphrase: 'p',
  isSandbox: true,
  correlationId: 'corr-1',
  tenantId: 'tenant-1',
  accountId: 'account-1',
} as never;

function order(overrides: Record<string, unknown> = {}) {
  return {
    symbol: 'BTC-USDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: '0.01',
    price: '60000',
    clientOrderId: 'cid-1',
    isSimulated: false,
    ...overrides,
  } as never;
}

describe('OkxProductionAdapter — order placement', () => {
  let adapter: OkxProductionAdapter;
  let requestService: ProviderRequestService;
  let sent: { body: string; isIdempotent: boolean | undefined; operation: string }[];

  beforeEach(() => {
    const policyService = new ProviderPolicyService();
    requestService = new ProviderRequestService(policyService);
    const observationService = new ProviderObservationService();
    adapter = new OkxProductionAdapter(policyService, requestService, observationService);
    sent = [];
    jest.spyOn(requestService, 'request').mockImplementation(async (req: any) => {
      sent.push({ body: req.body, isIdempotent: req.isIdempotent, operation: req.operation });
      return { data: { data: [{ ordId: 'ord-1', clOrdId: 'cid-1', sCode: '0' }] }, latencyMs: 1 } as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the venue instrument form for every separator callers use', async () => {
    for (const symbol of ['BTC-USDT', 'BTC/USDT', 'btc:usdt']) {
      sent.length = 0;
      const result = await adapter.createOrder(CONTEXT, order({ symbol }));

      expect(result.success).toBe(true);
      expect(JSON.parse(sent[0].body).instId).toBe('BTC-USDT');
    }
  });

  it('keeps the third segment that makes an instrument a derivative', async () => {
    const result = await adapter.createOrder(CONTEXT, order({ symbol: 'BTC-USDT-SWAP', marginMode: 'cross' }));

    expect(result.success).toBe(true);
    expect(JSON.parse(sent[0].body).instId).toBe('BTC-USDT-SWAP');
    expect(JSON.parse(sent[0].body).tdMode).toBe('cross');
  });

  it('refuses a symbol it cannot resolve, without calling the venue', async () => {
    for (const symbol of ['BTCUSDT', '', 'BTC-USDT-SWAP-260327', 'BTC--USDT', 'BTC/USDT/PERP/EXTRA']) {
      sent.length = 0;
      const result = await adapter.createOrder(CONTEXT, order({ symbol }));

      expect(result.success).toBe(false);
      expect(sent).toHaveLength(0);
    }
  });

  it('uses cash mode for a spot pair and never for a derivative', async () => {
    await adapter.createOrder(CONTEXT, order());
    expect(JSON.parse(sent[0].body).tdMode).toBe('cash');

    sent.length = 0;
    const derivativeInCash = await adapter.createOrder(
      CONTEXT,
      order({ symbol: 'BTC-USDT-SWAP', marginMode: 'cash' }),
    );
    expect(derivativeInCash.success).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('refuses a derivative that carries no margin mode rather than defaulting one', async () => {
    // The defect this replaces: a hard-coded `cash` silently answered this question for every
    // instrument, including the ones cash mode cannot trade.
    sent.length = 0;
    const result = await adapter.createOrder(CONTEXT, order({ symbol: 'BTC-USDT-SWAP' }));

    expect(result.success).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('refuses an unsupported margin mode instead of forwarding it', async () => {
    const result = await adapter.createOrder(CONTEXT, order({ marginMode: 'portfolio' }));

    expect(result.success).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('declares the create idempotent, because clOrdId is the venue deduplication key', async () => {
    await adapter.createOrder(CONTEXT, order());

    expect(sent[0].isIdempotent).toBe(true);
    // The key that makes the claim true has to be in the body it was made about.
    expect(JSON.parse(sent[0].body).clOrdId).toBe('cid-1');
  });

  it('does not reach the venue for a simulated order', async () => {
    const result = await adapter.createOrder(CONTEXT, order({ isSimulated: true }));

    expect(result.success).toBe(true);
    expect(sent).toHaveLength(0);
    expect((result.data as { isSimulated: boolean }).isSimulated).toBe(true);
    // A simulated order still reports the venue's symbol form, not the caller's spelling.
    expect((result.data as { exchangeSymbol: string }).exchangeSymbol).toBe('BTC-USDT');
  });
});
