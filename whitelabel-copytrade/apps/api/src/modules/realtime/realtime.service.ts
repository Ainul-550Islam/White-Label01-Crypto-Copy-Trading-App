import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  RealtimeEvent,
  tenantRoom,
  userRoom,
  type RealtimeEnvelope,
} from '@wlct/shared-types';

import { RedisService } from '../../infrastructure/redis/redis.service';
import { REALTIME_DISPATCH_CHANNEL, type RealtimeDispatchMessage } from './realtime.constants';

/**
 * Publish-side API for realtime messages.
 *
 * Services never touch the Socket.IO server directly. They publish an envelope
 * to Redis and whichever API node owns the recipient's socket relays it. That
 * keeps emitting safe from BullMQ workers and from any process that has Redis
 * but no HTTP server.
 */
@Injectable()
export class RealtimeService {
  constructor(
    private readonly redis: RedisService,
    @InjectPinoLogger(RealtimeService.name) private readonly logger: PinoLogger,
  ) {}

  async emitToUser<T>(
    tenantId: string,
    userId: string,
    event: RealtimeEvent,
    payload: T,
  ): Promise<void> {
    await this.dispatch(userRoom(tenantId, userId), tenantId, event, payload);
  }

  async emitToTenant<T>(tenantId: string, event: RealtimeEvent, payload: T): Promise<void> {
    await this.dispatch(tenantRoom(tenantId), tenantId, event, payload);
  }

  async emitToRoom<T>(
    room: string,
    tenantId: string,
    event: RealtimeEvent,
    payload: T,
  ): Promise<void> {
    await this.dispatch(room, tenantId, event, payload);
  }

  /** Builds the wire envelope used by every client. */
  buildEnvelope<T>(
    event: RealtimeEvent,
    channel: string,
    tenantId: string,
    payload: T,
  ): RealtimeEnvelope<T> {
    return {
      event,
      channel,
      tenantId,
      emittedAt: new Date().toISOString(),
      payload,
    };
  }

  private async dispatch<T>(
    room: string,
    tenantId: string,
    event: RealtimeEvent,
    payload: T,
  ): Promise<void> {
    const message: RealtimeDispatchMessage = {
      room,
      event,
      tenantId,
      emittedAt: new Date().toISOString(),
      payload,
    };

    try {
      await this.redis.publisher.publish(REALTIME_DISPATCH_CHANNEL, JSON.stringify(message));
    } catch (error) {
      // Realtime is an enhancement, never a source of truth: log and continue.
      this.logger.warn(
        {
          event: 'realtime.publish_failed',
          room,
          realtimeEvent: event,
          err: error instanceof Error ? { message: error.message, name: error.name } : undefined,
        },
        'Could not publish realtime message',
      );
    }
  }
}
