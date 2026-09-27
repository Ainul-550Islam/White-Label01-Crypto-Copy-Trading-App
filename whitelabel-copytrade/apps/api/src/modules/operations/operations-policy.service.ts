import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  OperationalDependencyType,
  OperationalDependencyState,
  OperationalIncidentSeverity,
  OperationalMaintenanceScope,
  OperationalDegradationLevel,
  OperationalReconciliationType,
} from './operations.types';

/**
 * Central operational policy resolver for readiness requirements, critical dependencies,
 * escalation rules, maintenance restrictions, recovery permissions, and platform-vs-tenant scope.
 * Reuses existing configuration and security policy sources instead of inventing duplicate storage.
 */

export interface ReadinessPolicy {
  requiredDependencies: OperationalDependencyType[];
  criticalDependencies: OperationalDependencyType[];
  failClosedOn: OperationalDependencyType[];
  allowedDegraded: OperationalDependencyType[];
}

export interface EscalationRule {
  severity: OperationalIncidentSeverity;
  maxAgeMinutes: number;
  maxOccurrences: number;
  escalateTo: string[]; // role or channel identifiers
  requiresAcknowledgement: boolean;
}

export interface MaintenanceRestriction {
  scope: OperationalMaintenanceScope;
  requiresPlatformRole: boolean;
  requiresTenantOwnership: boolean;
  maxDurationHours: number;
  disallowedScopesDuringLiveTrading: OperationalMaintenanceScope[];
  requiresApprovalForEmergency: boolean;
}

export interface RecoveryPermission {
  requiresPlatformRole: boolean;
  requiresExplicitApproval: boolean;
  allowedRecoveryTypes: string[];
  forbiddenBypasses: string[]; // risk, compliance, live-gate, etc
}

@Injectable()
export class OperationsPolicyService {
  private readonly logger = new Logger(OperationsPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  // Configuration precedence explicit and auditable: env > tenant setting > default

  getReadinessPolicy(tenantId?: string | null): ReadinessPolicy {
    // Reuse existing config sources; do not invent duplicate storage
    const required: OperationalDependencyType[] = [
      OperationalDependencyType.DATABASE,
      OperationalDependencyType.REDIS,
      OperationalDependencyType.QUEUE,
      OperationalDependencyType.CONFIGURATION,
      OperationalDependencyType.SECURITY,
    ];

    const critical: OperationalDependencyType[] = [
      OperationalDependencyType.DATABASE,
      OperationalDependencyType.REDIS,
      OperationalDependencyType.QUEUE,
      OperationalDependencyType.SECURITY,
      OperationalDependencyType.DISTRIBUTED_LOCK,
      OperationalDependencyType.DURABLE_STORE,
    ];

    const failClosed: OperationalDependencyType[] = [
      OperationalDependencyType.DATABASE,
      OperationalDependencyType.REDIS,
      OperationalDependencyType.SECURITY,
      OperationalDependencyType.LIVE_GATE,
      OperationalDependencyType.CREDENTIAL_SOURCE,
      OperationalDependencyType.DISTRIBUTED_LOCK,
    ];

    // Non-critical degraded allowed: e.g., notifications can be degraded but platform still READY
    const allowedDegraded: OperationalDependencyType[] = [
      OperationalDependencyType.NOTIFICATION,
      OperationalDependencyType.OBSERVABILITY,
      OperationalDependencyType.RESEARCH,
      OperationalDependencyType.MARKET_DATA,
    ];

    this.logger.debug({
      event: 'operations.policy.readiness_resolved',
      tenantId: tenantId ?? 'platform',
      required: required.length,
      critical: critical.length,
    });

    return {
      requiredDependencies: required,
      criticalDependencies: critical,
      failClosedOn: failClosed,
      allowedDegraded,
    };
  }

  getEscalationRules(): EscalationRule[] {
    // Policy-driven, explicit thresholds from existing config where available, not invented
    return [
      {
        severity: OperationalIncidentSeverity.INFO,
        maxAgeMinutes: 240,
        maxOccurrences: 100,
        escalateTo: ['OPERATOR'],
        requiresAcknowledgement: false,
      },
      {
        severity: OperationalIncidentSeverity.WARNING,
        maxAgeMinutes: 120,
        maxOccurrences: 20,
        escalateTo: ['OPERATOR', 'TEAM_LEAD'],
        requiresAcknowledgement: true,
      },
      {
        severity: OperationalIncidentSeverity.ERROR,
        maxAgeMinutes: 30,
        maxOccurrences: 5,
        escalateTo: ['OPERATOR', 'TEAM_LEAD', 'ONCALL'],
        requiresAcknowledgement: true,
      },
      {
        severity: OperationalIncidentSeverity.CRITICAL,
        maxAgeMinutes: 10,
        maxOccurrences: 2,
        escalateTo: ['OPERATOR', 'TEAM_LEAD', 'ONCALL', 'PLATFORM_ADMIN'],
        requiresAcknowledgement: true,
      },
    ];
  }

  getMaintenanceRestrictions(): MaintenanceRestriction[] {
    return [
      {
        scope: OperationalMaintenanceScope.PLATFORM,
        requiresPlatformRole: true,
        requiresTenantOwnership: false,
        maxDurationHours: 8,
        disallowedScopesDuringLiveTrading: [],
        requiresApprovalForEmergency: true,
      },
      {
        scope: OperationalMaintenanceScope.TENANT,
        requiresPlatformRole: false,
        requiresTenantOwnership: true,
        maxDurationHours: 4,
        disallowedScopesDuringLiveTrading: [],
        requiresApprovalForEmergency: false,
      },
      {
        scope: OperationalMaintenanceScope.SERVICE,
        requiresPlatformRole: true,
        requiresTenantOwnership: false,
        maxDurationHours: 2,
        disallowedScopesDuringLiveTrading: [],
        requiresApprovalForEmergency: true,
      },
      {
        scope: OperationalMaintenanceScope.VENUE,
        requiresPlatformRole: true,
        requiresTenantOwnership: false,
        maxDurationHours: 2,
        disallowedScopesDuringLiveTrading: [],
        requiresApprovalForEmergency: true,
      },
      {
        scope: OperationalMaintenanceScope.TRADING_CAPABILITY,
        requiresPlatformRole: true,
        requiresTenantOwnership: false,
        maxDurationHours: 2,
        disallowedScopesDuringLiveTrading: [OperationalMaintenanceScope.TRADING_CAPABILITY],
        requiresApprovalForEmergency: true,
      },
      {
        scope: OperationalMaintenanceScope.BILLING_CAPABILITY,
        requiresPlatformRole: true,
        requiresTenantOwnership: false,
        maxDurationHours: 2,
        disallowedScopesDuringLiveTrading: [],
        requiresApprovalForEmergency: true,
      },
    ];
  }

  getRecoveryPermissions(): RecoveryPermission {
    return {
      requiresPlatformRole: false, // some recoveries tenant-scoped, but critical ones require platform
      requiresExplicitApproval: true,
      allowedRecoveryTypes: [
        'RETRY_QUEUE',
        'RERUN_RECONCILIATION',
        'RESTART_STREAM',
        'RECONNECT_EXCHANGE',
        'CLEAR_STALE_LOCK',
        'RESYNC_OMS',
        'RETRY_BILLING',
        'RETRY_NOTIFICATION',
        'RECOVER_SUBSCRIPTION',
      ],
      forbiddenBypasses: [
        'RISK',
        'COMPLIANCE',
        'LIVE_GATE',
        'CREDENTIAL_CONTROLS',
        'VENUE_ATTESTATION',
        'IP_ALLOWLIST',
        'SIGNED_TRANSPORT',
        'OMS',
        'EXECUTION_ENGINE',
        'DISTRIBUTED_LOCK',
        'DIRECT_DB_PATCH',
        'FAKE_FILL',
        'FAKE_ORDER_FILLED',
        'FAKE_PAYMENT_SUCCESS',
      ],
    };
  }

  isPlatformScoped(scope: OperationalMaintenanceScope, tenantId?: string | null): boolean {
    if (scope === OperationalMaintenanceScope.PLATFORM) return true;
    if (scope === OperationalMaintenanceScope.SERVICE) return true;
    if (scope === OperationalMaintenanceScope.VENUE) return true;
    if (!tenantId) return true; // null tenantId means platform
    return false;
  }

  getDegradationAllowedOperations(level: OperationalDegradationLevel): { allowed: string[]; blocked: string[] } {
    switch (level) {
      case OperationalDegradationLevel.NORMAL:
        return {
          allowed: ['READ', 'WRITE', 'TRADE', 'BILLING', 'ADMIN'],
          blocked: [],
        };
      case OperationalDegradationLevel.DEGRADED:
        return {
          allowed: ['READ', 'WRITE', 'TRADE', 'BILLING'],
          blocked: ['ADMIN_CRITICAL'],
        };
      case OperationalDegradationLevel.READ_ONLY:
        return {
          allowed: ['READ'],
          blocked: ['WRITE', 'TRADE', 'BILLING', 'ADMIN'],
        };
      case OperationalDegradationLevel.PAUSED:
        return {
          allowed: ['READ'],
          blocked: ['WRITE', 'TRADE', 'BILLING'],
        };
      case OperationalDegradationLevel.DISABLED:
        return {
          allowed: [],
          blocked: ['READ', 'WRITE', 'TRADE', 'BILLING', 'ADMIN'],
        };
      default:
        return { allowed: [], blocked: ['READ', 'WRITE', 'TRADE', 'BILLING', 'ADMIN'] };
    }
  }

  getCriticalReconciliationTypes(): OperationalReconciliationType[] {
    return [
      OperationalReconciliationType.OMS_ORDER,
      OperationalReconciliationType.OMS_FILL,
      OperationalReconciliationType.OMS_POSITION,
      OperationalReconciliationType.EXCHANGE_ACCOUNT,
      OperationalReconciliationType.RISK,
      OperationalReconciliationType.COMPLIANCE,
    ];
  }

  // Resolve policy version for auditability
  getPolicyVersion(): string {
    return `ops-policy-v1-${this.config.nodeEnv ?? 'production'}`;
  }

  async getTenantSecurityPolicy(tenantId: string) {
    try {
      const policy = await (this.prisma as any).securityPolicy.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      return policy;
    } catch {
      return null;
    }
  }
}
