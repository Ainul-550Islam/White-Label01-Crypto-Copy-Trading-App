import { createHash } from 'node:crypto';
import { failClosedMoneyOperation } from '../../common/money-path-failure';
// # Generates/retrieves unique deposit addresses per tenant/user/asset/network
import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletAddressService } from './wallet-address.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { CustodyAuditService } from './custody-audit.service';

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

    // Check the wallet before returning even an existing address. A suspended wallet or an
    // account-specific wallet cannot safely serve a different (or unspecified) owner.
    const wallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: walletId, tenantId } });
    if (!wallet) throw new BadRequestException('Wallet not found or tenant mismatch');
    if (wallet.state !== 'ACTIVE' || wallet.isActive !== true) throw new BadRequestException('Wallet must be active to issue a deposit address');
    if ((wallet.accountId != null && wallet.accountId !== accountId) ||
        (wallet.clientProfileId != null && wallet.clientProfileId !== clientProfileId) ||
        (wallet.assetId != null && wallet.assetId !== assetId) ||
        (wallet.networkId != null && wallet.networkId !== networkId)) {
      throw new BadRequestException('Wallet does not match the requested deposit context');
    }

    // Tenant-wide wallets may serve multiple accounts. Never return the first address for a
    // different account just because its wallet, asset and network happen to match.
    let existing: any;
    try {
      existing = await (this.prisma as any).custodyWalletAddress.findFirst({
        where: { tenantId, walletId, assetId, networkId, clientProfileId, accountId,
          isDepositAddress: true, status: { in: ['ACTIVE', 'RESERVED'] } },
      });
    } catch (caughtErrorB1) { failClosedMoneyOperation(caughtErrorB1, { code: 'CUSTODY_DEPOSIT_ADDRESS_OPERATION_1_FAILED', tenantId, entityId: accountId }); }
    if (existing) {
      this.assertUsableAddress(existing, { tenantId, walletId, assetId, networkId, clientProfileId, accountId });
      this.logger.log({ event: 'custody.deposit_address.existing', tenantId, walletId, address: existing.address });
      return existing;
    }

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

      // Encode the full context without delimiter ambiguity. Unlike a daily key, this is
      // stable across midnight after a lost provider response or application restart.
      const idempotencyKey = createHash('sha256').update(JSON.stringify([
        'deposit-address-v1', tenantId, walletId, assetId, networkId, clientProfileId, accountId,
      ])).digest('hex');

      const generated = await provider.generateDepositAddress({ assetId, networkId, walletId, tenantId, idempotencyKey, label });
      if (!generated || typeof generated.address !== 'string' || generated.address.trim() === '') {
        throw new BadRequestException('Provider did not return a deposit address');
      }
      if (typeof generated.providerReference !== 'string' || generated.providerReference.trim() === '') {
        throw new ServiceUnavailableException('Deposit address provider evidence is unavailable');
      }
      // The address model and customer flow do not carry destination tags/memos. Returning
      // just the address would risk losing funds on networks that require one.
      if (generated.memo != null && (typeof generated.memo !== 'string' || generated.memo.trim() !== '')) {
        throw new ServiceUnavailableException('Deposit addresses requiring a memo are not supported');
      }
      generatedAddress = generated.address.trim();
      providerReference = generated.providerReference.trim();
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException('Deposit address provider is unavailable');
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
      metadata: { isDepositAddress: true, noMemoRequired: true, generatedAt: new Date().toISOString(), note: 'Generated address is not proof of funds received' },
    });

    // createAddress can replay an earlier row; its account and provider evidence must match
    // this exact request. A conflicting replay must never be presented as this owner's address.
    this.assertUsableAddress(addressRecord, { tenantId, walletId, assetId, networkId, clientProfileId, accountId }, generatedAddress, providerReference);

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

  private assertUsableAddress(
    candidate: unknown,
    context: { tenantId: string; walletId: string; assetId: string; networkId: string; clientProfileId: string | null; accountId: string | null },
    expectedAddress?: string,
    expectedProviderReference?: string,
  ): void {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new ServiceUnavailableException('Deposit address evidence is unavailable');
    }
    const row = candidate as Record<string, unknown>;
    const metadata = row.metadata;
    if (row.tenantId !== context.tenantId || row.walletId !== context.walletId ||
        row.assetId !== context.assetId || row.networkId !== context.networkId ||
        row.clientProfileId !== context.clientProfileId || row.accountId !== context.accountId ||
        row.isDepositAddress !== true || row.status !== 'ACTIVE' || row.verified !== true ||
        row.creationSource !== 'DEPOSIT_ADDRESS_SERVICE' ||
        typeof row.address !== 'string' || row.address.trim() === '' ||
        typeof row.providerReference !== 'string' || row.providerReference.trim() === '' ||
        metadata === null || typeof metadata !== 'object' || Array.isArray(metadata) ||
        (metadata as Record<string, unknown>).noMemoRequired !== true ||
        (expectedAddress !== undefined && row.address !== expectedAddress) ||
        (expectedProviderReference !== undefined && row.providerReference !== expectedProviderReference)) {
      throw new ServiceUnavailableException('Deposit address evidence is unavailable');
    }
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
