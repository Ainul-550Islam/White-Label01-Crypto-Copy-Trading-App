import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type { AuthenticatedActor, PaginatedResult } from '@wlct/shared-types';

import { BacktestService } from './backtest.service';
import { PaperSessionsService } from './paper-sessions.service';
import {
  ListBacktestRunsDto,
  ListPaperSessionsDto,
  ListPaperSnapshotsDto,
  StartPaperSessionDto,
  StopPaperSessionDto,
  SubmitBacktestDto,
} from './dto/strategy.dto';
import type {
  BacktestMetricView,
  BacktestRunView,
  BacktestTradeView,
  PaperSessionView,
  PaperSnapshotView,
} from './strategy.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';

/**
 * Simulation: backtests over stored data, and paper sessions against the live
 * feed.
 *
 * Every response from this controller describes something that did not happen
 * in a market. Each one carries `isSimulated: true` and a disclaimer, applied
 * by the mapper rather than by each handler, because a label that has to be
 * remembered is a label that will be forgotten.
 *
 * BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
 * PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
 * SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.
 */
@ApiTags('Strategies / Simulation')
@Controller({ path: 'strategies', version: '1' })
@ApiStandardResponses()
export class StrategySimulationController {
  constructor(
    private readonly backtests: BacktestService,
    private readonly paper: PaperSessionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Backtests
  // ---------------------------------------------------------------------------

  @Post('backtests')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.BACKTEST_SUBMIT)
  @ApiOperation({ summary: 'Submit a backtest' })
  @ApiOkResponse({
    description:
      'The queued run. A backtest replays a stored dataset: it opens no socket, uses no ' +
      'credential and reaches no venue.',
  })
  async submitBacktest(
    @Body() body: SubmitBacktestDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<BacktestRunView> {
    return this.backtests.submit(
      tenantId,
      { userId: user.userId, requestId: meta.requestId },
      body,
    );
  }

  @Get('backtests')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BACKTEST_READ)
  @ApiOperation({ summary: 'List backtest runs' })
  @ApiOkResponse({
    description:
      'Paginated runs. Filter by `configurationHash` to find every run produced by one exact ' +
      'configuration: with the same dataset checksum they must have produced identical results.',
  })
  async listBacktests(
    @Query() query: ListBacktestRunsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<BacktestRunView>> {
    return this.backtests.list({ ...query, tenantId });
  }

  @Get('backtests/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BACKTEST_READ)
  @ApiOperation({ summary: 'Fetch one backtest result' })
  @ApiOkResponse({
    description:
      'The result. Risk-adjusted figures are null rather than zero when there were too few ' +
      'observations for them to mean anything; `hasSufficientObservations` says which case ' +
      'applies.',
  })
  async getBacktest(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<BacktestRunView> {
    return this.backtests.get(tenantId, id);
  }

  @Get('backtests/:id/metrics')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BACKTEST_READ)
  @ApiOperation({ summary: 'Named metrics for one backtest' })
  @ApiOkResponse({
    description:
      'Each metric carries its observation count and an `isSufficient` flag, so a consumer can ' +
      'tell "0.0" from "not enough data to say".',
  })
  async getBacktestMetrics(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<BacktestMetricView[]> {
    return this.backtests.listMetrics(tenantId, id);
  }

  @Get('backtests/:id/trades')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BACKTEST_READ)
  @ApiOperation({ summary: 'Simulated round trips for one backtest' })
  @ApiOkResponse({
    description:
      'Trades in deterministic order. `isWin` is net of fees, and a round trip that realised ' +
      'exactly zero is still listed because it still paid them.',
  })
  async getBacktestTrades(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: PaginationQueryDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<BacktestTradeView>> {
    return this.backtests.listTrades(tenantId, id, query);
  }

  // ---------------------------------------------------------------------------
  // Paper sessions
  // ---------------------------------------------------------------------------

  @Post('paper-sessions')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.PAPER_SESSION_OPERATE)
  @ApiOperation({ summary: 'Start a paper trading session' })
  @ApiOkResponse({
    description:
      'The starting session. Fills are produced by the simulator against observed prices; the ' +
      'session refuses to be constructed with anything but a simulated adapter.',
  })
  async startPaperSession(
    @Body() body: StartPaperSessionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<PaperSessionView> {
    return this.paper.start(tenantId, { userId: user.userId, requestId: meta.requestId }, body);
  }

  @Post('paper-sessions/:id/stop')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAPER_SESSION_OPERATE)
  @ApiOperation({ summary: 'Stop a paper trading session' })
  @ApiOkResponse({ description: 'The stopped session with its final counters.' })
  async stopPaperSession(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: StopPaperSessionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<PaperSessionView> {
    return this.paper.stop(
      tenantId,
      id,
      { userId: user.userId, requestId: meta.requestId },
      body,
    );
  }

  @Get('paper-sessions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAPER_SESSION_READ)
  @ApiOperation({ summary: 'List paper trading sessions' })
  @ApiOkResponse({ description: 'Paginated sessions, every one labelled simulated.' })
  async listPaperSessions(
    @Query() query: ListPaperSessionsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<PaperSessionView>> {
    return this.paper.list({ ...query, tenantId });
  }

  @Get('paper-sessions/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAPER_SESSION_READ)
  @ApiOperation({ summary: 'Fetch one paper session' })
  @ApiOkResponse({ description: 'The session.' })
  async getPaperSession(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<PaperSessionView> {
    return this.paper.get(tenantId, id);
  }

  @Get('paper-sessions/:id/snapshots')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAPER_SESSION_READ)
  @ApiOperation({ summary: 'Simulated equity curve for one paper session' })
  @ApiOkResponse({
    description:
      'Snapshots in sequence order. Sampled on a slow schedule and on stop - never per fill ' +
      'and never per tick.',
  })
  async getPaperSnapshots(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ListPaperSnapshotsDto,
    @TenantId() tenantId: string,
  ): Promise<PaperSnapshotView[]> {
    return this.paper.listSnapshots(tenantId, id, query);
  }
}
