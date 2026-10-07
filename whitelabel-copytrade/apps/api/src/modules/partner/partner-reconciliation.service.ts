// # Reconciles partner commission accruals against fee ledger and payout records
import {
  PartnerReconciliationService,
  type ReconciliationMismatch,
} from '../partners/partner-reconciliation.service';
import { PartnerReconciliationMismatchType } from '../partners/partner.types';

export {
  PartnerReconciliationService,
  PartnerReconciliationMismatchType,
  type ReconciliationMismatch,
};

export interface PartnerCommissionBalanceSummary {
  accruedMinorUnits: bigint;
  settledMinorUnits: bigint;
  paidMinorUnits: bigint;
  inSync: boolean;
}

export function verifyPartnerCommissionBalanceParity(params: {
  accruedMinorUnits: bigint;
  settledMinorUnits: bigint;
  paidMinorUnits: bigint;
}): PartnerCommissionBalanceSummary {
  const inSync =
    params.settledMinorUnits <= params.accruedMinorUnits &&
    params.paidMinorUnits <= params.settledMinorUnits;
  return {
    ...params,
    inSync,
  };
}

export default PartnerReconciliationService;
