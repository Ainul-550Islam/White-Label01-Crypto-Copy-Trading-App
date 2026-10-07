// # Reconciles deposit/withdrawal requests against provider settlement records
import { FundingReconciliationService } from '../client-lifecycle/funding-reconciliation.service';

export { FundingReconciliationService };

export interface FundingSettlementComparison {
  matched: boolean;
  discrepancyType: 'NONE' | 'SETTLEMENT_MISSING' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH';
  requestedAmount: string;
  settledAmount: string | null;
}

export function compareFundingRequestWithProviderSettlement(params: {
  requestedAmount: string;
  requestedCurrency: string;
  providerSettledAmount?: string | null;
  providerCurrency?: string | null;
}): FundingSettlementComparison {
  if (!params.providerSettledAmount) {
    return {
      matched: false,
      discrepancyType: 'SETTLEMENT_MISSING',
      requestedAmount: params.requestedAmount,
      settledAmount: null,
    };
  }
  if (
    params.providerCurrency &&
    params.providerCurrency.toUpperCase() !== params.requestedCurrency.toUpperCase()
  ) {
    return {
      matched: false,
      discrepancyType: 'CURRENCY_MISMATCH',
      requestedAmount: params.requestedAmount,
      settledAmount: params.providerSettledAmount,
    };
  }
  const reqNum = Number(params.requestedAmount);
  const setNum = Number(params.providerSettledAmount);
  const matched = Number.isFinite(reqNum) && Number.isFinite(setNum) && Math.abs(reqNum - setNum) < 1e-8;
  return {
    matched,
    discrepancyType: matched ? 'NONE' : 'AMOUNT_MISMATCH',
    requestedAmount: params.requestedAmount,
    settledAmount: params.providerSettledAmount,
  };
}

export default FundingReconciliationService;
