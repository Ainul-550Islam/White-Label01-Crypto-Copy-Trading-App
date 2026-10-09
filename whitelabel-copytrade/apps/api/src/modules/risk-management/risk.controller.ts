import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RiskDecisionService } from './risk-decision.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { PositionRiskService } from './position-risk.service';
import { MarginRiskService } from './margin-risk.service';
import { LeverageRiskService } from './leverage-risk.service';
import { LeveragePolicyService } from '../risk/leverage-policy.service';
import { LiquidationRiskService } from './liquidation-risk.service';
import { ConcentrationRiskService } from './concentration-risk.service';
import { DrawdownRiskService } from './drawdown-risk.service';
import { DailyLossLimitService } from './daily-loss-limit.service';
import { CorrelationRiskService } from './correlation-risk.service';
import { VarRiskService } from './var-risk.service';
import { StressTestService } from './stress-test.service';
import { RiskManagementSnapshotRepository } from './risk-snapshot.repository';
import { CircuitBreakerService } from './circuit-breaker.service';
import { KillSwitchOrchestratorService, KillSwitchRequestScope } from './kill-switch-orchestrator.service';
import { RiskReconciliationService } from './risk-reconciliation.service';
import { CustomerExposureService } from './customer-exposure.service';
import type { CustomerRiskAnalysisView } from './customer-risk-analysis.types';
import { RiskCheckDto } from './dto/risk-check.dto';
import { UpsertRiskPolicyDto, RiskPolicyScopeDto } from './dto/risk-policy.dto';
import { RiskPolicyScope, CircuitBreakerScope } from './risk-management.types';
import { authTenantId, authUserIdOrNull, principal } from '../../common/guards/request-principal';

/**
 * Institutional risk controller with RBAC:
 * - dashboard/pre-trade check/account/trader/strategy/follower risk/policy/breaker status/actions/kill-switch/reconciliation
 * - tenant risk admins own tenant, trader/follower own scope, platform risk admins PLATFORM_MANAGE, no cross-tenant
 * - No secrets in responses
 */

/**
 * Risk-management console (unified pre-trade check, exposure, margin, VaR,
 * policies, circuit breakers, kill switches, reconciliation).
 *
 * The controller carried no permission metadata, so any tenant user, a
 * follower included, could rewrite the tenant's risk policy or trigger and
 * clear circuit breakers and kill switches. Permissions now mirror the
 * decorated risk controller (/risk): reads risk:read, policy changes
 * risk:config:update (class default), trigger/request/acknowledge
 * risk:kill_switch_update, clear risk:protection_clear. The pre-trade check
 * needs execution:submit or risk:config:update.
 */
@RequirePermissions(Permission.RISK_CONFIG_UPDATE)
@Controller('risk-management')
export class RiskManagementController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decisionService: RiskDecisionService,
    private readonly policyService: InstitutionalRiskPolicyService,
    private readonly exposureService: PortfolioExposureService,
    private readonly positionService: PositionRiskService,
    private readonly marginService: MarginRiskService,
    private readonly leverageService: LeverageRiskService,
    private readonly leveragePolicyService: LeveragePolicyService,
    private readonly liquidationService: LiquidationRiskService,
    private readonly concentrationService: ConcentrationRiskService,
    private readonly drawdownService: DrawdownRiskService,
    private readonly dailyLossService: DailyLossLimitService,
    private readonly correlationService: CorrelationRiskService,
    private readonly varService: VarRiskService,
    private readonly stressService: StressTestService,
    private readonly snapshotRepo: RiskManagementSnapshotRepository,
    private readonly breakerService: CircuitBreakerService,
    private readonly killSwitchService: KillSwitchOrchestratorService,
    private readonly reconciliationService: RiskReconciliationService,
    // Customer-facing exposure: owner-scoped and non-sandbox-correct, unlike the institutional
    // PortfolioExposureService above, which answers for an operator-selected account. Both are
    // real routes; neither replaces the other.
    private readonly customerExposureService: CustomerExposureService,
  ) {}

  private getTenantId(req: any): string {
    // Token tenant only; a header can never select the tenant.
    return authTenantId(req);
  }

  private getUserId(req: any): string {
    return authUserIdOrNull(req) ?? 'system';
  }

  private checkTenantAccess(req: any, targetTenantId: string): void {
    const userTenantId = req.user?.tenantId;
    const isPlatform = req.user?.isPlatformUser || req.user?.roles?.includes('PLATFORM_ADMIN') || req.user?.permissions?.includes('PLATFORM_MANAGE');
    if (!isPlatform && userTenantId && userTenantId !== targetTenantId) {
      throw new ForbiddenException('Cross-tenant access denied');
    }
  }

  // ---------- Dashboard ----------

  @Get('dashboard')
  @RequirePermissions(Permission.RISK_READ)
  async getDashboard(@Req() req: any, @Query('accountId') accountId?: string, @Query('traderId') traderId?: string, @Query('strategyId') strategyId?: string, @Query('followerId') followerId?: string) {
    const tenantId = this.getTenantId(req);
    const exposure = await this.exposureService.calculateExposure({ tenantId, accountId, traderId, strategyId, followerId });
    const policy = await this.policyService.resolveEffectivePolicy({ tenantId, traderId: traderId ?? null, strategyId: strategyId ?? null, followerId: followerId ?? null });

    let margin = null;
    let leverage = null;
    let drawdown = null;
    let dailyLoss = null;
    if (accountId) {
      const margins = await this.marginService.evaluateMargin({ tenantId, accountId });
      margin = margins[0] ?? null;
      const levs = await this.leverageService.evaluateLeverage({ tenantId, accountId });
      leverage = levs[0] ?? null;
    }
    const drawdowns = await this.drawdownService.evaluateDrawdown({ tenantId, accountId, traderId, strategyId, followerId });
    drawdown = drawdowns[0] ?? null;
    const dailyLosses = await this.dailyLossService.evaluateDailyLoss({ tenantId, accountId, traderId, strategyId, followerId });
    dailyLoss = dailyLosses[0] ?? null;

    const concentrations = await this.concentrationService.evaluateConcentration({ tenantId, accountId, traderId, strategyId, followerId });
    const liquidations = await this.liquidationService.evaluateLiquidationRisk({ tenantId, accountId, traderId, strategyId, followerId });
    const vars = await this.varService.evaluateVar({ tenantId, accountId, traderId, strategyId, followerId });
    const stresses = await this.stressService.runStressTests({ tenantId, accountId, traderId, strategyId, followerId });
    const breakers = await this.breakerService.listBreakers({ tenantId });
    const killSwitches = await this.killSwitchService.inspectKillSwitch({ tenantId });

    const latestSnapshot = await this.snapshotRepo.getLatestSnapshot({ tenantId, accountId, traderId, followerId, strategyId });

    return {
      tenantId,
      asOf: new Date().toISOString(),
      policyVersion: policy.effectiveVersion,
      overallState: exposure.state,
      grossExposure: exposure.grossExposure,
      netExposure: exposure.netExposure,
      notionalUtilizationPercent: exposure.notionalUtilizationPercent,
      marginUtilizationPercent: margin?.marginUtilizationPercent ?? null,
      leverageGross: leverage?.grossLeverage ?? null,
      leverageNet: leverage?.netLeverage ?? null,
      drawdownPercent: drawdown?.drawdownPercent ?? null,
      drawdownAbs: drawdown?.drawdownAbs ?? null,
      dailyPnl: dailyLoss?.dailyPnl ?? null,
      dailyLossRemainingBudget: dailyLoss?.remainingBudget ?? null,
      concentration: concentrations.map((c) => ({ dimension: c.dimension, key: c.key, percent: c.currentPercent, threshold: c.thresholdPercent, isBreach: c.isBreach })),
      liquidationWarnings: liquidations.filter((l) => l.isWarning || l.isCritical).map((l) => ({ symbol: l.symbol ?? 'ACCOUNT', distancePercent: l.distancePercent, isCritical: l.isCritical, reason: l.reason })),
      varEstimate: vars[0] ? { value: vars[0].varValue, percent: vars[0].varPercent, confidence: vars[0].confidence, label: vars[0].label, isBreach: vars[0].isBreach } : null,
      stressSummary: stresses.map((s) => ({ scenarioId: s.scenario.scenarioId, type: s.scenario.type, pnlImpact: s.estimatedPnlImpact, riskLevel: s.riskLevel, isBreach: s.isBreach })),
      breakers: breakers.map((b: any) => ({ scope: b.scope, scopeId: b.scopeId, state: b.state, reason: b.reason })),
      killSwitch: killSwitches.length ? { isEngaged: killSwitches[0].isEngaged, scope: killSwitches[0].scope, reason: killSwitches[0].reason } : { isEngaged: false, scope: null, reason: null },
      freshness: {
        exposureAgeMs: exposure.sourceTimestamps ? Date.now() - new Date(exposure.sourceTimestamps.calculatedAt).getTime() : null,
        marginAgeMs: margin ? Date.now() - new Date(margin.sourceTimestamp ?? '').getTime() : null,
        marketDataStale: exposure.staleSymbols.length > 0,
        exchangeHealthStale: false,
      },
      warnings: exposure.warnings,
      timestamp: new Date().toISOString(),
      note: 'VaR and stress tests are RISK_ESTIMATE control signals, not guaranteed future loss. Past performance is not indicative of future results.',
    };
  }

  // ---------- Pre-trade check ----------

  @Post('check')
  @RequireAnyPermission(Permission.EXECUTION_SUBMIT, Permission.RISK_CONFIG_UPDATE)
  async checkOrder(@Req() req: any, @Body() dto: RiskCheckDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    const userId = this.getUserId(req);

    // Validate decimal quantity
    if (!/^-?\d+(\.\d+)?$/.test(dto.quantity)) {
      throw new BadRequestException('Invalid quantity decimal string');
    }

    const decision = await this.decisionService.evaluateUnifiedRisk({
      tenantId,
      userId,
      accountId: dto.accountId,
      symbol: dto.symbol,
      traderId: dto.traderId ?? undefined,
      followerId: dto.followerId ?? undefined,
      strategyId: dto.strategyId ?? undefined,
      orderIntent: { side: dto.side as any, quantity: dto.quantity, price: dto.price ?? null, orderType: dto.orderType as any },
      environment: (dto.environment as any) ?? 'PAPER',
      requestId: dto.requestId ?? undefined,
    });

    return {
      decision: decision.decision,
      state: decision.state,
      blockingReasons: decision.blockingReasons,
      warnings: decision.warnings,
      ruleIds: decision.ruleIds,
      policyVersion: decision.policyVersion,
      timestamp: decision.timestamp,
      details: decision.details.map((d) => ({
        dimension: d.dimension,
        decision: d.decision,
        state: d.state,
        ruleId: d.ruleId,
        policyVersion: d.policyVersion,
        current: d.current,
        threshold: d.threshold,
        severity: d.severity,
        reason: d.reason,
      })),
    };
  }

  // ---------- Exposure ----------

  /**
   * Answers "may this account trade at this leverage?" against the two ceilings that actually
   * bind: the tenant's institutional policy and the venue's own capability for the account's
   * exchange. Both values are read from the same sources the risk evaluation uses, so a customer
   * asking before they trade gets the same answer the engine would give.
   *
   * `LeveragePolicyService` was written for exactly this and was injected nowhere - it had a spec
   * and no caller - so the effective ceiling existed as a rule with no surface. Every unknown
   * stays unknown: no account, no venue capability, or an unreadable policy is a refusal that
   * names the missing input, never a default allowance.
   */
  @Get('leverage-policy')
  @RequirePermissions(Permission.RISK_READ)
  async getLeveragePolicy(
    @Req() req: any,
    @Query('accountId') accountId?: string,
    @Query('requestedLeverage') requestedLeverage?: string,
    @Query('marginMode') marginMode?: string,
  ) {
    const tenantId = this.getTenantId(req);
    if (!accountId) throw new BadRequestException('accountId is required');
    const requested = Number(requestedLeverage);
    if (!Number.isInteger(requested) || requested < 1) {
      throw new BadRequestException('requestedLeverage is required and must be a positive integer');
    }
    const mode = marginMode === 'ISOLATED' ? 'ISOLATED' : 'CROSS';

    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, tenantId },
      include: { exchange: true },
    });
    if (!account) throw new NotFoundException(`account ${accountId} not found`);

    // The policy service resolves over tenant / trader / strategy / follower, not account: its
    // account-scoped ceiling is a threshold value (`maxLeverageAccount`), while the *account's own*
    // ceiling below comes from the account's venue capability. Passing an account id here was a
    // type error - the parameter does not exist.
    const policy = await this.policyService.resolveEffectivePolicy({ tenantId });
    const policyCeiling = policy.thresholds.maxLeverageAccount ?? policy.thresholds.maxLeverageGross ?? null;

    // A non-integer policy ceiling cannot be reported as a leverage limit. The service's contract
    // is integral leverage, so an unparseable ceiling is passed as the sentinel that makes it
    // refuse - the reason will name the policy, which is the truthful cause.
    const maximumAllowed = policyCeiling !== null && /^\d+$/.test(policyCeiling) ? Number(policyCeiling) : 0;
    const venueMaximum = account.exchange?.maxLeverage ?? null;

    const result = this.leveragePolicyService.evaluate({
      requestedLeverage: requested,
      maximumAllowed,
      venueMaximum: typeof venueMaximum === 'number' ? venueMaximum : null,
      marginMode: mode,
      accountCanTrade: account.canTrade === true,
    });

    return {
      ...result,
      accountId,
      policyCeiling,
      venueCeiling: venueMaximum === null || venueMaximum === undefined ? null : String(venueMaximum),
    };
  }

  @Get('exposure')
  @RequirePermissions(Permission.RISK_READ)
  async getExposure(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    return this.exposureService.calculateExposure({ tenantId, accountId });
  }

  @Get('exposure/:accountId')
  @RequirePermissions(Permission.RISK_READ)
  async getAccountExposure(@Req() req: any, @Param('accountId') accountId: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.exposureService.calculateExposure({ tenantId, accountId });
  }

  /**
   * The caller's own exposure across every account they own. Tenant and user come from the
   * verified token via `principal`, which refuses when either is absent - a query parameter can
   * never widen the scope to another tenant or user.
   */
  @Get('my-exposure')
  @RequireAnyPermission(Permission.RISK_READ, Permission.PORTFOLIO_READ)
  async getMyExposure(@Req() req: any) {
    const { tenantId, userId } = principal(req);
    return this.customerExposureService.calculateMyExposure({ tenantId, userId });
  }

  /**
   * The caller's own concentration and correlation in one response.
   *
   * The scope comes from `principal` alone, which throws when either the tenant or the user is
   * absent. The request object is accepted for the Express `query` bundle but is never read for
   * scope: a `tenantId`, `userId`, or `accountId` in the query string is ignored, so a caller cannot
   * redirect this route at another tenant's or another user's risk data by adding a parameter. The
   * two analyses are run against the same verified scope and returned together so a client cannot
   * pair one caller's concentration with another's correlation.
   */
  @Get('my-risk-analysis')
  @RequireAnyPermission(Permission.RISK_READ, Permission.PORTFOLIO_READ)
  async getMyRiskAnalysis(@Req() req: any): Promise<CustomerRiskAnalysisView> {
    const { tenantId, userId } = principal(req);
    const [concentration, correlation] = await Promise.all([
      this.concentrationService.evaluateMyConcentration({ tenantId, userId }),
      this.correlationService.evaluateMyCorrelation({ tenantId, userId }),
    ]);
    return {
      tenantId,
      requestedAt: new Date().toISOString(),
      dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
      concentration,
      correlation,
    };
  }

  /**
   * A trader profile's exposure, scoped to the profile owner's non-sandbox accounts. The trader is
   * bound to the route; tenant and user still come only from the token. A profile the caller cannot
   * be shown is a 404 rather than an empty result, so the route does not confirm that a private
   * profile exists.
   */
  @Get('trader-exposure/:traderId')
  @RequireAnyPermission(Permission.RISK_READ, Permission.PORTFOLIO_READ)
  async getTraderExposure(@Req() req: any, @Param('traderId') traderId: string) {
    const { tenantId, userId } = principal(req);
    const exposure = await this.customerExposureService.calculateTraderExposure({
      tenantId,
      traderId,
      userId,
    });
    if (!exposure) throw new NotFoundException('Trader exposure is not available.');
    return exposure;
  }

  // ---------- Position risk ----------

  @Get('position-risk')
  @RequirePermissions(Permission.RISK_READ)
  async getPositionRisk(@Req() req: any, @Query('accountId') accountId?: string, @Query('symbol') symbol?: string) {
    const tenantId = this.getTenantId(req);
    return this.positionService.evaluatePositionRisk({ tenantId, accountId, symbol });
  }

  // ---------- Margin ----------

  @Get('margin/:accountId')
  @RequirePermissions(Permission.RISK_READ)
  async getMargin(@Req() req: any, @Param('accountId') accountId: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.marginService.evaluateMargin({ tenantId, accountId });
  }

  // ---------- Leverage ----------

  @Get('leverage/:accountId')
  @RequirePermissions(Permission.RISK_READ)
  async getLeverage(@Req() req: any, @Param('accountId') accountId: string, @Query('symbol') symbol?: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.leverageService.evaluateLeverage({ tenantId, accountId, symbol });
  }

  // ---------- Liquidation ----------

  @Get('liquidation/:accountId')
  @RequirePermissions(Permission.RISK_READ)
  async getLiquidation(@Req() req: any, @Param('accountId') accountId: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.liquidationService.evaluateLiquidationRisk({ tenantId, accountId });
  }

  // ---------- Concentration ----------

  @Get('concentration')
  @RequirePermissions(Permission.RISK_READ)
  async getConcentration(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    return this.concentrationService.evaluateConcentration({ tenantId, accountId });
  }

  // ---------- Drawdown ----------

  @Get('drawdown')
  @RequirePermissions(Permission.RISK_READ)
  async getDrawdown(@Req() req: any, @Query('accountId') accountId?: string, @Query('traderId') traderId?: string, @Query('strategyId') strategyId?: string, @Query('followerId') followerId?: string) {
    const tenantId = this.getTenantId(req);
    return this.drawdownService.evaluateDrawdown({ tenantId, accountId, traderId, strategyId, followerId });
  }

  // ---------- Daily loss ----------

  @Get('daily-loss')
  @RequirePermissions(Permission.RISK_READ)
  async getDailyLoss(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    return this.dailyLossService.evaluateDailyLoss({ tenantId, accountId });
  }

  // ---------- Correlation ----------

  @Get('correlation')
  @RequirePermissions(Permission.RISK_READ)
  async getCorrelation(@Req() req: any) {
    const tenantId = this.getTenantId(req);
    return this.correlationService.evaluateCorrelation({ tenantId });
  }

  // ---------- VaR ----------

  @Get('var')
  @RequirePermissions(Permission.RISK_READ)
  async getVar(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    return this.varService.evaluateVar({ tenantId, accountId });
  }

  // ---------- Stress ----------

  @Get('stress')
  @RequirePermissions(Permission.RISK_READ)
  async getStress(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    return this.stressService.runStressTests({ tenantId, accountId });
  }

  // ---------- Policy ----------

  @Get('policy')
  @RequirePermissions(Permission.RISK_READ)
  async getPolicy(@Req() req: any, @Query('traderId') traderId?: string, @Query('strategyId') strategyId?: string, @Query('followerId') followerId?: string) {
    const tenantId = this.getTenantId(req);
    return this.policyService.resolveEffectivePolicy({ tenantId, traderId: traderId ?? null, strategyId: strategyId ?? null, followerId: followerId ?? null });
  }

  @Post('policy')
  async upsertPolicy(@Req() req: any, @Body() dto: UpsertRiskPolicyDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const isPlatform = req.user?.isPlatformUser || req.user?.permissions?.includes('PLATFORM_MANAGE');

    if (dto.scope === RiskPolicyScopeDto.PLATFORM && !isPlatform) {
      throw new ForbiddenException('PLATFORM scope requires PLATFORM_MANAGE');
    }

    // Tenant admins can only manage own tenant scope
    if (dto.scope === RiskPolicyScopeDto.TENANT) {
      const targetTenant = dto.tenantId ?? tenantId;
      this.checkTenantAccess(req, targetTenant);
    }

    return this.policyService.upsertPolicy({
      scope: dto.scope as unknown as RiskPolicyScope,
      scopeId: dto.scopeId ?? (dto.scope === RiskPolicyScopeDto.TENANT ? (dto.tenantId ?? tenantId) : null),
      tenantId: dto.scope === RiskPolicyScopeDto.PLATFORM ? null : (dto.tenantId ?? tenantId),
      thresholds: dto.thresholds as any,
      changeReason: dto.changeReason,
      changedByUserId: userId,
      actorTenantId: tenantId,
    });
  }

  @Get('policy/history')
  @RequirePermissions(Permission.RISK_READ)
  async getPolicyHistory(@Req() req: any, @Query('scope') scope: RiskPolicyScopeDto, @Query('scopeId') scopeId?: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.policyService.getPolicyHistory({ scope: scope as unknown as RiskPolicyScope, scopeId: scopeId ?? null, tenantId });
  }

  // ---------- Circuit breaker ----------

  @Get('breaker')
  @RequirePermissions(Permission.RISK_READ)
  async listBreakers(@Req() req: any) {
    const tenantId = this.getTenantId(req);
    return this.breakerService.listBreakers({ tenantId });
  }

  @Post('breaker/trigger')
  @RequirePermissions(Permission.RISK_KILL_SWITCH_UPDATE)
  async triggerBreaker(@Req() req: any, @Body() body: { scope: string; scopeId: string; triggerType: string; reason: string; triggerRuleId?: string }) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const policy = await this.policyService.resolveEffectivePolicy({ tenantId });
    return this.breakerService.triggerBreaker({
      tenantId,
      scope: body.scope as CircuitBreakerScope,
      scopeId: body.scopeId,
      triggerType: body.triggerType,
      triggerRuleId: body.triggerRuleId,
      reason: body.reason,
      policyVersion: policy.effectiveVersion,
      triggeredByUserId: userId,
    });
  }

  @Post('breaker/:id/clear')
  @RequirePermissions(Permission.RISK_PROTECTION_CLEAR)
  async clearBreaker(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    return this.breakerService.clearBreaker({ breakerId: id, clearedByUserId: userId, reason: body.reason, tenantId });
  }

  @Post('breaker/:id/acknowledge')
  @RequirePermissions(Permission.RISK_KILL_SWITCH_UPDATE)
  async acknowledgeBreaker(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    return this.breakerService.acknowledgeBreaker({ breakerId: id, acknowledgedByUserId: userId, reason: body.reason, tenantId });
  }

  // ---------- Kill-switch ----------

  @Get('kill-switch')
  @RequirePermissions(Permission.RISK_READ)
  async listKillSwitches(@Req() req: any) {
    const tenantId = this.getTenantId(req);
    return this.killSwitchService.inspectKillSwitch({ tenantId });
  }

  @Post('kill-switch/request')
  @RequirePermissions(Permission.RISK_KILL_SWITCH_UPDATE)
  async requestKillSwitch(@Req() req: any, @Body() body: { scope: string; target?: string; reason: string; triggeredByRule?: string }) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const policy = await this.policyService.resolveEffectivePolicy({ tenantId });
    const isPlatform = req.user?.isPlatformUser || req.user?.permissions?.includes('PLATFORM_MANAGE');
    if (body.scope === 'GLOBAL' && !isPlatform) {
      throw new ForbiddenException('GLOBAL kill-switch requires PLATFORM_MANAGE');
    }
    return this.killSwitchService.requestKillSwitch({
      tenantId: body.scope === 'GLOBAL' ? null : tenantId,
      scope: body.scope as KillSwitchRequestScope,
      target: body.target ?? null,
      reason: body.reason,
      triggeredByRule: body.triggeredByRule,
      requestedByUserId: userId,
      policyVersion: policy.effectiveVersion,
    });
  }

  @Post('kill-switch/:id/clear')
  @RequirePermissions(Permission.RISK_PROTECTION_CLEAR)
  async clearKillSwitch(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    return this.killSwitchService.clearKillSwitch({ killSwitchId: id, clearedByUserId: userId, reason: body.reason, tenantId });
  }

  @Post('kill-switch/:id/acknowledge')
  @RequirePermissions(Permission.RISK_KILL_SWITCH_UPDATE)
  async acknowledgeKillSwitch(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    return this.killSwitchService.acknowledgeKillSwitch({ killSwitchId: id, acknowledgedByUserId: userId, reason: body.reason, tenantId });
  }

  // ---------- Reconciliation ----------

  @Get('reconciliation')
  @RequirePermissions(Permission.RISK_READ)
  async getReconciliation(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.reconciliationService.reconcile({ tenantId, accountId });
  }

  @Get('reconciliation/history')
  @RequirePermissions(Permission.RISK_READ)
  async getReconciliationHistory(@Req() req: any) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.reconciliationService.getReconciliationHistory(tenantId);
  }

  // ---------- Snapshots ----------

  @Get('snapshots')
  @RequirePermissions(Permission.RISK_READ)
  async getSnapshots(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    if (accountId) {
      return this.snapshotRepo.getLatestSnapshot({ tenantId, accountId });
    }
    return this.snapshotRepo.getSnapshotsByTenant(tenantId);
  }
}
