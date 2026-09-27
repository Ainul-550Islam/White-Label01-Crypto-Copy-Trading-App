import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Socket } from 'socket.io';
import { ErrorCode, type AuthenticatedActor } from '@wlct/shared-types';

import { TokenService } from '../../auth/services/token.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppException } from '../../../common/errors/app.exception';

export interface AuthenticatedSocketData {
  actor: AuthenticatedActor;
  subscriptions: Set<string>;
}

/**
 * Authenticates a Socket.IO handshake.
 *
 * This is not a Nest `CanActivate` guard on purpose: the connection has to be
 * authenticated inside `handleConnection`, before any message is processed, so
 * an unauthenticated socket is never allowed to linger. It applies exactly the
 * same checks as the HTTP JWT strategy - signature, blacklist, user status,
 * session validity and tenant status - so a socket can never outlive the access
 * that created it.
 */
@Injectable()
export class WsAuthGuard {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(WsAuthGuard.name) private readonly logger: PinoLogger,
  ) {}

  async authenticate(socket: Socket): Promise<AuthenticatedActor> {
    const token = this.extractToken(socket);

    if (!token) {
      throw new AppException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'An access token is required to open a realtime connection.',
      });
    }

    const payload = await this.tokens.verifyAccessToken(token);

    const [user, session] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: payload.sub, tenantId: payload.tid, deletedAt: null },
        select: {
          id: true,
          tenantId: true,
          status: true,
          isPlatformUser: true,
          sessionVersion: true,
          tenant: { select: { status: true } },
        },
      }),
      this.prisma.userSession.findFirst({
        where: { id: payload.sid, revokedAt: null },
        select: { id: true, expiresAt: true },
      }),
    ]);

    if (!user || user.status !== 'ACTIVE') {
      throw new AppException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: 'This account can no longer open realtime connections.',
      });
    }

    if (user.tenant.status !== 'ACTIVE') {
      throw new AppException({
        code: ErrorCode.TENANT_SUSPENDED,
        message: 'This organisation is currently suspended.',
      });
    }

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new AppException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'This session is no longer valid.',
      });
    }

    // Same global-revocation check the HTTP strategy performs: a password change
    // or "sign out of all devices" must also drop live WebSocket connections,
    // not just reject the next HTTP call.
    if (payload.sv !== user.sessionVersion) {
      throw new AppException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'This session is no longer valid.',
      });
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      sessionId: payload.sid,
      roles: payload.roles,
      permissions: payload.perms,
      isPlatformUser: user.isPlatformUser,
      tokenId: payload.jti,
    };
  }

  /**
   * Accepts the token from `auth.token` (the documented, safest option) or the
   * Authorization header. Query strings are deliberately not supported: they
   * end up in proxy access logs.
   */
  private extractToken(socket: Socket): string | null {
    const handshakeAuth = socket.handshake.auth as { token?: unknown } | undefined;
    if (handshakeAuth && typeof handshakeAuth.token === 'string' && handshakeAuth.token) {
      return handshakeAuth.token.replace(/^Bearer\s+/i, '');
    }

    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7);
    }

    this.logger.debug(
      { event: 'ws.missing_token', socketId: socket.id },
      'Realtime handshake without credentials',
    );
    return null;
  }
}
