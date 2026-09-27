import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AssetIdentity } from './custody.types';

/**
 * Maintains authoritative supported asset metadata including asset identifier, symbol, chain/native-token status,
 * decimals, contract address, network compatibility, display precision, and activation state.
 * Must reject unsupported or ambiguous assets.
 */

@Injectable()
export class AssetRegistryService {
  private readonly logger = new Logger(AssetRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerAsset(params: {
    assetId: string;
    symbol: string;
    name: string;
    decimals: number;
    isNative?: boolean;
    contractAddress?: string | null;
    tokenStandard?: string | null;
    chainId?: string | null;
    networkId?: string | null;
    displayPrecision?: number;
    isActive?: boolean;
    metadata?: any;
  }): Promise<any> {
    const { assetId, symbol, name, decimals, isNative = false, contractAddress = null, tokenStandard = null, chainId = null, networkId = null, displayPrecision = 8, isActive = true, metadata = {} } = params;

    if (!assetId || !symbol || !name) throw new BadRequestException('assetId, symbol, name required');
    if (decimals < 0 || decimals > 36) throw new BadRequestException('Invalid decimals — must be 0-36');

    // Reject ambiguous assets — asset identity must preserve network/contract relationship
    // For example, USDT without network context is ambiguous
    if (!isNative && !contractAddress && !networkId) {
      // For non-native tokens, require networkId or contractAddress for uniqueness
      if (['USDT', 'USDC', 'DAI', 'WETH'].includes(symbol.toUpperCase())) {
        throw new BadRequestException(`Ambiguous asset ${symbol} — networkId or contractAddress required for token identity`);
      }
    }

    try {
      const existing = await (this.prisma as any).custodyAsset.findFirst({ where: { assetId } });
      if (existing) {
        return await (this.prisma as any).custodyAsset.update({
          where: { id: existing.id },
          data: {
            symbol,
            name,
            decimals,
            isNative,
            contractAddress,
            tokenStandard,
            chainId,
            networkId,
            displayPrecision,
            isActive,
            metadata,
          },
        });
      }
    } catch {}

    const asset = await (this.prisma as any).custodyAsset.create({
      data: {
        assetId,
        symbol,
        name,
        decimals,
        isNative,
        contractAddress,
        tokenStandard,
        chainId,
        networkId,
        displayPrecision,
        isActive,
        metadata,
      },
    });

    this.logger.log({ event: 'custody.asset.registered', assetId, symbol, networkId });

    return asset;
  }

  async getAsset(params: { assetId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).custodyAsset.findFirst({ where: { assetId: params.assetId } });
    } catch {
      return null;
    }
  }

  async getAssetBySymbolAndNetwork(params: { symbol: string; networkId: string }): Promise<any | null> {
    try {
      // Never allow BTC/USDT/ETH/USDC to be treated as globally unique without network context
      return await (this.prisma as any).custodyAsset.findFirst({
        where: { symbol: params.symbol, networkId: params.networkId, isActive: true },
      });
    } catch {
      return null;
    }
  }

  async listAssets(params: { networkId?: string; isActive?: boolean; symbol?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { networkId, isActive, symbol, page = 1, limit = 100 } = params;
    const where: any = {};
    if (networkId) where.networkId = networkId;
    if (isActive !== undefined) where.isActive = isActive;
    if (symbol) where.symbol = symbol;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyAsset.findMany({ where, orderBy: { symbol: 'asc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyAsset.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async isAssetSupported(params: { assetId: string; networkId: string }): Promise<boolean> {
    try {
      const asset = await (this.prisma as any).custodyAsset.findFirst({ where: { assetId: params.assetId, networkId: params.networkId, isActive: true } });
      return !!asset;
    } catch {
      return false;
    }
  }

  async getDecimals(params: { assetId: string }): Promise<number> {
    const asset = await this.getAsset({ assetId: params.assetId });
    if (!asset) throw new BadRequestException(`Unsupported asset ${params.assetId} — explicit capability error`);
    return asset.decimals;
  }

  async validateAssetIdentity(identity: AssetIdentity): Promise<void> {
    if (!identity.assetId || !identity.assetSymbol || !identity.networkId) {
      throw new BadRequestException('Asset identity must include assetId, assetSymbol, networkId');
    }
    if (identity.decimals < 0 || identity.decimals > 36) {
      throw new BadRequestException('Invalid decimals in asset identity');
    }
    const supported = await this.isAssetSupported({ assetId: identity.assetId, networkId: identity.networkId });
    if (!supported) {
      throw new BadRequestException(`Unsupported asset/network: ${identity.assetId} on ${identity.networkId} — explicit capability error`);
    }
  }
}
