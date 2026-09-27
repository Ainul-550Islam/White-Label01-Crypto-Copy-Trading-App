import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SecurityPolicyService } from './security-policy.service';
import { DeviceTrustService } from './device-trust.service';
import { SecurityDecision, SecurityRisk } from './security.types';

/**
 * Resolves MFA/security-factor requirements from existing auth policy, tenant policy, privileged-role requirements, and high-risk security signals.
 * This service decides WHEN MFA is required, does not implement another MFA engine.
 */
@Injectable()
export class MfaPolicyService {
  private readonly logger = new Logger(MfaPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: SecurityPolicyService,
    private readonly deviceTrustService: DeviceTrustService,
  ) {}

  async isMfaRequired(params: {
    tenantId: string;
    userId: string;
    roles?: string[];
    operation?: string;
    deviceId?: string;
    ipHash?: string;
    userAgent?: string;
    riskLevel?: SecurityRisk;
    isNewDevice?: boolean;
    isPrivileged?: boolean;
  }): Promise<{ required: boolean; decision: SecurityDecision; reasons: string[]; policyVersion: string }> {
    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });
    const reasons: string[] = [];

    // Platform mandatory MFA
    if (policy.mfaRequired) {
      reasons.push('PLATFORM_MFA_REQUIRED');
    }

    // Privileged roles require MFA
    const privilegedRoles = ['ADMIN', 'OWNER', 'PLATFORM_ADMIN', 'SUPER_ADMIN', 'COMPLIANCE_REVIEWER', 'SECURITY_ADMIN'];
    const hasPrivilegedRole = params.roles?.some((r) => privilegedRoles.includes(r)) || params.isPrivileged;

    if (hasPrivilegedRole && policy.mfaForPrivilegedRoles) {
      reasons.push('PRIVILEGED_ROLE_MFA_REQUIRED');
    }

    // Sensitive operations require MFA
    const sensitiveOps = ['API_KEY_CREATE', 'API_KEY_ROTATE', 'SSO_CONFIG_CHANGE', 'SECURITY_POLICY_CHANGE', 'USER_ROLE_ASSIGN', 'PAYOUT_CREATE', 'WITHDRAW', 'PRIVILEGED_ACTION'];
    if (params.operation && sensitiveOps.includes(params.operation) && policy.mfaForSensitiveOperations) {
      reasons.push(`SENSITIVE_OPERATION_MFA_REQUIRED:${params.operation}`);
    }

    // High risk signals require MFA
    if (params.riskLevel === SecurityRisk.HIGH || params.riskLevel === SecurityRisk.CRITICAL) {
      reasons.push(`HIGH_RISK_MFA_REQUIRED:${params.riskLevel}`);
    }

    // New device requires MFA
    if (params.isNewDevice) {
      reasons.push('NEW_DEVICE_MFA_REQUIRED');
    } else if (params.deviceId) {
      // Check device trust - untrusted device requires step-up
      const deviceTrust = await this.deviceTrustService.evaluateDeviceTrust({
        tenantId: params.tenantId,
        userId: params.userId,
        deviceId: params.deviceId,
        userAgent: params.userAgent,
        ipHash: params.ipHash,
      });

      if (!deviceTrust.trusted) {
        reasons.push(`UNTRUSTED_DEVICE_MFA_REQUIRED:${deviceTrust.state}`);
      }
    }

    // Check user's existing MFA status - if user has 2FA enabled, we still evaluate if required, but we don't weaken
    try {
      const user = await (this.prisma as any).user?.findUnique({ where: { id: params.userId }, select: { twoFactorEnabled: true } });
      if (user?.twoFactorEnabled && reasons.length === 0) {
        // User has MFA enabled but policy doesn't require - don't require step-up unless risk
        // But if platform requires MFA, we already added reason
      }
    } catch {}

    const required = reasons.length > 0;
    const decision = required ? SecurityDecision.STEP_UP_REQUIRED : SecurityDecision.ALLOW;

    this.logger.log(`MFA evaluation tenant=${params.tenantId} user=${params.userId} required=${required} reasons=${reasons.join(',')} operation=${params.operation || 'login'}`);

    return { required, decision, reasons, policyVersion: policy.policyVersion };
  }

  async requiresReauthForPrivileged(params: { tenantId: string; userId: string; operation: string; lastAuthAt?: Date }): Promise<{ required: boolean; reason?: string }> {
    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });

    if (!policy.privilegedReauthRequired) {
      return { required: false };
    }

    const privilegedOps = ['SECURITY_POLICY_CHANGE', 'SSO_CONFIG_CHANGE', 'API_KEY_CREATE', 'ROLE_ASSIGN', 'TENANT_DELETE', 'PAYOUT_CREATE'];
    if (!privilegedOps.includes(params.operation)) {
      return { required: false };
    }

    // Check last auth time - if more than 15 minutes ago, require re-auth
    const reauthWindowSec = 15 * 60;
    if (params.lastAuthAt) {
      const elapsedSec = (Date.now() - params.lastAuthAt.getTime()) / 1000;
      if (elapsedSec > reauthWindowSec) {
        return { required: true, reason: `PRIVILEGED_REAUTH_REQUIRED: elapsed ${elapsedSec}s > ${reauthWindowSec}s` };
      }
      return { required: false };
    }

    return { required: true, reason: 'PRIVILEGED_REAUTH_REQUIRED: no recent auth' };
  }

  async evaluateStepUp(params: {
    tenantId: string;
    userId: string;
    currentFactors: string[];
    requiredFactors: string[];
    riskLevel?: SecurityRisk;
  }): Promise<{ stepUpRequired: boolean; missingFactors: string[]; decision: SecurityDecision }> {
    const missing = params.requiredFactors.filter((f) => !params.currentFactors.includes(f));

    if (missing.length > 0) {
      return { stepUpRequired: true, missingFactors: missing, decision: SecurityDecision.STEP_UP_REQUIRED };
    }

    if (params.riskLevel === SecurityRisk.CRITICAL) {
      // Even if factors satisfied, critical risk requires review
      return { stepUpRequired: true, missingFactors: [], decision: SecurityDecision.REVIEW_REQUIRED };
    }

    return { stepUpRequired: false, missingFactors: [], decision: SecurityDecision.ALLOW };
  }
}
