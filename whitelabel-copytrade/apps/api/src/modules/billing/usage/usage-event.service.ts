import { Injectable, Logger } from '@nestjs/common';
import { UsageMeterService } from './usage-meter.service';
import { MeterKey, UsageScope, MeterUnit } from './usage-metering.types';

/**
 * Converts runtime/application events into canonical metered usage events
 * without duplicating business logic or counters.
 * Uses canonical event/source ID to avoid duplicate counting.
 */
@Injectable()
export class UsageEventService {
  private readonly logger = new Logger(UsageEventService.name);

  constructor(private readonly meterService: UsageMeterService) {}

  // User created
  async onUserCreated(params: { tenantId: string; userId: string; sourceEventId?: string }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.USERS,
        scope: UsageScope.TENANT,
        quantity: 1,
        unit: MeterUnit.COUNT,
        sourceType: 'USER_CREATED',
        sourceId: params.userId,
        sourceEventId: params.sourceEventId || params.userId,
        idempotencyKey: `user_created_${params.tenantId}_${params.userId}`,
        dimensions: { tenantId: params.tenantId, scope: UsageScope.TENANT, userId: params.userId },
        safeMetadata: { userId: params.userId },
      });
      this.logger.log(`Metered user created tenant=${params.tenantId} user=${params.userId}`);
    } catch (e) {
      this.logger.warn(`Failed to meter user created: ${(e as Error).message}`);
    }
  }

  // Trader created
  async onTraderCreated(params: { tenantId: string; traderId: string; userId?: string; sourceEventId?: string }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.TRADERS,
        scope: UsageScope.TENANT,
        quantity: 1,
        unit: MeterUnit.COUNT,
        sourceType: 'TRADER_CREATED',
        sourceId: params.traderId,
        sourceEventId: params.sourceEventId || params.traderId,
        idempotencyKey: `trader_created_${params.tenantId}_${params.traderId}`,
        dimensions: { tenantId: params.tenantId, scope: UsageScope.TENANT, traderId: params.traderId, userId: params.userId },
        safeMetadata: { traderId: params.traderId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter trader created: ${(e as Error).message}`);
    }
  }

  // Follower linked
  async onFollowerLinked(params: { tenantId: string; traderId: string; followerId: string; subscriptionId?: string; sourceEventId?: string }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.FOLLOWERS,
        scope: UsageScope.TRADER,
        subjectId: params.traderId,
        resourceId: params.followerId,
        quantity: 1,
        unit: MeterUnit.COUNT,
        sourceType: 'FOLLOWER_LINKED',
        sourceId: params.subscriptionId || `${params.traderId}_${params.followerId}`,
        sourceEventId: params.sourceEventId,
        idempotencyKey: `follower_linked_${params.tenantId}_${params.traderId}_${params.followerId}`,
        dimensions: { tenantId: params.tenantId, scope: UsageScope.TRADER, traderId: params.traderId, followerId: params.followerId },
        safeMetadata: { traderId: params.traderId, followerId: params.followerId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter follower linked: ${(e as Error).message}`);
    }
  }

  // Exchange account linked
  async onExchangeAccountLinked(params: { tenantId: string; userId: string; accountId: string; sourceEventId?: string }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.EXCHANGE_ACCOUNTS,
        scope: UsageScope.USER,
        subjectId: params.userId,
        resourceId: params.accountId,
        quantity: 1,
        unit: MeterUnit.COUNT,
        sourceType: 'EXCHANGE_ACCOUNT_LINKED',
        sourceId: params.accountId,
        sourceEventId: params.sourceEventId || params.accountId,
        idempotencyKey: `exchange_linked_${params.tenantId}_${params.userId}_${params.accountId}`,
        dimensions: { tenantId: params.tenantId, scope: UsageScope.USER, userId: params.userId },
        safeMetadata: { accountId: params.accountId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter exchange account linked: ${(e as Error).message}`);
    }
  }

  // Copy subscription created
  async onCopySubscriptionCreated(params: { tenantId: string; followerId: string; subscriptionId: string; traderId?: string; sourceEventId?: string }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.COPY_SUBSCRIPTIONS,
        scope: UsageScope.FOLLOWER,
        subjectId: params.followerId,
        resourceId: params.subscriptionId,
        quantity: 1,
        unit: MeterUnit.COUNT,
        sourceType: 'COPY_SUBSCRIPTION_CREATED',
        sourceId: params.subscriptionId,
        sourceEventId: params.sourceEventId || params.subscriptionId,
        idempotencyKey: `copy_sub_created_${params.tenantId}_${params.followerId}_${params.subscriptionId}`,
        dimensions: { tenantId: params.tenantId, scope: UsageScope.FOLLOWER, followerId: params.followerId, traderId: params.traderId },
        safeMetadata: { subscriptionId: params.subscriptionId, traderId: params.traderId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter copy subscription: ${(e as Error).message}`);
    }
  }

  // API request accepted (only for accepted requests, not blocked)
  async onApiRequestAccepted(params: {
    tenantId: string;
    userId?: string;
    apiIdentity?: string;
    endpoint?: string;
    requestId: string;
    timestamp?: Date;
  }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.API_REQUESTS,
        scope: params.apiIdentity ? UsageScope.API_IDENTITY : params.userId ? UsageScope.USER : UsageScope.TENANT,
        subjectId: params.apiIdentity || params.userId || params.tenantId,
        quantity: 1,
        unit: MeterUnit.REQUEST,
        sourceType: 'API_REQUEST_ACCEPTED',
        sourceId: params.requestId,
        idempotencyKey: `api_req_${params.tenantId}_${params.requestId}`,
        timestamp: params.timestamp || new Date(),
        dimensions: {
          tenantId: params.tenantId,
          scope: params.apiIdentity ? UsageScope.API_IDENTITY : UsageScope.TENANT,
          apiIdentity: params.apiIdentity,
          endpoint: params.endpoint,
          userId: params.userId,
        },
        safeMetadata: { endpoint: params.endpoint, requestId: params.requestId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter API request: ${(e as Error).message}`);
    }
  }

  // WebSocket connected (only successful connections)
  async onWebSocketConnected(params: { tenantId: string; connectionId: string; userId?: string; timestamp?: Date }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.WEBSOCKET_CONNECTIONS,
        scope: UsageScope.TENANT,
        quantity: 1,
        unit: MeterUnit.CONNECTION,
        sourceType: 'WEBSOCKET_CONNECTED',
        sourceId: params.connectionId,
        idempotencyKey: `ws_conn_${params.tenantId}_${params.connectionId}`,
        timestamp: params.timestamp || new Date(),
        dimensions: { tenantId: params.tenantId, scope: UsageScope.TENANT, userId: params.userId },
        safeMetadata: { connectionId: params.connectionId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter WebSocket connected: ${(e as Error).message}`);
    }
  }

  async onWebSocketDisconnected(params: { tenantId: string; connectionId: string; userId?: string }): Promise<void> {
    // For disconnection, we don't increment usage, but we could record lifecycle
    // For simplicity, we log and optionally decrement would be handled elsewhere
    // Here we record a 0 quantity event for traceability, not counting as active
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.WEBSOCKET_CONNECTIONS,
        scope: UsageScope.TENANT,
        quantity: 0,
        unit: MeterUnit.CONNECTION,
        sourceType: 'WEBSOCKET_DISCONNECTED',
        sourceId: `${params.connectionId}_disconnect`,
        idempotencyKey: `ws_disc_${params.tenantId}_${params.connectionId}`,
        dimensions: { tenantId: params.tenantId, scope: UsageScope.TENANT, userId: params.userId },
        safeMetadata: { connectionId: params.connectionId, event: 'disconnected' },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter WebSocket disconnected: ${(e as Error).message}`);
    }
  }

  // Trading volume completed (validated volume from existing trading service)
  async onTradingVolumeCompleted(params: {
    tenantId: string;
    userId?: string;
    traderId?: string;
    volumeUsd: number;
    sourceId: string;
    sourceEventId?: string;
    timestamp?: Date;
  }): Promise<void> {
    try {
      // Quantity for volume meters is volume amount, not count
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.TRADING_VOLUME,
        scope: params.traderId ? UsageScope.TRADER : params.userId ? UsageScope.USER : UsageScope.TENANT,
        subjectId: params.traderId || params.userId || params.tenantId,
        quantity: params.volumeUsd,
        unit: MeterUnit.VOLUME_USD,
        sourceType: 'TRADING_VOLUME_COMPLETED',
        sourceId: params.sourceId,
        sourceEventId: params.sourceEventId || params.sourceId,
        idempotencyKey: `trading_vol_${params.tenantId}_${params.sourceId}`,
        timestamp: params.timestamp || new Date(),
        dimensions: { tenantId: params.tenantId, traderId: params.traderId, userId: params.userId },
        safeMetadata: { volumeUsd: params.volumeUsd, sourceId: params.sourceId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter trading volume: ${(e as Error).message}`);
    }
  }

  // Copy-trading settlement completed
  async onCopyTradingSettlementCompleted(params: {
    tenantId: string;
    traderId?: string;
    followerId?: string;
    volumeUsd: number;
    settlementId: string;
    sourceEventId?: string;
    timestamp?: Date;
  }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.COPY_TRADING_VOLUME,
        scope: params.traderId ? UsageScope.TRADER : UsageScope.TENANT,
        subjectId: params.traderId || params.tenantId,
        quantity: params.volumeUsd,
        unit: MeterUnit.VOLUME_USD,
        sourceType: 'COPY_TRADING_SETTLEMENT_COMPLETED',
        sourceId: params.settlementId,
        sourceEventId: params.sourceEventId || params.settlementId,
        idempotencyKey: `copy_vol_${params.tenantId}_${params.settlementId}`,
        timestamp: params.timestamp || new Date(),
        dimensions: { tenantId: params.tenantId, traderId: params.traderId, followerId: params.followerId },
        safeMetadata: { volumeUsd: params.volumeUsd, settlementId: params.settlementId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter copy trading volume: ${(e as Error).message}`);
    }
  }

  // Successful commercial billing event (payment succeeded)
  async onCommercialBillingSucceeded(params: {
    tenantId: string;
    paymentId: string;
    amountUsd: number;
    sourceEventId?: string;
    timestamp?: Date;
  }): Promise<void> {
    try {
      await this.meterService.recordUsage({
        tenantId: params.tenantId,
        meterKey: MeterKey.PLATFORM_FEE_VOLUME,
        scope: UsageScope.TENANT,
        quantity: params.amountUsd,
        unit: MeterUnit.VOLUME_USD,
        sourceType: 'COMMERCIAL_BILLING_SUCCEEDED',
        sourceId: params.paymentId,
        sourceEventId: params.sourceEventId || params.paymentId,
        idempotencyKey: `billing_vol_${params.tenantId}_${params.paymentId}`,
        timestamp: params.timestamp || new Date(),
        dimensions: { tenantId: params.tenantId },
        safeMetadata: { amountUsd: params.amountUsd, paymentId: params.paymentId },
      });
    } catch (e) {
      this.logger.warn(`Failed to meter commercial billing: ${(e as Error).message}`);
    }
  }
}
