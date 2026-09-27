import { Injectable } from '@nestjs/common';
import { SecurityEventType, SecuritySeverity } from '@wlct/shared-types';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { SecurityEventsService } from './security-events.service';

export interface LoginSignals {
  tenantId: string;
  userId: string;
  emailIndex: string;
  ipHash: string;
  deviceId: string;
  userAgent: string | null;
  requestId: string;
  geoLabel: string | null;
}

export interface LoginRiskAssessment {
  isNewDevice: boolean;
  isNewIp: boolean;
  recentFailureCount: number;
  distinctIpCount: number;
  riskScore: number;
  requiresNotification: boolean;
}

/**
 * Heuristic risk scoring for a successful authentication.
 *
 * Part 1 ships the deterministic signals that need no external data: new
 * device, new IP, burst of recent failures and IP fan-out. The scoring function
 * is isolated so a model-based detector can replace it later without touching
 * the authentication flow. Geo/ASN enrichment plugs into `geoLabel`.
 */
@Injectable()
export class SuspiciousLoginDetector {
  private static readonly LOOKBACK_HOURS = 24;
  private static readonly HIGH_RISK_THRESHOLD = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async assess(signals: LoginSignals): Promise<LoginRiskAssessment> {
    const since = new Date(Date.now() - SuspiciousLoginDetector.LOOKBACK_HOURS * 3_600_000);

    const [knownDevice, knownIp, recentFailureCount, distinctIps] = await Promise.all([
      this.prisma.userSession.findFirst({
        where: { userId: signals.userId, deviceId: signals.deviceId },
        select: { id: true },
      }),
      this.prisma.loginAttempt.findFirst({
        where: { userId: signals.userId, ipHash: signals.ipHash, successful: true },
        select: { id: true },
      }),
      this.prisma.loginAttempt.count({
        where: {
          tenantId: signals.tenantId,
          emailIndex: signals.emailIndex,
          successful: false,
          createdAt: { gte: since },
        },
      }),
      this.prisma.loginAttempt.findMany({
        where: { userId: signals.userId, createdAt: { gte: since } },
        select: { ipHash: true },
        distinct: ['ipHash'],
      }),
    ]);

    const isNewDevice = knownDevice === null;
    const isNewIp = knownIp === null;
    const distinctIpCount = distinctIps.length;

    let riskScore = 0;
    if (isNewDevice) {
      riskScore += 35;
    }
    if (isNewIp) {
      riskScore += 25;
    }
    if (recentFailureCount >= 3) {
      riskScore += Math.min(30, recentFailureCount * 5);
    }
    if (distinctIpCount >= 5) {
      riskScore += 20;
    }

    const assessment: LoginRiskAssessment = {
      isNewDevice,
      isNewIp,
      recentFailureCount,
      distinctIpCount,
      riskScore: Math.min(100, riskScore),
      requiresNotification: isNewDevice || riskScore >= SuspiciousLoginDetector.HIGH_RISK_THRESHOLD,
    };

    await this.emitEvents(signals, assessment);

    return assessment;
  }

  /** Tracks failed attempts per IP to spot credential stuffing across accounts. */
  async recordFailure(tenantId: string, ipHash: string, requestId: string): Promise<void> {
    const key = `security:failed-ip:${tenantId}:${ipHash}`;
    const count = await this.cache.increment(key, 900);

    if (count === 25) {
      await this.securityEvents.record({
        tenantId,
        type: SecurityEventType.CREDENTIAL_STUFFING_SUSPECTED,
        severity: SecuritySeverity.HIGH,
        description: 'A single client produced 25 failed sign-in attempts within 15 minutes.',
        ipHash,
        requestId,
        metadata: { windowSeconds: 900, attempts: count },
      });
    }
  }

  private async emitEvents(
    signals: LoginSignals,
    assessment: LoginRiskAssessment,
  ): Promise<void> {
    if (assessment.isNewDevice) {
      await this.securityEvents.record({
        tenantId: signals.tenantId,
        userId: signals.userId,
        type: SecurityEventType.NEW_DEVICE_LOGIN,
        severity: SecuritySeverity.LOW,
        description: 'Sign-in from a device that has not been seen before.',
        ipHash: signals.ipHash,
        userAgent: signals.userAgent,
        requestId: signals.requestId,
        metadata: { deviceId: signals.deviceId, geoLabel: signals.geoLabel },
      });
    }

    if (assessment.riskScore >= SuspiciousLoginDetector.HIGH_RISK_THRESHOLD) {
      await this.securityEvents.record({
        tenantId: signals.tenantId,
        userId: signals.userId,
        type: SecurityEventType.SUSPICIOUS_LOGIN,
        severity: SecuritySeverity.MEDIUM,
        description: 'Sign-in matched multiple risk signals and was flagged for review.',
        ipHash: signals.ipHash,
        userAgent: signals.userAgent,
        requestId: signals.requestId,
        metadata: {
          riskScore: assessment.riskScore,
          isNewDevice: assessment.isNewDevice,
          isNewIp: assessment.isNewIp,
          recentFailureCount: assessment.recentFailureCount,
          distinctIpCount: assessment.distinctIpCount,
        },
      });
    }
  }
}
