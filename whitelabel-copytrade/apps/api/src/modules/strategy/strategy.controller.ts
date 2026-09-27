import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';

import { StrategyCatalogService } from './strategy-catalog.service';
import { StrategyInstancesService } from './strategy-instances.service';
import { StrategyIncidentsService } from './strategy-incidents.service';
import { StrategyMetricsService } from './strategy-metrics.service';
import {
  DisableStrategyInstanceDto,
  EnableStrategyInstanceDto,
  ListStrategyDefinitionsDto,
  ListStrategyIncidentsDto,
  ListStrategyInstancesDto,
  ListStrategyRunsDto,
  ListStrategyVersionsDto,
  ResolveStrategyIncidentDto,
} from './dto/strategy.dto';
import type {
  StrategyCommandAcceptedView,
  StrategyDefinitionView,
  StrategyIncidentView,
  StrategyInstanceStatusView,
  StrategyInstanceView,
  StrategyMetricsView,
  StrategyRunView,
  StrategyVersionView,
} from './strategy.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';
import type { AuthenticatedActor } from '@wlct/shared-types';

/**
 * The strategy catalogue and the instances running from it.
 *
 * What this controller does not have is as important as what it does. There is
 * no route that submits an order, no route that arms live trading, and no
 * route that creates a catalogue entry - the catalogue describes code that
 * ships with the release, and an entry with nothing behind it is a trap.
 *
 * Enabling and disabling are asymmetric on purpose. Disabling needs a short
 * reason and nothing else. Enabling needs a real reason, a runnable published
 * version, an instance that is not quarantined, an engine that is actually
 * running, and - when the deployment is armed for live execution - a typed
 * confirmation phrase.
 */
@ApiTags('Strategies')
@Controller({ path: 'strategies', version: '1' })
@ApiStandardResponses()
export class StrategyController {
  constructor(
    private readonly catalog: StrategyCatalogService,
    private readonly instances: StrategyInstancesService,
    private readonly incidents: StrategyIncidentsService,
    private readonly metrics: StrategyMetricsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Catalogue
  // ---------------------------------------------------------------------------

  @Get('definitions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_READ)
  @ApiOperation({ summary: 'List strategy definitions' })
  @ApiOkResponse({
    description:
      'The catalogue of implementations. `riskNotes` is rendered verbatim by every client and ' +
      'never rewritten into a performance claim.',
  })
  async listDefinitions(
    @Query() query: ListStrategyDefinitionsDto,
  ): Promise<PaginatedResult<StrategyDefinitionView>> {
    return this.catalog.listDefinitions(query);
  }

  @Get('definitions/:key')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_READ)
  @ApiOperation({ summary: 'Fetch one definition with its versions' })
  @ApiOkResponse({ description: 'The definition.' })
  async getDefinition(@Param('key') key: string): Promise<StrategyDefinitionView> {
    return this.catalog.getDefinition(key);
  }

  @Get('definitions/:key/versions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_VERSION_READ)
  @ApiOperation({ summary: 'List versions of one definition' })
  @ApiOkResponse({
    description:
      'Versions with their parameter schemas. Behaviour is frozen per version: a change ' +
      'requires a new version rather than an edit.',
  })
  async listVersions(
    @Param('key') key: string,
    @Query() query: ListStrategyVersionsDto,
  ): Promise<StrategyVersionView[]> {
    return this.catalog.listVersions(key, query);
  }

  // ---------------------------------------------------------------------------
  // Instances
  // ---------------------------------------------------------------------------

  @Get('instances')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_READ)
  @ApiOperation({ summary: 'List strategy instances' })
  @ApiOkResponse({
    description:
      'Paginated instances for the calling tenant. `health` is reported separately from ' +
      '`enabled`: an instance can be enabled and unhealthy at the same time.',
  })
  async listInstances(
    @Query() query: ListStrategyInstancesDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<StrategyInstanceView>> {
    return this.instances.list({ ...query, tenantId });
  }

  @Get('instances/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_READ)
  @ApiOperation({ summary: 'Fetch one instance' })
  @ApiOkResponse({ description: 'The instance.' })
  async getInstance(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<StrategyInstanceView> {
    return this.instances.get(tenantId, id);
  }

  @Get('instances/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_READ)
  @ApiOperation({ summary: 'Operational status of one instance' })
  @ApiOkResponse({
    description:
      'Current run, open incidents, last checkpoint, and whether live execution is reachable ' +
      'at all in this deployment.',
  })
  async getInstanceStatus(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<StrategyInstanceStatusView> {
    return this.instances.getStatus(tenantId, id);
  }

  @Get('instances/:id/runs')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_READ)
  @ApiOperation({ summary: 'Run history for one instance' })
  @ApiOkResponse({ description: 'Runs, newest first, with their end-of-run counters.' })
  async listRuns(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ListStrategyRunsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<StrategyRunView>> {
    return this.instances.listRuns(tenantId, id, query);
  }

  @Post('instances/:id/enable')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_ENABLE)
  @ApiOperation({ summary: 'Start a strategy instance' })
  @ApiOkResponse({
    description:
      'Acknowledgement. Starting a strategy makes it emit signals; it does not enable live ' +
      'trading, and the response states the effective trading mode.',
  })
  async enableInstance(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: EnableStrategyInstanceDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<StrategyCommandAcceptedView> {
    return this.instances.enable(
      tenantId,
      id,
      { userId: user.userId, requestId: meta.requestId },
      body,
    );
  }

  @Post('instances/:id/disable')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_DISABLE)
  @ApiOperation({ summary: 'Stop a strategy instance' })
  @ApiOkResponse({
    description:
      'Acknowledgement. The instance is marked disabled immediately, before the worker is ' +
      'notified, so a queue outage cannot leave a strategy running.',
  })
  async disableInstance(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: DisableStrategyInstanceDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<StrategyCommandAcceptedView> {
    return this.instances.disable(
      tenantId,
      id,
      { userId: user.userId, requestId: meta.requestId },
      body,
    );
  }

  // ---------------------------------------------------------------------------
  // Incidents and metrics
  // ---------------------------------------------------------------------------

  @Get('incidents')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INCIDENT_READ)
  @ApiOperation({ summary: 'List strategy incidents' })
  @ApiOkResponse({ description: 'Incidents raised by the strategy worker.' })
  async listIncidents(
    @Query() query: ListStrategyIncidentsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<StrategyIncidentView>> {
    return this.incidents.list({ ...query, tenantId });
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INCIDENT_RESOLVE)
  @ApiOperation({ summary: 'Close a strategy incident' })
  @ApiOkResponse({
    description:
      'The incident with its resolution recorded. Nothing describing what happened is edited.',
  })
  async resolveIncident(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: ResolveStrategyIncidentDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<StrategyIncidentView> {
    return this.incidents.resolve(
      tenantId,
      id,
      { userId: user.userId, requestId: meta.requestId },
      body.note,
    );
  }

  @Get('metrics')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_METRICS_READ)
  @ApiOperation({ summary: 'Strategy layer counters and configuration' })
  @ApiOkResponse({
    description:
      'Counters plus the effective configuration. `latencyNote` states that the processing ' +
      'budget is an observation target and not a guarantee.',
  })
  async getMetrics(@TenantId() tenantId: string): Promise<StrategyMetricsView> {
    return this.metrics.forTenant(tenantId);
  }
}
