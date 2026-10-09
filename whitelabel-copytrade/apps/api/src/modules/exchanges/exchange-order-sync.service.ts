import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeSyncState, ExchangeOrder, ExchangeFill, isValidOrderStatusTransition, ExchangeOrderStatus, normalizeTimestampMicros } from './exchange.types';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangeProviderContext } from './exchange-provider.interface';
import { TradeLifecycleService } from '../oms/trade-lifecycle.service';
import { randomUUID } from 'crypto';

/**
 * The order fields the fill sync reads. Declared narrowly on purpose: `ReturnType<typeof
 * prisma.order.findFirst>` resolves through a heavily overloaded generic and makes type inference
 * dramatically more expensive for the whole project, for no extra safety over naming the fields.
 */
interface SyncOrderContext {
  id: string;
  accountId: string;
  symbol: string;
  venue: any;
  strategyId: string | null;
}

/**
 * Synchronize orders, fills, trades with idempotent upsert, valid status transitions, no duplicate fills, provider reference uniqueness, preserve provider raw status safely.
 */
@Injectable()
export class ExchangeOrderSyncService {
  private readonly logger = new Logger(ExchangeOrderSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: ExchangeProviderFactory,
    private readonly credentialService: ExchangeCredentialService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly auditService: ExchangeAuditService,
    // Applying the fill to the canonical OMS trade and inserting the fill are one unit of work, so the
    // trade builder's transactional entry point is used below.
    private readonly tradeLifecycleService: TradeLifecycleService,
  ) {}

  private toDecimalString(value: string | number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      if (value.trim() === '') return null;
      if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
        this.logger.warn(`Invalid decimal for order: ${value}`);
        return null;
      }
      return value.trim();
    }
    return value.toString();
  }

  async syncOrders(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment; symbol?: string; actorId?: string; requestId?: string }): Promise<{ state: ExchangeSyncState; processed: number; created: number; updated: number; skipped: number; durationMs: number }> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    const account = await this.accountRepo.findById(input.accountId, input.tenantId);
    if (!account) throw new Error(`Account ${input.accountId} not found`);

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e: any) {
      this.logger.warn(`Provider unavailable for order sync tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let credentials;
    try {
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch (e: any) {
      this.logger.warn(`Credential unavailable for order sync tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
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
        passphrase: credentials.passphrase,
        environment: input.environment,
        isSandbox,
      },
      credentialRef: null,
    };

    let orders: ExchangeOrder[];
    try {
      orders = await provider.getOpenOrders(context, input.symbol);
      // Also fetch history for idempotency
      const history = await provider.getOrderHistory(context, input.symbol, 100);
      // Merge open + history, dedupe by providerOrderId
      const seen = new Set<string>();
      const merged: ExchangeOrder[] = [];
      for (const o of [...orders, ...history]) {
        const key = o.providerOrderId || o.clientOrderId;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(o);
        }
      }
      orders = merged;
    } catch (e: any) {
      this.logger.error(`Failed to fetch orders tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} error=${e.message}`);
      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: input.accountId,
        venue: input.venue,
        environment: input.environment,
        event: 'ORDER_SYNCED',
        result: 'FAILURE',
        actorId: input.actorId,
        safeMetadata: { errorCode: e.code || 'FETCH_FAILED', isSandbox },
        requestId: input.requestId,
      });
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const order of orders) {
      try {
        const quantity = this.toDecimalString(order.quantity);
        if (!quantity) {
          skipped++;
          continue;
        }

        // Find symbolId
        const symbolRecord = await this.prisma.tradingSymbol.findFirst({
          where: { tenantId: input.tenantId, symbol: order.symbol },
          select: { id: true },
        });

        if (!symbolRecord) {
          this.logger.warn(`Symbol not found for order sync tenant=${input.tenantId} symbol=${order.symbol}`);
          skipped++;
          continue;
        }

        // Check existing by clientOrderId (unique per tenant) or providerOrderId
        let existing = await this.prisma.order.findFirst({
          where: { tenantId: input.tenantId, clientOrderId: order.clientOrderId },
        });

        if (!existing && order.providerOrderId) {
          existing = await this.prisma.order.findFirst({
            where: { tenantId: input.tenantId, exchangeOrderId: order.providerOrderId },
          });
        }

        if (existing) {
          // Validate status transition
          const fromStatus = existing.status as unknown as ExchangeOrderStatus;
          const toStatus = order.status as unknown as ExchangeOrderStatus;
          if (fromStatus && toStatus && !isValidOrderStatusTransition(fromStatus, toStatus)) {
            this.logger.warn(`Invalid order status transition rejected tenant=${input.tenantId} account=${input.accountId} order=${existing.id} from=${fromStatus} to=${toStatus}`);
            await this.auditService.record({
              tenantId: input.tenantId,
              accountId: input.accountId,
              venue: input.venue,
              environment: input.environment,
              event: 'ORDER_SYNCED',
              result: 'FAILURE',
              actorId: input.actorId,
              safeMetadata: { invalidTransition: `${fromStatus}->${toStatus}`, clientOrderId: order.clientOrderId, providerOrderId: order.providerOrderId },
              requestId: input.requestId,
            });
            skipped++;
            continue;
          }

          // Idempotent: if same status and same filled quantity, skip
          const existingFilled = existing.filledQuantity?.toString() || '0';
          const newFilled = order.filledQuantity || '0';
          if (existing.status === order.status && existingFilled === newFilled) {
            skipped++;
            continue;
          }

          await this.prisma.order.update({
            where: { id: existing.id },
            data: {
              status: order.status as any,
              exchangeOrderId: order.providerOrderId || undefined,
              filledQuantity: this.toDecimalString(order.filledQuantity) as any,
              averageFillPrice: this.toDecimalString(order.averagePrice) as any,
              price: this.toDecimalString(order.price) as any,
              stopPrice: this.toDecimalString(order.stopPrice) as any,
              updatedAt: new Date(),
            },
          });
          updated++;
        } else {
          // Create new order record - idempotent via clientOrderId unique constraint
          try {
            await this.prisma.order.create({
              data: {
                id: randomUUID(),
                tenantId: input.tenantId,
                accountId: input.accountId,
                strategyId: null,
                symbolId: symbolRecord.id,
                clientOrderId: order.clientOrderId,
                exchangeOrderId: order.providerOrderId || null,
                venue: input.venue as any,
                symbol: order.symbol,
                side: order.side as any,
                orderType: order.type as any,
                timeInForce: 'GTC' as any,
                status: order.status as any,
                quantity: quantity as any,
                price: this.toDecimalString(order.price) as any,
                stopPrice: this.toDecimalString(order.stopPrice) as any,
                filledQuantity: this.toDecimalString(order.filledQuantity) as any || (0 as any),
                averageFillPrice: this.toDecimalString(order.averagePrice) as any,
                isSimulated: order.isSimulated,
                metadata: { providerRawStatus: order.providerRawStatus, exchangeSymbol: order.exchangeSymbol },
                createdAt: order.createdAtMicros ? new Date(Number(BigInt(order.createdAtMicros) / BigInt(1000))) : new Date(),
                updatedAt: order.updatedAtMicros ? new Date(Number(BigInt(order.updatedAtMicros) / BigInt(1000))) : new Date(),
              },
            });
            created++;
          } catch (e: any) {
            if (e.code === 'P2002') {
              // Duplicate clientOrderId - idempotent
              skipped++;
            } else {
              throw e;
            }
          }
        }
      } catch (e: any) {
        this.logger.warn(`Failed to sync order clientOrderId=${order.clientOrderId} tenant=${input.tenantId} error=${e.message}`);
        skipped++;
      }
    }

    const durationMs = Date.now() - start;
    await this.accountRepo.updateSyncMetadata(input.accountId, input.tenantId, { lastSyncAt: new Date() });

    await this.auditService.record({
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      event: 'ORDER_SYNCED',
      result: 'SUCCESS',
      actorId: input.actorId,
      safeMetadata: { processed: orders.length, created, updated, skipped, durationMs, isSandbox },
      requestId: input.requestId,
    });

    this.logger.log(`Order sync completed tenant=${input.tenantId} account=${input.accountId} processed=${orders.length} created=${created} updated=${updated} skipped=${skipped}`);

    return { state: ExchangeSyncState.COMPLETED, processed: orders.length, created, updated, skipped, durationMs };
  }

  async syncFills(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment; symbol?: string; actorId?: string; requestId?: string }): Promise<{ state: ExchangeSyncState; processed: number; created: number; skipped: number; durationMs: number }> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e: any) {
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let credentials;
    try {
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch {
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, skipped: 0, durationMs: Date.now() - start };
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
        passphrase: credentials.passphrase,
        environment: input.environment,
        isSandbox,
      },
      credentialRef: null,
    };

    let fills: ExchangeFill[];
    try {
      fills = await provider.getTradeHistory(context, input.symbol, 100);
    } catch (e: any) {
      this.logger.error(`Failed to fetch fills tenant=${input.tenantId} account=${input.accountId} error=${e.message}`);
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let created = 0;
    let skipped = 0;

    for (const fill of fills) {
      try {
        // Idempotency via providerTradeId unique per order - check existing
        const existing = await this.prisma.fill.findFirst({
          where: { venueTradeId: fill.providerTradeId },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Find order by providerOrderId or clientOrderId
        let order: SyncOrderContext | null = null;
        if (fill.providerOrderId) {
          order = await this.prisma.order.findFirst({ where: { tenantId: input.tenantId, exchangeOrderId: fill.providerOrderId } });
        }
        if (!order && fill.clientOrderId) {
          order = await this.prisma.order.findFirst({ where: { tenantId: input.tenantId, clientOrderId: fill.clientOrderId } });
        }
        const orderId: string | null = order?.id ?? null;

        if (!order || !orderId) {
          this.logger.warn(`Order not found for fill tradeId=${fill.providerTradeId} tenant=${input.tenantId}`);
          skipped++;
          continue;
        }

        // Copied out of the row before the transaction callback closes over it. The trade is built from
        // the ORDER's identity, and these fields are read once here rather than inside the callback,
        // where the narrowing above does not survive.
        const orderContext = {
          id: orderId,
          accountId: order.accountId,
          symbol: order.symbol,
          venue: order.venue,
          strategyId: order.strategyId ?? null,
        };

        // The copy-trading context is read from the execution record that produced this order rather
        // than guessed from the order row, which carries only the strategy. A missing record leaves the
        // attribution null: an unattributed trade is honest, an invented follower is not.
        let traderId: string | null = null;
        let followerId: string | null = null;
        try {
          const execution = await (this.prisma as any).copyExecution?.findFirst({
            where: { tenantId: input.tenantId, followerOrderId: orderContext.id },
            select: { traderId: true, followerId: true },
          });
          traderId = execution?.traderId ?? null;
          followerId = execution?.followerId ?? null;
        } catch (e: any) {
          this.logger.warn(`Copy-execution lookup failed for order ${orderContext.id}: ${e.message}`);
        }

        const fillId = randomUUID();
        const fillQuantity = this.toDecimalString(fill.quantity);
        const fillPrice = this.toDecimalString(fill.price);
        // A trade cannot be built from a size or price that is not an exact decimal, and substituting
        // zero would put a fabricated price into the PnL of every downstream reader. The fill row is
        // still written - it is the venue's statement, kept for reconciliation - but no trade is built
        // from it, and the omission is logged rather than silently accepted.
        const tradeApplyable = fillQuantity !== null && fillPrice !== null;
        if (!tradeApplyable) {
          this.logger.warn(
            `Fill ${fill.providerTradeId} has a non-decimal quantity=${fill.quantity} price=${fill.price}; recording the fill without a trade`,
          );
        }

        // One transaction. The fill row and the trade it belongs to are written together or not at
        // all: a fill committed without its trade would be skipped by the idempotency check on every
        // later sync, so the trade would never be built and the position it represents would never
        // reach the exposure the risk limiter reads.
        await this.prisma.$transaction(async (tx) => {
          await tx.fill.create({
          data: {
            id: fillId,
            orderId,
            venueTradeId: fill.providerTradeId,
            price: this.toDecimalString(fill.price) as any || (0 as any),
            quantity: this.toDecimalString(fill.quantity) as any || (0 as any),
            fee: this.toDecimalString(fill.fee) as any || (0 as any),
            feeCurrency: fill.feeCurrency || 'USDT',
            isMaker: fill.isMaker || false,
            isSimulated: fill.isSimulated,
            exchangeTimestampMicros: BigInt(fill.timestampMicros) as any,
            receivedTimestampMicros: BigInt(Date.now() * 1000) as any,
            symbol: fill.symbol,
            side: fill.side as any,
            venue: input.venue as any,
            quoteQuantity: this.toDecimalString(fill.quoteQuantity) as any,
            exchangeOrderId: fill.providerOrderId || null,
            source: 'PRIVATE_STREAM' as any,
            createdAt: new Date(),
          },
          });

          if (tradeApplyable) {
            await this.tradeLifecycleService.buildOrUpdateTradeFromFill(
              {
                tenantId: input.tenantId,
                accountId: orderContext.accountId,
                symbol: orderContext.symbol,
                venue: orderContext.venue,
                strategyId: orderContext.strategyId,
                traderId,
                followerId,
                // The trade's `orderIds` list is the order that produced it.
                orderIntentId: orderContext.id,
                fillId,
                fillQuantity: fillQuantity!,
                fillPrice: fillPrice!,
                fillSide: fill.side,
                isSimulated: fill.isSimulated,
              },
              { client: tx },
            );
          }
        });
        created++;
      } catch (e: any) {
        if (e.code === 'P2002') {
          skipped++;
        } else {
          this.logger.warn(`Failed to sync fill tradeId=${fill.providerTradeId} error=${e.message}`);
          skipped++;
        }
      }
    }

    const durationMs = Date.now() - start;

    this.logger.log(`Fill sync completed tenant=${input.tenantId} account=${input.accountId} processed=${fills.length} created=${created} skipped=${skipped}`);

    return { state: ExchangeSyncState.COMPLETED, processed: fills.length, created, skipped, durationMs };
  }
}
