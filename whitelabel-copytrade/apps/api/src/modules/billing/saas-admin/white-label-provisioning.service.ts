import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TenantFeatureAccessService } from './tenant-feature-access.service';
import { SaasAdminAuditService } from './saas-admin-audit.service';
import type { SaasWhiteLabelState } from './saas-admin.types';
import { BillingEventService } from '../notifications/billing-event.service';

/**
 * Manages white-label capability.
 * Must require canonical whiteLabelMobileApp entitlement.
 * Do not enable merely because admin clicked - entitlement must permit.
 */
@Injectable()
export class WhiteLabelProvisioningService {
  private readonly logger = new Logger(WhiteLabelProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureAccessService: TenantFeatureAccessService,
    private readonly auditService: SaasAdminAuditService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async getWhiteLabelState(tenantId: string): Promise<SaasWhiteLabelState> {
    const entitlement = await this.featureAccessService.checkFeatureAccess(tenantId, 'whiteLabelMobileApp');

    // Get white-label provisioning state from tenant metadata or dedicated table
    let provisioningState: SaasWhiteLabelState['provisioningState'] = 'NOT_REQUESTED';
    let requestedAt: string | null = null;
    let enabledAt: string | null = null;
    let configuration: Record<string, unknown> | null = null;

    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { metadata: true },
      });

      const metadata = tenant?.metadata as any;
      const wlData = metadata?.whiteLabel || {};

      provisioningState = wlData.provisioningState || 'NOT_REQUESTED';
      requestedAt = wlData.requestedAt || null;
      enabledAt = wlData.enabledAt || null;
      configuration = wlData.configuration || null;

      // If tenant has active subscription and entitlement, but no provisioning state, it's eligible
      if (entitlement.enabled && provisioningState === 'NOT_REQUESTED') {
        // Still NOT_REQUESTED until explicitly requested
      }
    } catch {
      // Fallback
    }

    // If not entitled, force disabled/rejected logic
    if (!entitlement.enabled && provisioningState === 'ACTIVE') {
      // Edge case: was active but entitlement removed - should be disabled
      provisioningState = 'DISABLED';
    }

    return {
      tenantId,
      eligible: entitlement.enabled,
      entitlementAllowed: entitlement.enabled,
      entitlementReason: entitlement.reason,
      provisioningState,
      requestedAt,
      enabledAt,
      configuration,
    };
  }

  async requestWhiteLabel(tenantId: string, actorId: string, configuration?: Record<string, unknown>): Promise<SaasWhiteLabelState> {
    // Check entitlement - must have whiteLabelMobileApp
    const entitlement = await this.featureAccessService.checkFeatureAccess(tenantId, 'whiteLabelMobileApp');

    if (!entitlement.enabled) {
      await this.auditService.logWhiteLabelRejected(tenantId, actorId, entitlement.reason || 'White-label not included in current plan');
      throw new Error(`White-label not allowed: ${entitlement.reason || 'Feature not included in current plan'}`);
    }

    const currentState = await this.getWhiteLabelState(tenantId);

    if (currentState.provisioningState === 'ACTIVE') {
      throw new Error('White-label already active for this tenant');
    }

    if (currentState.provisioningState === 'PROVISIONING' || currentState.provisioningState === 'REQUESTED') {
      throw new Error('White-label provisioning already in progress');
    }

    const now = new Date().toISOString();

    // Update tenant metadata with provisioning request
    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { metadata: true } });
      const existingMetadata = (tenant?.metadata as any) || {};

      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          metadata: {
            ...existingMetadata,
            whiteLabel: {
              ...(existingMetadata.whiteLabel || {}),
              provisioningState: 'REQUESTED',
              requestedAt: now,
              configuration: configuration || existingMetadata.whiteLabel?.configuration || null,
            },
          },
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to update tenant metadata for white-label request: ${error.message}`);
      // Continue - still return state
    }

    await this.auditService.logWhiteLabelRequested(tenantId, actorId);

    this.logger.log(`White-label requested for tenant ${tenantId} by ${actorId}`);

    if (this.billingEventService) {
      this.billingEventService.onWhiteLabelProvisioning({
        tenantId,
        whiteLabelState: 'REQUESTED',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn(`Failed to trigger white-label provisioning notification: ${e.message}`));
    }

    return this.getWhiteLabelState(tenantId);
  }

  async enableWhiteLabel(tenantId: string, actorId: string): Promise<SaasWhiteLabelState> {
    // Must check entitlement again - do not enable merely because admin clicked
    const entitlement = await this.featureAccessService.checkFeatureAccess(tenantId, 'whiteLabelMobileApp');

    if (!entitlement.enabled) {
      await this.auditService.logWhiteLabelRejected(tenantId, actorId, entitlement.reason || 'Entitlement check failed during enable');
      throw new Error(`Cannot enable white-label: ${entitlement.reason || 'Entitlement not allowed'}`);
    }

    const currentState = await this.getWhiteLabelState(tenantId);

    if (currentState.provisioningState !== 'REQUESTED' && currentState.provisioningState !== 'PROVISIONING') {
      throw new Error(`White-label must be in REQUESTED or PROVISIONING state to enable, current: ${currentState.provisioningState}`);
    }

    const now = new Date().toISOString();

    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { metadata: true } });
      const existingMetadata = (tenant?.metadata as any) || {};

      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          metadata: {
            ...existingMetadata,
            whiteLabel: {
              ...(existingMetadata.whiteLabel || {}),
              provisioningState: 'ACTIVE',
              enabledAt: now,
            },
          },
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to update tenant metadata for white-label enable: ${error.message}`);
    }

    await this.auditService.logWhiteLabelEnabled(tenantId, actorId);

    this.logger.log(`White-label enabled for tenant ${tenantId} by ${actorId}`);

    if (this.billingEventService) {
      this.billingEventService.onWhiteLabelProvisioning({
        tenantId,
        whiteLabelState: 'ACTIVE',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn(`Failed to trigger white-label enabled notification: ${e.message}`));
    }

    return this.getWhiteLabelState(tenantId);
  }

  async disableWhiteLabel(tenantId: string, actorId: string, reason?: string): Promise<SaasWhiteLabelState> {
    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { metadata: true } });
      const existingMetadata = (tenant?.metadata as any) || {};

      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          metadata: {
            ...existingMetadata,
            whiteLabel: {
              ...(existingMetadata.whiteLabel || {}),
              provisioningState: 'DISABLED',
              disabledAt: new Date().toISOString(),
              disableReason: reason || null,
            },
          },
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to update tenant metadata for white-label disable: ${error.message}`);
    }

    await this.auditService.log({
      tenantId,
      operation: 'WHITE_LABEL_DISABLED' as any,
      actorId,
      referenceId: tenantId,
      referenceType: 'WHITE_LABEL',
      result: 'SUCCESS',
      reason,
      metadata: { reason },
    });

    this.logger.log(`White-label disabled for tenant ${tenantId} by ${actorId}, reason: ${reason || 'N/A'}`);

    return this.getWhiteLabelState(tenantId);
  }

  async updateConfiguration(tenantId: string, actorId: string, configuration: Record<string, unknown>): Promise<SaasWhiteLabelState> {
    const entitlement = await this.featureAccessService.checkFeatureAccess(tenantId, 'whiteLabelMobileApp');
    if (!entitlement.enabled) {
      throw new Error(`White-label not allowed: ${entitlement.reason}`);
    }

    const currentState = await this.getWhiteLabelState(tenantId);
    if (currentState.provisioningState !== 'ACTIVE') {
      throw new Error('White-label must be active to update configuration');
    }

    // Validate configuration - no secrets
    this.validateConfiguration(configuration);

    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { metadata: true } });
      const existingMetadata = (tenant?.metadata as any) || {};

      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          metadata: {
            ...existingMetadata,
            whiteLabel: {
              ...(existingMetadata.whiteLabel || {}),
              configuration: {
                ...(existingMetadata.whiteLabel?.configuration || {}),
                ...configuration,
              },
              configurationUpdatedAt: new Date().toISOString(),
            },
          },
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to update white-label config: ${error.message}`);
    }

    return this.getWhiteLabelState(tenantId);
  }

  private validateConfiguration(config: Record<string, unknown>): void {
    const forbiddenKeys = ['secret', 'apiKey', 'privateKey', 'accessToken', 'password', 'exchangeSecret', 'providerSecret'];
    for (const key of Object.keys(config)) {
      const lower = key.toLowerCase();
      if (forbiddenKeys.some((f) => lower.includes(f.toLowerCase()))) {
        throw new Error(`Configuration key ${key} is not allowed - contains secret`);
      }
    }

    // Validate URLs if present
    const urlFields = ['appStoreUrl', 'playStoreUrl', 'websiteUrl', 'supportUrl', 'privacyUrl', 'termsUrl'];
    for (const field of urlFields) {
      if (config[field] !== undefined && config[field] !== null && config[field] !== '') {
        if (typeof config[field] !== 'string') {
          throw new Error(`${field} must be a string`);
        }
        try {
          new URL(config[field] as string);
        } catch {
          throw new Error(`${field} must be a valid URL`);
        }
      }
    }
  }
}
