import { PlanComparison } from '@/features/billing/plan-comparison';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <PageContainer title="Pricing" description="Real plans from backend, no hardcoded prices"><PlanComparison /></PageContainer>;
}
