// # Kraken Spot/Futures REST adapter (balances, place/cancel/query order)
import { KrakenProvider } from '../venues/kraken.provider';
import { ExchangeVenue, VENUE_CAPABILITIES_MATRIX, type VenueCapabilities } from '../exchange.types';

export { KrakenProvider };

export const KRAKEN_CAPABILITIES: VenueCapabilities =
  VENUE_CAPABILITIES_MATRIX[ExchangeVenue.KRAKEN];

export function normalizeKrakenPairSymbol(canonicalSymbol: string): string {
  const cleaned = canonicalSymbol.trim().toUpperCase().replace('-', '/');
  if (cleaned.startsWith('BTC/')) {
    return cleaned.replace(/^BTC\//, 'XBT/');
  }
  return cleaned;
}

export default KrakenProvider;
