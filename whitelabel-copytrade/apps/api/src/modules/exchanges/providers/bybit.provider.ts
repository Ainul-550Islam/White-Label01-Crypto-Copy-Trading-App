// # Bybit V5 REST/WS adapter (balances, positions, place/cancel/query order)
import { BybitProvider } from '../venues/bybit.provider';
import { ExchangeVenue, VENUE_CAPABILITIES_MATRIX, type VenueCapabilities } from '../exchange.types';

export { BybitProvider };

export const BYBIT_V5_CAPABILITIES: VenueCapabilities =
  VENUE_CAPABILITIES_MATRIX[ExchangeVenue.BYBIT];

export function formatBybitV5SignPayload(params: {
  timestampMs: string;
  apiKey: string;
  recvWindowMs: string;
  queryOrBody: string;
}): string {
  return `${params.timestampMs}${params.apiKey}${params.recvWindowMs}${params.queryOrBody}`;
}

export default BybitProvider;
