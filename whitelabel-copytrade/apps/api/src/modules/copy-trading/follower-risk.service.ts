import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CopyRiskDecision, FollowerRiskPolicy, isDecimalString, compareDecimalStrings } from './copy-trading.types';

export interface RiskCheckInput {
  tenantId: string;
  followerId: string;
  subscriptionId: string;
  traderId: string;
  followerAccountId: string | null;
  symbol: string;
  side: string;
  quantity: string;
  price: string | null;
  notional: string | null;
  riskPolicy: FollowerRiskPolicy;
  currentExposure?: string | null;
  dailyLoss?: string | null;
  totalLoss?: string | null;
  currentDrawdown?: string | null;
}

export interface RiskCheckResult {
  decision: CopyRiskDecision;
  allowed: boolean;
  ruleId: string | null;
  reason: string | null;
  reducedQuantity?: string | null;
}

/**
 * Applies follower-specific risk rules: max loss, max drawdown, max exposure, daily limits, stop-copy conditions, concentration, and emergency pause.
 * Risk decision states: ALLOW, REDUCE, BLOCK, PAUSE, STOP_COPY. Every rejection must identify its policy/rule.
 */
@Injectable()
export class FollowerRiskService {
  private readonly logger = new Logger(FollowerRiskService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkRisk(input: RiskCheckInput): Promise<RiskCheckResult> {
    const policy = input.riskPolicy;

    // Emergency stop-copy
    if (policy.emergencyStopCopy) {
      return { decision: CopyRiskDecision.STOP_COPY, allowed: false, ruleId: 'EMERGENCY_STOP_COPY', reason: 'Emergency stop-copy triggered' };
    }

    // Max daily loss - fail closed where required
    if (policy.maxDailyLoss && input.dailyLoss) {
      if (!isDecimalString(policy.maxDailyLoss) || !isDecimalString(input.dailyLoss)) {
        return { decision: CopyRiskDecision.BLOCK, allowed: false, ruleId: 'INVALID_DECIMAL', reason: 'Invalid decimal for loss check - fail closed' };
      }
      if (compareDecimalStrings(input.dailyLoss, policy.maxDailyLoss) >= 0) {
        return { decision: CopyRiskDecision.BLOCK, allowed: false, ruleId: 'MAX_DAILY_LOSS', reason: `Daily loss ${input.dailyLoss} exceeds max ${policy.maxDailyLoss}` };
      }
    }

    // Max total loss
    if (policy.maxTotalLoss && input.totalLoss) {
      if (compareDecimalStrings(input.totalLoss, policy.maxTotalLoss) >= 0) {
        return { decision: CopyRiskDecision.STOP_COPY, allowed: false, ruleId: 'MAX_TOTAL_LOSS', reason: `Total loss ${input.totalLoss} exceeds max ${policy.maxTotalLoss}` };
      }
    }

    // Max drawdown
    if (policy.maxDrawdown && input.currentDrawdown) {
      if (compareDecimalStrings(input.currentDrawdown, policy.maxDrawdown) >= 0) {
        return { decision: CopyRiskDecision.PAUSE, allowed: false, ruleId: 'MAX_DRAWDOWN', reason: `Drawdown ${input.currentDrawdown} exceeds max ${policy.maxDrawdown}` };
      }
    }

    // Max exposure
    if (policy.maxExposure && input.currentExposure) {
      if (compareDecimalStrings(input.currentExposure, policy.maxExposure) >= 0) {
        return { decision: CopyRiskDecision.BLOCK, allowed: false, ruleId: 'MAX_EXPOSURE', reason: `Exposure ${input.currentExposure} exceeds max ${policy.maxExposure}` };
      }
      // Check if new order would exceed exposure
      if (input.notional) {
        const newExposure = this.addDecimals(input.currentExposure, input.notional);
        if (compareDecimalStrings(newExposure, policy.maxExposure) > 0) {
          // Try to reduce quantity
          const allowedNotional = this.subtractDecimals(policy.maxExposure, input.currentExposure);
          if (compareDecimalStrings(allowedNotional, '0') <= 0) {
            return { decision: CopyRiskDecision.BLOCK, allowed: false, ruleId: 'MAX_EXPOSURE', reason: `New exposure ${newExposure} would exceed max ${policy.maxExposure}` };
          }
          // Calculate reduced quantity proportionally
          const reduceRatio = parseFloat(allowedNotional) / parseFloat(input.notional);
          const reducedQty = (parseFloat(input.quantity) * reduceRatio).toString();
          return { decision: CopyRiskDecision.REDUCE, allowed: true, ruleId: 'MAX_EXPOSURE_REDUCE', reason: `Reducing quantity to fit max exposure`, reducedQuantity: reducedQty };
        }
      }
    }

    // Max position size
    if (policy.maxPositionSize) {
      if (compareDecimalStrings(input.quantity, policy.maxPositionSize) > 0) {
        return { decision: CopyRiskDecision.REDUCE, allowed: true, ruleId: 'MAX_POSITION_SIZE', reason: `Quantity ${input.quantity} exceeds max position size ${policy.maxPositionSize}`, reducedQuantity: policy.maxPositionSize };
      }
    }

    // Max symbol exposure
    if (policy.maxSymbolExposure) {
      try {
        const symbolPositions = await this.prisma.position.findMany({ where: { tenantId: input.tenantId, accountId: input.followerAccountId || undefined, symbol: input.symbol } });
        let symbolQty = '0';
        for (const p of symbolPositions) {
          symbolQty = this.addDecimals(symbolQty, p.quantity.toString());
        }
        const newSymbolQty = this.addDecimals(symbolQty, input.quantity);
        if (compareDecimalStrings(newSymbolQty, policy.maxSymbolExposure) > 0) {
          return { decision: CopyRiskDecision.BLOCK, allowed: false, ruleId: 'MAX_SYMBOL_EXPOSURE', reason: `Symbol exposure ${newSymbolQty} exceeds max ${policy.maxSymbolExposure} for ${input.symbol}` };
        }
      } catch {}
    }

    // Maximum copy count
    if (policy.maxCopyCount) {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const copyCount = await (this.prisma as any).copyExecution?.count({ where: { tenantId: input.tenantId, subscriptionId: input.subscriptionId, createdAt: { gte: today } } }) || 0;
        if (copyCount >= policy.maxCopyCount) {
          return { decision: CopyRiskDecision.BLOCK, allowed: false, ruleId: 'MAX_COPY_COUNT', reason: `Daily copy count ${copyCount} exceeds max ${policy.maxCopyCount}` };
        }
      } catch {}
    }

    // Daily pause check
    if (policy.dailyPauseEnabled) {
      try {
        const subscription = await (this.prisma as any).copySubscription?.findFirst({ where: { id: input.subscriptionId, tenantId: input.tenantId } });
        if (subscription && subscription.state === 'PAUSED') {
          return { decision: CopyRiskDecision.PAUSE, allowed: false, ruleId: 'DAILY_PAUSE', reason: 'Subscription is paused' };
        }
      } catch {}
    }

    // Concentration check - e.g. single symbol > 50% of exposure
    if (input.currentExposure && input.notional) {
      const newExposure = this.addDecimals(input.currentExposure, input.notional);
      if (compareDecimalStrings(newExposure, '0') > 0) {
        // Check if this symbol would be > 80% of total exposure
        try {
          const symbolNotional = await this.calculateSymbolNotional(input.tenantId, input.followerAccountId, input.symbol);
          const newSymbolNotional = this.addDecimals(symbolNotional, input.notional);
          const ratio = parseFloat(newSymbolNotional) / parseFloat(newExposure);
          if (ratio > 0.8) {
            return { decision: CopyRiskDecision.BLOCK, allowed: false, ruleId: 'CONCENTRATION', reason: `Symbol ${input.symbol} would be ${(ratio * 100).toFixed(1)}% of exposure - concentration limit` };
          }
        } catch {}
      }
    }

    return { decision: CopyRiskDecision.ALLOW, allowed: true, ruleId: null, reason: null };
  }

  private addDecimals(a: string, b: string): string {
    try {
      const [aInt, aDec = ''] = a.split('.');
      const [bInt, bDec = ''] = b.split('.');
      const maxDec = Math.max(aDec.length, bDec.length);
      const aFull = BigInt((aInt || '0') + aDec.padEnd(maxDec, '0'));
      const bFull = BigInt((bInt || '0') + bDec.padEnd(maxDec, '0'));
      const sum = aFull + bFull;
      const sumStr = sum.toString().padStart(maxDec + 1, '0');
      if (maxDec === 0) return sumStr;
      const intPart = sumStr.slice(0, -maxDec) || '0';
      const decPart = sumStr.slice(-maxDec).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return (parseFloat(a) + parseFloat(b)).toString();
    }
  }

  private subtractDecimals(a: string, b: string): string {
    try {
      const [aInt, aDec = ''] = a.split('.');
      const [bInt, bDec = ''] = b.split('.');
      const maxDec = Math.max(aDec.length, bDec.length);
      const aFull = BigInt((aInt || '0') + aDec.padEnd(maxDec, '0'));
      const bFull = BigInt((bInt || '0') + bDec.padEnd(maxDec, '0'));
      const diff = aFull - bFull;
      if (diff <= BigInt(0)) return '0';
      const diffStr = diff.toString().padStart(maxDec + 1, '0');
      if (maxDec === 0) return diffStr;
      const intPart = diffStr.slice(0, -maxDec) || '0';
      const decPart = diffStr.slice(-maxDec).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return Math.max(0, parseFloat(a) - parseFloat(b)).toString();
    }
  }

  private async calculateSymbolNotional(tenantId: string, accountId: string | null, symbol: string): Promise<string> {
    if (!accountId) return '0';
    try {
      const positions = await this.prisma.position.findMany({ where: { tenantId, accountId, symbol } });
      let total = '0';
      for (const p of positions) {
        const qty = p.quantity.toString();
        const mark = p.markPrice?.toString() || '0';
        if (isDecimalString(qty) && isDecimalString(mark)) {
          const notional = (parseFloat(qty) * parseFloat(mark)).toString();
          total = this.addDecimals(total, notional);
        }
      }
      return total;
    } catch {
      return '0';
    }
  }
}
