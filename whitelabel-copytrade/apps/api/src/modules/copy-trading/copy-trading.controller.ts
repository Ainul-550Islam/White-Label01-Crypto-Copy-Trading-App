import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { TraderProfileService } from './trader-profile.service';
import { TraderStrategyService } from './trader-strategy.service';
import { FollowerSubscriptionService } from './follower-subscription.service';
import { CopyExecutionService } from './copy-execution.service';
import { CopyPolicyService } from './copy-policy.service';
import { TraderPerformanceService } from './trader-performance.service';
import { TraderRankingService } from './trader-ranking.service';
import { CopyReconciliationService } from './copy-reconciliation.service';
import { CopySubscriptionRepository } from './copy-subscription.repository';
import { CopyExecutionRepository } from './copy-execution.repository';
import { CreateTraderProfileDto, UpdateTraderProfileDto, CreateTraderStrategyDto, UpdateTraderStrategyDto, TraderStrategyFilterDto } from './dto/trader-strategy.dto';
import { CreateFollowerSubscriptionDto, UpdateFollowerSubscriptionDto, FollowerSubscriptionFilterDto, CopyExecutionFilterDto } from './dto/follower-subscription.dto';
import { CreateCopyPolicyDto, LeaderEventDto } from './dto/copy-policy.dto';
import { TraderVerificationState } from './copy-trading.types';

/**
 * Tenant-protected endpoints for trader/follower/platform capabilities.
 * Marketplace listing, trader profile management, strategy publishing, subscription lifecycle, execution inspection, policy resolution, ranking, performance, and reconciliation.
 */
@Controller('copy-trading')
export class CopyTradingController {
  constructor(
    private readonly traderProfileService: TraderProfileService,
    private readonly traderStrategyService: TraderStrategyService,
    private readonly followerSubscriptionService: FollowerSubscriptionService,
    private readonly copyExecutionService: CopyExecutionService,
    private readonly copyPolicyService: CopyPolicyService,
    private readonly traderPerformanceService: TraderPerformanceService,
    private readonly traderRankingService: TraderRankingService,
    private readonly reconciliationService: CopyReconciliationService,
    private readonly subscriptionRepo: CopySubscriptionRepository,
    private readonly executionRepo: CopyExecutionRepository,
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
    return roles.includes('admin') || roles.includes('tenant_admin') || roles.includes('platform_admin');
  }

  // Trader Profile
  @Post('traders/profile')
  async createTraderProfile(@Request() req: any, @Body() dto: CreateTraderProfileDto) {
    const { tenantId, userId } = this.getContext(req);
    // Prevent client-provided verified status/performance
    const safeDto = { ...dto };
    // Do not allow client to set verificationState, followerCount, etc.
    return this.traderProfileService.createProfile({ tenantId, userId, displayName: safeDto.displayName, bio: safeDto.bio || null, avatarUrl: safeDto.avatarUrl || null, supportedVenues: safeDto.supportedVenues, supportedSymbols: safeDto.supportedSymbols, riskProfile: safeDto.riskProfile, isPublic: safeDto.isPublic });
  }

  @Get('traders/profile/me')
  async getMyProfile(@Request() req: any) {
    const { tenantId, userId } = this.getContext(req);
    const profile = await this.traderProfileService.getProfileByUserId(tenantId, userId);
    if (!profile) throw new NotFoundException('Trader profile not found');
    return profile;
  }

  @Get('traders/:traderId/profile')
  async getTraderProfile(@Request() req: any, @Param('traderId') traderId: string) {
    const { tenantId } = this.getContext(req);
    const profile = await this.traderProfileService.getProfile(tenantId, traderId);
    if (!profile) throw new NotFoundException('Trader profile not found');
    // Safe public stats - no fake profit/ROI
    return profile;
  }

  @Put('traders/:traderId/profile')
  async updateTraderProfile(@Request() req: any, @Param('traderId') traderId: string, @Body() dto: UpdateTraderProfileDto) {
    const { tenantId, userId } = this.getContext(req);
    const existing = await this.traderProfileService.getProfile(tenantId, traderId);
    if (!existing) throw new NotFoundException('Trader profile not found');
    if (existing.userId !== userId && !this.isAdmin(req.user?.roles || [])) throw new ForbiddenException('Not authorized');
    return this.traderProfileService.updateProfile(tenantId, traderId, dto);
  }

  @Get('traders')
  async listTraders(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    const filters = { verificationState: query.verificationState as TraderVerificationState, isFeatured: query.isFeatured ? query.isFeatured === 'true' : undefined, search: query.search, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 };
    return this.traderProfileService.listPublicProfiles(tenantId, filters);
  }

  @Post('traders/:traderId/verify')
  async verifyTrader(@Request() req: any, @Param('traderId') traderId: string) {
    const { tenantId, userId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can verify traders');
    const profile = await this.traderProfileService.verifyTrader(tenantId, traderId, userId);
    if (!profile) throw new NotFoundException('Trader not found');
    return profile;
  }

  // Trader Strategy
  @Post('strategies')
  async createStrategy(@Request() req: any, @Body() dto: CreateTraderStrategyDto) {
    const { tenantId, userId } = this.getContext(req);
    // Prevent client-provided verified status/performance/execution result
    return this.traderStrategyService.createStrategy({ tenantId, traderId: dto.traderId, userId, name: dto.name, description: dto.description || null, type: dto.type, supportedSymbols: dto.supportedSymbols, supportedVenues: dto.supportedVenues, riskProfile: dto.riskProfile, feePolicy: dto.feePolicy, strategyConfig: dto.strategyConfig, idempotencyKey: dto.idempotencyKey || null });
  }

  @Get('strategies/:strategyId')
  async getStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId } = this.getContext(req);
    const strategy = await this.traderStrategyService.getStrategy(tenantId, strategyId);
    if (!strategy) throw new NotFoundException('Strategy not found');
    return strategy;
  }

  @Get('strategies')
  async listStrategies(@Request() req: any, @Query() query: TraderStrategyFilterDto) {
    const { tenantId } = this.getContext(req);
    return this.traderStrategyService.listByTenant(tenantId, { status: query.status as any, traderId: query.traderId, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('traders/:traderId/strategies')
  async listTraderStrategies(@Request() req: any, @Param('traderId') traderId: string, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.traderStrategyService.listByTrader(tenantId, traderId, { status: query.status, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Put('strategies/:strategyId')
  async updateStrategy(@Request() req: any, @Param('strategyId') strategyId: string, @Body() dto: UpdateTraderStrategyDto) {
    const { tenantId, userId } = this.getContext(req);
    const updated = await this.traderStrategyService.updateStrategy(tenantId, strategyId, userId, dto);
    if (!updated) throw new NotFoundException('Strategy not found');
    return updated;
  }

  @Post('strategies/:strategyId/publish')
  async publishStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId } = this.getContext(req);
    return this.traderStrategyService.publishStrategy(tenantId, strategyId, userId, userId);
  }

  @Post('strategies/:strategyId/pause')
  async pauseStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId } = this.getContext(req);
    const paused = await this.traderStrategyService.pauseStrategy(tenantId, strategyId, userId, userId);
    if (!paused) throw new NotFoundException('Strategy not found');
    return paused;
  }

  @Post('strategies/:strategyId/resume')
  async resumeStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId } = this.getContext(req);
    const resumed = await this.traderStrategyService.resumeStrategy(tenantId, strategyId, userId, userId);
    if (!resumed) throw new NotFoundException('Strategy not found');
    return resumed;
  }

  @Post('strategies/:strategyId/archive')
  async archiveStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId } = this.getContext(req);
    const archived = await this.traderStrategyService.archiveStrategy(tenantId, strategyId, userId, userId);
    if (!archived) throw new NotFoundException('Strategy not found');
    return archived;
  }

  // Follower Subscription
  @Post('subscriptions')
  async createSubscription(@Request() req: any, @Body() dto: CreateFollowerSubscriptionDto) {
    const { tenantId, userId } = this.getContext(req);
    // Prevent client-provided execution result
    return this.followerSubscriptionService.subscribe({ tenantId, followerId: userId, traderId: dto.traderId, strategyId: dto.strategyId, allocationMode: dto.allocationMode, allocationAmount: dto.allocationAmount, maxAllocation: dto.maxAllocation || null, minAllocation: dto.minAllocation || null, copyPolicy: dto.copyPolicy, riskPolicy: dto.riskPolicy, followerAccountId: dto.followerAccountId || null, idempotencyKey: dto.idempotencyKey || null, actorId: userId, requestId: req.headers['x-request-id'] });
  }

  @Get('subscriptions/me')
  async listMySubscriptions(@Request() req: any, @Query() query: FollowerSubscriptionFilterDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.subscriptionRepo.listByFollower(tenantId, userId, { state: query.state as any, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('subscriptions/:subscriptionId')
  async getSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId, roles } = this.getContext(req);
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.followerId !== userId && sub.traderId !== userId && !this.isAdmin(roles)) {
      // Check if trader profile belongs to user
      const traderProfile = await this.traderProfileService.getProfile(tenantId, sub.traderId);
      if (!traderProfile || traderProfile.userId !== userId) throw new ForbiddenException('Not authorized');
    }
    return sub;
  }

  @Get('traders/:traderId/subscriptions')
  async listTraderSubscriptions(@Request() req: any, @Param('traderId') traderId: string, @Query() query: any) {
    const { tenantId, userId, roles } = this.getContext(req);
    const profile = await this.traderProfileService.getProfile(tenantId, traderId);
    if (!profile) throw new NotFoundException('Trader not found');
    if (profile.userId !== userId && !this.isAdmin(roles)) throw new ForbiddenException('Not authorized to view trader subscriptions');
    return this.subscriptionRepo.listByTrader(tenantId, traderId, { state: query.state, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Post('subscriptions/:subscriptionId/pause')
  async pauseSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const paused = await this.followerSubscriptionService.pauseSubscription(tenantId, subscriptionId, userId, userId, req.headers['x-request-id']);
    if (!paused) throw new NotFoundException('Subscription not found');
    return paused;
  }

  @Post('subscriptions/:subscriptionId/resume')
  async resumeSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const resumed = await this.followerSubscriptionService.resumeSubscription(tenantId, subscriptionId, userId, userId, req.headers['x-request-id']);
    if (!resumed) throw new NotFoundException('Subscription not found');
    return resumed;
  }

  @Post('subscriptions/:subscriptionId/stop')
  async stopSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const stopped = await this.followerSubscriptionService.stopCopy(tenantId, subscriptionId, userId, userId, req.headers['x-request-id']);
    if (!stopped) throw new NotFoundException('Subscription not found');
    return stopped;
  }

  @Delete('subscriptions/:subscriptionId')
  async cancelSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const cancelled = await this.followerSubscriptionService.cancelSubscription(tenantId, subscriptionId, userId, userId, req.headers['x-request-id']);
    if (!cancelled) throw new NotFoundException('Subscription not found');
    return cancelled;
  }

  // Copy Execution
  @Post('executions/leader-event')
  async processLeaderEvent(@Request() req: any, @Body() dto: LeaderEventDto & { traderId: string; strategyId: string }) {
    const { tenantId, userId, roles } = this.getContext(req);
    // Only trader or system can submit leader events
    const strategy = await this.traderStrategyService.getStrategy(tenantId, dto.strategyId);
    if (!strategy) throw new NotFoundException('Strategy not found');
    if (strategy.userId !== userId && !this.isAdmin(roles)) throw new ForbiddenException('Only strategy owner can submit leader events');

    const leaderEvent = {
      eventId: dto.eventId,
      orderId: dto.orderId || null,
      fillId: dto.fillId || null,
      symbol: dto.symbol,
      exchangeSymbol: dto.exchangeSymbol,
      side: dto.side,
      type: dto.type,
      quantity: dto.quantity,
      price: dto.price || null,
      stopPrice: dto.stopPrice || null,
      venue: dto.venue,
      timestamp: dto.timestamp,
      isSimulated: dto.isSimulated || false,
    };

    return this.copyExecutionService.processLeaderEvent({ tenantId, leaderEvent, traderId: dto.traderId, strategyId: dto.strategyId, actorId: userId });
  }

  @Get('executions/:executionId')
  async getExecution(@Request() req: any, @Param('executionId') executionId: string) {
    const { tenantId, userId, roles } = this.getContext(req);
    const exec = await this.executionRepo.findById(executionId, tenantId);
    if (!exec) throw new NotFoundException('Execution not found');
    if (exec.followerId !== userId && exec.traderId !== userId && !this.isAdmin(roles)) {
      const traderProfile = await this.traderProfileService.getProfile(tenantId, exec.traderId);
      if (!traderProfile || traderProfile.userId !== userId) throw new ForbiddenException('Not authorized');
    }
    return exec;
  }

  @Get('executions')
  async listExecutions(@Request() req: any, @Query() query: CopyExecutionFilterDto) {
    const { tenantId, userId } = this.getContext(req);
    // For follower, list own executions
    return this.executionRepo.listByFollower(tenantId, userId, { status: query.status as any, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Get('subscriptions/:subscriptionId/executions')
  async listSubscriptionExecutions(@Request() req: any, @Param('subscriptionId') subscriptionId: string, @Query() query: any) {
    const { tenantId, userId, roles } = this.getContext(req);
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.followerId !== userId && sub.traderId !== userId && !this.isAdmin(roles)) {
      const traderProfile = await this.traderProfileService.getProfile(tenantId, sub.traderId);
      if (!traderProfile || traderProfile.userId !== userId) throw new ForbiddenException('Not authorized');
    }
    return this.executionRepo.listBySubscription(tenantId, subscriptionId, { status: query.status, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  // Policy
  @Get('policies/effective')
  async getEffectivePolicy(@Request() req: any, @Query() query: { strategyId?: string; subscriptionId?: string }) {
    const { tenantId } = this.getContext(req);
    return this.copyPolicyService.resolveEffectivePolicy({ tenantId, strategyId: query.strategyId, subscriptionId: query.subscriptionId });
  }

  @Get('policies/platform')
  async getPlatformPolicy(@Request() req: any) {
    this.getContext(req);
    return this.copyPolicyService.getPlatformPolicy();
  }

  // Performance & Ranking
  @Get('traders/:traderId/performance')
  async getTraderPerformance(@Request() req: any, @Param('traderId') traderId: string) {
    const { tenantId } = this.getContext(req);
    const perf = await this.traderPerformanceService.getPerformance(tenantId, traderId);
    if (!perf) throw new NotFoundException('Trader not found');
    return perf;
  }

  @Get('rankings')
  async getRankings(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.traderRankingService.getRanking(tenantId, { verificationState: query.verificationState, isFeatured: query.isFeatured ? query.isFeatured === 'true' : undefined, search: query.search, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20, sortBy: query.sortBy });
  }

  @Get('rankings/featured')
  async getFeatured(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.traderRankingService.getFeaturedTraders(tenantId, query.limit ? parseInt(query.limit) : 10);
  }

  // Reconciliation
  @Post('reconciliation/run')
  async runReconciliation(@Request() req: any, @Body() body: { strategyId?: string; from?: string; to?: string; limit?: number }) {
    const { tenantId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can run reconciliation');
    return this.reconciliationService.reconcileTenant(tenantId, { strategyId: body.strategyId, from: body.from ? new Date(body.from) : undefined, to: body.to ? new Date(body.to) : undefined, limit: body.limit });
  }

  @Get('reconciliation/records')
  async listReconciliationRecords(@Request() req: any, @Query() query: any) {
    const { tenantId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can view reconciliation');
    return this.reconciliationService.listRecords(tenantId, { resolved: query.resolved !== undefined ? query.resolved === 'true' : undefined, category: query.category, severity: query.severity, page: query.page ? parseInt(query.page) : 1, limit: query.limit ? parseInt(query.limit) : 20 });
  }

  @Post('reconciliation/:recordId/resolve')
  async resolveReconciliation(@Request() req: any, @Param('recordId') recordId: string, @Body() body: { notes?: string }) {
    const { tenantId, userId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can resolve reconciliation');
    const resolved = await this.reconciliationService.resolveRecord(tenantId, recordId, userId, body.notes);
    if (!resolved) throw new NotFoundException('Record not found');
    return resolved;
  }
}
