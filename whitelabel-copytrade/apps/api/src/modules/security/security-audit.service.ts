import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { sanitizeSecurityMetadata } from './security.types';
import { randomUUID } from 'crypto';

/**
 * Immutable security audit trail with safe metadata, actor/tenant references, result, policy reference, and sanitized context.
 * Never stores passwords, raw API keys, refresh tokens, SAML assertions, OIDC tokens, private keys, provider secrets, recovery secrets.
 */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    tenantId: string;
    userId?: string;
    actorId?: string;
    actorType?: string;
    event: string;
    result?: string;
    policyVersion?: string;
    targetType?: string;
    targetId?: string;
    safeMetadata?: Record<string, any>;
    ipHash?: string;
    requestId?: string;
  }): Promise<void> {
    const safeMeta = params.safeMetadata ? sanitizeSecurityMetadata(params.safeMetadata) : {};

    try {
      await (this.prisma as any).securityAuditLog?.create({
        data: {
          id: randomUUID(),
          tenantId: params.tenantId,
          userId: params.userId || null,
          actorId: params.actorId || null,
          actorType: params.actorType || 'USER',
          event: params.event as any,
          result: params.result || 'SUCCESS',
          policyVersion: params.policyVersion || null,
          targetType: params.targetType || null,
          targetId: params.targetId || null,
          safeMetadata: safeMeta,
          ipHash: params.ipHash || null,
          requestId: params.requestId || null,
          createdAt: new Date(),
        },
      });

      this.logger.log(`Security audit recorded event=${params.event} tenant=${params.tenantId} actor=${params.actorId || 'system'} target=${params.targetType || 'none'}:${params.targetId || 'none'}`);

      // Also record to legacy auditLog for backward compatibility
      try {
        await (this.prisma as any).auditLog?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            actorType: (params.actorType as any) || 'USER',
            actorId: params.actorId || null,
            action: params.event,
            outcome: (params.result as any) || 'SUCCESS',
            resourceType: params.targetType || 'Security',
            resourceId: params.targetId || params.userId || 'unknown',
            description: `Security ${params.event}`,
            metadata: safeMeta,
            ipHash: params.ipHash || null,
            requestId: params.requestId || null,
            createdAt: new Date(),
          },
        });
      } catch {}
    } catch (e: any) {
      this.logger.warn(`Failed to record security audit ${params.event}: ${e.message}`);
    }
  }

  async recordLogin(tenantId: string, userId: string, success: boolean, ipHash?: string, requestId?: string, deviceId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      actorId: userId,
      event: success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILURE',
      result: success ? 'SUCCESS' : 'FAILURE',
      targetType: 'User',
      targetId: userId,
      safeMetadata: { userId, deviceId, success },
      ipHash,
      requestId,
    });
  }

  async recordMfa(tenantId: string, userId: string, factor: string, success: boolean, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      actorId: userId,
      event: success ? 'MFA_SUCCESS' : 'MFA_FAILURE',
      result: success ? 'SUCCESS' : 'FAILURE',
      targetType: 'User',
      targetId: userId,
      safeMetadata: { factor, success },
      ipHash,
      requestId,
    });
  }

  async recordSso(tenantId: string, userId: string | undefined, providerType: string, success: boolean, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      actorId: userId,
      event: success ? 'SSO_LOGIN_SUCCESS' : 'SSO_LOGIN_FAILURE',
      result: success ? 'SUCCESS' : 'FAILURE',
      targetType: 'SsoConfiguration',
      targetId: providerType,
      safeMetadata: { providerType, success },
      ipHash,
      requestId,
    });
  }

  async recordApiKey(tenantId: string, userId: string, keyId: string, action: 'CREATED' | 'ROTATED' | 'REVOKED', actorId: string, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      actorId,
      event: `API_KEY_${action}`,
      result: 'SUCCESS',
      targetType: 'ApiKey',
      targetId: keyId,
      safeMetadata: { keyId, action },
      ipHash,
      requestId,
    });
  }

  async recordSession(tenantId: string, userId: string, sessionId: string, action: 'CREATED' | 'REVOKED' | 'SUSPICIOUS', actorId?: string, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      actorId: actorId || userId,
      event: `SESSION_${action}`,
      result: action === 'SUSPICIOUS' ? 'FAILURE' : 'SUCCESS',
      targetType: 'Session',
      targetId: sessionId,
      safeMetadata: { sessionId, action },
      ipHash,
      requestId,
    });
  }

  async recordDevice(tenantId: string, userId: string, deviceId: string, action: 'REGISTERED' | 'TRUSTED' | 'REVOKED', actorId: string, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      actorId,
      event: `DEVICE_${action}`,
      result: 'SUCCESS',
      targetType: 'Device',
      targetId: deviceId,
      safeMetadata: { deviceId, action },
      ipHash,
      requestId,
    });
  }

  async recordPolicyChange(tenantId: string, policyVersion: string, actorId: string, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      actorId,
      event: 'SECURITY_POLICY_CHANGED',
      result: 'SUCCESS',
      targetType: 'SecurityPolicy',
      targetId: policyVersion,
      policyVersion,
      safeMetadata: { policyVersion },
      ipHash,
      requestId,
    });
  }

  async listAuditLogs(tenantId: string, filters?: { userId?: string; event?: string; fromDate?: Date; toDate?: Date; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    try {
      const where: any = { tenantId };
      if (filters?.userId) where.userId = filters.userId;
      if (filters?.event) where.event = filters.event;
      if (filters?.fromDate || filters?.toDate) {
        where.createdAt = {};
        if (filters.fromDate) where.createdAt.gte = filters.fromDate;
        if (filters.toDate) where.createdAt.lte = filters.toDate;
      }

      const [data, total] = await Promise.all([
        (this.prisma as any).securityAuditLog?.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }) || [],
        (this.prisma as any).securityAuditLog?.count({ where }) || 0,
      ]);

      return { data, total };
    } catch {
      return { data: [], total: 0 };
    }
  }
}
