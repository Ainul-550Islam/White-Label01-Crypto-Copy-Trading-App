import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../../common/errors/app.exception';
import {
  RISK_SWITCH_TRANSITIONS,
  PROTECTION_CLEAR_CONFIRMATION,
  MIN_PROTECTION_CLEAR_REASON,
  type RiskSwitchStatusWire,
} from './risk.constants';
import { toProtectionView, toRiskSwitchView } from './risk.mapper';
import type { RiskProtectionView, RiskSwitchView } from './risk.types';
import type {
  AcknowledgeRiskSwitchDto,
  ClearRiskSwitchDto,
  EngageRiskSwitchDto,
  ListRiskSwitchesDto,
} from './dto/risk.dto';

/**
 * The kill-switch lifecycle from the RISK console's point of view.
 *
 * One table, two consoles, no second source of truth: the Part 5 execution
 * safety service still answers "engage/release" for GLOBAL/EXCHANGE-style
 * operational halts, and THIS service owns what Part 8 added - the
 * ACCOUNT/STRATEGY/SYMBOL halts visible in the risk console plus the full
 * TRIGGERED lifecycle (acknowledge, explicit clear) for switches the ENGINE
 * pulled on itself. Every method here writes the same `kill_switches` rows
 * the execution console reads; the risk additions are the lifecycle columns
 * and the protection trip record.
 *
 * The asymmetry, restated because this is the file where it is enforced:
 *
 * - ENGAGE needs a reason and nothing else - stopping trading is never the
 *   wrong call;
 * - releasing a MANUAL switch takes a reason (the execution console's rule,
 *   preserved here for switches engaged from this surface too);
 * - clearing a TRIGGERED protection additionally takes the typed
 *   confirmation phrase AND the prior acknowledgement - PnL recovering is
 *   not a clear, an operator deciding it is, in writing, twice;
 * - no method here can touch a GLOBAL switch. That belongs to the platform,
 *   and a tenant "fixing" a platform halt from the risk console would be
 *   the cross-tenant veto the whole scope design refuses.
 */
@Injectable()
export class RiskProtectionService {
  private static readonly SWITCH_SELECT = {
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
  } satisfies Prisma.KillSwitchSelect;

  private static readonly PROTECTION_SELECT = {
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
  } satisfies Prisma.RiskProtectionTripSelect;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    @InjectPinoLogger(RiskProtectionService.name) private readonly logger: PinoLogger,
  ) {}

  async list(tenantId: string, query: ListRiskSwitchesDto): Promise<RiskSwitchView[]> {
    const where: Prisma.KillSwitchWhereInput = {
      OR: [{ tenantId }, { tenantId: null, scope: 'GLOBAL' }],
    };
    if (query.scope) {
      where.scope = query.scope;
    }
    if (query.engagedOnly === true) {
      where.isEngaged = true;
    }
    const rows = await this.prisma.killSwitch.findMany({
      where,
      orderBy: [{ scope: 'asc' }, { target: 'asc' }],
      take: 100,
      select: RiskProtectionService.SWITCH_SELECT,
    });
    return rows.map((row) => toRiskSwitchView(row));
  }

  async engage(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    dto: EngageRiskSwitchDto,
  ): Promise<RiskSwitchView> {
    const target = dto.target ?? null;
    if (!target) {
      throw new ValidationException([
        {
          field: 'target',
          constraint: 'requiredForScope',
          message: `A ${dto.scope} kill switch requires a target (account, strategy or symbol uuid).`,
        },
      ]);
    }
    await this.validateTargetOwnership(tenantId, dto.scope, target);

    const existing = await this.prisma.killSwitch.findFirst({
      where: { tenantId, scope: dto.scope, target },
      select: RiskProtectionService.SWITCH_SELECT,
    });
    if (existing && existing.isEngaged) {
      throw new ConflictException('This kill switch is already engaged.');
    }
    // Re-engaging is allowed from any NOT-engaged status (INACTIVE, CLEARED)
    // - the transition table governs releases of engaged switches, and the
    // Python state machine behaves the same way. An engaged TRIGGERED switch
    // was refused above, so "engage" can never double-pull a live halt.

    const now = new Date();
    const saved = existing
      ? await this.prisma.killSwitch.update({
          where: { id: existing.id },
          data: {
            isEngaged: true,
            status: 'ACTIVE',
            reason: sanitiseForLog(dto.reason, 500),
            engagedByUserId: actor.userId,
            engagedAt: now,
            requiresExplicitClear: false,
            triggeredByRule: null,
            severity: null,
          },
          select: RiskProtectionService.SWITCH_SELECT,
        })
      : await this.prisma.killSwitch.create({
          data: {
            tenantId,
            scope: dto.scope,
            target,
            isEngaged: true,
            status: 'ACTIVE',
            reason: sanitiseForLog(dto.reason, 500),
            engagedByUserId: actor.userId,
            engagedAt: now,
          },
          select: RiskProtectionService.SWITCH_SELECT,
        });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.KILL_SWITCH_ENGAGED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'kill_switch',
      resourceId: saved.id,
      description: sanitiseForLog(dto.reason, 500),
      changes: { isEngaged: { before: existing?.isEngaged ?? false, after: true } },
      metadata: { scope: dto.scope, target, surface: 'risk-console' },
      requestId: actor.requestId ?? null,
    });
    await this.notifyEngine(tenantId);

    this.logger.warn(
      {
        event: 'risk.kill_switch_engaged',
        tenantId,
        scope: dto.scope,
        target,
        actorId: actor.userId,
      },
      'RISK KILL SWITCH ENGAGED',
    );
    return toRiskSwitchView(saved);
  }

  async acknowledge(
    tenantId: string,
    switchId: string,
    actor: { userId: string; requestId?: string | null },
    dto: AcknowledgeRiskSwitchDto,
  ): Promise<RiskSwitchView> {
    const row = await this.requireSwitch(tenantId, switchId);
    if (row.status !== 'TRIGGERED') {
      throw new ConflictException(
        `Only a TRIGGERED switch can be acknowledged; this one is ${row.status}.`,
      );
    }
    if (!this.transitionAllowed('TRIGGERED', 'ACKNOWLEDGED')) {
      throw new ConflictException('Transition refused by the switch lifecycle table.');
    }
    const saved = await this.prisma.killSwitch.update({
      where: { id: row.id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedByUserId: actor.userId,
        acknowledgedAt: new Date(),
        acknowledgementReason: sanitiseForLog(dto.reason, 500),
      },
      select: RiskProtectionService.SWITCH_SELECT,
    });
    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.RISK_KILL_SWITCH_ACKNOWLEDGED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'kill_switch',
      resourceId: row.id,
      description: sanitiseForLog(dto.reason, 500),
      metadata: { scope: row.scope, target: row.target, triggeredByRule: row.triggeredByRule },
      requestId: actor.requestId ?? null,
    });
    return toRiskSwitchView(saved);
  }

  async clear(
    tenantId: string,
    switchId: string,
    actor: { userId: string; requestId?: string | null },
    dto: ClearRiskSwitchDto,
  ): Promise<RiskSwitchView> {
    if (dto.confirm !== PROTECTION_CLEAR_CONFIRMATION) {
      throw new ValidationException([
        {
          field: 'confirm',
          constraint: 'typedConfirmation',
          message: `confirm must be exactly "${PROTECTION_CLEAR_CONFIRMATION}"`,
        },
      ]);
    }
    if (dto.reason.trim().length < MIN_PROTECTION_CLEAR_REASON) {
      throw new ValidationException([
        {
          field: 'reason',
          constraint: 'minLength',
          message: `Clearing requires a reason of at least ${MIN_PROTECTION_CLEAR_REASON} characters.`,
        },
      ]);
    }
    const row = await this.requireSwitch(tenantId, switchId);
    if (!row.isEngaged) {
      throw new ConflictException('This switch is not engaged; there is nothing to clear.');
    }
    if (row.requiresExplicitClear && row.status === 'TRIGGERED') {
      throw new ConflictException(
        'This switch was triggered by automatic protection. Acknowledge it ' +
          'first (what was reviewed), then clear it (why the halt can end). ' +
          'There is no single-step path from an engine trip back to trading.',
      );
    }
    const from = row.status as RiskSwitchStatusWire;
    // Manual ACTIVE releases to INACTIVE (the execution console's verb);
    // acknowledged protections transition to CLEARED. Both must be legal in
    // the shared table - they are, by construction, and the check keeps
    // them legal in future edits too.
    const to: RiskSwitchStatusWire =
      row.requiresExplicitClear || row.status === 'TRIGGERED' || row.status === 'ACKNOWLEDGED'
        ? 'CLEARED'
        : 'INACTIVE';
    if (!this.transitionAllowed(from, to)) {
      throw new ConflictException(`Transition ${from} -> ${to} is refused by the lifecycle table.`);
    }
    const now = new Date();
    const saved = await this.prisma.killSwitch.update({
      where: { id: row.id },
      data: {
        isEngaged: false,
        status: to,
        clearedByUserId: actor.userId,
        clearedAt: now,
        clearedReason: sanitiseForLog(dto.reason, 500),
        reason: sanitiseForLog(dto.reason, 500),
      },
      select: RiskProtectionService.SWITCH_SELECT,
    });

    if (row.requiresExplicitClear || row.status !== 'ACTIVE') {
      // Close the protection trip record(s) this switch was backing.
      await this.prisma.riskProtectionTrip.updateMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          // A RISK-scoped switch (`account:<id>`) has no RiskLimitScope
          // counterpart; it closes the trips recorded against that account.
          // Other scopes match on (scope, target) directly.
          ...(row.scope === 'RISK'
            ? {
                accountId: String(row.target ?? '').startsWith('account:')
                  ? String(row.target).slice('account:'.length)
                  : String(row.target ?? ''),
              }
            : {
                scope: row.scope as 'GLOBAL' | 'EXCHANGE' | 'ACCOUNT' | 'STRATEGY' | 'SYMBOL',
                target: String(row.target ?? ''),
              }),
        },
        data: {
          status: 'CLEARED',
          clearedByUserId: actor.userId,
          clearedAt: now,
          clearedReason: sanitiseForLog(dto.reason, 500),
        },
      });
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.RISK_KILL_SWITCH_CLEARED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'kill_switch',
      resourceId: row.id,
      description: sanitiseForLog(dto.reason, 500),
      changes: { isEngaged: { before: true, after: false }, status: { before: from, after: to } },
      metadata: {
        scope: row.scope,
        target: row.target,
        surface: 'risk-console',
        wasTriggered: row.requiresExplicitClear,
      },
      requestId: actor.requestId ?? null,
    });
    await this.notifyEngine(tenantId);

    this.logger.warn(
      {
        event: 'risk.kill_switch_cleared',
        tenantId,
        scope: row.scope,
        target: row.target,
        actorId: actor.userId,
      },
      'RISK KILL SWITCH CLEARED - trading will resume for this scope once the engine syncs',
    );
    return toRiskSwitchView(saved);
  }

  async listProtections(
    tenantId: string,
    accountId: string | null,
    includeCleared: boolean,
  ): Promise<RiskProtectionView[]> {
    const rows = await this.prisma.riskProtectionTrip.findMany({
      where: {
        tenantId,
        ...(accountId ? { accountId } : {}),
        ...(includeCleared ? {} : { status: 'ACTIVE' }),
      },
      orderBy: { triggeredAtDateTime: 'desc' },
      take: 50,
      select: RiskProtectionService.PROTECTION_SELECT,
    });
    return rows.map((row) => toProtectionView(row));
  }

  // -- internals ---------------------------------------------------------------

  private async requireSwitch(tenantId: string, switchId: string) {
    const row = await this.prisma.killSwitch.findFirst({
      where: { id: switchId },
      select: RiskProtectionService.SWITCH_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Kill switch not found.');
    }
    if (row.tenantId !== tenantId) {
      // A tenant reaching the platform's GLOBAL row gets a 404, not a 403:
      // existence of platform controls is not this tenant's information.
      throw new NotFoundException('Kill switch not found.');
    }
    if (row.scope === 'GLOBAL' || row.scope === 'EXCHANGE') {
      throw new ValidationException([
        {
          field: 'id',
          constraint: 'consoleScope',
          message:
            'GLOBAL and EXCHANGE switches are operated from the execution ' +
            'console. This surface manages tenant-owned scopes only.',
        },
      ]);
    }
    return row;
  }

  private transitionAllowed(from: RiskSwitchStatusWire, to: RiskSwitchStatusWire): boolean {
    return (RISK_SWITCH_TRANSITIONS[from] ?? []).includes(to);
  }

  private async validateTargetOwnership(
    tenantId: string,
    scope: string,
    target: string,
  ): Promise<void> {
    if (scope === 'ACCOUNT') {
      const account = await this.prisma.tradingAccount.findFirst({
        where: { id: target, tenantId },
        select: { id: true },
      });
      if (!account) {
        throw new NotFoundException('Trading account not found for this organisation.');
      }
      return;
    }
    if (scope === 'STRATEGY') {
      const strategy = await this.prisma.strategy.findFirst({
        where: { id: target, tenantId },
        select: { id: true },
      });
      if (!strategy) {
        throw new NotFoundException('Strategy not found for this organisation.');
      }
      return;
    }
    if (scope === 'SYMBOL') {
      if (!/^[A-Z0-9]+(-[A-Z0-9]+)?$/.test(target)) {
        throw new ValidationException([
          { field: 'target', constraint: 'symbolShape', message: 'target must be a canonical symbol' },
        ]);
      }
      return;
    }
    throw new ValidationException([
      {
        field: 'scope',
        constraint: 'consoleScope',
        message: 'This surface engages ACCOUNT, STRATEGY or SYMBOL switches only.',
      },
    ]);
  }

  /** Best-effort notify so the state worker can re-sync the mirror and the
   *  engine's Redis switch-set is rebuilt by the worker's own read. The
   *  durable row IS the safety; this job only narrows the sync window, and
   *  an enqueue failure must not fail the safety action it follows. */
  private async notifyEngine(tenantId: string): Promise<void> {
    try {
      await this.queue.enqueue(QUEUE_NAMES.RISK_CONTROL, JOB_NAMES.RECONCILE_RISK_PROTECTIONS, {
        tenantId,
        reason: 'switch-changed',
      });
    } catch (error) {
      this.logger.error(
        { event: 'risk.notify_engine_failed', tenantId, message: (error as Error).message },
        'risk protection reconcile job enqueue failed (durable row already written)',
      );
    }
  }
}
