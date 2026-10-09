'use client';
import type { JSX } from 'react';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fundingApi } from '@/api/funding-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { FundingStatus } from './funding-status';
import { TransactionHistory } from './transaction-history';

export function FundingPage(): JSX.Element {
  const { data: accounts } = useQuery({
    queryKey: ['funding', 'accounts'],
    queryFn: () => fundingApi.listAccounts(),
  });
  const accountList = accounts ?? [];

  return (
    <PageContainer
      title="Funding"
      description="Deposits, withdrawals, account funding eligibility, and transaction history"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/funding/deposit" className="rounded bg-primary px-4 py-2 text-sm text-white">
            Deposit
          </Link>
          <Link href="/funding/withdraw" className="rounded border px-4 py-2 text-sm hover:bg-accent">
            Withdraw
          </Link>
          <Link href="/funding/history" className="rounded border px-4 py-2 text-sm hover:bg-accent">
            Full History
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <FundingStatus />

        {accountList.length > 0 && (
          <div className="rounded border bg-card p-4">
            <h2 className="text-sm font-semibold">Funding &amp; Withdrawal Capability by Account</h2>
            <p className="text-xs text-muted">
              Authoritative account states and funding permissions from backend client-lifecycle
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {accountList.map((acc) => (
                <div
                  key={acc.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-xs"
                >
                  <div>
                    <p className="font-medium text-sm">{acc.label}</p>
                    <p className="text-muted">Type: {acc.accountType.replace(/_/g, ' ')}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={acc.state} />
                    <StatusBadge
                      status={acc.isFundingEnabled ? 'DEPOSIT ENABLED' : 'DEPOSIT BLOCKED'}
                      variant={acc.isFundingEnabled ? 'success' : 'warning'}
                    />
                    <StatusBadge
                      status={acc.isWithdrawalEnabled ? 'WITHDRAW ENABLED' : 'WITHDRAW BLOCKED'}
                      variant={acc.isWithdrawalEnabled ? 'success' : 'warning'}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <TransactionHistory />
      </div>
    </PageContainer>
  );
}
