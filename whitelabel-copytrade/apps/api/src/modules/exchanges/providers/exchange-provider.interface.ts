// # Responsibility: expose canonical exchange types and static venue capabilities without adding execution paths.
import {
  ExchangeVenue,
  VENUE_CAPABILITIES_MATRIX,
  type ExchangeSymbol,
  type VenueCapabilities,
} from '../exchange.types';
import type { ExchangeProvider } from '../exchange-provider.interface';

export type IExchangeProvider = ExchangeProvider;
export type ExchangeSymbolFilters = Pick<
  ExchangeSymbol,
  | 'tickSize'
  | 'quantityStep'
  | 'minQuantity'
  | 'maxQuantity'
  | 'minNotional'
  | 'maxNotional'
  | 'pricePrecision'
  | 'quantityPrecision'
>;
export type ExchangeVenueCapabilities = Awaited<ReturnType<ExchangeProvider['getCapabilities']>>;
export type { VenueCapabilities };

export function resolveCanonicalVenueCapabilities(
  venue: ExchangeVenue | string,
): VenueCapabilities {
  const normalized = String(venue).toUpperCase();
  const key = Object.values(ExchangeVenue).find((candidate) => candidate === normalized)
    ?? ExchangeVenue.OTHER_CONFIGURED;
  return VENUE_CAPABILITIES_MATRIX[key];
}
