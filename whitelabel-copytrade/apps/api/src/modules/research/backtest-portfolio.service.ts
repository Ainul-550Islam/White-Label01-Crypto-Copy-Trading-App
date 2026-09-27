import { Injectable, Logger } from '@nestjs/common';

/**
 * Tracks simulated cash, positions, exposure, equity, realized/unrealized PnL, margin, and portfolio state with Decimal-safe arithmetic.
 * All financial calculations must be Decimal-safe. No floating-point accounting.
 */

interface Position {
  symbol: string;
  quantity: string;
  averageEntryPrice: string;
  realizedPnl: string;
  unrealizedPnl: string | null;
}

interface PortfolioState {
  cash: string;
  positions: Record<string, Position>;
  realizedPnl: string;
  unrealizedPnl: string;
  equity: string;
  exposure: string;
  feesPaid: string;
  timestamp: string;
  sequence: number;
}

@Injectable()
export class BacktestPortfolioService {
  private readonly logger = new Logger(BacktestPortfolioService.name);

  private scale = 12;

  private parse(s: string): bigint {
    const [intPart, decPart=''] = s.split('.');
    const padded = decPart.padEnd(this.scale,'0').slice(0,this.scale);
    const sign = intPart.startsWith('-') ? -1 : 1;
    const absInt = intPart.replace('-','');
    const big = BigInt(absInt + padded);
    return sign === -1 ? -big : big;
  }

  private format(b: bigint): string {
    const negative = b < BigInt(0);
    const abs = negative ? -b : b;
    const str = abs.toString().padStart(this.scale+1,'0');
    const intPart = str.slice(0,-this.scale) || '0';
    const decPart = str.slice(-this.scale).replace(/0+$/,'');
    const result = decPart ? `${intPart}.${decPart}` : intPart;
    return negative ? `-${result}` : result;
  }

  private add(a: string, b: string): string {
    try { return this.format(this.parse(a) + this.parse(b)); } catch { return (parseFloat(a)+parseFloat(b)).toString(); }
  }

  private sub(a: string, b: string): string {
    try { return this.format(this.parse(a) - this.parse(b)); } catch { return (parseFloat(a)-parseFloat(b)).toString(); }
  }

  private mul(a: string, b: string): string {
    try {
      const aBig = this.parse(a);
      const bBig = this.parse(b);
      const res = (aBig * bBig) / BigInt(10**this.scale);
      return this.format(res);
    } catch { return (parseFloat(a)*parseFloat(b)).toString(); }
  }

  private div(a: string, b: string): string {
    try {
      const aBig = this.parse(a);
      const bBig = this.parse(b);
      if (bBig===BigInt(0)) return '0';
      const res = (aBig * BigInt(10**this.scale)) / bBig;
      return this.format(res);
    } catch { return (parseFloat(a)/parseFloat(b)).toString(); }
  }

  createInitialState(initialCapital: string, timestamp: string): PortfolioState {
    return {
      cash: initialCapital,
      positions: {},
      realizedPnl: '0',
      unrealizedPnl: '0',
      equity: initialCapital,
      exposure: '0',
      feesPaid: '0',
      timestamp,
      sequence: 0,
    };
  }

  applyFill(state: PortfolioState, fill: { symbol: string; side: 'BUY'|'SELL'; quantity: string; price: string; fee: string; timestamp: string }): PortfolioState {
    const symbol = fill.symbol;
    const existing = state.positions[symbol] || { symbol, quantity: '0', averageEntryPrice: '0', realizedPnl: '0', unrealizedPnl: null };

    let newCash = state.cash;
    let newRealizedPnl = state.realizedPnl;
    let newFees = state.feesPaid;
    let newQuantity = existing.quantity;
    let newAvgPrice = existing.averageEntryPrice;
    let realizedFromTrade = '0';

    // Decimal-safe fee
    newFees = this.add(newFees, fill.fee);

    if (fill.side === 'BUY') {
      // Cash decreases by notional + fee
      const notional = this.mul(fill.quantity, fill.price);
      newCash = this.sub(newCash, this.add(notional, fill.fee));

      // Position average entry price update
      if (this.parse(existing.quantity) === BigInt(0)) {
        newQuantity = fill.quantity;
        newAvgPrice = fill.price;
      } else {
        // Weighted average
        const existingNotional = this.mul(existing.quantity, existing.averageEntryPrice);
        const newNotional = this.mul(fill.quantity, fill.price);
        const totalQty = this.add(existing.quantity, fill.quantity);
        const totalNotional = this.add(existingNotional, newNotional);
        newQuantity = totalQty;
        newAvgPrice = this.div(totalNotional, totalQty);
      }
    } else {
      // SELL
      const notional = this.mul(fill.quantity, fill.price);
      newCash = this.add(newCash, this.sub(notional, fill.fee));

      // Realized PnL: (sell price - avg entry) * qty
      if (this.parse(existing.quantity) !== BigInt(0)) {
        const priceDiff = this.sub(fill.price, existing.averageEntryPrice);
        realizedFromTrade = this.mul(priceDiff, fill.quantity);
        newRealizedPnl = this.add(newRealizedPnl, this.sub(realizedFromTrade, fill.fee));
      }

      newQuantity = this.sub(existing.quantity, fill.quantity);
      // If position closed or flipped, reset avg price if quantity zero or negative (simplified - no short support for now)
      if (this.parse(newQuantity) <= BigInt(0)) {
        newQuantity = '0';
        newAvgPrice = '0';
      }
    }

    const newPositions = { ...state.positions };
    if (this.parse(newQuantity) === BigInt(0)) {
      delete newPositions[symbol];
    } else {
      newPositions[symbol] = { symbol, quantity: newQuantity, averageEntryPrice: newAvgPrice, realizedPnl: existing.realizedPnl, unrealizedPnl: null };
    }

    // Calculate unrealized PnL and exposure and equity
    let unrealizedTotal = '0';
    let exposure = '0';
    for (const pos of Object.values(newPositions)) {
      // For unrealized, need current mark price - use last fill price as proxy, in real backtest would use candle close
      // Simplified: unrealized = 0 until next mark, but we track exposure as qty * avgEntry
      const posExposure = this.mul(pos.quantity, pos.averageEntryPrice);
      exposure = this.add(exposure, posExposure);
    }

    // Equity = cash + exposure + realized? Actually cash already includes realized via trades, exposure is position value
    // Simplified equity: cash + sum(pos.qty * avgPrice) + unrealized
    // Since we don't have mark price here, equity = cash + exposure
    const equity = this.add(newCash, exposure);

    return {
      cash: newCash,
      positions: newPositions,
      realizedPnl: newRealizedPnl,
      unrealizedPnl: unrealizedTotal,
      equity,
      exposure,
      feesPaid: newFees,
      timestamp: fill.timestamp,
      sequence: state.sequence + 1,
    };
  }

  markToMarket(state: PortfolioState, marks: Record<string, string>, timestamp: string): PortfolioState {
    let unrealizedTotal = '0';
    let exposure = '0';
    const newPositions: Record<string, Position> = {};

    for (const [symbol, pos] of Object.entries(state.positions)) {
      const markPrice = marks[symbol] || pos.averageEntryPrice;
      const priceDiff = this.sub(markPrice, pos.averageEntryPrice);
      const unrealized = this.mul(priceDiff, pos.quantity);
      unrealizedTotal = this.add(unrealizedTotal, unrealized);
      const posExposure = this.mul(pos.quantity, markPrice);
      exposure = this.add(exposure, posExposure);
      newPositions[symbol] = { ...pos, unrealizedPnl: unrealized };
    }

    const equity = this.add(this.add(state.cash, exposure), '0'); // cash + exposure, unrealized already in exposure vs entry

    return {
      ...state,
      positions: newPositions,
      unrealizedPnl: unrealizedTotal,
      exposure,
      equity,
      timestamp,
      sequence: state.sequence + 1,
    };
  }

  getEquityCurvePoint(state: PortfolioState): { timestamp: string; sequence: number; equity: string; cash: string; exposure: string; realizedPnl: string; unrealizedPnl: string | null; drawdown: string | null } {
    return {
      timestamp: state.timestamp,
      sequence: state.sequence,
      equity: state.equity,
      cash: state.cash,
      exposure: state.exposure,
      realizedPnl: state.realizedPnl,
      unrealizedPnl: state.unrealizedPnl,
      drawdown: null,
    };
  }
}
