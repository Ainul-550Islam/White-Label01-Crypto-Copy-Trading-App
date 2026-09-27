import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeSymbol } from './exchange.types';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeProviderContext } from './exchange-provider.interface';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { randomUUID } from 'crypto';

/**
 * Symbol/instrument normalization: base/quote, precision, quantity step, tick size, min/max quantity/notional, contract type, and canonical internal symbol mapping.
 * Use exchange-provided metadata. Never guess exchange precision.
 */
@Injectable()
export class ExchangeSymbolService {
  private readonly logger = new Logger(ExchangeSymbolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: ExchangeProviderFactory,
    private readonly credentialService: ExchangeCredentialService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly cache: CacheService,
  ) {}

  private toCanonicalSymbol(base: string, quote: string): string {
    // Canonical format: BTC-USDT
    return `${base.toUpperCase()}-${quote.toUpperCase()}`;
  }

  private parseSymbolFromExchangeFormat(venue: ExchangeVenue, exchangeSymbol: string): { base: string; quote: string } | null {
    // Venue-specific parsing - must use provider metadata, never guess blindly
    // But we implement basic parsing as fallback when provider metadata unavailable
    try {
      if (venue === ExchangeVenue.BINANCE || venue === ExchangeVenue.BYBIT) {
        // BTCUSDT -> BTC + USDT (need to know quote assets)
        const quotes = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'USD', 'EUR'];
        for (const q of quotes) {
          if (exchangeSymbol.endsWith(q)) {
            const base = exchangeSymbol.slice(0, -q.length);
            if (base) return { base, quote: q };
          }
        }
        return null;
      }

      if (venue === ExchangeVenue.OKX || venue === ExchangeVenue.COINBASE) {
        // BTC-USDT or BTC-USD
        const parts = exchangeSymbol.split('-');
        if (parts.length === 2) return { base: parts[0], quote: parts[1] };
        return null;
      }

      if (venue === ExchangeVenue.KRAKEN) {
        // XBT/USD or XXBTZUSD
        if (exchangeSymbol.includes('/')) {
          const parts = exchangeSymbol.split('/');
          if (parts.length === 2) return { base: parts[0], quote: parts[1] };
        }
        return null;
      }

      // Generic fallback: try dash, slash, then assume last 4 chars are quote
      if (exchangeSymbol.includes('-')) {
        const [b, q] = exchangeSymbol.split('-');
        return { base: b, quote: q };
      }
      if (exchangeSymbol.includes('/')) {
        const [b, q] = exchangeSymbol.split('/');
        return { base: b, quote: q };
      }
      return null;
    } catch {
      return null;
    }
  }

  async syncSymbols(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment }): Promise<{ synced: number; created: number; updated: number }> {
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e: any) {
      this.logger.warn(`Provider unavailable for symbol sync tenant=${input.tenantId} venue=${input.venue} error=${e.message}`);
      return { synced: 0, created: 0, updated: 0 };
    }

    let credentials;
    try {
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch {
      // Symbols can often be fetched without auth - try with empty creds
      credentials = { apiKey: '', apiSecret: '' } as any;
    }

    const context: ExchangeProviderContext = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      isSandbox,
      credentials: {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: (credentials as any).passphrase,
        environment: input.environment,
        isSandbox,
      },
      credentialRef: null,
    };

    let symbols: ExchangeSymbol[];
    try {
      symbols = await provider.getSymbols(context);
    } catch (e: any) {
      this.logger.error(`Failed to fetch symbols tenant=${input.tenantId} venue=${input.venue} error=${e.message}`);
      return { synced: 0, created: 0, updated: 0 };
    }

    let created = 0;
    let updated = 0;

    for (const sym of symbols) {
      try {
        // Symbol precision comes from provider metadata - never guess
        if (!sym.tickSize || !sym.quantityStep) {
          this.logger.warn(`Skipping symbol with missing precision tenant=${input.tenantId} symbol=${sym.exchangeSymbol}`);
          continue;
        }

        const existing = await this.prisma.tradingSymbol.findFirst({
          where: { tenantId: input.tenantId, exchangeId: (await this.getExchangeId(input.venue)), symbol: sym.canonicalSymbol },
        });

        if (existing) {
          await this.prisma.tradingSymbol.update({
            where: { id: existing.id },
            data: {
              venueSymbol: sym.exchangeSymbol,
              baseAsset: sym.baseAsset,
              quoteAsset: sym.quoteAsset,
              priceTick: sym.tickSize as any,
              quantityStep: sym.quantityStep as any,
              minQuantity: sym.minQuantity as any,
              maxQuantity: sym.maxQuantity as any,
              minNotional: sym.minNotional as any,
              pricePrecision: sym.pricePrecision,
              quantityPrecision: sym.quantityPrecision,
              isTradeable: sym.isTradeable,
              updatedAt: new Date(),
            },
          });
          updated++;
        } else {
          const exchangeId = await this.getExchangeId(input.venue);
          await this.prisma.tradingSymbol.create({
            data: {
              id: randomUUID(),
              tenantId: input.tenantId,
              exchangeId,
              symbol: sym.canonicalSymbol,
              venueSymbol: sym.exchangeSymbol,
              baseAsset: sym.baseAsset,
              quoteAsset: sym.quoteAsset,
              marketType: (sym.contractType as any) || 'SPOT',
              isTradeable: sym.isTradeable,
              isSubscribed: false,
              priceTick: sym.tickSize as any,
              quantityStep: sym.quantityStep as any,
              minQuantity: sym.minQuantity as any || (0 as any),
              maxQuantity: sym.maxQuantity as any,
              minNotional: sym.minNotional as any || (0 as any),
              pricePrecision: sym.pricePrecision,
              quantityPrecision: sym.quantityPrecision,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          created++;
        }

        // Cache symbol for fast lookup
        try {
          await this.cache.set(`symbol:${input.tenantId}:${sym.canonicalSymbol}`, sym, 3600);
          await this.cache.set(`symbol:${input.tenantId}:${sym.exchangeSymbol}`, sym, 3600);
        } catch {}
      } catch (e: any) {
        this.logger.warn(`Failed to sync symbol ${sym.exchangeSymbol} tenant=${input.tenantId} error=${e.message}`);
      }
    }

    this.logger.log(`Symbol sync completed tenant=${input.tenantId} venue=${input.venue} synced=${symbols.length} created=${created} updated=${updated}`);

    return { synced: symbols.length, created, updated };
  }

  async getSymbol(tenantId: string, canonicalSymbol: string): Promise<ExchangeSymbol | null> {
    try {
      const cached = await this.cache.get<ExchangeSymbol>(`symbol:${tenantId}:${canonicalSymbol}`);
      if (cached) return cached;
    } catch {}

    const record = await this.prisma.tradingSymbol.findFirst({
      where: { tenantId, symbol: canonicalSymbol },
    });

    if (!record) return null;

    return {
      canonicalSymbol: record.symbol,
      exchangeSymbol: record.venueSymbol,
      baseAsset: record.baseAsset,
      quoteAsset: record.quoteAsset,
      contractType: record.marketType as any,
      tickSize: record.priceTick.toString(),
      quantityStep: record.quantityStep.toString(),
      minQuantity: record.minQuantity?.toString() || null,
      maxQuantity: record.maxQuantity?.toString() || null,
      minNotional: record.minNotional?.toString() || null,
      maxNotional: (record as any).maxOrderNotional?.toString() || null,
      pricePrecision: record.pricePrecision,
      quantityPrecision: record.quantityPrecision,
      minLeverage: null,
      maxLeverage: null,
      isTradeable: record.isTradeable,
    };
  }

  async listSymbols(tenantId: string, filters?: { baseAsset?: string; quoteAsset?: string; isTradeable?: boolean; search?: string; page?: number; limit?: number }): Promise<{ data: ExchangeSymbol[]; total: number }> {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 50, 200);
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      ...(filters?.baseAsset ? { baseAsset: filters.baseAsset } : {}),
      ...(filters?.quoteAsset ? { quoteAsset: filters.quoteAsset } : {}),
      ...(filters?.isTradeable !== undefined ? { isTradeable: filters.isTradeable } : {}),
      ...(filters?.search ? { symbol: { contains: filters.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tradingSymbol.findMany({ where, orderBy: { symbol: 'asc' }, skip, take: limit }),
      this.prisma.tradingSymbol.count({ where }),
    ]);

    const data = rows.map((r) => ({
      canonicalSymbol: r.symbol,
      exchangeSymbol: r.venueSymbol,
      baseAsset: r.baseAsset,
      quoteAsset: r.quoteAsset,
      contractType: r.marketType as any,
      tickSize: r.priceTick.toString(),
      quantityStep: r.quantityStep.toString(),
      minQuantity: r.minQuantity?.toString() || null,
      maxQuantity: r.maxQuantity?.toString() || null,
      minNotional: r.minNotional?.toString() || null,
      maxNotional: (r as any).maxOrderNotional?.toString() || null,
      pricePrecision: r.pricePrecision,
      quantityPrecision: r.quantityPrecision,
      minLeverage: null,
      maxLeverage: null,
      isTradeable: r.isTradeable,
    }));

    return { data, total };
  }

  private async getExchangeId(venue: ExchangeVenue): Promise<string> {
    const exchange = await this.prisma.exchange.findFirst({ where: { venue: venue as any } });
    if (!exchange) throw new Error(`Exchange ${venue} not found`);
    return exchange.id;
  }
}
