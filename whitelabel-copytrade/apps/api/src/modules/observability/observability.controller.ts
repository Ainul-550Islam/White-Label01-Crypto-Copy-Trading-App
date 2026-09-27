import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type { AuthenticatedActor, PaginatedResult } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';

import { AlertsService } from './alerts.service';
import { IncidentsService } from './incidents.service';
import { ObservabilityService } from './observability.service';
import { TradingReadinessService } from '../health/trading-readiness.service';
import {
  WorkerCoordinationReadService,
  type WorkerCoordinationView,
} from './worker-coordination-read.service';
import type { OpsActor, OpsOverviewSection, OpsOverviewView, QueueStatsView, TradingReadinessView, OpsAlertView, OpsIncidentView } from './observability.types';
import {
  AcknowledgeAlertDto,
  ForceResolveAlertDto,
  ListOpsAlertsDto,
  ListOpsIncidentsDto,
  SetIncidentStatusDto,
} from './dto/observability.dto';

/**
 * The operations read surface and the alert lifecycle.
 *
 * What is NOT here, in the order it will be asked for: no route disables the
 * risk engine, no route approves or replays an order, no route releases a
 * kill switch, no route writes a metric. `/health/trading` reports; the
 * readiness verdict it shows has the same authority over an order as a
 * speedometer has over the brakes - which is to say none, and that is the
 * design. The enforcement pair (risk gate + kill switches) lives with the
 * engine and the risk console; alert acknowledgement lives here because
 * acknowledging an alert is *operationally* identical to "a human has this",
 * which changes no trading state whatsoever.
 *
 * Mutations are POST commands with DTOs and audit rows - the platform's
 * uniform write discipline (no PUT/PATCH anywhere in the API, and this part
 * does not start).
 */
@ApiTags('Operations')
@Controller({ path: 'observability', version: '1' })
export class ObservabilityController {
  constructor(
    private readonly observability: ObservabilityService,
    private readonly alerts: AlertsService,
    private readonly incidents: IncidentsService,
    private readonly readiness: TradingReadinessService,
    private readonly workerCoordinationView: WorkerCoordinationReadService,
  ) {}

  // ------------------------------------------------------------------
  // readiness + panels
  // ------------------------------------------------------------------
  @Get('overview')
  @ApiOperation({ summary: 'The operations panel document (sections, mirrors, alert counts).' })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The derived overview.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async overview(@TenantId() tenantId: string): Promise<OpsOverviewView> {
    return this.observability.overview(tenantId);
  }

  @Get('worker-coordination')
  @ApiOperation({
    summary: 'Trading-worker partition claims as recorded in Redis (read-only).',
    description:
      'Who holds each execution partition and how long each claim has left. ' +
      'Observation only: an absent or expired claim means no live claim, not ' +
      'a dead worker - the lease law is the arbiter, exactly as it is for the ' +
      'workers themselves.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Fleet partition-claim table for this deployment.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async workerCoordination(): Promise<WorkerCoordinationView> {
    return this.workerCoordinationView.readState();
  }

  @Get('trading-readiness')
  @ApiOperation({
    summary: 'The merged trading-readiness verdict for this tenant context',
    description:
      'Same evaluation as GET /health/trading, wrapped for the console with RBAC. Reports only.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Gate-by-gate verdict.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async tradingReadiness(): Promise<TradingReadinessView> {
    return this.readiness.evaluate();
  }

  @Get('market-data')
  @ApiOperation({ summary: 'Market-data service health mirrors (freshness, staleness, components).' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async marketData(): Promise<{ services: unknown[]; note: string }> {
    return this.observability.marketData();
  }

  @Get('risk')
  @ApiOperation({ summary: 'Risk-plane operations section (gate verdicts, events, switches).' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async risk(@TenantId() tenantId: string): Promise<{ sections: OpsOverviewSection[] }> {
    return { sections: await this.observability.riskPanel(tenantId) };
  }

  @Get('execution')
  @ApiOperation({ summary: 'Execution-plane operations section (adapter mirror, incidents, order mix).' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async execution(@TenantId() tenantId: string): Promise<{ sections: OpsOverviewSection[] }> {
    return { sections: await this.observability.executionPanel(tenantId) };
  }

  @Get('queues')
  @ApiOperation({ summary: 'Queue depths and oldest-waiting ages with the per-queue alert policy.' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async queues(): Promise<{ queues: QueueStatsView[]; note: string }> {
    return this.observability.queueStatus();
  }

  @Get('datasets')
  @ApiOperation({ summary: 'Dataset ingestion run mix (states, not payloads).' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async datasets(): Promise<{ sections: OpsOverviewSection[] }> {
    return { sections: await this.observability.datasets() };
  }

  // ------------------------------------------------------------------
  // alerts
  // ------------------------------------------------------------------
  @Get('alerts')
  @ApiOperation({ summary: 'Deduplicated operational alerts (folded by rule|component|scope).' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async listAlerts(@TenantId() tenantId: string, @Query() query: ListOpsAlertsDto): Promise<PaginatedResult<OpsAlertView>> {
    return this.alerts.list({
      page: query.page,
      limit: query.limit,
      state: query.state,
      severity: query.severity,
      component: query.component,
      tenantId,
    });
  }

  @Get('alerts/:id')
  @ApiOperation({ summary: 'One alert with its correlation links.' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async getAlert(@TenantId() tenantId: string, @Param('id') id: string): Promise<OpsAlertView> {
    return this.alerts.get(tenantId, id);
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Acknowledge an OPEN alert (a human has it). Never resolves; never unlocks.',
    description:
      'Transitions OPEN -> ACKNOWLEDGED only. Acknowledging is not approval of anything: ' +
      'trading state does not move on this call - the alert stays exactly as open as it was, ' +
      'just with a name attached to it.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The acknowledged alert.' })
  @RequirePermissions(Permission.OPERATIONS_ALERTS_UPDATE)
  async acknowledgeAlert(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Param('id') id: string,
    @Body() dto: AcknowledgeAlertDto,
  ): Promise<{ accepted: true; alert: OpsAlertView }> {
    return this.alerts.acknowledge(this.opsActor(tenantId, actor, meta, false), id, dto.reason);
  }

  @Post('alerts/:id/force-resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close an alert WITHOUT an observed recovery. Typed phrase required.',
    description:
      'The exception path. Publisher-observed recovery resolves alerts on its own; this route ' +
      'exists for the rare case where the condition is gone but the publisher cannot see it yet. ' +
      'It requires the confirmation phrase verbatim, a 20-character reason, and it writes an ' +
      'immediate audit row. It never deletes history.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The resolved alert.' })
  @RequirePermissions(Permission.OPERATIONS_ALERTS_UPDATE)
  async forceResolveAlert(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Param('id') id: string,
    @Body() dto: ForceResolveAlertDto,
  ): Promise<{ accepted: true; alert: OpsAlertView }> {
    return this.alerts.forceResolve(
      this.opsActor(tenantId, actor, meta, false),
      id,
      dto.reason,
      dto.confirmPhrase,
    );
  }

  // ------------------------------------------------------------------
  // incidents
  // ------------------------------------------------------------------
  @Get('incidents')
  @ApiOperation({ summary: 'Incidents: correlated operational stories, links only.' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async listIncidents(@TenantId() tenantId: string, @Query() query: ListOpsIncidentsDto): Promise<PaginatedResult<OpsIncidentView>> {
    return this.incidents.list(tenantId, { page: query.page, limit: query.limit, status: query.status });
  }

  @Get('incidents/:id')
  @ApiOperation({ summary: 'One incident with its full link set.' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async getIncident(@TenantId() tenantId: string, @Param('id') id: string): Promise<OpsIncidentView> {
    return this.incidents.get(tenantId, id);
  }

  @Post('incidents/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move an incident OPEN -> REVIEWING -> CLOSED (closing requires a note).',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The updated incident.' })
  @RequirePermissions(Permission.OPERATIONS_ALERTS_UPDATE)
  async setIncidentStatus(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Param('id') id: string,
    @Body() dto: SetIncidentStatusDto,
  ): Promise<OpsIncidentView> {
    return this.incidents.setStatus(this.opsActor(tenantId, actor, meta, false), id, dto.status, dto.note);
  }

  private opsActor(
    tenantId: string,
    actor: AuthenticatedActor,
    meta: RequestMetadata,
    _platformOverride: boolean,
  ): OpsActor {
    return {
      userId: actor.userId,
      tenantId,
      // Platform-scope actors may move tenant-null infrastructure rows; the
      // scope is read from the authenticated actor, never from the request.
      platform: actor.isPlatformUser === true,
      requestId: meta.requestId,
      correlationId: meta.correlationId ?? meta.requestId,
    };
  }
}
