// # NEW — Admin detail route for partner attribution and commission audit
import type { JSX } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Partner Attribution & Commission Audit' };

interface PartnerDetailDto {
  id: string;
  code: string;
  name: string;
  legalName: string;
  type: string;
  state: string;
  contactEmail: string;
  currency: string;
  createdAt: string;
}

interface PartnerCommissionDto {
  id: string;
  tenantId: string;
  sourceEventType: string;
  grossRevenue: string;
  commissionAmount: string;
  currency: string;
  state: string;
  createdAt: string;
}

interface PartnerPayoutDto {
  id: string;
  settlementId: string;
  amount: string;
  currency: string;
  method: string;
  state: string;
  createdAt: string;
}

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: Promise<{ partnerId: string }>;
}): Promise<JSX.Element> {
  const { partnerId } = await params;
  const failures: string[] = [];
  const track = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      return null;
    }
  };

  const [partner, commissionsRes, payoutsRes] = await Promise.all([
    track('partner profile', serverFetch<PartnerDetailDto>(`/partners/${partnerId}`)),
    track('commissions', serverFetch<PartnerCommissionDto[]>(`/partners/${partnerId}/commissions`)),
    track('payouts', serverFetch<PartnerPayoutDto[]>(`/partners/${partnerId}/payouts`)),
  ]);

  const commissions = Array.isArray(commissionsRes) ? commissionsRes : [];
  const payouts = Array.isArray(payoutsRes) ? payoutsRes : [];

  return (
    <>
      <div style={{ marginBottom: theme.space(3) }}>
        <Link href="/partners" style={{ fontSize: 12, color: theme.color.textMuted }}>
          ← Back to Partners Directory
        </Link>
      </div>

      <PageHeader
        title={`Partner Audit · ${partner?.name ?? partnerId}`}
        description="Inspect partner referral attributions, commission accruals, and payout settlement state."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Partner detail partially degraded" message={failures.join(' · ')} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(5),
        }}
      >
        <StatTile label="Partner State" value={partner?.state ?? 'UNKNOWN'} hint={partner?.type ?? '—'} />
        <StatTile
          label="Commission Entries"
          value={commissions.length}
          hint="Trade & fee rebate accruals"
        />
        <StatTile label="Payout Requests" value={payouts.length} hint="Disbursement records" />
      </div>

      <div style={{ marginTop: theme.space(6), display: 'grid', gap: theme.space(5) }}>
        <Card title="Commission Accrual Audit" description="Partner commission ledger entries.">
          <DataTable
            rows={commissions}
            rowKey={(r) => r.id}
            emptyTitle="No commission entries"
            emptyDescription="Zero commissions accrued for this partner."
            columns={[
              { key: 'id', header: 'ID', render: (r) => <code>{r.id.slice(0, 10)}</code> },
              { key: 'tenant', header: 'Tenant', render: (r) => <code>{r.tenantId}</code> },
              { key: 'event', header: 'Source Event', render: (r) => r.sourceEventType },
              {
                key: 'gross',
                header: 'Gross Revenue',
                render: (r) => `${r.grossRevenue} ${r.currency}`,
              },
              {
                key: 'commission',
                header: 'Commission',
                render: (r) => `${r.commissionAmount} ${r.currency}`,
              },
              { key: 'state', header: 'State', render: (r) => <Badge tone="info">{r.state}</Badge> },
              { key: 'created', header: 'Created', render: (r) => formatDateTime(r.createdAt) },
            ]}
          />
        </Card>

        <Card title="Payout Disbursement Audit" description="Partner payout requests and settlements.">
          <DataTable
            rows={payouts}
            rowKey={(r) => r.id}
            emptyTitle="No payout records"
            emptyDescription="Zero payout requests submitted by this partner."
            columns={[
              { key: 'id', header: 'Payout ID', render: (r) => <code>{r.id.slice(0, 10)}</code> },
              {
                key: 'settlement',
                header: 'Settlement',
                render: (r) => <code>{r.settlementId}</code>,
              },
              { key: 'amount', header: 'Amount', render: (r) => `${r.amount} ${r.currency}` },
              { key: 'method', header: 'Method', render: (r) => r.method },
              { key: 'state', header: 'State', render: (r) => <Badge tone="info">{r.state}</Badge> },
              { key: 'created', header: 'Requested', render: (r) => formatDateTime(r.createdAt) },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
