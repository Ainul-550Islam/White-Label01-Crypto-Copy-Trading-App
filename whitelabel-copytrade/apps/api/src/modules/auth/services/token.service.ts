import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  ErrorCode,
  SecurityEventType,
  SecuritySeverity,
  type JwtAccessPayload,
  type JwtRefreshPayload,
  type JwtTwoFactorPayload,
  type TokenPairDto,
} from '@wlct/shared-types';
import { CACHE_KEY } from '@wlct/config';
import { addSeconds } from '@wlct/utils';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../../infrastructure/crypto/crypto.service';
import { CacheService } from '../../../infrastructure/redis/cache.service';
import { AuditService } from '../../audit/audit.service';
import { SecurityEventService as SecurityEventsService } from '../../security/security-event.service';
import { AppException } from '../../../common/errors/app.exception';

export interface IssueTokenContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  roles: string[];
  permissions: string[];
  isPlatformUser: boolean;
  /** Stamped into the access token so global sign-out takes effect at once. */
  sessionVersion: number;
  ipHash?: string;
  userAgent?: string | null;
  /** Continues an existing rotation family during refresh. */
  familyId?: string;
}

/**
 * Issues, verifies and rotates JWTs.
 *
 * Refresh tokens are opaque to the client but carry a signed payload for cheap
 * pre-validation; the authoritative state lives in the `refresh_tokens` table,
 * stored as an HMAC so a database dump cannot be replayed against the API.
 *
 * Rotation with reuse detection:
 *   - every refresh consumes the presented token and issues a new one in the
 *     same `familyId`;
 *   - presenting an already-consumed token means it was stolen (or the client
 *     is broken), so the entire family is revoked and the user is signed out
 *     everywhere, with a CRITICAL security event recorded.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    private readonly securityEvents: SecurityEventsService,
    @InjectPinoLogger(TokenService.name) private readonly logger: PinoLogger,
  ) {}

  async issueTokenPair(context: IssueTokenContext): Promise<TokenPairDto> {
    const accessTokenId = randomUUID();
    const refreshTokenId = randomUUID();
    const familyId = context.familyId ?? randomUUID();

    const accessPayload: Omit<JwtAccessPayload, 'iat' | 'exp' | 'iss' | 'aud'> = {
      sub: context.userId,
      sid: context.sessionId,
      tid: context.tenantId,
      typ: 'access',
      roles: context.roles,
      perms: context.permissions,
      plat: context.isPlatformUser,
      sv: context.sessionVersion,
      jti: accessTokenId,
    };

    const refreshPayload: Omit<JwtRefreshPayload, 'iat' | 'exp' | 'iss' | 'aud'> = {
      sub: context.userId,
      sid: context.sessionId,
      tid: context.tenantId,
      typ: 'refresh',
      fam: familyId,
      jti: refreshTokenId,
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.config.jwtAccessSigningKey,
      algorithm: this.config.jwtAlgorithm,
      expiresIn: this.config.accessTokenTtl,
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience,
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.config.jwtRefreshSigningKey,
      algorithm: this.config.jwtAlgorithm,
      expiresIn: this.config.refreshTokenTtl,
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience,
    });

    await this.prisma.refreshToken.create({
      data: {
        id: refreshTokenId,
        userId: context.userId,
        tenantId: context.tenantId,
        sessionId: context.sessionId,
        tokenHash: this.crypto.hashToken(refreshToken),
        familyId,
        status: 'ACTIVE',
        expiresAt: addSeconds(new Date(), this.config.refreshTokenTtlSeconds),
        ipHash: context.ipHash ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessTokenTtlSeconds,
      refreshExpiresIn: this.config.refreshTokenTtlSeconds,
    };
  }

  /** Verifies an access token signature, expiry and revocation state. */
  async verifyAccessToken(token: string): Promise<JwtAccessPayload> {
    let payload: JwtAccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
        secret: this.config.jwtAccessVerificationKey,
        algorithms: [this.config.jwtAlgorithm],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
    } catch (error) {
      const name = (error as Error).name;
      throw new AppException({
        code: name === 'TokenExpiredError' ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
        message:
          name === 'TokenExpiredError'
            ? 'Your session has expired. Please sign in again.'
            : 'Your session is no longer valid. Please sign in again.',
      });
    }

    if (payload.typ !== 'access') {
      throw new AppException({
        code: ErrorCode.TOKEN_INVALID,
        message: 'Your session is no longer valid. Please sign in again.',
      });
    }

    const revoked = await this.cache.get<boolean>(CACHE_KEY.revokedToken(payload.jti));
    if (revoked) {
      throw new AppException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'Your session has been signed out. Please sign in again.',
      });
    }

    return payload;
  }

  /**
   * Consumes a refresh token and returns the context needed to mint a new pair.
   * Detects and punishes token reuse.
   */
  async consumeRefreshToken(
    presentedToken: string,
    deviceId: string,
    context: { ipHash: string; userAgent: string | null; requestId: string },
  ): Promise<{ userId: string; tenantId: string; sessionId: string; familyId: string }> {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(presentedToken, {
        secret: this.config.jwtRefreshVerificationKey,
        algorithms: [this.config.jwtAlgorithm],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
    } catch (error) {
      const name = (error as Error).name;
      throw new AppException({
        code: name === 'TokenExpiredError' ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
        message: 'Your session has expired. Please sign in again.',
      });
    }

    if (payload.typ !== 'refresh') {
      throw new AppException({ code: ErrorCode.TOKEN_INVALID });
    }

    const tokenHash = this.crypto.hashToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        tenantId: true,
        sessionId: true,
        familyId: true,
        status: true,
        expiresAt: true,
        session: { select: { deviceId: true, revokedAt: true } },
      },
    });

    if (!stored) {
      // A validly signed token that we have never stored means the row was
      // deleted (global logout) or the token was forged with a leaked key.
      throw new AppException({
        code: ErrorCode.TOKEN_INVALID,
        message: 'Your session is no longer valid. Please sign in again.',
      });
    }

    if (stored.status !== 'ACTIVE') {
      await this.handleTokenReuse(stored.familyId, stored.userId, stored.tenantId, context);
      throw new AppException({
        code: ErrorCode.REFRESH_TOKEN_REUSE_DETECTED,
        message:
          'A security issue was detected with your session and all devices were signed out. Please sign in again.',
      });
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { status: 'EXPIRED' },
      });
      throw new AppException({
        code: ErrorCode.TOKEN_EXPIRED,
        message: 'Your session has expired. Please sign in again.',
      });
    }

    if (stored.session.revokedAt) {
      throw new AppException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'This device was signed out. Please sign in again.',
      });
    }

    // Binding the refresh token to its device stops a stolen token from being
    // replayed from a different client installation.
    if (stored.session.deviceId !== deviceId) {
      await this.securityEvents.record({
        tenantId: stored.tenantId,
        userId: stored.userId,
        type: SecurityEventType.TOKEN_REUSE,
        severity: SecuritySeverity.HIGH,
        description: 'Refresh token presented from a device other than the one it was issued to.',
        ipHash: context.ipHash,
        requestId: context.requestId,
        metadata: { expectedDeviceId: stored.session.deviceId, presentedDeviceId: deviceId },
      });
      throw new AppException({
        code: ErrorCode.TOKEN_INVALID,
        message: 'Your session is no longer valid. Please sign in again.',
      });
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { status: 'ROTATED', usedAt: new Date() },
    });

    return {
      userId: stored.userId,
      tenantId: stored.tenantId,
      sessionId: stored.sessionId,
      familyId: stored.familyId,
    };
  }

  /** Issues the short-lived token that carries a user through the 2FA step. */
  async issueTwoFactorChallenge(
    userId: string,
    tenantId: string,
    deviceId: string,
  ): Promise<{ token: string; expiresIn: number }> {
    const payload: Omit<JwtTwoFactorPayload, 'iat' | 'exp'> = {
      sub: userId,
      tid: tenantId,
      typ: '2fa_challenge',
      did: deviceId,
      jti: randomUUID(),
    };

    const token = await this.jwtService.signAsync(payload, {
      secret: this.config.jwtAccessSigningKey,
      algorithm: this.config.jwtAlgorithm,
      expiresIn: this.config.twoFactorChallengeTtl,
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience,
    });

    return { token, expiresIn: this.config.twoFactorChallengeTtlSeconds };
  }

  async verifyTwoFactorChallenge(token: string): Promise<JwtTwoFactorPayload> {
    let payload: JwtTwoFactorPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtTwoFactorPayload>(token, {
        secret: this.config.jwtAccessVerificationKey,
        algorithms: [this.config.jwtAlgorithm],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
    } catch {
      throw new AppException({
        code: ErrorCode.TOKEN_EXPIRED,
        message: 'The verification window expired. Please sign in again.',
      });
    }

    if (payload.typ !== '2fa_challenge') {
      throw new AppException({ code: ErrorCode.TOKEN_INVALID });
    }

    // A challenge is burned outright once it has been spent on a successful
    // verification (see consumeTwoFactorChallenge), so a captured token can
    // never be replayed to mint a second session.
    const consumedKey = this.twoFactorChallengeConsumedKey(payload.jti);
    const alreadyUsed = await this.cache.get<boolean>(consumedKey);
    if (alreadyUsed) {
      throw new AppException({
        code: ErrorCode.TOKEN_INVALID,
        message: 'This verification request was already used. Please sign in again.',
      });
    }

    // Failed attempts are counted rather than burning the challenge, otherwise a
    // single mistyped digit would force the user back through the password step.
    // The counter is atomic (INCR) and expires with the challenge itself, so an
    // attacker holding a stolen challenge token gets a strictly bounded number
    // of guesses at a 6-digit code instead of a full TTL of brute force.
    const attempts = await this.cache.increment(
      this.twoFactorChallengeAttemptsKey(payload.jti),
      this.config.twoFactorChallengeTtlSeconds,
    );

    if (attempts > this.config.twoFactorMaxChallengeAttempts) {
      await this.cache.set(consumedKey, true, this.config.twoFactorChallengeTtlSeconds);
      throw new AppException({
        code: ErrorCode.TOKEN_INVALID,
        message: 'Too many incorrect verification codes. Please sign in again.',
      });
    }

    return payload;
  }

  /**
   * Marks a challenge as spent. Called only after the second factor has been
   * accepted, which makes the token strictly single-use for issuing a session
   * while still allowing a few wrong codes beforehand.
   */
  async consumeTwoFactorChallenge(jti: string): Promise<void> {
    await this.cache.set(
      this.twoFactorChallengeConsumedKey(jti),
      true,
      this.config.twoFactorChallengeTtlSeconds,
    );
    await this.cache.delete(this.twoFactorChallengeAttemptsKey(jti));
  }

  private twoFactorChallengeConsumedKey(jti: string): string {
    return `auth:2fa-challenge:${jti}`;
  }

  private twoFactorChallengeAttemptsKey(jti: string): string {
    return `auth:2fa-challenge-attempts:${jti}`;
  }

  /** Revokes every refresh token in a session (single device logout). */
  async revokeSessionTokens(sessionId: string, reason: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { sessionId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason.slice(0, 120) },
    });
    return result.count;
  }

  /** Revokes every refresh token for a user (global logout / password change). */
  async revokeAllUserTokens(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason.slice(0, 120) },
    });
    return result.count;
  }

  /**
   * Blacklists a still-valid access token id until its natural expiry, which
   * closes the gap between a logout and the access token TTL.
   */
  async blacklistAccessToken(tokenId: string, expiresAtEpochSeconds: number): Promise<void> {
    const ttl = Math.max(1, expiresAtEpochSeconds - Math.floor(Date.now() / 1000));
    await this.cache.set(CACHE_KEY.revokedToken(tokenId), true, ttl);
  }

  private async handleTokenReuse(
    familyId: string,
    userId: string,
    tenantId: string,
    context: { ipHash: string; userAgent: string | null; requestId: string },
  ): Promise<void> {
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { familyId, status: { in: ['ACTIVE', 'ROTATED'] } },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: 'refresh_token_reuse_detected',
      },
    });

    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'refresh_token_reuse_detected' },
    });

    this.logger.error(
      { event: 'auth.token_reuse', userId, tenantId, familyId, revokedCount: revoked.count },
      'Refresh token reuse detected: the token family and all sessions were revoked',
    );

    await this.securityEvents.record({
      tenantId,
      userId,
      type: SecurityEventType.TOKEN_REUSE,
      severity: SecuritySeverity.CRITICAL,
      description:
        'A consumed refresh token was presented again. The token family and every session were revoked.',
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      requestId: context.requestId,
      metadata: { familyId, revokedTokens: revoked.count },
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.SYSTEM,
      actorId: userId,
      action: AuditAction.TOKEN_REUSE_DETECTED,
      outcome: AuditOutcome.DENIED,
      resourceType: 'RefreshToken',
      resourceId: familyId,
      description: 'Refresh token reuse detected; all sessions revoked.',
      ipHash: context.ipHash,
      requestId: context.requestId,
    });
  }
}
