import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { TraderProfileService } from './trader-profile.service';
import { TraderStrategyService } from './trader-strategy.service';
import { FollowerSubscriptionService } from './follower-subscription.service';
import { CopyExecutionService } from './copy-execution.service';
import { CopyPolicyService } from './copy-policy.service';
import {
  toTraderProfileListingView,
  toTraderProfilePublicView,
} from './trader-profile.public-view';
import { TraderPerformanceService } from './trader-performance.service';
import { TraderRankingService } from './trader-ranking.service';
import { CopyReconciliationService } from './copy-reconciliation.service';
import { CopySubscriptionRepository } from './copy-subscription.repository';
import { CopyExecutionRepository } from './copy-execution.repository';
import { CreateTraderProfileDto, UpdateTraderProfileDto, CreateTraderStrategyDto, UpdateTraderStrategyDto, TraderStrategyFilterDto } from './dto/trader-strategy.dto';
import { CreateFollowerSubscriptionDto, UpdateFollowerSubscriptionDto, FollowerSubscriptionFilterDto, CopyExecutionFilterDto } from './dto/follower-subscription.dto';
import { CreateCopyPolicyDto, LeaderEventDto } from './dto/copy-policy.dto';
import { TraderStrategy, TraderStrategyStatus, TraderVerificationState } from './copy-trading.types';
import { Permission } from '@wlct/shared-types';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';

/** Strategy states a non-owner may see: live, or paused with existing followers. */
const PUBLIC_STRATEGY_STATUSES: TraderStrategyStatus[] = [TraderStrategyStatus.PUBLISHED, TraderStrategyStatus.PAUSED];
import { authRoles, authTenantId, authUserIdOrNull, hasAdminRole } from '../../common/guards/request-principal';
import { limitParam, pageParam } from '../../common/dto/pagination-params';

/**
 * Tenant-protected endpoints for trader/follower/platform capabilities.
 * Marketplace listing, trader profile management, strategy publishing, subscription lifecycle, execution inspection, policy resolution, ranking, performance, and reconciliation.
 */
/**
 * Copy trading. Every route carries explicit permission metadata (it used to
 * carry none, so any authenticated tenant user passed the global guard):
 * - strategy:read            catalogue (traders, strategies, rankings, policies)
 * - strategy:manage          trader side (profiles, strategies, leader events)
 * - copy_subscription:read   own subscriptions and executions
 * - copy_subscription:manage subscribe / pause / resume / stop / cancel
 * The handlers keep their ownership checks on top of that. Non-owners see only
 * published/paused strategies and never a trader's strategyConfig.
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
    // Token tenant only; a header can never select the tenant.
    const tenantId = authTenantId(req);
    const userId = authUserIdOrNull(req);
    const roles = authRoles(req);
    if (!userId) throw new BadRequestException('userId required');
    return { tenantId, userId, roles };
  }

  private isAdmin(roles: string[]): boolean {
    return hasAdminRole(roles);
  }

  /** Owner or tenant admin sees drafts and the private strategy configuration. */
  private canSeePrivateStrategy(strategy: TraderStrategy, userId: string, roles: string[]): boolean {
    return strategy.userId === userId || this.isAdmin(roles);
  }

  /** Catalogue view for everyone else: never the trader's strategyConfig. */
  private toPublicStrategy(strategy: TraderStrategy): Omit<TraderStrategy, 'strategyConfig'> {
    const visible: Partial<TraderStrategy> = { ...strategy };
    delete visible.strategyConfig;
    return visible as Omit<TraderStrategy, 'strategyConfig'>;
  }

  /** A non-public trader profile exists only for its owner and tenant admins. */
  private async assertTraderVisible(tenantId: string, traderId: string, userId: string, roles: string[]) {
    const profile = await this.traderProfileService.getProfile(tenantId, traderId);
    if (!profile || (!profile.isPublic && profile.userId !== userId && !this.isAdmin(roles))) {
      throw new NotFoundException('Trader profile not found');
    }
    return profile;
  }

  // Trader Profile
  @Post('traders/profile')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async createTraderProfile(@Request() req: any, @Body() dto: CreateTraderProfileDto) {
    const { tenantId, userId } = this.getContext(req);
    // Prevent client-provided verified status/performance
    const safeDto = { ...dto };
    // Do not allow client to set verificationState, followerCount, etc.
    return this.traderProfileService.createProfile({ tenantId, userId, displayName: safeDto.displayName, bio: safeDto.bio || null, avatarUrl: safeDto.avatarUrl || null, supportedVenues: safeDto.supportedVenues, supportedSymbols: safeDto.supportedSymbols, riskProfile: safeDto.riskProfile, isPublic: safeDto.isPublic });
  }

  @Get('traders/profile/me')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getMyProfile(@Request() req: any) {
    const { tenantId, userId } = this.getContext(req);
    const profile = await this.traderProfileService.getProfileByUserId(tenantId, userId);
    if (!profile) throw new NotFoundException('Trader profile not found');
    return profile;
  }

  @Get('traders/:traderId/profile')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getTraderProfile(@Request() req: any, @Param('traderId') traderId: string) {
    const { tenantId, userId, roles } = this.getContext(req);
    const profile = await this.assertTraderVisible(tenantId, traderId, userId, roles);

    // The visibility check above proves the caller may see this profile; this projection decides
    // what they may see of it. Returning the record itself would publish the owner's user id, the
    // tenant id and the platform's internal risk assessment to every tenant member who opened the
    // page, and `viewerIsOwner` is derived from the token rather than from any request field.
    const metrics = await this.traderProfileService.getSafePublicStatistics(tenantId, traderId);
    return toTraderProfilePublicView({ profile, viewerUserId: userId, metrics });
  }

  @Put('traders/:traderId/profile')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async updateTraderProfile(@Request() req: any, @Param('traderId') traderId: string, @Body() dto: UpdateTraderProfileDto) {
    const { tenantId, userId } = this.getContext(req);
    const existing = await this.traderProfileService.getProfile(tenantId, traderId);
    if (!existing) throw new NotFoundException('Trader profile not found');
    if (existing.userId !== userId && !this.isAdmin(req.user?.roles || [])) throw new ForbiddenException('Not authorized');
    return this.traderProfileService.updateProfile(tenantId, traderId, dto);
  }

  @Get('traders')
  @RequirePermissions(Permission.STRATEGY_READ)
  async listTraders(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    const filters = { verificationState: query.verificationState as TraderVerificationState, isFeatured: query.isFeatured ? query.isFeatured === 'true' : undefined, search: query.search, page: pageParam(query.page), limit: limitParam(query.limit, 20) };
    const { data, total } = await this.traderProfileService.listPublicProfiles(tenantId, filters);
    // Projected per entry: a public listing is read by anyone in the tenant, so each row is reduced
    // to the public shape rather than serialized as stored. Metrics are not fetched here - a list
    // view that resolved statistics per row would be one query per trader on a paged route.
    return { data: data.map((profile) => toTraderProfileListingView(profile)), total };
  }

  @Post('traders/:traderId/verify')
  @RequireAnyPermission(Permission.TENANT_UPDATE, Permission.PLATFORM_MANAGE)
  async verifyTrader(@Request() req: any, @Param('traderId') traderId: string) {
    const { tenantId, userId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can verify traders');
    const profile = await this.traderProfileService.verifyTrader(tenantId, traderId, userId);
    if (!profile) throw new NotFoundException('Trader not found');
    return profile;
  }

  // Trader Strategy
  @Post('strategies')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async createStrategy(@Request() req: any, @Body() dto: CreateTraderStrategyDto) {
    const { tenantId, userId } = this.getContext(req);
    // Prevent client-provided verified status/performance/execution result
    return this.traderStrategyService.createStrategy({ tenantId, traderId: dto.traderId, userId, name: dto.name, description: dto.description || null, type: dto.type, supportedSymbols: dto.supportedSymbols, supportedVenues: dto.supportedVenues, riskProfile: dto.riskProfile, feePolicy: dto.feePolicy, strategyConfig: dto.strategyConfig, idempotencyKey: dto.idempotencyKey || null });
  }

  @Get('strategies/:strategyId')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId, roles } = this.getContext(req);
    const strategy = await this.traderStrategyService.getStrategy(tenantId, strategyId);
    if (!strategy) throw new NotFoundException('Strategy not found');
    if (this.canSeePrivateStrategy(strategy, userId, roles)) return strategy;
    if (!PUBLIC_STRATEGY_STATUSES.includes(strategy.status)) throw new NotFoundException('Strategy not found');
    return this.toPublicStrategy(strategy);
  }

  @Get('strategies')
  @RequirePermissions(Permission.STRATEGY_READ)
  async listStrategies(@Request() req: any, @Query() query: TraderStrategyFilterDto) {
    const { tenantId, roles } = this.getContext(req);
    const filters = { status: query.status as any, traderId: query.traderId, page: pageParam(query.page), limit: limitParam(query.limit, 20) };
    if (this.isAdmin(roles)) return this.traderStrategyService.listByTenant(tenantId, filters);
    const result = await this.traderStrategyService.listByTenant(tenantId, { ...filters, statuses: PUBLIC_STRATEGY_STATUSES });
    return { ...result, data: result.data.map((strategy) => this.toPublicStrategy(strategy)) };
  }

  @Get('traders/:traderId/strategies')
  @RequirePermissions(Permission.STRATEGY_READ)
  async listTraderStrategies(@Request() req: any, @Param('traderId') traderId: string, @Query() query: any) {
    const { tenantId, userId, roles } = this.getContext(req);
    const filters = { status: query.status, page: pageParam(query.page), limit: limitParam(query.limit, 20) };
    const profile = await this.traderProfileService.getProfile(tenantId, traderId);
    if (profile && (profile.userId === userId || this.isAdmin(roles))) return this.traderStrategyService.listByTrader(tenantId, traderId, filters);
    const result = await this.traderStrategyService.listByTrader(tenantId, traderId, { ...filters, statuses: PUBLIC_STRATEGY_STATUSES });
    return { ...result, data: result.data.map((strategy) => this.toPublicStrategy(strategy)) };
  }

  @Put('strategies/:strategyId')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async updateStrategy(@Request() req: any, @Param('strategyId') strategyId: string, @Body() dto: UpdateTraderStrategyDto) {
    const { tenantId, userId } = this.getContext(req);
    const updated = await this.traderStrategyService.updateStrategy(tenantId, strategyId, userId, dto);
    if (!updated) throw new NotFoundException('Strategy not found');
    return updated;
  }

  @Post('strategies/:strategyId/publish')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async publishStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId } = this.getContext(req);
    return this.traderStrategyService.publishStrategy(tenantId, strategyId, userId, userId);
  }

  @Post('strategies/:strategyId/pause')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async pauseStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId } = this.getContext(req);
    const paused = await this.traderStrategyService.pauseStrategy(tenantId, strategyId, userId, userId);
    if (!paused) throw new NotFoundException('Strategy not found');
    return paused;
  }

  @Post('strategies/:strategyId/resume')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async resumeStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId } = this.getContext(req);
    const resumed = await this.traderStrategyService.resumeStrategy(tenantId, strategyId, userId, userId);
    if (!resumed) throw new NotFoundException('Strategy not found');
    return resumed;
  }

  @Post('strategies/:strategyId/archive')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async archiveStrategy(@Request() req: any, @Param('strategyId') strategyId: string) {
    const { tenantId, userId } = this.getContext(req);
    const archived = await this.traderStrategyService.archiveStrategy(tenantId, strategyId, userId, userId);
    if (!archived) throw new NotFoundException('Strategy not found');
    return archived;
  }

  // Follower Subscription
  @Post('subscriptions')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async createSubscription(@Request() req: any, @Body() dto: CreateFollowerSubscriptionDto) {
    const { tenantId, userId } = this.getContext(req);
    // Prevent client-provided execution result
    return this.followerSubscriptionService.subscribe({ tenantId, followerId: userId, traderId: dto.traderId, strategyId: dto.strategyId, allocationMode: dto.allocationMode, allocationAmount: dto.allocationAmount, maxAllocation: dto.maxAllocation || null, minAllocation: dto.minAllocation || null, copyPolicy: dto.copyPolicy, riskPolicy: dto.riskPolicy, followerAccountId: dto.followerAccountId || null, idempotencyKey: dto.idempotencyKey || null, actorId: userId, requestId: req.headers['x-request-id'] });
  }

  @Get('subscriptions/me')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  async listMySubscriptions(@Request() req: any, @Query() query: FollowerSubscriptionFilterDto) {
    const { tenantId, userId } = this.getContext(req);
    return this.subscriptionRepo.listByFollower(tenantId, userId, { state: query.state as any, page: pageParam(query.page), limit: limitParam(query.limit, 20) });
  }

  @Get('subscriptions/:subscriptionId')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
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

  @Put('subscriptions/:subscriptionId')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async updateSubscription(
    @Request() req: any,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: UpdateFollowerSubscriptionDto,
  ) {
    const { tenantId, userId, roles } = this.getContext(req);
    const requestId = req?.headers?.['x-request-id'] || req?.id;
    const updated = await this.followerSubscriptionService.updateSubscriptionSettings(
      tenantId,
      subscriptionId,
      dto,
      userId,
      this.isAdmin(roles) ? null : userId,
      requestId,
    );
    if (!updated) throw new NotFoundException('Subscription not found');
    return updated;
  }

  @Get('subscriptions/:subscriptionId/reconciliation-status')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  async getSubscriptionReconciliationStatus(
    @Request() req: any,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    const { tenantId, userId, roles } = this.getContext(req);
    const status = await this.reconciliationService.getCustomerSubscriptionStatus(
      tenantId,
      subscriptionId,
      this.isAdmin(roles) ? null : userId,
    );
    if (!status) throw new NotFoundException('Subscription not found');
    return status;
  }

  @Get('traders/:traderId/subscriptions')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  async listTraderSubscriptions(@Request() req: any, @Param('traderId') traderId: string, @Query() query: any) {
    const { tenantId, userId, roles } = this.getContext(req);
    const profile = await this.traderProfileService.getProfile(tenantId, traderId);
    if (!profile) throw new NotFoundException('Trader not found');
    if (profile.userId !== userId && !this.isAdmin(roles)) throw new ForbiddenException('Not authorized to view trader subscriptions');
    return this.subscriptionRepo.listByTrader(tenantId, traderId, { state: query.state, page: pageParam(query.page), limit: limitParam(query.limit, 20) });
  }

  @Post('subscriptions/:subscriptionId/pause')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async pauseSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const paused = await this.followerSubscriptionService.pauseSubscription(tenantId, subscriptionId, userId, userId, req.headers['x-request-id']);
    if (!paused) throw new NotFoundException('Subscription not found');
    return paused;
  }

  @Post('subscriptions/:subscriptionId/resume')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async resumeSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const resumed = await this.followerSubscriptionService.resumeSubscription(tenantId, subscriptionId, userId, userId, req.headers['x-request-id']);
    if (!resumed) throw new NotFoundException('Subscription not found');
    return resumed;
  }

  @Post('subscriptions/:subscriptionId/stop')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async stopSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const stopped = await this.followerSubscriptionService.stopCopy(tenantId, subscriptionId, userId, userId, req.headers['x-request-id']);
    if (!stopped) throw new NotFoundException('Subscription not found');
    return stopped;
  }

  @Delete('subscriptions/:subscriptionId')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async cancelSubscription(@Request() req: any, @Param('subscriptionId') subscriptionId: string) {
    const { tenantId, userId } = this.getContext(req);
    const cancelled = await this.followerSubscriptionService.cancelSubscription(tenantId, subscriptionId, userId, userId, req.headers['x-request-id']);
    if (!cancelled) throw new NotFoundException('Subscription not found');
    return cancelled;
  }

  // Copy Execution
  @Post('executions/leader-event')
  @RequirePermissions(Permission.STRATEGY_MANAGE)
  async processLeaderEvent(@Request() req: any, @Body() dto: LeaderEventDto & { traderId: string; strategyId: string }) {
    const { tenantId, userId, roles } = this.getContext(req);
    // Only trader or system can submit leader events
    const strategy = await this.traderStrategyService.getStrategy(tenantId, dto.strategyId);
    if (!strategy) throw new NotFoundException('Strategy not found');
    if (strategy.userId !== userId && !this.isAdmin(roles)) throw new ForbiddenException('Only strategy owner can submit leader events');
    // The trader is the strategy's trader, never a value from the body: a
    // mismatching traderId would attribute the event (and its compliance
    // check) to someone else.
    const traderId = strategy.traderId;
    if (!traderId) throw new NotFoundException('Strategy has no trader');
    if (dto.traderId && dto.traderId !== traderId) throw new BadRequestException('traderId does not match the strategy');

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

    return this.copyExecutionService.processLeaderEvent({ tenantId, leaderEvent, traderId, strategyId: dto.strategyId, actorId: userId });
  }

  @Get('executions/:executionId')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
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
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  async listExecutions(@Request() req: any, @Query() query: CopyExecutionFilterDto) {
    const { tenantId, userId } = this.getContext(req);
    // For follower, list own executions
    return this.executionRepo.listByFollower(tenantId, userId, { status: query.status as any, page: pageParam(query.page), limit: limitParam(query.limit, 20) });
  }

  @Get('subscriptions/:subscriptionId/executions')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  async listSubscriptionExecutions(@Request() req: any, @Param('subscriptionId') subscriptionId: string, @Query() query: any) {
    const { tenantId, userId, roles } = this.getContext(req);
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.followerId !== userId && sub.traderId !== userId && !this.isAdmin(roles)) {
      const traderProfile = await this.traderProfileService.getProfile(tenantId, sub.traderId);
      if (!traderProfile || traderProfile.userId !== userId) throw new ForbiddenException('Not authorized');
    }
    return this.executionRepo.listBySubscription(tenantId, subscriptionId, { status: query.status, page: pageParam(query.page), limit: limitParam(query.limit, 20) });
  }

  // Policy
  @Get('policies/effective')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getEffectivePolicy(@Request() req: any, @Query() query: { strategyId?: string; subscriptionId?: string }) {
    const { tenantId } = this.getContext(req);
    return this.copyPolicyService.resolveEffectivePolicy({ tenantId, strategyId: query.strategyId, subscriptionId: query.subscriptionId });
  }

  @Get('policies/platform')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getPlatformPolicy(@Request() req: any) {
    this.getContext(req);
    return this.copyPolicyService.getPlatformPolicy();
  }

  // Performance & Ranking
  @Get('traders/:traderId/performance')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getTraderPerformance(@Request() req: any, @Param('traderId') traderId: string) {
    const { tenantId, userId, roles } = this.getContext(req);
    await this.assertTraderVisible(tenantId, traderId, userId, roles);
    const perf = await this.traderPerformanceService.getPerformance(tenantId, traderId);
    if (!perf) throw new NotFoundException('Trader not found');
    return perf;
  }

  @Get('rankings')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getRankings(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    // `timeframe` is forwarded. The service accepted it, defaulted it, and reported it back in the
    // response's methodology - but the route never passed it on, so the ranking window was either
    // the default or whatever an unrecognised value happened to fall back to, and the response's
    // own `timeframe` field described a window the caller had not asked for.
    return this.traderRankingService.getRanking(tenantId, { verificationState: query.verificationState, isFeatured: query.isFeatured ? query.isFeatured === 'true' : undefined, search: query.search, page: pageParam(query.page), limit: limitParam(query.limit, 20), sortBy: query.sortBy, timeframe: query.timeframe });
  }

  @Get('rankings/featured')
  @RequirePermissions(Permission.STRATEGY_READ)
  async getFeatured(@Request() req: any, @Query() query: any) {
    const { tenantId } = this.getContext(req);
    return this.traderRankingService.getFeaturedTraders(tenantId, limitParam(query.limit, 10));
  }

  // Reconciliation
  @Post('reconciliation/run')
  @RequirePermissions(Permission.RECONCILIATION_TRIGGER)
  async runReconciliation(@Request() req: any, @Body() body: { strategyId?: string; from?: string; to?: string; limit?: number }) {
    const { tenantId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can run reconciliation');
    return this.reconciliationService.reconcileTenant(tenantId, { strategyId: body.strategyId, from: body.from ? new Date(body.from) : undefined, to: body.to ? new Date(body.to) : undefined, limit: body.limit });
  }

  @Get('reconciliation/records')
  @RequireAnyPermission(Permission.RECONCILIATION_TRIGGER, Permission.RECONCILIATION_RESOLVE)
  async listReconciliationRecords(@Request() req: any, @Query() query: any) {
    const { tenantId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can view reconciliation');
    return this.reconciliationService.listRecords(tenantId, { resolved: query.resolved !== undefined ? query.resolved === 'true' : undefined, category: query.category, severity: query.severity, page: pageParam(query.page), limit: limitParam(query.limit, 20) });
  }

  @Post('reconciliation/:recordId/resolve')
  @RequirePermissions(Permission.RECONCILIATION_RESOLVE)
  async resolveReconciliation(@Request() req: any, @Param('recordId') recordId: string, @Body() body: { notes?: string }) {
    const { tenantId, userId, roles } = this.getContext(req);
    if (!this.isAdmin(roles)) throw new ForbiddenException('Only admin can resolve reconciliation');
    const resolved = await this.reconciliationService.resolveRecord(tenantId, recordId, userId, body.notes);
    if (!resolved) throw new NotFoundException('Record not found');
    return resolved;
  }
}
