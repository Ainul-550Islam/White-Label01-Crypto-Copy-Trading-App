import { Global, Module } from '@nestjs/common';

import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantBrandingService } from './tenant-branding.service';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantGuard } from './guards/tenant.guard';

/**
 * Multi-tenancy.
 *
 * Global because the tenant resolver runs in middleware and the tenant guard is
 * registered as a global guard.
 */
@Global()
@Module({
  controllers: [TenantsController],
  providers: [
    TenantsService,
    TenantResolverService,
    TenantBrandingService,
    TenantSettingsService,
    TenantGuard,
  ],
  exports: [TenantsService, TenantResolverService, TenantBrandingService, TenantSettingsService],
})
export class TenantsModule {}
