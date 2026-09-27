/**
 * Plan Service - Business logic for billing plans
 * 
 * This module handles business operations for plans including
 * creation, updates, validation, and plan management.
 */

import { Plan, CreatePlanRequest, UpdatePlanRequest, PlanFilter, PlanSummary, PlanComparison } from './plan.types';
import { PlanRepository } from './plan.repository';
import { validateCreatePlan, validateUpdatePlan } from './plan.validation';
import { DEFAULT_PLANS } from './plan.catalog';

export class PlanService {
  constructor(private readonly repository: PlanRepository) {}

  async getPlan(id: string, tenantId: string): Promise<Plan> {
    const plan = await this.repository.findById(id, tenantId);
    if (!plan) {
      throw new Error(`Plan not found: ${id}`);
    }
    return plan;
  }

  async getPlanBySlug(slug: string, tenantId: string): Promise<Plan> {
    const plan = await this.repository.findBySlug(slug, tenantId);
    if (!plan) {
      throw new Error(`Plan not found with slug: ${slug}`);
    }
    return plan;
  }

  async listPlans(filter: PlanFilter, tenantId: string): Promise<Plan[]> {
    return this.repository.findMany(filter, tenantId);
  }

  async listPlanSummaries(tenantId: string): Promise<PlanSummary[]> {
    return this.repository.findSummaries(tenantId);
  }

  async createPlan(data: CreatePlanRequest, tenantId: string, createdBy: string): Promise<Plan> {
    // Validate the request
    const validation = validateCreatePlan(data);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    // Check if slug is already taken
    const existingPlan = await this.repository.findBySlug(data.slug, tenantId);
    if (existingPlan) {
      throw new Error(`Plan with slug '${data.slug}' already exists`);
    }

    // Create the plan
    return this.repository.create(data, tenantId, createdBy);
  }

  async updatePlan(id: string, data: UpdatePlanRequest, tenantId: string, updatedBy: string): Promise<Plan> {
    // Validate the request
    const validation = validateUpdatePlan(data);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    // Check if plan exists
    const existingPlan = await this.repository.findById(id, tenantId);
    if (!existingPlan) {
      throw new Error(`Plan not found: ${id}`);
    }

    // Update the plan
    return this.repository.update(id, data, tenantId, updatedBy);
  }

  async deletePlan(id: string, tenantId: string): Promise<void> {
    // Check if plan exists
    const existingPlan = await this.repository.findById(id, tenantId);
    if (!existingPlan) {
      throw new Error(`Plan not found: ${id}`);
    }

    // Check if plan has subscribers (would need subscription service)
    // For now, just delete
    await this.repository.delete(id, tenantId);
  }

  async comparePlans(planIds: string[], tenantId: string): Promise<PlanComparison> {
    const plans = await Promise.all(
      planIds.map(id => this.repository.findById(id, tenantId))
    );

    const validPlans = plans.filter((plan): plan is Plan => plan !== null);

    if (validPlans.length < 2) {
      throw new Error('At least 2 valid plans are required for comparison');
    }

    // Collect all unique feature keys
    const featureKeys = new Set<string>();
    validPlans.forEach(plan => {
      plan.features.forEach(feature => {
        featureKeys.add(feature.key);
      });
    });

    // Collect all unique limit keys
    const limitKeys = new Set<string>();
    validPlans.forEach(plan => {
      plan.limits.forEach(limit => {
        limitKeys.add(limit.key);
      });
    });

    // Build differences
    const differences: Record<string, Record<string, unknown>> = {};

    featureKeys.forEach(featureKey => {
      differences[featureKey] = {};
      validPlans.forEach(plan => {
        const feature = plan.features.find(f => f.key === featureKey);
        differences[featureKey][plan.id] = feature ? feature.enabled : false;
      });
    });

    limitKeys.forEach(limitKey => {
      differences[limitKey] = {};
      validPlans.forEach(plan => {
        const limit = plan.limits.find(l => l.key === limitKey);
        differences[limitKey][plan.id] = limit ? limit.value : 0;
      });
    });

    return {
      plans: validPlans,
      features: Array.from(featureKeys),
      limits: Array.from(limitKeys),
      differences,
    };
  }

  async getDefaultPlans(): Promise<typeof DEFAULT_PLANS> {
    return DEFAULT_PLANS;
  }

  async initializeDefaultPlans(tenantId: string, createdBy: string): Promise<Plan[]> {
    const existingCount = await this.repository.count(tenantId);
    if (existingCount > 0) {
      throw new Error('Plans already exist for this tenant');
    }

    const plans: Plan[] = [];
    for (const template of DEFAULT_PLANS) {
      const plan = await this.repository.create(
        {
          name: template.name,
          slug: template.slug,
          description: template.description,
          tier: template.tier,
          price: template.price,
          features: template.features,
          limits: template.limits,
          metadata: template.metadata,
        },
        tenantId,
        createdBy
      );
      plans.push(plan);
    }

    return plans;
  }
}