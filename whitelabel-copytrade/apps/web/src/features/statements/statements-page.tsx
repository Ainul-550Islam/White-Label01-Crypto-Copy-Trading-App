'use client';
import { useQuery } from '@tanstack/react-query';
import { reportingApi } from '@/api/reporting-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { Money } from '@/components/money';
import { LoadingState } from '@/components/loading-state';
import Link from 'next/link';
export function StatementsPage(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['statements'], queryFn: () => reportingApi.listStatements({ page: 1, limit: 20 }) });
  return (
    <PageContainer title="Statements" description="Historical account statements from persisted backend">
      {isLoading ? <LoadingState /> :
        <div className="space-y-2">
          {(data?.data ?? []).map((s) => (
            <Link key={s.id} href={`/statements/${s.id}`} className="flex items-center justify-between rounded border bg-card p-3 hover:shadow">
              <div><p className="text-sm font-medium">{new Date(s.periodStart).toLocaleDateString()} - {new Date(s.periodEnd).toLocaleDateString()}</p><p className="text-xs text-muted">Type: {s.type} | State: {s.state}</p></div>
              <div className="flex items-center gap-2"><Money value={s.nav} currency={s.currency} /><StatusBadge status={s.state} /></div>
            </Link>
          ))}
        </div>
      }
    </PageContainer>
  );
}
