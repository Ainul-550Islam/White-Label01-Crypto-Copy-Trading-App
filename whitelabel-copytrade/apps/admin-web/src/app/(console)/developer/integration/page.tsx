// # Responsibility: mounts the integration console - the seven developer-platform calls an integrator makes that support staff need to reproduce.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { DeveloperIntegrationConsole } from '@/features/developer/integration-console';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Integration console' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this console makes, and the integration
  // calls carry the credential the operator supplies rather than the admin session.
  const mayUse = hasPermission(claims, 'api_key:read') || hasPermission(claims, 'api_key:manage');

  return (
    <>
      <PageHeader
        title="Integration console"
        description="Reproduce what an integrator sees: the client descriptor and profile for an environment and API version, an application state transition, a redirect URI registration, an OAuth code exchange or revocation, and a webhook subscription action."
      />
      {!mayUse || !claims ? (
        <ErrorNotice
          title="The integration console requires developer access"
          message="Your session does not carry a developer permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <DeveloperIntegrationConsole />
      )}
    </>
  );
}
