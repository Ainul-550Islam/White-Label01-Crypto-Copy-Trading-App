import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { SecurityEventType, SecurityRisk, sanitizeSecurityMetadata } from './security.types';
import { randomUUID } from 'crypto';

const TENANT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireSecurityRisk(value: SecurityRisk | string): SecurityRisk {
  if ((Object.values(SecurityRisk) as string[]).includes(value)) {
    return value as SecurityRisk;
  }
  throw new Error('Security event severity is invalid; refusing to persist the event');
}

/**
 * Canonical security event recording for login, logout, MFA, SSO, API key, session, device, policy, and privileged administrative events.
 * Preserves existing SecurityEventsService logic, adds enterprise event types.
 */
@Injectable()
export class SecurityEventService {
  private readonly logger = new Logger(SecurityEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  async record(input: {
    tenantId: string | null;
    userId?: string | null;
    type: SecurityEventType | string;
    severity: SecurityRisk | string;
    description: string;
    safeMetadata?: Record<string, any> | null;
    metadata?: Record<string, any> | null;
    ipHash?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  }): Promise<void> {
    const rawMeta = (input as any).safeMetadata || (input as any).metadata || {};
    const safeMeta = rawMeta ? sanitizeSecurityMetadata(rawMeta) : {};

    const tenantScoped = input.tenantId !== null;
    if (tenantScoped && !TENANT_UUID_PATTERN.test(input.tenantId as string)) {
      throw new Error('Security event tenantId must be a UUID or null; refusing to persist the event');
    }
    const severity = requireSecurityRisk(input.severity);
    const eventData = {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId || null,
      type: input.type as any,
      severity,
      description: input.description.substring(0, 500),
      metadata: safeMeta,
      ipHash: input.ipHash || null,
      userAgent: input.userAgent ? input.userAgent.substring(0, 512) : null,
      requestId: input.requestId || null,
      createdAt: new Date(),
    };

    try {
      if (tenantScoped) {
        if (!this.outbox) {
          throw new Error('Transactional outbox is unavailable; refusing tenant security event without its security.event event');
        }
        const publicSeverity = severity === SecurityRisk.CRITICAL
          ? 'CRITICAL'
          : severity === SecurityRisk.HIGH || severity === SecurityRisk.MEDIUM
            ? 'WARNING'
            : 'INFO';
        await this.prisma.withTenantRls(input.tenantId!, async (tx) => {
          await (tx as any).securityEvent.create({ data: eventData });
          await this.outbox!.append(tx, {
            tenantId: input.tenantId!,
            aggregateType: 'security_event',
            aggregateId: eventData.id,
            eventType: 'security.event',
            idempotencyKey: `security-event:${eventData.id}:recorded`,
            correlationId: input.requestId && input.requestId.length <= 64 ? input.requestId : null,
            occurredAt: eventData.createdAt,
            payload: {
              securityEventId: eventData.id,
              category: String(input.type).slice(0, 96),
              severity: publicSeverity,
            },
          });
        });
      } else {
        // Platform-level events have no tenant webhook audience, but remain persisted locally.
        try {
          await (this.prisma as any).securityEvent?.create({ data: eventData });
        } catch (error) {
          this.logger.warn(`Failed to persist platform security event: ${(error as Error).message}`);
        }
      }

      // The enterprise audit mirror remains best-effort; the tenant SecurityEvent row and outbox
      // record above are the atomic developer-webhook source of truth.
      try {
        await (this.prisma as any).securityAuditLog?.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId || 'platform',
            userId: input.userId || null,
            actorId: input.userId || null,
            actorType: 'USER',
            event: this.mapToEnterpriseCategory(input.type as any),
            result: severity === SecurityRisk.CRITICAL || input.type.includes('FAILURE') ? 'FAILURE' : 'SUCCESS',
            safeMetadata: safeMeta,
            ipHash: input.ipHash || null,
            requestId: input.requestId || null,
            createdAt: new Date(),
          },
        });
      } catch {}

      const logPayload = {
        event: 'security.event',
        type: input.type,
        severity,
        tenantId: input.tenantId,
        userId: input.userId,
        requestId: input.requestId,
      };
      if (severity === SecurityRisk.CRITICAL) {
        this.logger.error(logPayload, input.description);
      } else if (severity === SecurityRisk.HIGH) {
        this.logger.warn(logPayload, input.description);
      } else {
        this.logger.log(`${input.type} tenant=${input.tenantId} user=${input.userId} ${input.description}`);
      }
    } catch (error) {
      this.logger.error(`Failed to record security event ${input.type}: ${(error as Error).message}`);
      if (tenantScoped) throw error;
    }
  }

  async recordLoginSuccess(tenantId: string, userId: string, ipHash?: string, requestId?: string, deviceId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type: SecurityEventType.LOGIN_SUCCESS,
      severity: SecurityRisk.LOW,
      description: `Login success user=${userId} device=${deviceId || 'unknown'}`,
      safeMetadata: { userId, deviceId },
      ipHash,
      requestId,
    });
  }

  async recordLoginFailure(tenantId: string, email: string, ipHash?: string, requestId?: string, reason?: string): Promise<void> {
    await this.record({
      tenantId,
      type: SecurityEventType.LOGIN_FAILURE,
      severity: SecurityRisk.MEDIUM,
      description: `Login failure emailHash=${this.hashEmail(email)} reason=${reason || 'unknown'}`,
      safeMetadata: { emailDomain: email.split('@')[1], reason },
      ipHash,
      requestId,
    });
  }

  async recordLogout(tenantId: string, userId: string, sessionId?: string, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type: SecurityEventType.LOGOUT,
      severity: SecurityRisk.LOW,
      description: `Logout user=${userId} session=${sessionId || 'unknown'}`,
      safeMetadata: { userId, sessionId },
      ipHash,
      requestId,
    });
  }

  async recordMfaSuccess(tenantId: string, userId: string, factor: string, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type: SecurityEventType.MFA_SUCCESS,
      severity: SecurityRisk.LOW,
      description: `MFA success user=${userId} factor=${factor}`,
      safeMetadata: { userId, factor },
      ipHash,
      requestId,
    });
  }

  async recordMfaFailure(tenantId: string, userId: string, factor: string, ipHash?: string, requestId?: string, reason?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      type: SecurityEventType.MFA_FAILURE,
      severity: SecurityRisk.MEDIUM,
      description: `MFA failure user=${userId} factor=${factor} reason=${reason || 'unknown'}`,
      safeMetadata: { userId, factor, reason },
      ipHash,
      requestId,
    });
  }

  async listEvents(tenantId: string, filters?: { userId?: string; type?: string; severity?: string; fromDate?: Date; toDate?: Date; page?: number; limit?: number }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    const where: any = { tenantId };
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.type) where.type = filters.type;
    if (filters?.severity) where.severity = filters.severity;
    if (filters?.fromDate || filters?.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt.gte = filters.fromDate;
      if (filters.toDate) where.createdAt.lte = filters.toDate;
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).securityEvent?.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }) || [],
      (this.prisma as any).securityEvent?.count({ where }) || 0,
    ]);

    return { data, total, page, limit };
  }

  // Backward compatibility aliases for old SecurityEventsService
  async list(filter: any): Promise<any> {
    const tenantId = filter?.tenantId || 'platform';
    const result = await this.listEvents(tenantId, {
      userId: filter?.userId,
      type: filter?.type,
      severity: filter?.severity,
      page: filter?.page,
      limit: filter?.limit,
    });
    return { items: result.data, pagination: { page: result.page, limit: result.limit, totalItems: result.total } };
  }

  async resolve(tenantId: string, eventId: string, resolvedById: string, resolution: string): Promise<void> {
    try {
      await (this.prisma as any).securityEvent?.updateMany({
        where: { id: eventId, tenantId },
        data: { resolved: true, resolvedAt: new Date(), resolvedById, resolution: resolution.substring(0, 500) },
      });
    } catch {}
  }

  private mapToEnterpriseCategory(type: string): any {
    const mapping: Record<string, string> = {
      [SecurityEventType.LOGIN_SUCCESS]: 'LOGIN_SUCCESS',
      [SecurityEventType.LOGIN_FAILURE]: 'LOGIN_FAILURE',
      [SecurityEventType.LOGOUT]: 'LOGOUT',
      [SecurityEventType.MFA_REQUIRED]: 'MFA_REQUIRED',
      [SecurityEventType.MFA_SUCCESS]: 'MFA_SUCCESS',
      [SecurityEventType.MFA_FAILURE]: 'MFA_FAILURE',
      [SecurityEventType.SSO_LOGIN_STARTED]: 'SSO_LOGIN_STARTED',
      [SecurityEventType.SSO_LOGIN_SUCCESS]: 'SSO_LOGIN_SUCCESS',
      [SecurityEventType.SSO_LOGIN_FAILURE]: 'SSO_LOGIN_FAILURE',
      [SecurityEventType.API_KEY_CREATED]: 'API_KEY_CREATED',
      [SecurityEventType.API_KEY_ROTATED]: 'API_KEY_ROTATED',
      [SecurityEventType.API_KEY_REVOKED]: 'API_KEY_REVOKED',
      [SecurityEventType.SESSION_CREATED]: 'SESSION_CREATED',
      [SecurityEventType.SESSION_REVOKED]: 'SESSION_REVOKED',
      [SecurityEventType.SESSION_SUSPICIOUS]: 'SESSION_SUSPICIOUS',
      [SecurityEventType.DEVICE_REGISTERED]: 'DEVICE_REGISTERED',
      [SecurityEventType.DEVICE_TRUSTED]: 'DEVICE_TRUSTED',
      [SecurityEventType.DEVICE_REVOKED]: 'DEVICE_REVOKED',
      [SecurityEventType.SECURITY_POLICY_CHANGED]: 'SECURITY_POLICY_CHANGED',
      [SecurityEventType.PRIVILEGED_ACTION]: 'PRIVILEGED_ACTION',
      [SecurityEventType.SECURITY_ALERT]: 'SECURITY_ALERT',
    };
    return mapping[type] || 'SECURITY_ALERT';
  }

  private hashEmail(email: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 8);
  }
}
