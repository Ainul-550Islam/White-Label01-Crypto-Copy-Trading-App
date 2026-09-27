import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanService } from '../../../apps/api/src/modules/billing/plans/plan.service';
import { PlanRepository } from '../../../apps/api/src/modules/billing/plans/plan.repository';
import { PlanTier, PlanStatus, BillingInterval } from '../../../apps/api/src/modules/billing/plans/plan.types';

// Mock the repository
vi.mock('../../../apps/api/src/modules/billing/plans/plan.repository');

describe('PlanService', () => {
  let service: PlanService;
  let mockRepository: vi.Mocked<PlanRepository>;

  beforeEach(() => {
    mockRepository = {
      findById: vi.fn(),
      findBySlug: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as any;
    service = new PlanService(mockRepository);
  });

  describe('getPlanById', () => {
    it('should return plan when found', async () => {
      const mockPlan = {
        id: 'plan-1',
        tenantId: 'tenant-1',
        name: 'Basic',
        slug: 'basic',
        description: 'Basic plan',
        tier: PlanTier.BASIC,
        status: PlanStatus.ACTIVE,
        price: { amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY },
        features: [],
        limits: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'system',
        updatedBy: 'system',
      };
      mockRepository.findById.mockResolvedValue(mockPlan);

      const result = await service.getPlanById('plan-1');
      expect(result).toEqual(mockPlan);
      expect(mockRepository.findById).toHaveBeenCalledWith('plan-1');
    });

    it('should return null when plan not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await service.getPlanById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getPlanBySlug', () => {
    it('should return plan when found by slug', async () => {
      const mockPlan = {
        id: 'plan-1',
        slug: 'basic',
        name: 'Basic',
      };
      mockRepository.findBySlug.mockResolvedValue(mockPlan as any);

      const result = await service.getPlanBySlug('basic');
      expect(result).toEqual(mockPlan);
    });
  });

  describe('getAllPlans', () => {
    it('should return all plans', async () => {
      const mockPlans = [
        { id: 'plan-1', name: 'Basic' },
        { id: 'plan-2', name: 'Standard' },
      ];
      mockRepository.findAll.mockResolvedValue(mockPlans as any);

      const result = await service.getAllPlans();
      expect(result).toHaveLength(2);
    });
  });

  describe('createPlan', () => {
    it('should create a new plan', async () => {
      const createRequest = {
        tenantId: 'tenant-1',
        name: 'New Plan',
        slug: 'new-plan',
        description: 'A new plan',
        tier: PlanTier.BASIC,
        price: { amount: 49, currency: 'USD', interval: BillingInterval.MONTHLY },
        features: [],
        limits: [],
      };

      const mockCreated = {
        id: 'plan-new',
        ...createRequest,
        status: PlanStatus.ACTIVE,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'system',
        updatedBy: 'system',
      };
      mockRepository.create.mockResolvedValue(mockCreated as any);

      const result = await service.createPlan(createRequest);
      expect(result.id).toBe('plan-new');
      expect(mockRepository.create).toHaveBeenCalled();
    });
  });

  describe('updatePlan', () => {
    it('should update an existing plan', async () => {
      const updateRequest = {
        name: 'Updated Plan',
        description: 'Updated description',
      };

      const mockUpdated = {
        id: 'plan-1',
        ...updateRequest,
        status: PlanStatus.ACTIVE,
      };
      mockRepository.update.mockResolvedValue(mockUpdated as any);

      const result = await service.updatePlan('plan-1', updateRequest);
      expect(result.name).toBe('Updated Plan');
    });
  });

  describe('deletePlan', () => {
    it('should delete a plan', async () => {
      mockRepository.delete.mockResolvedValue(true);

      const result = await service.deletePlan('plan-1');
      expect(result).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith('plan-1');
    });
  });

  describe('activatePlan', () => {
    it('should activate a plan', async () => {
      const mockPlan = {
        id: 'plan-1',
        status: PlanStatus.INACTIVE,
      };
      mockRepository.findById.mockResolvedValue(mockPlan as any);
      mockRepository.update.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.ACTIVE,
      } as any);

      const result = await service.activatePlan('plan-1');
      expect(result.status).toBe(PlanStatus.ACTIVE);
    });
  });

  describe('deactivatePlan', () => {
    it('should deactivate a plan', async () => {
      const mockPlan = {
        id: 'plan-1',
        status: PlanStatus.ACTIVE,
      };
      mockRepository.findById.mockResolvedValue(mockPlan as any);
      mockRepository.update.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.INACTIVE,
      } as any);

      const result = await service.deactivatePlan('plan-1');
      expect(result.status).toBe(PlanStatus.INACTIVE);
    });
  });
});