// # Responsibility: mounts the rejection list and its windowed statistics.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { OmsRejections } from '@/features/oms/oms-rejections';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Rejections' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'trading:manage') ||
    hasPermission(claims, 'trading:read') ||
    hasPermission(claims, 'compliance:read');

  return (
    <>
      <PageHeader
        title="Rejections"
        description="Refused orders with the venue own code and message, plus counts for an explicit window. Retriable and permanent causes are distinguished so a retry is not wasted."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Rejections require trading or compliance read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <OmsRejections />
      )}
    </>
  );
}
