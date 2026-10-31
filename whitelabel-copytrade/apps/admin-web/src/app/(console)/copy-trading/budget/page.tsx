// # Responsibility: mounts the tenant copy-budget ceiling editor and the followers at or above their cap.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { CopyBudgetAdminConsole } from '@/features/copy-trading/copy-budget-admin-console';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Copy budget' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API requires copy_subscription:read for the ceiling
  // and copy_subscription:manage for the list and the write, on every call.
  const mayRead = hasPermission(claims, 'copy_subscription:read');

  return (
    <>
      <PageHeader
        title="Copy budget"
        description="The tenant ceiling every follower cap resolves to, and the followers at or above theirs. Changing the ceiling requires a verification for that action and is recorded in the audit trail."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Copy budget requires copy-subscription read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <CopyBudgetAdminConsole />
      )}
    </>
  );
}
