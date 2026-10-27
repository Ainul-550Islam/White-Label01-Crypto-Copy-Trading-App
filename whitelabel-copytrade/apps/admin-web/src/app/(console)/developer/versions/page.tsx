import { ApiVersionPanel } from '@/features/developer/api-version-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
export default async function VersionsPage() {
  return <ApiVersionPanel canManage={hasPermission(await getConsoleClaims(), 'api_key:manage')} />;
}
