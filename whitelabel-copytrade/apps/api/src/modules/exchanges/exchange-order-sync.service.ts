// # Responsibility: synchronize native tenant/account-bound orders and fill/trade transactions without enum/decimal bypasses, invented zero/fee/source evidence or successful completion after required failures.
import { Prisma, TradingVenue, OrderStatusEnum, OrderTypeEnum, OrderSideEnum } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeVenue, ExchangeEnvironment, ExchangeSyncState, ExchangeOrder, ExchangeFill, isValidOrderStatusTransition, ExchangeOrderStatus } from './exchange.types';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangeProviderContext } from './exchange-provider.interface';
import { TradeLifecycleService } from '../oms/trade-lifecycle.service';
import { randomUUID } from 'crypto';

function failureKind(error: unknown): string { return error instanceof Error ? error.constructor.name : 'UnknownError'; }
function failureCode(error: unknown): string | undefined { return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined; }
function nativeOption<T extends string>(value: string, values: readonly T[], label: string): T {
  const option = values.find((candidate) => candidate === value);
  if (!option) throw new Error(`Unsupported native ${label}`);
  return option;
}
function nativeStatus(status: ExchangeOrderStatus): OrderStatusEnum {
  if (status === ExchangeOrderStatus.NEW) return OrderStatusEnum.ACKNOWLEDGED;
  if (status === ExchangeOrderStatus.CANCELED) return OrderStatusEnum.CANCELLED;
  if (status === ExchangeOrderStatus.PENDING_CANCEL) return OrderStatusEnum.CANCEL_REQUESTED;
  return nativeOption(status, Object.values(OrderStatusEnum), 'order status');
}
function exchangeStatus(status: OrderStatusEnum): ExchangeOrderStatus {
  if (['PENDING', 'SUBMITTED', 'ACKNOWLEDGED'].includes(status)) return ExchangeOrderStatus.NEW;
  if (status === OrderStatusEnum.CANCELLED) return ExchangeOrderStatus.CANCELED;
  if (status === OrderStatusEnum.CANCEL_REQUESTED) return ExchangeOrderStatus.PENDING_CANCEL;
  return nativeOption(status, Object.values(ExchangeOrderStatus), 'persisted order status');
}

/**
 * The order fields the fill sync reads. Declared narrowly on purpose: `ReturnType<typeof
 * prisma.order.findFirst>` resolves through a heavily overloaded generic and makes type inference
 * dramatically more expensive for the whole project, for no extra safety over naming the fields.
 */
interface SyncOrderContext {
  id: string;
  accountId: string;
  symbol: string;
  venue: TradingVenue;
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
    if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value.trim())) throw new Error('Exact decimal string required for financial persistence');
    const normalized = value.trim(); const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
    if (whole.replace(/^0+/, '').length > 16 || fraction.replace(/0+$/, '').length > 12) throw new Error('Decimal does not fit native Decimal(28,12) without loss');
    return normalized;
  }

  private assertAccountBinding(account: Awaited<ReturnType<ExchangeAccountRepository['findById']>>, input: { tenantId: string; venue: ExchangeVenue; environment: ExchangeEnvironment }): void {
    if (!account || account.tenantId !== input.tenantId || account.venue !== input.venue || account.environment !== input.environment
      || account.isSandbox !== (input.environment !== ExchangeEnvironment.LIVE)) throw new Error('Account tenant/venue/environment binding unavailable');
  }

  async syncOrders(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment; symbol?: string; actorId?: string; requestId?: string }): Promise<{ state: ExchangeSyncState; processed: number; created: number; updated: number; skipped: number; durationMs: number }> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    const account = await this.accountRepo.findById(input.accountId, input.tenantId);
    this.assertAccountBinding(account, input);

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e) {
      this.logger.warn(`Provider unavailable for order sync tenant=${input.tenantId} account=${input.accountId} error=${failureKind(e)}`);
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let credentials;
    try {
      credentials = await this.credentialService.getDecryptedCredentialsForProvider(input.tenantId, input.accountId, input.venue, input.environment);
    } catch (e) {
      this.logger.warn(`Credential unavailable for order sync tenant=${input.tenantId} account=${input.accountId} error=${failureKind(e)}`);
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
    } catch (e) {
      this.logger.error(`Failed to fetch orders tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} error=${failureKind(e)}`);
      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: input.accountId,
        venue: input.venue,
        environment: input.environment,
        event: 'ORDER_SYNCED',
        result: 'FAILURE',
        actorId: input.actorId,
        safeMetadata: { errorCode: failureCode(e) ?? 'FETCH_FAILED', isSandbox },
        requestId: input.requestId,
      });
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, updated: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const order of orders) {
      try {
        if (!order.clientOrderId || order.isSimulated !== isSandbox) throw new Error('Order identity/simulation evidence mismatch');
        const filledQuantity = this.toDecimalString(order.filledQuantity);
        if (filledQuantity === null || new Prisma.Decimal(filledQuantity).lt(0)) throw new Error('Observed filled quantity required');
        const quantity = this.toDecimalString(order.quantity);
        if (quantity === null || new Prisma.Decimal(quantity).lte(0)) {
          failed++; skipped++;
          continue;
        }

        // Find symbolId
        const symbolRecord = await this.prisma.tradingSymbol.findFirst({
          where: { tenantId: input.tenantId, symbol: order.symbol },
          select: { id: true },
        });

        if (!symbolRecord) {
          failed++;
          this.logger.warn(`Symbol not found for order sync tenant=${input.tenantId} symbol=${order.symbol}`);
          skipped++;
          continue;
        }

        // Check existing by clientOrderId (unique per tenant) or providerOrderId
        let existing = await this.prisma.order.findFirst({
          where: { tenantId: input.tenantId, accountId: input.accountId, clientOrderId: order.clientOrderId },
        });

        if (!existing && order.providerOrderId) {
          existing = await this.prisma.order.findFirst({
            where: { tenantId: input.tenantId, accountId: input.accountId, exchangeOrderId: order.providerOrderId },
          });
        }

        if (existing) {
          // Validate status transition
          const fromStatus = exchangeStatus(existing.status);
          const toStatus = order.status;
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
            failed++; skipped++;
            continue;
          }

          // Idempotent: if same status and same filled quantity, skip
          const existingFilled = existing.filledQuantity.toString();
          if (existing.status === nativeStatus(order.status) && new Prisma.Decimal(existingFilled).eq(filledQuantity)) {
            skipped++;
            continue;
          }

          await this.prisma.order.update({
            where: { id: existing.id, tenantId: input.tenantId, accountId: input.accountId, status: existing.status },
            data: {
              status: nativeStatus(order.status),
              exchangeOrderId: order.providerOrderId || undefined,
              filledQuantity,
              averageFillPrice: this.toDecimalString(order.averagePrice),
              price: this.toDecimalString(order.price),
              stopPrice: this.toDecimalString(order.stopPrice),
              updatedAt: new Date(),
            },
          });
          updated++;
        } else {
          // Create new order record - idempotent via clientOrderId unique constraint
          await this.prisma.order.create({
              data: {
                id: randomUUID(),
                tenantId: input.tenantId,
                accountId: input.accountId,
                strategyId: null,
                symbolId: symbolRecord.id,
                clientOrderId: order.clientOrderId,
                exchangeOrderId: order.providerOrderId || null,
                venue: nativeOption(input.venue, Object.values(TradingVenue), 'venue'),
                symbol: order.symbol,
                side: nativeOption(order.side, Object.values(OrderSideEnum), 'order side'),
                orderType: nativeOption(order.type, Object.values(OrderTypeEnum), 'order type'),
                timeInForce: 'GTC',
                status: nativeStatus(order.status),
                quantity,
                price: this.toDecimalString(order.price),
                stopPrice: this.toDecimalString(order.stopPrice),
                filledQuantity,
                averageFillPrice: this.toDecimalString(order.averagePrice),
                isSimulated: order.isSimulated,
                metadata: { providerRawStatus: order.providerRawStatus, exchangeSymbol: order.exchangeSymbol },
                createdAt: order.createdAtMicros ? new Date(Number(BigInt(order.createdAtMicros) / BigInt(1000))) : new Date(),
                updatedAt: order.updatedAtMicros ? new Date(Number(BigInt(order.updatedAtMicros) / BigInt(1000))) : new Date(),
              },
            });
          created++;
          // A P2002 alone does not prove a tenant/account-bound matching duplicate.
          // The outer catch returns FAILED; a later scoped reconciliation can retry safely.
        }
      } catch (e) {
        failed++;
        this.logger.warn(`Failed to sync order clientOrderId=${order.clientOrderId} tenant=${input.tenantId} error=${failureKind(e)}`);
        skipped++;
      }
    }

    const durationMs = Date.now() - start;

    await this.auditService.record({
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: input.venue,
      environment: input.environment,
      event: 'ORDER_SYNCED',
      result: failed > 0 ? 'FAILURE' : 'SUCCESS',
      actorId: input.actorId,
      safeMetadata: { failed, processed: orders.length, created, updated, skipped, durationMs, isSandbox },
      requestId: input.requestId,
    });

    this.logger.log(`Order sync completed tenant=${input.tenantId} account=${input.accountId} processed=${orders.length} created=${created} updated=${updated} skipped=${skipped}`);

    return { state: failed > 0 ? ExchangeSyncState.FAILED : ExchangeSyncState.COMPLETED, processed: orders.length, created, updated, skipped, durationMs };
  }

  async syncFills(input: { tenantId: string; accountId: string; venue: ExchangeVenue; environment: ExchangeEnvironment; symbol?: string; actorId?: string; requestId?: string }): Promise<{ state: ExchangeSyncState; processed: number; created: number; skipped: number; durationMs: number }> {
    const start = Date.now();
    const isSandbox = input.environment !== ExchangeEnvironment.LIVE;

    const account = await this.accountRepo.findById(input.accountId, input.tenantId);
    this.assertAccountBinding(account, input);

    let provider;
    try {
      provider = this.providerFactory.getProvider(input.venue, input.environment);
    } catch (e) {
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
    } catch (e) {
      this.logger.error(`Failed to fetch fills tenant=${input.tenantId} account=${input.accountId} error=${failureKind(e)}`);
      return { state: ExchangeSyncState.FAILED, processed: 0, created: 0, skipped: 0, durationMs: Date.now() - start };
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const fill of fills) {
      try {
        // Find order by providerOrderId or clientOrderId
        let order: SyncOrderContext | null = null;
        if (fill.providerOrderId) {
          order = await this.prisma.order.findFirst({ where: { tenantId: input.tenantId, accountId: input.accountId, exchangeOrderId: fill.providerOrderId }, select: { id: true, accountId: true, symbol: true, venue: true, strategyId: true } });
        }
        if (!order && fill.clientOrderId) {
          order = await this.prisma.order.findFirst({ where: { tenantId: input.tenantId, accountId: input.accountId, clientOrderId: fill.clientOrderId }, select: { id: true, accountId: true, symbol: true, venue: true, strategyId: true } });
        }
        const orderId: string | null = order?.id ?? null;

        if (!order || !orderId) {
          failed++;
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

        if (!fill.providerTradeId || fill.isSimulated !== isSandbox || orderContext.accountId !== input.accountId || orderContext.venue !== input.venue
          || fill.symbol.replace(/[-_]/g, '') !== orderContext.symbol.replace(/[-_]/g, '')) throw new Error('Fill/order tenant/account/venue/symbol/simulation evidence mismatch');
        // The native unique key is (orderId, venueTradeId), not (accountId, venueTradeId).
        // Resolve the order first so an unrelated order's receipt cannot suppress this fill.
        const existing = await this.prisma.fill.findFirst({
          where: { orderId: orderContext.id, venueTradeId: fill.providerTradeId, order: { tenantId: input.tenantId, accountId: input.accountId } },
        });
        if (existing) { skipped++; continue; }

        // The copy-trading context is read from the execution record that produced this order rather
        // than guessed from the order row, which carries only the strategy. A missing record leaves the
        // attribution null: an unattributed trade is honest, an invented follower is not.
        let traderId: string | null = null;
        let followerId: string | null = null;
        const execution = await this.prisma.copyExecution.findFirst({
          where: { tenantId: input.tenantId, followerOrderId: orderContext.id }, select: { traderId: true, followerId: true },
        });
        traderId = execution?.traderId ?? null; followerId = execution?.followerId ?? null;

        const fillId = randomUUID();
        const fillQuantity = this.toDecimalString(fill.quantity);
        const fillPrice = this.toDecimalString(fill.price);
        const fee = this.toDecimalString(fill.fee); const feeCurrency = fill.feeCurrency; const isMaker = fill.isMaker;
        if (fillQuantity === null || fillPrice === null || new Prisma.Decimal(fillQuantity).lte(0) || new Prisma.Decimal(fillPrice).lte(0)
          || fee === null || !feeCurrency || isMaker === null) throw new Error('Complete observed fill price/quantity/fee/maker evidence required');
        if (!/^\d+$/.test(fill.timestampMicros)) throw new Error('Observed fill timestamp required');

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
            price: fillPrice,
            quantity: fillQuantity,
            fee,
            feeCurrency,
            isMaker,
            isSimulated: fill.isSimulated,
            exchangeTimestampMicros: BigInt(fill.timestampMicros),
            receivedTimestampMicros: BigInt(Date.now()) * 1000n,
            symbol: fill.symbol,
            side: nativeOption(fill.side, Object.values(OrderSideEnum), 'fill side'),
            venue: nativeOption(input.venue, Object.values(TradingVenue), 'venue'),
            quoteQuantity: this.toDecimalString(fill.quoteQuantity),
            exchangeOrderId: fill.providerOrderId || null,
            source: 'RECONCILIATION',
            createdAt: new Date(),
          },
          });

          {
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
                fillQuantity,
                fillPrice,
                fillSide: fill.side,
                isSimulated: fill.isSimulated,
              },
              { client: tx },
            );
          }
        });
        created++;
      } catch (e) {
        // A uniqueness failure may come from the fill OR canonical trade write.
        // Without independently verified matching scoped durable state it is a failure,
        // not successful idempotency. The next scoped reconciliation may retry.
        failed++;
        this.logger.warn(`Failed to sync fill tradeId=${fill.providerTradeId} error=${failureKind(e)}`);
        skipped++;
      }
    }

    const durationMs = Date.now() - start;

    this.logger.log(`Fill sync completed tenant=${input.tenantId} account=${input.accountId} processed=${fills.length} created=${created} skipped=${skipped}`);

    return { state: failed > 0 ? ExchangeSyncState.FAILED : ExchangeSyncState.COMPLETED, processed: fills.length, created, skipped, durationMs };
  }
}
