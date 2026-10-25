// # Responsibility: validate tenant-owned strategies with canonical exchange capabilities and fail closed when required compliance/limit evidence is unavailable.
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeRegistryService } from '../exchanges/exchange-registry.service';
import { ExchangeVenue } from '../exchanges/exchange.types';
import { TraderStrategyType } from './copy-trading.types';

export interface StrategyValidationInput {
  tenantId: string;
  traderId: string;
  userId: string;
  name: string;
  description?: string | null;
  type: TraderStrategyType;
  supportedSymbols: string[];
  supportedVenues: string[];
  riskProfile?: Record<string, unknown>;
  feePolicy?: Record<string, unknown>;
  strategyConfig?: Record<string, unknown>;
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

    for (const [field, value] of Object.entries({ riskProfile: input.riskProfile, feePolicy: input.feePolicy, strategyConfig: input.strategyConfig })) {
      if (value !== undefined && !isStrategyObject(value)) {
        errors.push({ field, code: 'INVALID_METADATA', message: `${field} must be an object` });
      }
    }
    if (errors.length) return { valid: false, errors, warnings };

    // Tenant ownership check
    const traderProfile = await this.prisma.traderProfile.findFirst({ where: { id: input.traderId, tenantId: input.tenantId } });
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
        const registryEntry = this.venue(venue);
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
        const exists = await this.prisma.tradingSymbol.findFirst({ where: { tenantId: input.tenantId, symbol } });
        if (!exists) {
          warnings.push({ field: 'supportedSymbols', code: 'SYMBOL_NOT_FOUND', message: `Symbol ${symbol} not found in tenant's instrument list - will be validated at execution` });
        }
      }
    }

    // Order types validation - unknown values must be narrowed before iterating them.
    if (input.strategyConfig?.orderTypes !== undefined) {
      const orderTypes = input.strategyConfig.orderTypes;
      if (!isStrategyStringArray(orderTypes)) {
        errors.push({ field: 'strategyConfig.orderTypes', code: 'INVALID_ORDER_TYPES', message: 'Order types must be an array of strings' });
      } else {
        for (const venue of input.supportedVenues || []) {
          const registryEntry = this.venue(venue);
          if (registryEntry) {
            for (const orderType of orderTypes) {
              if (!registryEntry.supportedOrderTypes.some((type) => type === orderType)) {
                errors.push({ field: 'strategyConfig.orderTypes', code: 'UNSUPPORTED_ORDER_TYPE', message: `Order type ${orderType} not supported for venue ${venue}` });
              }
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
      const accountVenues = tradingAccounts.map((a) => a.exchangeId);
      // We need to check venue via exchange relation
      const exchanges = await this.prisma.exchange.findMany({ where: { id: { in: accountVenues } } });
      const supportedByAccounts = exchanges.map((e) => e.venue);
      for (const venue of input.supportedVenues || []) {
        if (!supportedByAccounts.some((value) => value === venue)) {
          warnings.push({ field: 'supportedVenues', code: 'VENUE_NOT_COVERED_BY_ACCOUNT', message: `Venue ${venue} not covered by trader's exchange accounts` });
        }
      }
    }

    // Unknown extension values are not accepted through JavaScript truthiness or partial parseFloat.
    if (input.riskProfile) {
      for (const key of ['maxOrderQuantity', 'maxPositionQuantity', 'maxDailyLoss', 'maxOrderNotional']) {
        const value = input.riskProfile[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value) || new Prisma.Decimal(value).lte(0)) {
          errors.push({ field: `riskProfile.${key}`, code: 'INVALID_DECIMAL', message: `${key} must be a positive decimal string` });
        } else if (key === 'maxOrderNotional' && new Prisma.Decimal(value).gt('1000000')) {
          warnings.push({ field: 'riskProfile.maxOrderNotional', code: 'HIGH_NOTIONAL', message: 'maxOrderNotional is very high - review risk' });
        }
      }
    }

    // A failed required compliance read is not proof that no blocking case exists.
    const complianceCase = await this.prisma.complianceCase.findFirst({ where: {
      tenantId: input.tenantId, userId: input.userId, state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] }, decision: 'BLOCK',
    } });
    if (complianceCase) {
      errors.push({ field: 'compliance', code: 'COMPLIANCE_BLOCKED', message: 'Trader account is blocked by compliance - cannot publish strategy' });
    }

    // Plan entitlements - check maxTraders
    const tenant = await this.prisma.tenant.findFirst({ where: { id: input.tenantId } });
    if (!tenant) errors.push({ field: 'tenantId', code: 'TENANT_NOT_FOUND', message: 'Tenant not found' });
    if (tenant && tenant.maxTraders !== null && tenant.maxTraders !== undefined) {
      const traderCount = await this.prisma.traderProfile.count({ where: { tenantId: input.tenantId, deletedAt: null } });
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
      warnings.push({ field: 'execution', code: 'KILL_SWITCH_ENGAGED', message: `Kill switches engaged: ${killSwitches.map((k) => `${k.scope}:${k.target || 'GLOBAL'}`).join(', ')} - strategy can be published but execution blocked` });
    }

    const valid = errors.length === 0;
    this.logger.log(`Strategy validation tenant=${input.tenantId} trader=${input.traderId} valid=${valid} errors=${errors.length} warnings=${warnings.length}`);

    return { valid, errors, warnings };
  }

  async validateForPublication(tenantId: string, strategyId: string): Promise<ValidationResult> {
    const strategy = await this.prisma.traderStrategy.findFirst({ where: { id: strategyId, tenantId } });
    if (!strategy) {
      return { valid: false, errors: [{ field: 'strategyId', code: 'STRATEGY_NOT_FOUND', message: `Strategy ${strategyId} not found` }], warnings: [] };
    }

    const type = Object.values(TraderStrategyType).find((value) => value === strategy.type);
    if (!type || !isStrategyObject(strategy.riskProfile) || !isStrategyObject(strategy.feePolicy) || !isStrategyObject(strategy.strategyConfig)) {
      return { valid: false, errors: [{ field: 'strategyConfig', code: 'INVALID_PERSISTED_CONFIGURATION', message: 'Stored strategy configuration is malformed' }], warnings: [] };
    }
    return this.validate({
      tenantId,
      traderId: strategy.traderId,
      userId: strategy.userId,
      name: strategy.name,
      description: strategy.description,
      type,
      supportedSymbols: strategy.supportedSymbols,
      supportedVenues: strategy.supportedVenues,
      riskProfile: strategy.riskProfile,
      feePolicy: strategy.feePolicy,
      strategyConfig: strategy.strategyConfig,
    });
  }
  private venue(value: string) {
    const venue = Object.values(ExchangeVenue).find((member) => member === value);
    return venue ? this.exchangeRegistry.getVenue(venue) : undefined;
  }

}

function isStrategyObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStrategyStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const entries: unknown[] = value;
  return entries.every((entry) => typeof entry === 'string');
}
