// # Responsibility: mounts the fee-schedule console — the schedule in force, its version history and the step-up protected publish form.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { FeeScheduleAdminConsole } from '@/features/billing/fee-schedule-admin-console';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Fee schedule' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: publishing is `@PlatformOnly()` plus
  // platform:manage plus FEE_SCHEDULE_PUBLISH at the API; the read the console
  // makes is the public schedule, which needs no permission at all. So this gate
  // mirrors the WRITE, because that is the only thing on the page that is
  // restricted.
  const mayPublish = claims !== null && claims.isPlatformUser && hasPermission(claims, 'platform:manage');

  return (
    <>
      <PageHeader
        title="Fee schedule"
        description="The effective-dated schedule in force, the ten versions behind it, and the form that publishes the next one. A published version is closed at the next version's start, never edited."
      />
      {!mayPublish || !claims ? (
        <ErrorNotice
          title="Fee schedule publication requires a platform administrator"
          message="Your session does not carry a permission this screen requires. Ask a platform administrator for access."
        />
      ) : (
        <FeeScheduleAdminConsole />
      )}
    </>
  );
}
