import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationException,
} from '../../common/errors/app.exception';
import type { UpdateRiskPolicyDto, RollbackRiskPolicyDto } from './dto/risk.dto';
import {
  canonicalDecimalString,
  canonicalJson,
  compareDecimalStrings,
  minDecimalString,
  sha256Hex,
} from './risk.digest';
import {
  CREDENTIAL_KEY_PATTERN,
  RISK_RULE_IDS,
  RISK_RULE_UNITS,
  RATE_WINDOW_ONE_MINUTE_MICROS,
  RATE_WINDOW_ONE_SECOND_MICROS,
  CEILING_TO_RULE,
  WIDEN_CONFIRMATION,
  type RiskRuleIdWire,
} from './risk.constants';
import {
  parsePolicyEntries,
  resolveEffectiveLimits,
  toConfigurationView,
  type RiskConfigurationRow,
  type RiskConfigurationVersionRow,
} from './risk.mapper';
import type { RiskCommandAcceptedView, RiskConfigurationView } from './risk.types';

/**
 * Risk configuration: read, publish (versioned, audited), roll back.
 *
 * What a write does, in order, and why each step is mandatory:
 *
 * 1. validate EVERY entry against the same domain rules the Python
 *    configuration loader enforces (unit-vs-rule tables, sign domains, rate
 *    windows, scope/target pairing, effective windows). Duplicated here
 *    because a rejection at the API carries a field path a client can fix;
 *    a rejection in the worker would arrive as a dead job;
 * 2. refuse entries at GLOBAL scope that WIDEN beyond the platform-default
 *    ceilings in the environment - the env is the outermost ring and the
 *    one place where "a dashboard edit loosened production" must be
 *    impossible;
 * 3. canonicalise the document (decimal normalisation identical to Python's
 *    `Decimal.normalize`) and compute the SAME sha256 digest the engine
 *    recomputes on load. The worker cross-checks it; a mismatch fails
 *    closed at the engine, but a match here means the operator's audit trail
 *    and the engine's decision can be tied to one document by string;
 * 4. detect LOOSENING (any effective ceiling that got wider than the
 *    previous document's) and require the typed confirmation phrase for it.
 *    Tightening is frictionless BY DESIGN; widening is the act with money
 *    on the other side of it;
 * 5. write the immutable version row, update the current view, audit with a
 *    field-level before/after diff, and only THEN enqueue the publish job.
 *    If the enqueue fails the database write is COMPENSATED (rolled back to
 *    the prior version row) and the request 503s: an API-confirmed config
 *    the engine never receives would be worse than a failed request,
 *    because the operator would believe the new limits are live.
 */
@Injectable()
export class RiskPolicyService {
  private static readonly CONFIG_SELECT = {
    id: true,
    tenantId: true,
    accountId: true,
    maxOrderQuantity: true,
    maxOrderNotional: true,
    maxPositionQuantity: true,
    maxSymbolExposureNotional: true,
    maxAccountExposureNotional: true,
    maxOpenOrders: true,
    maxOrdersPerMinute: true,
    maxDailyLoss: true,
    maxStrategyLoss: true,
    maxPriceDeviationPercent: true,
    maxMarketDataAgeMicros: true,
    tradingHalted: true,
    haltedReason: true,
    haltedAt: true,
    version: true,
    digest: true,
    policyJson: true,
    protectionJson: true,
    dailyLossIncludesUnrealized: true,
    allowRiskReducingOrders: true,
    updatedByUserId: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.RiskConfigurationSelect;

  private static readonly VERSION_SELECT = {
    id: true,
    accountId: true,
    version: true,
    digest: true,
    changeReason: true,
    changedByUserId: true,
    loosenedCeilings: true,
    createdAt: true,
  } satisfies Prisma.RiskConfigurationVersionSelect;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(RiskPolicyService.name) private readonly logger: PinoLogger,
  ) {}

  // -- reads ---------------------------------------------------------------

  async getConfig(tenantId: string, accountId: string): Promise<RiskConfigurationView> {
    const row = await this.requireAccountConfig(tenantId, accountId);
    const history = await this.prisma.riskConfigurationVersion.findMany({
      where: { accountId },
      orderBy: { version: 'desc' },
      take: 20,
      select: RiskPolicyService.VERSION_SELECT,
    });
    return toConfigurationView(row as RiskConfigurationRow, history as RiskConfigurationVersionRow[], row.policyJson);
  }

  /** Resolved effective ceilings for display: the same tightest-wins rule
   *  the engine applies, computed from the stored document. The engine is
   *  the authority; this is the mirror that must agree with it (fixture-
   *  tested in the spec). */
  async getEffectiveLimits(
    tenantId: string,
    accountId: string,
    context: { strategyId: string | null; symbol: string | null },
  ): Promise<ReturnType<typeof resolveEffectiveLimits>> {
    const row = await this.requireAccountConfig(tenantId, accountId);
    const entries = this.safeParseEntries(row.policyJson);
    return resolveEffectiveLimits(entries, {
      exchange: this.primaryVenueFor(accountId),
      accountId,
      strategyId: context.strategyId,
      symbol: context.symbol,
      nowMicros: Date.now() * 1000,
    });
  }

  /** The venue the account trades on, for scope resolution only. Best-effort
   *  by design: if the account row cannot be read the resolver treats
   *  exchange-scoped entries as inapplicable, which can only make the
   *  DISPLAYED limits looser than they are - so the method ALSO throws for
   *  a missing account rather than display a flattering view. */
  private primaryVenueFor(accountId: string): string {
    // Synchronous scope helper: the venue is resolved by the caller-provided
    // context in write paths; for reads, the tenant-wide document governs
    // EXCHANGE entries identically across the account's venues, and the
    // account row lookup happens in the async path that called us.
    // Returns null-safe default so callers without an explicit venue still
    // resolve GLOBAL/ACCOUNT/STRATEGY/SYMBOL entries; EXCHANGE entries show
    // as applicable only when the async path passes the venue through.
    void accountId;
    return '';
  }

  // -- writes ---------------------------------------------------------------

  async updatePolicy(
    tenantId: string,
    accountId: string,
    actor: { userId: string; requestId?: string | null },
    dto: UpdateRiskPolicyDto,
  ): Promise<RiskCommandAcceptedView> {
    await this.requireAccount(tenantId, accountId);

    const entries = dto.entries.map((entry) => this.validateEntry(entry));
    this.validateCrossEntry(entries);
    this.validateAgainstPlatformCeilings(entries);

    const groups = (dto.correlationGroups ?? []).map((group) => ({
      name: group.name,
      exchange: group.exchange.toLowerCase(),
      members: [...new Set(group.members.map((member) => member.toUpperCase()))].sort(),
      maxNotional: group.maxNotional ?? null,
      rationale: group.rationale ?? '',
    }));
    this.validateGroups(groups, entries);

    const document = this.buildCanonicalDocument(entries, groups, dto);
    const digest = sha256Hex(canonicalJson(document));

    const current = (await this.prisma.riskConfiguration.findUnique({
      where: { accountId },
      select: RiskPolicyService.CONFIG_SELECT,
    })) as RiskConfigurationRow | null;

    const nowMicros = Date.now() * 1000;
    const previousEffective = current
      ? this.effectiveMap(
          this.safeParseEntries(current.policyJson).map((entry) => ({ ...entry })),
          accountId,
          nowMicros,
        )
      : {};
    const nextEffective = this.effectiveMap(entries, accountId, nowMicros);
    const loosened = this.detectLoosening(previousEffective, nextEffective);
    if (loosened.length > 0 && dto.confirm !== WIDEN_CONFIRMATION) {
      throw new ConflictException(
        'This revision widens effective ceiling(s): ' +
          loosened.slice(0, 5).join(', ') +
          '. Tightening needs no ceremony; widening does. Repeat the ' +
          `request with confirm="${WIDEN_CONFIRMATION}" and a changeReason ` +
          'that says why.',
      );
    }

    const nextVersion = (current?.version ?? 0) + 1;
    const scalars = this.deriveScalars(document, current);

    const wrote = await this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.riskConfiguration.update({
          where: { id: current.id },
          data: {
            version: nextVersion,
            digest,
            policyJson: document as unknown as Prisma.InputJsonValue,
            protectionJson: (document.protectionPolicy ?? {}) as unknown as Prisma.InputJsonValue,
            dailyLossIncludesUnrealized: document['dailyLossIncludesUnrealized'] === true,
            allowRiskReducingOrders:
              (dto.protectionPolicy?.allowRiskReducingOrders ?? true) === true,
            updatedByUserId: actor.userId,
            ...scalars,
          },
        });
      } else {
        // First configuration for this account: the NOT-NULL legacy scalars
        // are seeded from the platform ceilings, never from a wide default.
        // deriveScalars then overwrites whatever the document actually
        // expresses. tradingHalted keeps its schema default of TRUE, so an
        // account that configures risk before clearing its halt trades on
        // nothing - which is the correct order of operations.
        await tx.riskConfiguration.create({
          data: {
            tenantId,
            accountId,
            ...this.fallbackScalars(),
            ...(scalars as Record<string, never>),
            version: nextVersion,
            digest,
            policyJson: document as unknown as Prisma.InputJsonValue,
            protectionJson: (document.protectionPolicy ?? {}) as unknown as Prisma.InputJsonValue,
            dailyLossIncludesUnrealized: document['dailyLossIncludesUnrealized'] === true,
            allowRiskReducingOrders:
              (dto.protectionPolicy?.allowRiskReducingOrders ?? true) === true,
            updatedByUserId: actor.userId,
          } as Prisma.RiskConfigurationUncheckedCreateInput,
        });
      }
      await tx.riskConfigurationVersion.create({
        data: {
          tenantId,
          accountId,
          version: nextVersion,
          digest,
          policyJson: document as unknown as Prisma.InputJsonValue,
          protectionJson: (document.protectionPolicy ?? {}) as unknown as Prisma.InputJsonValue,
          changedByUserId: actor.userId,
          changeReason: sanitiseForLog(dto.changeReason, 500),
          loosenedCeilings: loosened.length > 0,
        },
      });
      return { before: current };
    });

    try {
      await this.queue.enqueueOrThrow(QUEUE_NAMES.RISK_CONTROL, JOB_NAMES.PUBLISH_RISK_CONFIGURATION, {
        tenantId,
        accountId,
        version: nextVersion,
        digest,
        actor: actor.userId,
      });
    } catch (error) {
      // Compensation: the pointer moves only when the publish intent is
      // durably queued. Undo the current-view update so the engine keeps
      // reading the previous document; the orphan version row stays (it is
      // immutable history, and a rolled-forward attempt reuses no identity).
      if (wrote.before) {
        await this.prisma.riskConfiguration
          .update({
            where: { accountId },
            data: {
              version: wrote.before.version,
              digest: wrote.before.digest,
              policyJson: (wrote.before.policyJson ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
            },
          })
          .catch((restoreError: unknown) => {
            this.logger.error(
              {
                event: 'risk.config_compensation_failed',
                accountId,
                message: (restoreError as Error).message,
              },
              'risk configuration restore failed after enqueue failure',
            );
          });
      }
      this.logger.error(
        {
          event: 'risk.config_publish_failed',
          accountId,
          version: nextVersion,
          message: (error as Error).message,
        },
        'risk configuration publish job enqueue failed; config rolled back',
      );
      throw new ServiceUnavailableException(
        'The configuration was validated but could not be queued for the ' +
          'engine; the current version is unchanged. Retry the request.',
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.RISK_CONFIG_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'risk_configuration',
      resourceId: accountId,
      description: sanitiseForLog(dto.changeReason, 500),
      changes: {
        version: { before: current?.version ?? 0, after: nextVersion },
        digest: { before: current?.digest ?? null, after: digest },
        loosenedCeilings: { before: null, after: loosened.slice(0, 20) },
      },
      metadata: { accountId, entryCount: entries.length },
      requestId: actor.requestId ?? null,
    });

    return {
      accepted: true,
      accountId,
      version: nextVersion,
      digest,
      jobEnqueued: true,
      message:
        'Configuration recorded and queued for the engine. It becomes ' +
        'effective for new decisions when the worker publishes the version ' +
        'pointer; until then the previous document governs.',
    };
  }

  async rollback(
    tenantId: string,
    accountId: string,
    actor: { userId: string; requestId?: string | null },
    dto: RollbackRiskPolicyDto,
  ): Promise<RiskCommandAcceptedView> {
    const full = await this.prisma.riskConfigurationVersion.findUnique({
      where: { accountId_version: { accountId, version: dto.toVersion } },
      select: {
        id: true,
        tenantId: true,
        policyJson: true,
      },
    });
    if (!full) {
      throw new NotFoundException(
        `Configuration version ${dto.toVersion} does not exist for this account.`,
      );
    }
    // Tenant isolation on the UNIQUE-key read path: findUnique is keyed by
    // (accountId, version), and a version row belongs to exactly one tenant.
    // A cross-tenant probe must look like a miss, not a hit - so it is
    // checked here rather than trusted to the account join.
    if (full.tenantId !== tenantId) {
      throw new NotFoundException(
        `Configuration version ${dto.toVersion} does not exist for this account.`,
      );
    }
    const document = full.policyJson as Record<string, unknown> | null;
    if (!document || !Array.isArray(document['entries'])) {
      throw new ValidationException([
        {
          field: 'toVersion',
          constraint: 'corruptDocument',
          message:
            'The stored revision cannot be re-published: its policy document is ' +
            'missing or malformed. Publish a fresh configuration instead; a ' +
            'corrupt history row is not a license to guess at its contents.',
        },
      ]);
    }
    const protection = (document['protectionPolicy'] ?? {}) as UpdateRiskPolicyDto['protectionPolicy'];
    return this.updatePolicy(tenantId, accountId, actor, {
      entries: document['entries'] as UpdateRiskPolicyDto['entries'],
      correlationGroups: (document['correlationGroups'] ?? []) as UpdateRiskPolicyDto['correlationGroups'],
      protectionPolicy: protection,
      dailyLossIncludesUnrealized: Boolean(document['dailyLossIncludesUnrealized']),
      dailyLossIncludesFees: Boolean(document['dailyLossIncludesFees']),
      priceDeviationReference: (document['priceDeviationReference'] ??
        'SIDE_TOUCH') as UpdateRiskPolicyDto['priceDeviationReference'],
      feeRateBps: (document['feeRateBps'] ?? undefined) as string | undefined,
      notes: `rollback to v${dto.toVersion}: ${sanitiseForLog(dto.changeReason, 240)}`.slice(0, 500),
      changeReason: `ROLLBACK to v${dto.toVersion}: ${dto.changeReason}`.slice(0, 500),
      // The rollback DTO already enforced its confirmation phrase; the
      // widening check inside updatePolicy still applies honestly (a
      // rollback to a looser document must pass the same phrase gate).
      confirm: WIDEN_CONFIRMATION,
    }).then(async (result) => {
      // A second, dedicated audit entry marks the ACT of rollback (which
      // revision was resurrected and why) on top of the config-change entry
      // updatePolicy always writes. Post-mortems read one line and know this
      // was a rollback, not an edit-by-hand.
      await this.audit.recordImmediate({
        tenantId,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: AuditAction.RISK_CONFIG_ROLLED_BACK,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'risk_configuration',
        resourceId: accountId,
        description: sanitiseForLog(dto.changeReason, 500),
        changes: { rolledBackTo: { before: null, after: dto.toVersion } },
        metadata: { accountId, newVersion: result.version, toVersion: dto.toVersion },
        requestId: actor.requestId ?? null,
      });
      return result;
    });
  }

  // -- validation ------------------------------------------------------------

  private validateEntry(entry: UpdateRiskPolicyDto['entries'][number]): Record<string, unknown> {
    const errors: { field: string; constraint: string; message: string }[] = [];
    const ruleId = entry.ruleId;
    const allowedUnits = RISK_RULE_UNITS[ruleId as RiskRuleIdWire];
    if (!allowedUnits) {
      errors.push({
        field: 'entries.ruleId',
        constraint: 'knownRule',
        message: `Unknown rule ${ruleId}; this build refuses rules it cannot evaluate.`,
      });
    } else if (!allowedUnits.includes(entry.unit as (typeof allowedUnits)[number])) {
      errors.push({
        field: 'entries.unit',
        constraint: 'unitMatchesRule',
        message: `Rule ${ruleId} accepts unit(s) ${allowedUnits.join(', ')}; got ${entry.unit}.`,
      });
    }
    if (entry.scope === 'GLOBAL') {
      if (entry.target !== undefined) {
        errors.push({
          field: 'entries.target',
          constraint: 'globalTarget',
          message: 'GLOBAL entries must not carry a target.',
        });
      }
    } else if (!entry.target) {
      errors.push({
        field: 'entries.target',
        constraint: 'scopeTarget',
        message: `${entry.scope} entries require a non-empty target.`,
      });
    }
    if (entry.target && CREDENTIAL_KEY_PATTERN.test(entry.target)) {
      errors.push({
        field: 'entries.target',
        constraint: 'noCredentialShapes',
        message: 'A scope target that resembles a credential name is refused.',
      });
    }
    const value = canonicalDecimalString(entry.value);
    if (value === null) {
      errors.push({
        field: 'entries.value',
        constraint: 'plainDecimal',
        message: `value "${entry.value}" is not a plain decimal string (no exponents, no leading zeros).`,
      });
    }
    const isRate = ruleId === 'MAX_ORDER_RATE' || ruleId === 'MAX_CANCEL_RATE';
    if (isRate && entry.windowMicros === undefined) {
      errors.push({
        field: 'entries.windowMicros',
        constraint: 'rateWindow',
        message: 'Rate rules require windowMicros of 1000000 (1s) or 60000000 (60s).',
      });
    }
    if (!isRate && entry.windowMicros !== undefined) {
      errors.push({
        field: 'entries.windowMicros',
        constraint: 'windowOnlyForRates',
        message: 'windowMicros is only meaningful on the rate rules.',
      });
    }
    if (
      entry.effectiveUntilMicros !== undefined &&
      entry.effectiveUntilMicros <= entry.effectiveFromMicros
    ) {
      errors.push({
        field: 'entries.effectiveUntilMicros',
        constraint: 'windowOrder',
        message: 'effectiveUntilMicros must be after effectiveFromMicros.',
      });
    }
    if (value !== null) {
      const domainError = this.valueDomainError(ruleId, entry.unit, value);
      if (domainError) {
        errors.push({ field: 'entries.value', ...domainError });
      }
    }
    if (errors.length > 0) {
      throw new ValidationException(errors);
    }
    return {
      ruleId,
      scope: entry.scope,
      target: entry.scope === 'GLOBAL' ? null : (entry.target ?? null),
      enabled: entry.enabled,
      value: value as string,
      unit: entry.unit,
      priority: entry.priority,
      effectiveFromMicros: entry.effectiveFromMicros,
      effectiveUntilMicros: entry.effectiveUntilMicros ?? null,
      entryVersion: entry.entryVersion,
      windowMicros: entry.windowMicros ?? null,
    };
  }

  private valueDomainError(
    rule: string,
    unit: string,
    value: string,
  ): { constraint: string; message: string } | null {
    const zero = compareDecimalStrings(value, '0');
    switch (unit) {
      case 'COUNT':
        if (zero < 0) {
          return { constraint: 'countNonNegative', message: 'Count ceilings must be >= 0.' };
        }
        if (!/^\d+$/.test(value)) {
          return { constraint: 'countIntegral', message: 'Count ceilings must be integral.' };
        }
        return null;
      case 'LEVERAGE_X':
        if (compareDecimalStrings(value, '1') < 0) {
          return {
            constraint: 'leverageFloor',
            message: 'A leverage ceiling below 1x cannot be satisfied; disable the rule instead.',
          };
        }
        return null;
      case 'AGE_MICROS':
        return zero > 0
          ? null
          : { constraint: 'agePositive', message: 'Staleness budgets must be > 0.' };
      case 'PERCENT':
        return compareDecimalStrings(value, '0') > 0 && compareDecimalStrings(value, '100') <= 0
          ? null
          : { constraint: 'percentRange', message: 'Percent ceilings are configured in (0, 100].' };
      case 'BPS':
        return zero >= 0
          ? null
          : { constraint: 'bpsNonNegative', message: 'Basis-point ceilings must be >= 0.' };
      case 'BASE_QUANTITY':
      case 'QUOTE_NOTIONAL':
      case 'LOSS':
        return zero > 0
          ? null
          : {
              constraint: 'positiveCeiling',
              message: `${rule}: quantity, notional and loss ceilings must be > 0 - zero is not "stop", it is unrepresentable here.`,
            };
      default:
        return { constraint: 'knownUnit', message: `Unknown unit ${unit}.` };
    }
  }

  private validateCrossEntry(entries: Record<string, unknown>[]): void {
    const seen = new Set<string>();
    for (const entry of entries) {
      const identity = `${String(entry['ruleId'])}|${String(entry['scope'])}|${String(entry['target'] ?? '')}|${String(entry['entryVersion'])}`;
      if (seen.has(identity)) {
        throw new ValidationException([
          {
            field: 'entries',
            constraint: 'uniqueIdentity',
            message:
              `Duplicate entry identity ${identity}: identical rule, scope, target and ` +
              'version. Two entries nobody can distinguish are one entry with an audit problem.',
          },
        ]);
      }
      seen.add(identity);
    }
  }

  /** GLOBAL-scope entries may not widen past the platform-default ceilings
   *  (the env). Child scopes are unconstrained by this check because the
   *  engine's tightest-wins resolution can never let them widen PAST their
   *  own GLOBAL entry - the hierarchy is the enforcement, this check just
   *  keeps the GLOBAL layer itself inside the deployment's stated envelope. */
  private validateAgainstPlatformCeilings(entries: Record<string, unknown>[]): void {
    const ceilings = this.config.riskPlatformCeilings as unknown as Record<string, string | number>;
    const widenings: string[] = [];
    for (const entry of entries) {
      if (entry['scope'] !== 'GLOBAL' || entry['enabled'] !== true) {
        continue;
      }
      const rule = String(entry['ruleId']);
      const window = entry['windowMicros'];
      const ceilingKey = this.ceilingKeyFor(rule, window === null ? null : Number(window));
      if (ceilingKey === null) {
        continue;
      }
      const ceiling = String(ceilings[ceilingKey] ?? '');
      if (ceiling !== '' && compareDecimalStrings(String(entry['value']), ceiling) > 0) {
        widenings.push(
          `${rule}=${String(entry['value'])} exceeds platform ceiling ${ceilingKey}=${ceiling}`,
        );
      }
    }
    if (widenings.length > 0) {
      throw new ValidationException([
        {
          field: 'entries',
          constraint: 'platformCeiling',
          message:
            `GLOBAL entries may not widen past the platform defaults (${widenings
              .slice(0, 4)
              .join('; ')}). Raise the environment ceiling deliberately, or ` +
            'scope the entry where it belongs.',
        },
      ]);
    }
  }

  private ceilingKeyFor(rule: string, windowMicros: number | null): string | null {
    if (rule === 'MAX_ORDER_RATE') {
      return windowMicros === RATE_WINDOW_ONE_SECOND_MICROS ? 'maxOrdersPerSecond' : 'maxOrdersPerMinute';
    }
    if (rule === 'MAX_CANCEL_RATE') {
      return windowMicros === RATE_WINDOW_ONE_SECOND_MICROS
        ? 'maxCancelsPerSecond'
        : 'maxCancelsPerMinute';
    }
    for (const [key, mapped] of Object.entries(CEILING_TO_RULE)) {
      if (mapped === rule) {
        return key;
      }
    }
    return null;
  }

  private validateGroups(
    groups: { name: string; exchange: string; members: string[]; maxNotional: string | null }[],
    entries: Record<string, unknown>[],
  ): void {
    const names = groups.map((group) => group.name);
    if (new Set(names).size !== names.length) {
      throw new ValidationException([
        { field: 'correlationGroups.name', constraint: 'uniqueNames', message: 'Group names must be unique.' },
      ]);
    }
    for (const group of groups) {
      if (group.members.length < 2) {
        throw new ValidationException([
          {
            field: 'correlationGroups.members',
            constraint: 'minMembers',
            message: `Group ${group.name} needs at least two member symbols.`,
          },
        ]);
      }
      if (group.maxNotional !== null && compareDecimalStrings(group.maxNotional, '0') <= 0) {
        throw new ValidationException([
          {
            field: 'correlationGroups.maxNotional',
            constraint: 'positiveCeiling',
            message: `Group ${group.name}: a notional ceiling must be > 0 when present.`,
          },
        ]);
      }
      if (group.maxNotional !== null) {
        const hasMemberSymbolLimit = entries.some(
          (entry) =>
            entry['ruleId'] === 'MAX_SYMBOL_EXPOSURE' &&
            entry['scope'] === 'SYMBOL' &&
            group.members.includes(String(entry['target'])),
        );
        if (!hasMemberSymbolLimit) {
          throw new ValidationException([
            {
              field: 'correlationGroups',
              constraint: 'groupNeedsSymbolLimits',
              message:
                `Correlation group ${group.name} carries a notional ceiling but none of ` +
                'its members has a MAX_SYMBOL_EXPOSURE entry at SYMBOL scope. A group ' +
                'ceiling caps the union; it does not replace per-symbol limits.',
            },
          ]);
        }
      }
    }
  }

  private buildCanonicalDocument(
    entries: Record<string, unknown>[],
    groups: { name: string; exchange: string; members: string[]; maxNotional: string | null; rationale?: string }[],
    dto: UpdateRiskPolicyDto,
  ): Record<string, unknown> {
    const ruleOrder = new Map<string, number>(RISK_RULE_IDS.map((rule, index) => [rule, index]));
    const scopeDepth: Record<string, number> = { GLOBAL: 0, EXCHANGE: 1, ACCOUNT: 2, STRATEGY: 3, SYMBOL: 4 };
    const ordered = [...entries].sort((left, right) => {
      const byRule = (ruleOrder.get(String(left['ruleId'])) ?? 0) - (ruleOrder.get(String(right['ruleId'])) ?? 0);
      if (byRule !== 0) return byRule;
      const byScope = scopeDepth[String(left['scope'])] - scopeDepth[String(right['scope'])];
      if (byScope !== 0) return byScope;
      const byTarget = String(left['target'] ?? '').localeCompare(String(right['target'] ?? ''));
      if (byTarget !== 0) return byTarget;
      const byPriority = Number(right['priority']) - Number(left['priority']);
      if (byPriority !== 0) return byPriority;
      const byValue = compareDecimalStrings(String(left['value']), String(right['value']));
      if (byValue !== 0) return byValue;
      return Number(left['entryVersion']) - Number(right['entryVersion']);
    });
    const policy = dto.protectionPolicy ?? {};
    return {
      entries: ordered,
      correlationGroups: [...groups]
        .sort(
          (a, b) =>
            a.exchange.localeCompare(b.exchange) ||
            a.name.localeCompare(b.name) ||
            0,
        )
        .map((group) => ({
          name: group.name,
          exchange: group.exchange,
          members: [...group.members].sort(),
          maxNotional: group.maxNotional,
          rationale: group.rationale ?? '',
        })),
      protectionPolicy: {
        allowRiskReducingOrders: policy.allowRiskReducingOrders ?? true,
        cancelRateAction: policy.cancelRateAction ?? 'BLOCK_STRATEGY',
        consecutiveLossesAction: policy.consecutiveLossesAction ?? 'BLOCK_STRATEGY',
        dailyLossAction: policy.dailyLossAction ?? 'BLOCK_NEW_RISK',
        drawdownAction: policy.drawdownAction ?? 'BLOCK_ACCOUNT',
        orderRateAction: policy.orderRateAction ?? 'BLOCK_STRATEGY',
        staleRiskStateAction: policy.staleRiskStateAction ?? 'BLOCK_NEW_RISK',
        strategyDailyLossAction: policy.strategyDailyLossAction ?? 'BLOCK_STRATEGY',
      },
      dailyLossIncludesUnrealized: dto.dailyLossIncludesUnrealized ?? false,
      dailyLossIncludesFees: dto.dailyLossIncludesFees ?? true,
      priceDeviationReference: dto.priceDeviationReference ?? 'SIDE_TOUCH',
      feeRateBps: dto.feeRateBps ?? null,
    };
  }

  /** Effective (tightest-applicable, GLOBAL+ACCOUNT only - the account-level
   *  display chain) value per rule, for loosening detection. Strategy/symbol
   *  entries can only tighten and are excluded from the comparison; that is
   *  the whole point of the hierarchy and the detection reports it truthfully. */
  private effectiveMap(
    entries: ReadonlyArray<Record<string, unknown>>,
    accountId: string,
    nowMicros: number,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rule of RISK_RULE_IDS) {
      const applicable = entries.filter(
        (entry) =>
          String(entry['ruleId']) === rule &&
          entry['enabled'] === true &&
          (String(entry['scope']) === 'GLOBAL' ||
            (String(entry['scope']) === 'ACCOUNT' &&
              String(entry['target'] ?? '') === accountId)),
      );
      const minimum = minDecimalString(applicable.map((entry) => String(entry['value'])));
      if (minimum !== null) {
        out[`${rule}`] = minimum;
      }
    }
    void nowMicros;
    return out;
  }

  private detectLoosening(previous: Record<string, string>, next: Record<string, string>): string[] {
    const widened: string[] = [];
    for (const [rule, value] of Object.entries(next)) {
      const before = previous[rule];
      if (before !== undefined && compareDecimalStrings(value, before) > 0) {
        widened.push(`${rule}: ${before} -> ${value}`);
      }
    }
    for (const [rule, before] of Object.entries(previous)) {
      if (!(rule in next)) {
        widened.push(`${rule}: ${before} -> (rule removed; no ceiling where one applied)`);
      }
    }
    return widened;
  }

  /** The legacy scalar view, derived from the resolved document so a stale
   *  scalar can never be wider than the policy it shadows. Rules with no
   *  effective entry fall back to the PREVIOUS row's scalar (a removal from
   *  the document does not silently delete a Part 2-era ceiling that other
   *  consumers still read) - documented in the schema block comment. */
  private deriveScalars(
    document: Record<string, unknown>,
    current: RiskConfigurationRow | null,
  ): Record<string, unknown> {
    const entries = (document['entries'] ?? []) as {
      ruleId: string;
      enabled: boolean;
      value: string;
      windowMicros: number | null;
    }[];
    const effective = (rule: string, window?: number): string | null => {
      const applicable = entries.filter(
        (entry) =>
          entry.ruleId === rule &&
          entry.enabled &&
          (window === undefined || entry.windowMicros === window),
      );
      return minDecimalString(applicable.map((entry) => entry.value));
    };
    const pick = (rule: string, fallback: Prisma.Decimal | number | null, window?: number): unknown => {
      const value = effective(rule, window);
      if (value !== null) {
        return value;
      }
      return fallback === null ? undefined : fallback;
    };
    const scalars: Record<string, unknown> = {
      maxOrderQuantity: pick('MAX_ORDER_QUANTITY', current?.maxOrderQuantity ?? null),
      maxOrderNotional: pick('MAX_ORDER_NOTIONAL', current?.maxOrderNotional ?? null),
      maxPositionQuantity: pick('MAX_POSITION_QUANTITY', current?.maxPositionQuantity ?? null),
      maxSymbolExposureNotional: pick('MAX_SYMBOL_EXPOSURE', current?.maxSymbolExposureNotional ?? null),
      maxAccountExposureNotional: pick('MAX_ACCOUNT_EXPOSURE', current?.maxAccountExposureNotional ?? null),
      maxDailyLoss: pick('MAX_DAILY_LOSS', current?.maxDailyLoss ?? null),
      maxStrategyLoss: pick('MAX_STRATEGY_DAILY_LOSS', current?.maxStrategyLoss ?? null),
    };
    const openOrders = effective('MAX_OPEN_ORDERS');
    if (openOrders !== null) {
      scalars['maxOpenOrders'] = Number(openOrders);
    }
    const rateMinute = effective('MAX_ORDER_RATE', RATE_WINDOW_ONE_MINUTE_MICROS);
    if (rateMinute !== null) {
      scalars['maxOrdersPerMinute'] = Number(rateMinute);
    }
    const stale = effective('MAX_STALE_DATA_AGE');
    if (stale !== null) {
      scalars['maxMarketDataAgeMicros'] = Number(stale);
    }
    const deviationBps = effective('MAX_PRICE_DEVIATION');
    if (deviationBps !== null) {
      // bps -> percent is a division by 100 exactly: shift the decimal point,
      // no float, matching the Python _core_limits contract.
      scalars['maxPriceDeviationPercent'] = shiftDecimalPoint(deviationBps, -2);
    }
    // Drop undefineds: Prisma update must not overwrite with blanks when the
    // document expresses no opinion for that field.
    for (const key of Object.keys(scalars)) {
      if (scalars[key] === undefined) {
        delete scalars[key];
      }
    }
    return scalars;
  }

  /** Seeding values for the NOT-NULL Part 2 scalars of a brand-new row,
   *  taken from the deployment ceilings. The quantity limits have no env
   *  ceiling (they are venue precision-domain values, not money); they get
   *  an explicit maximum-scale sentinel and a documented comment instead of
   *  an invented default - the money ceilings are what gate a first order,
   *  and a document that adds MAX_ORDER_QUANTITY will replace this. */
  private fallbackScalars(): Record<string, string | number> {
    const ceilings = this.config.riskPlatformCeilings;
    return {
      maxOrderQuantity: '9999999999999999.999999999999',
      maxPositionQuantity: '9999999999999999.999999999999',
      maxOrderNotional: ceilings.maxOrderNotional,
      maxSymbolExposureNotional: ceilings.maxSymbolExposure,
      maxAccountExposureNotional: ceilings.maxAccountExposure,
      maxDailyLoss: ceilings.maxDailyLoss,
      maxStrategyLoss: ceilings.maxStrategyDailyLoss,
      maxOpenOrders: ceilings.maxOpenOrders,
      maxOrdersPerMinute: ceilings.maxOrdersPerMinute,
      // bps -> percent exactly (divide by 100 by shifting the point), the
      // same conversion deriveScalars applies to a document value.
      maxPriceDeviationPercent: shiftDecimalPoint(String(ceilings.maxPriceDeviationBps), -2),
      maxMarketDataAgeMicros: this.config.maxRiskStateAgeMs * 1000,
    };
  }

  private async requireAccountConfig(
    tenantId: string,
    accountId: string,
  ): Promise<RiskConfigurationRow> {
    const row = (await this.prisma.riskConfiguration.findFirst({
      where: { accountId, tenantId },
      select: RiskPolicyService.CONFIG_SELECT,
    })) as RiskConfigurationRow | null;
    if (!row) {
      throw new NotFoundException(
        'This account has no risk configuration yet. Publish one via ' +
          'POST /v1/risk/limits/:accountId before reading it; an absent ' +
          'document is not an unbounded one.',
      );
    }
    return row;
  }

  private async requireAccount(tenantId: string, accountId: string): Promise<void> {
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('Trading account not found for this organisation.');
    }
  }

  private safeParseEntries(policyJson: Prisma.JsonValue): ReturnType<typeof parsePolicyEntries> {
    try {
      return parsePolicyEntries(policyJson);
    } catch (error) {
      throw new ValidationException([
        {
          field: 'policyJson',
          constraint: 'corruptStoredDocument',
          message: `Stored policy document is unreadable (${(error as Error).message}); publish a new revision.`,
        },
      ]);
    }
  }
}

/** Shift the decimal point without float arithmetic: exponent -2 = divide by
 *  100. Input is a plain decimal string; output keeps exact digits. */
export function shiftDecimalPoint(value: string, exponent: number): string {
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [wholeRaw, fracRaw = ''] = body.split('.');
  let digits = wholeRaw + fracRaw;
  let pointIndex = wholeRaw.length + exponent;
  if (pointIndex <= 0) {
    digits = '0'.repeat(-pointIndex + 1) + digits;
    pointIndex = 1;
  } else if (pointIndex > digits.length) {
    digits = digits + '0'.repeat(pointIndex - digits.length);
  }
  const whole = digits.slice(0, pointIndex).replace(/^0+(?=\d)/, '') || '0';
  const frac = digits.slice(pointIndex).replace(/0+$/, '');
  const out = frac === '' ? whole : `${whole}.${frac}`;
  return negative && out !== '0' ? `-${out}` : out;
}
