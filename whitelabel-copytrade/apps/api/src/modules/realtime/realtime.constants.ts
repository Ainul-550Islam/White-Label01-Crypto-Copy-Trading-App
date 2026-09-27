/**
 * Redis pub/sub channel used to fan realtime messages out across API nodes.
 *
 * Any process (API instance, BullMQ worker, future Python service via the same
 * Redis) can publish an envelope here; every gateway instance relays it to the
 * sockets it owns. Keeping the channel name in one place avoids the classic
 * "worker publishes to a channel nobody subscribes to" bug.
 */
export const REALTIME_DISPATCH_CHANNEL = 'realtime:dispatch';

export interface RealtimeDispatchMessage {
  room: string;
  event: string;
  tenantId: string;
  emittedAt: string;
  payload: unknown;
}
