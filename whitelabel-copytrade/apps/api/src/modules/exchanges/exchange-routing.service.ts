import { Injectable, Logger } from '@nestjs/common';
import { ExchangeVenue, ExchangeEnvironment, ExchangeCapability, ExchangeHealthState, ExchangeAccountState, ExchangeRoutingDecision } from './exchange.types';
import { ExchangeAccountRepository } from './exchange-account.repository';
import { ExchangeHealthService } from './exchange-health.service';
import { ExchangeRateLimitService } from './exchange-rate-limit.service';
import { ExchangeRegistryService } from './exchange-registry.service';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExecutionSafetyService } from '../execution/execution-safety.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface RoutingInput {
  tenantId: string;
  userId: string;
  operation: 'READ' | 'MARKET_DATA' | 'TRADE' | 'WITHDRAWAL';
  symbol?: string;
  requiredCapability: ExchangeCapability;
  environment: ExchangeEnvironment;
  accountId?: string | null; // specific account requested
  complianceAllowed?: boolean;
  riskAllowed?: boolean;
  actorId?: string;
  requestId?: string;
}

/**
 * Determines eligible venue/account for read/market/trading operations based on capabilities, account state, environment, tenant policy, and existing live-mode safety gates.
 * CRITICAL: This service MUST call existing live safety gate for live trading. It must never independently decide "live=true → place order"
 */
@Injectable()
export class ExchangeRoutingService {
  private readonly logger = new Logger(ExchangeRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountRepo: ExchangeAccountRepository,
    private readonly healthService: ExchangeHealthService,
    private readonly rateLimitService: ExchangeRateLimitService,
    private readonly registry: ExchangeRegistryService,
    private readonly safetyService: ExecutionSafetyService,
    private readonly auditService: ExchangeAuditService,
  ) {}

  async route(input: RoutingInput): Promise<ExchangeRoutingDecision> {
    // 1. Tenant cannot access another tenant's exchange account - enforced via repo tenantId filter
    // 2. List eligible accounts for tenant
    const { data: accounts } = await this.accountRepo.listByTenant(input.tenantId, {
      userId: input.userId,
      environment: input.environment,
      status: ExchangeAccountState.ACTIVE,
      limit: 100,
    });

    // If specific account requested, filter to that account and verify ownership
    let eligible = accounts;
    if (input.accountId) {
      eligible = accounts.filter((a) => a.id === input.accountId);
      if (eligible.length === 0) {
        // Check if account exists in other tenant - if so, reject with generic not found to avoid enumeration
        const exists = await this.prisma.tradingAccount.findFirst({ where: { id: input.accountId } });
        if (exists && exists.tenantId !== input.tenantId) {
          this.logger.warn(`Cross-tenant access attempt tenant=${input.tenantId} requestedAccount=${input.accountId} actualTenant=${exists.tenantId}`);
          await this.auditService.record({
            tenantId: input.tenantId,
            accountId: input.accountId,
            venue: ExchangeVenue.BINANCE,
            environment: input.environment,
            event: 'ROUTING_DECISION',
            result: 'FAILURE',
            actorId: input.actorId,
            safeMetadata: { reason: 'CROSS_TENANT_ACCESS_DENIED', requestedAccountId: input.accountId },
            requestId: input.requestId,
          });
          return {
            selectedAccountId: null,
            selectedVenue: null,
            environment: input.environment,
            eligibleAccounts: [],
            routingReason: 'CROSS_TENANT_ACCESS_DENIED',
            capabilities: [],
            health: null,
            liveExecutionPermitted: false,
            liveGateBlockingReasons: ['Cross-tenant access denied'],
            complianceAllowed: false,
            riskAllowed: false,
          };
        }

        return {
          selectedAccountId: null,
          selectedVenue: null,
          environment: input.environment,
          eligibleAccounts: [],
          routingReason: 'ACCOUNT_NOT_FOUND_OR_NOT_ACTIVE',
          capabilities: [],
          health: null,
          liveExecutionPermitted: false,
          liveGateBlockingReasons: ['Account not found or not active'],
          complianceAllowed: input.complianceAllowed ?? true,
          riskAllowed: input.riskAllowed ?? true,
        };
      }
    }

    // 3. Routing respects capability requirements
    const capabilityFiltered = eligible.filter((a) => {
      // Check if account capabilities include required capability
      // If capabilities empty (not yet discovered), fallback to registry
      if (a.capabilities && a.capabilities.length > 0) {
        return a.capabilities.includes(input.requiredCapability);
      }
      const registryCaps = this.registry.listCapabilities(a.venue);
      return registryCaps.includes(input.requiredCapability);
    });

    if (capabilityFiltered.length === 0) {
      return {
        selectedAccountId: null,
        selectedVenue: null,
        environment: input.environment,
        eligibleAccounts: eligible.map((a) => a.id),
        routingReason: `NO_ACCOUNT_WITH_CAPABILITY_${input.requiredCapability}`,
        capabilities: [],
        health: null,
        liveExecutionPermitted: false,
        liveGateBlockingReasons: [`No account with capability ${input.requiredCapability}`],
        complianceAllowed: input.complianceAllowed ?? true,
        riskAllowed: input.riskAllowed ?? true,
      };
    }

    // 4. Environment separation: testnet cannot route to live, live cannot route to testnet - fail closed
    const envFiltered = capabilityFiltered.filter((a) => {
      if (input.environment === ExchangeEnvironment.LIVE) {
        return a.environment === ExchangeEnvironment.LIVE && !a.isSandbox;
      } else {
        return a.environment !== ExchangeEnvironment.LIVE && a.isSandbox;
      }
    });

    if (envFiltered.length === 0) {
      const reason = input.environment === ExchangeEnvironment.LIVE ? 'LIVE_CANNOT_ROUTE_TO_TESTNET' : 'TESTNET_CANNOT_ROUTE_TO_LIVE';
      return {
        selectedAccountId: null,
        selectedVenue: null,
        environment: input.environment,
        eligibleAccounts: capabilityFiltered.map((a) => a.id),
        routingReason: reason,
        capabilities: [],
        health: null,
        liveExecutionPermitted: false,
        liveGateBlockingReasons: [reason],
        complianceAllowed: input.complianceAllowed ?? true,
        riskAllowed: input.riskAllowed ?? true,
      };
    }

    // 5. Routing respects account health
    const healthyAccounts: { account: any; health: any }[] = [];
    for (const account of envFiltered) {
      try {
        const health = await this.healthService.getHealth(input.tenantId, account.id);
        if (!health) continue;

        // Skip AUTH_FAILED, UNAVAILABLE, STALE for live operations
        if (input.operation === 'TRADE') {
          if (!this.healthService.isStaleHealthAllowsLiveTrading(health)) {
            this.logger.warn(`Account unhealthy for live trading tenant=${input.tenantId} account=${account.id} health=${health.state}`);
            continue;
          }
        } else {
          // For read operations, allow DEGRADED but not AUTH_FAILED/UNAVAILABLE
          if (health.state === ExchangeHealthState.AUTH_FAILED || health.state === ExchangeHealthState.UNAVAILABLE) {
            continue;
          }
        }

        healthyAccounts.push({ account, health });
      } catch (e: any) {
        this.logger.warn(`Health check failed for routing tenant=${input.tenantId} account=${account.id} error=${e.message}`);
      }
    }

    if (healthyAccounts.length === 0) {
      return {
        selectedAccountId: null,
        selectedVenue: null,
        environment: input.environment,
        eligibleAccounts: envFiltered.map((a) => a.id),
        routingReason: 'NO_HEALTHY_ACCOUNT',
        capabilities: [],
        health: null,
        liveExecutionPermitted: false,
        liveGateBlockingReasons: ['No healthy account available'],
        complianceAllowed: input.complianceAllowed ?? true,
        riskAllowed: input.riskAllowed ?? true,
      };
    }

    // 6. Routing respects compliance restrictions
    if (input.complianceAllowed === false) {
      return {
        selectedAccountId: null,
        selectedVenue: null,
        environment: input.environment,
        eligibleAccounts: healthyAccounts.map((h) => h.account.id),
        routingReason: 'COMPLIANCE_BLOCKED',
        capabilities: [],
        health: null,
        liveExecutionPermitted: false,
        liveGateBlockingReasons: ['Compliance blocked'],
        complianceAllowed: false,
        riskAllowed: input.riskAllowed ?? true,
      };
    }

    if (input.riskAllowed === false) {
      return {
        selectedAccountId: null,
        selectedVenue: null,
        environment: input.environment,
        eligibleAccounts: healthyAccounts.map((h) => h.account.id),
        routingReason: 'RISK_BLOCKED',
        capabilities: [],
        health: null,
        liveExecutionPermitted: false,
        liveGateBlockingReasons: ['Risk blocked'],
        complianceAllowed: true,
        riskAllowed: false,
      };
    }

    // 7. Rate-limit availability
    const rateLimitEligible: { account: any; health: any }[] = [];
    for (const { account, health } of healthyAccounts) {
      try {
        const rateLimitCheck = await this.rateLimitService.checkRateLimit({
          tenantId: input.tenantId,
          venue: account.venue,
          environment: account.environment,
          accountId: account.id,
          endpointClass: input.operation === 'TRADE' ? 'ORDER' : input.operation === 'READ' ? 'PRIVATE' : 'PUBLIC',
        });

        if (!rateLimitCheck.allowed) {
          this.logger.warn(`Rate limited for routing tenant=${input.tenantId} account=${account.id} pressure=${rateLimitCheck.pressure}`);
          continue;
        }

        rateLimitEligible.push({ account, health });
      } catch {
        rateLimitEligible.push({ account, health });
      }
    }

    if (rateLimitEligible.length === 0) {
      return {
        selectedAccountId: null,
        selectedVenue: null,
        environment: input.environment,
        eligibleAccounts: healthyAccounts.map((h) => h.account.id),
        routingReason: 'ALL_ACCOUNTS_RATE_LIMITED',
        capabilities: [],
        health: null,
        liveExecutionPermitted: false,
        liveGateBlockingReasons: ['All accounts rate limited'],
        complianceAllowed: true,
        riskAllowed: true,
      };
    }

    // 8. Select best account - lowest latency, healthy, etc.
    // Sort by health state HEALTHY first, then latency, then last verified
    rateLimitEligible.sort((a, b) => {
      const healthOrder: Record<string, number> = {
        [ExchangeHealthState.HEALTHY]: 0,
        [ExchangeHealthState.DEGRADED]: 1,
        [ExchangeHealthState.RATE_LIMITED]: 2,
        [ExchangeHealthState.STALE]: 3,
        [ExchangeHealthState.UNAVAILABLE]: 4,
        [ExchangeHealthState.AUTH_FAILED]: 5,
      };
      const aOrder = healthOrder[a.health.state] ?? 10;
      const bOrder = healthOrder[b.health.state] ?? 10;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aLatency = a.health.latencyMs || 9999;
      const bLatency = b.health.latencyMs || 9999;
      return aLatency - bLatency;
    });

    const selected = rateLimitEligible[0];
    const selectedAccount = selected.account;
    const selectedHealth = selected.health;

    // 9. Routing invokes existing live enablement gate for live trading
    let liveExecutionPermitted = false;
    let liveGateBlockingReasons: string[] = [];

    if (input.environment === ExchangeEnvironment.LIVE && input.operation === 'TRADE') {
      try {
        const safety = await this.safetyService.safetySummary(input.tenantId);
        liveExecutionPermitted = safety.wouldTransmitLiveOrder && selectedAccount.liveTradingEnabled;
        liveGateBlockingReasons = safety.blockingReasons;
        if (!selectedAccount.liveTradingEnabled) {
          liveGateBlockingReasons.push('Account liveTradingEnabled is false');
          liveExecutionPermitted = false;
        }
        if (!liveExecutionPermitted) {
          this.logger.warn(`Live execution not permitted tenant=${input.tenantId} account=${selectedAccount.id} reasons=${liveGateBlockingReasons.join(', ')}`);
        }
      } catch (e: any) {
        this.logger.error(`Failed to check live gate tenant=${input.tenantId} error=${e.message}`);
        liveExecutionPermitted = false;
        liveGateBlockingReasons = ['Live gate check failed - fail closed'];
      }
    } else if (input.environment !== ExchangeEnvironment.LIVE) {
      // Testnet/sandbox never permits live execution
      liveExecutionPermitted = false;
      liveGateBlockingReasons = [`Environment ${input.environment} is not LIVE - live execution never permitted`];
    } else if (input.operation !== 'TRADE') {
      // Read operations don't need live gate
      liveExecutionPermitted = false;
      liveGateBlockingReasons = ['Read operation - live execution not applicable'];
    }

    const decision: ExchangeRoutingDecision = {
      selectedAccountId: selectedAccount.id,
      selectedVenue: selectedAccount.venue,
      environment: selectedAccount.environment,
      eligibleAccounts: rateLimitEligible.map((r) => r.account.id),
      routingReason: `SELECTED_${selectedAccount.venue}_HEALTH_${selectedHealth.state}_LATENCY_${selectedHealth.latencyMs || 'unknown'}`,
      capabilities: selectedAccount.capabilities || this.registry.listCapabilities(selectedAccount.venue),
      health: selectedHealth.state,
      liveExecutionPermitted,
      liveGateBlockingReasons,
      complianceAllowed: true,
      riskAllowed: true,
    };

    await this.auditService.record({
      tenantId: input.tenantId,
      accountId: selectedAccount.id,
      venue: selectedAccount.venue,
      environment: selectedAccount.environment,
      event: 'ROUTING_DECISION',
      result: 'SUCCESS',
      actorId: input.actorId,
      safeMetadata: {
        operation: input.operation,
        symbol: input.symbol,
        requiredCapability: input.requiredCapability,
        selectedAccountId: selectedAccount.id,
        selectedVenue: selectedAccount.venue,
        routingReason: decision.routingReason,
        liveExecutionPermitted,
        liveGateBlockingReasons,
        eligibleCount: eligible.length,
        healthyCount: healthyAccounts.length,
        rateLimitEligibleCount: rateLimitEligible.length,
      },
      requestId: input.requestId,
    });

    this.logger.log(`Routing decision tenant=${input.tenantId} operation=${input.operation} selected=${selectedAccount.id} venue=${selectedAccount.venue} livePermitted=${liveExecutionPermitted}`);

    return decision;
  }

  async getEligibleAccountsForSymbol(tenantId: string, userId: string, symbol: string, environment: ExchangeEnvironment): Promise<string[]> {
    const { data } = await this.accountRepo.listByTenant(tenantId, { userId, environment, status: ExchangeAccountState.ACTIVE, limit: 100 });
    // Further filter by symbol support - would check TradingSymbol table
    const eligible: string[] = [];
    for (const account of data) {
      try {
        const symbolExists = await this.prisma.tradingSymbol.findFirst({ where: { tenantId, symbol } });
        if (symbolExists) eligible.push(account.id);
      } catch {}
    }
    return eligible;
  }
}
