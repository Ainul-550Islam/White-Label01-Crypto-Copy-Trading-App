import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SecurityPolicy } from './security.types';
import { randomUUID } from 'crypto';

/**
 * Resolves tenant/platform security policy: MFA requirements, session duration, idle timeout, password/security requirements, device trust, API-key rules, and SSO enforcement.
 * Policy precedence explicit, tenant cannot weaken mandatory platform-wide security.
 */
@Injectable()
export class SecurityPolicyService {
  private readonly logger = new Logger(SecurityPolicyService.name);
  private readonly platformPolicy: SecurityPolicy;

  constructor(private readonly prisma: PrismaService) {
    this.platformPolicy = {
      id: 'platform_default',
      tenantId: null,
      policyVersion: process.env.SECURITY_POLICY_VERSION || 'v1.0.0',
      mfaRequired: process.env.SECURITY_MFA_REQUIRED === 'true',
      mfaForPrivilegedRoles: process.env.SECURITY_MFA_PRIVILEGED !== 'false',
      mfaForSensitiveOperations: process.env.SECURITY_MFA_SENSITIVE !== 'false',
      sessionAbsoluteTimeoutSec: parseInt(process.env.SECURITY_SESSION_ABSOLUTE_TIMEOUT || '86400', 10),
      sessionIdleTimeoutSec: parseInt(process.env.SECURITY_SESSION_IDLE_TIMEOUT || '1800', 10),
      maxConcurrentSessions: parseInt(process.env.SECURITY_MAX_CONCURRENT_SESSIONS || '5', 10),
      deviceTrustDurationDays: parseInt(process.env.SECURITY_DEVICE_TRUST_DAYS || '30', 10),
      apiKeyExpirationDays: parseInt(process.env.SECURITY_API_KEY_EXPIRY_DAYS || '90', 10),
      apiKeyRotationDays: parseInt(process.env.SECURITY_API_KEY_ROTATION_DAYS || '30', 10),
      ssoEnforced: process.env.SECURITY_SSO_ENFORCED === 'true',
      allowedSsoDomains: (process.env.SECURITY_ALLOWED_SSO_DOMAINS || '').split(',').map((s) => s.trim()).filter(Boolean),
      jitProvisioning: process.env.SECURITY_JIT_ENABLED === 'true',
      privilegedReauthRequired: process.env.SECURITY_PRIVILEGED_REAUTH !== 'false',
      securityNotifications: process.env.SECURITY_NOTIFICATIONS !== 'false',
      passwordMinLength: parseInt(process.env.SECURITY_PASSWORD_MIN_LENGTH || '12', 10),
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getEffectivePolicy(params: { tenantId?: string; userId?: string }): Promise<SecurityPolicy> {
    try {
      if (params.tenantId) {
        const tenantPolicy = await (this.prisma as any).securityPolicy?.findFirst({
          where: { tenantId: params.tenantId, isActive: true },
          orderBy: { createdAt: 'desc' },
        });
        if (tenantPolicy) {
          return this.mergeWithPlatform(this.mapToPolicy(tenantPolicy));
        }
      }

      const platformPolicy = await (this.prisma as any).securityPolicy?.findFirst({
        where: { tenantId: null, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      if (platformPolicy) {
        return this.mapToPolicy(platformPolicy);
      }
    } catch (e: any) {
      this.logger.warn(`Failed to fetch security policy from DB: ${e.message}`);
    }
    return this.platformPolicy;
  }

  async getPlatformPolicy(): Promise<SecurityPolicy> {
    return this.getEffectivePolicy({});
  }

  async getTenantPolicy(tenantId: string): Promise<SecurityPolicy> {
    return this.getEffectivePolicy({ tenantId });
  }

  async listPolicies(): Promise<SecurityPolicy[]> {
    try {
      const records = await (this.prisma as any).securityPolicy?.findMany({ orderBy: { createdAt: 'desc' } }) || [];
      return records.map((r: any) => this.mapToPolicy(r));
    } catch {
      return [this.platformPolicy];
    }
  }

  async createOrUpdatePolicy(input: {
    tenantId?: string | null;
    policyVersion: string;
    mfaRequired?: boolean;
    mfaForPrivilegedRoles?: boolean;
    mfaForSensitiveOperations?: boolean;
    sessionAbsoluteTimeoutSec?: number;
    sessionIdleTimeoutSec?: number;
    maxConcurrentSessions?: number;
    deviceTrustDurationDays?: number;
    apiKeyExpirationDays?: number;
    apiKeyRotationDays?: number;
    ssoEnforced?: boolean;
    allowedSsoDomains?: string[];
    jitProvisioning?: boolean;
    privilegedReauthRequired?: boolean;
    securityNotifications?: boolean;
    passwordMinLength?: number;
    actorId: string;
  }): Promise<SecurityPolicy> {
    const tenantId = input.tenantId || null;

    // Enforce platform mandatory requirements cannot be weakened by tenant
    if (tenantId) {
      const platform = await this.getPlatformPolicy();
      if (platform.mfaRequired && input.mfaRequired === false) {
        throw new Error('Tenant cannot disable MFA when platform requires it');
      }
      if (platform.ssoEnforced && input.ssoEnforced === false) {
        throw new Error('Tenant cannot disable SSO enforcement when platform enforces it');
      }
      if (input.sessionAbsoluteTimeoutSec && input.sessionAbsoluteTimeoutSec > platform.sessionAbsoluteTimeoutSec) {
        throw new Error('Tenant cannot set longer absolute timeout than platform maximum');
      }
      if (input.passwordMinLength && input.passwordMinLength < platform.passwordMinLength) {
        throw new Error('Tenant cannot set weaker password policy than platform minimum');
      }
    }

    try {
      const existing = await (this.prisma as any).securityPolicy?.findFirst({
        where: { tenantId, policyVersion: input.policyVersion },
      });

      const data = {
        tenantId,
        policyVersion: input.policyVersion,
        mfaRequired: input.mfaRequired ?? this.platformPolicy.mfaRequired,
        mfaForPrivilegedRoles: input.mfaForPrivilegedRoles ?? this.platformPolicy.mfaForPrivilegedRoles,
        mfaForSensitiveOperations: input.mfaForSensitiveOperations ?? this.platformPolicy.mfaForSensitiveOperations,
        sessionAbsoluteTimeoutSec: input.sessionAbsoluteTimeoutSec ?? this.platformPolicy.sessionAbsoluteTimeoutSec,
        sessionIdleTimeoutSec: input.sessionIdleTimeoutSec ?? this.platformPolicy.sessionIdleTimeoutSec,
        maxConcurrentSessions: input.maxConcurrentSessions ?? this.platformPolicy.maxConcurrentSessions,
        deviceTrustDurationDays: input.deviceTrustDurationDays ?? this.platformPolicy.deviceTrustDurationDays,
        apiKeyExpirationDays: input.apiKeyExpirationDays ?? this.platformPolicy.apiKeyExpirationDays,
        apiKeyRotationDays: input.apiKeyRotationDays ?? this.platformPolicy.apiKeyRotationDays,
        ssoEnforced: input.ssoEnforced ?? this.platformPolicy.ssoEnforced,
        allowedSsoDomains: input.allowedSsoDomains ?? this.platformPolicy.allowedSsoDomains,
        jitProvisioning: input.jitProvisioning ?? this.platformPolicy.jitProvisioning,
        privilegedReauthRequired: input.privilegedReauthRequired ?? this.platformPolicy.privilegedReauthRequired,
        securityNotifications: input.securityNotifications ?? this.platformPolicy.securityNotifications,
        passwordMinLength: input.passwordMinLength ?? this.platformPolicy.passwordMinLength,
        isActive: true,
        updatedAt: new Date(),
      };

      let record: any;
      if (existing) {
        record = await (this.prisma as any).securityPolicy?.update({
          where: { id: existing.id },
          data,
        });
      } else {
        record = await (this.prisma as any).securityPolicy?.create({
          data: { id: randomUUID(), ...data, createdAt: new Date() },
        });
      }
      if (record) return this.mapToPolicy(record);
    } catch (e: any) {
      this.logger.warn(`Failed to create/update security policy: ${e.message}`);
    }

    return {
      ...this.platformPolicy,
      tenantId,
      policyVersion: input.policyVersion,
      mfaRequired: input.mfaRequired ?? this.platformPolicy.mfaRequired,
      ssoEnforced: input.ssoEnforced ?? this.platformPolicy.ssoEnforced,
    };
  }

  private mergeWithPlatform(tenantPolicy: SecurityPolicy): SecurityPolicy {
    // Platform mandatory requirements take precedence
    return {
      ...tenantPolicy,
      mfaRequired: this.platformPolicy.mfaRequired || tenantPolicy.mfaRequired,
      mfaForPrivilegedRoles: this.platformPolicy.mfaForPrivilegedRoles || tenantPolicy.mfaForPrivilegedRoles,
      mfaForSensitiveOperations: this.platformPolicy.mfaForSensitiveOperations || tenantPolicy.mfaForSensitiveOperations,
      ssoEnforced: this.platformPolicy.ssoEnforced || tenantPolicy.ssoEnforced,
      sessionAbsoluteTimeoutSec: Math.min(this.platformPolicy.sessionAbsoluteTimeoutSec, tenantPolicy.sessionAbsoluteTimeoutSec),
      passwordMinLength: Math.max(this.platformPolicy.passwordMinLength, tenantPolicy.passwordMinLength),
      // Tenant can be stricter on idle timeout (shorter)
      sessionIdleTimeoutSec: Math.min(this.platformPolicy.sessionIdleTimeoutSec, tenantPolicy.sessionIdleTimeoutSec),
    };
  }

  private mapToPolicy(raw: any): SecurityPolicy {
    return {
      id: raw.id,
      tenantId: raw.tenantId || null,
      policyVersion: raw.policyVersion,
      mfaRequired: raw.mfaRequired,
      mfaForPrivilegedRoles: raw.mfaForPrivilegedRoles,
      mfaForSensitiveOperations: raw.mfaForSensitiveOperations,
      sessionAbsoluteTimeoutSec: raw.sessionAbsoluteTimeoutSec,
      sessionIdleTimeoutSec: raw.sessionIdleTimeoutSec,
      maxConcurrentSessions: raw.maxConcurrentSessions,
      deviceTrustDurationDays: raw.deviceTrustDurationDays,
      apiKeyExpirationDays: raw.apiKeyExpirationDays,
      apiKeyRotationDays: raw.apiKeyRotationDays,
      ssoEnforced: raw.ssoEnforced,
      allowedSsoDomains: raw.allowedSsoDomains || [],
      jitProvisioning: raw.jitProvisioning,
      privilegedReauthRequired: raw.privilegedReauthRequired,
      securityNotifications: raw.securityNotifications,
      passwordMinLength: raw.passwordMinLength,
      isActive: raw.isActive,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
    };
  }
}
