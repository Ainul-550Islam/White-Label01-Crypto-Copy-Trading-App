import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorNotice } from '@/components/ui';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
import TenantEntitlementsPanel from '@/modules/billing/entitlements/tenant-entitlements-panel';
import SaasPlanManagementPage from '@/modules/billing/saas-admin/saas-plan-management';
import TenantBrandingDomainPage from '@/modules/billing/saas-admin/tenant-branding-domain';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'SaaS tenant' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Round 7: one tenant's plan / interval changes, branding, custom domains and
 * effective entitlements, for platform operators. The id must be a UUID
 * (the API's ParseUuidPipe would reject anything else with 400 anyway).
 */
export default function SaasTenantDetailPage({ params }: { params: { id: string } }): JSX.Element {
  const claims = getConsoleClaims();
  if (!claims?.isPlatformUser || !hasPermission(claims, 'platform:manage')) {
    return (
      <div className="p-6">
        <ErrorNotice
          title="Platform operators only"
          message="Tenant plan, branding, domain and entitlement management requires a platform operator account with the platform:manage permission."
        />
      </div>
    );
  }

  const tenantId = decodeURIComponent(params.id);
  if (!UUID_PATTERN.test(tenantId)) {
    return (
      <div className="p-6 space-y-4">
        <ErrorNotice title="Unknown tenant" message="The tenant id in the address is not valid." />
        <Link href="/saas-admin" className="text-sm text-blue-600 hover:underline">
          Back to SaaS tenants
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="p-6">
        <Link href="/saas-admin" className="text-sm text-blue-600 hover:underline">
          Back to SaaS tenants
        </Link>
      </div>
      <SaasPlanManagementPage tenantId={tenantId} />
      <TenantBrandingDomainPage tenantId={tenantId} />
      <div className="p-6">
        <TenantEntitlementsPanel tenantId={tenantId} />
      </div>
    </div>
  );
}
