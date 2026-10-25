// # Responsibility: publish only complete, identity-matched provider balance observations; unavailable or partial balances remain null/UNKNOWN, never measured zero.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { type BlockchainProvider } from './blockchain-provider.interface';
import { type BalanceObservation, add, cmp, isValidDecimal } from './custody.types';

export interface TreasuryBalanceResult {
  totalAvailable: string | null;
  balances: BalanceObservation[];
  dataCompleteness: 'PROVIDER_DERIVED' | 'PARTIAL_UNKNOWN' | 'UNKNOWN_NO_WALLET';
}

@Injectable()
export class TreasuryBalanceService {
  private readonly logger = new Logger(TreasuryBalanceService.name);

  constructor(private readonly prisma: PrismaService, private readonly providerFactory: BlockchainProviderFactory) {}

  async getWalletBalance(params: { tenantId: string; walletId: string; assetId: string; networkId: string }): Promise<BalanceObservation> {
    const { tenantId, walletId, assetId, networkId } = params;
    if (!assetId || !networkId) throw new BadRequestException('assetId and networkId must be explicit');
    const wallet = await this.prisma.custodyWallet.findFirst({ where: { id: walletId, tenantId } });
    if (!wallet || wallet.assetId !== assetId || wallet.networkId !== networkId) {
      throw new BadRequestException('Wallet not found for this tenant and asset/network');
    }
    const asset = await this.prisma.custodyAsset.findFirst({ where: { assetId, isActive: true }, select: { symbol: true } });
    if (!asset) throw new BadRequestException('Authoritative asset identity unavailable');
    const addresses = await this.prisma.custodyWalletAddress.findMany({
      where: { tenantId, walletId, assetId, networkId, status: 'ACTIVE' }, orderBy: { id: 'asc' },
    });
    if (addresses.length === 0) return this.unknown(params, asset.symbol, 'UNAVAILABLE', 'UNKNOWN_NO_ADDRESS');
    let provider: BlockchainProvider;
    try {
      provider = await this.providerFactory.getProviderForNetwork({ networkId, assetId });
      const capabilities = await provider.getCapabilities();
      if (!capabilities.canGetBalance) return this.unknown(params, asset.symbol, provider.providerId, 'UNKNOWN_PROVIDER_CAPABILITY');
    } catch (error) {
      this.logger.warn(`Balance provider unavailable for wallet ${walletId}: ${error instanceof Error ? error.message : String(error)}`);
      return this.unknown(params, asset.symbol, 'UNAVAILABLE', 'UNKNOWN_PROVIDER_UNAVAILABLE');
    }
    const seen = new Set<string>();
    const sourceReferences: string[] = [];
    let available = '0';
    let oldestObservation: string | null = null;
    for (const address of addresses) {
      if (!address.address || seen.has(address.address)) throw new Error('Duplicate or invalid active balance address evidence');
      seen.add(address.address);
      try {
        const observation = await provider.getBalance({ assetId, networkId, address: address.address, walletId });
        const observedAt = new Date(observation.observationTimestamp);
        if (observation.dataCompleteness !== 'PROVIDER_DERIVED' || observation.assetId !== assetId
          || observation.assetSymbol !== asset.symbol || observation.networkId !== networkId || observation.walletId !== walletId
          || observation.provider !== provider.providerId || !observation.sourceReference || !Number.isFinite(observedAt.getTime())
          || typeof observation.available !== 'string' || !isValidDecimal(observation.available) || cmp(observation.available, '0') < 0) {
          return this.unknown(params, asset.symbol, provider.providerId, 'UNKNOWN_INVALID_PROVIDER_OBSERVATION');
        }
        available = add(available, observation.available);
        sourceReferences.push(observation.sourceReference);
        if (oldestObservation === null || observedAt.getTime() < new Date(oldestObservation).getTime()) oldestObservation = observedAt.toISOString();
      } catch (error) {
        this.logger.warn(`Required address observation unavailable for wallet ${walletId}: ${error instanceof Error ? error.message : String(error)}`);
        // One unavailable/malformed address invalidates the aggregate; do not publish the successfully read subset.
        return this.unknown(params, asset.symbol, provider.providerId, 'UNKNOWN_INCOMPLETE_ADDRESS_OBSERVATIONS');
      }
    }
    if (oldestObservation === null) return this.unknown(params, asset.symbol, provider.providerId, 'UNKNOWN_MISSING_PROVIDER_OBSERVATION');
    return { assetId, assetSymbol: asset.symbol, networkId, walletId, available, observationTimestamp: oldestObservation,
      provider: provider.providerId, sourceReference: JSON.stringify(sourceReferences), dataCompleteness: 'PROVIDER_DERIVED' };
  }

  async getTreasuryBalance(params: { tenantId: string; assetId: string; networkId?: string | null }): Promise<TreasuryBalanceResult> {
    const { tenantId, assetId, networkId = null } = params;
    if (!assetId) throw new BadRequestException('Treasury asset must be explicit');
    const where: Prisma.CustodyWalletWhereInput = { tenantId, assetId, state: 'ACTIVE' };
    if (networkId) where.networkId = networkId;
    const wallets = await this.prisma.custodyWallet.findMany({ where, orderBy: { id: 'asc' } });
    if (wallets.length === 0) return { totalAvailable: null, balances: [], dataCompleteness: 'UNKNOWN_NO_WALLET' };
    const balances: BalanceObservation[] = [];
    let totalAvailable = '0';
    let incomplete = false;
    for (const wallet of wallets) {
      let balance: BalanceObservation;
      if (!wallet.networkId) {
        balance = this.unknown({ tenantId, walletId: wallet.id, assetId, networkId: 'UNKNOWN' }, 'UNKNOWN', 'UNAVAILABLE', 'UNKNOWN_WALLET_NETWORK');
      } else {
        try {
          balance = await this.getWalletBalance({ tenantId, walletId: wallet.id, assetId, networkId: wallet.networkId });
        } catch (error) {
          this.logger.warn(`Required treasury wallet unavailable: ${error instanceof Error ? error.message : String(error)}`);
          balance = this.unknown({ tenantId, walletId: wallet.id, assetId, networkId: wallet.networkId }, 'UNKNOWN', 'UNAVAILABLE', 'UNKNOWN_WALLET_OBSERVATION');
        }
      }
      balances.push(balance);
      if (balance.dataCompleteness !== 'PROVIDER_DERIVED' || balance.available === null) incomplete = true;
      else totalAvailable = add(totalAvailable, balance.available);
    }
    return { totalAvailable: incomplete ? null : totalAvailable, balances, dataCompleteness: incomplete ? 'PARTIAL_UNKNOWN' : 'PROVIDER_DERIVED' };
  }

  async listBalances(params: { tenantId: string; assetId?: string; networkId?: string; walletId?: string; page?: number; limit?: number }): Promise<{ data: BalanceObservation[]; total: number; page: number; limit: number }> {
    const { tenantId, assetId, networkId, walletId, page = 1, limit = 50 } = params;
    const where: Prisma.CustodyWalletWhereInput = { tenantId };
    if (assetId) where.assetId = assetId;
    if (networkId) where.networkId = networkId;
    if (walletId) where.id = walletId;
    const [wallets, total] = await Promise.all([
      this.prisma.custodyWallet.findMany({ where, orderBy: { id: 'asc' }, take: limit, skip: (page - 1) * limit }),
      this.prisma.custodyWallet.count({ where }),
    ]);
    const data: BalanceObservation[] = [];
    for (const wallet of wallets) {
      const identity = { tenantId, walletId: wallet.id, assetId: wallet.assetId ?? 'UNKNOWN', networkId: wallet.networkId ?? 'UNKNOWN' };
      if (!wallet.assetId || !wallet.networkId) {
        data.push(this.unknown(identity, 'UNKNOWN', 'UNAVAILABLE', 'UNKNOWN_WALLET_IDENTITY'));
        continue;
      }
      try { data.push(await this.getWalletBalance(identity)); }
      catch (error) {
        this.logger.warn(`Listed wallet observation unavailable: ${error instanceof Error ? error.message : String(error)}`);
        data.push(this.unknown(identity, 'UNKNOWN', 'UNAVAILABLE', 'UNKNOWN_WALLET_OBSERVATION'));
      }
    }
    return { data, total, page, limit };
  }

  private unknown(params: { tenantId: string; walletId: string; assetId: string; networkId: string }, assetSymbol: string, provider: string, reason: string): BalanceObservation {
    return { assetId: params.assetId, assetSymbol, networkId: params.networkId, walletId: params.walletId, available: null,
      observationTimestamp: new Date().toISOString(), provider, sourceReference: `diagnostic:${reason}:${params.walletId}`, dataCompleteness: reason };
  }
}
