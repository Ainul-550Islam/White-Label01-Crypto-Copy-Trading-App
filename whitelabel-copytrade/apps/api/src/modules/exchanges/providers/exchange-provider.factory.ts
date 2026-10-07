// # Resolves venue adapter by venue code and mode (PAPER | SANDBOX | LIVE)
import { ExchangeProviderFactory } from '../exchange-provider.factory';
import { ExchangeVenue, VENUE_CAPABILITIES_MATRIX, type VenueCapabilities } from '../exchange.types';

export { ExchangeProviderFactory };

export type ExchangeExecutionMode = 'PAPER' | 'SANDBOX' | 'LIVE';

export function listRegisteredVenueCapabilities(): VenueCapabilities[] {
  return [
    VENUE_CAPABILITIES_MATRIX[ExchangeVenue.BINANCE],
    VENUE_CAPABILITIES_MATRIX[ExchangeVenue.BYBIT],
    VENUE_CAPABILITIES_MATRIX[ExchangeVenue.OKX],
    VENUE_CAPABILITIES_MATRIX[ExchangeVenue.KRAKEN],
    VENUE_CAPABILITIES_MATRIX[ExchangeVenue.COINBASE],
  ];
}

export default ExchangeProviderFactory;
