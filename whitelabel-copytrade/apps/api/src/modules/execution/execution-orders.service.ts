import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../common/errors/app.exception';
import {
  toFillView,
  toOrderEventView,
  toOrderView,
  toPositionView,
  type FillRow,
  type OrderEventRow,
  type OrderRow,
  type PositionRow,
} from './execution.mapper';
import type { FillView, OrderEventView, OrderView, PositionView } from './execution.types';

/**
 * Order, event, fill and position reads, plus the cancel command.
 *
 * There is no method here that places an order. That is not an omission: the
 * API process has no signing code, no credential access and no risk engine, so
 * anything it called "submit" would either be a lie or a bypass. Orders enter
 * the system through the trading worker, which runs validation, the ten
 * pre-submit gates and the risk engine before a byte reaches a venue.
 *
 * Cancellation is different and is offered here, because cancelling is
 * risk-reducing. A user must always be able to stop something that is already
 * working against them, and a cancel request that has to wait for a strategy
 * loop is a cancel request that arrives too late.
 */
@Injectable()
export class ExecutionOrdersService {
  private static readonly ORDER_SELECT = {
    id: true,
    clientOrderId: true,
    exchangeOrderId: true,
    accountId: true,
    strategyId: true,
    venue: true,
    symbol: true,
    side: true,
    orderType: true,
    timeInForce: true,
    status: true,
    reconciliationState: true,
    reconciliationDetail: true,
    lastReconciledAt: true,
    quantity: true,
    price: true,
    stopPrice: true,
    reduceOnly: true,
    filledQuantity: true,
    averageFillPrice: true,
    cumulativeFee: true,
    feeCurrency: true,
    isSimulated: true,
    wasDryRun: true,
    rejectionCode: true,
    rejectionReason: true,
    metadata: true,
    submitLatencyMicros: true,
    createdAt: true,
    updatedAt: true,
    submittedAt: true,
    terminalAt: true,
  } satisfies Prisma.OrderSelect;

  private static readonly SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'submittedAt'] as const;

  /**
   * Statuses from which a cancel request is meaningful.
   *
   * PENDING is excluded on purpose. A PENDING order has not been transmitted,
   * so there is nothing at the venue to cancel; the worker resolves it locally.
   * CANCEL_REQUESTED is excluded because a second cancel is not a stronger
   * cancel, it is just another signed request against a rate limit.
   */
  private static readonly CANCELLABLE_STATUSES = [
    'SUBMITTED',
    'ACKNOWLEDGED',
    'PARTIALLY_FILLED',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(ExecutionOrdersService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async listOrders(filter: {
    tenantId: string;
    accountId?: string;
    strategyId?: string;
    symbol?: string;
    status?: string;
    reconciliationState?: string;
    /** True to return only orders whose local state is not trusted. */
    unreconciledOnly?: boolean;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
  }): Promise<PaginatedResult<OrderView>> {
    const pagination = normalisePagination(filter, ExecutionOrdersService.SORTABLE_FIELDS);

    const where: Prisma.OrderWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.accountId ? { accountId: filter.accountId } : {}),
      ...(filter.strategyId ? { strategyId: filter.strategyId } : {}),
      ...(filter.symbol ? { symbol: filter.symbol } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.reconciliationState
        ? { reconciliationState: filter.reconciliationState as never }
        : {}),
      ...(filter.unreconciledOnly
        ? {
            reconciliationState: {
              in: ['UNKNOWN', 'PENDING_RECONCILIATION', 'DIVERGED'] as never,
            },
          }
        : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(pagination.search ? { clientOrderId: { contains: pagination.search } } : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        select: ExecutionOrdersService.ORDER_SELECT,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: rows.map((row) => toOrderView(row as OrderRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async getOrder(tenantId: string, orderId: string): Promise<OrderView> {
    return toOrderView(await this.requireOrder(tenantId, orderId));
  }

  /**
   * The immutable event trail for one order.
   *
   * Ordered by the venue's own microsecond timestamp rather than by insertion
   * time. Events can be written out of order - a fill arriving on the private
   * stream can be persisted before the submit response is processed - and the
   * trail is only useful if it reads in the order things actually happened.
   */
  async listOrderEvents(tenantId: string, orderId: string): Promise<OrderEventView[]> {
    await this.requireOrder(tenantId, orderId);

    const rows = await this.prisma.orderEvent.findMany({
      where: { orderId },
      select: {
        id: true,
        orderId: true,
        previousStatus: true,
        status: true,
        reason: true,
        payload: true,
        occurredAtMicros: true,
        createdAt: true,
      },
      orderBy: [{ occurredAtMicros: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => toOrderEventView(row as OrderEventRow));
  }

  async listOrderFills(tenantId: string, orderId: string): Promise<FillView[]> {
    await this.requireOrder(tenantId, orderId);

    const rows = await this.prisma.fill.findMany({
      where: { orderId },
      select: {
        id: true,
        orderId: true,
        venueTradeId: true,
        exchangeOrderId: true,
        symbol: true,
        side: true,
        venue: true,
        price: true,
        quantity: true,
        quoteQuantity: true,
        fee: true,
        feeCurrency: true,
        isMaker: true,
        source: true,
        isSimulated: true,
        exchangeTimestampMicros: true,
        receivedTimestampMicros: true,
      },
      orderBy: { receivedTimestampMicros: 'asc' },
    });

    return rows.map((row) => toFillView(row as FillRow));
  }

  async listFills(filter: {
    tenantId: string;
    accountId?: string;
    symbol?: string;
    page?: number;
    limit?: number;
    sortOrder?: string;
  }): Promise<PaginatedResult<FillView>> {
    const pagination = normalisePagination(filter, ['receivedTimestampMicros', 'createdAt']);

    const where: Prisma.FillWhereInput = {
      // Fills have no tenant column of their own: they are reached through
      // their order, which does. Filtering on the relation is what keeps the
      // isolation guarantee intact without denormalising a tenant id onto a
      // table that can receive millions of rows a day.
      order: {
        tenantId: filter.tenantId,
        ...(filter.accountId ? { accountId: filter.accountId } : {}),
      },
      ...(filter.symbol ? { symbol: filter.symbol } : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.fill.findMany({
        where,
        select: {
          id: true,
          orderId: true,
          venueTradeId: true,
          exchangeOrderId: true,
          symbol: true,
          side: true,
          venue: true,
          price: true,
          quantity: true,
          quoteQuantity: true,
          fee: true,
          feeCurrency: true,
          isMaker: true,
          source: true,
          isSimulated: true,
          exchangeTimestampMicros: true,
          receivedTimestampMicros: true,
        },
        orderBy: { receivedTimestampMicros: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.fill.count({ where }),
    ]);

    return {
      items: rows.map((row) => toFillView(row as FillRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async listPositions(filter: {
    tenantId: string;
    accountId?: string;
    symbol?: string;
    /** Excludes flat positions by default; history is rarely what is wanted. */
    includeFlat?: boolean;
  }): Promise<PositionView[]> {
    const rows = await this.prisma.position.findMany({
      where: {
        tenantId: filter.tenantId,
        ...(filter.accountId ? { accountId: filter.accountId } : {}),
        ...(filter.symbol ? { symbol: filter.symbol } : {}),
        ...(filter.includeFlat ? {} : { side: { not: 'FLAT' } }),
      },
      select: {
        id: true,
        accountId: true,
        venue: true,
        symbol: true,
        side: true,
        quantity: true,
        averageEntryPrice: true,
        markPrice: true,
        realisedPnl: true,
        unrealisedPnl: true,
        cumulativeFee: true,
        feeCurrency: true,
        containsSimulatedFills: true,
        fillCount: true,
        openedAt: true,
        closedAt: true,
        lastFillAt: true,
        updatedAt: true,
      },
      orderBy: [{ symbol: 'asc' }],
    });

    return rows.map((row) => toPositionView(row as PositionRow));
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * Requests cancellation of a working order.
   *
   * The order is NOT marked cancelled here. Only the venue can cancel an order,
   * and it may fill in the moment between the request and its arrival. All this
   * does is record the intent, write the audit record and hand the work to the
   * trading worker; the worker sends the signed cancel and lets the venue's
   * answer decide what the order's status becomes.
   */
  async requestCancel(
    tenantId: string,
    orderId: string,
    actor: { userId: string; requestId?: string | null },
    reason: string,
  ): Promise<OrderView> {
    const order = await this.requireOrder(tenantId, orderId);

    if (!ExecutionOrdersService.CANCELLABLE_STATUSES.includes(order.status as never)) {
      throw new ConflictException(
        `An order in status ${order.status} cannot be cancelled. Cancellation applies to ` +
          `orders that are working at the venue.`,
      );
    }

    if (order.reconciliationState === 'UNKNOWN') {
      // Cancelling by client order id would be safe, but the deeper problem is
      // that we do not know whether this order exists at the venue. Reconcile
      // first: the answer may be that there is nothing to cancel.
      throw new ConflictException(
        'This order is in an UNKNOWN reconciliation state, so the platform does not yet know ' +
          'whether it exists at the venue. Reconciliation must resolve it first.',
      );
    }

    let jobId: string;
    try {
      jobId = await this.queue.enqueueOrThrow(
        QUEUE_NAMES.TRADE_EXECUTION,
        JOB_NAMES.CANCEL_ORDER,
        {
          tenantId,
          orderId,
          accountId: order.accountId,
          clientOrderId: order.clientOrderId,
          symbol: order.symbol,
          requestedByUserId: actor.userId,
          requestedAt: new Date().toISOString(),
        },
        { jobId: `cancel-order:${orderId}`, attempts: 3 },
      );
    } catch (error) {
      this.logger.error(
        {
          event: 'execution.cancel_enqueue_failed',
          tenantId,
          orderId,
          message: (error as Error).message,
        },
        'Failed to queue order cancellation',
      );
      throw new ServiceUnavailableException(
        'The trading worker queue is unavailable, so the cancellation could not be scheduled. ' +
          'The order is unchanged and still working at the venue.',
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.ORDER_CANCEL_REQUESTED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'order',
      resourceId: orderId,
      description: sanitiseForLog(reason, 500),
      metadata: {
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        statusAtRequest: order.status,
        jobId,
        tradingMode: this.config.tradingMode,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      { event: 'execution.cancel_requested', tenantId, orderId, actorId: actor.userId, jobId },
      'Order cancellation requested',
    );

    // Returned unchanged, on purpose. Reporting CANCEL_REQUESTED here would be
    // asserting a state transition the venue has not acknowledged.
    return toOrderView(order);
  }

  private async requireOrder(tenantId: string, orderId: string): Promise<OrderRow> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: ExecutionOrdersService.ORDER_SELECT,
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    return order as OrderRow;
  }
}
