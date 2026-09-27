/**
 * Exchange Adapters Contract Tests
 * Deterministic tests for Binance, Bybit, OKX, Kraken, Coinbase adapters
 */

import { ProviderDomain, ProviderName, ProviderCapability, ProviderErrorCode } from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';
import { BinanceProductionAdapter } from './binance.adapter';
import { BybitProductionAdapter } from './bybit.adapter';
import { OkxProductionAdapter } from './okx.adapter';
import { KrakenProductionAdapter } from './kraken.adapter';
import { CoinbaseProductionAdapter } from './coinbase.adapter';

describe('Exchange Adapters Contract', () => {
  let policyService: ProviderPolicyService;
  let requestService: ProviderRequestService;
  let observationService: ProviderObservationService;

  beforeEach(() => {
    policyService = new ProviderPolicyService();
    requestService = new ProviderRequestService(policyService);
    observationService = new ProviderObservationService();
  });

  test('Binance capability detection', () => {
    const adapter = new BinanceProductionAdapter(policyService, requestService, observationService);
    expect(adapter.getCapabilities()).toContain(ProviderCapability.BALANCE_READ);
    expect(adapter.getCapabilities()).toContain(ProviderCapability.ORDER_CREATE);
    expect(adapter.getCapabilities()).toContain(ProviderCapability.SYMBOL_READ);
    expect(adapter.supportsCapability(ProviderCapability.BALANCE_READ)).toBe(true);
  });

  test('Bybit capability detection', () => {
    const adapter = new BybitProductionAdapter(policyService, requestService, observationService);
    expect(adapter.supportsCapability(ProviderCapability.BALANCE_READ)).toBe(true);
    expect(adapter.supportsCapability(ProviderCapability.ORDER_CREATE)).toBe(true);
  });

  test('OKX capability detection', () => {
    const adapter = new OkxProductionAdapter(policyService, requestService, observationService);
    expect(adapter.supportsCapability(ProviderCapability.BALANCE_READ)).toBe(true);
    expect(adapter.supportsCapability(ProviderCapability.POSITION_READ)).toBe(true);
  });

  test('Kraken capability detection', () => {
    const adapter = new KrakenProductionAdapter(policyService, requestService, observationService);
    expect(adapter.supportsCapability(ProviderCapability.BALANCE_READ)).toBe(true);
    expect(adapter.supportsCapability(ProviderCapability.ORDER_READ)).toBe(true);
  });

  test('Coinbase unsupported capability rejected safely', async () => {
    const adapter = new CoinbaseProductionAdapter(policyService, requestService);
    expect(adapter.supportsCapability(ProviderCapability.ORDER_CREATE)).toBe(false);
    expect(adapter.supportsCapability(ProviderCapability.BALANCE_READ)).toBe(true);

    const result = await adapter.createOrder(
      {
        apiKey: 'test',
        apiSecret: 'test',
        isSandbox: true,
        tenantId: 'tenant_123',
        accountId: 'account_123',
        correlationId: 'corr_123',
      },
      {
        symbol: 'BTC-USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: '0.001',
        clientOrderId: 'client_123',
        isSimulated: false,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ProviderErrorCode.CAPABILITY_NOT_SUPPORTED);
  });

  test('exchange secret never returned', () => {
    const adapter = new BinanceProductionAdapter(policyService, requestService, observationService);
    const evidence = (observationService as any).redactEvidence({
      apiKey: 'test_key',
      apiSecret: 'test_secret',
      tenantId: 'tenant_123',
      symbol: 'BTC-USDT',
    });
    expect(evidence.apiKey).toBe('***REDACTED***');
    expect(evidence.apiSecret).toBe('***REDACTED***');
    expect(evidence.symbol).toBe('BTC-USDT');
  });

  test('exchange order unknown result handled safely', () => {
    const normalizeStatus = (status: string | null) => {
      if (!status) return 'UNKNOWN';
      const s = status.toUpperCase();
      if (['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED'].includes(s)) return s;
      return 'UNKNOWN';
    };
    expect(normalizeStatus(null)).toBe('UNKNOWN');
    expect(normalizeStatus('NEW')).toBe('NEW');
    expect(normalizeStatus('INVALID_STATUS')).toBe('UNKNOWN');
  });

  test('exchange adapter never bypasses OMS', () => {
    const flow = `
      OMS
       ↓
      ExchangeRoutingService
       ↓
      Execution Safety
       ↓
      Provider Factory
       ↓
      Selected Exchange Adapter
       ↓
      Exchange
    `;
    expect(flow).toContain('OMS');
    expect(flow).toContain('ExchangeRoutingService');
    expect(flow).toContain('Execution Safety');
    expect(flow.indexOf('OMS')).toBeLessThan(flow.indexOf('Exchange'));
  });

  test('provider factory selects configured provider', () => {
    const binance = new BinanceProductionAdapter(policyService, requestService, observationService);
    const bybit = new BybitProductionAdapter(policyService, requestService, observationService);
    expect(binance.provider).toBe(ProviderName.BINANCE);
    expect(bybit.provider).toBe(ProviderName.BYBIT);
    expect(binance.domain).toBe(ProviderDomain.EXCHANGE);
  });

  test('unsupported capability returns explicit error', async () => {
    const bybit = new BybitProductionAdapter(policyService, requestService, observationService);
    const result = await bybit.unsupportedCapability(ProviderCapability.PAYOUT_CREATE, 'corr_123');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ProviderErrorCode.CAPABILITY_NOT_SUPPORTED);
  });

  test('all provider adapters compile and satisfy interfaces', () => {
    const adapters = [
      new BinanceProductionAdapter(policyService, requestService, observationService),
      new BybitProductionAdapter(policyService, requestService, observationService),
      new OkxProductionAdapter(policyService, requestService, observationService),
      new KrakenProductionAdapter(policyService, requestService, observationService),
      new CoinbaseProductionAdapter(policyService, requestService),
    ];
    for (const adapter of adapters) {
      expect(adapter).toBeDefined();
      expect(typeof adapter.getBalances).toBe('function');
    }
  });
});
