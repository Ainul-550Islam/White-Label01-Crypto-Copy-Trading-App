import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditActorType, AuditAction, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { ConflictException, NotFoundException } from '../../common/errors/app.exception';
import {
  toAccountConnectivityView,
  toBalanceView,
  toExchangeAccountView,
  toStreamSessionView,
  type TradingAccountRow,
} from './execution.mapper';
import type {
  AccountConnectivityView,
  BalanceView,
  ExchangeAccountView,
  StreamSessionView,
} from './execution.types';
import { PlanLimitExchangeAccountsGuard } from '../billing/enforcement/plan-limit-exchange-accounts.guard';
import type { EnforcementActor } from '../billing/enforcement/enforcement.types';

/**
 * Read and administer exchange accounts.
 *
 * Two invariants hold across every method:
 *
 *   1. `tenantId` always comes from the authenticated context and is always in
 *      the `where` clause. It is never read from a body, a query parameter or
 *      a path segment. A caller who knows another tenant's account UUID gets a
 *      404, not that tenant's data.
 *
 *   2. The Prisma `select` never includes `apiKeyCiphertext`,
 *      `apiSecretCiphertext`, `passphraseCiphertext` or `encryptedDataKey`.
 *      Those columns are not needed to render anything, so they are not read;
 *      a value that never enters the process cannot leak from it.
 *
 * Enforcement integration (Part 2):
 *  - maxExchangeAccountsPerUser enforced via PlanLimitExchangeAccountsGuard
 *  - Guard uses atomic Lua reservation, per-user scoped
 *  - No hardcoded limits, resolves from plan catalog
 */
@Injectable()
export class ExchangeAccountsService {
  /**
   * Columns safe to load for a view. Written as a shared constant rather than
   * repeated per query so there is exactly one place to review, and so adding
   * a query cannot accidentally widen the projection.
   */
  private static readonly ACCOUNT_SELECT = {
    id: true,
    tenantId: true,
    userId: true,
    label: true,
    status: true,
    marketType: true,
    tradingMode: true,
    isSandbox: true,
    liveTradingEnabled: true,
    privateStreamEnabled: true,
    credentialSource: true,
    credentialRef: true,
    verifiedPermissions: true,
    credentialRotatedAt: true,
    credentialExpiresAt: true,
    apiKeyLastFour: true,
    canTrade: true,
    canReadData: true,
    canWithdraw: true,
    ipRestricted: true,
    lastVerifiedAt: true,
    lastFailureAt: true,
    lastFailureCode: true,
    consecutiveFailures: true,
    createdAt: true,
    updatedAt: true,
    exchange: { select: { venue: true } },
  } satisfies Prisma.TradingAccountSelect;

  private static readonly SESSION_SELECT = {
    id: true,
    venue: true,
    status: true,
    listenKeyMasked: true,
    connectedAt: true,
    disconnectedAt: true,
    lastEventAt: true,
    reconnectCount: true,
    eventsReceived: true,
    executionReports: true,
    parseErrors: true,
    listenKeyRenewals: true,
    listenKeyRenewalFailures: true,
    lastReconciledAt: true,
    lastErrorCode: true,
    workerId: true,
  } satisfies Prisma.ExchangeStreamSessionSelect;

  private static readonly RUN_SELECT = {
    id: true,
    accountId: true,
    venue: true,
    status: true,
    trigger: true,
    startedAt: true,
    finishedAt: true,
    durationMicros: true,
    ordersChecked: true,
    fillsRecovered: true,
    discrepanciesFound: true,
    discrepanciesRepaired: true,
    error: true,
    workerId: true,
  } satisfies Prisma.ReconciliationRunSelect;

  private static readonly SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'label', 'status'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly exchangeAccountsLimitGuard: PlanLimitExchangeAccountsGuard,
    @InjectPinoLogger(ExchangeAccountsService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Enforcement helpers (Part 2)
  // ---------------------------------------------------------------------------

  /**
   * Check whether a user can link another exchange account.
   * Uses atomic reservation to prevent race-condition over-allocation.
   * Throws PlanLimitExceededError when limit reached.
   */
  async checkCanLinkExchangeAccount(
    actor: EnforcementActor,
    userId: string,
  ): Promise<{ allowed: boolean; currentUsage: number; maximum: number | null; remaining: number | null }> {
    const result = await this.exchangeAccountsLimitGuard.canLink(actor, userId);
    return {
      allowed: result.allowed,
      currentUsage: result.currentUsage,
      maximum: result.configuredMaximum,
      remaining: result.remaining,
    };
  }

  /**
   * Reserve an exchange account slot for a user (atomic).
   * Must be called before persisting a new exchange account.
   * On persistence failure, caller must call releaseExchangeAccountSlot().
   */
  async reserveExchangeAccountSlot(actor: EnforcementActor, userId: string): Promise<void> {
    await this.exchangeAccountsLimitGuard.reserve(actor, userId);
  }

  /**
   * Release a previously reserved exchange account slot.
   * Called when creation fails after reservation.
   */
  async releaseExchangeAccountSlot(actor: EnforcementActor, userId: string): Promise<void> {
    await this.exchangeAccountsLimitGuard.release(actor, userId);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(filter: {
    tenantId: string;
    /** Set for a non-privileged caller so they only see their own accounts. */
    restrictToUserId?: string;
    status?: string;
    venue?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
  }): Promise<PaginatedResult<ExchangeAccountView>> {
    const pagination = normalisePagination(filter, ExchangeAccountsService.SORTABLE_FIELDS);

    const where: Prisma.TradingAccountWhereInput = {
      tenantId: filter.tenantId,
      deletedAt: null,
      ...(filter.restrictToUserId ? { userId: filter.restrictToUserId } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.venue ? { exchange: { venue: filter.venue as never } } : {}),
      ...(pagination.search ? { label: { contains: pagination.search, mode: 'insensitive' } } : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.tradingAccount.findMany({
        where,
        select: ExchangeAccountsService.ACCOUNT_SELECT,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.tradingAccount.count({ where }),
    ]);

    return {
      items: rows.map((row) => toExchangeAccountView(row as TradingAccountRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async get(
    tenantId: string,
    accountId: string,
    restrictToUserId?: string,
  ): Promise<ExchangeAccountView> {
    return toExchangeAccountView(await this.requireAccount(tenantId, accountId, restrictToUserId));
  }

  /**
   * Everything an operator needs to answer "is this account working".
   *
   * Assembled from five counts in one transaction rather than five round trips:
   * a connectivity panel that refreshes on a timer is the most frequently hit
   * endpoint in an operations UI, and it should not cost five queries each time.
   */
  async connectivity(
    tenantId: string,
    accountId: string,
    restrictToUserId?: string,
  ): Promise<AccountConnectivityView> {
    const account = await this.requireAccount(tenantId, accountId, restrictToUserId);

    const [session, lastRun, openIncidents, criticalIncidents, unreconciledOrders] =
      await this.prisma.$transaction([
        this.prisma.exchangeStreamSession.findFirst({
          where: { tenantId, accountId },
          select: ExchangeAccountsService.SESSION_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.reconciliationRun.findFirst({
          where: { tenantId, accountId },
          select: ExchangeAccountsService.RUN_SELECT,
          orderBy: { startedAt: 'desc' },
        }),
        this.prisma.executionIncident.count({ where: { tenantId, accountId, resolvedAt: null } }),
        this.prisma.executionIncident.count({
          where: { tenantId, accountId, resolvedAt: null, severity: 'CRITICAL' },
        }),
        this.prisma.order.count({
          where: {
            tenantId,
            accountId,
            reconciliationState: { in: ['UNKNOWN', 'PENDING_RECONCILIATION', 'DIVERGED'] },
          },
        }),
      ]);

    return toAccountConnectivityView({
      account,
      session,
      lastRun,
      openIncidents,
      criticalIncidents,
      unreconciledOrders,
    });
  }

  /**
   * Latest balance per asset.
   *
   * Zero balances are excluded by default. A venue reports every asset it has
   * ever heard of, and a spot account routinely carries two hundred dust rows;
   * returning them all makes the useful three impossible to find.
   */
  async balances(
    tenantId: string,
    accountId: string,
    options: { includeZero?: boolean; restrictToUserId?: string } = {},
  ): Promise<BalanceView[]> {
    await this.requireAccount(tenantId, accountId, options.restrictToUserId);

    const rows = await this.prisma.accountBalanceSnapshot.findMany({
      where: {
        tenantId,
        accountId,
        ...(options.includeZero ? {} : { total: { gt: 0 } }),
      },
      select: {
        asset: true,
        free: true,
        locked: true,
        total: true,
        venueUpdatedAtMicros: true,
        observedAtMicros: true,
        isSimulated: true,
      },
      orderBy: [{ total: 'desc' }, { asset: 'asc' }],
    });

    return rows.map(toBalanceView);
  }

  async streamSessions(
    tenantId: string,
    accountId: string,
    restrictToUserId?: string,
  ): Promise<StreamSessionView[]> {
    await this.requireAccount(tenantId, accountId, restrictToUserId);

    const rows = await this.prisma.exchangeStreamSession.findMany({
      where: { tenantId, accountId },
      select: ExchangeAccountsService.SESSION_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return rows.map(toStreamSessionView);
  }

  // ---------------------------------------------------------------------------
  // Administrative controls
  // ---------------------------------------------------------------------------

  /**
   * Enable or disable an account for trading.
   *
   * Disabling is always permitted and takes effect immediately. Enabling is
   * refused unless the credential has been verified against the venue, because
   * an account whose key was never checked will fail on its first order - and
   * it will fail after the risk engine has already reserved exposure for it.
   */
  async setEnabled(
    tenantId: string,
    accountId: string,
    enabled: boolean,
    actor: { userId: string; requestId?: string | null },
    reason: string,
  ): Promise<ExchangeAccountView> {
    const account = await this.requireAccount(tenantId, accountId);

    if (enabled) {
      if (account.lastVerifiedAt === null) {
        throw new ConflictException(
          'This account cannot be enabled because its credentials have never been verified ' +
            'against the venue. Run a verification first.',
        );
      }
      if (account.canWithdraw) {
        throw new ConflictException(
          'This account cannot be enabled because the venue reports the API key has ' +
            'withdrawal permission. Issue a new key without withdrawal rights.',
        );
      }
      if (!account.canTrade) {
        throw new ConflictException(
          'This account cannot be enabled because the venue reports the API key cannot ' +
            'trade. Enable spot trading on the key at the venue and verify again.',
        );
      }
    }

    const updated = await this.prisma.tradingAccount.update({
      where: { id: accountId },
      data: {
        status: enabled ? 'ACTIVE' : 'DISABLED',
        // Disabling an account disarms live trading with it. Re-enabling never
        // re-arms: that is a separate, deliberate second action.
        ...(enabled ? {} : { liveTradingEnabled: false }),
      },
      select: ExchangeAccountsService.ACCOUNT_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: enabled ? AuditAction.EXCHANGE_ACCOUNT_ENABLED : AuditAction.EXCHANGE_ACCOUNT_DISABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'trading_account',
      resourceId: accountId,
      description: sanitiseForLog(reason, 500),
      changes: {
        status: { before: account.status, after: enabled ? 'ACTIVE' : 'DISABLED' },
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.warn(
      {
        event: 'execution.account_enabled_changed',
        tenantId,
        accountId,
        enabled,
        actorId: actor.userId,
      },
      'Exchange account availability changed',
    );

    return toExchangeAccountView(updated as TradingAccountRow);
  }

  /**
   * Arm or disarm live trading for one account.
   *
   * This is the human half of the live-trading gate. The other half is the
   * deployment configuration, and both must agree. Arming is refused when the
   * deployment is in dry-run, paper or sandbox mode - not because the order
   * would slip through (the engine checks again before every submission), but
   * because leaving a flag set to `true` that has no effect trains operators to
   * ignore it, and one day the deployment changes underneath it.
   */
  async setLiveTrading(
    tenantId: string,
    accountId: string,
    enabled: boolean,
    actor: { userId: string; requestId?: string | null },
    reason: string,
  ): Promise<ExchangeAccountView> {
    const account = await this.requireAccount(tenantId, accountId);

    if (enabled) {
      const blockers = this.deploymentBlockersForLiveTrading();
      if (blockers.length > 0) {
        throw new ConflictException(
          `Live trading cannot be armed on this account while the deployment is not ` +
            `configured for it: ${blockers.join('; ')}.`,
        );
      }
      if (account.status !== 'ACTIVE') {
        throw new ConflictException(
          'Live trading can only be armed on an ACTIVE account. Enable the account first.',
        );
      }
      if (account.isSandbox) {
        throw new ConflictException(
          'This account points at the venue sandbox. Live trading against a sandbox is a ' +
            'contradiction; create a production account instead.',
        );
      }
      if (!account.canTrade || account.canWithdraw) {
        throw new ConflictException(
          'The venue-reported permissions on this key do not allow arming live trading.',
        );
      }
      if (account.consecutiveFailures > 0) {
        throw new ConflictException(
          'This account has unresolved credential failures. Verify the credentials before ' +
            'arming live trading.',
        );
      }
    }

    const updated = await this.prisma.tradingAccount.update({
      where: { id: accountId },
      data: {
        liveTradingEnabled: enabled,
        tradingMode: enabled ? 'LIVE' : 'PAPER',
      },
      select: ExchangeAccountsService.ACCOUNT_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: enabled ? AuditAction.LIVE_TRADING_ENABLED : AuditAction.LIVE_TRADING_DISABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'trading_account',
      resourceId: accountId,
      description: sanitiseForLog(reason, 500),
      changes: {
        liveTradingEnabled: { before: account.liveTradingEnabled, after: enabled },
        tradingMode: { before: account.tradingMode, after: enabled ? 'LIVE' : 'PAPER' },
      },
      requestId: actor.requestId ?? null,
    });

    // Logged at error level when arming. This is not an error; it is the single
    // most consequential state change the platform supports, and it should be
    // impossible to miss in a log search.
    const logPayload = {
      event: 'execution.live_trading_changed',
      tenantId,
      accountId,
      enabled,
      actorId: actor.userId,
      deploymentTradingMode: this.config.tradingMode,
    };
    if (enabled) {
      this.logger.error(logPayload, 'LIVE TRADING ARMED on exchange account');
    } else {
      this.logger.warn(logPayload, 'Live trading disarmed on exchange account');
    }

    return toExchangeAccountView(updated as TradingAccountRow);
  }

  async setPrivateStream(
    tenantId: string,
    accountId: string,
    enabled: boolean,
    actor: { userId: string; requestId?: string | null },
    reason: string,
  ): Promise<ExchangeAccountView> {
    const account = await this.requireAccount(tenantId, accountId);

    if (enabled && account.lastVerifiedAt === null) {
      throw new ConflictException(
        'The private user-data stream requires a verified credential: obtaining a listen key ' +
          'is itself a signed request.',
      );
    }

    const updated = await this.prisma.tradingAccount.update({
      where: { id: accountId },
      data: { privateStreamEnabled: enabled },
      select: ExchangeAccountsService.ACCOUNT_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: enabled ? AuditAction.PRIVATE_STREAM_ENABLED : AuditAction.PRIVATE_STREAM_DISABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'trading_account',
      resourceId: accountId,
      description: sanitiseForLog(reason, 500),
      changes: { privateStreamEnabled: { before: account.privateStreamEnabled, after: enabled } },
      requestId: actor.requestId ?? null,
    });

    return toExchangeAccountView(updated as TradingAccountRow);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Loads an account inside the tenant, or throws 404.
   *
   * `restrictToUserId` narrows further for callers who may only see their own
   * accounts. Both filters are applied in the query, not checked afterwards: a
   * post-hoc check is a timing side channel and, more practically, one early
   * `return` away from being skipped.
   */
  private async requireAccount(
    tenantId: string,
    accountId: string,
    restrictToUserId?: string,
  ): Promise<TradingAccountRow> {
    const account = await this.prisma.tradingAccount.findFirst({
      where: {
        id: accountId,
        tenantId,
        deletedAt: null,
        ...(restrictToUserId ? { userId: restrictToUserId } : {}),
      },
      select: ExchangeAccountsService.ACCOUNT_SELECT,
    });

    if (!account) {
      // Deliberately indistinguishable from "exists but belongs to another
      // tenant". Probing for account ids must not be productive.
      throw new NotFoundException('Exchange account not found.');
    }

    return account as TradingAccountRow;
  }

  /** Every deployment-level reason live trading is currently impossible. */
  private deploymentBlockersForLiveTrading(): string[] {
    const blockers: string[] = [];
    if (!this.config.executionEnabled) {
      blockers.push('EXECUTION_ENABLED is false');
    }
    if (this.config.dryRun) {
      blockers.push('DRY_RUN is true, so nothing is transmitted');
    }
    if (this.config.paperTrading) {
      blockers.push('PAPER_TRADING is true, so orders route to the simulator');
    }
    if (!this.config.liveTradingEnabled) {
      blockers.push('LIVE_TRADING_ENABLED is false');
    }
    if (this.config.exchangeSandboxMode) {
      blockers.push('EXCHANGE_SANDBOX_MODE is true, so adapters target testnet');
    }
    return blockers;
  }
}
