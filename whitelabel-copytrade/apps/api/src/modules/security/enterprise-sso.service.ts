import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SsoProviderFactory } from './sso-provider.factory';
import { SecurityPolicyService } from './security-policy.service';
import { SecurityEventService } from './security-event.service';
import { SecurityAuditService } from './security-audit.service';
import { SsoProvider, NormalizedSsoIdentity, SecurityEventType, SecurityRisk } from './security.types';
import { randomUUID } from 'crypto';

/**
 * Main SSO orchestration: tenant SSO configuration, login initiation, callback processing, identity mapping, JIT provisioning where allowed, and SSO enforcement.
 * Does not create second user identity system, integrates into existing auth lifecycle.
 */
@Injectable()
export class EnterpriseSsoService {
  private readonly logger = new Logger(EnterpriseSsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ssoFactory: SsoProviderFactory,
    private readonly policyService: SecurityPolicyService,
    private readonly eventService: SecurityEventService,
    private readonly auditService: SecurityAuditService,
  ) {}

  async configureSso(params: {
    tenantId: string;
    providerType: SsoProvider;
    issuer?: string;
    audience?: string;
    clientId?: string;
    metadataUrl?: string;
    entityId?: string;
    acsUrl?: string;
    ssoUrl?: string;
    certificate?: string;
    allowedDomains?: string[];
    enforced?: boolean;
    jitEnabled?: boolean;
    defaultRole?: string;
    discoveryUrl?: string;
    jwksUrl?: string;
    scopes?: string[];
    actorId: string;
    ipHash?: string;
    requestId?: string;
  }): Promise<any> {
    const existing = await (this.prisma as any).ssoConfiguration?.findFirst({
      where: { tenantId: params.tenantId, providerType: params.providerType },
    });

    const data = {
      tenantId: params.tenantId,
      providerType: params.providerType,
      state: params.enforced ? 'ENFORCED' : 'ENABLED',
      issuer: params.issuer || null,
      audience: params.audience || null,
      clientId: params.clientId || null,
      metadataUrl: params.metadataUrl || null,
      entityId: params.entityId || null,
      acsUrl: params.acsUrl || null,
      ssoUrl: params.ssoUrl || null,
      certificate: params.certificate || null,
      allowedDomains: params.allowedDomains || [],
      enforced: params.enforced || false,
      jitEnabled: params.jitEnabled || false,
      defaultRole: params.defaultRole || null,
      discoveryUrl: params.discoveryUrl || null,
      jwksUrl: params.jwksUrl || null,
      scopes: params.scopes || [],
      isActive: true,
      createdById: params.actorId,
      updatedAt: new Date(),
    };

    let record: any;
    if (existing) {
      record = await (this.prisma as any).ssoConfiguration?.update({
        where: { id: existing.id },
        data,
      });
    } else {
      record = await (this.prisma as any).ssoConfiguration?.create({
        data: { id: randomUUID(), ...data, createdAt: new Date() },
      });
    }

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: params.actorId,
      type: SecurityEventType.SECURITY_POLICY_CHANGED,
      severity: SecurityRisk.MEDIUM,
      description: `SSO configuration ${params.enforced ? 'enforced' : 'enabled'} for provider ${params.providerType}`,
      safeMetadata: { providerType: params.providerType, enforced: params.enforced, jitEnabled: params.jitEnabled },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      actorId: params.actorId,
      event: 'SECURITY_POLICY_CHANGED',
      result: 'SUCCESS',
      targetType: 'SsoConfiguration',
      targetId: record.id,
      safeMetadata: { providerType: params.providerType, enforced: params.enforced },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    return {
      id: record.id,
      tenantId: record.tenantId,
      providerType: record.providerType,
      state: record.state,
      issuer: record.issuer,
      enforced: record.enforced,
      jitEnabled: record.jitEnabled,
      isActive: record.isActive,
      allowedDomains: record.allowedDomains,
    };
  }

  async disableSso(params: { tenantId: string; providerType: SsoProvider; actorId: string; ipHash?: string; requestId?: string }): Promise<any> {
    const existing = await (this.prisma as any).ssoConfiguration?.findFirst({
      where: { tenantId: params.tenantId, providerType: params.providerType },
    });

    if (!existing) {
      throw new BadRequestException(`SSO configuration not found for tenant ${params.tenantId} provider ${params.providerType}`);
    }

    // Check platform policy - cannot disable if platform enforces SSO
    const platformPolicy = await this.policyService.getPlatformPolicy();
    if (platformPolicy.ssoEnforced) {
      throw new ForbiddenException('Cannot disable SSO when platform enforces it');
    }

    const updated = await (this.prisma as any).ssoConfiguration?.update({
      where: { id: existing.id },
      data: { state: 'DISABLED', isActive: false, updatedAt: new Date() },
    });

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: params.actorId,
      type: SecurityEventType.SECURITY_POLICY_CHANGED,
      severity: SecurityRisk.HIGH,
      description: `SSO disabled for provider ${params.providerType}`,
      safeMetadata: { providerType: params.providerType },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      actorId: params.actorId,
      event: 'SECURITY_POLICY_CHANGED',
      result: 'SUCCESS',
      targetType: 'SsoConfiguration',
      targetId: existing.id,
      safeMetadata: { providerType: params.providerType, action: 'DISABLED' },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    return { id: updated.id, state: updated.state, isActive: updated.isActive };
  }

  async initiateLogin(params: { tenantId: string; providerType?: SsoProvider; redirectUri: string; ipHash?: string; requestId?: string }): Promise<{ url: string; state: string; providerType: SsoProvider }> {
    const provider = await this.ssoFactory.getProvider(params.tenantId, params.providerType);

    if (!provider.isAvailable()) {
      await this.eventService.record({
        tenantId: params.tenantId,
        type: SecurityEventType.SSO_LOGIN_FAILURE,
        severity: SecurityRisk.MEDIUM,
        description: `SSO login initiation failed - provider unavailable tenant=${params.tenantId}`,
        ipHash: params.ipHash,
        requestId: params.requestId,
        safeMetadata: { providerType: params.providerType, reason: 'PROVIDER_UNAVAILABLE' },
      });
      throw new BadRequestException(`SSO provider unavailable for tenant ${params.tenantId} - authentication failure, no fallback`);
    }

    const state = randomUUID();

    const authRequest = await provider.createAuthorizationRequest({
      tenantId: params.tenantId,
      providerType: provider.providerType,
      state,
      redirectUri: params.redirectUri,
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.eventService.record({
      tenantId: params.tenantId,
      type: SecurityEventType.SSO_LOGIN_STARTED,
      severity: SecurityRisk.LOW,
      description: `SSO login started for provider ${provider.providerType}`,
      ipHash: params.ipHash,
      requestId: params.requestId,
      safeMetadata: { providerType: provider.providerType, state },
    });

    return { url: authRequest.url, state: authRequest.state, providerType: provider.providerType };
  }

  async handleCallback(params: {
    tenantId: string;
    providerType: SsoProvider;
    state: string;
    code?: string;
    samlResponse?: string;
    idToken?: string;
    nonce?: string;
    ipHash?: string;
    requestId?: string;
  }): Promise<{
    identity: NormalizedSsoIdentity;
    user: any;
    isNewUser: boolean;
    tenantId: string;
  }> {
    const provider = await this.ssoFactory.getProvider(params.tenantId, params.providerType);

    if (!provider.isAvailable()) {
      await this.eventService.record({
        tenantId: params.tenantId,
        type: SecurityEventType.SSO_LOGIN_FAILURE,
        severity: SecurityRisk.HIGH,
        description: `SSO callback failed - provider unavailable`,
        ipHash: params.ipHash,
        requestId: params.requestId,
        safeMetadata: { providerType: params.providerType, reason: 'PROVIDER_UNAVAILABLE' },
      });
      throw new BadRequestException(`SSO provider unavailable - authentication failure`);
    }

    let identity: NormalizedSsoIdentity;
    try {
      identity = await provider.validateCallback({
        tenantId: params.tenantId,
        providerType: params.providerType,
        state: params.state,
        code: params.code,
        samlResponse: params.samlResponse,
        idToken: params.idToken,
        nonce: params.nonce,
        ipHash: params.ipHash,
        requestId: params.requestId,
      });
    } catch (e: any) {
      await this.eventService.record({
        tenantId: params.tenantId,
        type: SecurityEventType.SSO_LOGIN_FAILURE,
        severity: SecurityRisk.HIGH,
        description: `SSO validation failed: ${e.message}`,
        ipHash: params.ipHash,
        requestId: params.requestId,
        safeMetadata: { providerType: params.providerType, error: e.message.substring(0, 200) },
      });
      throw new BadRequestException(`SSO authentication failed: ${e.message}`);
    }

    // Existing user lookup - reuse existing user identity source
    const user = await this.findExistingUser(params.tenantId, identity.email);
    let isNewUser = false;
    let finalUser = user;

    if (!user) {
      // JIT provisioning where allowed
      const ssoConfig = await (this.prisma as any).ssoConfiguration?.findFirst({
        where: { tenantId: params.tenantId, providerType: params.providerType, isActive: true },
      });

      const securityPolicy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });

      if (!ssoConfig?.jitEnabled && !securityPolicy.jitProvisioning) {
        await this.eventService.record({
          tenantId: params.tenantId,
          type: SecurityEventType.SSO_LOGIN_FAILURE,
          severity: SecurityRisk.MEDIUM,
          description: `SSO login failed - user not found and JIT disabled email=${identity.email}`,
          ipHash: params.ipHash,
          requestId: params.requestId,
          safeMetadata: { providerType: params.providerType, emailDomain: identity.email.split('@')[1] },
        });
        throw new ForbiddenException('User not found and JIT provisioning disabled');
      }

      // JIT provisioning - create user in existing user table
      finalUser = await this.provisionJitUser(params.tenantId, identity, ssoConfig);
      isNewUser = true;

      this.logger.log(`JIT provisioned user tenant=${params.tenantId} email=${identity.email} provider=${params.providerType}`);
    }

    // Check tenant mapping - ensure user belongs to tenant
    if (finalUser.tenantId !== params.tenantId && !finalUser.isPlatformUser) {
      throw new ForbiddenException('User tenant mismatch');
    }

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: finalUser.id,
      type: SecurityEventType.SSO_LOGIN_SUCCESS,
      severity: SecurityRisk.LOW,
      description: `SSO login success for provider ${params.providerType}`,
      ipHash: params.ipHash,
      requestId: params.requestId,
      safeMetadata: { providerType: params.providerType, isNewUser, emailDomain: identity.email.split('@')[1] },
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      userId: finalUser.id,
      actorId: finalUser.id,
      event: 'SSO_LOGIN_SUCCESS',
      result: 'SUCCESS',
      targetType: 'User',
      targetId: finalUser.id,
      safeMetadata: { providerType: params.providerType, isNewUser },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    return { identity, user: finalUser, isNewUser, tenantId: params.tenantId };
  }

  async getSsoStatus(tenantId: string): Promise<{ enabled: boolean; enforced: boolean; providers: any[] }> {
    const providers = await this.ssoFactory.listTenantProviders(tenantId);
    const enabled = providers.some((p: any) => p.isActive && (p.state === 'ENABLED' || p.state === 'ENFORCED'));
    const enforced = providers.some((p: any) => p.enforced && p.state === 'ENFORCED');
    return { enabled, enforced, providers };
  }

  async enforceSsoCheck(tenantId: string, userEmail?: string): Promise<{ ssoRequired: boolean; providerType?: SsoProvider }> {
    const isEnforced = await this.ssoFactory.isSsoEnforced(tenantId);
    if (!isEnforced) {
      return { ssoRequired: false };
    }

    const providers = await this.ssoFactory.listTenantProviders(tenantId);
    const enforcedProvider = providers.find((p: any) => p.enforced && p.state === 'ENFORCED' && p.isActive);

    if (!enforcedProvider) {
      return { ssoRequired: false };
    }

    // Check domain restriction if email provided
    if (userEmail && enforcedProvider.allowedDomains && enforcedProvider.allowedDomains.length > 0) {
      const domain = userEmail.split('@')[1]?.toLowerCase();
      if (!enforcedProvider.allowedDomains.map((d: string) => d.toLowerCase()).includes(domain)) {
        return { ssoRequired: false };
      }
    }

    return { ssoRequired: true, providerType: enforcedProvider.providerType as SsoProvider };
  }

  private async findExistingUser(tenantId: string, email: string): Promise<any | null> {
    try {
      const crypto = require('crypto');
      const emailIndex = crypto.createHmac('sha256', process.env.EMAIL_INDEX_KEY || 'test_key').update(email.toLowerCase()).digest('hex').substring(0, 64);

      const user = await (this.prisma as any).user?.findFirst({
        where: { tenantId, emailIndex, deletedAt: null },
      });
      return user || null;
    } catch {
      // Fallback to email lookup
      try {
        const user = await (this.prisma as any).user?.findFirst({
          where: { tenantId, email: email.toLowerCase(), deletedAt: null },
        });
        return user || null;
      } catch {
        return null;
      }
    }
  }

  private async provisionJitUser(tenantId: string, identity: NormalizedSsoIdentity, ssoConfig: any): Promise<any> {
    try {
      const email = identity.email.toLowerCase();
      const crypto = require('crypto');
      const emailIndex = crypto.createHmac('sha256', process.env.EMAIL_INDEX_KEY || 'test_key').update(email).digest('hex').substring(0, 64);

      const user = await (this.prisma as any).user?.create({
        data: {
          id: randomUUID(),
          tenantId,
          email,
          emailIndex,
          passwordHash: `sso_${randomUUID()}`, // No password for SSO users, but field required - never usable
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          metadata: {
            ssoProvider: identity.provider,
            ssoSubject: identity.subject,
            ssoIssuer: identity.issuer,
            jitProvisioned: true,
            displayName: identity.displayName,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      if (!user) {
        throw new Error('Failed to create JIT user');
      }

      // Create profile
      try {
        await (this.prisma as any).userProfile?.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            firstName: identity.firstName || null,
            lastName: identity.lastName || null,
            displayName: identity.displayName || null,
          },
        });
      } catch {}

      // Assign default role if configured
      if (ssoConfig?.defaultRole) {
        try {
          const role = await (this.prisma as any).role?.findFirst({
            where: { tenantId, key: ssoConfig.defaultRole },
          });
          if (role) {
            await (this.prisma as any).userRole?.create({
              data: {
                id: randomUUID(),
                userId: user.id,
                roleId: role.id,
                tenantId,
                assignedAt: new Date(),
              },
            });
          }
        } catch {}
      }

      return user;
    } catch (e: any) {
      this.logger.error(`JIT provisioning failed tenant=${tenantId} email=${identity.email}: ${e.message}`);
      throw new BadRequestException(`JIT provisioning failed: ${e.message}`);
    }
  }
}
