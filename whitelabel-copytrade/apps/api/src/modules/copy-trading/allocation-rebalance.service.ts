// # Responsibility: builds an exact-decimal allocation preview without submitting, routing, or approving orders.

import { Injectable } from '@nestjs/common';
import { DECIMAL_FACTOR, formatDecimalString, parseDecimalString } from '../../common/decimal-string';

export interface RebalanceAllocation {
  traderId: string;
  currentValue: string;
  targetWeightBps: number;
  priceAvailable: boolean;
}

export interface RebalancePreviewLine {
  traderId: string;
  currentValue: string;
  targetValue: string | null;
  deltaValue: string | null;
  targetWeightBps: number;
  status: 'PREVIEW' | 'UNAVAILABLE';
}

/**
 * Target weights are integer basis points (four decimal places of a ratio). Inputs
 * support twelve decimal places, so every weighted target is exactly representable
 * at sixteen decimal places. Output is preview-only: a downstream order flow must
 * independently revalidate identity, authorization, fresh venue prices, budget,
 * reconciliation, live-trading readiness, and risk/kill-switch gates.
 */
@Injectable()
export class AllocationRebalanceService {
  private readonly outputScale = 16;
  private readonly outputFactor = 10n ** BigInt(this.outputScale);
  private readonly inputToOutputScale = this.outputFactor / DECIMAL_FACTOR;

  private formatOutput(value: bigint): string {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const integer = absolute / this.outputFactor;
    const fraction = (absolute % this.outputFactor).toString().padStart(this.outputScale, '0');
    const untrimmed = `${integer.toString()}.${fraction}`;
    const trimmed = untrimmed.replace(/0+$/, '').replace(/\.$/, '');
    return `${negative && absolute !== 0n ? '-' : ''}${trimmed}`;
  }

  preview(input: {
    totalValue: string;
    allocations: readonly RebalanceAllocation[];
  }): { totalValue: string; lines: RebalancePreviewLine[]; executable: false; reason: string } {
    const total = parseDecimalString(input.totalValue);
    if (total <= 0n) throw new RangeError('Portfolio value must be greater than zero');
    if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
      throw new RangeError('At least one allocation is required');
    }

    const ids = new Set<string>();
    let weightTotal = 0;
    for (const allocation of input.allocations) {
      if (!allocation.traderId || ids.has(allocation.traderId)) {
        throw new TypeError('Trader allocation ids must be non-empty and unique');
      }
      ids.add(allocation.traderId);
      if (!Number.isInteger(allocation.targetWeightBps) || allocation.targetWeightBps < 0 || allocation.targetWeightBps > 10_000) {
        throw new RangeError('Target allocation must be an integer from 0 through 10000 basis points');
      }
      if (typeof allocation.priceAvailable !== 'boolean') {
        throw new TypeError('Price availability must be an explicit boolean');
      }
      if (parseDecimalString(allocation.currentValue) < 0n) {
        throw new RangeError('Current allocation cannot be negative');
      }
      weightTotal += allocation.targetWeightBps;
    }
    if (weightTotal !== 10_000) {
      throw new RangeError('Target weights must sum to exactly 10000 basis points');
    }

    const lines = input.allocations.map((allocation) => {
      const current = parseDecimalString(allocation.currentValue);
      if (!allocation.priceAvailable) {
        return {
          traderId: allocation.traderId,
          currentValue: formatDecimalString(current, 12),
          targetValue: null,
          deltaValue: null,
          targetWeightBps: allocation.targetWeightBps,
          status: 'UNAVAILABLE' as const,
        };
      }

      // `total` is scaled by 10^12; multiplying by basis points gives a value
      // scaled by 10^16, exactly representing division by 10,000 without floats.
      const targetAtOutputScale = total * BigInt(allocation.targetWeightBps);
      const currentAtOutputScale = current * this.inputToOutputScale;
      return {
        traderId: allocation.traderId,
        currentValue: formatDecimalString(current, 12),
        targetValue: this.formatOutput(targetAtOutputScale),
        deltaValue: this.formatOutput(targetAtOutputScale - currentAtOutputScale),
        targetWeightBps: allocation.targetWeightBps,
        status: 'PREVIEW' as const,
      };
    });

    return {
      totalValue: formatDecimalString(total, 12),
      lines,
      executable: false,
      reason: 'Preview only; no order or transfer has been created.',
    };
  }
}
