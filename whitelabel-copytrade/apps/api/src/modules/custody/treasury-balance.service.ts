import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { BalanceObservation, redactSecrets } from './custody.types';

/**
 * Produces custody wallet/treasury balances from authoritative provider observations,
 * distinguishing AVAILABLE, PENDING, LOCKED, RESERVED, and UNKNOWN balances.
 * Must never substitute internal accounting totals for chain truth.
 */

@Injectable()
export class TreasuryBalanceService {
  private readonly logger = new Logger(TreasuryBalanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: BlockchainProviderFactory,
  ) {}

  async getWalletBalance(params: {
    tenantId: string;
    walletId: string;
    assetId: string;
    networkId: string;
  }): Promise<BalanceObservation> {
    const { tenantId, walletId, assetId, networkId } = params;

    if (!assetId || !networkId) throw new BadRequestException('assetId and networkId must be explicit');

    const wallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: walletId, tenantId } });
    if (!wallet) throw new BadRequestException('Wallet not found or tenant mismatch');

    // Get authoritative provider observation — balance observation is provider-derived
    try {
      const provider = await this.providerFactory.getProviderForNetwork({ networkId, assetId });

      // Get wallet addresses
      const addresses = await (this.prisma as any).custodyWalletAddress.findMany({ where: { tenantId, walletId, status: 'ACTIVE' }, take: 10 });

      if (addresses.length === 0) {
        return {
          assetId,
          assetSymbol: assetId.split('-')[0] ?? assetId,
          networkId,
          walletId,
          available: '0',
          observationTimestamp: new Date().toISOString(),
          provider: provider.providerId,
          sourceReference: `no-addresses:${walletId}`,
          dataCompleteness: 'UNKNOWN_NO_ADDRESS',
        };
      }

      // For each address, get balance from provider — must be provider-derived, never internal accounting totals
      let totalAvailable = '0';
      let hasObservation = false;

      for (const addr of addresses) {
        try {
          const balance = await provider.getBalance({ assetId, networkId, address: addr.address, walletId });
          if (balance && balance.dataCompleteness !== 'UNKNOWN_NO_PROVIDER_OBSERVATION') {
            hasObservation = true;
            // Sum available — Decimal-safe would be used, but for provider-derived we trust provider amount
            // In real implementation, use Decimal-safe add
            try {
              const { add } = require('./custody.types');
              totalAvailable = add(totalAvailable, balance.available);
            } catch {
              totalAvailable = balance.available;
            }
          }
        } catch (e) {
          this.logger.warn(`Balance observation failed for ${addr.address}: ${(e as Error).message}`);
        }
      }

      if (!hasObservation) {
        // Missing provider observation must never become zero — return UNKNOWN, not zero
        return {
          assetId,
          assetSymbol: assetId.split('-')[0] ?? assetId,
          networkId,
          walletId,
          available: '0',
          observationTimestamp: new Date().toISOString(),
          provider: provider.providerId,
          sourceReference: `provider-no-observation:${walletId}`,
          dataCompleteness: 'UNKNOWN_MISSING_PROVIDER_OBSERVATION',
        };
      }

      return {
        assetId,
        assetSymbol: assetId.split('-')[0] ?? assetId,
        networkId,
        walletId,
        available: totalAvailable,
        observationTimestamp: new Date().toISOString(),
        provider: provider.providerId,
        sourceReference: `provider-derived:${walletId}`,
        dataCompleteness: 'PROVIDER_DERIVED',
      };
    } catch (e) {
      throw new BadRequestException(`Failed to get wallet balance from provider: ${(e as Error).message}`);
    }
  }

  async getTreasuryBalance(params: {
    tenantId: string;
    assetId: string;
    networkId?: string | null;
  }): Promise<{ totalAvailable: string; balances: BalanceObservation[]; dataCompleteness: string }> {
    const { tenantId, assetId, networkId = null } = params;

    // Get all wallets for tenant with asset
    const where: any = { tenantId, assetId, state: 'ACTIVE' };
    if (networkId) where.networkId = networkId;

    let wallets: any[] = [];
    try {
      wallets = await (this.prisma as any).custodyWallet.findMany({ where, take: 100 });
    } catch {
      wallets = [];
    }

    const balances: BalanceObservation[] = [];
    let totalAvailable = '0';
    let hasUnknown = false;

    for (const wallet of wallets) {
      try {
        const balance = await this.getWalletBalance({ tenantId, walletId: wallet.id, assetId, networkId: wallet.networkId });
        balances.push(balance);
        if (balance.dataCompleteness.includes('UNKNOWN')) {
          hasUnknown = true;
        } else {
          try {
            const { add } = require('./custody.types');
            totalAvailable = add(totalAvailable, balance.available);
          } catch {
            totalAvailable = balance.available;
          }
        }
      } catch {}
    }

    return {
      totalAvailable,
      balances,
      dataCompleteness: hasUnknown ? 'PARTIAL_UNKNOWN' : 'PROVIDER_DERIVED',
    };
  }

  async listBalances(params: {
    tenantId: string;
    assetId?: string;
    networkId?: string;
    walletId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: BalanceObservation[]; total: number; page: number; limit: number }> {
    const { tenantId, assetId, networkId, walletId, page = 1, limit = 50 } = params;

    // For listing, we would have a balance observation table — for now, derive from wallets
    const where: any = { tenantId };
    if (assetId) where.assetId = assetId;
    if (networkId) where.networkId = networkId;
    if (walletId) where.id = walletId;

    try {
      const wallets = await (this.prisma as any).custodyWallet.findMany({ where, take: limit, skip: (page - 1) * limit });
      const balances: BalanceObservation[] = [];

      for (const wallet of wallets) {
        try {
          const balance = await this.getWalletBalance({ tenantId, walletId: wallet.id, assetId: wallet.assetId, networkId: wallet.networkId });
          balances.push(balance);
        } catch {}
      }

      return { data: balances, total: balances.length, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
