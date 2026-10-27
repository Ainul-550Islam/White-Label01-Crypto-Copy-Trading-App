import { ReconciliationPanel } from '@/features/developer/reconciliation-panel';
import { getConsoleClaims } from '@/lib/console-claims';

export default async function ReconciliationPage() {
  const claims = await getConsoleClaims();
  return <ReconciliationPanel canReconcile={Boolean(claims?.isPlatformUser)} />;
}
