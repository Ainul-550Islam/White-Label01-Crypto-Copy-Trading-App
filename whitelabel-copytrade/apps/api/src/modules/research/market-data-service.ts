import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MarketDataProviderFactory } from './market-data-provider.factory';
import { Candle, HistoricalRange } from './market-data-provider.interface';
import { createHash } from 'crypto';

/**
 * Historical market-data retrieval, normalization, gap detection, deduplication, pagination, and dataset fingerprinting.
 */
@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: MarketDataProviderFactory,
  ) {}

  private normalizeSymbol(symbol: string): string {
    return symbol.trim().toUpperCase().replace('/', '-');
  }

  private normalizeTimestamp(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) throw new Error(`Invalid timestamp ${ts}`);
    return d.toISOString();
  }

  private fingerprintDataset(params: { venue: string; symbol: string; timeframe: string; startTime: string; endTime: string; source: string; candles: Candle[] }): string {
    const hash = createHash('sha256');
    hash.update(`${params.venue}|${params.symbol}|${params.timeframe}|${params.startTime}|${params.endTime}|${params.source}|${params.candles.length}`);
    for (const c of params.candles.slice(0, 100)) {
      hash.update(`${c.openTime}|${c.closeTime}|${c.open}|${c.high}|${c.low}|${c.close}|${c.volume}`);
    }
    return hash.digest('hex');
  }

  async getCandles(params: { tenantId: string; venue: string; symbol: string; timeframe: string; startTime: string; endTime: string; source?: string; limit?: number }): Promise<{ candles: Candle[]; fingerprint: string; source: string; completeness: string; range: HistoricalRange }> {
    const normalizedSymbol = this.normalizeSymbol(params.symbol);
    const startTime = this.normalizeTimestamp(params.startTime);
    const endTime = this.normalizeTimestamp(params.endTime);

    // First try existing HistoricalDataset storage if available
    try {
      const dataset = await this.prisma.historicalDataset.findFirst({
        where: { venue: params.venue as any, symbols: { has: normalizedSymbol }, granularity: params.timeframe },
        orderBy: { createdAt: 'desc' },
        include: { versions: { where: { status: 'VALID' }, orderBy: { version: 'desc' }, take: 1 } },
      });

      if (dataset && dataset.versions.length > 0) {
        // In real implementation, would read files from storage
        this.logger.log(`Found existing dataset ${dataset.datasetKey} for ${params.venue}/${normalizedSymbol}/${params.timeframe}`);
        // For now, we still need to fetch via provider abstraction
      }
    } catch {}

    // Use provider factory
    const provider = await this.providerFactory.selectProviderForRequest({ venue: params.venue, symbol: normalizedSymbol, timeframe: params.timeframe, preferredProvider: params.source });

    // Attempt to retrieve - provider may throw explicit unavailable error
    try {
      const result = await provider.getCandles({ venue: params.venue, symbol: normalizedSymbol, timeframe: params.timeframe, startTime, endTime, limit: params.limit });

      // Deduplicate records
      const deduped = this.deduplicateCandles(result.data);

      // Normalize timestamps
      const normalized = deduped.map(c => ({ ...c, openTime: this.normalizeTimestamp(c.openTime), closeTime: this.normalizeTimestamp(c.closeTime), symbol: this.normalizeSymbol(c.symbol) }));

      const fingerprint = this.fingerprintDataset({ venue: params.venue, symbol: normalizedSymbol, timeframe: params.timeframe, startTime, endTime, source: result.source, candles: normalized });

      const range: HistoricalRange = {
        venue: params.venue,
        symbol: normalizedSymbol,
        timeframe: params.timeframe,
        startTime,
        endTime,
        source: result.source,
        dataTimestamp: result.dataTimestamp,
        completeness: result.completeness,
        recordCount: normalized.length,
        firstRecordTime: normalized[0]?.openTime || null,
        lastRecordTime: normalized[normalized.length-1]?.openTime || null,
      };

      return { candles: normalized, fingerprint, source: result.source, completeness: result.completeness, range };
    } catch (e: any) {
      // Explicit failure - do not manufacture missing data
      this.logger.warn(`Market data unavailable tenant=${params.tenantId} venue=${params.venue} symbol=${normalizedSymbol} timeframe=${params.timeframe} error=${e.message}`);
      throw new Error(`Historical market data unavailable for ${params.venue}/${normalizedSymbol}/${params.timeframe} from ${startTime} to ${endTime}: ${e.message}. If required market data is unavailable, fail clearly.`);
    }
  }

  private deduplicateCandles(candles: Candle[]): Candle[] {
    const seen = new Map<string, Candle>();
    for (const c of candles) {
      const key = `${c.symbol}|${c.timeframe}|${c.openTime}`;
      if (!seen.has(key)) seen.set(key, c);
    }
    return Array.from(seen.values()).sort((a,b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());
  }

  async detectGaps(candles: Candle[], timeframe: string): Promise<{ gaps: { start: string; end: string; missingCount: number }[]; gapPercentage: number }> {
    if (candles.length < 2) return { gaps: [], gapPercentage: 0 };

    const timeframeMs = this.timeframeToMs(timeframe);
    const gaps: { start: string; end: string; missingCount: number }[] = [];

    for (let i=1; i<candles.length; i++) {
      const prev = new Date(candles[i-1].closeTime).getTime();
      const curr = new Date(candles[i].openTime).getTime();
      const diff = curr - prev;
      if (diff > timeframeMs * 1.5) {
        const missing = Math.floor(diff / timeframeMs) - 1;
        gaps.push({ start: candles[i-1].closeTime, end: candles[i].openTime, missingCount: missing });
      }
    }

    const totalExpected = Math.floor((new Date(candles[candles.length-1].openTime).getTime() - new Date(candles[0].openTime).getTime()) / timeframeMs) + 1;
    const gapPercentage = totalExpected > 0 ? (gaps.reduce((s,g)=>s+g.missingCount,0) / totalExpected) * 100 : 0;

    return { gaps, gapPercentage };
  }

  private timeframeToMs(tf: string): number {
    const map: Record<string, number> = {
      '1m': 60*1000,
      '3m': 3*60*1000,
      '5m': 5*60*1000,
      '15m': 15*60*1000,
      '30m': 30*60*1000,
      '1h': 60*60*1000,
      '2h': 2*60*60*1000,
      '4h': 4*60*60*1000,
      '6h': 6*60*60*1000,
      '8h': 8*60*60*1000,
      '12h': 12*60*60*1000,
      '1d': 24*60*60*1000,
      '3d': 3*24*60*60*1000,
      '1w': 7*24*60*60*1000,
    };
    return map[tf] || 60*1000;
  }

  async getAvailableRange(params: { venue: string; symbol: string; timeframe: string }): Promise<HistoricalRange | null> {
    try {
      const provider = await this.providerFactory.selectProviderForRequest(params);
      return provider.getAvailableRange(params);
    } catch {
      return null;
    }
  }
}
