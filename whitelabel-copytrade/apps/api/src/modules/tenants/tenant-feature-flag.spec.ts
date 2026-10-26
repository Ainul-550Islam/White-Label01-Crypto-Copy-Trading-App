// # Responsibility: verifies plan entitlement, step-up for live switches, audit persistence, kill-switch precedence and tenant isolation.
import { ForbiddenException } from '@nestjs/common';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CacheService } from '../../infrastructure/redis/cache.service';
import type { AuditService } from '../audit/audit.service';
import type { PinoLogger } from 'nestjs-pino';

describe('tenant feature-flag isolation and entitlement', () => {
  const tenantId='11111111-1111-4111-8111-111111111111';
  const prisma={featureFlag:{findUnique:jest.fn(),findMany:jest.fn()},tenantFeatureFlag:{findMany:jest.fn(),upsert:jest.fn()},tenantSubscription:{findFirst:jest.fn()}};
  const cache={delete:jest.fn(),remember:jest.fn()};const audit={record:jest.fn()};const logger={info:jest.fn(),error:jest.fn(),warn:jest.fn(),debug:jest.fn()};
  let service:FeatureFlagsService;
  beforeEach(()=>{jest.clearAllMocks();service=new FeatureFlagsService(prisma as unknown as PrismaService,cache as unknown as CacheService,audit as unknown as AuditService,logger as unknown as PinoLogger);});
  it('lists overrides using only the authenticated tenant id',async()=>{prisma.tenantFeatureFlag.findMany.mockResolvedValue([]);await service.listForTenant(tenantId);expect(prisma.tenantFeatureFlag.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId}}));});
  it('refuses enabling a flag absent from the current tenant plan entitlement',async()=>{prisma.tenantSubscription.findFirst.mockResolvedValue({plan:{features:['analytics']}});await expect(service.setForTenant(tenantId,{key:'copy_trading',enabled:true},{actorId:'u',ipHash:'h',requestId:'r'})).rejects.toBeInstanceOf(ForbiddenException);expect(prisma.tenantFeatureFlag.upsert).not.toHaveBeenCalled();});
  it('requires step-up for live toggles, then persists scoped change and audit after entitlement check',async()=>{prisma.tenantSubscription.findFirst.mockResolvedValue({plan:{features:['live_trading']}});prisma.featureFlag.findUnique.mockResolvedValue({id:'flag-id',key:'live_trading'});prisma.tenantFeatureFlag.upsert.mockResolvedValue({id:'o1',tenantId,featureFlagId:'flag-id',enabled:true,rolloutPercentage:null,metadata:{},updatedAt:new Date('2026-01-01T00:00:00Z')});const context={actorId:'operator',ipHash:'hash',requestId:'req'};await expect(service.setForTenant(tenantId,{key:'live_trading',enabled:true},context)).rejects.toBeInstanceOf(ForbiddenException);await service.setForTenant(tenantId,{key:'live_trading',enabled:true},context,true);expect(prisma.tenantFeatureFlag.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId_featureFlagId:{tenantId,featureFlagId:'flag-id'}},create:expect.objectContaining({tenantId,enabled:true})}));expect(cache.delete).toHaveBeenCalled();expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({tenantId,actorId:'operator',action:'FEATURE_FLAG_UPDATED'}));});
  it('preserves platform kill-switch precedence over tenant overrides',async()=>{cache.remember.mockImplementation(async(_key:string,_ttl:number,load:()=>Promise<unknown>)=>load());prisma.featureFlag.findMany.mockResolvedValue([{key:'platform.kill_switch',isGlobalDefault:true},{key:'copy_trading',isGlobalDefault:true}]);prisma.tenantFeatureFlag.findMany.mockResolvedValue([{enabled:true,featureFlag:{key:'copy_trading'}}]);const result=await service.getAllForTenant(tenantId);expect(result['platform.kill_switch']).toBe(true);expect(result.copy_trading).toBe(false);expect(prisma.tenantFeatureFlag.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId}}));});
});
