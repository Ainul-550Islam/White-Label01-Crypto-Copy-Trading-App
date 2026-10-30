// # Responsibility: mounts the breaker and kill-switch lifecycle with the protections and snapshot reads.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { RiskControls } from '@/features/risk/risk-controls';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Risk controls' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'risk:read') ||
    hasPermission(claims, 'risk:config:update');

  return (
    <>
      <PageHeader
        title="Risk controls"
        description="Circuit breakers, kill switches and automatic protections. Acknowledging records that a human saw the protection; clearing it re-enables trading and needs the typed phrase the API requires."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Risk controls require risk read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <RiskControls />
      )}
    </>
  );
}
