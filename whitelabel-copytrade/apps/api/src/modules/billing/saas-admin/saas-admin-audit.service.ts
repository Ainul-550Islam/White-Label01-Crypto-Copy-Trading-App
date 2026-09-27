import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

/**
 * Structured audit events for SaaS control-plane.
 * Never logs provider secrets, payment secrets, exchange credentials, tokens, private keys.
 */

export enum SaasAuditOperation {
  TENANT_PROVISIONED = 'TENANT_PROVISIONED',
  TENANT_PLAN_CHANGED = 'TENANT_PLAN_CHANGED',
  TENANT_PLAN_CHANGE_REJECTED = 'TENANT_PLAN_CHANGE_REJECTED',
  FEATURE_ACCESS_CHECKED = 'FEATURE_ACCESS_CHECKED',
  FEATURE_ACCESS_REJECTED = 'FEATURE_ACCESS_REJECTED',
  BRANDING_UPDATED = 'BRANDING_UPDATED',
  DOMAIN_REGISTERED = 'DOMAIN_REGISTERED',
  DOMAIN_VERIFICATION_STARTED = 'DOMAIN_VERIFICATION_STARTED',
  DOMAIN_VERIFIED = 'DOMAIN_VERIFIED',
  DOMAIN_VERIFICATION_FAILED = 'DOMAIN_VERIFICATION_FAILED',
  DOMAIN_REMOVED = 'DOMAIN_REMOVED',
  WHITE_LABEL_REQUESTED = 'WHITE_LABEL_REQUESTED',
  WHITE_LABEL_ENABLED = 'WHITE_LABEL_ENABLED',
  WHITE_LABEL_REJECTED = 'WHITE_LABEL_REJECTED',
  WHITE_LABEL_DISABLED = 'WHITE_LABEL_DISABLED',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  TENANT_ACTIVATED = 'TENANT_ACTIVATED',
}

export interface SaasAuditInput {
  tenantId: string;
  operation: SaasAuditOperation;
  actorId: string;
  actorType?: string;
  referenceId?: string;
  referenceType?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  result?: 'SUCCESS' | 'FAILURE' | 'REJECTED';
  reason?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class SaasAdminAuditService {
  private readonly logger = new Logger(SaasAdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: SaasAuditInput): Promise<void> {
    const sanitizedPrev = this.sanitize(input.previousState);
    const sanitizedNew = this.sanitize(input.newState);
    const sanitizedMeta = this.sanitize(input.metadata);

    const record = {
      id: randomUUID(),
      tenantId: input.tenantId,
      operation: input.operation,
      actorId: input.actorId,
      actorType: input.actorType || 'USER',
      referenceId: input.referenceId || input.tenantId,
      referenceType: input.referenceType || 'TENANT',
      previousState: sanitizedPrev,
      newState: sanitizedNew,
      result: input.result || 'SUCCESS',
      reason: input.reason || null,
      metadata: sanitizedMeta,
      timestamp: new Date(),
      createdAt: new Date(),
    };

    try {
      // Try dedicated SaaS audit table, fallback to general audit
      await (this.prisma as any).saasAuditLog?.create({ data: record });
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        // Fallback to general audit log
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: record.id,
              tenantId: record.tenantId,
              action: record.operation,
              resource: record.referenceType,
              resourceId: record.referenceId,
              actorId: record.actorId,
              metadata: {
                previousState: sanitizedPrev,
                newState: sanitizedNew,
                result: record.result,
                reason: record.reason,
                ...sanitizedMeta,
              },
              createdAt: record.createdAt,
            },
          });
        } catch {
          // Final fallback: log
          this.logger.log(`[SAAS_AUDIT] ${record.operation} tenant=${record.tenantId} actor=${record.actorId} result=${record.result} reason=${record.reason || 'N/A'}`);
        }
        return;
      }
      this.logger.warn(`Failed to create SaaS audit log: ${(error as Error).message}`);
    }

    this.logger.log(`[SAAS_AUDIT] ${record.operation} tenant=${record.tenantId} actor=${record.actorId} result=${record.result}`);
  }

  async logTenantProvisioned(tenantId: string, actorId: string, planId: string | null, idempotent: boolean): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.TENANT_PROVISIONED,
      actorId,
      referenceId: tenantId,
      referenceType: 'TENANT',
      newState: { planId, idempotent },
      result: 'SUCCESS',
      metadata: { planId, idempotent },
    });
  }

  async logPlanChanged(tenantId: string, actorId: string, previousPlanId: string | null, newPlanId: string, changeType: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.TENANT_PLAN_CHANGED,
      actorId,
      referenceId: tenantId,
      referenceType: 'TENANT_SUBSCRIPTION',
      previousState: { planId: previousPlanId },
      newState: { planId: newPlanId, changeType },
      result: 'SUCCESS',
      metadata: { previousPlanId, newPlanId, changeType },
    });
  }

  async logPlanChangeRejected(tenantId: string, actorId: string, requestedPlanId: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.TENANT_PLAN_CHANGE_REJECTED,
      actorId,
      referenceId: requestedPlanId,
      referenceType: 'SUBSCRIPTION_PLAN',
      newState: { requestedPlanId },
      result: 'REJECTED',
      reason,
      metadata: { requestedPlanId, reason },
    });
  }

  async logFeatureAccessChecked(tenantId: string, actorId: string, featureKey: string, allowed: boolean, source: string): Promise<void> {
    await this.log({
      tenantId,
      operation: allowed ? SaasAuditOperation.FEATURE_ACCESS_CHECKED : SaasAuditOperation.FEATURE_ACCESS_REJECTED,
      actorId,
      referenceId: featureKey,
      referenceType: 'FEATURE',
      newState: { featureKey, allowed, source },
      result: allowed ? 'SUCCESS' : 'REJECTED',
      reason: allowed ? undefined : `Feature ${featureKey} not allowed`,
      metadata: { featureKey, allowed, source },
    });
  }

  async logBrandingUpdated(tenantId: string, actorId: string, previousState: Record<string, unknown>, newState: Record<string, unknown>): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.BRANDING_UPDATED,
      actorId,
      referenceId: tenantId,
      referenceType: 'TENANT_BRANDING',
      previousState,
      newState,
      result: 'SUCCESS',
    });
  }

  async logDomainRegistered(tenantId: string, actorId: string, domain: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.DOMAIN_REGISTERED,
      actorId,
      referenceId: domain,
      referenceType: 'TENANT_DOMAIN',
      newState: { domain },
      result: 'SUCCESS',
      metadata: { domain },
    });
  }

  async logDomainVerificationStarted(tenantId: string, actorId: string, domain: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.DOMAIN_VERIFICATION_STARTED,
      actorId,
      referenceId: domain,
      referenceType: 'TENANT_DOMAIN',
      newState: { domain, verificationStarted: true },
      result: 'SUCCESS',
      metadata: { domain },
    });
  }

  async logDomainVerified(tenantId: string, actorId: string, domain: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.DOMAIN_VERIFIED,
      actorId,
      referenceId: domain,
      referenceType: 'TENANT_DOMAIN',
      newState: { domain, verified: true },
      result: 'SUCCESS',
      metadata: { domain },
    });
  }

  async logDomainVerificationFailed(tenantId: string, actorId: string, domain: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.DOMAIN_VERIFICATION_FAILED,
      actorId,
      referenceId: domain,
      referenceType: 'TENANT_DOMAIN',
      newState: { domain, verified: false },
      result: 'FAILURE',
      reason,
      metadata: { domain, reason },
    });
  }

  async logDomainRemoved(tenantId: string, actorId: string, domain: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.DOMAIN_REMOVED,
      actorId,
      referenceId: domain,
      referenceType: 'TENANT_DOMAIN',
      previousState: { domain },
      result: 'SUCCESS',
      metadata: { domain },
    });
  }

  async logWhiteLabelRequested(tenantId: string, actorId: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.WHITE_LABEL_REQUESTED,
      actorId,
      referenceId: tenantId,
      referenceType: 'WHITE_LABEL',
      result: 'SUCCESS',
    });
  }

  async logWhiteLabelEnabled(tenantId: string, actorId: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.WHITE_LABEL_ENABLED,
      actorId,
      referenceId: tenantId,
      referenceType: 'WHITE_LABEL',
      result: 'SUCCESS',
    });
  }

  async logWhiteLabelRejected(tenantId: string, actorId: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: SaasAuditOperation.WHITE_LABEL_REJECTED,
      actorId,
      referenceId: tenantId,
      referenceType: 'WHITE_LABEL',
      result: 'REJECTED',
      reason,
      metadata: { reason },
    });
  }

  private sanitize(data?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!data) return null;
    const forbidden = ['secret', 'apiKey', 'api_key', 'privateKey', 'private_key', 'accessToken', 'access_token', 'password', 'exchangeKey', 'exchangeSecret', 'providerSecret', 'stripeSecret', 'webhookSecret', 'credentials', 'token', 'key'];
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const lower = k.toLowerCase();
      if (forbidden.some((f) => lower.includes(f.toLowerCase()))) {
        sanitized[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        sanitized[k] = this.sanitize(v as any);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }
}
