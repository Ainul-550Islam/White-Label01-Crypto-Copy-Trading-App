// # Responsibility: enforce exact registered wallet capability/ownership and conditional lifecycle writes; public views exclude credential references and redact metadata.
import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { type CustodyWallet } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletRepository, assertSafeWalletMetadata } from './wallet.repository';
import { CustodyPolicyService } from './custody-policy.service';
import { AssetRegistryService } from './asset-registry.service';
import { NetworkRegistryService } from './network-registry.service';
import { CustodyAuditService } from './custody-audit.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { WALLET_VALID_TRANSITIONS, CustodyAuditAction, CustodyWalletState, redactSecrets } from './custody.types';

export type CustodyWalletView = Omit<CustodyWallet, 'encryptedSecretReference' | 'credentialFingerprint' | 'providerMetadata' | 'metadata'> & { metadata: unknown };

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletRepo: WalletRepository,
    private readonly custodyPolicyService: CustodyPolicyService,
    private readonly assetRegistry: AssetRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly auditService: CustodyAuditService,
    private readonly providerFactory: BlockchainProviderFactory,
  ) {}

  async createWallet(params: {
    tenantId: string; clientProfileId?: string | null; accountId?: string | null; walletType?: string; scope?: string;
    assetId: string; networkId: string; provider?: string | null; ownerId?: string | null; ownerType?: string | null;
    operatorId?: string | null; correlationId?: string | null; metadata?: unknown;
  }): Promise<CustodyWalletView> {
    const { tenantId, clientProfileId = null, accountId = null, walletType = 'HOT', scope = 'TENANT', assetId, networkId,
      provider = null, ownerId = null, ownerType = null, operatorId = null, correlationId = null, metadata = {} } = params;
    assertSafeWalletMetadata(metadata);
    await this.assertSupported(tenantId, assetId, networkId);
    if (accountId) {
      const account = await this.prisma.institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!account || (clientProfileId && account.clientProfileId !== clientProfileId)) {
        throw new BadRequestException('Institutional account not found or client/tenant mismatch');
      }
    }
    if (clientProfileId) {
      const profile = await this.prisma.clientProfile.findFirst({ where: { id: clientProfileId, tenantId } });
      if (!profile) throw new BadRequestException('Client profile not found or tenant mismatch');
    }
    const wallet = await this.walletRepo.createWallet({ tenantId, clientProfileId, accountId, walletType, scope, assetId, networkId,
      provider, ownerId, ownerType, metadata: redactSecrets(metadata) });
    const audit: unknown = await this.auditService.log({ tenantId, walletId: wallet.id, action: CustodyAuditAction.WALLET_CREATED,
      entityType: 'CUSTODY_WALLET', entityId: wallet.id, actorId: operatorId, toState: wallet.state, correlationId,
      evidence: { assetId, networkId, walletType, provider, accountId, clientProfileId } });
    if (audit === null || audit === undefined) throw new ServiceUnavailableException('Required wallet audit unavailable; durable wallet may exist and requires audit reconciliation');
    this.logger.log({ event: 'custody.wallet.created', tenantId, walletId: wallet.id, assetId, networkId });
    return this.publicView(wallet);
  }

  async transitionWallet(params: {
    tenantId: string; walletId: string; toState: CustodyWalletState; operatorId?: string | null; reason?: string; correlationId?: string | null;
  }): Promise<CustodyWalletView> {
    const { tenantId, walletId, toState, operatorId = null, reason, correlationId = null } = params;
    const wallet = await this.walletRepo.getWallet({ tenantId, walletId });
    if (!wallet) throw new BadRequestException('Wallet not found or tenant mismatch');
    const currentState = Object.values(CustodyWalletState).find((value) => value === wallet.state);
    if (!currentState || !WALLET_VALID_TRANSITIONS[currentState].includes(toState)) {
      throw new BadRequestException(`Invalid wallet transition ${wallet.state} → ${toState}`);
    }
    if (toState === CustodyWalletState.ACTIVE) {
      if (!wallet.assetId || !wallet.networkId) throw new BadRequestException('Cannot activate wallet with unknown asset/network');
      await this.assertSupported(tenantId, wallet.assetId, wallet.networkId);
      if (!wallet.provider || !wallet.providerReference) throw new BadRequestException('Cannot activate wallet without provider-backed wallet identity');
      const provider = await this.providerFactory.getProviderById(wallet.provider);
      const capability = await provider.getCapabilities();
      const health = provider.isHealthy ? await provider.isHealthy() : null;
      if (!capability.canGetBalance || !capability.supportedAssets.includes(wallet.assetId)
        || !capability.supportedNetworks.includes(wallet.networkId) || health?.healthy !== true) {
        throw new BadRequestException('Cannot activate wallet without healthy, exact provider wallet capability');
      }
      if (wallet.accountId) {
        const account = await this.prisma.institutionalAccount.findFirst({ where: { id: wallet.accountId, tenantId } });
        if (!account || account.state !== 'ACTIVE') throw new BadRequestException('Cannot activate wallet for an unavailable/inactive account');
        const restrictions = await this.prisma.accountRestriction.findMany({ where: { tenantId, accountId: wallet.accountId,
          status: 'ACTIVE', restrictionType: { in: ['COMPLIANCE_HOLD', 'SECURITY_HOLD', 'ACCOUNT_LOCKED', 'RISK_HOLD', 'OPERATIONAL_HOLD'] } } });
        if (restrictions.length) throw new BadRequestException(`Cannot activate wallet — restrictions: ${restrictions.map((row) => row.restrictionType).join(',')}`);
      }
      const maintenance = await this.prisma.operationalMaintenanceWindow.findFirst({ where: { state: 'ACTIVE',
        OR: [{ tenantId }, { tenantId: null }], scope: { in: ['PLATFORM', 'TENANT'] } } });
      if (maintenance) throw new BadRequestException('Cannot activate wallet during an applicable maintenance window');
    }
    const updated = await this.walletRepo.updateWalletState({ tenantId, walletId, expectedState: wallet.state, state: toState, isActive: toState === CustodyWalletState.ACTIVE });
    const action = this.transitionAuditAction(toState);
    const audit: unknown = await this.auditService.log({ tenantId, walletId, action, entityType: 'CUSTODY_WALLET', entityId: walletId,
      actorId: operatorId, fromState: currentState, toState, reason: reason ?? null, correlationId,
      evidence: { fromState: currentState, toState, reason } });
    if (audit === null || audit === undefined) throw new ServiceUnavailableException('Required transition audit unavailable; persisted transition requires audit reconciliation');
    return this.publicView(updated);
  }

  async getWallet(params: { tenantId: string; walletId: string }): Promise<CustodyWalletView | null> {
    const wallet = await this.walletRepo.getWallet(params);
    return wallet ? this.publicView(wallet) : null;
  }

  async listWallets(params: {
    tenantId: string; clientProfileId?: string; accountId?: string; assetId?: string; networkId?: string;
    state?: string; page?: number; limit?: number;
  }): Promise<{ data: CustodyWalletView[]; total: number; page: number; limit: number }> {
    const result = await this.walletRepo.listWallets(params);
    return { ...result, data: result.data.map((wallet) => this.publicView(wallet)) };
  }

  private async assertSupported(tenantId: string, assetId: string, networkId: string): Promise<void> {
    if (!assetId || !networkId) throw new BadRequestException('assetId and networkId must be explicit');
    const [assetSupported, networkSupported, policySupported] = await Promise.all([
      this.assetRegistry.isAssetSupported({ assetId, networkId }), this.networkRegistry.isNetworkSupported({ networkId }),
      this.custodyPolicyService.isAssetSupported({ tenantId, assetId, networkId }),
    ]);
    if (!assetSupported || !networkSupported || !policySupported) throw new BadRequestException(`Unsupported registered asset/network: ${assetId} on ${networkId}`);
  }

  private transitionAuditAction(state: CustodyWalletState): CustodyAuditAction {
    switch (state) {
      case CustodyWalletState.PENDING: return CustodyAuditAction.WALLET_CREATED;
      case CustodyWalletState.ACTIVE: return CustodyAuditAction.WALLET_ACTIVATED;
      case CustodyWalletState.RESTRICTED: return CustodyAuditAction.WALLET_RESTRICTED;
      case CustodyWalletState.SUSPENDED: return CustodyAuditAction.WALLET_SUSPENDED;
      // Closing restricts the wallet; the native audit vocabulary has no CLOSURE_PENDING action, so record the restriction plus its exact toState.
      case CustodyWalletState.CLOSURE_PENDING: return CustodyAuditAction.WALLET_RESTRICTED;
      case CustodyWalletState.CLOSED: return CustodyAuditAction.WALLET_CLOSED;
    }
  }

  private publicView(wallet: CustodyWallet): CustodyWalletView {
    return { id: wallet.id, tenantId: wallet.tenantId, clientProfileId: wallet.clientProfileId, accountId: wallet.accountId,
      walletType: wallet.walletType, state: wallet.state, scope: wallet.scope, assetId: wallet.assetId, networkId: wallet.networkId,
      provider: wallet.provider, providerReference: wallet.providerReference, ownerId: wallet.ownerId, ownerType: wallet.ownerType,
      isActive: wallet.isActive, metadata: redactSecrets(wallet.metadata), idempotencyKey: wallet.idempotencyKey,
      activatedAt: wallet.activatedAt, suspendedAt: wallet.suspendedAt, closedAt: wallet.closedAt, createdAt: wallet.createdAt, updatedAt: wallet.updatedAt };
  }
}
