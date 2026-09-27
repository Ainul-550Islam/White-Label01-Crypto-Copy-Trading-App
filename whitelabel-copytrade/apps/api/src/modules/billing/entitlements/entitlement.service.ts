/**
 * Entitlement Service - Business logic for entitlements
 * 
 * This module handles business operations for entitlements including
 * creation, updates, feature checks, and usage tracking.
 */

import {
  Entitlement,
  EntitlementFeature,
  EntitlementLimit,
  CreateEntitlementRequest,
  UpdateEntitlementRequest,
  EntitlementFilter,
  EntitlementSummary,
  FeatureAccess,
  UsageRecord,
  EntitlementCheckResult,
  EntitlementStatus,
  EntitlementSource,
} from './entitlement.types';
import { EntitlementPolicy } from './entitlement.policy';

export interface EntitlementRepository {
  findById(id: string): Promise<Entitlement | null>;
  findByUserAndTenant(userId: string, tenantId: string): Promise<Entitlement | null>;
  findMany(filter: EntitlementFilter): Promise<Entitlement[]>;
  create(data: CreateEntitlementRequest): Promise<Entitlement>;
  update(id: string, data: UpdateEntitlementRequest): Promise<Entitlement>;
  delete(id: string): Promise<void>;
  recordUsage(entitlementId: string, record: UsageRecord): Promise<void>;
  resetUsage(entitlementId: string, limitKey: string): Promise<void>;
}

export class EntitlementService {
  private readonly policy: EntitlementPolicy;

  constructor(
    private readonly repository: EntitlementRepository,
    policyConfig?: Partial<import('./entitlement.policy').EntitlementPolicyConfig>
  ) {
    this.policy = new EntitlementPolicy(policyConfig);
  }

  /**
   * Get an entitlement by ID
   */
  async getEntitlement(id: string): Promise<Entitlement> {
    const entitlement = await this.repository.findById(id);
    if (!entitlement) {
      throw new Error(`Entitlement not found: ${id}`);
    }
    return entitlement;
  }

  /**
   * Get entitlement for a user in a tenant
   */
  async getUserEntitlement(userId: string, tenantId: string): Promise<Entitlement | null> {
    return this.repository.findByUserAndTenant(userId, tenantId);
  }

  /**
   * List entitlements with optional filters
   */
  async listEntitlements(filter: EntitlementFilter): Promise<Entitlement[]> {
    return this.repository.findMany(filter);
  }

  /**
   * Create a new entitlement
   */
  async createEntitlement(data: CreateEntitlementRequest): Promise<Entitlement> {
    // Check if user already has an active entitlement
    const existing = await this.repository.findByUserAndTenant(
      data.userId,
      data.tenantId
    );

    if (existing && this.policy.isEntitlementActive(existing)) {
      throw new Error('User already has an active entitlement');
    }

    // Create the entitlement
    const entitlement = await this.repository.create({
      ...data,
      startsAt: data.startsAt || new Date(),
    });

    return entitlement;
  }

  /**
   * Update an entitlement
   */
  async updateEntitlement(
    id: string,
    data: UpdateEntitlementRequest
  ): Promise<Entitlement> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Entitlement not found: ${id}`);
    }

    return this.repository.update(id, data);
  }

  /**
   * Cancel an entitlement
   */
  async cancelEntitlement(id: string): Promise<Entitlement> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Entitlement not found: ${id}`);
    }

    return this.repository.update(id, {
      status: EntitlementStatus.CANCELLED,
    });
  }

  /**
   * Suspend an entitlement
   */
  async suspendEntitlement(id: string): Promise<Entitlement> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Entitlement not found: ${id}`);
    }

    return this.repository.update(id, {
      status: EntitlementStatus.SUSPENDED,
    });
  }

  /**
   * Reactivate a suspended entitlement
   */
  async reactivateEntitlement(id: string): Promise<Entitlement> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Entitlement not found: ${id}`);
    }

    if (existing.status !== EntitlementStatus.SUSPENDED) {
      throw new Error('Only suspended entitlements can be reactivated');
    }

    return this.repository.update(id, {
      status: EntitlementStatus.ACTIVE,
    });
  }

  /**
   * Check if a user has access to a feature
   */
  async checkFeatureAccess(
    userId: string,
    tenantId: string,
    featureKey: string,
    requestedAmount: number = 1
  ): Promise<FeatureAccess> {
    const entitlement = await this.repository.findByUserAndTenant(userId, tenantId);
    return this.policy.checkFeatureAccess(entitlement, featureKey, requestedAmount);
  }

  /**
   * Check entitlement with limit
   */
  async checkEntitlement(
    userId: string,
    tenantId: string,
    featureKey: string,
    limitKey?: string,
    requestedAmount: number = 1
  ): Promise<EntitlementCheckResult> {
    const entitlement = await this.repository.findByUserAndTenant(userId, tenantId);
    return this.policy.checkEntitlement(entitlement, featureKey, limitKey, requestedAmount);
  }

  /**
   * Record usage of a feature
   */
  async recordUsage(
    userId: string,
    tenantId: string,
    featureKey: string,
    amount: number = 1,
    metadata?: Record<string, string>
  ): Promise<void> {
    const entitlement = await this.repository.findByUserAndTenant(userId, tenantId);
    if (!entitlement) {
      throw new Error('No entitlement found for user');
    }

    if (!this.policy.isEntitlementActive(entitlement)) {
      throw new Error('Entitlement is not active');
    }

    // Check if feature is enabled
    const feature = entitlement.features.find(f => f.key === featureKey);
    if (!feature || !feature.enabled) {
      throw new Error('Feature not enabled');
    }

    // Check limits
    const limitCheck = this.policy.checkLimit(entitlement, featureKey, amount);
    if (!limitCheck.allowed) {
      throw new Error('Limit exceeded');
    }

    // Record the usage
    await this.repository.recordUsage(entitlement.id, {
      featureKey,
      amount,
      timestamp: new Date(),
      metadata,
    });
  }

  /**
   * Reset usage for a limit
   */
  async resetUsage(userId: string, tenantId: string, limitKey: string): Promise<void> {
    const entitlement = await this.repository.findByUserAndTenant(userId, tenantId);
    if (!entitlement) {
      throw new Error('No entitlement found for user');
    }

    await this.repository.resetUsage(entitlement.id, limitKey);
  }

  /**
   * Get entitlement summary for a user
   */
  async getEntitlementSummary(userId: string, tenantId: string): Promise<EntitlementSummary | null> {
    const entitlement = await this.repository.findByUserAndTenant(userId, tenantId);
    if (!entitlement) {
      return null;
    }

    return {
      id: entitlement.id,
      tenantId: entitlement.tenantId,
      userId: entitlement.userId,
      planId: entitlement.planId,
      planName: '', // Would need to fetch from plan service
      status: entitlement.status,
      source: entitlement.source,
      featureCount: entitlement.features.length,
      limitCount: entitlement.limits.length,
      startsAt: entitlement.startsAt,
      expiresAt: entitlement.expiresAt,
    };
  }

  /**
   * Get active features for a user
   */
  async getActiveFeatures(userId: string, tenantId: string): Promise<EntitlementFeature[]> {
    const entitlement = await this.repository.findByUserAndTenant(userId, tenantId);
    if (!entitlement) {
      return [];
    }

    return this.policy.getActiveFeatures(entitlement);
  }

  /**
   * Get limits near threshold for a user
   */
  async getLimitsNearThreshold(
    userId: string,
    tenantId: string,
    thresholdPercentage: number = 80
  ): Promise<EntitlementLimit[]> {
    const entitlement = await this.repository.findByUserAndTenant(userId, tenantId);
    if (!entitlement) {
      return [];
    }

    return this.policy.getLimitsNearThreshold(entitlement, thresholdPercentage);
  }

  /**
   * Check if entitlement is active
   */
  async isEntitlementActive(userId: string, tenantId: string): Promise<boolean> {
    const entitlement = await this.repository.findByUserAndTenant(userId, tenantId);
    if (!entitlement) {
      return false;
    }

    return this.policy.isEntitlementActive(entitlement);
  }
}