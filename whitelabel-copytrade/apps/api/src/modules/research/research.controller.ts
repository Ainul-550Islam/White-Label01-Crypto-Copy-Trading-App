import { Controller, Get, Post, Put, Body, Param, Query, Request, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { StrategyVersionService } from './strategy-version.service';
import { MarketDataService } from './market-data-service';
import { MarketDataProviderFactory } from './market-data-provider.factory';
import { DatasetValidationService } from './dataset-validation.service';
import { ResearchRepository } from './research-repository';
import { BacktestRepository } from './backtest-repository';
import { BacktestEngineService } from './backtest-engine.service';
import { BacktestConfigService } from './backtest-config.service';
import { WalkForwardService } from './walk-forward.service';
import { MonteCarloService } from './monte-carlo.service';
import { ParameterSweepService } from './parameter-sweep.service';
import { StrategyBenchmarkService } from './strategy-benchmark.service';
import { PaperTradingService } from './paper-trading.service';
import { PaperOrderService } from './paper-order.service';
import { PaperPerformanceService } from './paper-performance.service';
import { SignalService } from './signal.service';
import { SignalFilterService } from './signal-filter.service';
import { ResearchPromotionService } from './research-promotion.service';
import { PaperTradingRepository } from './paper-trading-repository';
import { CreateDatasetDto, CreateStrategyVersionDto, CreateBacktestDto, WalkForwardDto, MonteCarloDto, ParameterSweepDto, BenchmarkDto, CreatePaperSessionDto, CreatePaperOrderDto, CreateSignalDto, CreatePromotionDto, PromotionActionDto } from './dto/backtest.dto';

/**
 * RBAC/tenant-protected API for research, datasets, strategy versions, backtests, paper sessions, signals, and promotion actions.
 */
@Controller('research')
export class ResearchController {
  constructor(
    private readonly strategyVersionService: StrategyVersionService,
    private readonly marketDataService: MarketDataService,
    private readonly providerFactory: MarketDataProviderFactory,
    private readonly datasetValidation: DatasetValidationService,
    private readonly researchRepo: ResearchRepository,
    private readonly backtestRepo: BacktestRepository,
    private readonly backtestEngine: BacktestEngineService,
    private readonly backtestConfigService: BacktestConfigService,
    private readonly walkForwardService: WalkForwardService,
    private readonly monteCarloService: MonteCarloService,
    private readonly parameterSweepService: ParameterSweepService,
    private readonly benchmarkService: StrategyBenchmarkService,
    private readonly paperTradingService: PaperTradingService,
    private readonly paperOrderService: PaperOrderService,
    private readonly paperPerformanceService: PaperPerformanceService,
    private readonly signalService: SignalService,
    private readonly signalFilterService: SignalFilterService,
    private readonly promotionService: ResearchPromotionService,
    private readonly paperRepo: PaperTradingRepository,
  ) {}

  private getContext(req: any): { tenantId: string; userId: string; roles: string[] } {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.userId;
    const roles = req.user?.roles || [];
    if (!tenantId) throw new BadRequestException('tenantId required');
    if (!userId) throw new BadRequestException('userId required');
    return { tenantId, userId, roles };
  }

  private isAdmin(roles: string[]): boolean {
    return roles.includes('admin') || roles.includes('tenant_admin') || roles.includes('platform_admin') || roles.includes('research_admin');
  }

  // Datasets
  @Post('datasets')
  async createDataset(@Request() req: any, @Body() dto: CreateDatasetDto) {
    const { tenantId, userId } = this.getContext(req);
    const fingerprint = this.researchRepo.computeFingerprint({ venue: dto.venue, symbol: dto.symbol, timeframe: dto.timeframe, startTime: dto.startTime, endTime: dto.endTime, source: dto.source });
    const dataset = await this.researchRepo.createDataset({
      tenantId,
      name: dto.name,
      description: dto.description || null,
      venue: dto.venue,
      symbol: dto.symbol,
      timeframe: dto.timeframe,
      timezone: dto.timezone || 'UTC',
      source: dto.source,
      sourceMetadata: dto.sourceMetadata || {},
      startTime: new Date(dto.startTime),
      endTime: new Date(dto.endTime),
      fingerprint,
      checksum: null,
      status: 'DRAFT' as any,
      recordCount: 0,
      createdBy: userId,
      idempotencyKey: dto.idempotencyKey || null,
    });
    return dataset;
  }

  @Get('datasets')
  async listDatasets(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.researchRepo.listDatasets(tenantId, { venue: query.venue, symbol: query.symbol, timeframe: query.timeframe, status: query.status, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('datasets/:datasetId')
  async getDataset(@Request() req: any, @Param('datasetId') datasetId: string) {
    const { tenantId } = this.getContext(req);
    const dataset = await this.researchRepo.findDatasetById(datasetId, tenantId);
    if (!dataset) throw new NotFoundException('Dataset not found');
    return dataset;
  }

  @Post('datasets/:datasetId/validate')
  async validateDataset(@Request() req: any, @Param('datasetId') datasetId: string) {
    const { tenantId, userId } = this.getContext(req);
    const dataset = await this.researchRepo.findDatasetById(datasetId, tenantId);
    if (!dataset) throw new NotFoundException('Dataset not found');

    // Try to get candles for validation
    try {
      const marketData = await this.marketDataService.getCandles({
        tenantId,
        venue: dataset.venue,
        symbol: dataset.symbol,
        timeframe: dataset.timeframe,
        startTime: new Date(dataset.startTime).toISOString(),
        endTime: new Date(dataset.endTime).toISOString(),
        source: dataset.source,
      });

      const validation = await this.datasetValidation.validateCandles({
        candles: marketData.candles,
        expectedSymbol: dataset.symbol,
        expectedVenue: dataset.venue,
        expectedTimeframe: dataset.timeframe,
      });

      const status = validation.isValid ? (validation.status === 'WARNING' ? 'VALID' : 'VALID') : 'INVALID';

      const updated = await this.researchRepo.updateDatasetStatus(datasetId, tenantId, status as any, validation as any);

      await this.researchRepo.createAuditLog({
        tenantId,
        event: validation.isValid ? 'DATASET_VALIDATED' : 'DATASET_REJECTED',
        actorId: userId,
        datasetId,
        result: validation.isValid ? 'SUCCESS' : 'FAILURE',
        safeMetadata: { qualityScore: validation.qualityScore, recordCount: validation.recordCount, issues: validation.issues.length },
      });

      return { dataset: updated, validation };
    } catch (e: any) {
      await this.researchRepo.updateDatasetStatus(datasetId, tenantId, 'INVALID' as any, { error: e.message });
      throw new BadRequestException(`Dataset validation failed: ${e.message}`);
    }
  }

  @Get('market-data/providers')
  async listProviders(@Request() req: any) {
    this.getContext(req);
    return this.providerFactory.listProviders();
  }

  @Get('market-data/candles')
  async getCandles(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    if (!query.venue || !query.symbol || !query.timeframe || !query.startTime || !query.endTime) throw new BadRequestException('venue, symbol, timeframe, startTime, endTime required');
    return this.marketDataService.getCandles({
      tenantId,
      venue: query.venue,
      symbol: query.symbol,
      timeframe: query.timeframe,
      startTime: query.startTime,
      endTime: query.endTime,
      source: query.source,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }

  // Strategy Versions
  @Post('strategy-versions')
  async createStrategyVersion(@Request() req: any, @Body() dto: CreateStrategyVersionDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.strategyVersionService.createDraftVersion({
      tenantId,
      strategyId: dto.strategyId || null,
      traderStrategyId: dto.traderStrategyId || null,
      definitionId: dto.definitionId || null,
      version: dto.version,
      name: dto.name,
      description: dto.description || null,
      parameters: dto.parameters,
      riskProfile: dto.riskProfile,
      executionModel: dto.executionModel,
      logic: dto.logic,
      parentVersionId: dto.parentVersionId || null,
      changeNote: dto.changeNote || null,
      createdBy: userId,
      idempotencyKey: dto.idempotencyKey || null,
    });
  }

  @Get('strategy-versions')
  async listStrategyVersions(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.strategyVersionService.listVersions(tenantId, { strategyId: query.strategyId, status: query.status, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('strategy-versions/:versionId')
  async getStrategyVersion(@Request() req: any, @Param('versionId') versionId: string) {
    const { tenantId } = this.getContext(req);
    const version = await this.strategyVersionService.getVersion(tenantId, versionId);
    if (!version) throw new NotFoundException('Strategy version not found');
    return version;
  }

  @Put('strategy-versions/:versionId')
  async updateStrategyVersion(@Request() req: any, @Param('versionId') versionId: string, @Body() body: any) {
    const { tenantId, userId } = this.getContext(req);
    const updated = await this.strategyVersionService.updateDraft(tenantId, versionId, userId, body);
    if (!updated) throw new NotFoundException('Strategy version not found');
    return updated;
  }

  @Post('strategy-versions/:versionId/validate')
  async validateStrategyVersion(@Request() req: any, @Param('versionId') versionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const validated = await this.strategyVersionService.validateVersion(tenantId, versionId, userId);
    if (!validated) throw new NotFoundException('Strategy version not found');
    return validated;
  }

  @Post('strategy-versions/:versionId/freeze')
  async freezeStrategyVersion(@Request() req: any, @Param('versionId') versionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const frozen = await this.strategyVersionService.freezeVersion(tenantId, versionId, userId);
    if (!frozen) throw new NotFoundException('Strategy version not found');
    return frozen;
  }

  @Post('strategy-versions/:versionId/publish')
  async publishStrategyVersion(@Request() req: any, @Param('versionId') versionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const published = await this.strategyVersionService.publishVersion(tenantId, versionId, userId);
    if (!published) throw new NotFoundException('Strategy version not found');
    return published;
  }

  @Post('strategy-versions/:versionId/deprecate')
  async deprecateStrategyVersion(@Request() req: any, @Param('versionId') versionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const deprecated = await this.strategyVersionService.deprecateVersion(tenantId, versionId, userId);
    if (!deprecated) throw new NotFoundException('Strategy version not found');
    return deprecated;
  }

  @Get('strategy-versions/:versionId/compare/:otherVersionId')
  async compareVersions(@Request() req: any, @Param('versionId') versionId: string, @Param('otherVersionId') otherVersionId: string) {
    const { tenantId } = this.getContext(req);
    return this.strategyVersionService.compareVersions(tenantId, versionId, otherVersionId);
  }

  // Backtests
  @Post('backtests')
  async createBacktest(@Request() req: any, @Body() dto: CreateBacktestDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.backtestEngine.runBacktest({
      tenantId,
      strategyVersionId: dto.strategyVersionId,
      symbols: dto.symbols,
      timeframe: dto.timeframe,
      startTime: dto.startTime,
      endTime: dto.endTime,
      initialCapital: dto.initialCapital,
      quoteCurrency: dto.quoteCurrency,
      feeAssumption: dto.feeAssumption,
      slippageAssumption: dto.slippageAssumption,
      latencyAssumption: dto.latencyAssumption,
      leverage: dto.leverage || null,
      benchmark: dto.benchmark || null,
      executionModel: dto.executionModel,
      datasetId: dto.datasetId || null,
      datasetFingerprint: dto.datasetFingerprint || null,
      createdBy: userId,
      idempotencyKey: dto.idempotencyKey || null,
    });
  }

  @Get('backtests')
  async listBacktests(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.backtestEngine.listRuns(tenantId, { strategyVersionId: query.strategyVersionId, status: query.status, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('backtests/:runId')
  async getBacktest(@Request() req: any, @Param('runId') runId: string) {
    const { tenantId } = this.getContext(req);
    const run = await this.backtestEngine.getRun(tenantId, runId);
    if (!run) throw new NotFoundException('Backtest run not found');
    return run;
  }

  @Get('backtests/:runId/trades')
  async listBacktestTrades(@Request() req: any, @Param('runId') runId: string, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    const run = await this.backtestEngine.getRun(tenantId, runId);
    if (!run) throw new NotFoundException('Backtest run not found');
    return this.backtestRepo.listTrades(tenantId, runId, { page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 100 });
  }

  @Get('backtests/:runId/equity-curve')
  async getBacktestEquityCurve(@Request() req: any, @Param('runId') runId: string) {
    const { tenantId } = this.getContext(req);
    const run = await this.backtestEngine.getRun(tenantId, runId);
    if (!run) throw new NotFoundException('Backtest run not found');
    const snapshots = await this.backtestRepo.listSnapshots(tenantId, runId);
    return { equityCurve: run.equityCurve || snapshots, metrics: run.metrics, resultSummary: run.resultSummary, isSimulated: true, disclaimer: 'Simulated result. Backtest performance is not indicative of future performance.' };
  }

  @Get('backtests/:runId/metrics')
  async getBacktestMetrics(@Request() req: any, @Param('runId') runId: string) {
    const { tenantId } = this.getContext(req);
    const run = await this.backtestEngine.getRun(tenantId, runId);
    if (!run) throw new NotFoundException('Backtest run not found');
    return { metrics: run.metrics, resultSummary: run.resultSummary, isSimulated: true };
  }

  @Post('backtests/walk-forward')
  async runWalkForward(@Request() req: any, @Body() dto: WalkForwardDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.walkForwardService.runWalkForward({
      tenantId,
      strategyVersionId: dto.strategyVersionId,
      symbols: dto.symbols,
      timeframe: dto.timeframe,
      startTime: dto.startTime,
      endTime: dto.endTime,
      initialCapital: dto.initialCapital,
      trainingWindowDays: dto.trainingWindowDays,
      testingWindowDays: dto.testingWindowDays,
      validationWindowDays: dto.validationWindowDays,
      mode: dto.mode,
      stepDays: dto.stepDays,
      createdBy: userId,
      idempotencyKey: dto.idempotencyKey || null,
    });
  }

  @Post('backtests/monte-carlo')
  async runMonteCarlo(@Request() req: any, @Body() dto: MonteCarloDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.monteCarloService.runMonteCarlo({
      tenantId,
      backtestRunId: dto.backtestRunId,
      iterations: dto.iterations,
      method: dto.method,
      seed: dto.seed || null,
      createdBy: userId,
      idempotencyKey: dto.idempotencyKey || null,
    });
  }

  @Post('backtests/parameter-sweep')
  async runParameterSweep(@Request() req: any, @Body() dto: ParameterSweepDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.parameterSweepService.runParameterSweep({
      tenantId,
      strategyVersionId: dto.strategyVersionId,
      symbols: dto.symbols,
      timeframe: dto.timeframe,
      startTime: dto.startTime,
      endTime: dto.endTime,
      initialCapital: dto.initialCapital,
      paramRanges: dto.paramRanges,
      concurrency: dto.concurrency,
      createdBy: userId,
      idempotencyKey: dto.idempotencyKey || null,
    });
  }

  @Post('backtests/benchmark')
  async runBenchmark(@Request() req: any, @Body() dto: BenchmarkDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.benchmarkService.compareBenchmark({
      tenantId,
      backtestRunId: dto.backtestRunId,
      benchmarkSymbol: dto.benchmarkSymbol,
      benchmarkType: dto.benchmarkType as any,
      createdBy: userId,
    });
  }

  // Paper Trading
  @Post('paper-sessions')
  async createPaperSession(@Request() req: any, @Body() dto: CreatePaperSessionDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.paperTradingService.createSession({
      tenantId,
      strategyVersionId: dto.strategyVersionId,
      initialCapital: dto.initialCapital,
      symbols: dto.symbols,
      timeframe: dto.timeframe,
      config: dto.config,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: userId,
      idempotencyKey: dto.idempotencyKey || null,
    });
  }

  @Get('paper-sessions')
  async listPaperSessions(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.paperTradingService.listSessions(tenantId, { strategyVersionId: query.strategyVersionId, status: query.status, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('paper-sessions/:sessionId')
  async getPaperSession(@Request() req: any, @Param('sessionId') sessionId: string) {
    const { tenantId } = this.getContext(req);
    const session = await this.paperTradingService.getSession(tenantId, sessionId);
    if (!session) throw new NotFoundException('Paper session not found');
    return session;
  }

  @Post('paper-sessions/:sessionId/start')
  async startPaperSession(@Request() req: any, @Param('sessionId') sessionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const started = await this.paperTradingService.startSession(tenantId, sessionId, userId);
    if (!started) throw new NotFoundException('Paper session not found');
    return started;
  }

  @Post('paper-sessions/:sessionId/pause')
  async pausePaperSession(@Request() req: any, @Param('sessionId') sessionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const paused = await this.paperTradingService.pauseSession(tenantId, sessionId, userId);
    if (!paused) throw new NotFoundException('Paper session not found');
    return paused;
  }

  @Post('paper-sessions/:sessionId/resume')
  async resumePaperSession(@Request() req: any, @Param('sessionId') sessionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const resumed = await this.paperTradingService.resumeSession(tenantId, sessionId, userId);
    if (!resumed) throw new NotFoundException('Paper session not found');
    return resumed;
  }

  @Post('paper-sessions/:sessionId/stop')
  async stopPaperSession(@Request() req: any, @Param('sessionId') sessionId: string, @Body() body: { reason?: string }) {
    const { tenantId, userId } = this.getContext(req);
    const stopped = await this.paperTradingService.stopSession(tenantId, sessionId, userId, body.reason);
    if (!stopped) throw new NotFoundException('Paper session not found');
    return stopped;
  }

  @Get('paper-sessions/:sessionId/performance')
  async getPaperPerformance(@Request() req: any, @Param('sessionId') sessionId: string) {
    const { tenantId } = this.getContext(req);
    const perf = await this.paperPerformanceService.getPerformance(tenantId, sessionId);
    if (!perf) throw new NotFoundException('Paper session not found');
    return perf;
  }

  @Get('paper-sessions/:sessionId/equity-curve')
  async getPaperEquityCurve(@Request() req: any, @Param('sessionId') sessionId: string) {
    const { tenantId } = this.getContext(req);
    const session = await this.paperTradingService.getSession(tenantId, sessionId);
    if (!session) throw new NotFoundException('Paper session not found');
    return this.paperPerformanceService.getEquityCurve(tenantId, sessionId);
  }

  @Post('paper-sessions/:sessionId/orders')
  async createPaperOrder(@Request() req: any, @Param('sessionId') sessionId: string, @Body() dto: CreatePaperOrderDto) {
    const { tenantId } = this.getContext(req);
    return this.paperOrderService.createPaperOrder({
      tenantId,
      sessionId,
      symbol: dto.symbol,
      side: dto.side,
      type: dto.type,
      quantity: dto.quantity,
      price: dto.price || null,
      stopPrice: dto.stopPrice || null,
      idempotencyKey: dto.idempotencyKey || null,
    });
  }

  @Get('paper-sessions/:sessionId/orders')
  async listPaperOrders(@Request() req: any, @Param('sessionId') sessionId: string, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.paperOrderService.listOrders(tenantId, sessionId, { status: query.status, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Post('paper-sessions/:sessionId/orders/:orderId/fill')
  async simulatePaperFill(@Request() req: any, @Param('sessionId') sessionId: string, @Param('orderId') orderId: string, @Body() body: { marketPrice: string }) {
    const { tenantId } = this.getContext(req);
    if (!body.marketPrice) throw new BadRequestException('marketPrice required');
    return this.paperOrderService.simulateFill({ tenantId, sessionId, orderId, marketPrice: body.marketPrice });
  }

  @Post('paper-sessions/:sessionId/orders/:orderId/cancel')
  async cancelPaperOrder(@Request() req: any, @Param('sessionId') sessionId: string, @Param('orderId') orderId: string) {
    const { tenantId } = this.getContext(req);
    const cancelled = await this.paperOrderService.cancelOrder(tenantId, sessionId, orderId);
    if (!cancelled) throw new NotFoundException('Paper order not found');
    return cancelled;
  }

  // Signals
  @Post('signals')
  async createSignal(@Request() req: any, @Body() dto: CreateSignalDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.signalService.createSignal({
      tenantId,
      strategyVersionId: dto.strategyVersionId,
      symbol: dto.symbol,
      side: dto.side as any,
      strength: dto.strength || null,
      confidence: dto.confidence || null,
      price: dto.price || null,
      quantity: dto.quantity || null,
      timestamp: new Date(dto.timestamp),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      sourceEvent: dto.sourceEvent || null,
      metadata: dto.metadata || {},
      idempotencyKey: dto.idempotencyKey || null,
      createdBy: userId,
    });
  }

  @Get('signals')
  async listSignals(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.signalService.listByTenant(tenantId, { state: query.state, symbol: query.symbol, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('signals/:signalId')
  async getSignal(@Request() req: any, @Param('signalId') signalId: string) {
    const { tenantId } = this.getContext(req);
    const signal = await this.signalService.findById(tenantId, signalId);
    if (!signal) throw new NotFoundException('Signal not found');
    return signal;
  }

  @Post('signals/:signalId/validate')
  async validateSignal(@Request() req: any, @Param('signalId') signalId: string) {
    const { tenantId } = this.getContext(req);
    const validated = await this.signalService.validateSignal(tenantId, signalId);
    if (!validated) throw new NotFoundException('Signal not found');
    return validated;
  }

  @Post('signals/:signalId/filter')
  async filterSignal(@Request() req: any, @Param('signalId') signalId: string, @Body() body: { allowedSymbols?: string[]; blockedSymbols?: string[]; allowedSides?: string[]; cooldownMs?: number }) {
    const { tenantId } = this.getContext(req);
    return this.signalFilterService.filterSignal({ tenantId, signalId, allowedSymbols: body.allowedSymbols, blockedSymbols: body.blockedSymbols, allowedSides: body.allowedSides, cooldownMs: body.cooldownMs });
  }

  @Post('signals/:signalId/publish')
  async publishSignal(@Request() req: any, @Param('signalId') signalId: string) {
    const { tenantId, userId } = this.getContext(req);
    // First filter
    const filterResult = await this.signalFilterService.filterSignal({ tenantId, signalId });
    if (!filterResult.allowed) throw new BadRequestException(`Signal filtered: ${filterResult.reason} rule=${filterResult.ruleId}`);

    const published = await this.signalService.publishSignal(tenantId, signalId, userId);
    if (!published) throw new NotFoundException('Signal not found');
    return published;
  }

  // Promotions
  @Post('promotions')
  async createPromotion(@Request() req: any, @Body() dto: CreatePromotionDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.promotionService.createPromotionRequest({
      tenantId,
      strategyVersionId: dto.strategyVersionId,
      backtestRunId: dto.backtestRunId || null,
      paperSessionId: dto.paperSessionId || null,
      requestedBy: userId,
      idempotencyKey: dto.idempotencyKey || null,
    });
  }

  @Get('promotions')
  async listPromotions(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.promotionService.listPromotions(tenantId, { strategyVersionId: query.strategyVersionId, state: query.state, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('promotions/:promotionId')
  async getPromotion(@Request() req: any, @Param('promotionId') promotionId: string) {
    const { tenantId } = this.getContext(req);
    const promotion = await this.promotionService.getPromotion(tenantId, promotionId);
    if (!promotion) throw new NotFoundException('Promotion not found');
    return promotion;
  }

  @Post('promotions/:promotionId/request')
  async requestPromotion(@Request() req: any, @Param('promotionId') promotionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const requested = await this.promotionService.requestPromotion(tenantId, promotionId, userId);
    if (!requested) throw new NotFoundException('Promotion not found');
    return requested;
  }

  @Post('promotions/:promotionId/approve')
  async approvePromotion(@Request() req: any, @Param('promotionId') promotionId: string, @Body() dto: PromotionActionDto) {
    const { tenantId, userId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can approve promotion steps');
    const approved = await this.promotionService.approvePromotionStep(tenantId, promotionId, userId, dto.step as any);
    if (!approved) throw new NotFoundException('Promotion not found');
    return approved;
  }

  @Post('promotions/:promotionId/reject')
  async rejectPromotion(@Request() req: any, @Param('promotionId') promotionId: string, @Body() body: { reason: string }) {
    const { tenantId, userId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can reject promotions');
    if (!body.reason) throw new BadRequestException('reason required');
    const rejected = await this.promotionService.rejectPromotion(tenantId, promotionId, userId, body.reason);
    if (!rejected) throw new NotFoundException('Promotion not found');
    return rejected;
  }

  @Post('promotions/:promotionId/promote')
  async promoteToProduction(@Request() req: any, @Param('promotionId') promotionId: string) {
    const { tenantId, userId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can promote to production');
    const promoted = await this.promotionService.promoteToProduction(tenantId, promotionId, userId);
    if (!promoted) throw new NotFoundException('Promotion not found');
    return promoted;
  }
}
