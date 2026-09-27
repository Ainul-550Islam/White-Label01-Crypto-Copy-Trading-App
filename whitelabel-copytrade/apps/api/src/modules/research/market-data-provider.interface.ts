/**
 * Provider-neutral market-data contract for candles, trades, quotes, order-book snapshots, symbol metadata, and historical ranges.
 */

export interface Candle {
  openTime: string; // ISO
  closeTime: string; // ISO
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume?: string | null;
  tradeCount?: number | null;
  symbol: string;
  venue: string;
  timeframe: string;
  source: string;
}

export interface Trade {
  tradeId: string;
  symbol: string;
  venue: string;
  side: string;
  price: string;
  quantity: string;
  timestamp: string; // ISO
  source: string;
}

export interface Quote {
  symbol: string;
  venue: string;
  bidPrice: string;
  bidQuantity: string;
  askPrice: string;
  askQuantity: string;
  timestamp: string;
  source: string;
}

export interface OrderBookSnapshot {
  symbol: string;
  venue: string;
  bids: { price: string; quantity: string }[];
  asks: { price: string; quantity: string }[];
  timestamp: string;
  source: string;
}

export interface InstrumentMetadata {
  symbol: string;
  venueSymbol: string;
  venue: string;
  baseAsset: string;
  quoteAsset: string;
  marketType: string;
  priceTick: string;
  quantityStep: string;
  minQuantity: string;
  maxQuantity: string | null;
  minNotional: string;
  pricePrecision: number;
  quantityPrecision: number;
  source: string;
}

export interface HistoricalRange {
  venue: string;
  symbol: string;
  timeframe: string;
  startTime: string;
  endTime: string;
  source: string;
  dataTimestamp: string;
  completeness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  recordCount: number;
  firstRecordTime: string | null;
  lastRecordTime: string | null;
}

export interface MarketDataProviderResult<T> {
  data: T[];
  source: string;
  venue: string;
  symbol: string;
  timeframe: string;
  startTime: string;
  endTime: string;
  dataTimestamp: string;
  completeness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  hasMore: boolean;
  nextPageToken?: string | null;
}

export interface IMarketDataProvider {
  getName(): string;
  getSupportedVenues(): string[];
  getSupportedTimeframes(): string[];
  isSymbolSupported(venue: string, symbol: string): Promise<boolean>;
  getCandles(params: { venue: string; symbol: string; timeframe: string; startTime: string; endTime: string; limit?: number; pageToken?: string | null }): Promise<MarketDataProviderResult<Candle>>;
  getTrades(params: { venue: string; symbol: string; startTime: string; endTime: string; limit?: number; pageToken?: string | null }): Promise<MarketDataProviderResult<Trade>>;
  getQuotes?(params: { venue: string; symbol: string; startTime: string; endTime: string; limit?: number }): Promise<MarketDataProviderResult<Quote>>;
  getOrderBookSnapshot?(params: { venue: string; symbol: string; timestamp?: string }): Promise<OrderBookSnapshot | null>;
  getInstrumentMetadata(params: { venue: string; symbol: string }): Promise<InstrumentMetadata | null>;
  getAvailableRange(params: { venue: string; symbol: string; timeframe: string }): Promise<HistoricalRange | null>;
}
