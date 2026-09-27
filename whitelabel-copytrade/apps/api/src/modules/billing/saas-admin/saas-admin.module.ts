import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { TenantsModule } from '../../tenants/tenants.module';
import { EnforcementModule } from '../enforcement/enforcement.module';
import { PaymentsModule } from '../payments/payments.module';
import { FinanceModule } from '../finance/finance.module';
import { PortalModule } from '../portal/portal.module';
import { BillingNotificationsModule } from '../notifications/notifications.module';

import { SaasAdminService } from './saas-admin.service';
import { SaasAdminController } from './saas-admin.controller';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantPlanManagementService } from './tenant-plan-management.service';
import { TenantFeatureAccessService } from './tenant-feature-access.service';
import { SaasTenantBrandingService } from './tenant-branding.service';
import { CustomDomainService } from './custom-domain.service';
import { CustomDomainVerificationService } from './custom-domain-verification.service';
import { WhiteLabelProvisioningService } from './white-label-provisioning.service';
import { SaasAdminAuditService } from './saas-admin-audit.service';

/**
 * SaaS Admin Control Plane module.
 * Reuses Part1 Plan Catalog, Part2 Enforcement, Part3 Checkout/Payments,
 * Part4 Finance, Part5 Portal.
 * No second billing or entitlement system.
 */
@Module({
  imports: [
    PrismaModule,
    TenantsModule,
    EnforcementModule,
    forwardRef(() => PaymentsModule),
    forwardRef(() => FinanceModule),
    forwardRef(() => PortalModule),
    forwardRef(() => BillingNotificationsModule),
  ],
  controllers: [SaasAdminController],
  providers: [
    SaasAdminService,
    TenantProvisioningService,
    TenantPlanManagementService,
    TenantFeatureAccessService,
    SaasTenantBrandingService,
    CustomDomainService,
    CustomDomainVerificationService,
    WhiteLabelProvisioningService,
    SaasAdminAuditService,
  ],
  exports: [
    SaasAdminService,
    TenantProvisioningService,
    TenantPlanManagementService,
    TenantFeatureAccessService,
    SaasTenantBrandingService,
    CustomDomainService,
    CustomDomainVerificationService,
    WhiteLabelProvisioningService,
    SaasAdminAuditService,
  ],
})
export class SaasAdminModule {}
