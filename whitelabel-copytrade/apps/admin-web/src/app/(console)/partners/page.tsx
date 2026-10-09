// # NEW — Admin console route for partner approval, tier assignment, and payout review
import type { JSX } from 'react';
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  PartnerAdminTable,
  type PartnerAdminRow,
} from '@/features/partners/partner-admin-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Partners & Affiliate Management' };

export default async function AdminPartnersPage(): Promise<JSX.Element> {
  let partners: PartnerAdminRow[] = [];
  let errorMsg: string | null = null;

  try {
    const res = await serverFetch<PartnerAdminRow[] | { items?: PartnerAdminRow[] }>('/partners');
    partners = Array.isArray(res) ? res : (res.items ?? []);
  } catch (err) {
    errorMsg = (err as Error).message || 'Failed to load partner profiles';
  }

  const activeCount = partners.filter((p) => p.state === 'ACTIVE').length;
  const pendingCount = partners.filter(
    (p) => p.state === 'PENDING' || p.state === 'APPLIED' || p.state === 'DRAFT',
  ).length;

  return (
    <>
      <PageHeader
        title="Partner, IB & Affiliate Management Console"
        description="Approve partner applications, manage tiered rebate agreements, audit referral attributions, and review commission payouts."
      />

      {errorMsg && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Could not load partners" message={errorMsg} />
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
        <StatTile label="Total Partners" value={partners.length} hint="IBs, Affiliates & Resellers" />
        <StatTile label="Active Partners" value={activeCount} hint="Eligible for commission accrual" />
        <StatTile label="Pending Review" value={pendingCount} hint="Awaiting agreement approval" />
      </div>

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Partner & Introducing Broker Directory"
          description="Activate or suspend partners and inspect individual attribution and payout ledgers."
        >
          <PartnerAdminTable partners={partners} />
        </Card>
      </div>
    </>
  );
}
