import { Global, Module } from '@nestjs/common';

import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { WsAuthGuard } from './guards/ws-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { EnforcementModule } from '../billing/enforcement/enforcement.module';

/**
 * Socket.IO transport.
 *
 * Global so domain services can emit without importing the gateway, which also
 * keeps the module graph free of cycles.
 *
 * AuthModule is imported for TokenService: the WebSocket handshake is verified
 * with exactly the same access-token verification path as HTTP requests, so a
 * revoked session cannot linger on an open socket. This edge is safe because
 * nothing in the auth chain imports RealtimeModule - emitters depend on the
 * globally exported RealtimeService instead, which creates no module edge.
 *
 * Enforcement integration (Part 2):
 *  - Imports EnforcementModule to provide WebsocketLimitGuard
 *  - Gateway reserves websocketConnections slot atomically on connection
 *  - Release on disconnect prevents leak
 */
@Global()
@Module({
  imports: [AuthModule, EnforcementModule],
  providers: [RealtimeGateway, RealtimeService, WsAuthGuard],
  exports: [RealtimeService],
})
export class RealtimeModule {}
