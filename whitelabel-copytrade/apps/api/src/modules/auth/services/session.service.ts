import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { addSeconds, sanitiseForLog } from '@wlct/utils';
import { ErrorCode, type UserSessionDto } from '@wlct/shared-types';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppException, NotFoundException } from '../../../common/errors/app.exception';

export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  /** Credential generation captured when this login was authenticated. */
  expectedSessionVersion: number;
  deviceId: string;
  deviceName?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  userAgent?: string | null;
  ipHash: string;
  geoLabel?: string | null;
  trusted?: boolean;
  /** PASSWORD (default), SSO_OIDC or SSO_SAML; rewritten on every login. */
  authMethod?: SessionAuthMethod;
  /** Issuing SSO configuration (SSO_* only). */
  ssoConfigurationId?: string | null;
  /** SAML sessions: sealed NameID / SessionIndex and lookup hashes (Single Logout). */
  samlLogout?: SessionSamlLogout | null;
}

export type SessionAuthMethod = 'PASSWORD' | 'SSO_OIDC' | 'SSO_SAML';

/** The SAML Single Logout data a session row keeps (see SsoTransactionService.sealSamlLogout). */
export interface SessionSamlLogout {
  context: unknown;
  subjectHash: string;
  sessionIndexHash: string | null;
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
    return this.prisma.withTenantRls(input.tenantId, async (tx) => {
      // The same user-row lock is taken by password recovery. It also
      // serializes the per-user session cap across concurrent logins.
      const users = await tx.$queryRaw<Array<{ id: string; sessionVersion: number; status: string }>>`
        SELECT id, session_version AS "sessionVersion", status::text AS status FROM "users" WHERE id = ${input.userId}::uuid
          AND tenant_id = ${input.tenantId}::uuid AND deleted_at IS NULL FOR UPDATE
      `;
      if (users.length !== 1) throw new NotFoundException('User', input.userId);
      // Reject stale authentication before touching a session. In particular,
      // an old login must not overwrite metadata on a post-reset device session.
      if (!Number.isSafeInteger(input.expectedSessionVersion) || users[0]!.sessionVersion !== input.expectedSessionVersion) {
        throw new AppException({ code: ErrorCode.TOKEN_REVOKED, message: 'Your credentials changed. Please sign in again.' });
      }
      if (users[0]!.status === 'SUSPENDED' || users[0]!.status === 'DEACTIVATED') {
        throw new AppException({ code: ErrorCode.ACCOUNT_DISABLED });
      }
      if (users[0]!.status === 'LOCKED') throw new AppException({ code: ErrorCode.ACCOUNT_LOCKED });
      const existing = await tx.userSession.findFirst({
        where: { tenantId: input.tenantId, userId: input.userId, deviceId: input.deviceId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      const expiresAt = addSeconds(new Date(), this.config.refreshTokenTtlSeconds);
      if (existing) {
        await tx.userSession.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: new Date(), expiresAt, ipHash: input.ipHash,
            userAgent: input.userAgent ? sanitiseForLog(input.userAgent, 512) : null,
            geoLabel: input.geoLabel ?? null,
            authMethod: input.authMethod ?? 'PASSWORD', ssoConfigurationId: input.ssoConfigurationId ?? null,
            ...this.samlLogoutColumns(input.samlLogout),
            ...(input.deviceName ? { deviceName: input.deviceName } : {}),
            ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          },
        });
        return { id: existing.id, isNewDevice: false };
      }
      await this.enforceSessionCap(tx, input.tenantId, input.userId);
      const session = await tx.userSession.create({
        data: {
          userId: input.userId, tenantId: input.tenantId, deviceId: input.deviceId,
          deviceName: input.deviceName ?? null, platform: input.platform ?? null,
          appVersion: input.appVersion ?? null,
          userAgent: input.userAgent ? sanitiseForLog(input.userAgent, 512) : null,
          ipHash: input.ipHash, geoLabel: input.geoLabel ?? null, trusted: input.trusted ?? false,
          authMethod: input.authMethod ?? 'PASSWORD', ssoConfigurationId: input.ssoConfigurationId ?? null,
          ...this.samlLogoutColumns(input.samlLogout), expiresAt,
        },
        select: { id: true },
      });
      return { id: session.id, isNewDevice: true };
    });
  }

  async touch(sessionId: string, ipHash: string, tenantId: string): Promise<void> {
    await this.prisma.withTenantRls(tenantId, (tx) => tx.userSession.updateMany({
      where: { id: sessionId, tenantId, revokedAt: null },
      data: { lastSeenAt: new Date(), ipHash },
    })).catch(() => {
      // A revoked or deleted session is not touched.
    });
  }

  async listForUser(tenantId: string, userId: string, currentSessionId: string): Promise<UserSessionDto[]> {
    const sessions = await this.prisma.withTenantRls(tenantId, (tx) => tx.userSession.findMany({
      where: { tenantId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    }));

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

  async revoke(tenantId: string, userId: string, sessionId: string, reason: string, actorSessionId?: string): Promise<void> {
    await this.prisma.withTenantRls(tenantId, async (tx) => {
      await this.lockUser(tx, tenantId, userId);
      if (actorSessionId) await this.assertActiveSession(tx, tenantId, userId, actorSessionId);
      const session = await tx.userSession.findFirst({ where: { id: sessionId, tenantId, userId }, select: { id: true } });
      if (!session) throw new NotFoundException('Session', sessionId);
      const now = new Date();
      await tx.userSession.updateMany({ where: { id: sessionId, tenantId, userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason.slice(0, 120) } });
      await tx.refreshToken.updateMany({ where: { tenantId, userId, sessionId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now, revokeReason: reason.slice(0, 120) } });
    });
  }

  async revokeAll(tenantId: string, userId: string, exceptSessionId: string | null, reason: string): Promise<number> {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      await this.lockUser(tx, tenantId, userId);
      if (exceptSessionId) await this.assertActiveSession(tx, tenantId, userId, exceptSessionId);
      const now = new Date();
      const sessions = await tx.userSession.updateMany({
        where: { tenantId, userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
        data: { revokedAt: now, revokeReason: reason.slice(0, 120) },
      });
      // Revoke active tokens even if their session was already revoked; this
      // repairs inconsistent legacy rows without touching the excepted device.
      await tx.refreshToken.updateMany({
        where: { tenantId, userId, status: 'ACTIVE', ...(exceptSessionId ? { sessionId: { not: exceptSessionId } } : {}) },
        data: { status: 'REVOKED', revokedAt: now, revokeReason: reason.slice(0, 120) },
      });
      return sessions.count;
    });
  }

  /**
   * IdP-initiated SAML logout: revokes the live sessions of one IdP subject
   * that were issued by `configurationId` - only those with one of the given
   * SessionIndex hashes, or all of the subject's sessions when the request
   * named no SessionIndex. Sessions and their refresh tokens are revoked in
   * one transaction. Returns how many sessions were revoked.
   */
  async revokeSamlSubjectSessions(input: {
    tenantId: string;
    configurationId: string;
    subjectHash: string;
    sessionIndexHashes: string[];
    reason: string;
  }): Promise<number> {
    return this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const sessions = await tx.userSession.findMany({
        where: {
          tenantId: input.tenantId,
          ssoConfigurationId: input.configurationId,
          authMethod: 'SSO_SAML',
          ssoSubjectHash: input.subjectHash,
          revokedAt: null,
          ...(input.sessionIndexHashes.length > 0 ? { ssoSessionIndexHash: { in: input.sessionIndexHashes } } : {}),
        },
        select: { id: true, userId: true },
      });
      if (sessions.length === 0) return 0;
      // Lock users in a deterministic order so refresh/issuance cannot race a
      // revocation and simultaneous multi-user IdP logouts cannot deadlock.
      const userIds = [...new Set(sessions.map((session) => session.userId))].sort();
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "users" WHERE tenant_id = ${input.tenantId}::uuid
          AND id IN (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY id FOR UPDATE
      `;
      if (locked.length !== userIds.length) throw new Error('SAML_SESSION_OWNER_UNAVAILABLE');
      // A password login may have reused an SSO device while this request was
      // waiting for a user lock. Recheck its origin before revoking it.
      const matching = await tx.userSession.findMany({ where: {
        tenantId: input.tenantId, id: { in: sessions.map((session) => session.id) },
        ssoConfigurationId: input.configurationId, authMethod: 'SSO_SAML', ssoSubjectHash: input.subjectHash, revokedAt: null,
        ...(input.sessionIndexHashes.length > 0 ? { ssoSessionIndexHash: { in: input.sessionIndexHashes } } : {}),
      }, select: { id: true } });
      if (matching.length === 0) return 0;
      const ids = matching.map((session) => session.id), now = new Date();
      const revoked = await tx.userSession.updateMany({
        where: { tenantId: input.tenantId, id: { in: ids }, revokedAt: null },
        data: { revokedAt: now, revokeReason: input.reason.slice(0, 120) },
      });
      await tx.refreshToken.updateMany({
        where: { tenantId: input.tenantId, sessionId: { in: ids }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now, revokeReason: input.reason.slice(0, 120) },
      });
      return revoked.count;
    });
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

  private async lockUser(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
    // Refresh, issuance and credential changes use the same lock: a session
    // cannot acquire a new refresh token after its revocation has committed.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "users" WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL FOR UPDATE
    `;
    if (rows.length !== 1) throw new NotFoundException('User', userId);
  }

  private async assertActiveSession(tx: Prisma.TransactionClient, tenantId: string, userId: string, sessionId: string): Promise<void> {
    // The request may have passed its JWT guard just before recovery revoked
    // the actor. Do not let that stale request revoke a newly created session.
    const session = await tx.userSession.findFirst({ where: {
      id: sessionId, tenantId, userId, revokedAt: null, expiresAt: { gt: new Date() },
    }, select: { id: true } });
    if (!session) throw new AppException({ code: ErrorCode.TOKEN_REVOKED });
  }

  /** Session columns for a login: the SAML logout data, or all three cleared. */
  private samlLogoutColumns(samlLogout: SessionSamlLogout | null | undefined): {
    ssoLogoutContext: Prisma.InputJsonValue | typeof Prisma.DbNull;
    ssoSubjectHash: string | null;
    ssoSessionIndexHash: string | null;
  } {
    if (!samlLogout) {
      return { ssoLogoutContext: Prisma.DbNull, ssoSubjectHash: null, ssoSessionIndexHash: null };
    }
    return {
      ssoLogoutContext: samlLogout.context as Prisma.InputJsonValue,
      ssoSubjectHash: samlLogout.subjectHash,
      ssoSessionIndexHash: samlLogout.sessionIndexHash,
    };
  }

  private async enforceSessionCap(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
    const max = this.config.maxActiveSessionsPerUser;
    const active = await tx.userSession.findMany({
      where: { tenantId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'asc' }, select: { id: true },
    });
    if (active.length < max) return;
    const evictIds = active.slice(0, active.length - max + 1).map((session) => session.id);
    await tx.userSession.updateMany({
      where: { tenantId, userId, id: { in: evictIds } },
      data: { revokedAt: new Date(), revokeReason: 'session_limit_reached' },
    });
    await tx.refreshToken.updateMany({
      where: { tenantId, userId, sessionId: { in: evictIds }, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'session_limit_reached' },
    });
    this.logger.info(
      { event: 'auth.session_evicted', userId, evicted: evictIds.length, max },
      'Evicted least recently used sessions to respect the per-user cap',
    );
  }
}
