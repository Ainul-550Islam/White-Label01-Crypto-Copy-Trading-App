import { type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Server, Socket } from 'socket.io';
import {
  RealtimeChannel,
  RealtimeEvent,
  marketRoom,
  tenantRoom,
  traderRoom,
  userRoom,
  type RealtimeSubscribePayload,
} from '@wlct/shared-types';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { WsAuthGuard, type AuthenticatedSocketData } from './guards/ws-auth.guard';
import { REALTIME_DISPATCH_CHANNEL, type RealtimeDispatchMessage } from './realtime.constants';
import { AppException } from '../../common/errors/app.exception';
import { WebsocketLimitGuard } from '../billing/enforcement/websocket-limit.guard';
import type { EnforcementActor } from '../billing/enforcement/enforcement.types';

/**
 * Socket.IO gateway.
 *
 * Security model:
 *   - the handshake must carry a valid access token; unauthenticated sockets
 *     are disconnected before they can emit anything;
 *   - rooms are derived from the authenticated actor, never from client input,
 *     so a socket cannot subscribe itself into another tenant;
 *   - per-user connection count is capped to blunt resource exhaustion;
 *   - inbound messages are validated as strictly as HTTP bodies.
 *
 * Enforcement integration (Part 2):
 *   - Before allowing connection, check websocketConnections plan limit via
 *     WebsocketLimitGuard (atomic Lua reservation)
 *   - On disconnect, release the slot to prevent leak
 *   - Plan limit resolved from catalog, no hardcoded values
 */
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private server!: Server;

  /** userId -> live socket ids, used to enforce the per-user connection cap. */
  private readonly connections = new Map<string, Set<string>>();

  constructor(
    private readonly wsAuth: WsAuthGuard,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly websocketLimitGuard: WebsocketLimitGuard,
    @InjectPinoLogger(RealtimeGateway.name) private readonly logger: PinoLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.wsEnabled) {
      return;
    }

    // Relay everything published by other nodes and by background workers.
    await this.redis.subscriber.subscribe(REALTIME_DISPATCH_CHANNEL);

    this.redis.subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== REALTIME_DISPATCH_CHANNEL) {
        return;
      }

      try {
        const message = JSON.parse(raw) as RealtimeDispatchMessage;
        this.server?.to(message.room).emit(message.event, {
          event: message.event,
          channel: message.room,
          tenantId: message.tenantId,
          emittedAt: message.emittedAt,
          payload: message.payload,
        });
      } catch (error) {
        this.logger.warn(
          {
            event: 'realtime.relay_failed',
            err: error instanceof Error ? { message: error.message, name: error.name } : undefined,
          },
          'Dropped a malformed realtime dispatch message',
        );
      }
    });

    this.logger.info(
      { event: 'realtime.ready', namespace: this.config.wsNamespace, path: this.config.wsPath },
      'Realtime gateway listening',
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.subscriber.unsubscribe(REALTIME_DISPATCH_CHANNEL);
    } catch {
      // The process is shutting down; nothing useful to do with this failure.
    }
  }

  async handleConnection(socket: Socket): Promise<void> {
    if (!this.config.wsEnabled) {
      socket.disconnect(true);
      return;
    }

    try {
      const actor = await this.wsAuth.authenticate(socket);

      const existing = this.connections.get(actor.userId) ?? new Set<string>();
      if (existing.size >= this.config.wsMaxConnectionsPerUser) {
        socket.emit(RealtimeEvent.CONNECTION_ERROR, {
          code: 'TOO_MANY_CONNECTIONS',
          message: 'Too many concurrent realtime connections for this account.',
        });
        socket.disconnect(true);
        return;
      }

      // Enforcement: check websocketConnections plan limit (atomic reservation)
      const enforcementActor: EnforcementActor = {
        userId: actor.userId,
        tenantId: actor.tenantId,
        roles: [],
        ipHash: '',
        requestId: '',
        correlationId: '',
      };

      try {
        await this.websocketLimitGuard.reserveConnection(enforcementActor);
      } catch (error) {
        // Plan limit exceeded — reject connection with machine-readable code
        const code = error instanceof AppException ? error.code : 'PLAN_LIMIT_EXCEEDED';
        socket.emit(RealtimeEvent.CONNECTION_ERROR, {
          code,
          message: 'WebSocket connection limit reached for your current plan.',
        });
        socket.disconnect(true);
        this.logger.warn(
          {
            event: 'realtime.limit_exceeded',
            tenantId: actor.tenantId,
            userId: actor.userId,
            code,
          },
          'Rejected realtime connection due to plan limit',
        );
        return;
      }

      existing.add(socket.id);
      this.connections.set(actor.userId, existing);

      const data: AuthenticatedSocketData = { actor, subscriptions: new Set<string>() };
      socket.data = data;

      // Every socket is joined to its own user room and its tenant room. No
      // client input is involved, so cross-tenant delivery is impossible.
      await socket.join(userRoom(actor.tenantId, actor.userId));
      await socket.join(tenantRoom(actor.tenantId));

      socket.emit(RealtimeEvent.CONNECTION_ESTABLISHED, {
        userId: actor.userId,
        tenantId: actor.tenantId,
        sessionId: actor.sessionId,
        serverTime: new Date().toISOString(),
      });

      this.logger.info(
        { event: 'realtime.connected', tenantId: actor.tenantId, socketId: socket.id },
        'Realtime client connected',
      );
    } catch (error) {
      const code = error instanceof AppException ? error.code : 'UNAUTHORIZED';
      socket.emit(RealtimeEvent.CONNECTION_ERROR, {
        code,
        message: 'Realtime authentication failed.',
      });
      socket.disconnect(true);

      this.logger.warn(
        { event: 'realtime.auth_failed', socketId: socket.id, code },
        'Rejected a realtime connection',
      );
    }
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as AuthenticatedSocketData | undefined;
    if (!data?.actor) {
      return;
    }

    const sockets = this.connections.get(data.actor.userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.connections.delete(data.actor.userId);
      }
    }

    // Enforcement: release websocket slot on disconnect to prevent leak
    this.websocketLimitGuard.releaseConnection(data.actor.tenantId).catch(() => {
      // Best-effort release; don't fail disconnect path
    });

    this.logger.info(
      { event: 'realtime.disconnected', tenantId: data.actor.tenantId, socketId: socket.id },
      'Realtime client disconnected',
    );
  }

  @SubscribeMessage(RealtimeEvent.SUBSCRIBE)
  async handleSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: RealtimeSubscribePayload,
  ): Promise<{ subscribed: boolean; channel: string | null; reason?: string }> {
    const data = socket.data as AuthenticatedSocketData | undefined;
    if (!data?.actor) {
      return { subscribed: false, channel: null, reason: 'unauthenticated' };
    }

    const room = this.resolveRoom(data.actor.tenantId, data.actor.userId, payload);
    if (!room) {
      return { subscribed: false, channel: null, reason: 'invalid_channel' };
    }

    await socket.join(room);
    data.subscriptions.add(room);

    socket.emit(RealtimeEvent.SUBSCRIPTION_ACK, { channel: room, subscribed: true });
    return { subscribed: true, channel: room };
  }

  @SubscribeMessage(RealtimeEvent.UNSUBSCRIBE)
  async handleUnsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: RealtimeSubscribePayload,
  ): Promise<{ subscribed: boolean; channel: string | null }> {
    const data = socket.data as AuthenticatedSocketData | undefined;
    if (!data?.actor) {
      return { subscribed: false, channel: null };
    }

    const room = this.resolveRoom(data.actor.tenantId, data.actor.userId, payload);
    if (!room) {
      return { subscribed: false, channel: null };
    }

    await socket.leave(room);
    data.subscriptions.delete(room);

    return { subscribed: false, channel: room };
  }

  @SubscribeMessage(RealtimeEvent.HEARTBEAT)
  handleHeartbeat(@ConnectedSocket() socket: Socket): { serverTime: string } {
    const data = socket.data as AuthenticatedSocketData | undefined;
    void data;
    return { serverTime: new Date().toISOString() };
  }

  /**
   * Maps a client subscription request onto a room name.
   *
   * The tenant id always comes from the authenticated actor. Market rooms are
   * global (public price data) but the symbol is normalised and validated so a
   * client cannot inject an arbitrary room name.
   */
  private resolveRoom(
    tenantId: string,
    userId: string,
    payload: RealtimeSubscribePayload,
  ): string | null {
    if (!payload || typeof payload.channel !== 'string') {
      return null;
    }

    switch (payload.channel) {
      case RealtimeChannel.USER:
        return userRoom(tenantId, userId);

      case RealtimeChannel.TENANT:
        return tenantRoom(tenantId);

      case RealtimeChannel.MARKET: {
        const symbol = (payload.target ?? '').toUpperCase();
        return /^[A-Z0-9]{2,12}[-/]?[A-Z0-9]{2,12}$/.test(symbol) ? marketRoom(symbol) : null;
      }

      case RealtimeChannel.TRADER: {
        const traderId = payload.target ?? '';
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(traderId)
          ? traderRoom(tenantId, traderId)
          : null;
      }

      default:
        return null;
    }
  }
}
