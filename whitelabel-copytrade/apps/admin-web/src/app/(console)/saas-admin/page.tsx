import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/ui';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
import SaasTenantManagementPage from '@/modules/billing/saas-admin/saas-tenant-management';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'SaaS tenants' };

/**
 * Round 7: platform-wide tenant administration (provision, suspend,
 * reactivate, per-tenant subscription state). Only platform operators with
 * platform:manage get anything from /v1/billing/saas-admin/*; a tenant admin
 * would only collect 403s, so the page explains that instead of rendering
 * an empty console. The API remains the actual gate.
 */
export default async function SaasAdminPage(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  if (!claims?.isPlatformUser || !hasPermission(claims, 'platform:manage')) {
    return (
      <div className="p-6">
        <ErrorNotice
          title="Platform operators only"
          message="SaaS tenant administration requires a platform operator account with the platform:manage permission."
        />
      </div>
    );
  }
  return <SaasTenantManagementPage />;
}
