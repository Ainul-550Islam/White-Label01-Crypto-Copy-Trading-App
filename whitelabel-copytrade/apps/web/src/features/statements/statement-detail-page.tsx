'use client';
import { useQuery } from '@tanstack/react-query';
import { reportingApi } from '@/api/reporting-api';
import { PageContainer } from '@/layout/page-container';
import { Money } from '@/components/money';
import { LoadingState } from '@/components/loading-state';
import { ReportDownload } from './report-download';
export function StatementDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['statement', id], queryFn: () => reportingApi.getStatement(id) });
  if (isLoading) return <LoadingState />;
  if (!data) return <div className="p-4 text-sm">Statement not found or not owned by current tenant</div>;
  return (
    <PageContainer title={`Statement ${id.slice(0,8)}`} description="Full persisted statement detail">
      <div className="space-y-4">
        <div className="rounded border bg-card p-4"><p className="text-sm">Period: {new Date(data.periodStart).toLocaleDateString()} - {new Date(data.periodEnd).toLocaleDateString()}</p><p className="text-sm">NAV: <Money value={data.nav} currency={data.currency} /> PnL: <Money value={data.pnl} currency={data.currency} showSign /></p></div>
        <div className="rounded border bg-card p-4"><h4 className="font-medium">Holdings</h4><ul className="mt-2 text-xs">{data.holdings.map((h,i) => <li key={i} className="flex justify-between"><span>{h.symbol} {h.quantity}</span><Money value={h.marketValue} /></li>)}</ul></div>
        <ReportDownload statementId={id} />
      </div>
    </PageContainer>
  );
}
