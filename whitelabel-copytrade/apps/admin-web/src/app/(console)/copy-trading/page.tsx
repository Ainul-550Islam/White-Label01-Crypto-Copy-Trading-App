// # Responsibility: mounts the trader profile editor, strategy lifecycle, verification, featured rankings and budget form.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { CopyTradingConsole } from '@/features/copy-trading/copy-trading-console';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Copy trading' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'strategy:read') ||
    hasPermission(claims, 'strategy:manage') ||
    hasPermission(claims, 'copy_subscription:manage');

  return (
    <>
      <PageHeader
        title="Copy trading"
        description="Trader verification, the strategy lifecycle, featured rankings and your own copy budget. Publishing and archiving move a strategy through the API state machine; archiving has no reverse."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Copy trading requires strategy read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <CopyTradingConsole />
      )}
    </>
  );
}
