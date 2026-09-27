import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { addSeconds, sanitiseForLog } from '@wlct/utils';
import type { UserSessionDto } from '@wlct/shared-types';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotFoundException } from '../../../common/errors/app.exception';

export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  deviceId: string;
  deviceName?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  userAgent?: string | null;
  ipHash: string;
  geoLabel?: string | null;
  trusted?: boolean;
}

/**
 * Device/session registry.
 *
 * One row per device gives users a "signed-in devices" screen and gives the
 * platform a revocation point that survives access-token TTLs. A per-user cap
 * evicts the least recently used session so a leaked credential cannot spawn an
 * unbounded number of live sessions.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(SessionService.name) private readonly logger: PinoLogger,
  ) {}

  async createOrReuse(input: CreateSessionInput): Promise<{ id: string; isNewDevice: boolean }> {
    const existing = await this.prisma.userSession.findFirst({
      where: { userId: input.userId, deviceId: input.deviceId, revokedAt: null },
      select: { id: true },
    });

    const expiresAt = addSeconds(new Date(), this.config.refreshTokenTtlSeconds);

    if (existing) {
      await this.prisma.userSession.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          expiresAt,
          ipHash: input.ipHash,
          userAgent: input.userAgent ? sanitiseForLog(input.userAgent, 512) : null,
          geoLabel: input.geoLabel ?? null,
          ...(input.deviceName ? { deviceName: input.deviceName } : {}),
          ...(input.appVersion ? { appVersion: input.appVersion } : {}),
        },
      });
      return { id: existing.id, isNewDevice: false };
    }

    await this.enforceSessionCap(input.userId);

    const session = await this.prisma.userSession.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId,
        deviceId: input.deviceId,
        deviceName: input.deviceName ?? null,
        platform: input.platform ?? null,
        appVersion: input.appVersion ?? null,
        userAgent: input.userAgent ? sanitiseForLog(input.userAgent, 512) : null,
        ipHash: input.ipHash,
        geoLabel: input.geoLabel ?? null,
        trusted: input.trusted ?? false,
        expiresAt,
      },
      select: { id: true },
    });

    return { id: session.id, isNewDevice: true };
  }

  async touch(sessionId: string, ipHash: string): Promise<void> {
    await this.prisma.userSession
      .update({
        where: { id: sessionId },
        data: { lastSeenAt: new Date(), ipHash },
      })
      .catch(() => {
        // A revoked session may have been deleted concurrently; not fatal.
      });
  }

  async listForUser(userId: string, currentSessionId: string): Promise<UserSessionDto[]> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      platform: session.platform,
      appVersion: session.appVersion,
      ipHash: session.ipHash,
      approximateLocation: session.geoLabel,
      userAgent: session.userAgent,
      isCurrent: session.id === currentSessionId,
      trusted: session.trusted,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      revokedAt: session.revokedAt ? session.revokedAt.toISOString() : null,
    }));
  }

  async revoke(userId: string, sessionId: string, reason: string): Promise<void> {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });

    if (!session) {
      throw new NotFoundException('Session', sessionId);
    }

    await this.prisma.$transaction([
      this.prisma.userSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), revokeReason: reason.slice(0, 120) },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason.slice(0, 120) },
      }),
    ]);
  }

  async revokeAll(userId: string, exceptSessionId: string | null, reason: string): Promise<number> {
    const where = {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}),
    };

    const sessions = await this.prisma.userSession.findMany({ where, select: { id: true } });
    if (sessions.length === 0) {
      return 0;
    }

    const ids = sessions.map((session) => session.id);

    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: { id: { in: ids } },
        data: { revokedAt: new Date(), revokeReason: reason.slice(0, 120) },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId: { in: ids }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason.slice(0, 120) },
      }),
    ]);

    return ids.length;
  }

  /** Housekeeping: called by the maintenance queue. */
  async pruneExpired(): Promise<{ sessions: number; tokens: number }> {
    const now = new Date();
    const [tokens, sessions] = await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      this.prisma.userSession.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    ]);

    return { sessions: sessions.count, tokens: tokens.count };
  }

  private async enforceSessionCap(userId: string): Promise<void> {
    const max = this.config.maxActiveSessionsPerUser;
    const active = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'asc' },
      select: { id: true },
    });

    if (active.length < max) {
      return;
    }

    const evictCount = active.length - max + 1;
    const evictIds = active.slice(0, evictCount).map((session) => session.id);

    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: { id: { in: evictIds } },
        data: { revokedAt: new Date(), revokeReason: 'session_limit_reached' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId: { in: evictIds }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'session_limit_reached' },
      }),
    ]);

    this.logger.info(
      { event: 'auth.session_evicted', userId, evicted: evictIds.length, max },
      'Evicted least recently used sessions to respect the per-user cap',
    );
  }
}
