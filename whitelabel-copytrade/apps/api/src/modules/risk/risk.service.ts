// # Enforces available balance, margin requirement, min-notional, step-size, and tick-size checks before order dispatch
import { Injectable } from '@nestjs/common';

const SCALE = 100000000n;

function toScaled(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  const str = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid decimal string: ${str}`);
  }
  const negative = str.startsWith('-');
  const clean = negative ? str.slice(1) : str;
  const [whole, frac = ''] = clean.split('.');
  const padded = (frac + '00000000').slice(0, 8);
  const raw = BigInt(whole || '0') * SCALE + BigInt(padded);
  return negative ? -raw : raw;
}

export interface PreTradeCheckInput {
  quantity: string;
  price?: string | null;
  referencePrice?: string | null;
  availableBalance?: string | null;
  leverage?: string | number | null;
  minQuantity?: string | null;
  maxQuantity?: string | null;
  quantityStep?: string | null;
  tickSize?: string | null;
  minNotional?: string | null;
  reduceOnly?: boolean;
}

export interface PreTradeCheckResult {
  allowed: boolean;
  reasons: string[];
  computedNotional: string;
  requiredMargin: string;
}

@Injectable()
export class RiskService {
  /**
   * GAP-24: Enforces available balance, margin requirement, min-notional,
   * quantity step-size, and price tick-size checks before order dispatch.
   */
  evaluatePreTradeOrderRules(input: PreTradeCheckInput): PreTradeCheckResult {
    const reasons: string[] = [];
    let qtyScaled = 0n;
    try {
      qtyScaled = toScaled(input.quantity);
    } catch {
      return {
        allowed: false,
        reasons: [`Invalid quantity decimal: ${input.quantity}`],
        computedNotional: '0.00000000',
        requiredMargin: '0.00000000',
      };
    }

    if (qtyScaled <= 0n) {
      reasons.push('Order quantity must be greater than zero');
    }

    if (input.minQuantity) {
      const minQty = toScaled(input.minQuantity);
      if (qtyScaled < minQty) {
        reasons.push(`Order quantity ${input.quantity} is below minQuantity ${input.minQuantity}`);
      }
    }

    if (input.maxQuantity) {
      const maxQty = toScaled(input.maxQuantity);
      if (qtyScaled > maxQty) {
        reasons.push(`Order quantity ${input.quantity} exceeds maxQuantity ${input.maxQuantity}`);
      }
    }

    if (input.quantityStep) {
      const step = toScaled(input.quantityStep);
      if (step > 0n && qtyScaled % step !== 0n) {
        reasons.push(
          `Order quantity ${input.quantity} is not a multiple of stepSize ${input.quantityStep}`,
        );
      }
    }

    const effectivePriceStr = input.price ?? input.referencePrice ?? null;
    let priceScaled = 0n;
    if (input.price) {
      try {
        priceScaled = toScaled(input.price);
        if (priceScaled <= 0n) {
          reasons.push('Order price must be greater than zero');
        } else if (input.tickSize) {
          const tick = toScaled(input.tickSize);
          if (tick > 0n && priceScaled % tick !== 0n) {
            reasons.push(`Order price ${input.price} does not conform to tickSize ${input.tickSize}`);
          }
        }
      } catch {
        reasons.push(`Invalid price decimal: ${input.price}`);
      }
    } else if (effectivePriceStr) {
      try {
        priceScaled = toScaled(effectivePriceStr);
      } catch {
        priceScaled = 0n;
      }
    }

    const notionalScaled = priceScaled > 0n ? (qtyScaled * priceScaled) / SCALE : 0n;
    if (input.minNotional && priceScaled > 0n) {
      const minNotionalScaled = toScaled(input.minNotional);
      if (notionalScaled < minNotionalScaled) {
        reasons.push(
          `Order notional ${this.formatScaled(notionalScaled)} is below minNotional ${input.minNotional}`,
        );
      }
    }

    const levScaled = input.leverage ? toScaled(String(input.leverage)) : SCALE;
    const effectiveLev = levScaled > 0n ? levScaled : SCALE;
    const requiredMarginScaled =
      notionalScaled > 0n ? (notionalScaled * SCALE) / effectiveLev : 0n;

    if (!input.reduceOnly && input.availableBalance !== null && input.availableBalance !== undefined && requiredMarginScaled > 0n) {
      const availableScaled = toScaled(input.availableBalance);
      if (availableScaled < requiredMarginScaled) {
        reasons.push(
          `Insufficient available balance ${input.availableBalance} for required margin ${this.formatScaled(requiredMarginScaled)}`,
        );
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      computedNotional: this.formatScaled(notionalScaled),
      requiredMargin: this.formatScaled(requiredMarginScaled),
    };
  }

  private formatScaled(val: bigint): string {
    const negative = val < 0n;
    const abs = negative ? -val : val;
    const whole = abs / SCALE;
    const frac = (abs % SCALE).toString().padStart(8, '0');
    return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
  }
}
