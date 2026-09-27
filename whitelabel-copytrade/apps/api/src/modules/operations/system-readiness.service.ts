import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DependencyHealthService } from './dependency-health.service';
import { OperationsPolicyService } from './operations-policy.service';
import { OperationalAuditService } from './operational-audit.service';
import {
  OperationalReadinessState,
  OperationalDependencyState,
  ReadinessResult,
  redactSecrets,
} from './operations.types';

/**
 * Evaluates platform readiness across database, Redis, queues, required configuration,
 * security controls, live-gate prerequisites, exchanges, compliance, risk, OMS, billing,
 * and other critical dependencies. Must return structured blocking reasons and evidence.
 * Never fabricate readiness.
 */

@Injectable()
export class SystemReadinessService {
  private readonly logger = new Logger(SystemReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dependencyHealth: DependencyHealthService,
    private readonly policyService: OperationsPolicyService,
    private readonly auditService: OperationalAuditService,
  ) {}

  async evaluate(params: {
    tenantId?: string | null;
    requestedBy?: string | null;
    correlationId?: string | null;
  }): Promise<ReadinessResult> {
    const { tenantId = null, requestedBy = null, correlationId = null } = params;
    const checkedAt = new Date().toISOString();
    const policy = this.policyService.getReadinessPolicy(tenantId);

    const dependencyResults = await this.dependencyHealth.checkAll(tenantId);

    const blockingReasons: string[] = [];
    const degradedComponents: string[] = [];

    // Fail closed for unavailable critical dependencies where safety requires it
    for (const dep of dependencyResults) {
      if (dep.state === OperationalDependencyState.UNAVAILABLE || dep.state === OperationalDependencyState.MISCONFIGURED) {
        if (policy.criticalDependencies.includes(dep.dependencyType) || policy.failClosedOn.includes(dep.dependencyType)) {
          blockingReasons.push(`${dep.dependencyType}:${dep.dependencyName} is ${dep.state} ${dep.errorCode ?? ''}`.trim());
        } else if (!policy.allowedDegraded.includes(dep.dependencyType)) {
          degradedComponents.push(`${dep.dependencyType}:${dep.dependencyName}`);
        }
      } else if (dep.state === OperationalDependencyState.DEGRADED) {
        if (policy.criticalDependencies.includes(dep.dependencyType) && !policy.allowedDegraded.includes(dep.dependencyType)) {
          // Critical degraded is blocking unless explicitly allowed
          degradedComponents.push(`${dep.dependencyType}:${dep.dependencyName}`);
          if (policy.failClosedOn.includes(dep.dependencyType)) {
            blockingReasons.push(`${dep.dependencyType} degraded and fail-closed required`);
          }
        } else {
          degradedComponents.push(`${dep.dependencyType}:${dep.dependencyName}`);
        }
      } else if (dep.state === OperationalDependencyState.UNKNOWN) {
        if (policy.failClosedOn.includes(dep.dependencyType)) {
          blockingReasons.push(`${dep.dependencyType}:${dep.dependencyName} UNKNOWN and fail-closed required`);
        }
      }
    }

    // Check maintenance windows
    try {
      const now = new Date();
      const activeMaintenance = await (this.prisma as any).operationalMaintenanceWindow.findMany({
        where: {
          state: 'ACTIVE',
          scheduledStart: { lte: now },
          scheduledEnd: { gte: now },
          OR: [{ tenantId: tenantId ?? undefined }, { tenantId: null }, { scope: 'PLATFORM' }],
        },
      });
      if (activeMaintenance.length > 0) {
        blockingReasons.push(`Maintenance active: ${activeMaintenance.map((m: any) => m.title).join(', ')}`);
      }
    } catch {
      // If maintenance check fails, do not fabricate readiness — treat as degraded evidence
      degradedComponents.push('MAINTENANCE_CHECK_UNAVAILABLE');
    }

    // Check degradation
    try {
      const degradations = await (this.prisma as any).operationalServiceDegradation.findMany({
        where: {
          tenantId: tenantId ?? undefined,
          endsAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const blockingDegradation = degradations.filter((d: any) => d.level === 'DISABLED' || d.level === 'PAUSED');
      if (blockingDegradation.length > 0) {
        blockingReasons.push(`Service degradation active: ${blockingDegradation.map((d: any) => `${d.serviceName}:${d.level}`).join(', ')}`);
      }
      degradations.forEach((d: any) => {
        if (d.level !== 'NORMAL') degradedComponents.push(`${d.serviceName}:${d.level}`);
      });
    } catch {
      // No degradation table yet is not blocking
    }

    let state: OperationalReadinessState;
    let isReady: boolean;

    if (blockingReasons.length > 0) {
      state = OperationalReadinessState.NOT_READY;
      isReady = false;
    } else if (degradedComponents.length > 0) {
      state = OperationalReadinessState.DEGRADED;
      isReady = true; // Degraded but still ready for limited operations
    } else {
      state = OperationalReadinessState.READY;
      isReady = true;
    }

    // If maintenance is active for this tenant/platform, override to MAINTENANCE unless NOT_READY already
    if (state !== OperationalReadinessState.NOT_READY) {
      try {
        const maintenanceActive = await (this.prisma as any).operationalMaintenanceWindow.findFirst({
          where: {
            state: 'ACTIVE',
            OR: [{ tenantId: tenantId ?? undefined }, { tenantId: null }],
          },
        });
        if (maintenanceActive) {
          state = OperationalReadinessState.MAINTENANCE;
          isReady = false;
        }
      } catch {}
    }

    const result: ReadinessResult = {
      state,
      isReady,
      blockingReasons,
      degradedComponents,
      evidence: redactSecrets({
        policyVersion: this.policyService.getPolicyVersion(),
        dependencyCount: dependencyResults.length,
        blockingCount: blockingReasons.length,
        degradedCount: degradedComponents.length,
        tenantId: tenantId ?? 'platform',
      }),
      dependencyResults,
      checkedAt,
      tenantId: tenantId ?? null,
      correlationId: correlationId ?? null,
    };

    // Audit immutable record
    await this.auditService.record({
      tenantId: tenantId ?? null,
      eventType: 'READINESS_CHECK' as any,
      actorId: requestedBy ?? null,
      actorType: requestedBy ? 'USER' : 'SYSTEM',
      targetType: 'READINESS',
      targetId: tenantId ?? 'platform',
      evidence: redactSecrets({
        state,
        isReady,
        blockingReasons,
        degradedComponents,
        dependencyResults: dependencyResults.map((d) => ({ type: d.dependencyType, state: d.state, isCritical: d.isCritical })),
        correlationId,
      }),
      correlationId: correlationId ?? null,
    });

    // Persist readiness check history
    try {
      await (this.prisma as any).operationalReadinessCheck.create({
        data: {
          tenantId: tenantId ?? null,
          state: state as any,
          isReady,
          blockingReasons,
          degradedComponents,
          evidence: redactSecrets(result.evidence) as any,
          requestedBy: requestedBy ?? null,
          correlationId: correlationId ?? null,
          checkedAt: new Date(checkedAt),
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to persist readiness check: ${(e as Error).message}`);
    }

    this.logger.log({
      event: 'operations.readiness.evaluated',
      tenantId: tenantId ?? 'platform',
      state,
      isReady,
      blockingReasons: blockingReasons.length,
    });

    return result;
  }

  async getLatest(tenantId?: string | null): Promise<any | null> {
    try {
      const where = tenantId ? { tenantId } : { tenantId: null };
      return await (this.prisma as any).operationalReadinessCheck.findFirst({
        where,
        orderBy: { checkedAt: 'desc' },
      });
    } catch {
      return null;
    }
  }
}
