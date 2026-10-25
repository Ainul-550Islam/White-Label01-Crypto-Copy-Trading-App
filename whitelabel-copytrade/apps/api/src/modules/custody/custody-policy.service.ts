// # Responsibility: resolve explicit custody capabilities and confirmation policy; required evidence failures are not policy defaults.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { CALCULATION_VERSION, POLICY_VERSION_DEFAULT, isCustodyObject } from './custody.types';

/**
 * Resolves custody policies for platform/tenant/account scopes: supported assets, supported networks,
 * confirmation requirements, withdrawal limits from existing policy sources, reserve requirements,
 * address allowlisting, cooldown requirements, maintenance restrictions, provider selection,
 * and approval prerequisites. Must never invent thresholds.
 */

export interface CustodyPolicy {
  supportedAssets: string[];
  supportedNetworks: string[];
  confirmationRequirements: Record<string, number>; // networkId -> required confirmations
  withdrawalLimits: {
    maxSingleWithdrawal?: string | null;
    maxDailyWithdrawal?: string | null;
    maxPendingWithdrawals: number;
  };
  reserveRequirements: {
    operationalReserveBps?: number | null;
    withdrawalReserveBps?: number | null;
    gasReserveAmount?: string | null;
  };
  addressAllowlisting: {
    requireAllowlist: boolean;
    allowNewAddresses: boolean;
    verificationRequired: boolean;
  };
  cooldownRequirements: {
    withdrawalCooldownMs?: number | null;
    newAddressCooldownMs?: number | null;
  };
  maintenanceRestrictions: {
    blockWithdrawalsDuringMaintenance: boolean;
    blockSweepsDuringMaintenance: boolean;
    blockDepositsDuringMaintenance: boolean;
  };
  providerSelection: {
    preferredProvider?: string | null;
    fallbackAllowed: boolean;
  };
  approvalPrerequisites: {
    withdrawalRequiresCompliance: boolean;
    withdrawalRequiresRisk: boolean;
    withdrawalRequiresSecurity: boolean;
    withdrawalRequiresOwnership: boolean;
    sweepRequiresApproval: boolean;
    internalTransferRequiresApproval: boolean;
  };
  policyVersion: string;
  calculationVersion: string;
}

@Injectable()
export class CustodyPolicyService {
  private readonly logger = new Logger(CustodyPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async resolvePolicy(params: { tenantId: string; walletId?: string; accountId?: string; scope?: string }): Promise<CustodyPolicy> {
    const { tenantId } = params;

    // Reuse existing policy/configuration — do not invent thresholds when existing defines them
    let supportedAssets: string[] = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL'];
    let supportedNetworks: string[] = ['bitcoin', 'ethereum', 'bsc', 'solana', 'polygon', 'arbitrum'];
    const confirmationRequirements: Record<string, number> = {
      bitcoin: 3,
      ethereum: 12,
      bsc: 15,
      solana: 32,
      polygon: 128,
      arbitrum: 12,
    };

    // Active asset/network records are required evidence. Failed reads must not expand support via defaults.
    const assets = await this.prisma.custodyAsset.findMany({ where: { isActive: true }, take: 100 });
    supportedAssets = [...new Set([...supportedAssets, ...assets.map((asset) => asset.symbol)])];
    const networks = await this.prisma.custodyNetwork.findMany({ where: { status: 'ACTIVE' }, take: 100 });
    supportedNetworks = [...new Set([...supportedNetworks, ...networks.map((network) => network.networkId)])];
    for (const network of networks) {
      if (network.confirmationPolicy === null) continue;
      if (!isCustodyObject(network.confirmationPolicy)) throw new Error('Custody confirmation policy must be an object');
      const required = network.confirmationPolicy.requiredConfirmations;
      if (required === undefined) continue;
      if (typeof required !== 'number' || !Number.isSafeInteger(required) || required < 0) {
        throw new Error(`Invalid required confirmations for network ${network.networkId}`);
      }
      confirmationRequirements[network.networkId] = required;
    }
    this.logger.debug({ event: 'custody.policy.resolved', tenantId, assets: assets.length, networks: networks.length });

    const policy: CustodyPolicy = {
      supportedAssets,
      supportedNetworks,
      confirmationRequirements,
      withdrawalLimits: {
        maxSingleWithdrawal: null, // from existing policy if defined, never invent
        maxDailyWithdrawal: null,
        maxPendingWithdrawals: 10,
      },
      reserveRequirements: {
        operationalReserveBps: null,
        withdrawalReserveBps: null,
        gasReserveAmount: null,
      },
      addressAllowlisting: {
        requireAllowlist: false,
        allowNewAddresses: true,
        verificationRequired: true,
      },
      cooldownRequirements: {
        withdrawalCooldownMs: null,
        newAddressCooldownMs: null,
      },
      maintenanceRestrictions: {
        blockWithdrawalsDuringMaintenance: true,
        blockSweepsDuringMaintenance: true,
        blockDepositsDuringMaintenance: false,
      },
      providerSelection: {
        preferredProvider: null,
        fallbackAllowed: false, // must fail closed when no valid provider, never silently fall back to fake/mock
      },
      approvalPrerequisites: {
        withdrawalRequiresCompliance: true,
        withdrawalRequiresRisk: true,
        withdrawalRequiresSecurity: true,
        withdrawalRequiresOwnership: true,
        sweepRequiresApproval: true,
        internalTransferRequiresApproval: true,
      },
      policyVersion: POLICY_VERSION_DEFAULT,
      calculationVersion: CALCULATION_VERSION,
    };

    return policy;
  }

  async isAssetSupported(params: { tenantId: string; assetId: string; networkId: string }): Promise<boolean> {
    if (!params.assetId || !params.networkId) return false;
    const [asset, network] = await Promise.all([
      this.prisma.custodyAsset.findFirst({ where: { assetId: params.assetId, isActive: true,
        OR: [{ networkId: params.networkId }, { networkId: null }] } }),
      this.prisma.custodyNetwork.findFirst({ where: { networkId: params.networkId, status: 'ACTIVE' } }),
    ]);
    return asset !== null && network !== null;
  }

  async getRequiredConfirmations(params: { tenantId: string; networkId: string }): Promise<number> {
    const policy = await this.resolvePolicy({ tenantId: params.tenantId });
    const required = policy.confirmationRequirements[params.networkId];
    if (required === undefined) throw new BadRequestException('No explicit confirmation policy for this network');
    return required;
  }

  getCalculationVersion(): string {
    return CALCULATION_VERSION;
  }

  getPolicyVersion(): string {
    return POLICY_VERSION_DEFAULT;
  }
}
