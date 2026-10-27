import { ApplicationsPanel } from '@/features/developer/applications-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export default async function ApplicationsPage() {
  const claims = await getConsoleClaims();
  return <ApplicationsPanel canManage={hasPermission(claims, 'api_key:manage')} canApprove={Boolean(claims?.isPlatformUser)} />;
}
