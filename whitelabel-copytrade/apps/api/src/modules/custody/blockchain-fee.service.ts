import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { FeeObservation } from './custody.types';

/**
 * Obtains verified blockchain fee estimates and actual transaction fees from provider evidence.
 * Must distinguish estimated fee from confirmed actual fee and must never invent a network fee.
 */

@Injectable()
export class BlockchainFeeService {
  private readonly logger = new Logger(BlockchainFeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: BlockchainProviderFactory,
  ) {}

  async estimateFee(params: {
    tenantId: string;
    assetId: string;
    networkId: string;
    fromAddress: string;
    toAddress: string;
    amount: string;
  }): Promise<FeeObservation> {
    const { tenantId, assetId, networkId, fromAddress, toAddress, amount } = params;

    if (!assetId || !networkId) throw new BadRequestException('assetId and networkId must be explicit');

    let provider: any = null;
    try {
      provider = await this.providerFactory.getProviderForNetwork({ networkId, assetId });
    } catch {
      throw new BadRequestException(`No provider for network ${networkId} asset ${assetId} — cannot estimate fee, never invent network fee`);
    }

    try {
      if (provider.estimateFee) {
        const fee = await provider.estimateFee({ assetId, networkId, fromAddress, toAddress, amount });
        // Distinguish estimated fee from confirmed actual fee
        return {
          estimatedFee: fee.estimatedFee ?? null,
          actualFee: null, // actual fee only after confirmation
          feeAsset: fee.feeAsset ?? assetId,
          providerReference: fee.providerReference ?? null,
          isActual: false,
        };
      }
    } catch (e) {
      this.logger.warn(`Fee estimation failed for ${networkId}/${assetId}: ${(e as Error).message}`);
    }

    // If actual fee unavailable, actualFee = UNKNOWN not zero
    return {
      estimatedFee: null,
      actualFee: null,
      feeAsset: assetId,
      isActual: false,
    };
  }

  async getActualFee(params: {
    tenantId: string;
    transactionId: string;
  }): Promise<FeeObservation> {
    const { tenantId, transactionId } = params;

    const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { id: transactionId, tenantId } });
    if (!tx) throw new BadRequestException('Transaction not found');

    // Never use estimated fee as actual settled fee
    if (tx.actualFee) {
      return {
        estimatedFee: tx.estimatedFee ?? null,
        actualFee: tx.actualFee,
        feeAsset: tx.feeAsset ?? tx.assetId,
        providerReference: tx.feeReference ?? tx.providerReference ?? null,
        isActual: true,
      };
    }

    // Try to get actual fee from provider receipt
    if (tx.transactionHash) {
      try {
        const provider = await this.providerFactory.getProviderForNetwork({ networkId: tx.networkId, assetId: tx.assetId });
        if (provider.getTransactionReceipt) {
          const receipt = await provider.getTransactionReceipt({ transactionHash: tx.transactionHash, networkId: tx.networkId });
          if (receipt?.actualFee) {
            // Update transaction with actual fee from provider evidence
            await (this.prisma as any).custodyTransaction.update({
              where: { id: transactionId },
              data: { actualFee: receipt.actualFee, feeReference: receipt.gasUsed ?? null },
            });

            return {
              estimatedFee: tx.estimatedFee ?? null,
              actualFee: receipt.actualFee,
              feeAsset: tx.feeAsset ?? tx.assetId,
              providerReference: receipt.gasUsed ?? null,
              isActual: true,
            };
          }
        }
      } catch {}
    }

    // If actual fee is unavailable: actualFee = UNKNOWN not zero
    return {
      estimatedFee: tx.estimatedFee ?? null,
      actualFee: null, // UNKNOWN, not zero
      feeAsset: tx.feeAsset ?? tx.assetId,
      isActual: false,
    };
  }

  async listFeesForTransaction(params: { tenantId: string; transactionId: string }): Promise<{ estimatedFee: string | null; actualFee: string | null; feeAsset: string | null; isActualKnown: boolean }> {
    const feeObs = await this.getActualFee({ tenantId: params.tenantId, transactionId: params.transactionId });
    return {
      estimatedFee: feeObs.estimatedFee,
      actualFee: feeObs.actualFee,
      feeAsset: feeObs.feeAsset,
      isActualKnown: feeObs.isActual,
    };
  }
}
