import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TenantFeatureAccessService } from './tenant-feature-access.service';
import { SaasAdminAuditService } from './saas-admin-audit.service';
import type { SaasCustomDomainState } from './saas-admin.types';
import { BillingEventService } from '../notifications/billing-event.service';
import { randomBytes } from 'crypto';

/**
 * Custom-domain business layer.
 * Flow: request → entitlement check → validation → register → verification required → verified → activate
 * Requires customDomain entitlement, validates format, prevents cross-tenant ownership, prevents duplicates.
 */
@Injectable()
export class CustomDomainService {
  private readonly logger = new Logger(CustomDomainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureAccessService: TenantFeatureAccessService,
    private readonly auditService: SaasAdminAuditService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async getDomainState(tenantId: string): Promise<SaasCustomDomainState> {
    // Check entitlement first
    const entitlement = await this.featureAccessService.checkFeatureAccess(tenantId, 'customDomain');

    const domainRecord = await this.prisma.tenantDomain.findFirst({
      where: { tenantId, isPrimary: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!domainRecord) {
      // Check any domain
      const anyDomain = await this.prisma.tenantDomain.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });

      if (!anyDomain) {
        return {
          tenantId,
          domain: null,
          isPrimary: false,
          status: null,
          verifiedAt: null,
          verificationRequired: false,
          entitlementAllowed: entitlement.enabled,
          entitlementReason: entitlement.reason,
        };
      }

      return {
        tenantId,
        domain: anyDomain.domain,
        isPrimary: anyDomain.isPrimary,
        status: anyDomain.status,
        verifiedAt: anyDomain.verifiedAt ? anyDomain.verifiedAt.toISOString() : null,
        verificationRequired: anyDomain.status !== 'ACTIVE',
        entitlementAllowed: entitlement.enabled,
        entitlementReason: entitlement.reason,
      };
    }

    return {
      tenantId,
      domain: domainRecord.domain,
      isPrimary: domainRecord.isPrimary,
      status: domainRecord.status,
      verifiedAt: domainRecord.verifiedAt ? domainRecord.verifiedAt.toISOString() : null,
      verificationRequired: domainRecord.status !== 'ACTIVE',
      entitlementAllowed: entitlement.enabled,
      entitlementReason: entitlement.reason,
    };
  }

  async registerDomain(tenantId: string, domain: string, isPrimary: boolean | undefined, actorId: string): Promise<{ id: string; domain: string; status: string; verificationToken: string; message: string }> {
    // Entitlement check - must have customDomain
    const entitlement = await this.featureAccessService.checkFeatureAccess(tenantId, 'customDomain');
    if (!entitlement.enabled) {
      await this.auditService.logDomainVerificationFailed(tenantId, actorId, domain, `Entitlement check failed: ${entitlement.reason}`);
      throw new Error(`Custom domain not allowed: ${entitlement.reason || 'Feature not included in current plan'}`);
    }

    // Validate domain format
    this.validateDomainFormat(domain);

    // Prevent cross-tenant ownership - check if domain already exists for another tenant
    const existingDomain = await this.prisma.tenantDomain.findFirst({ where: { domain } });
    if (existingDomain) {
      if (existingDomain.tenantId !== tenantId) {
        throw new Error(`Domain ${domain} is already registered to another tenant`);
      } else {
        // Same tenant duplicate
        throw new Error(`Domain ${domain} is already registered for this tenant`);
      }
    }

    // Prevent duplicate - already checked, but also check tenant has not exceeded limit (e.g., 1 custom domain)
    // For simplicity, allow 1 primary custom domain per tenant
    const tenantDomainsCount = await this.prisma.tenantDomain.count({ where: { tenantId } });
    if (tenantDomainsCount >= 5) {
      throw new Error('Maximum custom domains limit reached (5)');
    }

    const verificationToken = randomBytes(32).toString('hex');

    const created = await this.prisma.tenantDomain.create({
      data: {
        tenantId,
        domain: domain.toLowerCase(),
        isPrimary: isPrimary ?? true,
        status: 'PENDING_DNS' as any,
        verificationToken,
      },
    });

    await this.auditService.logDomainRegistered(tenantId, actorId, domain);

    this.logger.log(`Custom domain registered: ${domain} for tenant ${tenantId} by ${actorId}`);

    return {
      id: created.id,
      domain: created.domain,
      status: created.status,
      verificationToken: `${verificationToken.substring(0, 8)}...`, // Only partial token exposed, full via verification service
      message: `Domain ${domain} registered. Verification required via DNS TXT record.`,
    };
  }

  async removeDomain(tenantId: string, domain: string, actorId: string): Promise<{ removed: boolean; domain: string }> {
    const domainRecord = await this.prisma.tenantDomain.findFirst({ where: { domain, tenantId } });
    if (!domainRecord) {
      throw new Error(`Domain ${domain} not found for tenant ${tenantId}`);
    }

    // Tenant ownership already validated by query

    await this.prisma.tenantDomain.delete({ where: { id: domainRecord.id } });

    await this.auditService.logDomainRemoved(tenantId, actorId, domain);

    this.logger.log(`Custom domain removed: ${domain} for tenant ${tenantId} by ${actorId}`);

    return { removed: true, domain };
  }

  async listDomains(tenantId: string): Promise<Array<{ id: string; domain: string; isPrimary: boolean; status: string; verifiedAt: string | null; createdAt: string }>> {
    const domains = await this.prisma.tenantDomain.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return domains.map((d: any) => ({
      id: d.id,
      domain: d.domain,
      isPrimary: d.isPrimary,
      status: d.status,
      verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  async getDomainById(tenantId: string, domainId: string): Promise<{ id: string; domain: string; isPrimary: boolean; status: string; verifiedAt: string | null; verificationToken: string; createdAt: string } | null> {
    const domain = await this.prisma.tenantDomain.findFirst({ where: { id: domainId, tenantId } });
    if (!domain) return null;

    return {
      id: domain.id,
      domain: domain.domain,
      isPrimary: domain.isPrimary,
      status: domain.status,
      verifiedAt: domain.verifiedAt ? domain.verifiedAt.toISOString() : null,
      verificationToken: domain.verificationToken,
      createdAt: domain.createdAt.toISOString(),
    };
  }

  private validateDomainFormat(domain: string): void {
    if (!domain || typeof domain !== 'string') {
      throw new Error('Domain must be a non-empty string');
    }

    if (domain.length > 253) {
      throw new Error('Domain must be <= 253 characters');
    }

    // FQDN regex - same as existing CreateTenantDomainDto
    const fqdnRegex = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
    const lowerDomain = domain.toLowerCase();

    if (!fqdnRegex.test(lowerDomain)) {
      throw new Error('Must be a valid fully qualified domain name');
    }

    // Block reserved/local domains
    const blocked = ['localhost', 'example', 'invalid', 'test'];
    for (const b of blocked) {
      if (lowerDomain === b || lowerDomain.endsWith(`.${b}`)) {
        // Allow example.com for testing, but block bare blocked
        if (b !== 'example' || lowerDomain === 'example') {
          throw new Error(`Domain ${domain} is not allowed`);
        }
      }
    }

    // Block IP addresses
    const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (ipRegex.test(lowerDomain)) {
      throw new Error('IP addresses are not allowed as custom domains');
    }
  }
}
