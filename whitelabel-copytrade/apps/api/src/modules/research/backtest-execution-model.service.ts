import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface SimulatedOrder {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  quantity: string;
  price: string | null;
  stopPrice: string | null;
  timestamp: string;
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED';
}

export interface SimulatedFill {
  fillId: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  fee: string;
  timestamp: string;
  isMaker: boolean;
  isSimulated: true;
}

export interface ExecutionModelAssumptions {
  fee: { makerFeeRate: string; takerFeeRate: string };
  slippage: { slippageBps: number; slippageModel: 'FIXED' | 'VOLATILITY' };
  latency: { latencyMs: number };
  execution: { type: 'MARKET' | 'LIMIT'; partialFills: boolean; minQuantity: string | null; tickSize: string | null; quantityStep: string | null; minNotional: string | null };
}

/**
 * Simulates order lifecycle, fills, latency, slippage, partial fills, fees, and execution constraints using configurable deterministic assumptions.
 * Use exchange symbol metadata from Part 13 where applicable. Do not use real exchange placement APIs.
 */
@Injectable()
export class BacktestExecutionModelService {
  private readonly logger = new Logger(BacktestExecutionModelService.name);

  constructor(private readonly prisma: PrismaService) {}

  private isDecimalString(v: string): boolean { return /^-?\d+(\.\d+)?$/.test(v.trim()); }

  private multiply(a: string, b: string, scale=12): string {
    try {
      const parse = (s: string): bigint => {
        const [i,d=''] = s.split('.');
        const padded = d.padEnd(scale,'0').slice(0,scale);
        return BigInt((i||'0')+padded);
      };
      const aBig = parse(a);
      const bBig = parse(b);
      const res = (aBig * bBig) / BigInt(10**scale);
      const str = res.toString().padStart(scale+1,'0');
      const intPart = str.slice(0,-scale) || '0';
      const decPart = str.slice(-scale).replace(/0+$/,'');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch { return (parseFloat(a)*parseFloat(b)).toString(); }
  }

  private normalizeToStep(qty: string, step: string, scale=12): string {
    try {
      const parse = (s: string): bigint => {
        const [i,d=''] = s.split('.');
        const padded = d.padEnd(scale,'0').slice(0,scale);
        return BigInt((i||'0')+padded);
      };
      const q = parse(qty);
      const s = parse(step);
      if (s===BigInt(0)) return qty;
      const norm = (q / s) * s;
      const str = norm.toString().padStart(scale+1,'0');
      const intPart = str.slice(0,-scale) || '0';
      const decPart = str.slice(-scale).replace(/0+$/,'');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch { return qty; }
  }

  private normalizeToTick(price: string, tick: string, scale=12): string {
    return this.normalizeToStep(price, tick, scale);
  }

  async simulateOrderExecution(input: {
    tenantId: string;
    order: SimulatedOrder;
    candle: { open: string; high: string; low: string; close: string; openTime: string; closeTime: string };
    assumptions: ExecutionModelAssumptions;
    symbolMetadata?: { tickSize: string; quantityStep: string; minQuantity: string; minNotional: string } | null;
  }): Promise<{ fill: SimulatedFill | null; rejected: boolean; reason?: string }> {
    const { order, candle, assumptions, symbolMetadata } = input;

    // Check min quantity
    const minQty = assumptions.execution.minQuantity || symbolMetadata?.minQuantity || null;
    if (minQty && parseFloat(order.quantity) < parseFloat(minQty)) {
      return { fill: null, rejected: true, reason: `Quantity ${order.quantity} below min ${minQty}` };
    }

    // Check tick size / quantity step - use exchange symbol metadata from Part 13 where applicable
    let normalizedQty = order.quantity;
    if (symbolMetadata?.quantityStep) normalizedQty = this.normalizeToStep(normalizedQty, symbolMetadata.quantityStep);
    if (assumptions.execution.quantityStep) normalizedQty = this.normalizeToStep(normalizedQty, assumptions.execution.quantityStep);

    let executionPrice: string | null = null;

    if (order.type === 'MARKET') {
      // Market order fills at close with slippage
      const close = parseFloat(candle.close);
      const slippageRatio = assumptions.slippage.slippageBps / 10000;
      const slippageAmount = close * slippageRatio;
      executionPrice = order.side === 'BUY' ? (close + slippageAmount).toString() : (close - slippageAmount).toString();
    } else if (order.type === 'LIMIT') {
      if (!order.price) return { fill: null, rejected: true, reason: 'Limit order requires price' };
      const limitPrice = parseFloat(order.price);
      const high = parseFloat(candle.high);
      const low = parseFloat(candle.low);
      // Check if limit would fill within candle range
      if (order.side === 'BUY' && limitPrice < low) return { fill: null, rejected: false }; // No fill
      if (order.side === 'SELL' && limitPrice > high) return { fill: null, rejected: false }; // No fill
      executionPrice = order.price;
      // Apply slippage for limit? Typically less
      const slippageRatio = (assumptions.slippage.slippageBps / 10000) * 0.5;
      const slippageAmount = parseFloat(executionPrice) * slippageRatio;
      executionPrice = order.side === 'BUY' ? (parseFloat(executionPrice) + slippageAmount).toString() : (parseFloat(executionPrice) - slippageAmount).toString();
    } else {
      return { fill: null, rejected: true, reason: `Order type ${order.type} not supported in backtest execution model` };
    }

    if (symbolMetadata?.tickSize) executionPrice = this.normalizeToTick(executionPrice, symbolMetadata.tickSize);
    if (assumptions.execution.tickSize) executionPrice = this.normalizeToTick(executionPrice, assumptions.execution.tickSize);

    // Check min notional
    const minNotional = assumptions.execution.minNotional || symbolMetadata?.minNotional || null;
    if (minNotional) {
      const notional = parseFloat(normalizedQty) * parseFloat(executionPrice);
      if (notional < parseFloat(minNotional)) return { fill: null, rejected: true, reason: `Notional ${notional} below min ${minNotional}` };
    }

    // Fee calculation - Decimal-safe
    const feeRate = order.type === 'MARKET' ? assumptions.fee.takerFeeRate : assumptions.fee.makerFeeRate;
    const notional = this.multiply(normalizedQty, executionPrice);
    const fee = this.multiply(notional, feeRate);

    const fill: SimulatedFill = {
      fillId: `fill_${order.orderId}_${Date.now()}`,
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      quantity: normalizedQty,
      price: executionPrice,
      fee,
      timestamp: candle.closeTime,
      isMaker: order.type === 'LIMIT',
      isSimulated: true,
    };

    return { fill, rejected: false };
  }

  async getSymbolMetadata(tenantId: string, symbol: string): Promise<{ tickSize: string; quantityStep: string; minQuantity: string; minNotional: string } | null> {
    try {
      const sym = await this.prisma.tradingSymbol.findFirst({ where: { tenantId, symbol } });
      if (!sym) return null;
      return {
        tickSize: sym.priceTick.toString(),
        quantityStep: sym.quantityStep.toString(),
        minQuantity: sym.minQuantity.toString(),
        minNotional: sym.minNotional.toString(),
      };
    } catch { return null; }
  }
}
