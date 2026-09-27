import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import { ErrorCode, type AuthenticatedActor, type JwtAccessPayload } from '@wlct/shared-types';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppException } from '../../../common/errors/app.exception';

/**
 * Passport JWT strategy.
 *
 * Signature verification alone is not enough for a trading platform: the
 * strategy also confirms that the user still exists, is still usable, that the
 * device session is still open, and that the token's `sv` claim still matches
 * the user's stored `sessionVersion` (bumped on password change and global
 * logout). That last check is what makes "sign out of all devices" effective
 * immediately rather than after the access-token TTL expires.
 */

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtAccessVerificationKey,
      algorithms: [config.jwtAlgorithm],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    };
    super(options);
  }

  async validate(payload: JwtAccessPayload): Promise<AuthenticatedActor> {
    if (payload.typ !== 'access') {
      throw new AppException({ code: ErrorCode.TOKEN_INVALID });
    }

    const [user, session] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: payload.sub, tenantId: payload.tid, deletedAt: null },
        select: { id: true, status: true, isPlatformUser: true, sessionVersion: true },
      }),
      this.prisma.userSession.findFirst({
        where: { id: payload.sid, userId: payload.sub, revokedAt: null },
        select: { id: true, expiresAt: true },
      }),
    ]);

    if (!user) {
      throw new AppException({
        code: ErrorCode.TOKEN_INVALID,
        message: 'Your session is no longer valid. Please sign in again.',
      });
    }

    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      throw new AppException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: 'This account has been disabled. Contact support for assistance.',
      });
    }

    if (user.status === 'LOCKED') {
      throw new AppException({
        code: ErrorCode.ACCOUNT_LOCKED,
        message: 'This account is locked. Reset your password or contact support.',
      });
    }

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new AppException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'This device was signed out. Please sign in again.',
      });
    }

    // Server-side revocation of live access tokens.
    //
    // `sessionVersion` is incremented on password change and on "sign out of
    // all devices", so any token minted before that action carries a stale `sv`
    // and dies here rather than living on until it expires.
    //
    // An integer counter is used deliberately instead of comparing `iat` with
    // `passwordChangedAt`: `iat` has one-second resolution (RFC 7519) while the
    // timestamp is stored in milliseconds, so a token issued in the same second
    // as the change - exactly what happens when a user is handed fresh tokens
    // right after changing their password, or when a newly provisioned tenant
    // owner signs in - would be wrongly rejected. The counter has no such
    // ambiguity and cannot be affected by clock drift between API instances.
    if (payload.sv !== user.sessionVersion) {
      throw new AppException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'Your session is no longer valid. Please sign in again.',
      });
    }

    return {
      userId: payload.sub,
      tenantId: payload.tid,
      sessionId: payload.sid,
      roles: payload.roles,
      permissions: payload.perms,
      isPlatformUser: user.isPlatformUser,
      tokenId: payload.jti,
    };
  }
}
