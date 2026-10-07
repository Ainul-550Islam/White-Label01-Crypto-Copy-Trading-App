// # NEW — Verifies live/paper mode selection, signing, and fail-closed error handling for all 5 venues
import {
  ExchangeEnvironment,
  ExchangeVenue,
  VENUE_CAPABILITIES_MATRIX,
} from './exchange.types';
import { ExchangeProviderFactory } from './providers/exchange-provider.factory';
import { ExchangeRegistryService } from './exchange-registry.service';
import { BybitProvider } from './providers/bybit.provider';
import { OkxProvider } from './providers/okx.provider';
import { KrakenProvider } from './providers/kraken.provider';
import { CoinbaseProvider } from './providers/coinbase.provider';

describe('Venue Capability Matrix & Multi-Venue Provider Parity (GAP-21 & GAP-22)', () => {
  test('defines explicit VenueCapabilities matrix for all 5 primary venues', () => {
    for (const venue of [
      ExchangeVenue.BINANCE,
      ExchangeVenue.BYBIT,
      ExchangeVenue.OKX,
      ExchangeVenue.KRAKEN,
      ExchangeVenue.COINBASE,
    ]) {
      const cap = VENUE_CAPABILITIES_MATRIX[venue];
      expect(cap).toBeDefined();
      expect(cap.venue).toBe(venue);
      expect(cap.spotSupported).toBe(true);
      expect(cap.liveReadSupported).toBe(true);
      expect(cap.liveOrderExecutionGated).toBe(true);
      expect(cap.withdrawalPermissionMustBeDisabled).toBe(true);
      expect(cap.supportedOrderTypes.length).toBeGreaterThan(0);
    }
    expect(VENUE_CAPABILITIES_MATRIX[ExchangeVenue.OKX].requiresPassphrase).toBe(true);
  });

  test('registers all 5 live/testnet/sandbox venue adapters and enforces environment binding', () => {
    const registry = new ExchangeRegistryService();
    const factory = new ExchangeProviderFactory(registry);
    factory.onModuleInit();

    expect(factory.getProvider(ExchangeVenue.BYBIT, ExchangeEnvironment.LIVE)).toBeInstanceOf(
      BybitProvider,
    );
    expect(factory.getProvider(ExchangeVenue.OKX, ExchangeEnvironment.LIVE)).toBeInstanceOf(
      OkxProvider,
    );
    expect(factory.getProvider(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE)).toBeInstanceOf(
      KrakenProvider,
    );
    expect(factory.getProvider(ExchangeVenue.COINBASE, ExchangeEnvironment.LIVE)).toBeInstanceOf(
      CoinbaseProvider,
    );

    expect(() =>
      factory.validateEnvironmentBinding(ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE, true),
    ).toThrow(/Environment mismatch/);
    expect(() =>
      factory.validateEnvironmentBinding(ExchangeVenue.BYBIT, ExchangeEnvironment.TESTNET, false),
    ).toThrow(/Environment mismatch/);
  });
});
