import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlansService } from '../plans.service';
import { SubscriptionsService } from '../subscriptions.service';
import { FeeType, FeePolicySnapshot } from './fee.types';

/**
 * Resolves effective platform/performance fee policy from canonical plan/tenant configuration.
 * Never trusts client-provided rates, no hardcoded commercial percentages.
 * Plan configuration is canonical; tenant override only if explicitly supported in metadata.
 */
@Injectable()
export class FeePolicyService {
  private readonly logger = new Logger(FeePolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async resolvePolicy(tenantId: string, feeType: FeeType, currency?: string): Promise<FeePolicySnapshot> {
    // 1. Get tenant's current subscription and plan
    const subscription = await this.subscriptionsService.getCurrent(tenantId);
    let plan: any = null;
    let platformFeeBps = 0;
    let performanceFeeBps = 0;
    let planId: string | null = null;
    let planCode: string | null = null;
    let source: 'plan' | 'tenant_override' | 'global_policy' = 'global_policy';

    if (subscription) {
      try {
        plan = subscription.plan || null;
        if (!plan && subscription.planId) {
          // Try to fetch via plans service if not included
          try {
            const dto = await this.plansService.findById(subscription.planId, {
              tenantId: null,
              isPlatformUser: true,
            });
            plan = dto;
          } catch {
            // ignore, fallback to subscription plan fields if present
          }
        }

        if (plan) {
          platformFeeBps = plan.platformFeeBps ?? plan.limits?.platformFeeBps ?? 0;
          performanceFeeBps = plan.performanceFeeBps ?? plan.limits?.performanceFeeBps ?? 0;
          planId = plan.id || subscription.planId;
          planCode = plan.code || null;
          source = 'plan';
        }
      } catch (e) {
        this.logger.warn(`Failed to resolve plan for tenant ${tenantId}: ${(e as Error).message}`);
      }
    }

    // 2. Check for tenant-specific override if architecture explicitly supports it
    // Look into tenant.metadata.commercial or tenant.metadata.feePolicy
    let tenantOverrideApplied = false;
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { metadata: true },
      });
      const metadata = tenant?.metadata as any;
      if (metadata) {
        // Explicitly supported override paths
        const commercialOverride = metadata.commercial || metadata.feePolicy || metadata.billingPolicy;
        if (commercialOverride && typeof commercialOverride === 'object') {
          // Only allow override if tenant has explicit flag allowFeeOverride
          const allowOverride = metadata.allowFeeOverride === true || commercialOverride.allowOverride === true;
          if (allowOverride) {
            if (feeType === FeeType.PLATFORM_FEE && typeof commercialOverride.platformFeeBps === 'number') {
              const overrideBps = this.validateBps(commercialOverride.platformFeeBps);
              if (overrideBps !== null) {
                platformFeeBps = overrideBps;
                tenantOverrideApplied = true;
                source = 'tenant_override';
                this.logger.log(`Tenant override applied for ${tenantId} platformFeeBps=${overrideBps}`);
              }
            }
            if (feeType === FeeType.PERFORMANCE_FEE && typeof commercialOverride.performanceFeeBps === 'number') {
              const overrideBps = this.validateBps(commercialOverride.performanceFeeBps);
              if (overrideBps !== null) {
                performanceFeeBps = overrideBps;
                tenantOverrideApplied = true;
                source = 'tenant_override';
                this.logger.log(`Tenant override applied for ${tenantId} performanceFeeBps=${overrideBps}`);
              }
            }
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to check tenant override for ${tenantId}: ${(e as Error).message}`);
    }

    // 3. Global platform policy fallback (if no plan)
    if (!plan && !tenantOverrideApplied) {
      // Try to get default platform policy from env or config
      // For now, default to 0 platform fee, 2000 performance fee (20%) if not configured
      // This is NOT hardcoded commercial rate per plan - it's global fallback default
      // Actual rates come from plan catalog
      const globalPlatformFee = parseInt(process.env.GLOBAL_PLATFORM_FEE_BPS || '0', 10);
      const globalPerformanceFee = parseInt(process.env.GLOBAL_PERFORMANCE_FEE_BPS || '0', 10);
      if (source === 'global_policy') {
        if (platformFeeBps === 0 && !isNaN(globalPlatformFee)) {
          platformFeeBps = globalPlatformFee;
        }
        if (performanceFeeBps === 0 && !isNaN(globalPerformanceFee)) {
          performanceFeeBps = globalPerformanceFee;
        }
      }
    }

    // Validate final BPS
    platformFeeBps = this.validateBps(platformFeeBps) ?? 0;
    performanceFeeBps = this.validateBps(performanceFeeBps) ?? 0;

    const effectiveBps = feeType === FeeType.PLATFORM_FEE ? platformFeeBps : performanceFeeBps;

    const snapshot: FeePolicySnapshot = {
      tenantId,
      planId,
      planCode,
      platformFeeBps,
      performanceFeeBps,
      currency: currency || 'USD',
      effectiveAt: new Date().toISOString(),
      source,
      minimumFee: null,
      maximumCap: null,
      metadata: {
        resolvedFeeType: feeType,
        effectiveBps,
        subscriptionId: subscription?.id || null,
      },
    };

    this.logger.log(
      `Fee policy resolved tenant=${tenantId} feeType=${feeType} plan=${planCode || 'none'} platformBps=${platformFeeBps} performanceBps=${performanceFeeBps} source=${source}`,
    );

    return snapshot;
  }

  async resolvePlatformFeePolicy(tenantId: string, currency?: string): Promise<FeePolicySnapshot> {
    return this.resolvePolicy(tenantId, FeeType.PLATFORM_FEE, currency);
  }

  async resolvePerformanceFeePolicy(tenantId: string, currency?: string): Promise<FeePolicySnapshot> {
    return this.resolvePolicy(tenantId, FeeType.PERFORMANCE_FEE, currency);
  }

  async getEffectiveRateBps(tenantId: string, feeType: FeeType): Promise<number> {
    const policy = await this.resolvePolicy(tenantId, feeType);
    return feeType === FeeType.PLATFORM_FEE ? policy.platformFeeBps : policy.performanceFeeBps;
  }

  private validateBps(bps: any): number | null {
    if (typeof bps !== 'number') return null;
    if (isNaN(bps)) return null;
    if (bps < 0 || bps > 10000) {
      this.logger.warn(`Invalid BPS ${bps}, must be 0-10000`);
      return null;
    }
    return Math.floor(bps);
  }
}
