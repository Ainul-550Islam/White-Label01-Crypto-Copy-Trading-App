// # Reconciles OMS order/fill state against venue open orders and trades
import { OrderReconciliationService } from './order-reconciliation.service';
import { FillReconciliationService } from './fill-reconciliation.service';
import { PositionReconciliationService } from './position-reconciliation.service';

export {
  OrderReconciliationService,
  OrderReconciliationService as OmsReconciliationService,
  FillReconciliationService,
  PositionReconciliationService,
};

export interface OmsVenueFillComparison {
  inSync: boolean;
  missingFillCount: number;
  quantityDrift: number;
}

export function compareLocalAndVenueFills(params: {
  localFillIds: ReadonlyArray<string>;
  venueFillIds: ReadonlyArray<string>;
  localFilledQty: number;
  venueFilledQty: number;
}): OmsVenueFillComparison {
  const localSet = new Set(params.localFillIds);
  const missing = params.venueFillIds.filter((id) => !localSet.has(id));
  const drift = Math.abs(params.venueFilledQty - params.localFilledQty);
  return {
    inSync: missing.length === 0 && drift < 1e-8,
    missingFillCount: missing.length,
    quantityDrift: drift,
  };
}
