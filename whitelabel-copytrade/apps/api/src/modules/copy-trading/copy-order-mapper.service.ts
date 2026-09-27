import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeSymbolService } from '../exchanges/exchange-symbol.service';
import { CopyPolicy, CopySizingMode, isDecimalString, compareDecimalStrings } from './copy-trading.types';

export interface LeaderEvent {
  eventId: string;
  orderId?: string | null;
  fillId?: string | null;
  symbol: string;
  exchangeSymbol: string;
  side: string;
  type: string;
  quantity: string;
  price: string | null;
  stopPrice?: string | null;
  venue: string;
  timestamp: string;
  isSimulated: boolean;
}

export interface FollowerIntent {
  symbol: string;
  exchangeSymbol: string;
  side: string;
  type: string;
  quantity: string;
  price: string | null;
  stopPrice: string | null;
  notional: string | null;
  slippageUpper: string | null;
  slippageLower: string | null;
  isReduceOnly: boolean;
  executionDelayMs: number;
  sizingMode: CopySizingMode;
  source: string;
}

/**
 * Maps validated leader order/fill events into follower execution intents using precision-safe quantity/price/notional calculations and policy adjustments.
 * Use exchange symbol metadata from Part 13. Never produce quantity violating follower exchange precision/limits.
 */
@Injectable()
export class CopyOrderMapperService {
  private readonly logger = new Logger(CopyOrderMapperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly symbolService: ExchangeSymbolService,
  ) {}

  private toDecimalString(value: string | number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      if (!isDecimalString(value)) return null;
      return value.trim();
    }
    return value.toString();
  }

  private multiplyDecimals(a: string, b: string, scale = 12): string {
    try {
      const parse = (s: string): bigint => {
        const [intPart, decPart = ''] = s.split('.');
        const padded = decPart.padEnd(scale, '0').slice(0, scale);
        return BigInt((intPart || '0') + padded);
      };
      const aBig = parse(a);
      const bBig = parse(b);
      const result = (aBig * bBig) / BigInt(10 ** scale);
      const resultStr = result.toString().padStart(scale + 1, '0');
      const intPart = resultStr.slice(0, -scale) || '0';
      const decPart = resultStr.slice(-scale).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return (parseFloat(a) * parseFloat(b)).toString();
    }
  }

  private divideDecimals(a: string, b: string, scale = 12): string {
    try {
      const parse = (s: string): bigint => {
        const [intPart, decPart = ''] = s.split('.');
        const padded = decPart.padEnd(scale, '0').slice(0, scale);
        return BigInt((intPart || '0') + padded);
      };
      const aBig = parse(a);
      const bBig = parse(b);
      if (bBig === BigInt(0)) return '0';
      const result = (aBig * BigInt(10 ** scale)) / bBig;
      const resultStr = result.toString().padStart(scale + 1, '0');
      const intPart = resultStr.slice(0, -scale) || '0';
      const decPart = resultStr.slice(-scale).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return (parseFloat(a) / parseFloat(b)).toString();
    }
  }

  private normalizeQuantityToStep(quantity: string, step: string): string {
    // Floor to nearest step - Decimal-safe
    try {
      const scale = 12;
      const parse = (s: string): bigint => {
        const [intPart, decPart = ''] = s.split('.');
        const padded = decPart.padEnd(scale, '0').slice(0, scale);
        return BigInt((intPart || '0') + padded);
      };
      const qtyBig = parse(quantity);
      const stepBig = parse(step);
      if (stepBig === BigInt(0)) return quantity;
      const normalized = (qtyBig / stepBig) * stepBig;
      const str = normalized.toString().padStart(scale + 1, '0');
      const intPart = str.slice(0, -scale) || '0';
      const decPart = str.slice(-scale).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return quantity;
    }
  }

  private normalizePriceToTick(price: string, tick: string): string {
    try {
      const scale = 12;
      const parse = (s: string): bigint => {
        const [intPart, decPart = ''] = s.split('.');
        const padded = decPart.padEnd(scale, '0').slice(0, scale);
        return BigInt((intPart || '0') + padded);
      };
      const priceBig = parse(price);
      const tickBig = parse(tick);
      if (tickBig === BigInt(0)) return price;
      const normalized = (priceBig / tickBig) * tickBig;
      const str = normalized.toString().padStart(scale + 1, '0');
      const intPart = str.slice(0, -scale) || '0';
      const decPart = str.slice(-scale).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return price;
    }
  }

  async mapLeaderToFollower(input: {
    tenantId: string;
    leaderEvent: LeaderEvent;
    followerAccountId: string | null;
    allocationAmount: string;
    allocationMode: CopySizingMode;
    copyPolicy: CopyPolicy;
    followerBalance?: string | null;
    leaderTotalBalance?: string | null;
  }): Promise<FollowerIntent | null> {
    const leaderQty = this.toDecimalString(input.leaderEvent.quantity);
    if (!leaderQty) {
      this.logger.warn(`Invalid leader quantity tenant=${input.tenantId} event=${input.leaderEvent.eventId}`);
      return null;
    }

    // Check symbol filters
    if (input.copyPolicy.blockedSymbols && input.copyPolicy.blockedSymbols.includes(input.leaderEvent.symbol)) {
      this.logger.log(`Blocked symbol rejected tenant=${input.tenantId} symbol=${input.leaderEvent.symbol}`);
      return null;
    }

    if (input.copyPolicy.allowedSymbols && !input.copyPolicy.allowedSymbols.includes(input.leaderEvent.symbol)) {
      this.logger.log(`Symbol not in allowed list tenant=${input.tenantId} symbol=${input.leaderEvent.symbol}`);
      return null;
    }

    if (input.copyPolicy.allowedSides && !input.copyPolicy.allowedSides.includes(input.leaderEvent.side)) {
      this.logger.log(`Side not allowed tenant=${input.tenantId} side=${input.leaderEvent.side}`);
      return null;
    }

    // Calculate follower quantity based on sizing mode - precision-safe
    let followerQty: string;

    switch (input.allocationMode) {
      case CopySizingMode.FIXED:
        followerQty = input.copyPolicy.fixedQuantity || input.allocationAmount;
        break;

      case CopySizingMode.PERCENTAGE_BALANCE:
        // allocationAmount is percentage, followerBalance is available
        if (!input.followerBalance) {
          this.logger.warn(`Missing follower balance for percentage mode tenant=${input.tenantId}`);
          return null;
        }
        const percent = parseFloat(input.allocationAmount);
        if (isNaN(percent)) return null;
        followerQty = this.multiplyDecimals(input.leaderEvent.quantity, (percent / 100).toString());
        break;

      case CopySizingMode.PROPORTIONAL:
      default:
        // proportional = leaderQty * (followerAllocation / leaderTotalBalance) OR proportionalRatio
        if (input.copyPolicy.proportionalRatio) {
          followerQty = this.multiplyDecimals(leaderQty, input.copyPolicy.proportionalRatio);
        } else if (input.leaderTotalBalance && input.followerBalance) {
          const ratio = this.divideDecimals(input.allocationAmount, input.leaderTotalBalance);
          followerQty = this.multiplyDecimals(leaderQty, ratio);
        } else {
          // Fallback: use allocationAmount as ratio if <1, otherwise fixed
          const allocNum = parseFloat(input.allocationAmount);
          if (allocNum > 0 && allocNum < 1) {
            followerQty = this.multiplyDecimals(leaderQty, input.allocationAmount);
          } else {
            followerQty = leaderQty; // same quantity as leader if no balance info
          }
        }
        break;
    }

    // Max notional enforcement
    if (input.copyPolicy.maxOrderNotional && input.leaderEvent.price) {
      const notional = this.multiplyDecimals(followerQty, input.leaderEvent.price);
      if (compareDecimalStrings(notional, input.copyPolicy.maxOrderNotional) > 0) {
        this.logger.log(`Max notional enforced tenant=${input.tenantId} notional=${notional} max=${input.copyPolicy.maxOrderNotional}`);
        // Reduce quantity to fit max notional
        followerQty = this.divideDecimals(input.copyPolicy.maxOrderNotional, input.leaderEvent.price);
      }
    }

    // Use exchange symbol metadata from Part 13 - never produce quantity violating precision/limits
    let exchangeSymbol = input.leaderEvent.exchangeSymbol;
    let tickSize = '0.00000001';
    let quantityStep = '0.00000001';
    let minQuantity: string | null = null;
    let minNotional: string | null = null;

    try {
      const symbolMeta = await this.symbolService.getSymbol(input.tenantId, input.leaderEvent.symbol);
      if (symbolMeta) {
        exchangeSymbol = symbolMeta.exchangeSymbol;
        tickSize = symbolMeta.tickSize;
        quantityStep = symbolMeta.quantityStep;
        minQuantity = symbolMeta.minQuantity;
        minNotional = symbolMeta.minNotional;
      }
    } catch {}

    // Normalize quantity to step
    followerQty = this.normalizeQuantityToStep(followerQty, quantityStep);

    // Check min quantity
    if (minQuantity && compareDecimalStrings(followerQty, minQuantity) < 0) {
      this.logger.log(`Quantity below minQuantity tenant=${input.tenantId} qty=${followerQty} min=${minQuantity}`);
      return null;
    }

    // Check min notional
    if (minNotional && input.leaderEvent.price) {
      const notional = this.multiplyDecimals(followerQty, input.leaderEvent.price);
      if (compareDecimalStrings(notional, minNotional) < 0) {
        this.logger.log(`Notional below minNotional tenant=${input.tenantId} notional=${notional} min=${minNotional}`);
        return null;
      }
    }

    // Normalize price to tick
    let followerPrice = input.leaderEvent.price;
    if (followerPrice) {
      followerPrice = this.normalizePriceToTick(followerPrice, tickSize);
    }

    let stopPrice = input.leaderEvent.stopPrice || null;
    if (stopPrice) {
      stopPrice = this.normalizePriceToTick(stopPrice, tickSize);
    }

    // Slippage boundaries
    let slippageUpper: string | null = null;
    let slippageLower: string | null = null;

    if (followerPrice && input.copyPolicy.slippageToleranceBps) {
      const slippageRatio = input.copyPolicy.slippageToleranceBps / 10000; // bps to ratio
      const slippageAmount = this.multiplyDecimals(followerPrice, slippageRatio.toString());
      if (input.leaderEvent.side === 'BUY') {
        slippageUpper = this.addDecimals(followerPrice, slippageAmount);
        slippageLower = followerPrice;
      } else {
        slippageUpper = followerPrice;
        slippageLower = this.subtractDecimals(followerPrice, slippageAmount);
      }
    }

    const notional = followerPrice ? this.multiplyDecimals(followerQty, followerPrice) : null;

    return {
      symbol: input.leaderEvent.symbol,
      exchangeSymbol,
      side: input.leaderEvent.side,
      type: input.leaderEvent.type,
      quantity: followerQty,
      price: followerPrice,
      stopPrice,
      notional,
      slippageUpper,
      slippageLower,
      isReduceOnly: input.copyPolicy.reduceOnly || false,
      executionDelayMs: input.copyPolicy.executionDelayMs || 0,
      sizingMode: input.allocationMode,
      source: 'COPY_TRADING',
    };
  }

  private addDecimals(a: string, b: string): string {
    try {
      const scale = 12;
      const parse = (s: string): bigint => {
        const [intPart, decPart = ''] = s.split('.');
        const padded = decPart.padEnd(scale, '0').slice(0, scale);
        return BigInt((intPart || '0') + padded);
      };
      const aBig = parse(a);
      const bBig = parse(b);
      const sum = aBig + bBig;
      const str = sum.toString().padStart(scale + 1, '0');
      const intPart = str.slice(0, -scale) || '0';
      const decPart = str.slice(-scale).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return (parseFloat(a) + parseFloat(b)).toString();
    }
  }

  private subtractDecimals(a: string, b: string): string {
    try {
      const scale = 12;
      const parse = (s: string): bigint => {
        const [intPart, decPart = ''] = s.split('.');
        const padded = decPart.padEnd(scale, '0').slice(0, scale);
        return BigInt((intPart || '0') + padded);
      };
      const aBig = parse(a);
      const bBig = parse(b);
      const diff = aBig - bBig;
      if (diff <= BigInt(0)) return '0';
      const str = diff.toString().padStart(scale + 1, '0');
      const intPart = str.slice(0, -scale) || '0';
      const decPart = str.slice(-scale).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return Math.max(0, parseFloat(a) - parseFloat(b)).toString();
    }
  }
}
