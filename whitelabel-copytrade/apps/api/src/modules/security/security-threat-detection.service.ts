import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SecurityPolicyService } from './security-policy.service';
import { SecurityEventService } from './security-event.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { SecurityRisk, SecurityDecision, SecurityEventType } from './security.types';
import { randomUUID } from 'crypto';

/**
 * Detects suspicious login/session/API-key/device patterns from existing security events without becoming a second auth engine.
 * Preserves existing SuspiciousLoginDetector logic, extends with enterprise threat signals.
 */
@Injectable()
export class SecurityThreatDetectionService {
  private readonly logger = new Logger(SecurityThreatDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: SecurityPolicyService,
    private readonly eventService: SecurityEventService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async detectThreats(params: { tenantId: string; userId?: string; fromDate?: Date; toDate?: Date }): Promise<{
    signals: { ruleId: string; riskLevel: SecurityRisk; decision: SecurityDecision; summary: string; recommendedAction: string; sourceEventIds: string[]; policyVersion: string }[];
    total: number;
  }> {
    const from = params.fromDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = params.toDate || new Date();
    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });

    const signals: any[] = [];

    // Fetch security events for analysis
    let events: any[] = [];
    try {
      events = await (this.prisma as any).securityEvent?.findMany({
        where: { tenantId: params.tenantId, ...(params.userId ? { userId: params.userId } : {}), createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }) || [];
    } catch {
      events = [];
    }

    // Rule: repeated failed login
    const failedLogins = events.filter((e: any) => e.type === 'LOGIN_FAILURE' || e.type === SecurityEventType.LOGIN_FAILURE);
    if (failedLogins.length >= 5) {
      signals.push({
        ruleId: 'REPEATED_FAILED_LOGIN',
        riskLevel: failedLogins.length >= 10 ? SecurityRisk.HIGH : SecurityRisk.MEDIUM,
        decision: failedLogins.length >= 10 ? SecurityDecision.DENY : SecurityDecision.REVIEW_REQUIRED,
        summary: `${failedLogins.length} failed login attempts in last 24h`,
        recommendedAction: failedLogins.length >= 10 ? 'BLOCK_IP_AND_REQUIRE_MFA' : 'REQUIRE_MFA_AND_NOTIFY',
        sourceEventIds: failedLogins.slice(0, 10).map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Rule: repeated MFA failure
    const mfaFailures = events.filter((e: any) => e.type === SecurityEventType.MFA_FAILURE);
    if (mfaFailures.length >= 3) {
      signals.push({
        ruleId: 'REPEATED_MFA_FAILURE',
        riskLevel: mfaFailures.length >= 5 ? SecurityRisk.HIGH : SecurityRisk.MEDIUM,
        decision: SecurityDecision.SUSPICIOUS,
        summary: `${mfaFailures.length} MFA failures in last 24h`,
        recommendedAction: 'REQUIRE_RECOVERY_AND_NOTIFY',
        sourceEventIds: mfaFailures.slice(0, 10).map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Rule: API-key abuse - unusual spike
    const apiKeyCreations = events.filter((e: any) => e.type === SecurityEventType.API_KEY_CREATED);
    if (apiKeyCreations.length >= 5) {
      signals.push({
        ruleId: 'API_KEY_ABUSE',
        riskLevel: SecurityRisk.MEDIUM,
        decision: SecurityDecision.REVIEW_REQUIRED,
        summary: `${apiKeyCreations.length} API keys created in last 24h`,
        recommendedAction: 'REVIEW_API_KEY_SCOPES',
        sourceEventIds: apiKeyCreations.slice(0, 10).map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Rule: revoked key reuse attempt
    const revokedReuse = events.filter((e: any) => e.type === 'API_KEY_REVOKED_REUSE' || (e.description && e.description.includes('REVOKED')));
    if (revokedReuse.length > 0) {
      signals.push({
        ruleId: 'REVOKED_KEY_REUSE',
        riskLevel: SecurityRisk.HIGH,
        decision: SecurityDecision.DENY,
        summary: `Attempt to use revoked API key detected`,
        recommendedAction: 'BLOCK_AND_ALERT',
        sourceEventIds: revokedReuse.slice(0, 5).map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Rule: expired key use
    const expiredUse = events.filter((e: any) => e.type === 'API_KEY_EXPIRED_USE');
    if (expiredUse.length > 0) {
      signals.push({
        ruleId: 'EXPIRED_KEY_USE',
        riskLevel: SecurityRisk.MEDIUM,
        decision: SecurityDecision.DENY,
        summary: `Attempt to use expired API key`,
        recommendedAction: 'ROTATE_KEY_AND_NOTIFY',
        sourceEventIds: expiredUse.slice(0, 5).map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Rule: impossible session state - session created and revoked quickly
    const sessionCreated = events.filter((e: any) => e.type === SecurityEventType.SESSION_CREATED);
    const sessionRevoked = events.filter((e: any) => e.type === SecurityEventType.SESSION_REVOKED);
    if (sessionCreated.length >= 10 && sessionRevoked.length >= 10) {
      signals.push({
        ruleId: 'IMPOSSIBLE_SESSION_STATE',
        riskLevel: SecurityRisk.MEDIUM,
        decision: SecurityDecision.SUSPICIOUS,
        summary: `High session churn: ${sessionCreated.length} created, ${sessionRevoked.length} revoked in 24h`,
        recommendedAction: 'REVIEW_SESSION_ACTIVITY',
        sourceEventIds: [...sessionCreated.slice(0, 5), ...sessionRevoked.slice(0, 5)].map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Rule: repeated SSO failures
    const ssoFailures = events.filter((e: any) => e.type === SecurityEventType.SSO_LOGIN_FAILURE);
    if (ssoFailures.length >= 3) {
      signals.push({
        ruleId: 'REPEATED_SSO_FAILURES',
        riskLevel: ssoFailures.length >= 5 ? SecurityRisk.HIGH : SecurityRisk.MEDIUM,
        decision: SecurityDecision.REVIEW_REQUIRED,
        summary: `${ssoFailures.length} SSO login failures in 24h`,
        recommendedAction: 'CHECK_SSO_CONFIG_AND_IDP',
        sourceEventIds: ssoFailures.slice(0, 10).map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Rule: excessive session creation
    if (sessionCreated.length >= 20) {
      signals.push({
        ruleId: 'EXCESSIVE_SESSION_CREATION',
        riskLevel: SecurityRisk.MEDIUM,
        decision: SecurityDecision.SUSPICIOUS,
        summary: `Excessive session creation: ${sessionCreated.length} sessions in 24h`,
        recommendedAction: 'ENFORCE_CONCURRENT_LIMIT_AND_REVIEW',
        sourceEventIds: sessionCreated.slice(0, 10).map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Rule: new device + high risk (preserve existing SuspiciousLoginDetector logic)
    const newDeviceLogins = events.filter((e: any) => e.type === 'NEW_DEVICE_LOGIN' || e.type === SecurityEventType.DEVICE_REGISTERED);
    if (newDeviceLogins.length >= 3) {
      signals.push({
        ruleId: 'NEW_DEVICE_BURST',
        riskLevel: SecurityRisk.MEDIUM,
        decision: SecurityDecision.STEP_UP_REQUIRED,
        summary: `${newDeviceLogins.length} new device logins in 24h`,
        recommendedAction: 'REQUIRE_MFA_FOR_NEW_DEVICES',
        sourceEventIds: newDeviceLogins.slice(0, 10).map((e: any) => e.id),
        policyVersion: policy.policyVersion,
      });
    }

    // Persist signals
    for (const signal of signals) {
      try {
        await (this.prisma as any).securityThreatSignal?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            userId: params.userId || null,
            ruleId: signal.ruleId,
            riskLevel: signal.riskLevel,
            decision: signal.decision,
            sourceEventIds: signal.sourceEventIds,
            safeSummary: signal.summary.substring(0, 1000),
            policyVersion: signal.policyVersion,
            createdAt: new Date(),
          },
        });

        await this.eventService.record({
          tenantId: params.tenantId,
          userId: params.userId || null,
          type: SecurityEventType.SECURITY_ALERT,
          severity: signal.riskLevel,
          description: `Threat detected rule=${signal.ruleId} ${signal.summary}`,
          safeMetadata: { ruleId: signal.ruleId, riskLevel: signal.riskLevel, decision: signal.decision, recommendedAction: signal.recommendedAction },
        });
      } catch (e: any) {
        this.logger.warn(`Failed to persist threat signal ${signal.ruleId}: ${e.message}`);
      }
    }

    this.logger.log(`Threat detection completed tenant=${params.tenantId} signals=${signals.length} eventsScanned=${events.length}`);

    return { signals, total: signals.length };
  }

  async listThreats(tenantId: string, filters?: { userId?: string; riskLevel?: SecurityRisk; ruleId?: string; resolved?: boolean; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    try {
      const where: any = { tenantId };
      if (filters?.userId) where.userId = filters.userId;
      if (filters?.riskLevel) where.riskLevel = filters.riskLevel;
      if (filters?.ruleId) where.ruleId = filters.ruleId;
      if (filters?.resolved !== undefined) where.resolved = filters.resolved;

      const [data, total] = await Promise.all([
        (this.prisma as any).securityThreatSignal?.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }) || [],
        (this.prisma as any).securityThreatSignal?.count({ where }) || 0,
      ]);

      return { data, total };
    } catch {
      return { data: [], total: 0 };
    }
  }

  async resolveThreat(signalId: string, tenantId: string, resolverId: string, resolution: string): Promise<any | null> {
    try {
      const updated = await (this.prisma as any).securityThreatSignal?.update({
        where: { id: signalId },
        data: { resolved: true, resolvedAt: new Date(), resolvedById: resolverId },
      });

      await this.eventService.record({
        tenantId,
        userId: resolverId,
        type: SecurityEventType.SECURITY_ALERT,
        severity: SecurityRisk.LOW,
        description: `Threat signal resolved signalId=${signalId} resolution=${resolution}`,
        safeMetadata: { signalId, resolution: resolution.substring(0, 500) },
      });

      return updated || null;
    } catch (e: any) {
      this.logger.warn(`Failed to resolve threat signal: ${e.message}`);
      return null;
    }
  }

  // Backward compatibility: old SuspiciousLoginDetector API used by auth.service.ts
  async assess(signals: { tenantId: string; userId: string; emailIndex: string; ipHash: string; deviceId: string; userAgent: string | null; requestId: string; geoLabel: string | null }): Promise<{ isNewDevice: boolean; isNewIp: boolean; recentFailureCount: number; distinctIpCount: number; riskScore: number; requiresNotification: boolean }> {
    return this.assessLoginRisk(signals);
  }

  async recordFailure(tenantId: string, ipHash: string, requestId: string): Promise<void> {
    try {
      if (this.cache) {
        const key = `security:failed-ip:${tenantId}:${ipHash}`;
        const count = await this.cache.increment(key, 900);
        if (count === 25) {
          await this.eventService.record({
            tenantId,
            type: SecurityEventType.SECURITY_ALERT,
            severity: SecurityRisk.HIGH,
            description: 'A single client produced 25 failed sign-in attempts within 15 minutes.',
            safeMetadata: { windowSeconds: 900, attempts: count, ipHash, requestId },
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`recordFailure failed: ${e.message}`);
    }
  }

  // Preserve existing suspicious login detection logic
  async assessLoginRisk(signals: { tenantId: string; userId: string; emailIndex: string; ipHash: string; deviceId: string; userAgent: string | null; requestId: string; geoLabel: string | null }): Promise<{ isNewDevice: boolean; isNewIp: boolean; recentFailureCount: number; distinctIpCount: number; riskScore: number; requiresNotification: boolean }> {
    const since = new Date(Date.now() - 24 * 3_600_000);

    try {
      const [knownDevice, knownIp, recentFailureCount, distinctIps] = await Promise.all([
        (this.prisma as any).userSession?.findFirst({ where: { userId: signals.userId, deviceId: signals.deviceId }, select: { id: true } }) || null,
        (this.prisma as any).loginAttempt?.findFirst({ where: { userId: signals.userId, ipHash: signals.ipHash, successful: true }, select: { id: true } }) || null,
        (this.prisma as any).loginAttempt?.count({ where: { tenantId: signals.tenantId, emailIndex: signals.emailIndex, successful: false, createdAt: { gte: since } } }) || 0,
        (this.prisma as any).loginAttempt?.findMany({ where: { userId: signals.userId, createdAt: { gte: since } }, select: { ipHash: true }, distinct: ['ipHash'] }) || [],
      ]);

      const isNewDevice = knownDevice === null;
      const isNewIp = knownIp === null;
      const distinctIpCount = distinctIps.length;

      let riskScore = 0;
      if (isNewDevice) riskScore += 35;
      if (isNewIp) riskScore += 25;
      if (recentFailureCount >= 3) riskScore += Math.min(30, recentFailureCount * 5);
      if (distinctIpCount >= 5) riskScore += 20;

      return {
        isNewDevice,
        isNewIp,
        recentFailureCount,
        distinctIpCount,
        riskScore: Math.min(100, riskScore),
        requiresNotification: isNewDevice || riskScore >= 60,
      };
    } catch {
      return { isNewDevice: true, isNewIp: true, recentFailureCount: 0, distinctIpCount: 1, riskScore: 35, requiresNotification: true };
    }
  }
}
