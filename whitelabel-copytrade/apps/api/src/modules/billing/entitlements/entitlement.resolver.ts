/**
 * Entitlement Resolver - GraphQL resolver for entitlements
 * 
 * This module handles GraphQL queries and mutations for entitlements.
 */

import { EntitlementService } from './entitlement.service';
import { EntitlementPolicy } from './entitlement.policy';
import {
  Entitlement,
  EntitlementFeature,
  EntitlementLimit,
  CreateEntitlementRequest,
  UpdateEntitlementRequest,
  EntitlementFilter,
  EntitlementSummary,
  FeatureAccess,
} from './entitlement.types';

export class EntitlementResolver {
  private readonly policy: EntitlementPolicy;

  constructor(private readonly service: EntitlementService) {
    this.policy = new EntitlementPolicy();
  }

  /**
   * Query: Get entitlement by ID
   */
  async getEntitlement(
    id: string,
    context: { userId: string; tenantId: string }
  ): Promise<Entitlement | null> {
    try {
      return await this.service.getEntitlement(id);
    } catch (error) {
      return null;
    }
  }

  /**
   * Query: Get current user's entitlement
   */
  async getMyEntitlement(
    context: { userId: string; tenantId: string }
  ): Promise<Entitlement | null> {
    return this.service.getUserEntitlement(context.userId, context.tenantId);
  }

  /**
   * Query: List entitlements
   */
  async listEntitlements(
    filter: EntitlementFilter,
    context: { userId: string; tenantId: string }
  ): Promise<Entitlement[]> {
    // Apply tenant filter from context
    return this.service.listEntitlements({
      ...filter,
      tenantId: context.tenantId,
    });
  }

  /**
   * Query: Get entitlement summary
   */
  async getEntitlementSummary(
    context: { userId: string; tenantId: string }
  ): Promise<EntitlementSummary | null> {
    return this.service.getEntitlementSummary(context.userId, context.tenantId);
  }

  /**
   * Query: Check feature access
   */
  async checkFeatureAccess(
    featureKey: string,
    context: { userId: string; tenantId: string }
  ): Promise<FeatureAccess> {
    return this.service.checkFeatureAccess(
      context.userId,
      context.tenantId,
      featureKey
    );
  }

  /**
   * Query: Get active features
   */
  async getActiveFeatures(
    context: { userId: string; tenantId: string }
  ): Promise<EntitlementFeature[]> {
    return this.service.getActiveFeatures(context.userId, context.tenantId);
  }

  /**
   * Query: Get limits near threshold
   */
  async getLimitsNearThreshold(
    thresholdPercentage: number,
    context: { userId: string; tenantId: string }
  ): Promise<EntitlementLimit[]> {
    return this.service.getLimitsNearThreshold(
      context.userId,
      context.tenantId,
      thresholdPercentage
    );
  }

  /**
   * Mutation: Create entitlement
   */
  async createEntitlement(
    data: CreateEntitlementRequest,
    context: { userId: string; tenantId: string }
  ): Promise<Entitlement> {
    // Ensure tenant matches context
    if (data.tenantId !== context.tenantId) {
      throw new Error('Cannot create entitlement for different tenant');
    }

    return this.service.createEntitlement(data);
  }

  /**
   * Mutation: Update entitlement
   */
  async updateEntitlement(
    id: string,
    data: UpdateEntitlementRequest,
    context: { userId: string; tenantId: string }
  ): Promise<Entitlement> {
    // Verify entitlement belongs to tenant
    const existing = await this.service.getEntitlement(id);
    if (existing.tenantId !== context.tenantId) {
      throw new Error('Entitlement does not belong to this tenant');
    }

    return this.service.updateEntitlement(id, data);
  }

  /**
   * Mutation: Cancel entitlement
   */
  async cancelEntitlement(
    id: string,
    context: { userId: string; tenantId: string }
  ): Promise<Entitlement> {
    // Verify entitlement belongs to tenant
    const existing = await this.service.getEntitlement(id);
    if (existing.tenantId !== context.tenantId) {
      throw new Error('Entitlement does not belong to this tenant');
    }

    return this.service.cancelEntitlement(id);
  }

  /**
   * Mutation: Suspend entitlement
   */
  async suspendEntitlement(
    id: string,
    context: { userId: string; tenantId: string }
  ): Promise<Entitlement> {
    // Verify entitlement belongs to tenant
    const existing = await this.service.getEntitlement(id);
    if (existing.tenantId !== context.tenantId) {
      throw new Error('Entitlement does not belong to this tenant');
    }

    return this.service.suspendEntitlement(id);
  }

  /**
   * Mutation: Reactivate entitlement
   */
  async reactivateEntitlement(
    id: string,
    context: { userId: string; tenantId: string }
  ): Promise<Entitlement> {
    // Verify entitlement belongs to tenant
    const existing = await this.service.getEntitlement(id);
    if (existing.tenantId !== context.tenantId) {
      throw new Error('Entitlement does not belong to this tenant');
    }

    return this.service.reactivateEntitlement(id);
  }

  /**
   * Mutation: Record usage
   */
  async recordUsage(
    featureKey: string,
    amount: number,
    context: { userId: string; tenantId: string }
  ): Promise<boolean> {
    try {
      await this.service.recordUsage(
        context.userId,
        context.tenantId,
        featureKey,
        amount
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Mutation: Reset usage
   */
  async resetUsage(
    limitKey: string,
    context: { userId: string; tenantId: string }
  ): Promise<boolean> {
    try {
      await this.service.resetUsage(
        context.userId,
        context.tenantId,
        limitKey
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Field resolver: Check if entitlement is active
   */
  async isActive(
    entitlement: Entitlement,
    context: { userId: string; tenantId: string }
  ): Promise<boolean> {
    return this.policy.isEntitlementActive(entitlement);
  }

  /**
   * Field resolver: Get feature access for a specific feature
   */
  async featureAccess(
    entitlement: Entitlement,
    featureKey: string,
    context: { userId: string; tenantId: string }
  ): Promise<FeatureAccess> {
    return this.policy.checkFeatureAccess(entitlement, featureKey);
  }

  /**
   * Field resolver: Get active features
   */
  async activeFeatures(
    entitlement: Entitlement,
    context: { userId: string; tenantId: string }
  ): Promise<EntitlementFeature[]> {
    return this.policy.getActiveFeatures(entitlement);
  }

  /**
   * Field resolver: Get limits near threshold
   */
  async limitsNearThreshold(
    entitlement: Entitlement,
    thresholdPercentage: number,
    context: { userId: string; tenantId: string }
  ): Promise<EntitlementLimit[]> {
    return this.policy.getLimitsNearThreshold(entitlement, thresholdPercentage);
  }
}