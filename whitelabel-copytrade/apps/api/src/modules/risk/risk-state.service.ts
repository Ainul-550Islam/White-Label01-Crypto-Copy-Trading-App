import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { NotFoundException, ValidationException } from '../../common/errors/app.exception';
import type { RiskEventSeverityWire } from './risk.constants';
import {
  parsePolicyEntries,
  resolveEffectiveLimits,
  toStrategySummary,
  toDailyPnlPoint,
  toProtectionView,
  toRiskEventView,
  toRiskSwitchView,
  toSnapshotMetadataView,
  type KillSwitchLifecycleRow,
  type RiskProtectionRow,
  type RiskSnapshotMetadataRow,
} from './risk.mapper';
import type {
  AccountRiskSummaryView,
  DailyPnlPointView,
  RiskEventView,
  RiskExposureView,
  RiskSnapshotMetadataView,
  RiskStatusView,
  StrategyRiskSummaryView,
} from './risk.types';
import type { DailyPnlQueryDto, ListRiskEventsDto, ListRiskSnapshotsDto } from './dto/risk.dto';
import { RiskPolicyService } from './risk-policy.service';

/**
 * Risk state reads: the durable MIRROR of hot engine state.
 *
 * The one sentence that governs this whole file: every figure here is the
 * latest SYNCED METADATA, timestamped as such - not a live read, and never
 * presented as one. The engine's authoritative snapshot lives in Redis for
 * the engine; PostgreSQL holds what the risk-state worker mirrored, at the
 * configured cadence. An operator looking at "stale" here is looking at the
 * same truth the gate uses to refuse, just one hop later, and the
 * `asOf`/`capturedAt` fields exist so nobody has to wonder which hop it is.
 *
 * There is deliberately NO endpoint that triggers a live re-read from a
 * venue or the engine's Redis keys on demand: "GET risk status" must not be
 * a backdoor load on the hot path, and a synchronous read would produce a
 * number that is already out of date the moment it answers - worse than an
 * honestly labelled mirror.
 */
@Injectable()
export class RiskStateService {
  private static readonly SNAPSHOT_SELECT = {
    id: true,
    accountId: true,
    snapshotId: true,
    snapshotVersion: true,
    tradingDay: true,
    configDigest: true,
    stateDigest: true,
    equity: true,
    accountGrossNotional: true,
    netDailyPnl: true,
    openOrderCount: true,
    staleSources: true,
    advisories: true,
    isComplete: true,
    isSimulated: true,
    capturedAt: true,
  } satisfies Prisma.RiskSnapshotMetadataSelect;

  private static readonly EVENT_SELECT = {
    id: true,
    tenantId: true,
    accountId: true,
    strategyId: true,
    orderId: true,
    eventType: true,
    severity: true,
    code: true,
    message: true,
    limitValue: true,
    observedValue: true,
    venue: true,
    symbol: true,
    ruleId: true,
    scope: true,
    scopeTarget: true,
    action: true,
    source: true,
    snapshotVersion: true,
    isSimulated: true,
    riskDecisionId: true,
    correlationId: true,
    createdAt: true,
  } satisfies Prisma.RiskEventSelect;

  private static readonly EVENT_SORTABLE = ['createdAt', 'severity'] as const;
  private static readonly SNAPSHOT_SORTABLE = ['capturedAt', 'snapshotVersion'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly policy: RiskPolicyService,
    @InjectPinoLogger(RiskStateService.name) private readonly logger: PinoLogger,
  ) {}

  // -- status -----------------------------------------------------------------
  async status(tenantId: string): Promise<RiskStatusView> {
    const summary = this.config.riskSafetySummary;
    const freshWindowMicros = this.config.riskSnapshotRefreshMs * 2 * 1000;

    const [accounts, switches, protections, sinceAgg] = await Promise.all([
      this.prisma.tradingAccount.findMany({
        where: { tenantId },
        select: { id: true },
      }),
      this.prisma.killSwitch.findMany({
        where: { OR: [{ tenantId }, { tenantId: null, scope: 'GLOBAL' }] },
        select: {
          id: true,
          tenantId: true,
          scope: true,
          target: true,
          isEngaged: true,
          reason: true,
          status: true,
          triggeredByRule: true,
          severity: true,
          requiresExplicitClear: true,
          engagedAt: true,
          acknowledgedAt: true,
          clearedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.riskProtectionTrip.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          accountId: true,
          scope: true,
          target: true,
          action: true,
          ruleId: true,
          reason: true,
          status: true,
          acknowledgedAt: true,
          clearedAt: true,
          triggeredAtDateTime: true,
          isSimulated: true,
        },
      }),
      this.prisma.riskEvent.groupBy({
        by: ['severity'],
        where: {
          tenantId,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        _count: { _all: true },
      }),
    ]);

    const latestByAccount: RiskSnapshotMetadataView[] = [];
    const staleAccounts: string[] = [];
    const nowMs = Date.now();
    for (const account of accounts) {
      const latest = (await this.prisma.riskSnapshotMetadata.findFirst({
        where: { accountId: account.id },
        orderBy: { capturedAt: 'desc' },
        select: RiskStateService.SNAPSHOT_SELECT,
      })) as RiskSnapshotMetadataRow | null;
      if (!latest) {
        // No mirrored snapshot at all is the STALEST possible state; an
        // account that has never synced appears as stale, not absent, so
        // the dashboard's silence is never misread as health.
        staleAccounts.push(account.id);
        continue;
      }
      latestByAccount.push(toSnapshotMetadataView(latest));
      const ageMs = nowMs - latest.capturedAt.getTime();
      if (ageMs * 1000 > freshWindowMicros) {
        staleAccounts.push(account.id);
      }
    }

    const eventsLast24hBySeverity: Partial<Record<RiskEventSeverityWire, number>> = {};
    for (const row of sinceAgg) {
      eventsLast24hBySeverity[row.severity as RiskEventSeverityWire] = row._count._all;
    }

    const engaged = switches.filter((row) => row.isEngaged);
    const triggered = protections.length;

    return {
      engineEnabled: summary.engineEnabled,
      failClosed: summary.failClosed,
      maxRiskStateAgeMs: summary.maxRiskStateAgeMs,
      snapshotRefreshMs: summary.snapshotRefreshMs,
      refreshOutpacesStaleness: summary.refreshOutpacesStaleness,
      platformCeilings: summary.ceilings as unknown as Record<string, string | number>,
      engagedSwitchCount: engaged.length,
      triggeredProtectionCount: triggered,
      latestSnapshotPerAccount: latestByAccount,
      staleAccounts,
      eventsLast24hBySeverity,
      note: summary.note,
    };
  }

  // -- events -----------------------------------------------------------------
  async listEvents(
    tenantId: string,
    query: ListRiskEventsDto,
  ): Promise<PaginatedResult<RiskEventView>> {
    const pagination = normalisePagination(query, RiskStateService.EVENT_SORTABLE);
    const where: Prisma.RiskEventWhereInput = { tenantId };
    if (query.accountId) where.accountId = query.accountId;
    if (query.strategyId) where.strategyId = query.strategyId;
    if (query.severity) where.severity = query.severity;
    if (query.ruleId) where.ruleId = query.ruleId;
    if (query.includeSimulated !== true) where.isSimulated = false;
    if (query.since || query.until) {
      where.createdAt = {
        ...(query.since ? { gte: this.parseDate(query.since, 'since') } : {}),
        ...(query.until ? { lt: this.parseDate(query.until, 'until') } : {}),
      };
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.riskEvent.findMany({
        where,
        orderBy: this.eventOrderBy(pagination.sortBy, pagination.sortOrder),
        skip: pagination.skip,
        take: pagination.take,
        select: RiskStateService.EVENT_SELECT,
      }),
      this.prisma.riskEvent.count({ where }),
    ]);
    return {
      items: rows.map((row) => toRiskEventView(row)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  // -- snapshot metadata --------------------------------------------------------
  async listSnapshots(
    tenantId: string,
    query: ListRiskSnapshotsDto,
  ): Promise<PaginatedResult<RiskSnapshotMetadataView>> {
    await this.requireAccount(tenantId, query.accountId);
    const pagination = normalisePagination(query, RiskStateService.SNAPSHOT_SORTABLE);
    const where: Prisma.RiskSnapshotMetadataWhereInput = {
      tenantId,
      accountId: query.accountId,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.riskSnapshotMetadata.findMany({
        where,
        orderBy: this.snapshotOrderBy(pagination.sortBy, pagination.sortOrder),
        skip: pagination.skip,
        take: pagination.take,
        select: RiskStateService.SNAPSHOT_SELECT,
      }),
      this.prisma.riskSnapshotMetadata.count({ where }),
    ]);
    return {
      items: rows.map((row) => toSnapshotMetadataView(row as RiskSnapshotMetadataRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  // -- exposure -------------------------------------------------------------------
  async exposure(tenantId: string, accountId: string): Promise<RiskExposureView> {
    await this.requireAccount(tenantId, accountId);
    const latest = (await this.prisma.riskSnapshotMetadata.findFirst({
      where: { tenantId, accountId },
      orderBy: { capturedAt: 'desc' },
      select: RiskStateService.SNAPSHOT_SELECT,
    })) as RiskSnapshotMetadataRow | null;
    const switchRow = (await this.prisma.killSwitch.findFirst({
      where: {
        OR: [
          { tenantId, scope: 'ACCOUNT', target: accountId, isEngaged: true },
          { tenantId, scope: 'RISK', target: `account:${accountId}`, isEngaged: true },
          { tenantId: null, scope: 'GLOBAL', isEngaged: true },
        ],
      },
      orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        tenantId: true,
        scope: true,
        target: true,
        isEngaged: true,
        reason: true,
        status: true,
        triggeredByRule: true,
        severity: true,
        requiresExplicitClear: true,
        engagedAt: true,
        acknowledgedAt: true,
        clearedAt: true,
        updatedAt: true,
      },
    })) as KillSwitchLifecycleRow | null;
    const protectionRows = await this.prisma.riskProtectionTrip.findMany({
      where: { tenantId, accountId, status: 'ACTIVE' },
      orderBy: { triggeredAtDateTime: 'desc' },
      take: 20,
      select: {
        id: true,
        accountId: true,
        scope: true,
        target: true,
        action: true,
        ruleId: true,
        reason: true,
        status: true,
        acknowledgedAt: true,
        clearedAt: true,
        triggeredAtDateTime: true,
        isSimulated: true,
      },
    });
    return {
      accountId,
      asOf: latest ? latest.capturedAt.toISOString() : null,
      snapshotVersion: latest ? latest.snapshotVersion.toString() : null,
      configDigest: latest ? latest.configDigest : null,
      equity: latest ? (latest.equity?.toString() ?? null) : null,
      accountGrossNotional: latest ? (latest.accountGrossNotional?.toString() ?? null) : null,
      netDailyPnl: latest ? (latest.netDailyPnl?.toString() ?? null) : null,
      openOrderCount: latest ? latest.openOrderCount : null,
      blocking: switchRow ? toRiskSwitchView(switchRow) : null,
      activeProtections: protectionRows.map((row) => toProtectionView(row as RiskProtectionRow)),
      staleSources: latest ? this.stringArray(latest.staleSources) : ['never-synced'],
      isComplete: latest ? latest.isComplete : null,
    };
  }

  // -- daily PnL ---------------------------------------------------------------------
  async dailyPnl(tenantId: string, query: DailyPnlQueryDto): Promise<DailyPnlPointView[]> {
    await this.requireAccount(tenantId, query.accountId);
    const day =
      query.day ?? new Date().toISOString().slice(0, 10); // UTC by construction
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new ValidationException([
        { field: 'day', constraint: 'isoDate', message: 'day must be YYYY-MM-DD' },
      ]);
    }
    const rows = await this.prisma.riskSnapshotMetadata.findMany({
      where: { tenantId, accountId: query.accountId, tradingDay: day },
      orderBy: { capturedAt: 'asc' },
      select: RiskStateService.SNAPSHOT_SELECT,
    });
    return rows.map((row) => toDailyPnlPoint(row as RiskSnapshotMetadataRow));
  }

  // -- account summary ----------------------------------------------------------------
  async accountSummary(tenantId: string, accountId: string): Promise<AccountRiskSummaryView> {
    await this.requireAccount(tenantId, accountId);
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { id: true, label: true },
    });
    const [configView, exposure, switches, protections, events] = await Promise.all([
      this.policy.getConfig(tenantId, accountId).catch(() => null),
      this.exposure(tenantId, accountId),
      this.prisma.killSwitch.findMany({
        where: {
          tenantId,
          isEngaged: true,
          OR: [
            { scope: 'ACCOUNT', target: accountId },
            { scope: 'RISK', target: `account:${accountId}` },
          ],
        },
        select: {
          id: true,
          tenantId: true,
          scope: true,
          target: true,
          isEngaged: true,
          reason: true,
          status: true,
          triggeredByRule: true,
          severity: true,
          requiresExplicitClear: true,
          engagedAt: true,
          acknowledgedAt: true,
          clearedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.riskProtectionTrip.findMany({
        where: { tenantId, accountId, status: 'ACTIVE' },
        orderBy: { triggeredAtDateTime: 'desc' },
        take: 10,
        select: {
          id: true,
          accountId: true,
          scope: true,
          target: true,
          action: true,
          ruleId: true,
          reason: true,
          status: true,
          acknowledgedAt: true,
          clearedAt: true,
          triggeredAtDateTime: true,
          isSimulated: true,
        },
      }),
      this.prisma.riskEvent.findMany({
        where: { tenantId, accountId, isSimulated: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: RiskStateService.EVENT_SELECT,
      }),
    ]);
    const entries = configView
      ? parsePolicyEntries((configView.policyJson ?? null) as Prisma.JsonValue)
      : [];
    return {
      accountId,
      accountLabel: account?.label ?? 'unknown',
      configVersion: configView?.version ?? 0,
      configDigest: configView?.digest ?? null,
      exposure,
      dailyPnl: await this.dailyPnl(tenantId, { accountId }),
      engagedSwitches: switches.map((row) => toRiskSwitchView(row as KillSwitchLifecycleRow)),
      activeProtections: protections.map((row) => toProtectionView(row as RiskProtectionRow)),
      recentEvents: events.map((row) => toRiskEventView(row)),
      effectiveLimits: resolveEffectiveLimits(entries, {
        exchange: null,
        accountId,
        strategyId: null,
        symbol: null,
        nowMicros: Date.now() * 1000,
      }),
    };
  }

  // -- strategy summary ------------------------------------------------------------------
  async strategySummary(tenantId: string, strategyId: string): Promise<StrategyRiskSummaryView> {
    const strategy = await this.prisma.strategy.findFirst({
      where: { id: strategyId, tenantId },
      select: { id: true },
    });
    if (!strategy) {
      throw new NotFoundException('Strategy not found for this organisation.');
    }
    const configs = await this.prisma.riskConfiguration.findMany({
      where: { tenantId },
      select: { policyJson: true, accountId: true },
    });
    const scopeEntries = configs
      .flatMap((row) => {
        try {
          return parsePolicyEntries(row.policyJson).filter(
            (entry) => entry.scope === 'STRATEGY' && entry.target === strategyId,
          );
        } catch {
          // A corrupt document on ANOTHER account must not blank this view;
          // it stays visible in that account's own read, loudly.
          return [];
        }
      })
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    const switchRow = (await this.prisma.killSwitch.findFirst({
      where: { tenantId, scope: 'STRATEGY', target: strategyId, isEngaged: true },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        tenantId: true,
        scope: true,
        target: true,
        isEngaged: true,
        reason: true,
        status: true,
        triggeredByRule: true,
        severity: true,
        requiresExplicitClear: true,
        engagedAt: true,
        acknowledgedAt: true,
        clearedAt: true,
        updatedAt: true,
      },
    })) as KillSwitchLifecycleRow | null;
    const events = await this.prisma.riskEvent.findMany({
      where: { tenantId, strategyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: RiskStateService.EVENT_SELECT,
    });
    return toStrategySummary({
      strategyId,
      scopeEntries,
      switch: switchRow ? toRiskSwitchView(switchRow) : null,
      recentEvents: events.map((row) => toRiskEventView(row)),
    });
  }

  private eventOrderBy(
    sortBy: string | undefined,
    sortOrder: string,
  ): Prisma.RiskEventOrderByWithRelationInput {
    const direction = sortOrder as 'asc' | 'desc';
    switch (sortBy) {
      case 'severity':
        return { severity: direction };
      default:
        return { createdAt: direction };
    }
  }

  private snapshotOrderBy(
    sortBy: string | undefined,
    sortOrder: string,
  ): Prisma.RiskSnapshotMetadataOrderByWithRelationInput {
    const direction = sortOrder as 'asc' | 'desc';
    switch (sortBy) {
      case 'snapshotVersion':
        return { snapshotVersion: direction };
      default:
        return { capturedAt: direction };
    }
  }

  // -- helpers ---------------------------------------------------------------------------
  private async requireAccount(tenantId: string, accountId: string): Promise<void> {
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('Trading account not found for this organisation.');
    }
  }

  private parseDate(value: string, field: 'since' | 'until'): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationException([
        { field, constraint: 'isoDateTime', message: `${field} must be an ISO timestamp` },
      ]);
    }
    return date;
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? (value as string[])
      : [];
  }
}

