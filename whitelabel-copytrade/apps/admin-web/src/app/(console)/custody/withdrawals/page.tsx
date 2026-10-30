// # Responsibility: mounts the withdrawal queue with the policy evaluation and the confirmed submission control.
import type { JSX } from 'react';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { WithdrawalQueue } from '@/features/custody/withdrawal-queue';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export default async function CustodyWithdrawalsPage(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  const mayRead =
    hasPermission(claims, 'payout:manage') ||
    hasPermission(claims, 'platform:manage') ||
    hasPermission(claims, 'tenant:update') ||
    hasPermission(claims, 'compliance:read');

  return (
    <>
      <PageHeader
        title="Withdrawals"
        description="Outbound custody movements, the policy verdict for a proposed withdrawal, and submission of a reviewed withdrawal to the chain adapter. Submission is one-way and carries an idempotency key."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Custody requires operator access"
          message="Your session does not carry a custody oversight permission. Ask an administrator for access."
        />
      ) : (
        <WithdrawalQueue operatorId={claims.userId} />
      )}
    </>
  );
}
