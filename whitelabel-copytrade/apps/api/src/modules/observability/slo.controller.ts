/**
 * Part 10: the reliability control plane - SLO definitions, evaluations, the
 * scorecard, and the read-only tracing/fault posture of THIS process.
 *
 * What is NOT here, asked in the order it will be asked: no route arms,
 * disarms, or clears a fault point (there is no name for it); no route
 * toggles tracing (env + redeploy, like the Part 9 flags); no route resolves
 * an alert, releases a switch, or touches an order; no route deletes a
 * configuration version (the versioned table only appends - the retention
 * job prunes EVALUATION ROWS inside a 7-day floor and nothing else). The
 * two POST commands write an audited, versioned definition and ask for a
 * measurement NOW. That is the full mutation surface of this part.
 *
 * The endpoints answer one operational question - "what did we promise,
 * what did we observe, and is the gap being paid for with pages?" - and the
 * note on the rollup says what the numbers may not be used for.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type {
  AuthenticatedActor,
  CurrentTraceView,
  FaultsStatusView,
  PaginatedResult,
  SloReadinessView,
  SloStatusView,
  TracingStatusView,
} from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';
import { TracingService } from '../../infrastructure/tracing/tracing.service';
import { formatTraceparent } from '../../infrastructure/tracing/w3c';

import { SloService } from './slo.service';
import type { SloActor } from './slo.types';
import {
  ListSloDefinitionsDto,
  ListSloEvaluationsDto,
  SloParamDto,
  UpdateSloConfigDto,
} from './dto/slo.dto';

@ApiTags('Reliability (SLOs & tracing)')
@Controller({ path: 'operational', version: '1' })
export class SloController {
  constructor(
    private readonly slo: SloService,
    private readonly tracing: TracingService,
  ) {}

  // ------------------------------------------------------------------
  // definitions + evaluations
  // ------------------------------------------------------------------

  @Get('slos')
  @ApiOperation({
    summary: 'Every SLO: latest definition version plus its latest evaluation.',
    description:
      'The panel table. `includeDisabled=true` also lists objectives whose evaluation is switched off (their rows stay queryable - disabling measurement is not deleting evidence).',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The status list.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async list(
    @Query() query: ListSloDefinitionsDto,
  ): Promise<{ items: SloStatusView[]; total: number }> {
    const items = await this.slo.listStatuses({
      service: query.service,
      includeDisabled: query.includeDisabled === true,
    });
    return { items, total: items.length };
  }

  @Get('slos/readiness')
  @ApiOperation({
    summary: 'The scorecard rollup: states, worst budget, max burn, paging ids.',
    description:
      'Derived from the latest evaluation PER definition (the same rows the table shows - no parallel truth). The note states what the numbers may not authorise.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The rollup.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async readiness(): Promise<SloReadinessView> {
    return this.slo.rollup();
  }

  @Get('slos/:sloId')
  @ApiOperation({ summary: 'One SLO: definition, latest evaluation, burn verdict.' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async status(@Param() params: SloParamDto): Promise<SloStatusView> {
    return this.slo.getStatus(params.sloId);
  }

  @Get('slos/:sloId/versions')
  @ApiOperation({
    summary: 'The versioned definition history, newest first.',
    description:
      'Append-only: every entry is exactly what was published when it was published, payload and checksum included, so "what were we promising in July" is a query, not archaeology.',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async versions(
    @Param() params: SloParamDto,
    @Query() query: ListSloEvaluationsDto,
  ): Promise<PaginatedResult<unknown>> {
    return this.slo.listVersions(params.sloId, query);
  }

  @Get('slos/:sloId/evaluations')
  @ApiOperation({
    summary: 'Evaluation rows, newest first. Null ppm means "undefined for the window".',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async evaluations(
    @Param() params: SloParamDto,
    @Query() query: ListSloEvaluationsDto,
  ): Promise<PaginatedResult<unknown>> {
    return this.slo.listEvaluations(params.sloId, query);
  }

  @Post('slos/:sloId/config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish a new definition version (or toggle enablement). Audited.',
    description:
      'The definition is canonicalised, checksummed and appended at the next version; the previous version stays queryable forever. Publishing the IDENTICAL enabled definition is a no-op answered with the current status - no phantom version, no audit line. Redefining what the platform promises is exactly as consequential as it sounds, which is why it needs the explicit (non-wildcard) update permission.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The new status row (no evaluation yet).' })
  @RequirePermissions(Permission.OPERATIONS_SLO_UPDATE)
  async publishConfig(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Param() params: SloParamDto,
    @Body() dto: UpdateSloConfigDto,
  ): Promise<SloStatusView> {
    return this.slo.publishConfig({
      actor: this.actor(tenantId, actor, meta),
      sloId: params.sloId,
      update: dto,
    });
  }

  @Post('slos/:sloId/evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate one SLO now. Audited as a request to measure.',
    description:
      'Same code path as the scheduled tick for this one objective: read windows, insert a row, update gauges, fold burn alerts. The audit exists because an operator asking the platform to look at itself is an operational fact.',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async evaluateOne(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Param() params: SloParamDto,
  ): Promise<{ evaluated: number; alertingSloIds: string[] }> {
    const result = await this.slo.evaluateAll(
      this.actor(tenantId, actor, meta),
      'manual',
      params.sloId,
    );
    return { evaluated: result.evaluated, alertingSloIds: result.alertingSloIds };
  }

  @Post('slos/evaluate-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate every enabled SLO now. Audited.',
    description:
      'Idempotent by construction: it appends evaluation rows (the evidence log tolerates repeats) and the burn fold counts occurrences rather than duplicating rows.',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async evaluateAll(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ evaluated: number; alertingSloIds: string[]; skipped: Array<{ sloId: string; error: string }> }> {
    const result = await this.slo.evaluateAll(this.actor(tenantId, actor, meta), 'manual');
    return {
      evaluated: result.evaluated,
      alertingSloIds: result.alertingSloIds,
      skipped: result.skipped,
    };
  }

  // ------------------------------------------------------------------
  // tracing + fault posture (read-only, plus a flush that changes no truth)
  // ------------------------------------------------------------------

  @Get('tracing')
  @ApiOperation({
    summary: 'Tracing posture of this process: config booleans and counters.',
    description:
      'The endpoint is reported as CONFIGURED/not, never as text - posture belongs in a panel, URLs belong in the deployment. `droppedTotal` is the sum of per-reason drop counts: the exporter drops loudly and counts every one.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The status view.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async tracingStatus(): Promise<TracingStatusView> {
    return this.tracing.statusView();
  }

  @Post('tracing/flush')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run one export tick now (same code path as the interval loop).',
    description:
      'Changes WHEN evidence leaves, never WHAT it says. Bounded like the loop: one batch per call, dropped-or-exported counted, no retry queue - a manual flush against a dead collector fails exactly once and reports it.',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async tracingFlush(): Promise<{ exported: number; outcome: string }> {
    return this.tracing.flushNow();
  }

  @Get('faults')
  @ApiOperation({
    summary: 'The config-armed fault plan (describe only - nothing consumes or arms from the API).',
    description:
      'Fault points are a closed set, armed only through environment configuration, and never in production (the env validator refuses the boot). This route exists so the panel can state the difference between "no faults armed" and "fault injection is not available here" instead of letting operators guess from an absence.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The posture.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  faultsStatus(): FaultsStatusView {
    const plan = this.tracing.faultPlan();
    return {
      enabled: plan.enabled,
      production: process.env.NODE_ENV === 'production',
      // Cast is total here: the two API-side points are members of the
      // closed enum; the plan cannot contain anything else by construction.
      activePoints: plan.points as FaultsStatusView['activePoints'],
    };
  }

  @Get('traces/current')
  @ApiOperation({
    summary: 'This request’s own trace identity (traceparent + ids).',
    description:
      'For the console affordance "copy trace id" during an incident. It reports the CURRENT request only - there is no trace search, no trace store, no retention promise. Spans that left this process are the collector’s business.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The context, or nulls when tracing is off/unsampled.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  currentTrace(): CurrentTraceView {
    const handle = this.tracing.currentHandle();
    if (handle === null) {
      return { traceparent: null, traceId: null, spanId: null, sampled: false };
    }
    return {
      traceparent: formatTraceparent(handle.context),
      traceId: handle.context.traceId,
      spanId: handle.context.spanId,
      sampled: handle.sampled,
    };
  }

  private actor(tenantId: string, user: AuthenticatedActor, meta: RequestMetadata): SloActor {
    return {
      userId: user.userId,
      tenantId,
      platform: user.isPlatformUser === true,
      requestId: meta.requestId,
      correlationId: meta.correlationId ?? meta.requestId,
    };
  }
}
