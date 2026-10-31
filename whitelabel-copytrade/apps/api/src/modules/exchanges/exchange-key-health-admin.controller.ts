// # Responsibility: the operator console's read of every tenant key's capability health — one page of accounts, each evaluated through AccountCapabilityHealthService, so a degraded or risky key is visible before a customer reports it.
//
// WHAT THIS ADDS
// --------------
// `AccountCapabilityHealthService` computes, for one account, whether the venue
// key can still read, trade and withdraw, and what a human must do about it. Until
// now nothing exposed that matrix for a whole tenant: the capability rules were
// reachable only from a unit test. An operator who needs to answer "are any keys in
// this tenant unable to trade?" had to read the database.
//
// The controller is read-only on purpose. Every remediation it can recommend -
// reconnect the key, rotate a withdrawal-enabled key, re-verify permissions - is an
// existing, step-up gated exchange-account action. Duplicating those here would
// create a second write path to credentials, which is the one place a second path
// is least affordable.
//
// It is mounted under `admin/` and behind `@RequirePermissions`, so a customer
// JWT cannot read another member's key posture through it; the tenant is always the
// caller's own, resolved from the JWT.
import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { Permission } from '@wlct/shared-types';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import {
  AccountCapabilityHealthService,
  type AccountCapabilityHealth,
} from './account-capability-health.service';
import {
  ExchangeAccountRepository,
  type ExchangeAccountRecord,
} from './exchange-account.repository';
import {
  ExchangeAccountState,
  ExchangeCapability,
  ExchangeEnvironment,
  ExchangeVenue,
} from './exchange.types';

/**
 * Query-string shape errors are 400s: the request is malformed, not forbidden,
 * and the message names the bound the caller crossed.
 */
class QueryShapeError extends BadRequestException {}

/**
 * `limit` ceiling the console may ask for, and the hard cap on rows the matrix is
 * computed for per call. One constant, because two would let `limit` climb past
 * what the page will actually evaluate.
 */
const MAX_LIMIT = 200;

const ACCOUNT_STATES = Object.values(ExchangeAccountState) as string[];
const VENUES = Object.values(ExchangeVenue) as string[];

/** One account's row: the account facts an operator needs beside the verdict. */
export interface ExchangeKeyHealthRow extends AccountCapabilityHealth {
  label: string;
  userId: string | null;
  accountState: ExchangeAccountState;
  environment: ExchangeEnvironment;
  liveTradingEnabled: boolean;
  apiKeyLastFour: string | null;
}

export interface ExchangeKeyHealthPage {
  data: ExchangeKeyHealthRow[];
  total: number;
  /** How many of `total` the page examined; the matrix is not paginated inside the repository. */
  evaluated: number;
  /** Counts over the rows evaluated, which is what the console summarises. */
  summary: {
    healthy: number;
    degraded: number;
    risk: number;
    unhealthy: number;
    unknown: number;
    requiresAction: number;
  };
}

/**
 * How a key's stored capability list maps onto the three permission booleans the
 * matrix reasons about. Returns `null` for "never verified" - which is what an
 * empty list means here: `TradingAccount.verifiedPermissions` is only written by
 * a verification that succeeded, so [] is a key nothing is known about yet.
 *
 * No capability maps to withdrawal. `WITHDRAWALS` is a venue feature the account
 * may request, not a granted permission, and treating it as `canWithdraw: true`
 * would invent the one flag that must never be inferred.
 */
function permissionFacts(capabilities: readonly ExchangeCapability[]): {
  canReadData: boolean | null;
  canTrade: boolean | null;
  canWithdraw: boolean | null;
} {
  if (capabilities.length === 0) return { canReadData: null, canTrade: null, canWithdraw: null };
  const trades = capabilities.includes(ExchangeCapability.ORDERS) || capabilities.includes(ExchangeCapability.TRADES);
  const reads =
    capabilities.includes(ExchangeCapability.BALANCES) ||
    capabilities.includes(ExchangeCapability.POSITIONS) ||
    capabilities.includes(ExchangeCapability.MARKET_DATA);
  return { canReadData: reads, canTrade: trades, canWithdraw: false };
}

/**
 * `page`/`limit` arrive as strings from the query string. `@Type(() => Number)`
 * is not usable here because this controller deliberately keeps untyped query
 * handlers consistent with the rest of the module and validates explicitly, so
 * an out-of-range value is a 400 with the expected bound rather than a silent
 * coercion.
 */
function positiveInt(raw: unknown, name: string, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new QueryShapeError(`${name} must be a positive integer`);
  if (value > max) throw new QueryShapeError(`${name} must not exceed ${max}`);
  return value;
}

function enumValue<T extends string>(raw: unknown, allowed: readonly T[], name: string): T | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = String(raw).trim().toUpperCase();
  const match = allowed.find((candidate) => candidate === value);
  if (!match) throw new QueryShapeError(`${name} must be one of: ${allowed.join(', ')}`);
  return match;
}

@Controller('admin/exchanges/key-health')
export class ExchangeKeyHealthAdminController {
  constructor(
    private readonly accounts: ExchangeAccountRepository,
    private readonly capabilityHealth: AccountCapabilityHealthService,
  ) {}

  /**
   * The tenant's key posture, one row per account.
   *
   * `total` is the repository's own count for the same filters, so an operator
   * who sees "total 240, evaluated 100" knows the page is partial rather than
   * believing the tenant has a hundred accounts. `summary` counts only what was
   * evaluated and says so on the wire, because a summary over a truncated page
   * presented as a tenant-wide figure is exactly the kind of number an operator
   * would quote.
   */
  @Get()
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ)
  async list(
    @TenantId() tenantId: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('venue') venueRaw?: string,
    @Query('status') statusRaw?: string,
    @Query('userId') userIdRaw?: string,
    @Query('environment') environmentRaw?: string,
  ): Promise<ExchangeKeyHealthPage> {
    const page = positiveInt(pageRaw, 'page', 1, 10_000);
    const limit = positiveInt(limitRaw, 'limit', 20, MAX_LIMIT);
    const venue = enumValue(venueRaw, VENUES, 'venue') as ExchangeVenue | undefined;
    const status = enumValue(statusRaw, ACCOUNT_STATES, 'status') as ExchangeAccountState | undefined;
    const environment = enumValue(environmentRaw, Object.values(ExchangeEnvironment) as string[], 'environment') as
      | ExchangeEnvironment
      | undefined;
    const userId = userIdRaw ? String(userIdRaw).trim() : undefined;

    const { data, total } = await this.accounts.listByTenant(tenantId, {
      page,
      limit,
      venue,
      status,
      environment,
      userId: userId && userId.length > 0 ? userId : undefined,
    });

    const rows = data.map((account) => this.toRow(account));
    return {
      data: rows,
      total,
      evaluated: rows.length,
      summary: {
        healthy: rows.filter((row) => row.overall === 'HEALTHY').length,
        degraded: rows.filter((row) => row.overall === 'DEGRADED').length,
        risk: rows.filter((row) => row.overall === 'RISK').length,
        unhealthy: rows.filter((row) => row.overall === 'UNHEALTHY').length,
        unknown: rows.filter((row) => row.overall === 'UNKNOWN').length,
        requiresAction: rows.filter((row) => row.requiresAction.length > 0).length,
      },
    };
  }

  /**
   * The stored record already carries a derived `healthState` and the verified
   * permission list; `evaluate` turns those same facts into the per-capability
   * matrix. No venue call is made here: a console refresh must not spend a
   * customer's rate limit or touch a credential.
   */
  private toRow(account: ExchangeAccountRecord): ExchangeKeyHealthRow {
    const permissions = permissionFacts(account.capabilities);
    const health = this.capabilityHealth.evaluate({
      tenantId: account.tenantId,
      accountId: account.id,
      venue: account.venue,
      environment: account.environment,
      accountState: account.status,
      healthState: account.healthState,
      // The record does not store the raw permission booleans; the verified
      // capability list is the durable evidence, so a capability is "granted"
      // when the list contains it and "never verified" when the list is empty.
      canReadData: permissions.canReadData,
      canTrade: permissions.canTrade,
      canWithdraw: permissions.canWithdraw,
      verifiedPermissions: account.capabilities,
      lastVerifiedAt: account.lastVerifiedAt,
      lastFailureCode: account.lastErrorCode,
      consecutiveFailures: account.consecutiveFailures,
      credentialExpiresAt: account.credentialExpiresAt,
    });

    return {
      ...health,
      label: account.label,
      userId: account.userId,
      accountState: account.status,
      environment: account.environment,
      liveTradingEnabled: account.liveTradingEnabled,
      apiKeyLastFour: account.apiKeyLastFour,
    };
  }
}
