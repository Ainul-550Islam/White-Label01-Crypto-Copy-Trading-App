// # Responsibility: mounts the custody overview (treasury balances, reserves, pending settlements, sweeps, provider health).
import type { JSX } from 'react';

import { EmptyState, ErrorNotice, PageHeader } from '@/components/ui';
import { TreasuryOverview } from '@/features/custody/treasury-overview';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

/**
 * Custody is staff-only: the API requires one of platform:manage,
 * payout:manage, tenant:update or compliance:read for every read on this
 * surface. The claims check here decides whether to render the page or an
 * explanation, and the API re-authorises every request behind it - hiding a
 * screen is a usability decision, never the access control.
 */
export const dynamic = 'force-dynamic';

export default async function CustodyPage(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  const mayRead =
    hasPermission(claims, 'payout:manage') ||
    hasPermission(claims, 'platform:manage') ||
    hasPermission(claims, 'tenant:update') ||
    hasPermission(claims, 'compliance:read');

  return (
    <>
      <PageHeader
        title="Custody"
        description="Wallets, treasury balances, reserves and sweeps for this organisation. Balances are provider-reported; an unavailable reading is shown as unavailable, never as zero."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Custody requires operator access"
          message="Your session does not carry a custody oversight permission (payout, platform, tenant administration or compliance). Ask an administrator for access."
        />
      ) : (
        <TreasuryOverview
          operatorId={claims.userId}
          canReadPolicy={hasPermission(claims, 'payout:manage') || hasPermission(claims, 'platform:manage') || hasPermission(claims, 'tenant:update') || hasPermission(claims, 'compliance:read')}
        />
      )}
      {mayRead === false && <EmptyState title="No custody data to show" description="This page renders nothing rather than an empty-looking balance." />}
    </>
  );
}
