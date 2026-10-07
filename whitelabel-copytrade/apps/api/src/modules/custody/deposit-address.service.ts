// # Generates/retrieves unique deposit addresses per tenant/user/asset/network
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletAddressService } from './wallet-address.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { CustodyAuditService } from './custody-audit.service';
import { deterministicIdempotencyKey } from './custody.types';

/**
 * Creates or assigns deposit addresses for client/institutional accounts using the authoritative
 * custody provider or wallet system. A generated address is never treated as proof of funds received.
 */

@Injectable()
export class DepositAddressService {
  private readonly logger = new Logger(DepositAddressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletAddressService: WalletAddressService,
    private readonly providerFactory: BlockchainProviderFactory,
    private readonly auditService: CustodyAuditService,
  ) {}

  async getOrCreateDepositAddress(params: {
    tenantId: string;
    walletId: string;
    assetId: string;
    networkId: string;
    clientProfileId?: string | null;
    accountId?: string | null;
    operatorId?: string | null;
    correlationId?: string | null;
    label?: string | null;
  }): Promise<any> {
    const { tenantId, walletId, assetId, networkId, clientProfileId = null, accountId = null, operatorId = null, correlationId = null, label = null } = params;

    if (!assetId || !networkId) throw new BadRequestException('assetId and networkId must be explicit');

    // Check if deposit address already exists for this wallet/account/asset/network
    try {
      const existing = await (this.prisma as any).custodyWalletAddress.findFirst({
        where: { tenantId, walletId, assetId, networkId, isDepositAddress: true, status: { in: ['ACTIVE', 'RESERVED'] } },
      });
      if (existing) {
        this.logger.log({ event: 'custody.deposit_address.existing', tenantId, walletId, address: existing.address });
        return existing;
      }
    } catch {}

    // Verify wallet belongs to tenant and is active
    const wallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: walletId, tenantId } });
    if (!wallet) throw new BadRequestException('Wallet not found or tenant mismatch');
    if (wallet.state !== 'ACTIVE') throw new BadRequestException(`Wallet must be ACTIVE to generate deposit address, current: ${wallet.state}`);

    // Use authoritative custody provider or wallet system to generate address
    // Must never invent address — must come from provider
    let generatedAddress: string | null = null;
    let providerReference: string | null = null;

    try {
      const provider = await this.providerFactory.getProviderForNetwork({ networkId, assetId });
      const capabilities = await provider.getCapabilities();
      // Phase 3 fail-closed: only a provider that controls the key material
      // may hand out a deposit address. A locally derived string would look
      // like an address and any funds sent to it would be unrecoverable, so
      // there is no fallback of any kind.
      if (!capabilities.canGenerateAddress || typeof provider.generateDepositAddress !== 'function') {
        throw new BadRequestException(
          `Provider ${provider.providerId} cannot generate deposit addresses for ${assetId} on ${networkId}; configure a custody provider with address generation`,
        );
      }

      const idempotencyKey = deterministicIdempotencyKey({
        type: `deposit-address:${assetId}:${networkId}`,
        tenantId,
        walletId,
        assetId,
        networkId,
        externalRef: `${clientProfileId ?? ''}:${accountId ?? ''}`,
      });

      // Check if address already generated via idempotency
      const existingByKey = await (this.prisma as any).custodyWalletAddress.findFirst({ where: { tenantId, idempotencyKey } });
      if (existingByKey) return existingByKey;

      const generated = await provider.generateDepositAddress({ assetId, networkId, walletId, tenantId, idempotencyKey, label });
      if (!generated || typeof generated.address !== 'string' || generated.address.trim() === '') {
        throw new BadRequestException('Provider did not return a deposit address');
      }
      generatedAddress = generated.address.trim();
      providerReference = generated.providerReference;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`Failed to generate deposit address via provider: ${(e as Error).message}`);
    }

    if (!generatedAddress) throw new BadRequestException('Failed to generate deposit address — provider did not return address');

    // Create address record — A generated address is never treated as proof of funds received
    const addressRecord = await this.walletAddressService.createAddress({
      tenantId,
      walletId,
      assetId,
      networkId,
      address: generatedAddress,
      providerReference,
      creationSource: 'DEPOSIT_ADDRESS_SERVICE',
      label: label ?? `Deposit for ${accountId ?? clientProfileId ?? walletId}`,
      isDepositAddress: true,
      clientProfileId,
      accountId,
      operatorId,
      correlationId,
      metadata: { isDepositAddress: true, generatedAt: new Date().toISOString(), note: 'Generated address is not proof of funds received' },
    });

    await this.auditService.log({
      tenantId,
      walletId,
      action: 'ADDRESS_GENERATED' as any,
      entityType: 'CUSTODY_WALLET_ADDRESS',
      entityId: addressRecord.id,
      actorId: operatorId,
      correlationId,
      evidence: { address: generatedAddress, assetId, networkId, walletId, providerReference, note: 'Address generation is not proof of funds' },
    });

    this.logger.log({ event: 'custody.deposit_address.generated', tenantId, walletId, address: generatedAddress, assetId, networkId });

    return addressRecord;
  }

  async listDepositAddresses(params: {
    tenantId: string;
    walletId?: string;
    accountId?: string;
    clientProfileId?: string;
    assetId?: string;
    networkId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, walletId, accountId, clientProfileId, assetId, networkId, page = 1, limit = 50 } = params;
    const where: any = { tenantId, isDepositAddress: true };
    if (walletId) where.walletId = walletId;
    if (accountId) where.accountId = accountId;
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (assetId) where.assetId = assetId;
    if (networkId) where.networkId = networkId;

    const [data, total] = await Promise.all([
      (this.prisma as any).custodyWalletAddress.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      (this.prisma as any).custodyWalletAddress.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
