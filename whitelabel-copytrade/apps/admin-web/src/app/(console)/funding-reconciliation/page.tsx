// # NEW — Admin console route for funding and custody reconciliation
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  FundingReconciliationTable,
  type CustodyReconciliationFindingRow,
} from '@/modules/funding/funding-reconciliation-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Funding & Custody Reconciliation' };

export default async function FundingReconciliationPage(): Promise<JSX.Element> {
  let findings: CustodyReconciliationFindingRow[] = [];
  let errorMsg: string | null = null;

  try {
    const res = await serverFetch<{
      items?: CustodyReconciliationFindingRow[];
      findings?: CustodyReconciliationFindingRow[];
    }>('/custody/reconciliation/findings', {
      searchParams: { limit: 50 },
    });
    findings = res.items ?? res.findings ?? [];
  } catch (err) {
    errorMsg = (err as Error).message || 'Failed to load custody reconciliation findings';
  }

  const openFindings = findings.filter((f) => !f.resolved);
  const criticalFindings = openFindings.filter(
    (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
  );

  return (
    <>
      <PageHeader
        title="Funding & Custody Reconciliation"
        description="Reconcile internal ledger balances, deposit confirmations, and withdrawal settlements against external custody and payment providers."
      />

      {errorMsg && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Reconciliation query failed" message={errorMsg} />
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
        <StatTile
          label="Open Findings"
          value={openFindings.length}
          hint={`${findings.length} total recorded findings`}
        />
        <StatTile
          label="Critical / High"
          value={criticalFindings.length}
          hint="Requires treasury operator review"
        />
        <StatTile
          label="Resolved Findings"
          value={findings.filter((f) => f.resolved).length}
          hint="Audited resolution records"
        />
      </div>

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Custody & Funding Settlement Discrepancies"
          description="Never rewrites external provider truth; requires explicit operator resolution and audit note."
        >
          <FundingReconciliationTable findings={findings} />
        </Card>
      </div>
    </>
  );
}
