// # Responsibility: mounts the profit-share statement console — generation from posted ledger entries, the ledger-derived lines, and draft finalization behind a verification.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { ProfitShareStatementAdminConsole } from '@/features/billing/profit-share-statement-admin-console';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Profit-share statements' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: both admin routes are `@PlatformOnly()` plus
  // platform:manage plus STATEMENT_REGENERATE. The API re-authorises every call.
  const mayGenerate = claims !== null && claims.isPlatformUser && hasPermission(claims, 'platform:manage');

  return (
    <>
      <PageHeader
        title="Profit-share statements"
        description="Statements are derived only from settled performance-fee accruals and their posted ledger entries. Generation and finalization each require a verification for the action, and finalized amounts are immutable."
      />
      {!mayGenerate || !claims ? (
        <ErrorNotice
          title="Statement generation requires a platform administrator"
          message="Your session does not carry a permission this screen requires. Ask a platform administrator for access."
        />
      ) : (
        <ProfitShareStatementAdminConsole />
      )}
    </>
  );
}
