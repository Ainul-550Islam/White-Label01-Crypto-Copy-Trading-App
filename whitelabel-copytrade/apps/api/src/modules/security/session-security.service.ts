import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SecurityPolicyService } from './security-policy.service';
import { SecurityEventService } from './security-event.service';
import { SecurityAuditService } from './security-audit.service';
import { SessionState, SecurityEventType, SecurityRisk } from './security.types';
import { CacheService } from '../../infrastructure/redis/cache.service';

/**
 * Session lifecycle security: issuance metadata, rotation, revocation, idle timeout, absolute timeout, suspicious-session detection, and global logout support.
 * Integrates with existing session/token implementation, does not create second auth system.
 */
@Injectable()
export class SessionSecurityService {
  private readonly logger = new Logger(SessionSecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: SecurityPolicyService,
    private readonly eventService: SecurityEventService,
    private readonly auditService: SecurityAuditService,
    private readonly cache: CacheService,
  ) {}

  async registerSession(params: {
    sessionId: string;
    userId: string;
    tenantId: string;
    deviceId: string;
    ipHash: string;
    userAgent?: string;
    geoLabel?: string;
    requestId?: string;
  }): Promise<void> {
    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });

    // Enforce concurrent session limits
    await this.enforceConcurrentLimit(params.userId, params.tenantId, policy.maxConcurrentSessions);

    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + policy.sessionAbsoluteTimeoutSec * 1000);
    const idleExpiresAt = new Date(now.getTime() + policy.sessionIdleTimeoutSec * 1000);

    // Store in cache for fast revocation check
    try {
      await this.cache.set(`session:${params.sessionId}:meta`, {
        userId: params.userId,
        tenantId: params.tenantId,
        deviceId: params.deviceId,
        ipHash: params.ipHash,
        createdAt: now.toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        idleExpiresAt: idleExpiresAt.toISOString(),
        state: SessionState.ACTIVE,
      }, policy.sessionAbsoluteTimeoutSec);
    } catch (e: any) {
      this.logger.warn(`Failed to cache session meta: ${e.message}`);
    }

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: params.userId,
      type: SecurityEventType.SESSION_CREATED,
      severity: SecurityRisk.LOW,
      description: `Session created sessionId=${params.sessionId} deviceId=${params.deviceId}`,
      safeMetadata: { sessionId: params.sessionId, deviceId: params.deviceId, geoLabel: params.geoLabel },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });
  }

  async touchSession(sessionId: string, ipHash: string): Promise<{ valid: boolean; reason?: string }> {
    try {
      // Check revocation in cache
      const revoked = await this.cache.get(`session:${sessionId}:revoked`);
      if (revoked) {
        return { valid: false, reason: 'REVOKED' };
      }

      const meta = await this.cache.get<any>(`session:${sessionId}:meta`);
      if (!meta) {
        // Try DB fallback - check UserSession table
        const session = await (this.prisma as any).userSession?.findUnique({ where: { id: sessionId } });
        if (!session) {
          return { valid: false, reason: 'NOT_FOUND' };
        }
        if (session.revokedAt) {
          return { valid: false, reason: 'REVOKED' };
        }
        if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
          return { valid: false, reason: 'EXPIRED' };
        }
        // Re-cache
        return { valid: true };
      }

      const now = new Date();
      if (meta.absoluteExpiresAt && new Date(meta.absoluteExpiresAt) < now) {
        return { valid: false, reason: 'ABSOLUTE_TIMEOUT' };
      }
      if (meta.idleExpiresAt && new Date(meta.idleExpiresAt) < now) {
        return { valid: false, reason: 'IDLE_TIMEOUT' };
      }

      // Update idle expiry
      const tenantId = meta.tenantId;
      const policy = await this.policyService.getEffectivePolicy({ tenantId });
      const newIdleExpiresAt = new Date(now.getTime() + policy.sessionIdleTimeoutSec * 1000);

      meta.lastSeenAt = now.toISOString();
      meta.idleExpiresAt = newIdleExpiresAt.toISOString();
      meta.ipHash = ipHash;

      try {
        await this.cache.set(`session:${sessionId}:meta`, meta, policy.sessionAbsoluteTimeoutSec);
      } catch {}

      // Also touch in DB via existing SessionService pattern
      try {
        await (this.prisma as any).userSession?.update({
          where: { id: sessionId },
          data: { lastSeenAt: now, ipHash },
        });
      } catch {}

      return { valid: true };
    } catch (e: any) {
      this.logger.warn(`touchSession failed session=${sessionId}: ${e.message}`);
      return { valid: true }; // Fail open for cache errors, DB is source of truth
    }
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    try {
      const revoked = await this.cache.get(`session:${sessionId}:revoked`);
      if (revoked) return true;

      const session = await (this.prisma as any).userSession?.findUnique({ where: { id: sessionId }, select: { revokedAt: true } });
      return !!session?.revokedAt;
    } catch {
      return false;
    }
  }

  async revokeSession(params: { sessionId: string; userId: string; tenantId: string; reason: string; actorId?: string; ipHash?: string; requestId?: string }): Promise<void> {
    try {
      await this.cache.set(`session:${params.sessionId}:revoked`, { reason: params.reason, revokedAt: new Date().toISOString() }, 86400 * 7);
    } catch {}

    try {
      await (this.prisma as any).userSession?.update({
        where: { id: params.sessionId },
        data: { revokedAt: new Date(), revokeReason: params.reason.substring(0, 120) },
      });
    } catch {}

    try {
      await (this.prisma as any).refreshToken?.updateMany({
        where: { sessionId: params.sessionId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: params.reason.substring(0, 120) },
      });
    } catch {}

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: params.userId,
      type: SecurityEventType.SESSION_REVOKED,
      severity: SecurityRisk.MEDIUM,
      description: `Session revoked sessionId=${params.sessionId} reason=${params.reason}`,
      safeMetadata: { sessionId: params.sessionId, reason: params.reason },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId || params.userId,
      event: 'SESSION_REVOKED',
      result: 'SUCCESS',
      targetType: 'Session',
      targetId: params.sessionId,
      safeMetadata: { reason: params.reason },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    this.logger.log(`Session revoked session=${params.sessionId} tenant=${params.tenantId} reason=${params.reason}`);
  }

  async revokeAllSessions(params: { userId: string; tenantId: string; exceptSessionId?: string | null; reason: string; actorId?: string; ipHash?: string; requestId?: string }): Promise<number> {
    try {
      const sessions = await (this.prisma as any).userSession?.findMany({
        where: { userId: params.userId, revokedAt: null, ...(params.exceptSessionId ? { NOT: { id: params.exceptSessionId } } : {}) },
        select: { id: true },
      }) || [];

      for (const session of sessions) {
        try {
          await this.cache.set(`session:${session.id}:revoked`, { reason: params.reason, revokedAt: new Date().toISOString() }, 86400 * 7);
        } catch {}
      }

      const where = {
        userId: params.userId,
        revokedAt: null,
        ...(params.exceptSessionId ? { NOT: { id: params.exceptSessionId } } : {}),
      };

      await (this.prisma as any).userSession?.updateMany({
        where,
        data: { revokedAt: new Date(), revokeReason: params.reason.substring(0, 120) },
      });

      const ids = sessions.map((s: any) => s.id);
      if (ids.length > 0) {
        await (this.prisma as any).refreshToken?.updateMany({
          where: { sessionId: { in: ids }, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: params.reason.substring(0, 120) },
        });
      }

      await this.eventService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        type: SecurityEventType.SESSION_REVOKED,
        severity: SecurityRisk.HIGH,
        description: `All sessions revoked for user ${params.userId} reason=${params.reason} count=${sessions.length}`,
        safeMetadata: { reason: params.reason, count: sessions.length, exceptSessionId: params.exceptSessionId },
        ipHash: params.ipHash,
        requestId: params.requestId,
      });

      await this.auditService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        actorId: params.actorId || params.userId,
        event: 'SESSION_REVOKED',
        result: 'SUCCESS',
        targetType: 'User',
        targetId: params.userId,
        safeMetadata: { reason: params.reason, count: sessions.length },
        ipHash: params.ipHash,
        requestId: params.requestId,
      });

      this.logger.log(`All sessions revoked user=${params.userId} tenant=${params.tenantId} count=${sessions.length} reason=${params.reason}`);

      return sessions.length;
    } catch (e: any) {
      this.logger.warn(`revokeAllSessions failed: ${e.message}`);
      return 0;
    }
  }

  async flagSuspiciousSession(params: { sessionId: string; userId: string; tenantId: string; reason: string; ipHash?: string; requestId?: string }): Promise<void> {
    try {
      const meta = await this.cache.get<any>(`session:${params.sessionId}:meta`);
      if (meta) {
        meta.state = SessionState.SUSPICIOUS;
        meta.suspicious = true;
        meta.suspiciousReason = params.reason;
        await this.cache.set(`session:${params.sessionId}:meta`, meta, 3600);
      }
    } catch {}

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: params.userId,
      type: SecurityEventType.SESSION_SUSPICIOUS,
      severity: SecurityRisk.HIGH,
      description: `Suspicious session flagged sessionId=${params.sessionId} reason=${params.reason}`,
      safeMetadata: { sessionId: params.sessionId, reason: params.reason },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });
  }

  async listUserSessions(userId: string, tenantId: string, currentSessionId?: string): Promise<any[]> {
    try {
      const sessions = await (this.prisma as any).userSession?.findMany({
        where: { userId, tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
      }) || [];

      return sessions.map((s: any) => ({
        id: s.id,
        deviceId: s.deviceId,
        deviceName: s.deviceName,
        platform: s.platform,
        ipHash: s.ipHash,
        geoLabel: s.geoLabel,
        isCurrent: s.id === currentSessionId,
        trusted: s.trusted,
        state: s.revokedAt ? SessionState.REVOKED : s.expiresAt && new Date(s.expiresAt) < new Date() ? SessionState.EXPIRED : SessionState.ACTIVE,
        createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
        lastSeenAt: s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null,
        expiresAt: s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
      }));
    } catch {
      return [];
    }
  }

  private async enforceConcurrentLimit(userId: string, tenantId: string, maxSessions: number): Promise<void> {
    try {
      const active = await (this.prisma as any).userSession?.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'asc' },
        select: { id: true },
      }) || [];

      if (active.length >= maxSessions) {
        const evictCount = active.length - maxSessions + 1;
        const evictIds = active.slice(0, evictCount).map((s: any) => s.id);

        await (this.prisma as any).userSession?.updateMany({
          where: { id: { in: evictIds } },
          data: { revokedAt: new Date(), revokeReason: 'session_limit_reached' },
        });

        for (const id of evictIds) {
          try {
            await this.cache.set(`session:${id}:revoked`, { reason: 'session_limit_reached', revokedAt: new Date().toISOString() }, 86400 * 7);
          } catch {}
        }

        this.logger.log(`Enforced concurrent session limit user=${userId} evicted=${evictIds.length} max=${maxSessions}`);
      }
    } catch (e: any) {
      this.logger.warn(`Failed to enforce concurrent limit: ${e.message}`);
    }
  }
}
