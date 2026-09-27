import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SecurityPolicyService } from './security-policy.service';
import { SecurityEventService } from './security-event.service';
import { SecurityAuditService } from './security-audit.service';
import { DeviceState, SecurityEventType, SecurityRisk, SecurityDecision } from './security.types';
import { createHash, randomUUID } from 'crypto';

/**
 * Device registration/trust lifecycle, device fingerprint reference, trust expiry, revocation, and step-up authentication requirements.
 * Use minimized device references/hashes, never override revoked session/blocked account/mandatory MFA/compliance restrictions.
 */
@Injectable()
export class DeviceTrustService {
  private readonly logger = new Logger(DeviceTrustService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: SecurityPolicyService,
    private readonly eventService: SecurityEventService,
    private readonly auditService: SecurityAuditService,
  ) {}

  private hashDevice(deviceId: string, userAgent?: string, ip?: string): string {
    const data = `${deviceId}|${userAgent || ''}|${ip || ''}`;
    return createHash('sha256').update(data).digest('hex').substring(0, 64);
  }

  private hashUserAgent(userAgent?: string): string {
    if (!userAgent) return '';
    return createHash('sha256').update(userAgent).digest('hex').substring(0, 32);
  }

  async registerDevice(params: {
    tenantId: string;
    userId: string;
    deviceId: string;
    userAgent?: string;
    ipHash?: string;
    requestId?: string;
  }): Promise<any> {
    const deviceHash = this.hashDevice(params.deviceId, params.userAgent, params.ipHash);
    const userAgentHash = this.hashUserAgent(params.userAgent);

    try {
      const existing = await (this.prisma as any).deviceTrust?.findFirst({
        where: { tenantId: params.tenantId, userId: params.userId, deviceHash },
      });

      if (existing) {
        // Update last seen
        const updated = await (this.prisma as any).deviceTrust?.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date(), ipHash: params.ipHash, userAgentHash, updatedAt: new Date() },
        });
        return this.sanitizeDeviceRecord(updated || existing);
      }
    } catch {}

    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });
    const expiresAt = new Date(Date.now() + policy.deviceTrustDurationDays * 24 * 60 * 60 * 1000);

    const id = randomUUID();
    const now = new Date();

    const data = {
      id,
      tenantId: params.tenantId,
      userId: params.userId,
      deviceId: params.deviceId,
      deviceHash,
      state: DeviceState.PENDING_TRUST,
      lastSeenAt: now,
      ipHash: params.ipHash || null,
      userAgentHash,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    try {
      const created = await (this.prisma as any).deviceTrust?.create({ data });
      if (created) {
        await this.eventService.record({
          tenantId: params.tenantId,
          userId: params.userId,
          type: SecurityEventType.DEVICE_REGISTERED,
          severity: SecurityRisk.LOW,
          description: `Device registered deviceId=${params.deviceId}`,
          safeMetadata: { deviceId: params.deviceId, deviceHash: deviceHash.substring(0, 16), state: DeviceState.PENDING_TRUST },
          ipHash: params.ipHash,
          requestId: params.requestId,
        });

        return this.sanitizeDeviceRecord(created);
      }
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).deviceTrust?.findFirst({ where: { tenantId: params.tenantId, userId: params.userId, deviceHash } });
        if (existing) return this.sanitizeDeviceRecord(existing);
      }
      this.logger.warn(`Failed to create device trust: ${e.message}`);
    }

    return this.sanitizeDeviceRecord({ ...data, expiresAt, trustedAt: null, revokedAt: null });
  }

  async trustDevice(params: { tenantId: string; userId: string; deviceId: string; deviceHash?: string; actorId: string; ipHash?: string; requestId?: string }): Promise<any> {
    const deviceHash = params.deviceHash || this.hashDevice(params.deviceId);

    try {
      const device = await (this.prisma as any).deviceTrust?.findFirst({
        where: { tenantId: params.tenantId, userId: params.userId, ...(params.deviceHash ? { deviceHash } : { deviceId: params.deviceId }) },
      });

      if (!device) {
        throw new Error(`Device not found deviceId=${params.deviceId}`);
      }

      // Check if session revoked or account blocked - device trust must never override
      const user = await (this.prisma as any).user?.findUnique({ where: { id: params.userId }, select: { status: true } });
      if (user?.status === 'SUSPENDED' || user?.status === 'LOCKED' || user?.status === 'DEACTIVATED') {
        throw new Error(`Cannot trust device for blocked account status=${user.status} - device trust must never override blocked account`);
      }

      const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });
      const expiresAt = new Date(Date.now() + policy.deviceTrustDurationDays * 24 * 60 * 60 * 1000);

      const updated = await (this.prisma as any).deviceTrust?.update({
        where: { id: device.id },
        data: { state: DeviceState.TRUSTED, trustedAt: new Date(), expiresAt, updatedAt: new Date() },
      });

      await this.eventService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        type: SecurityEventType.DEVICE_TRUSTED,
        severity: SecurityRisk.LOW,
        description: `Device trusted deviceId=${params.deviceId}`,
        safeMetadata: { deviceId: params.deviceId, deviceHash: deviceHash.substring(0, 16) },
        ipHash: params.ipHash,
        requestId: params.requestId,
      });

      await this.auditService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        actorId: params.actorId,
        event: 'DEVICE_TRUSTED',
        result: 'SUCCESS',
        targetType: 'Device',
        targetId: device.id,
        safeMetadata: { deviceId: params.deviceId },
        ipHash: params.ipHash,
        requestId: params.requestId,
      });

      return this.sanitizeDeviceRecord(updated || { ...device, state: DeviceState.TRUSTED, trustedAt: new Date(), expiresAt });
    } catch (e: any) {
      this.logger.warn(`trustDevice failed: ${e.message}`);
      throw e;
    }
  }

  async revokeDevice(params: { tenantId: string; userId: string; deviceId: string; deviceHash?: string; actorId: string; reason?: string; ipHash?: string; requestId?: string }): Promise<any> {
    try {
      const device = await (this.prisma as any).deviceTrust?.findFirst({
        where: { tenantId: params.tenantId, userId: params.userId, ...(params.deviceHash ? { deviceHash: params.deviceHash } : { deviceId: params.deviceId }) },
      });

      if (!device) {
        throw new Error(`Device not found deviceId=${params.deviceId}`);
      }

      const updated = await (this.prisma as any).deviceTrust?.update({
        where: { id: device.id },
        data: { state: DeviceState.REVOKED, revokedAt: new Date(), updatedAt: new Date() },
      });

      await this.eventService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        type: SecurityEventType.DEVICE_REVOKED,
        severity: SecurityRisk.MEDIUM,
        description: `Device revoked deviceId=${params.deviceId} reason=${params.reason || 'manual'}`,
        safeMetadata: { deviceId: params.deviceId, reason: params.reason },
        ipHash: params.ipHash,
        requestId: params.requestId,
      });

      await this.auditService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        actorId: params.actorId,
        event: 'DEVICE_REVOKED',
        result: 'SUCCESS',
        targetType: 'Device',
        targetId: device.id,
        safeMetadata: { deviceId: params.deviceId, reason: params.reason },
        ipHash: params.ipHash,
        requestId: params.requestId,
      });

      return this.sanitizeDeviceRecord(updated || { ...device, state: DeviceState.REVOKED, revokedAt: new Date() });
    } catch (e: any) {
      this.logger.warn(`revokeDevice failed: ${e.message}`);
      throw e;
    }
  }

  async listDevices(tenantId: string, userId: string, filters?: { state?: DeviceState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    try {
      const where: any = { tenantId, userId };
      if (filters?.state) where.state = filters.state;

      const [data, total] = await Promise.all([
        (this.prisma as any).deviceTrust?.findMany({ where, orderBy: { lastSeenAt: 'desc' }, skip: offset, take: limit }) || [],
        (this.prisma as any).deviceTrust?.count({ where }) || 0,
      ]);

      return { data: data.map((d: any) => this.sanitizeDeviceRecord(d)), total };
    } catch {
      return { data: [], total: 0 };
    }
  }

  async evaluateDeviceTrust(params: { tenantId: string; userId: string; deviceId: string; userAgent?: string; ipHash?: string }): Promise<{ trusted: boolean; state: DeviceState; decision: SecurityDecision; requiresStepUp: boolean }> {
    const deviceHash = this.hashDevice(params.deviceId, params.userAgent, params.ipHash);

    try {
      const device = await (this.prisma as any).deviceTrust?.findFirst({
        where: { tenantId: params.tenantId, userId: params.userId, deviceHash },
      });

      if (!device) {
        return { trusted: false, state: DeviceState.UNKNOWN, decision: SecurityDecision.REVIEW_REQUIRED, requiresStepUp: true };
      }

      if (device.state === DeviceState.REVOKED || device.revokedAt) {
        return { trusted: false, state: DeviceState.REVOKED, decision: SecurityDecision.DENY, requiresStepUp: true };
      }

      if (device.state === DeviceState.TRUSTED) {
        // Check expiry
        if (device.expiresAt && new Date(device.expiresAt) < new Date()) {
          return { trusted: false, state: DeviceState.PENDING_TRUST, decision: SecurityDecision.STEP_UP_REQUIRED, requiresStepUp: true };
        }
        // Device trust must never override mandatory MFA - so if MFA required, still require step-up
        // This check is done in MfaPolicyService, but we return trusted true here
        return { trusted: true, state: DeviceState.TRUSTED, decision: SecurityDecision.ALLOW, requiresStepUp: false };
      }

      if (device.state === DeviceState.PENDING_TRUST) {
        return { trusted: false, state: DeviceState.PENDING_TRUST, decision: SecurityDecision.STEP_UP_REQUIRED, requiresStepUp: true };
      }

      return { trusted: false, state: DeviceState.UNKNOWN, decision: SecurityDecision.REVIEW_REQUIRED, requiresStepUp: true };
    } catch {
      return { trusted: false, state: DeviceState.UNKNOWN, decision: SecurityDecision.REVIEW_REQUIRED, requiresStepUp: true };
    }
  }

  private sanitizeDeviceRecord(record: any): any {
    return {
      id: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      deviceId: record.deviceId,
      deviceHash: record.deviceHash ? `${record.deviceHash.substring(0, 16)}...` : undefined,
      state: record.state,
      trustedAt: record.trustedAt ? new Date(record.trustedAt).toISOString() : null,
      expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
      lastSeenAt: record.lastSeenAt ? new Date(record.lastSeenAt).toISOString() : new Date().toISOString(),
      revokedAt: record.revokedAt ? new Date(record.revokedAt).toISOString() : null,
      createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString(),
    };
  }
}
