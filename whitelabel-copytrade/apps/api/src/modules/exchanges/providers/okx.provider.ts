// # OKX V5 REST/WS adapter (balances, positions, place/cancel/query order, passphrase)
import { OkxProvider } from '../venues/okx.provider';
import { ExchangeVenue, VENUE_CAPABILITIES_MATRIX, type VenueCapabilities } from '../exchange.types';

export { OkxProvider };

export const OKX_V5_CAPABILITIES: VenueCapabilities =
  VENUE_CAPABILITIES_MATRIX[ExchangeVenue.OKX];

export function formatOkxV5PrehashString(params: {
  timestampIso: string;
  method: string;
  requestPath: string;
  body?: string;
}): string {
  return `${params.timestampIso}${params.method.toUpperCase()}${params.requestPath}${params.body ?? ''}`;
}

export default OkxProvider;
