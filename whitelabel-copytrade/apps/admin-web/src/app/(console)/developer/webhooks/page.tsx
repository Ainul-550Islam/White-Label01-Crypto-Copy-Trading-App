import { WebhookList } from '@/features/developer/webhook-list';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
export default async function WebhooksPage() {
  return <WebhookList canManage={hasPermission(await getConsoleClaims(), 'api_key:manage')} />;
}
