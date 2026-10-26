// # Operator order-state timeline and the audited recovery action that can move an order out of a stuck state.
//
// RECOVERY IS NOT "SET THE STATE"
// ------------------------------
// The only thing worse than an order stuck in UNKNOWN is an operator asserting it
// was FILLED. So this controller offers two things and nothing else:
//
//   * `GET .../timeline` - the transitions the engine recorded, read-only. This is
//     the artefact that proves what happened, and no route anywhere can rewrite it.
//   * `POST .../recover` - a transition that must name a target state and a reason,
//     is written through `OrderLifecycleService.transition` (so it goes through the
//     same state machine as every other transition and cannot skip an edge), and
//     requires a fresh, action-bound step-up proof.
//
// The proof is what makes the audit trail meaningful: a recovery entry names an
// operator who proved, seconds earlier, that they are the person at the keyboard.
// The reason is required for the same purpose one step removed - "an operator did
// something" is not a record, "an operator reconciled after the venue timed out" is.
import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { OrderLifecycleService } from './order-lifecycle.service';

/** Body of a recovery request. Both fields are required and both are recorded. */
export class OrderRecoveryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  targetState!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason!: string;
}

export interface OrderStateEntryView {
  state: string;
  at: string;
  actor: string;
  reason: string;
  venueOrderId: string | null;
}

export interface OrderTimelineView {
  orderId: string;
  symbol: string;
  side: string;
  quantity: string;
  state: string;
  entries: OrderStateEntryView[];
}

/** The states the OMS state machine knows. A target outside this list is refused. */
const KNOWN_STATES = new Set([
  'CREATED',
  'VALIDATED',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'REJECTED',
  'EXPIRED',
  'RECONCILED',
  'UNKNOWN',
]);

@Controller('admin/oms/orders')
export class OmsRecoveryAdminController {
  constructor(private readonly lifecycle: OrderLifecycleService) {}

  /**
   * The recorded transition history. `getHistory` already scopes by tenant, and a
   * missing order is a 400 from the lifecycle service rather than an empty timeline:
   * "no history" and "no such order" must not look the same to an operator.
   */
  @Get(':orderId/timeline')
  @RequirePermissions(Permission.EXECUTION_READ)
  async timeline(
    @TenantId() tenantId: string,
    @Param('orderId') orderId: string,
  ): Promise<OrderTimelineView> {
    const transitions = (await this.lifecycle.getHistory(tenantId, orderId)) as Array<Record<string, unknown>>;
    const entries: OrderStateEntryView[] = transitions.map((transition) => ({
      state: String(transition.toState ?? transition.state ?? 'UNKNOWN'),
      at: String(transition.timestamp ?? transition.at ?? transition.createdAt ?? ''),
      actor: String(transition.actorType ?? transition.source ?? 'ENGINE'),
      reason: String(transition.reason ?? ''),
      venueOrderId:
        typeof transition.venueOrderId === 'string'
          ? transition.venueOrderId
          : typeof transition.exchangeOrderId === 'string'
            ? transition.exchangeOrderId
            : null,
    }));
    const last = entries[entries.length - 1];
    return {
      orderId,
      // The intent's own descriptive fields are not what an operator needs from this
      // view, and reading them would be a second query against a different table;
      // the timeline is the answer to the question this route is asked.
      symbol: String(transitions[transitions.length - 1]?.symbol ?? 'UNKNOWN'),
      side: String(transitions[transitions.length - 1]?.side ?? 'UNKNOWN'),
      quantity: String(transitions[transitions.length - 1]?.quantity ?? '0'),
      state: last ? last.state : 'UNKNOWN',
      entries,
    };
  }

  /**
   * Move an order through the state machine as an operator.
   *
   * The transition is written with `source: 'OPERATOR_RECOVERY'` so it is never
   * confused with an engine-observed transition, and with the operator's id so the
   * entry names a person. A target the machine does not know is refused before the
   * write - an unrecognised state in the order's history is a bug that outlives the
   * incident.
   */
  @Post(':orderId/recover')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXECUTION_SUBMIT)
  @RequireStepUp('ORDER_RECOVERY')
  async recover(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Param('orderId') orderId: string,
    @Body() dto: OrderRecoveryDto,
  ): Promise<{
    accepted: boolean;
    code: string;
    message: string;
    orderId: string;
    fromState: string;
    requestedState: string;
  }> {
    const targetState = String(dto.targetState ?? '').trim().toUpperCase();
    if (!KNOWN_STATES.has(targetState)) {
      throw new BadRequestException(`Unknown order state '${targetState}'.`);
    }

    const before = (await this.lifecycle.getHistory(tenantId, orderId)) as Array<Record<string, unknown>>;
    const fromState = String(before[before.length - 1]?.toState ?? before[before.length - 1]?.state ?? 'UNKNOWN');

    const transitioned = (await this.lifecycle.transition({
      tenantId,
      intentId: orderId,
      toState: targetState,
      source: 'OPERATOR_RECOVERY',
      reason: dto.reason.trim(),
      actorId: user.userId,
      actorType: 'OPERATOR',
      metadata: { requestedFrom: fromState },
    })) as Record<string, unknown> | undefined;

    const after = (await this.lifecycle.getHistory(tenantId, orderId)) as Array<Record<string, unknown>>;
    const achieved = String(after[after.length - 1]?.toState ?? after[after.length - 1]?.state ?? targetState);

    return {
      // The engine's answer is the record: a requested state that the machine
      // refused must not be reported as applied.
      accepted: achieved === targetState || transitioned !== undefined,
      code: achieved === targetState ? 'TRANSITIONED' : 'RECORDED_AS_RETURNED',
      message:
        achieved === targetState
          ? `Order moved from ${fromState} to ${achieved}.`
          : `The engine recorded ${achieved} instead of the requested ${targetState}; the record follows the engine.`,
      orderId,
      fromState,
      requestedState: targetState,
    };
  }
}
