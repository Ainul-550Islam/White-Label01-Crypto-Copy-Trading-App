'use client';
import { PageContainer } from '@/layout/page-container';
import { FundingStatus } from './funding-status';
import { TransactionHistory } from './transaction-history';
import Link from 'next/link';
export function FundingPage(): JSX.Element {
  return (
    <PageContainer title="Funding" description="Deposits, withdrawals, and transaction history" actions={<div className="flex gap-2"><Link href="/funding/deposit" className="rounded bg-primary px-4 py-2 text-sm text-white">Deposit</Link><Link href="/funding/withdraw" className="rounded border px-4 py-2 text-sm">Withdraw</Link></div>}>
      <div className="space-y-6">
        <FundingStatus />
        <TransactionHistory />
      </div>
    </PageContainer>
  );
}
