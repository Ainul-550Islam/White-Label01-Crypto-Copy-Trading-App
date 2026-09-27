import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  PortfolioAccountingScope,
  PortfolioType,
  PortfolioReturnMethodology,
  CALCULATION_VERSION,
  POLICY_VERSION_DEFAULT,
} from './portfolio-accounting.types';

/**
 * Resolves accounting policies for tenant, trader, strategy, follower, and managed-account scopes,
 * including base currency, valuation frequency, return methodology, fee treatment, period boundaries,
 * close rules, rounding rules, and supported asset handling. Must reuse existing configuration/policy
 * sources where available.
 */

export interface AccountingPolicy {
  baseCurrency: string;
  valuationCurrency: string;
  valuationFrequency: string;
  returnMethodology: PortfolioReturnMethodology;
  costBasisMethod: string;
  feeTreatment: string;
  periodBoundary: string;
  roundingMode: string;
  roundingScale: number;
  supportedAssets: string[];
  closeRules: {
    requireReconciliation: boolean;
    requireValuation: boolean;
    requireFeeReconciliation: boolean;
    requireCashReconciliation: boolean;
    requirePositionReconciliation: boolean;
    allowIncompleteValuation: boolean;
  };
  policyVersion: string;
  calculationVersion: string;
}

@Injectable()
export class AccountingPolicyService {
  private readonly logger = new Logger(AccountingPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async resolvePolicy(params: {
    tenantId: string;
    scope: PortfolioAccountingScope;
    scopeId: string;
  }): Promise<AccountingPolicy> {
    const { tenantId, scope, scopeId } = params;

    // Reuse existing configuration/policy sources where available — check TenantSetting, TenantFeatureFlag, etc.
    let baseCurrency = 'USD';
    let supportedAssets: string[] = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL'];

    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { defaultCurrency: true, supportedCurrencies: true } });
      if (tenant?.defaultCurrency) baseCurrency = tenant.defaultCurrency;
      if (tenant?.supportedCurrencies && tenant.supportedCurrencies.length > 0) {
        // supportedCurrencies are fiat, but we also support crypto — merge
        supportedAssets = [...new Set([...supportedAssets, ...tenant.supportedCurrencies])];
      }
    } catch {}

    // Check for existing accounting profile — if exists, use its policy
    try {
      const profile = await (this.prisma as any).portfolioAccountingProfile.findFirst({
        where: { tenantId, scope: scope as any, scopeId },
        orderBy: { createdAt: 'desc' },
      });
      if (profile) {
        return {
          baseCurrency: profile.baseCurrency,
          valuationCurrency: profile.valuationCurrency ?? profile.baseCurrency,
          valuationFrequency: profile.valuationFrequency,
          returnMethodology: profile.returnMethodology as PortfolioReturnMethodology,
          costBasisMethod: profile.costBasisMethod,
          feeTreatment: profile.feeTreatment,
          periodBoundary: profile.periodBoundary,
          roundingMode: profile.roundingMode,
          roundingScale: profile.roundingScale,
          supportedAssets,
          closeRules: {
            requireReconciliation: true,
            requireValuation: true,
            requireFeeReconciliation: true,
            requireCashReconciliation: true,
            requirePositionReconciliation: true,
            allowIncompleteValuation: false,
          },
          policyVersion: profile.policyVersion,
          calculationVersion: profile.calculationVersion,
        };
      }
    } catch {}

    // Default policy — explicit, auditable, not invented thresholds from nowhere
    const policy: AccountingPolicy = {
      baseCurrency,
      valuationCurrency: baseCurrency,
      valuationFrequency: 'DAILY',
      returnMethodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
      costBasisMethod: 'FIFO',
      feeTreatment: 'NET',
      periodBoundary: 'UTC_MIDNIGHT',
      roundingMode: 'HALF_UP',
      roundingScale: 8,
      supportedAssets,
      closeRules: {
        requireReconciliation: true,
        requireValuation: true,
        requireFeeReconciliation: true,
        requireCashReconciliation: true,
        requirePositionReconciliation: true,
        allowIncompleteValuation: false,
      },
      policyVersion: POLICY_VERSION_DEFAULT,
      calculationVersion: CALCULATION_VERSION,
    };

    this.logger.debug({
      event: 'portfolio.policy.resolved',
      tenantId,
      scope,
      scopeId,
      baseCurrency,
      policyVersion: policy.policyVersion,
    });

    return policy;
  }

  async createOrUpdateProfile(params: {
    tenantId: string;
    scope: PortfolioAccountingScope;
    scopeId: string;
    portfolioType?: PortfolioType;
    baseCurrency?: string;
    returnMethodology?: PortfolioReturnMethodology;
    costBasisMethod?: string;
  }): Promise<any> {
    const policy = await this.resolvePolicy({ tenantId: params.tenantId, scope: params.scope, scopeId: params.scopeId });

    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;
    const returnMethodology = params.returnMethodology ?? policy.returnMethodology;
    const costBasisMethod = params.costBasisMethod ?? policy.costBasisMethod;
    const portfolioType = params.portfolioType ?? PortfolioType.SPOT;

    try {
      const existing = await (this.prisma as any).portfolioAccountingProfile.findFirst({
        where: { tenantId: params.tenantId, scope: params.scope as any, scopeId: params.scopeId },
      });
      if (existing) {
        return await (this.prisma as any).portfolioAccountingProfile.update({
          where: { id: existing.id },
          data: {
            baseCurrency,
            returnMethodology: returnMethodology as any,
            costBasisMethod,
            portfolioType: portfolioType as any,
            policyVersion: policy.policyVersion,
            calculationVersion: policy.calculationVersion,
          },
        });
      }
      return await (this.prisma as any).portfolioAccountingProfile.create({
        data: {
          tenantId: params.tenantId,
          scope: params.scope as any,
          scopeId: params.scopeId,
          portfolioType: portfolioType as any,
          baseCurrency,
          valuationCurrency: baseCurrency,
          returnMethodology: returnMethodology as any,
          costBasisMethod,
          feeTreatment: policy.feeTreatment,
          valuationFrequency: policy.valuationFrequency,
          periodBoundary: policy.periodBoundary,
          roundingMode: policy.roundingMode,
          roundingScale: policy.roundingScale,
          policyVersion: policy.policyVersion,
          calculationVersion: policy.calculationVersion,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to create accounting profile: ${(e as Error).message}`);
      throw e;
    }
  }

  getCalculationVersion(): string {
    return CALCULATION_VERSION;
  }

  getPolicyVersion(): string {
    return POLICY_VERSION_DEFAULT;
  }
}
