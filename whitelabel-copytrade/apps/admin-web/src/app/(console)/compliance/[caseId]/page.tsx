// # NEW — Admin route for single compliance case review
import type { JSX } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorNotice, PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  ComplianceCaseDetail,
  type ComplianceCaseRecord,
} from '@/features/compliance/compliance-case-detail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Compliance Case Review' };

export default async function ComplianceCaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}): Promise<JSX.Element> {
  const { caseId } = await params;
  let caseRecord: ComplianceCaseRecord | null = null;
  let errorMsg: string | null = null;

  try {
    caseRecord = await serverFetch<ComplianceCaseRecord>(`/compliance/cases/${caseId}`);
  } catch (err) {
    errorMsg = (err as Error).message || 'Failed to load compliance case';
  }

  return (
    <>
      <div style={{ marginBottom: theme.space(3) }}>
        <Link href="/compliance" style={{ fontSize: 12, color: theme.color.textMuted }}>
          ← Back to Compliance Case Queue
        </Link>
      </div>

      <PageHeader
        title={`Compliance Case Review · ${caseId.slice(0, 12)}`}
        description="Inspect KYC/AML screening matches, transaction monitoring evidence, and record an audited compliance decision."
      />

      {errorMsg && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Could not load compliance case" message={errorMsg} />
        </div>
      )}

      {caseRecord && (
        <div style={{ marginTop: theme.space(5) }}>
          <ComplianceCaseDetail caseRecord={caseRecord} />
        </div>
      )}
    </>
  );
}
