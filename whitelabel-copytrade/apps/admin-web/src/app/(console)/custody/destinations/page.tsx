// # Responsibility: mounts the read-only withdrawal destination audit view.
import type { JSX } from 'react';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { DestinationReview } from '@/features/custody/destination-review';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export default async function CustodyDestinationsPage(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // `GET admin/custody/destinations` requires payout:manage specifically.
  const mayRead = hasPermission(claims, 'payout:manage');

  return (
    <>
      <PageHeader
        title="Withdrawal destinations"
        description="Where each customer's funds are allowed to go, and how long is left on their security cooldown. This screen is read-only by design: no operator action can activate or remove a destination."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Finance access required"
          message="Reading withdrawal destinations requires the payout management permission. Ask an administrator for access."
        />
      ) : (
        <DestinationReview />
      )}
    </>
  );
}
