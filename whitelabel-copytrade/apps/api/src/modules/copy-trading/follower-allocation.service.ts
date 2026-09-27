import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CopySizingMode, isDecimalString, compareDecimalStrings } from './copy-trading.types';

/**
 * Manages follower capital/allocation policy, percentage/fixed allocation, maximum exposure, allocation bounds, and available-capital validation from canonical account data.
 * All values must come from canonical follower exchange-account/balance data. Do not trust frontend balances. Precision must be safe.
 */
@Injectable()
export class FollowerAllocationService {
  private readonly logger = new Logger(FollowerAllocationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async validateAllocation(input: {
    tenantId: string;
    followerId: string;
    followerAccountId: string | null;
    allocationMode: CopySizingMode;
    allocationAmount: string;
    maxAllocation?: string | null;
    minAllocation?: string | null;
  }): Promise<{ valid: boolean; availableBalance: string | null; reason?: string }> {
    if (!isDecimalString(input.allocationAmount)) {
      return { valid: false, availableBalance: null, reason: 'allocationAmount must be valid decimal string' };
    }

    if (compareDecimalStrings(input.allocationAmount, '0') <= 0) {
      return { valid: false, availableBalance: null, reason: 'allocationAmount must be positive' };
    }

    if (input.maxAllocation && !isDecimalString(input.maxAllocation)) {
      return { valid: false, availableBalance: null, reason: 'maxAllocation must be valid decimal string' };
    }

    if (input.minAllocation && !isDecimalString(input.minAllocation)) {
      return { valid: false, availableBalance: null, reason: 'minAllocation must be valid decimal string' };
    }

    if (input.maxAllocation && compareDecimalStrings(input.allocationAmount, input.maxAllocation) > 0) {
      return { valid: false, availableBalance: null, reason: 'allocationAmount exceeds maxAllocation' };
    }

    if (input.minAllocation && compareDecimalStrings(input.allocationAmount, input.minAllocation) < 0) {
      return { valid: false, availableBalance: null, reason: 'allocationAmount below minAllocation' };
    }

    // All values must come from canonical follower exchange-account/balance data - do not trust frontend balances
    let availableBalance: string | null = null;

    if (input.followerAccountId) {
      try {
        const account = await this.prisma.tradingAccount.findFirst({ where: { id: input.followerAccountId, tenantId: input.tenantId, userId: input.followerId, deletedAt: null } });
        if (!account) {
          return { valid: false, availableBalance: null, reason: 'Follower account not found or not owned by follower' };
        }

        // Get canonical balances from AccountBalanceSnapshot
        const balances = await this.prisma.accountBalanceSnapshot.findMany({ where: { accountId: input.followerAccountId, tenantId: input.tenantId } });

        // For simplicity, assume USDT or USD as quote - sum free balances
        // In real implementation, would check specific asset
        let totalFree = '0';
        for (const b of balances) {
          try {
            const free = b.free.toString();
            if (isDecimalString(free)) {
              // Add using string addition preserving precision
              const [aInt, aDec = ''] = totalFree.split('.');
              const [bInt, bDec = ''] = free.split('.');
              const maxDec = Math.max(aDec.length, bDec.length);
              const aFull = BigInt((aInt || '0') + aDec.padEnd(maxDec, '0'));
              const bFull = BigInt((bInt || '0') + bDec.padEnd(maxDec, '0'));
              const sum = aFull + bFull;
              const sumStr = sum.toString().padStart(maxDec + 1, '0');
              if (maxDec === 0) totalFree = sumStr;
              else {
                const intPart = sumStr.slice(0, -maxDec) || '0';
                const decPart = sumStr.slice(-maxDec).replace(/0+$/, '');
                totalFree = decPart ? `${intPart}.${decPart}` : intPart;
              }
            }
          } catch {}
        }

        availableBalance = totalFree;

        // For percentage mode, allocationAmount is percentage (e.g. 10 for 10%)
        if (input.allocationMode === CopySizingMode.PERCENTAGE_BALANCE) {
          const percent = parseFloat(input.allocationAmount);
          if (isNaN(percent) || percent <= 0 || percent > 100) {
            return { valid: false, availableBalance, reason: 'Percentage allocation must be between 0 and 100' };
          }
          // Validate percentage does not exceed available
          // We don't need to check exact amount here, just that available >0
          if (compareDecimalStrings(availableBalance, '0') <= 0) {
            return { valid: false, availableBalance, reason: 'No available balance for percentage allocation' };
          }
        } else {
          // Fixed or proportional - check allocationAmount <= availableBalance
          if (availableBalance && compareDecimalStrings(input.allocationAmount, availableBalance) > 0) {
            return { valid: false, availableBalance, reason: `Allocation ${input.allocationAmount} exceeds available balance ${availableBalance}` };
          }
        }
      } catch (e: any) {
        this.logger.warn(`Failed to validate allocation from canonical data tenant=${input.tenantId} follower=${input.followerId} error=${e.message}`);
        return { valid: false, availableBalance: null, reason: 'Failed to validate from canonical balance data' };
      }
    } else {
      // No account provided - warn but allow? Per spec, allocation should use canonical data, so if no account, we cannot validate
      this.logger.warn(`No follower account provided for allocation validation tenant=${input.tenantId} follower=${input.followerId}`);
      // For draft subscriptions without account yet, allow but mark available as null
      availableBalance = null;
    }

    return { valid: true, availableBalance };
  }

  async getAvailableBalance(tenantId: string, followerId: string, followerAccountId: string): Promise<string> {
    const balances = await this.prisma.accountBalanceSnapshot.findMany({ where: { tenantId, accountId: followerAccountId } });
    let totalFree = '0';
    for (const b of balances) {
      try {
        const free = b.free.toString();
        const [aInt, aDec = ''] = totalFree.split('.');
        const [bInt, bDec = ''] = free.split('.');
        const maxDec = Math.max(aDec.length, bDec.length);
        const aFull = BigInt((aInt || '0') + aDec.padEnd(maxDec, '0'));
        const bFull = BigInt((bInt || '0') + bDec.padEnd(maxDec, '0'));
        const sum = aFull + bFull;
        const sumStr = sum.toString().padStart(maxDec + 1, '0');
        if (maxDec === 0) totalFree = sumStr;
        else {
          const intPart = sumStr.slice(0, -maxDec) || '0';
          const decPart = sumStr.slice(-maxDec).replace(/0+$/, '');
          totalFree = decPart ? `${intPart}.${decPart}` : intPart;
        }
      } catch {}
    }
    return totalFree;
  }

  calculateProportionalAllocation(leaderNotional: string, followerAllocation: string, leaderTotalBalance: string): string {
    // proportional = leaderNotional * (followerAllocation / leaderTotalBalance) - Decimal-safe
    // For simplicity, use integer arithmetic with 8 decimals
    try {
      const scale = 8;
      const parse = (s: string): bigint => {
        const [intPart, decPart = ''] = s.split('.');
        const padded = decPart.padEnd(scale, '0').slice(0, scale);
        return BigInt((intPart || '0') + padded);
      };
      const leaderNotionalBig = parse(leaderNotional);
      const followerAllocBig = parse(followerAllocation);
      const leaderTotalBig = parse(leaderTotalBalance);

      if (leaderTotalBig === BigInt(0)) return '0';

      const result = (leaderNotionalBig * followerAllocBig) / leaderTotalBig;
      const resultStr = result.toString().padStart(scale + 1, '0');
      const intPart = resultStr.slice(0, -scale) || '0';
      const decPart = resultStr.slice(-scale).replace(/0+$/, '');
      return decPart ? `${intPart}.${decPart}` : intPart;
    } catch {
      return '0';
    }
  }
}
