import type { JSX, ReactNode } from 'react';
import { DeveloperAccessDenied } from '@/features/developer/access-denied';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
import { DeveloperI18n } from '@/features/developer/i18n';
import { DeveloperNav } from '@/features/developer/developer-nav';

export const dynamic = 'force-dynamic';

export default async function DeveloperLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  if (!hasPermission(claims, 'api_key:read')) {
    return <DeveloperI18n><DeveloperAccessDenied /></DeveloperI18n>;
  }
  return <DeveloperI18n><DeveloperNav canReconcile={Boolean(claims?.isPlatformUser)} />{children}</DeveloperI18n>;
}
