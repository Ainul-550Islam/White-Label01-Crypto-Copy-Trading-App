import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type { AuthenticatedActor, PaginatedResult } from '@wlct/shared-types';

import { ReconciliationService } from './reconciliation.service';
import { ExecutionIncidentsService, type IncidentCounts } from './execution-incidents.service';
import { ExecutionSafetyService } from './execution-safety.service';
import { ExecutionCommandsService } from './execution-commands.service';
import { ExchangeAccountsService } from './exchange-accounts.service';
import {
  ListDiscrepanciesDto,
  ListIncidentsDto,
  ListReconciliationRunsDto,
  ResolutionNoteDto,
  SetKillSwitchDto,
} from './dto/execution.dto';
import type {
  CommandAcceptedView,
  ExecutionIncidentView,
  ExecutionSafetyView,
  KillSwitchView,
  ReconciliationDiscrepancyView,
  ReconciliationRunView,
} from './execution.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';

/**
 * Operations surface: safety state, kill switches, reconciliation and
 * incidents.
 *
 * This is the controller an operator has open during an incident, so the
 * ordering of the routes below follows the order the questions get asked:
 * what is the system allowed to do right now, what disagrees with the venue,
 * and what has already gone wrong.
 */
@ApiTags('Execution / Operations')
@Controller({ path: 'execution', version: '1' })
@ApiStandardResponses()
export class ExecutionAdminController {
  constructor(
    private readonly safety: ExecutionSafetyService,
    private readonly reconciliation: ReconciliationService,
    private readonly incidents: ExecutionIncidentsService,
    private readonly commands: ExecutionCommandsService,
    private readonly accounts: ExchangeAccountsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Safety
  // ---------------------------------------------------------------------------

  @Get('safety')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXECUTION_READ)
  @ApiOperation({ summary: 'Deployment safety state and every current blocker' })
  @ApiOkResponse({
    description:
      'Effective trading mode, each configuration switch, all kill switches, and the ' +
      'complete list of reasons a live order would not currently be transmitted.',
  })
  async safetyState(@TenantId() tenantId: string): Promise<ExecutionSafetyView> {
    return this.safety.safetySummary(tenantId);
  }

  @Get('kill-switches')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.KILL_SWITCH_READ)
  @ApiOperation({ summary: 'List kill switches affecting this organisation' })
  @ApiOkResponse({
    description: 'Includes the platform-wide GLOBAL switch, which a tenant can see but not release.',
  })
  async listKillSwitches(@TenantId() tenantId: string): Promise<KillSwitchView[]> {
    return this.safety.listKillSwitches(tenantId);
  }

  @Post('kill-switches')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.KILL_SWITCH_OPERATE)
  @ApiOperation({ summary: 'Engage or release a kill switch' })
  @ApiOkResponse({ description: 'The updated kill switch.' })
  async setKillSwitch(
    @Body() body: SetKillSwitchDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<KillSwitchView> {
    return this.safety.setKillSwitch(
      tenantId,
      { scope: body.scope, target: body.target, engaged: body.engaged, reason: body.reason },
      { userId: actor.userId, requestId: meta.requestId },
    );
  }

  // ---------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------

  @Get('reconciliation/runs')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.RECONCILIATION_READ)
  @ApiOperation({ summary: 'List reconciliation runs' })
  @ApiOkResponse({
    description:
      'Includes runs that found nothing and runs that failed. A gap in this list is itself ' +
      'the signal that reconciliation has stopped.',
  })
  async listRuns(
    @Query() query: ListReconciliationRunsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<ReconciliationRunView>> {
    return this.reconciliation.listRuns({ ...query, tenantId });
  }

  @Get('reconciliation/runs/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.RECONCILIATION_READ)
  @ApiOperation({ summary: 'Fetch one reconciliation run' })
  @ApiOkResponse({ description: 'The run.' })
  async getRun(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<ReconciliationRunView> {
    return this.reconciliation.getRun(tenantId, id);
  }

  @Get('reconciliation/discrepancies')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.RECONCILIATION_READ)
  @ApiOperation({ summary: 'List reconciliation discrepancies' })
  @ApiOkResponse({
    description:
      'Unreviewed discrepancies by default. Each records what the platform believed and ' +
      'what the venue reported; neither value is ever edited.',
  })
  async listDiscrepancies(
    @Query() query: ListDiscrepanciesDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<ReconciliationDiscrepancyView>> {
    return this.reconciliation.listDiscrepancies({ ...query, tenantId });
  }

  @Post('reconciliation/discrepancies/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.RECONCILIATION_RESOLVE)
  @ApiOperation({ summary: 'Close a discrepancy after human review' })
  @ApiOkResponse({
    description:
      'Marks the discrepancy reviewed. It does NOT alter the order, balance or position the ' +
      'discrepancy was about; that is always a separate, separately audited action.',
  })
  async resolveDiscrepancy(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: ResolutionNoteDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<ReconciliationDiscrepancyView> {
    return this.reconciliation.resolveDiscrepancy(
      tenantId,
      id,
      { userId: actor.userId, requestId: meta.requestId },
      body.note,
    );
  }

  @Post('accounts/:id/reconcile')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.RECONCILIATION_TRIGGER)
  @ApiOperation({ summary: 'Queue an out-of-band reconciliation pass for one account' })
  @ApiOkResponse({ description: 'The reconciliation job was queued.' })
  async triggerReconciliation(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<CommandAcceptedView> {
    await this.accounts.get(tenantId, id);
    const accepted = await this.commands.reconcileAccount(tenantId, id, actor.userId, 'MANUAL');
    await this.reconciliation.recordManualTrigger(
      tenantId,
      id,
      { userId: actor.userId, requestId: meta.requestId },
      accepted.jobId,
    );
    return accepted;
  }

  // ---------------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------------

  @Get('incidents')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXECUTION_INCIDENT_READ)
  @ApiOperation({ summary: 'List execution incidents' })
  @ApiOkResponse({ description: 'Unresolved incidents by default, worst severity first.' })
  async listIncidents(
    @Query() query: ListIncidentsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<ExecutionIncidentView>> {
    return this.incidents.list({ ...query, tenantId });
  }

  @Get('incidents/counts')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXECUTION_INCIDENT_READ)
  @ApiOperation({ summary: 'Incident counts by severity' })
  @ApiOkResponse({
    description:
      'Open, critical, warning, info, and how many have been unresolved for over an hour.',
  })
  async incidentCounts(@TenantId() tenantId: string): Promise<IncidentCounts> {
    return this.incidents.counts(tenantId);
  }

  @Get('incidents/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXECUTION_INCIDENT_READ)
  @ApiOperation({ summary: 'Fetch one execution incident' })
  @ApiOkResponse({ description: 'The incident, with its scrubbed detail payload.' })
  async getIncident(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<ExecutionIncidentView> {
    return this.incidents.get(tenantId, id);
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXECUTION_INCIDENT_RESOLVE)
  @ApiOperation({ summary: 'Close an execution incident' })
  @ApiOkResponse({ description: 'The resolved incident.' })
  async resolveIncident(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: ResolutionNoteDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<ExecutionIncidentView> {
    return this.incidents.resolve(
      tenantId,
      id,
      { userId: actor.userId, requestId: meta.requestId },
      body.note,
    );
  }
}
