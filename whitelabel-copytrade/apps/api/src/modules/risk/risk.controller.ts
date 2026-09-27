import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { RiskPolicyService } from './risk-policy.service';
import { RiskProtectionService } from './risk-protection.service';
import { RiskStateService } from './risk-state.service';
import {
  AcknowledgeRiskSwitchDto,
  UpdateRiskPolicyDto,
  RollbackRiskPolicyDto,
  ClearRiskSwitchDto,
  EngageRiskSwitchDto,
  ListRiskEventsDto,
  ListRiskSnapshotsDto,
  ListRiskSwitchesDto,
  DailyPnlQueryDto,
} from './dto/risk.dto';
import type {
  AccountRiskSummaryView,
  DailyPnlPointView,
  RiskCommandAcceptedView,
  RiskConfigurationView,
  RiskEventView,
  RiskExposureView,
  RiskProtectionView,
  RiskSnapshotMetadataView,
  RiskStatusView,
  RiskSwitchView,
  StrategyRiskSummaryView,
} from './risk.types';

/**
 * The risk console's control plane.
 *
 * The sentence this file exists to make true: the API plane exposes
 * configuration and operational controls, not order execution and not an
 * order-level approval queue. Everything reachable from these routes either
 * READS risk state or changes what the engine will apply to every order in
 * a scope - there is no route here that approves, rejects, re-queues or
 * replays an individual order, and no route that submits one. The place an
 * order meets the risk engine is inside the execution path itself (Part 5 +
 * the Python gate), before the venue call; a console button that could wave
 * an order through that gate would delete the gate.
 *
 * Deliberately absent, so the absence is on the record:
 *
 *   * PUT/PATCH anywhere - every mutation is a POST command with a body DTO
 *     and an audit entry, matching the execution and dataset surfaces;
 *   * an "exemption" endpoint - exemptions are computed by the engine from
 *     the projected effect of each order (risk-reducing or not). There is
 *     nothing here to toggle;
 *   * a route that clears a protection without the typed confirmation, or a
 *     triggered switch without a prior acknowledgement - the DTO and the
 *     service both enforce that; this file just wires them;
 *   * any write to GLOBAL or EXCHANGE scoped switches - refused in the
 *     protection service, and the engage DTO's enum does not even offer them.
 *
 * Route order: the literal `limits/rollback` and `kill-switches/engage`
 * paths are declared before `:accountId`-style parameters cannot collide
 * with them (different prefixes), and the order is written down here because
 * Nest matches declaration order for same-prefix literals elsewhere.
 */
@ApiTags('risk')
@Controller('v1/risk')
export class RiskController {
  constructor(
    private readonly policy: RiskPolicyService,
    private readonly protection: RiskProtectionService,
    private readonly state: RiskStateService,
  ) {}

  // -- state reads ---------------------------------------------------------------

  @Get('status')
  @ApiOperation({
    summary: 'Aggregated risk posture: engine config, mirror freshness, active halts',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Risk status view (mirrored state, timestamped).' })
  @RequirePermissions(Permission.RISK_READ)
  async status(@TenantId() tenantId: string): Promise<RiskStatusView> {
    return this.state.status(tenantId);
  }

  @Get('accounts/:accountId/limits')
  @ApiOperation({ summary: 'Effective limits for an account, annotated with source scope.' })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The versioned configuration resolved for the account.' })
  @RequirePermissions(Permission.RISK_READ)
  async limits(
    @TenantId() tenantId: string,
    @Param('accountId') accountId: string,
  ): Promise<RiskConfigurationView> {
    return this.policy.getConfig(tenantId, accountId);
  }

  @Post('accounts/:accountId/limits')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Replace an account risk configuration (new immutable version)',
    description:
      'A new version, never an edit: prior versions stay for audit and rollback, ' +
      'active snapshots stop being accepted by the engine, and any entry above the ' +
      'platform ceiling is refused outright. Widening any limit additionally ' +
      "requires the typed confirmation phrase 'WIDEN RISK LIMITS'.",
  })
  @ApiStandardResponses()
  @ApiCreatedResponse({ description: 'New configuration version created.' })
  @RequirePermissions(Permission.RISK_CONFIG_UPDATE)
  async updateLimits(
    @TenantId() tenantId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: UpdateRiskPolicyDto,
  ): Promise<RiskCommandAcceptedView> {
    return this.policy.updatePolicy(
      tenantId,
      accountId,
      { userId: actor.userId, requestId: meta.requestId },
      dto,
    );
  }

  @Post('accounts/:accountId/limits/rollback')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new configuration copying a prior version',
    description:
      'Rollback creates a new version equal to the targeted one; it never deletes ' +
      'or rewrites history. Rollback is only offered for versions the audit ' +
      'record can name an actor for.',
  })
  @ApiStandardResponses()
  @ApiCreatedResponse({ description: 'Rolled-back configuration version created.' })
  @RequirePermissions(Permission.RISK_CONFIG_UPDATE)
  async rollbackLimits(
    @TenantId() tenantId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: RollbackRiskPolicyDto,
  ): Promise<RiskCommandAcceptedView> {
    return this.policy.rollback(
      tenantId,
      accountId,
      { userId: actor.userId, requestId: meta.requestId },
      dto,
    );
  }

  @Get('events')
  @ApiOperation({ summary: 'Tenant risk event feed (decisions, protection actions, sync faults).' })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'A page of risk events.' })
  @RequirePermissions(Permission.RISK_READ)
  async events(
    @TenantId() tenantId: string,
    @Query() query: ListRiskEventsDto,
  ): Promise<PaginatedResult<RiskEventView>> {
    return this.state.listEvents(tenantId, query);
  }

  @Get('accounts/:accountId/exposure')
  @ApiOperation({
    summary: 'Latest mirrored exposure projection for one account',
    description:
      'Figures are the latest SYNCED snapshot metadata with its capture time - ' +
      'not a live read from the venue or the engine, and never presented as one.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Exposure view, or explicit nulls with stale markers.' })
  @RequirePermissions(Permission.RISK_READ)
  async exposure(
    @TenantId() tenantId: string,
    @Param('accountId') accountId: string,
  ): Promise<RiskExposureView> {
    return this.state.exposure(tenantId, accountId);
  }

  @Get('accounts/:accountId/snapshots')
  @ApiOperation({ summary: 'Snapshot metadata mirror pages for an account.' })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'A page of mirrored snapshot metadata.' })
  @RequirePermissions(Permission.RISK_READ)
  async snapshots(
    @TenantId() tenantId: string,
    @Param('accountId') accountId: string,
    @Query() query: ListRiskSnapshotsDto,
  ): Promise<PaginatedResult<RiskSnapshotMetadataView>> {
    return this.state.listSnapshots(tenantId, { ...query, accountId });
  }

  @Get('accounts/:accountId/daily-pnl')
  @ApiOperation({
    summary: 'Daily equity + net PnL points for an account (UTC day, from mirrored snapshots)',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Chronological PnL points for the day.' })
  @RequirePermissions(Permission.RISK_READ)
  async dailyPnl(
    @TenantId() tenantId: string,
    @Param('accountId') accountId: string,
    @Query() query: DailyPnlQueryDto,
  ): Promise<DailyPnlPointView[]> {
    return this.state.dailyPnl(tenantId, { accountId, day: query.day });
  }

  @Get('accounts/:accountId/summary')
  @ApiOperation({ summary: 'Everything the risk console shows about one account, in one read.' })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Account summary aggregate.' })
  @RequirePermissions(Permission.RISK_READ)
  async accountSummary(
    @TenantId() tenantId: string,
    @Param('accountId') accountId: string,
  ): Promise<AccountRiskSummaryView> {
    return this.state.accountSummary(tenantId, accountId);
  }

  @Get('strategies/:strategyId/summary')
  @ApiOperation({ summary: 'Strategy-scoped limit entries, switch, events, and last protection action.' })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Strategy risk summary.' })
  @RequirePermissions(Permission.RISK_READ)
  async strategySummary(
    @TenantId() tenantId: string,
    @Param('strategyId') strategyId: string,
  ): Promise<StrategyRiskSummaryView> {
    return this.state.strategySummary(tenantId, strategyId);
  }

  // -- switches & protections --------------------------------------------------------

  @Get('kill-switches')
  @ApiOperation({ summary: 'All kill switches visible to the tenant, with lifecycle status.' })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Kill switch rows (tenant-scoped; GLOBAL shown read-only).' })
  @RequirePermissions(Permission.RISK_READ)
  async switches(
    @TenantId() tenantId: string,
    @Query() query: ListRiskSwitchesDto,
  ): Promise<RiskSwitchView[]> {
    return this.protection.list(tenantId, query);
  }

  @Post('kill-switches/engage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Engage an ACCOUNT/STRATEGY/SYMBOL kill switch',
    description:
      'Engage needs a reason and nothing else. The engine refuses every ' +
      'non-risk-reducing order in scope immediately; the durable row is the ' +
      'safety, notifications only narrow the sync window.',
  })
  @ApiStandardResponses()
  @ApiCreatedResponse({ description: 'Kill switch engaged.' })
  @RequirePermissions(Permission.RISK_KILL_SWITCH_UPDATE)
  async engage(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: EngageRiskSwitchDto,
  ): Promise<RiskSwitchView> {
    return this.protection.engage(tenantId, { userId: actor.userId, requestId: meta.requestId }, dto);
  }

  @Post('kill-switches/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Acknowledge a TRIGGERED protection (the gate before any clear)',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Switch acknowledged.' })
  @RequirePermissions(Permission.RISK_KILL_SWITCH_UPDATE)
  async acknowledge(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: AcknowledgeRiskSwitchDto,
  ): Promise<RiskSwitchView> {
    return this.protection.acknowledge(
      tenantId,
      id,
      { userId: actor.userId, requestId: meta.requestId },
      dto,
    );
  }

  @Post('kill-switches/:id/clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear an engaged switch (typed confirmation required)',
    description:
      "Requires exactly 'CLEAR RISK PROTECTION' plus a >=20-character reason; a " +
      'switch triggered by automatic protection must be acknowledged first. ' +
      'Clearing resumes TRADING, not merely display.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Switch cleared; engine resumes on its next sync.' })
  @RequirePermissions(Permission.RISK_PROTECTION_CLEAR)
  async clear(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: ClearRiskSwitchDto,
  ): Promise<RiskSwitchView> {
    return this.protection.clear(tenantId, id, { userId: actor.userId, requestId: meta.requestId }, dto);
  }

  @Get('protections')
  @ApiOperation({ summary: 'Protection trip records (account-scoped actions with lifecycle).' })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'Active (and optionally cleared) protection trips.' })
  @RequirePermissions(Permission.RISK_READ)
  async protections(
    @TenantId() tenantId: string,
    @Query('accountId') accountId: string | undefined,
    @Query('includeCleared') includeCleared: string | undefined,
  ): Promise<RiskProtectionView[]> {
    return this.protection.listProtections(
      tenantId,
      accountId ?? null,
      includeCleared === 'true',
    );
  }
}
