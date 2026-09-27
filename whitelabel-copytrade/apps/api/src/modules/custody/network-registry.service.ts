import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NetworkIdentity } from './custody.types';

/**
 * Maintains supported blockchain-network metadata including chainId, network identifier, native asset,
 * explorer information, finality model, provider capabilities, status, and confirmation policy.
 * Network identity must always be explicit.
 */

@Injectable()
export class NetworkRegistryService {
  private readonly logger = new Logger(NetworkRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerNetwork(params: {
    networkId: string;
    chainId?: string | null;
    name: string;
    nativeAssetId?: string | null;
    nativeAssetSymbol?: string | null;
    explorerUrl?: string | null;
    rpcUrl?: string | null;
    finalityModel?: string | null;
    confirmationPolicy?: any;
    status?: string;
    providerCapabilities?: string[];
    metadata?: any;
  }): Promise<any> {
    const { networkId, chainId = null, name, nativeAssetId = null, nativeAssetSymbol = null, explorerUrl = null, rpcUrl = null, finalityModel = null, confirmationPolicy = null, status = 'ACTIVE', providerCapabilities = [], metadata = {} } = params;

    if (!networkId || !name) throw new BadRequestException('networkId and name required');

    // Network identity must always be explicit — reject ambiguous
    if (!networkId.trim()) throw new BadRequestException('networkId must be explicit');

    try {
      const existing = await (this.prisma as any).custodyNetwork.findFirst({ where: { networkId } });
      if (existing) {
        return await (this.prisma as any).custodyNetwork.update({
          where: { id: existing.id },
          data: {
            chainId,
            name,
            nativeAssetId,
            nativeAssetSymbol,
            explorerUrl,
            rpcUrl,
            finalityModel,
            confirmationPolicy,
            status,
            providerCapabilities,
            metadata,
          },
        });
      }
    } catch {}

    const network = await (this.prisma as any).custodyNetwork.create({
      data: {
        networkId,
        chainId,
        name,
        nativeAssetId,
        nativeAssetSymbol,
        explorerUrl,
        rpcUrl,
        finalityModel,
        confirmationPolicy,
        status,
        providerCapabilities,
        metadata,
      },
    });

    this.logger.log({ event: 'custody.network.registered', networkId, chainId, name });

    return network;
  }

  async getNetwork(params: { networkId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).custodyNetwork.findFirst({ where: { networkId: params.networkId } });
    } catch {
      return null;
    }
  }

  async getNetworkByChainId(params: { chainId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).custodyNetwork.findFirst({ where: { chainId: params.chainId } });
    } catch {
      return null;
    }
  }

  async listNetworks(params: { status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { status, page = 1, limit = 100 } = params;
    const where: any = {};
    if (status) where.status = status;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyNetwork.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyNetwork.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async isNetworkSupported(params: { networkId: string }): Promise<boolean> {
    try {
      const network = await (this.prisma as any).custodyNetwork.findFirst({ where: { networkId: params.networkId, status: 'ACTIVE' } });
      return !!network;
    } catch {
      return false;
    }
  }

  async validateNetworkIdentity(identity: NetworkIdentity): Promise<void> {
    if (!identity.networkId) throw new BadRequestException('Network identity must include networkId explicit');
    const supported = await this.isNetworkSupported({ networkId: identity.networkId });
    if (!supported) {
      throw new BadRequestException(`Unsupported network ${identity.networkId} — explicit capability error`);
    }
  }

  async getRequiredConfirmations(params: { networkId: string }): Promise<number> {
    const network = await this.getNetwork({ networkId: params.networkId });
    if (!network) throw new BadRequestException(`Unsupported network ${params.networkId}`);
    const policy = network.confirmationPolicy as any;
    if (policy?.requiredConfirmations) return policy.requiredConfirmations;
    // Default confirmation policy per network — explicit, not invented
    const defaults: Record<string, number> = {
      bitcoin: 3,
      ethereum: 12,
      bsc: 15,
      solana: 32,
      polygon: 128,
      arbitrum: 12,
      base: 12,
      avalanche: 12,
    };
    return defaults[params.networkId] ?? 12;
  }
}
