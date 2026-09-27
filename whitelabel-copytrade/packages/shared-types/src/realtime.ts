import type { ISODateString, UUID } from './common';

/** Socket.IO event names shared by server and clients. */
export enum RealtimeEvent {
  CONNECTION_ESTABLISHED = 'connection.established',
  CONNECTION_ERROR = 'connection.error',
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  SUBSCRIPTION_ACK = 'subscription.ack',
  HEARTBEAT = 'heartbeat',

  NOTIFICATION_CREATED = 'notification.created',
  SECURITY_ALERT = 'security.alert',
  SESSION_REVOKED = 'session.revoked',
  TENANT_CONFIG_UPDATED = 'tenant.config.updated',
  FEATURE_FLAG_UPDATED = 'feature_flag.updated',

  // Trading channels are declared now so client code stays stable across parts
  MARKET_TICKER = 'market.ticker',
  MARKET_ORDERBOOK = 'market.orderbook',
  ORDER_UPDATED = 'order.updated',
  POSITION_UPDATED = 'position.updated',
  PORTFOLIO_UPDATED = 'portfolio.updated',
  COPY_TRADE_EXECUTED = 'copy_trade.executed',
}

export enum RealtimeChannel {
  USER = 'user',
  TENANT = 'tenant',
  MARKET = 'market',
  TRADER = 'trader',
}

export interface RealtimeSubscribePayload {
  channel: RealtimeChannel;
  /** Resource identifier, e.g. a symbol for market channels. */
  target?: string;
}

export interface RealtimeEnvelope<TPayload> {
  event: RealtimeEvent;
  channel: string;
  tenantId: UUID;
  emittedAt: ISODateString;
  payload: TPayload;
}

export function userRoom(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:user:${userId}`;
}

export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function marketRoom(symbol: string): string {
  return `market:${symbol.toUpperCase()}`;
}

export function traderRoom(tenantId: string, traderId: string): string {
  return `tenant:${tenantId}:trader:${traderId}`;
}
