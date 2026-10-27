import { ApiKeyTable } from '@/features/developer/api-key-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
export default async function DeveloperKeysPage() {
  return <ApiKeyTable canManage={hasPermission(await getConsoleClaims(), 'api_key:manage')} />;
}
