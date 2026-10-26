// # Responsibility: verifies branding contrast, HTTPS asset URLs, tenant isolation, and rejection of raw CSS.
import type { TenantBranding } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { TenantBrandingService } from './tenant-branding.service';
import type { UpdateBrandingDto } from './dto/update-branding.dto';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CacheService } from '../../infrastructure/redis/cache.service';
import type { AuditService } from '../audit/audit.service';

describe('TenantBrandingService tenant isolation and theme validation',()=>{
  const tenantId='11111111-1111-4111-8111-111111111111';
  const sample:TenantBranding={id:'b1',tenantId,appName:'Brand',logoUrl:null,logoDarkUrl:null,faviconUrl:null,primaryColor:'#112233',secondaryColor:'#112233',accentColor:'#112233',backgroundColor:'#FFFFFF',textColor:'#000000',fontFamily:'system-ui',themeMode:'system',supportEmail:null,supportUrl:null,termsUrl:null,privacyUrl:null,customCss:null,socialLinks:{},createdAt:new Date(),updatedAt:new Date()};
  const db={tenantBranding:{findUnique:jest.fn(),update:jest.fn()}};
  const cache={delete:jest.fn()};const audit={record:jest.fn()};
  let service:TenantBrandingService;
  beforeEach(()=>{jest.clearAllMocks();service=new TenantBrandingService(db as unknown as PrismaService,cache as unknown as CacheService,audit as unknown as AuditService);db.tenantBranding.findUnique.mockResolvedValue(sample);db.tenantBranding.update.mockResolvedValue(sample);});
  it('reads only the authenticated tenant primary key',async()=>{await service.get(tenantId);expect(db.tenantBranding.findUnique).toHaveBeenCalledWith({where:{tenantId}});});
  it('writes only to the tenant scope and records the update',async()=>{await service.update(tenantId,{appName:'Updated'} satisfies UpdateBrandingDto,{actorId:'operator',ipHash:'hash',requestId:'req'});expect(db.tenantBranding.update).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId},data:expect.objectContaining({appName:'Updated'})}));expect(audit.record).toHaveBeenCalled();});
  it('rejects approximately 4.49:1 text contrast and accepts at least 4.5:1',async()=>{await expect(service.update(tenantId,{textColor:'#777777'} satisfies UpdateBrandingDto,{actorId:'operator',ipHash:'hash',requestId:'req'})).rejects.toBeInstanceOf(BadRequestException);await expect(service.update(tenantId,{textColor:'#767676'} satisfies UpdateBrandingDto,{actorId:'operator',ipHash:'hash',requestId:'req'})).resolves.toBeDefined();});
  it('rejects non-HTTPS logo URLs',async()=>{await expect(service.update(tenantId,{logoUrl:'http://assets.example/logo.png'} satisfies UpdateBrandingDto,{actorId:'operator',ipHash:'hash',requestId:'req'})).rejects.toBeInstanceOf(BadRequestException);});
  it('rejects raw CSS rather than attempting to sanitize and execute it',async()=>{await expect(service.update(tenantId,{customCss:'body{background:url(https://evil.invalid/x)}'} satisfies UpdateBrandingDto,{actorId:'operator',ipHash:'hash',requestId:'req'})).rejects.toBeInstanceOf(BadRequestException);expect(db.tenantBranding.update).not.toHaveBeenCalled();});
});
