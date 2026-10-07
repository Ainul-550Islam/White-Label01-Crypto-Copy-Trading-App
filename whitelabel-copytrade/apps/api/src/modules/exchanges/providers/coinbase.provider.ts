// # Coinbase Advanced Trade REST adapter (accounts, place/cancel/query order)
import { CoinbaseProvider } from '../venues/coinbase.provider';
import { ExchangeVenue, VENUE_CAPABILITIES_MATRIX, type VenueCapabilities } from '../exchange.types';

export { CoinbaseProvider };

export const COINBASE_ADVANCED_CAPABILITIES: VenueCapabilities =
  VENUE_CAPABILITIES_MATRIX[ExchangeVenue.COINBASE];

export function normalizeCoinbaseProductId(canonicalSymbol: string): string {
  return canonicalSymbol.trim().toUpperCase().replace('/', '-');
}

export default CoinbaseProvider;
