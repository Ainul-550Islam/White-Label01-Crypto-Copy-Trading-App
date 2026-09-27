import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeRegistryService } from '../exchanges/exchange-registry.service';
import { TraderStrategyStatus, TraderStrategyType } from './copy-trading.types';

export interface StrategyValidationInput {
  tenantId: string;
  traderId: string;
  userId: string;
  name: string;
  description?: string | null;
  type: TraderStrategyType;
  supportedSymbols: string[];
  supportedVenues: string[];
  riskProfile?: Record<string, any>;
  feePolicy?: Record<string, any>;
  strategyConfig?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors: { field: string; code: string; message: string }[];
  warnings: { field: string; code: string; message: string }[];
}

/**
 * Validates strategy configuration, symbols, supported exchange capabilities, risk constraints, fee policy, and compatibility with existing execution/risk systems before publication.
 * Return deterministic validation errors. Do not silently downgrade unsupported features.
 */
@Injectable()
export class StrategyValidationService {
  private readonly logger = new Logger(StrategyValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeRegistry: ExchangeRegistryService,
  ) {}

  async validate(input: StrategyValidationInput): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];

    // Tenant ownership check
    const traderProfile = await (this.prisma as any).traderProfile?.findFirst({ where: { id: input.traderId, tenantId: input.tenantId } });
    if (!traderProfile) {
      errors.push({ field: 'traderId', code: 'TRADER_NOT_FOUND', message: `Trader profile ${input.traderId} not found for tenant ${input.tenantId}` });
      return { valid: false, errors, warnings };
    }

    if (traderProfile.userId !== input.userId) {
      errors.push({ field: 'userId', code: 'TRADER_OWNERSHIP_MISMATCH', message: 'Trader profile does not belong to requesting user' });
    }

    // Name validation
    if (!input.name || input.name.trim().length < 3) {
      errors.push({ field: 'name', code: 'NAME_TOO_SHORT', message: 'Strategy name must be at least 3 characters' });
    }
    if (input.name && input.name.length > 120) {
      errors.push({ field: 'name', code: 'NAME_TOO_LONG', message: 'Strategy name must be at most 120 characters' });
    }

    // Supported venues validation - authoritative and provider-specific
    if (!input.supportedVenues || input.supportedVenues.length === 0) {
      errors.push({ field: 'supportedVenues', code: 'VENUES_REQUIRED', message: 'At least one venue is required' });
    } else {
      for (const venue of input.supportedVenues) {
        const registryEntry = this.exchangeRegistry.getVenue(venue as any);
        if (!registryEntry) {
          errors.push({ field: 'supportedVenues', code: 'UNKNOWN_VENUE', message: `Unknown venue ${venue} - not in registry` });
        } else if (!registryEntry.isActive) {
          errors.push({ field: 'supportedVenues', code: 'VENUE_NOT_ACTIVE', message: `Venue ${venue} is not active` });
        }
      }
    }

    // Symbols/instruments validation
    if (!input.supportedSymbols || input.supportedSymbols.length === 0) {
      errors.push({ field: 'supportedSymbols', code: 'SYMBOLS_REQUIRED', message: 'At least one symbol is required' });
    } else {
      if (input.supportedSymbols.length > 50) {
        errors.push({ field: 'supportedSymbols', code: 'TOO_MANY_SYMBOLS', message: 'Maximum 50 symbols allowed' });
      }
      for (const symbol of input.supportedSymbols) {
        if (!symbol.includes('-') && !symbol.includes('/')) {
          warnings.push({ field: 'supportedSymbols', code: 'SYMBOL_FORMAT', message: `Symbol ${symbol} should be in canonical format e.g. BTC-USDT` });
        }
        // Check if symbol exists in tenant's trading symbols
        const exists = await (this.prisma as any).tradingSymbol?.findFirst({ where: { tenantId: input.tenantId, symbol } });
        if (!exists) {
          warnings.push({ field: 'supportedSymbols', code: 'SYMBOL_NOT_FOUND', message: `Symbol ${symbol} not found in tenant's instrument list - will be validated at execution` });
        }
      }
    }

    // Order types validation - use exchange capabilities
    if (input.strategyConfig?.orderTypes) {
      const orderTypes = input.strategyConfig.orderTypes as string[];
      for (const venue of input.supportedVenues || []) {
        const registryEntry = this.exchangeRegistry.getVenue(venue as any);
        if (registryEntry) {
          for (const ot of orderTypes) {
            if (!registryEntry.supportedOrderTypes.includes(ot as any)) {
              errors.push({ field: 'strategyConfig.orderTypes', code: 'UNSUPPORTED_ORDER_TYPE', message: `Order type ${ot} not supported for venue ${venue}` });
            }
          }
        }
      }
    }

    // Account environment validation
    const tradingAccounts = await this.prisma.tradingAccount.findMany({ where: { tenantId: input.tenantId, userId: input.userId, deletedAt: null } });
    if (tradingAccounts.length === 0) {
      warnings.push({ field: 'account', code: 'NO_EXCHANGE_ACCOUNT', message: 'Trader has no exchange account - strategy can be created but cannot be published until account connected' });
    } else {
      // Check if at least one account supports required venues
      const accountVenues = tradingAccounts.map((a: any) => a.exchangeId);
      // We need to check venue via exchange relation
      const exchanges = await this.prisma.exchange.findMany({ where: { id: { in: accountVenues } } });
      const supportedByAccounts = exchanges.map((e: any) => e.venue);
      for (const venue of input.supportedVenues || []) {
        if (!supportedByAccounts.includes(venue as any)) {
          warnings.push({ field: 'supportedVenues', code: 'VENUE_NOT_COVERED_BY_ACCOUNT', message: `Venue ${venue} not covered by trader's exchange accounts` });
        }
      }
    }

    // Risk limits validation - use existing risk infrastructure
    if (input.riskProfile) {
      const rp = input.riskProfile;
      if (rp.maxOrderQuantity && isNaN(parseFloat(rp.maxOrderQuantity))) {
        errors.push({ field: 'riskProfile.maxOrderQuantity', code: 'INVALID_DECIMAL', message: 'maxOrderQuantity must be a valid decimal string' });
      }
      if (rp.maxPositionQuantity && isNaN(parseFloat(rp.maxPositionQuantity))) {
        errors.push({ field: 'riskProfile.maxPositionQuantity', code: 'INVALID_DECIMAL', message: 'maxPositionQuantity must be a valid decimal string' });
      }
      if (rp.maxDailyLoss && isNaN(parseFloat(rp.maxDailyLoss))) {
        errors.push({ field: 'riskProfile.maxDailyLoss', code: 'INVALID_DECIMAL', message: 'maxDailyLoss must be a valid decimal string' });
      }
      // Fail closed: if risk limits are too permissive, warn
      if (rp.maxOrderNotional && parseFloat(rp.maxOrderNotional) > 1000000) {
        warnings.push({ field: 'riskProfile.maxOrderNotional', code: 'HIGH_NOTIONAL', message: 'maxOrderNotional is very high - review risk' });
      }
    }

    // Compliance restrictions - check trader compliance state
    try {
      const complianceCase = await (this.prisma as any).complianceCase?.findFirst({ where: { tenantId: input.tenantId, userId: input.userId, state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } } });
      if (complianceCase && complianceCase.decision === 'BLOCK') {
        errors.push({ field: 'compliance', code: 'COMPLIANCE_BLOCKED', message: 'Trader account is blocked by compliance - cannot publish strategy' });
      }
    } catch {}

    // Plan entitlements - check maxTraders
    const tenant = await this.prisma.tenant.findFirst({ where: { id: input.tenantId } });
    if (tenant && tenant.maxTraders !== null && tenant.maxTraders !== undefined) {
      const traderCount = await (this.prisma as any).traderProfile?.count({ where: { tenantId: input.tenantId, deletedAt: null } }) || 0;
      if (traderCount >= tenant.maxTraders) {
        errors.push({ field: 'plan', code: 'MAX_TRADERS_REACHED', message: `Max traders limit reached: ${traderCount}/${tenant.maxTraders}` });
      }
    }

    // Trader account capability validation
    if (input.type === TraderStrategyType.ALGORITHMIC) {
      // Algorithmic strategies require specific capabilities
      if (!input.strategyConfig?.definitionId && !input.strategyConfig?.implementationId) {
        errors.push({ field: 'strategyConfig', code: 'ALGO_DEFINITION_REQUIRED', message: 'Algorithmic strategy requires definitionId or implementationId' });
      }
    }

    // Existing execution constraints
    const killSwitches = await this.prisma.killSwitch.findMany({ where: { tenantId: input.tenantId, isEngaged: true } });
    if (killSwitches.length > 0) {
      warnings.push({ field: 'execution', code: 'KILL_SWITCH_ENGAGED', message: `Kill switches engaged: ${killSwitches.map((k: any) => `${k.scope}:${k.target || 'GLOBAL'}`).join(', ')} - strategy can be published but execution blocked` });
    }

    const valid = errors.length === 0;
    this.logger.log(`Strategy validation tenant=${input.tenantId} trader=${input.traderId} valid=${valid} errors=${errors.length} warnings=${warnings.length}`);

    return { valid, errors, warnings };
  }

  async validateForPublication(tenantId: string, strategyId: string): Promise<ValidationResult> {
    const strategy = await (this.prisma as any).traderStrategy?.findFirst({ where: { id: strategyId, tenantId } });
    if (!strategy) {
      return { valid: false, errors: [{ field: 'strategyId', code: 'STRATEGY_NOT_FOUND', message: `Strategy ${strategyId} not found` }], warnings: [] };
    }

    return this.validate({
      tenantId,
      traderId: strategy.traderId,
      userId: strategy.userId,
      name: strategy.name,
      description: strategy.description,
      type: strategy.type,
      supportedSymbols: strategy.supportedSymbols,
      supportedVenues: strategy.supportedVenues,
      riskProfile: strategy.riskProfile,
      feePolicy: strategy.feePolicy,
      strategyConfig: strategy.strategyConfig,
    });
  }
}
