import { WebhookDeliveryTable } from '@/features/developer/webhook-delivery-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
export default async function DeliveriesPage({ params }: { params: Promise<{ endpointId: string }> }) {
  const { endpointId } = await params;
  return <WebhookDeliveryTable endpointId={endpointId} canManage={hasPermission(await getConsoleClaims(), 'api_key:manage')} />;
}
