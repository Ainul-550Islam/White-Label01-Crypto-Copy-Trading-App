// # Processes fill events, updates average entry price, realized PnL, and fees
import { FillManagementService } from './fill-management.service';

export {
  FillManagementService,
  FillManagementService as FillProcessingService,
};

export interface WeightedFillAccumulator {
  cumulativeQty: number;
  weightedAvgPrice: number;
  cumulativeFee: number;
}

export function accumulateWeightedFills(
  fills: ReadonlyArray<{ quantity: string | number; price: string | number; fee?: string | number }>,
): WeightedFillAccumulator {
  let cumulativeQty = 0;
  let totalNotional = 0;
  let cumulativeFee = 0;
  for (const fill of fills) {
    const q = Number(fill.quantity) || 0;
    const p = Number(fill.price) || 0;
    const f = Number(fill.fee ?? 0) || 0;
    if (q > 0 && p > 0) {
      cumulativeQty += q;
      totalNotional += q * p;
      cumulativeFee += f;
    }
  }
  return {
    cumulativeQty,
    weightedAvgPrice: cumulativeQty > 0 ? totalNotional / cumulativeQty : 0,
    cumulativeFee,
  };
}
