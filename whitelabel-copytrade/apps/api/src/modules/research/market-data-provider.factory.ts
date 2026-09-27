import { Injectable, Logger } from '@nestjs/common';
import { IMarketDataProvider, MarketDataProviderResult, Candle, Trade, InstrumentMetadata, HistoricalRange } from './market-data-provider.interface';

/**
 * Selects configured historical-data provider while exposing explicit unavailable-data errors and source metadata.
 * No fabricated fallback - fails clearly if data unavailable.
 */

abstract class BaseMarketDataProvider implements IMarketDataProvider {
  abstract getName(): string;
  abstract getSupportedVenues(): string[];
  abstract getSupportedTimeframes(): string[];
  
  async isSymbolSupported(venue: string, symbol: string): Promise<boolean> {
    if (!this.getSupportedVenues().includes(venue)) return false;
    const normalized = symbol.toUpperCase();
    return normalized.length >= 3 && (normalized.includes('-') || normalized.includes('/') || normalized.includes('USDT') || normalized.includes('BTC') || normalized.includes('ETH'));
  }

  protected createUnavailableError(venue: string, symbol: string, timeframe: string, dataType: string): Error {
    return new Error(
      `Historical ${dataType} data not available for ${venue}/${symbol}/${timeframe} from provider ${this.getName()} - ` +
      `no fallback to fabricated data. Use existing dataset ingestion pipeline. ` +
      `If required market data is unavailable, fail clearly per research requirements. ` +
      `Track timeframe/exchange/symbol/timezone/source in request.`
    );
  }

  async getCandles(params: { venue: string; symbol: string; timeframe: string; startTime: string; endTime: string; limit?: number; pageToken?: string | null }): Promise<MarketDataProviderResult<Candle>> {
    throw this.createUnavailableError(params.venue, params.symbol, params.timeframe, 'candle');
  }

  async getTrades(params: { venue: string; symbol: string; startTime: string; endTime: string; limit?: number; pageToken?: string | null }): Promise<MarketDataProviderResult<Trade>> {
    throw new Error(`Historical trade data not available for ${params.venue}/${params.symbol} from provider ${this.getName()} - no fabricated fallback`);
  }

  async getInstrumentMetadata(params: { venue: string; symbol: string }): Promise<InstrumentMetadata | null> {
    return null;
  }

  async getAvailableRange(params: { venue: string; symbol: string; timeframe: string }): Promise<HistoricalRange | null> {
    return null;
  }
}

class BinancePublicDataProvider extends BaseMarketDataProvider {
  private readonly logger = new Logger(BinancePublicDataProvider.name);
  override getName(): string { return 'BINANCE_PUBLIC_DATA'; }
  override getSupportedVenues(): string[] { return ['BINANCE']; }
  override getSupportedTimeframes(): string[] { return ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w']; }
  
  override async getCandles(params: { venue: string; symbol: string; timeframe: string; startTime: string; endTime: string; limit?: number; pageToken?: string | null }): Promise<MarketDataProviderResult<Candle>> {
    // Would integrate with existing HistoricalDataset storage and Binance public data ingestion
    // For now, explicit failure - do not manufacture missing market data
    throw new Error(
      `Historical candle data not available for ${params.venue}/${params.symbol}/${params.timeframe} ` +
      `from provider ${this.getName()} - dataset ingestion pipeline not configured for live fetch. ` +
      `Use existing HistoricalDataset with VALID status and stored files. ` +
      `Source metadata: venue=${params.venue} symbol=${params.symbol} timeframe=${params.timeframe} ` +
      `start=${params.startTime} end=${params.endTime} source=${this.getName()} - fail clearly, do not fabricate.`
    );
  }
}

class BybitMarketDataProvider extends BaseMarketDataProvider {
  override getName(): string { return 'BYBIT_PUBLIC_DATA'; }
  override getSupportedVenues(): string[] { return ['BYBIT']; }
  override getSupportedTimeframes(): string[] { return ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']; }
}

class OkxMarketDataProvider extends BaseMarketDataProvider {
  override getName(): string { return 'OKX_PUBLIC_DATA'; }
  override getSupportedVenues(): string[] { return ['OKX']; }
  override getSupportedTimeframes(): string[] { return ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','3d','1w']; }
}

class KrakenMarketDataProvider extends BaseMarketDataProvider {
  override getName(): string { return 'KRAKEN_PUBLIC_DATA'; }
  override getSupportedVenues(): string[] { return ['KRAKEN']; }
  override getSupportedTimeframes(): string[] { return ['1m','5m','15m','30m','1h','4h','1d','1w']; }
}

class PaperMarketDataProvider extends BaseMarketDataProvider {
  override getName(): string { return 'PAPER_SIMULATED'; }
  override getSupportedVenues(): string[] { return ['PAPER']; }
  override getSupportedTimeframes(): string[] { return ['1m','5m','15m','1h','4h','1d']; }
  
  override async getCandles(params: { venue: string; symbol: string; timeframe: string; startTime: string; endTime: string; limit?: number }): Promise<MarketDataProviderResult<Candle>> {
    // Paper provider could generate deterministic synthetic data for testing, but per requirements:
    // Do not manufacture missing market data for real backtests - fail clearly
    // Paper provider only for PAPER_SIMULATION paper trading sessions, not for research backtests
    throw new Error(
      `Paper provider ${this.getName()} does not provide historical research data for ${params.venue}/${params.symbol}. ` +
      `Use BINANCE_PUBLIC_DATA or LOCAL_FILES with VALID HistoricalDataset. ` +
      `Paper fills are marked PAPER_SIMULATION and never into live tables.`
    );
  }
}

class LocalFileDataProvider extends BaseMarketDataProvider {
  override getName(): string { return 'LOCAL_FILES'; }
  override getSupportedVenues(): string[] { return ['BINANCE','BYBIT','OKX','KRAKEN','PAPER']; }
  override getSupportedTimeframes(): string[] { return ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w']; }
  
  override async isSymbolSupported(): Promise<boolean> { return true; }
  
  override async getCandles(params: { venue: string; symbol: string; timeframe: string; startTime: string; endTime: string }): Promise<MarketDataProviderResult<Candle>> {
    throw new Error(
      `Local file provider ${this.getName()} not configured - historical data unavailable for ${params.venue}/${params.symbol}/${params.timeframe}. ` +
      `Configure dataset ingestion pipeline with HistoricalDataset and HistoricalDatasetVersion with VALID status. ` +
      `No fallback to fabricated data per research requirements.`
    );
  }
}

class HistoricalDatasetProvider extends BaseMarketDataProvider {
  override getName(): string { return 'HISTORICAL_DATASET'; }
  override getSupportedVenues(): string[] { return ['BINANCE','BYBIT','OKX','KRAKEN']; }
  override getSupportedTimeframes(): string[] { return ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w']; }
  
  override async isSymbolSupported(): Promise<boolean> { return true; }
}

@Injectable()
export class MarketDataProviderFactory {
  private readonly logger = new Logger(MarketDataProviderFactory.name);
  private readonly providers: Map<string, IMarketDataProvider> = new Map();

  constructor() {
    const providers: IMarketDataProvider[] = [
      new BinancePublicDataProvider(),
      new BybitMarketDataProvider(),
      new OkxMarketDataProvider(),
      new KrakenMarketDataProvider(),
      new PaperMarketDataProvider(),
      new LocalFileDataProvider(),
      new HistoricalDatasetProvider(),
    ];
    
    for (const provider of providers) {
      this.providers.set(provider.getName(), provider);
    }
    
    this.logger.log(`Market data providers initialized: ${Array.from(this.providers.keys()).join(', ')}`);
  }

  getProvider(name: string): IMarketDataProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Market data provider ${name} not found. Available: ${Array.from(this.providers.keys()).join(', ')} - ` +
        `no fallback to fabricated data. Historical data must come from explicit source/provider abstraction.`
      );
    }
    return provider;
  }

  getDefaultProvider(): IMarketDataProvider {
    return this.providers.get('HISTORICAL_DATASET') || this.providers.get('BINANCE_PUBLIC_DATA') || this.providers.get('LOCAL_FILES')!;
  }

  listProviders(): { name: string; venues: string[]; timeframes: string[] }[] {
    return Array.from(this.providers.values()).map(p => ({ 
      name: p.getName(), 
      venues: p.getSupportedVenues(), 
      timeframes: p.getSupportedTimeframes() 
    }));
  }

  async selectProviderForRequest(params: { venue: string; symbol: string; timeframe: string; preferredProvider?: string }): Promise<IMarketDataProvider> {
    if (params.preferredProvider) {
      const provider = this.getProvider(params.preferredProvider);
      const supported = await provider.isSymbolSupported(params.venue, params.symbol);
      if (!supported) {
        throw new Error(`Symbol ${params.symbol} not supported by provider ${provider.getName()} for venue ${params.venue} - fail clearly`);
      }
      if (!provider.getSupportedVenues().includes(params.venue)) {
        throw new Error(`Venue ${params.venue} not supported by provider ${provider.getName()} - available: ${provider.getSupportedVenues().join(', ')}`);
      }
      if (!provider.getSupportedTimeframes().includes(params.timeframe)) {
        throw new Error(`Timeframe ${params.timeframe} not supported by provider ${provider.getName()} - available: ${provider.getSupportedTimeframes().join(', ')}`);
      }
      return provider;
    }

    // Auto-select first provider supporting venue/timeframe
    for (const provider of this.providers.values()) {
      if (provider.getSupportedVenues().includes(params.venue) && provider.getSupportedTimeframes().includes(params.timeframe)) {
        if (await provider.isSymbolSupported(params.venue, params.symbol)) {
          this.logger.log(`Auto-selected provider ${provider.getName()} for ${params.venue}/${params.symbol}/${params.timeframe}`);
          return provider;
        }
      }
    }

    throw new Error(
      `No market data provider supports venue=${params.venue} symbol=${params.symbol} timeframe=${params.timeframe} - ` +
      `data unavailable, fail clearly. Track timeframe/exchange/symbol/timezone/source. ` +
      `Available providers: ${Array.from(this.providers.keys()).join(', ')}`
    );
  }

  async getAvailableProvidersForVenue(venue: string): Promise<IMarketDataProvider[]> {
    const available: IMarketDataProvider[] = [];
    for (const provider of this.providers.values()) {
      if (provider.getSupportedVenues().includes(venue)) {
        available.push(provider);
      }
    }
    return available;
  }
}
