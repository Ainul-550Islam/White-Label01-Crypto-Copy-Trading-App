// # Responsibility: mounts the caller's own position-limit editor with step-up and stale-write handling.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { PositionLimitForm } from '@/features/risk/position-limit-form';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Position limits' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead = hasPermission(claims, 'risk:read') ||
    hasPermission(claims, 'risk:config:update') ||
    hasPermission(claims, 'portfolio:read');;

  return (
    <>
      <PageHeader
        title="Position limits"
        description="Your own concurrent-position and open-order ceilings. Saving needs a verification, and a concurrent change is refused instead of silently overwritten."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Position limits require risk access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <div className="grid gap-4">
          <PositionLimitForm />
        </div>
      )}
    </>
  );
}
