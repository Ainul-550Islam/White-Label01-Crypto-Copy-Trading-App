// # NEW — Emits in-app/email/webhook notifications on copy-trading lifecycle and risk events
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { NotificationChannel, RealtimeEvent, userRoom } from '@wlct/shared-types';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { REALTIME_DISPATCH_CHANNEL } from '../../realtime/realtime.constants';

export type CopyTradingNotificationEventType =
  | 'COPY_EXECUTION_FILLED'
  | 'COPY_EXECUTION_FAILED'
  | 'COPY_EXECUTION_SKIPPED'
  | 'COPY_RISK_DRAWDOWN_BREACH'
  | 'COPY_SUBSCRIPTION_PAUSED'
  | 'COPY_SUBSCRIPTION_STOPPED'
  | 'COPY_RECONCILIATION_MISMATCH';

export interface CopyTradingNotificationPayload {
  tenantId: string;
  userId: string;
  eventType: CopyTradingNotificationEventType;
  subscriptionId?: string;
  executionId?: string;
  symbol?: string;
  reason?: string;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class CopyTradingNotificationProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectPinoLogger(CopyTradingNotificationProcessor.name)
    private readonly logger: PinoLogger,
  ) {}

  async emitCopyTradingNotification(
    payload: CopyTradingNotificationPayload,
  ): Promise<{ id: string; delivered: boolean }> {
    const title = payload.title ?? this.defaultTitle(payload.eventType, payload.symbol);
    const body = payload.body ?? this.defaultBody(payload);

    const record = await this.prisma.notification.create({
      data: {
        tenantId: payload.tenantId,
        userId: payload.userId,
        channel: NotificationChannel.IN_APP,
        type: payload.eventType,
        title,
        body,
        data: {
          subscriptionId: payload.subscriptionId ?? null,
          executionId: payload.executionId ?? null,
          symbol: payload.symbol ?? null,
          reason: payload.reason ?? null,
          ...(payload.metadata ?? {}),
        },
        deliveredAt: new Date(),
      },
    });

    try {
      await this.redis.publisher.publish(
        REALTIME_DISPATCH_CHANNEL,
        JSON.stringify({
          room: userRoom(payload.tenantId, payload.userId),
          event: RealtimeEvent.NOTIFICATION_CREATED,
          tenantId: payload.tenantId,
          emittedAt: new Date().toISOString(),
          payload: {
            id: record.id,
            type: payload.eventType,
            title,
            body,
            subscriptionId: payload.subscriptionId ?? null,
            executionId: payload.executionId ?? null,
            createdAt: record.createdAt.toISOString(),
          },
        }),
      );
    } catch (error) {
      this.logger.warn(
        {
          event: 'copy_trading.notification.realtime_failed',
          tenantId: payload.tenantId,
          err: error instanceof Error ? { message: error.message } : undefined,
        },
        'Failed to publish realtime copy-trading notification',
      );
    }

    this.logger.info(
      {
        event: 'copy_trading.notification.emitted',
        tenantId: payload.tenantId,
        type: payload.eventType,
        subscriptionId: payload.subscriptionId,
      },
      'Copy-trading notification emitted',
    );

    return { id: record.id, delivered: true };
  }

  private defaultTitle(eventType: CopyTradingNotificationEventType, symbol?: string): string {
    const sym = symbol ? ` (${symbol})` : '';
    switch (eventType) {
      case 'COPY_EXECUTION_FILLED':
        return `Copied Order Filled${sym}`;
      case 'COPY_EXECUTION_FAILED':
        return `Copied Order Failed${sym}`;
      case 'COPY_EXECUTION_SKIPPED':
        return `Copied Signal Skipped${sym}`;
      case 'COPY_RISK_DRAWDOWN_BREACH':
        return 'Copy-Trading Drawdown Guardrail Triggered';
      case 'COPY_SUBSCRIPTION_PAUSED':
        return 'Copy Subscription Paused';
      case 'COPY_SUBSCRIPTION_STOPPED':
        return 'Copy Subscription Stopped';
      case 'COPY_RECONCILIATION_MISMATCH':
        return 'Copy-Trading Reconciliation Alert';
    }
  }

  private defaultBody(payload: CopyTradingNotificationPayload): string {
    if (payload.reason) {
      return `${payload.eventType}: ${payload.reason}`;
    }
    return `Copy-trading lifecycle event ${payload.eventType} recorded for subscription ${payload.subscriptionId ?? 'N/A'}.`;
  }
}
