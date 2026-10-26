// # Responsibility: verifies effective-date boundaries, tenant override precedence, exact decimal rates and publication step-up.
import 'reflect-metadata';
import { FeeScheduleService } from './fee-schedule.service';
import { AdminFeeScheduleController } from './fee-schedule.controller';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { FeeScheduleVersion } from '@prisma/client';

describe('FeeScheduleService', () => {
  const tenantId='11111111-1111-4111-8111-111111111111';
  const mocks={tenant:{findUnique:jest.fn()},feeScheduleVersion:{findMany:jest.fn(),findFirst:jest.fn(),update:jest.fn(),create:jest.fn()}};
  let service:FeeScheduleService;
  beforeEach(()=>{jest.clearAllMocks();service=new FeeScheduleService(mocks as unknown as PrismaService);mocks.tenant.findUnique.mockResolvedValue({id:tenantId});});
  const row=(values:Record<string,unknown>)=>({id:'v1',tenantId:null,version:1,effectiveFrom:new Date('2026-01-01T00:00:00Z'),effectiveUntil:null,managementFeeRate:'0.012500000000000001',profitShareRate:'0.25',currency:'USD',publishedBy:'operator',publishedAt:new Date(),createdAt:new Date(),...values}) as unknown as FeeScheduleVersion;
  it('uses tenant override ahead of platform default while returning exact decimal strings',async()=>{mocks.feeScheduleVersion.findMany.mockResolvedValue([row({tenantId,version:3,profitShareRate:'0.125000000000000001'}),row({tenantId:null,version:5,profitShareRate:'0.20'})]);const result=await service.effective(tenantId,new Date('2026-02-01T00:00:00Z'));expect(result.source).toBe('tenant_override');expect(result.profitShareRate).toBe('0.125000000000000001');expect(mocks.feeScheduleVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({OR:[{tenantId},{tenantId:null}],effectiveFrom:{lte:new Date('2026-02-01T00:00:00Z')}})}));});
  it('falls back to platform default for an unknown tenant and propagates effective-boundary exclusive end',async()=>{mocks.tenant.findUnique.mockResolvedValue(null);mocks.feeScheduleVersion.findMany.mockResolvedValue([row({tenantId:null})]);const result=await service.getPublicSchedule('unknown-tenant',new Date('2026-01-01T00:00:00Z'));expect(result.source).toBe('platform_default');expect(mocks.feeScheduleVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId:null,AND:[{OR:[{effectiveUntil:null},{effectiveUntil:{gt:new Date('2026-01-01T00:00:00Z')}}]}]})}));});
  it('rejects an absent platform schedule instead of returning zero rates',async()=>{mocks.feeScheduleVersion.findMany.mockResolvedValue([]);await expect(service.effective(null)).rejects.toThrow('No platform fee schedule');});
  it('requires the exact fresh step-up action for publishing',()=>{expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY,AdminFeeScheduleController.prototype.publish)).toBe('FEE_SCHEDULE_PUBLISH');});
});
