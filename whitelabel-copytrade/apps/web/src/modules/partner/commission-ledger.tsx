// # NEW — Displays trade-level rebate calculations, tier rates, and settlement status
'use client';

import {
  CommissionLedger,
  type CommissionLedgerProps,
} from '../../features/partner/commission-ledger';

export { CommissionLedger, type CommissionLedgerProps };

export function calculateCommissionSummary(
  entries: ReadonlyArray<{ commissionAmount: string; state: string }>,
): { accruedTotal: number; settledTotal: number } {
  let accruedTotal = 0;
  let settledTotal = 0;
  for (const entry of entries) {
    const amount = Number(entry.commissionAmount) || 0;
    if (entry.state === 'ACCRUED' || entry.state === 'APPROVED') {
      accruedTotal += amount;
    } else if (entry.state === 'SETTLED' || entry.state === 'PAID') {
      settledTotal += amount;
    }
  }
  return { accruedTotal, settledTotal };
}

export default CommissionLedger;
