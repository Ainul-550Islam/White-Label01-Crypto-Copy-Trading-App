// # Adds getCapabilities() and getExchangeFilters(symbol) contract methods
import {
  ExchangeVenue,
  VENUE_CAPABILITIES_MATRIX,
  type VenueCapabilities,
} from '../exchange.types';
import {
  type IExchangeProvider,
  type ExchangeSymbolFilters,
  type ExchangeVenueCapabilities,
} from '../exchange-provider.interface';

export {
  type IExchangeProvider,
  type ExchangeSymbolFilters,
  type ExchangeVenueCapabilities,
  type VenueCapabilities,
};

export function resolveCanonicalVenueCapabilities(
  venue: ExchangeVenue | string,
): VenueCapabilities {
  const key = String(venue).toUpperCase() as ExchangeVenue;
  return (
    VENUE_CAPABILITIES_MATRIX[key] ??
    VENUE_CAPABILITIES_MATRIX[ExchangeVenue.OTHER_CONFIGURED]
  );
}
