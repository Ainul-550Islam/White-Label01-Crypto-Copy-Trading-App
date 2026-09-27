import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { ConflictException, ValidationException } from '../../common/errors/app.exception';
import { toKillSwitchView, type KillSwitchRow } from './execution.mapper';
import type { ExecutionSafetyView, KillSwitchView } from './execution.types';

/**
 * Scopes operable from the EXECUTION console. Part 8 added ACCOUNT and RISK
 * scopes to the switch table (and to Prisma's enum), but deliberately NOT to
 * this surface: an account halt is a risk-desk action, and a `RISK`-scoped
 * switch is the engine's own emergency brake - neither may be released
 * through a console that knows nothing about the protection lifecycle. The
 * DTO's @IsIn list is the enforcement point at the boundary; the explicit-
 * clear guard below is the enforcement point at the data.
 */
export type KillSwitchScope = 'GLOBAL' | 'EXCHANGE' | 'STRATEGY' | 'SYMBOL';

/**
 * Kill switches and the deployment safety summary.
 *
 * Four scopes, checked independently before every submission: GLOBAL, EXCHANGE,
 * STRATEGY, SYMBOL. Any one of them engaged blocks the order. They are ORed
 * rather than layered because the alternative - a precedence hierarchy - means
 * someone eventually discovers that releasing the GLOBAL switch quietly
 * re-armed forty symbol switches nobody remembered engaging.
 *
 * Asymmetry is intentional throughout: engaging a switch is easy, unconditional
 * and instantly effective; releasing one requires a reason, is audited at warn
 * level, and cannot be done in bulk.
 */
@Injectable()
export class ExecutionSafetyService {
  private static readonly SWITCH_SELECT = {
    id: true,
    scope: true,
    target: true,
    isEngaged: true,
    reason: true,
    engagedByUserId: true,
    engagedAt: true,
    releasedByUserId: true,
    releasedAt: true,
    updatedAt: true,
  } satisfies Prisma.KillSwitchSelect;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(ExecutionSafetyService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Every kill switch that applies to a tenant.
   *
   * Includes the platform-wide GLOBAL switch (`tenantId` null), because a
   * tenant operator staring at "why is nothing trading" needs to see that the
   * platform switch is engaged, even though they cannot release it.
   */
  async listKillSwitches(tenantId: string): Promise<KillSwitchView[]> {
    const rows = await this.prisma.killSwitch.findMany({
      where: { OR: [{ tenantId }, { tenantId: null, scope: 'GLOBAL' }] },
      select: ExecutionSafetyService.SWITCH_SELECT,
      orderBy: [{ scope: 'asc' }, { target: 'asc' }],
    });

    return rows.map((row) => toKillSwitchView(row as KillSwitchRow));
  }

  /**
   * Engages or releases one kill switch.
   *
   * Upserts rather than requiring the row to exist. A switch that has never
   * been engaged has no row, and an operator in an incident should not have to
   * create one before they can stop trading.
   */
  async setKillSwitch(
    tenantId: string,
    input: { scope: KillSwitchScope; target?: string | null; engaged: boolean; reason: string },
    actor: { userId: string; requestId?: string | null },
  ): Promise<KillSwitchView> {
    const target = input.scope === 'GLOBAL' ? null : (input.target ?? null);

    if (input.scope !== 'GLOBAL' && !target) {
      throw new ValidationException([
        {
          field: 'target',
          constraint: 'requiredForScope',
          message: `A ${input.scope} kill switch requires a target (venue, strategy id or symbol).`,
        },
      ]);
    }

    if (!input.engaged && input.reason.trim().length < 10) {
      // Engaging needs no justification - stopping trading is never the wrong
      // instinct. Releasing does, because that is the action that lets money
      // move again, and it is the one that gets read back during a post-mortem.
      throw new ValidationException([
        {
          field: 'reason',
          constraint: 'minLength',
          message: 'Releasing a kill switch requires a reason of at least 10 characters.',
        },
      ]);
    }

    const existing = await this.prisma.killSwitch.findFirst({
      where: { tenantId, scope: input.scope, target },
      select: ExecutionSafetyService.SWITCH_SELECT,
    });

    if (existing && existing.isEngaged === input.engaged) {
      throw new ConflictException(
        `This kill switch is already ${input.engaged ? 'engaged' : 'released'}.`,
      );
    }

    if (existing && !input.engaged) {
      // Part 8 guard: a switch pulled by AUTOMATIC risk protection cannot be
      // released from this surface. The execution console predates the
      // protection lifecycle and has no notion of explicit-clear; releasing
      // one of those rows from here would bypass the acknowledge-and-confirm
      // sequence the risk console enforces. The durable flag decides, so
      // future surfaces inherit the rule instead of re-implementing it.
      const lifecycle = await this.prisma.killSwitch.findFirst({
        where: { id: existing.id },
        select: { requiresExplicitClear: true, status: true },
      });
      if (lifecycle?.requiresExplicitClear) {
        throw new ConflictException(
          'This switch was triggered by automatic risk protection. It must be ' +
            'acknowledged and cleared from the risk console, not released here.',
        );
      }
    }

    const now = new Date();
    const data = input.engaged
      ? {
          isEngaged: true,
          reason: sanitiseForLog(input.reason, 500),
          engagedByUserId: actor.userId,
          engagedAt: now,
          // The previous release is deliberately left in place. Reading a
          // switch's history should show engage/release/engage, not a row that
          // pretends it was never released.
        }
      : {
          isEngaged: false,
          reason: sanitiseForLog(input.reason, 500),
          releasedByUserId: actor.userId,
          releasedAt: now,
        };

    const saved = existing
      ? await this.prisma.killSwitch.update({
          where: { id: existing.id },
          data,
          select: ExecutionSafetyService.SWITCH_SELECT,
        })
      : await this.prisma.killSwitch.create({
          data: { tenantId, scope: input.scope, target, ...data },
          select: ExecutionSafetyService.SWITCH_SELECT,
        });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: input.engaged ? AuditAction.KILL_SWITCH_ENGAGED : AuditAction.KILL_SWITCH_RELEASED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'kill_switch',
      resourceId: saved.id,
      description: sanitiseForLog(input.reason, 500),
      changes: { isEngaged: { before: existing?.isEngaged ?? false, after: input.engaged } },
      metadata: { scope: input.scope, target },
      requestId: actor.requestId ?? null,
    });

    this.logger.error(
      {
        event: input.engaged ? 'execution.kill_switch_engaged' : 'execution.kill_switch_released',
        tenantId,
        scope: input.scope,
        target,
        actorId: actor.userId,
      },
      input.engaged ? 'KILL SWITCH ENGAGED' : 'KILL SWITCH RELEASED',
    );

    return toKillSwitchView(saved as KillSwitchRow);
  }

  /**
   * The deployment's answer to "would a live order be transmitted right now".
   *
   * `wouldTransmitLiveOrder` is computed from the switches every time rather
   * than cached, and `blockingReasons` lists every blocker at once. Reporting
   * one blocker at a time produces an operator who disables safety controls in
   * sequence until something happens, which is precisely the behaviour these
   * controls exist to prevent.
   */
  async safetySummary(tenantId: string): Promise<ExecutionSafetyView> {
    const killSwitches = await this.listKillSwitches(tenantId);
    const base = this.config.executionSafetySummary;

    const blockingReasons: string[] = [];

    if (!base.executionEnabled) {
      blockingReasons.push('EXECUTION_ENABLED is false');
    }
    if (base.dryRun) {
      blockingReasons.push('DRY_RUN is true: requests are built and validated but never sent');
    }
    if (base.paperTrading) {
      blockingReasons.push('PAPER_TRADING is true: orders route to the simulated venue');
    }
    if (!base.liveTradingEnabled) {
      blockingReasons.push('LIVE_TRADING_ENABLED is false');
    }
    if (base.sandboxMode) {
      blockingReasons.push('EXCHANGE_SANDBOX_MODE is true: adapters target testnet endpoints');
    }

    for (const killSwitch of killSwitches) {
      if (killSwitch.isEngaged) {
        blockingReasons.push(
          `${killSwitch.scope} kill switch engaged${killSwitch.target ? ` for ${killSwitch.target}` : ''}`,
        );
      }
    }

    return {
      ...base,
      killSwitches,
      wouldTransmitLiveOrder: blockingReasons.length === 0,
      blockingReasons,
    };
  }
}
