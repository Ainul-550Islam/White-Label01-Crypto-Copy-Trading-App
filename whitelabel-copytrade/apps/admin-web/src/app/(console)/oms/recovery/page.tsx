// # Responsibility: mounts the recovery console over the admin order timeline and recover routes.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { OmsRecoveryPanel } from '@/features/oms/oms-recovery-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Order recovery' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'trading:manage');

  return (
    <>
      <PageHeader
        title="Order recovery"
        description="Moves a stuck order to an explicit terminal state. The API requires a single-use verification for this action and a written reason, so both are collected immediately before the call."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Order recovery requires trading management access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <OmsRecoveryPanel />
      )}
    </>
  );
}
