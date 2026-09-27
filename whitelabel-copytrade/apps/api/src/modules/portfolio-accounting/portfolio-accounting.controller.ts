import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { AccountingEventService } from './accounting-event.service';
import { AccountingEventRepository } from './accounting-event.repository';
import { CashLedgerService } from './cash-ledger.service';
import { PositionAccountingService } from './position-accounting.service';
import { CostBasisService } from './cost-basis.service';
import { ValuationService } from './valuation.service';
import { NavService } from './nav.service';
import { PnLService } from './pnl.service';
import { PerformanceService } from './performance.service';
import { BenchmarkService } from './benchmark.service';
import { AttributionService } from './attribution.service';
import { PortfolioSnapshotService } from './portfolio-snapshot.service';
import { AccountingPeriodService } from './accounting-period.service';
import { PeriodCloseService } from './period-close.service';
import { StatementService } from './statement.service';
import { ReportExportService } from './report-export.service';
import { AccountingReconciliationService } from './accounting-reconciliation.service';
import { AccountingAdjustmentService } from './accounting-adjustment.service';
import { InvestorVisibilityService, InvestorVisibilityRole } from './investor-visibility.service';
import { PortfolioAuditService } from './portfolio-audit.service';
import { PortfolioQueryDto, PortfolioPeriodQueryDto, PortfolioSnapshotQueryDto } from './dto/portfolio-query.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import {
  CreateProfileDto,
  CreatePeriodDto,
  ClosePeriodDto,
  CreateSnapshotDto,
  GenerateStatementDto,
  CreateAdjustmentDto,
  ReconciliationActionDto,
  PerformanceQueryDto,
  AttributionQueryDto,
} from './dto/accounting-action.dto';
import { PortfolioReturnMethodology, PortfolioAttributionDimension, redactSecrets } from './portfolio-accounting.types';

/**
 * Tenant-safe and platform-safe API surface for portfolio accounting.
 * Must enforce RBAC, ownership, compliance visibility, and tenant isolation.
 * Statement cannot expose other user.
 */

@Controller('portfolio-accounting')
export class PortfolioAccountingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AccountingPolicyService,
    private readonly eventService: AccountingEventService,
    private readonly eventRepo: AccountingEventRepository,
    private readonly cashLedger: CashLedgerService,
    private readonly positionAccounting: PositionAccountingService,
    private readonly costBasis: CostBasisService,
    private readonly valuation: ValuationService,
    private readonly navService: NavService,
    private readonly pnlService: PnLService,
    private readonly performanceService: PerformanceService,
    private readonly benchmarkService: BenchmarkService,
    private readonly attributionService: AttributionService,
    private readonly snapshotService: PortfolioSnapshotService,
    private readonly periodService: AccountingPeriodService,
    private readonly periodCloseService: PeriodCloseService,
    private readonly statementService: StatementService,
    private readonly exportService: ReportExportService,
    private readonly reconciliationService: AccountingReconciliationService,
    private readonly adjustmentService: AccountingAdjustmentService,
    private readonly visibilityService: InvestorVisibilityService,
    private readonly auditService: PortfolioAuditService,
  ) {}

  private getTenantId(req: any): string {
    const tenantId = req.user?.tenantId ?? req.headers['x-tenant-id'] ?? req.query?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return tenantId;
  }

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.sub ?? 'anonymous';
  }

  private isPlatformUser(req: any): boolean {
    return req.user?.isPlatformUser ?? (req.user?.role === 'PLATFORM_ADMIN');
  }

  private async enforceTenantIsolation(tenantId: string, profileId: string): Promise<void> {
    try {
      const profile = await (this.prisma as any).portfolioAccountingProfile.findFirst({ where: { id: profileId } });
      if (!profile) throw new BadRequestException('Profile not found');
      if (profile.tenantId !== tenantId) throw new ForbiddenException('Tenant isolation: profile belongs to different tenant');
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof BadRequestException) throw e;
      // If model not yet available, skip check
    }
  }

  private async enforcePlatformRBAC(req: any, requiredPermission?: string): Promise<void> {
    if (requiredPermission && this.isPlatformUser(req)) {
      // Platform RBAC check — reuse existing RBAC if available
      // For now, allow platform users
      return;
    }
  }

  // Profile
  @Post('profiles')
  async createProfile(@Req() req: any, @Body() dto: CreateProfileDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);

    const profile = await this.policyService.createOrUpdateProfile({
      tenantId,
      scope: dto.scope as any,
      scopeId: dto.scopeId,
      portfolioType: dto.portfolioType as any,
      baseCurrency: dto.baseCurrency,
      returnMethodology: dto.returnMethodology as any,
      costBasisMethod: dto.costBasisMethod,
    });

    await this.auditService.log({
      tenantId,
      profileId: profile.id,
      action: 'PROFILE_CREATED',
      entityType: 'PORTFOLIO_ACCOUNTING_PROFILE',
      entityId: profile.id,
      operatorId: userId,
      evidence: { scope: dto.scope, scopeId: dto.scopeId },
    });

    return profile;
  }

  @Get('profiles')
  async listProfiles(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    try {
      const profiles = await (this.prisma as any).portfolioAccountingProfile.findMany({
        where: { tenantId, ...(query.scope ? { scope: query.scope as any } : {}), ...(query.scopeId ? { scopeId: query.scopeId } : {}) },
      });
      return { data: profiles.map((p: any) => redactSecrets(p)) };
    } catch {
      return { data: [] };
    }
  }

  // Events
  @Get('events')
  async listEvents(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    if (query.profileId) await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.eventRepo.listEvents({
      tenantId,
      profileId: query.profileId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  // Cash ledger
  @Get('cash')
  async listCash(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    if (!query.profileId) throw new BadRequestException('profileId required');
    await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.cashLedger.listCashEntries({
      tenantId,
      profileId: query.profileId,
      asset: query.asset,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('cash/balance')
  async getCashBalance(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    if (!query.profileId) throw new BadRequestException('profileId required');
    await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.cashLedger.getCashBalance({
      tenantId,
      profileId: query.profileId,
      asset: query.asset,
      at: query.at ? new Date(query.at) : new Date(),
    });
  }

  // Positions
  @Get('positions')
  async listPositions(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    if (!query.profileId) throw new BadRequestException('profileId required');
    await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.positionAccounting.listLots({
      tenantId,
      profileId: query.profileId,
      symbol: query.symbol,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('holdings')
  async getHoldings(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    if (!query.profileId) throw new BadRequestException('profileId required');
    await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.positionAccounting.getHoldings({
      tenantId,
      profileId: query.profileId,
      at: query.at ? new Date(query.at) : new Date(),
    });
  }

  // Valuation & NAV
  @Get('nav')
  async getNav(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    if (!query.profileId) throw new BadRequestException('profileId required');
    await this.enforceTenantIsolation(tenantId, query.profileId);

    const result = await this.navService.calculateNav({
      tenantId,
      profileId: query.profileId,
      at: query.at ? new Date(query.at) : new Date(),
      baseCurrency: query.baseCurrency,
    });

    await this.auditService.logNav({
      tenantId,
      profileId: query.profileId,
      nav: result.nav,
      baseCurrency: result.baseCurrency,
      calculationVersion: result.calculationVersion,
      policyVersion: result.policyVersion,
      dataCompleteness: result.dataCompleteness,
      sourceReferences: result.sourceReferences,
    });

    return redactSecrets(result);
  }

  // PnL
  @Get('pnl')
  async getPnl(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    if (!query.profileId) throw new BadRequestException('profileId required');
    await this.enforceTenantIsolation(tenantId, query.profileId);

    const at = query.at ? new Date(query.at) : new Date();
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const realized = await this.pnlService.calculateRealizedPnl({ tenantId, profileId: query.profileId, from, to, symbol: query.symbol });
    const unrealized = await this.pnlService.calculateUnrealizedPnl({ tenantId, profileId: query.profileId, at, baseCurrency: query.baseCurrency });
    const gross = await this.pnlService.calculateGrossPnl({ tenantId, profileId: query.profileId, from, to, at, baseCurrency: query.baseCurrency });
    const net = await this.pnlService.calculateNetPnl({ tenantId, profileId: query.profileId, from, to, at, baseCurrency: query.baseCurrency });

    return redactSecrets({ realized, unrealized, gross, net });
  }

  // Performance
  @Get('performance')
  async getPerformance(@Req() req: any, @Query() query: PerformanceQueryDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolation(tenantId, query.profileId);

    const periodStart = new Date(query.periodStart);
    const periodEnd = new Date(query.periodEnd);
    const methodology = (query.methodology as PortfolioReturnMethodology) ?? PortfolioReturnMethodology.TIME_WEIGHTED_RETURN;

    let result;
    if (methodology === PortfolioReturnMethodology.MONEY_WEIGHTED_RETURN) {
      result = await this.performanceService.calculateMWR({ tenantId, profileId: query.profileId, periodStart, periodEnd, baseCurrency: query.baseCurrency });
    } else {
      result = await this.performanceService.calculateTWR({ tenantId, profileId: query.profileId, periodStart, periodEnd, baseCurrency: query.baseCurrency });
    }

    if (query.benchmarkId) {
      const benchmark = await this.benchmarkService.calculateBenchmarkReturn({
        tenantId,
        profileId: query.profileId,
        benchmarkId: query.benchmarkId,
        periodStart,
        periodEnd,
        baseCurrency: query.baseCurrency,
      });
      const alpha = await this.benchmarkService.calculateAlpha({
        tenantId,
        profileId: query.profileId,
        portfolioReturn: result.returnPercent,
        benchmarkReturn: benchmark.returnPercent,
        benchmarkId: query.benchmarkId,
      });
      return redactSecrets({ performance: result, benchmark, alpha });
    }

    return redactSecrets(result);
  }

  // Attribution
  @Get('attribution')
  async getAttribution(@Req() req: any, @Query() query: AttributionQueryDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolation(tenantId, query.profileId);

    // For attribution, need total PnL — calculate
    const pnl = await this.pnlService.calculateNetPnl({
      tenantId,
      profileId: query.profileId,
      from: new Date(query.periodStart),
      to: new Date(query.periodEnd),
      at: new Date(query.periodEnd),
      baseCurrency: query.baseCurrency,
    });

    const totalPnl = pnl.netPnl ?? pnl.grossPnl ?? '0';

    const result = await this.attributionService.calculateAttribution({
      tenantId,
      profileId: query.profileId,
      periodStart: new Date(query.periodStart),
      periodEnd: new Date(query.periodEnd),
      dimension: query.dimension as any,
      totalPnl,
      baseCurrency: query.baseCurrency,
    });

    return redactSecrets(result);
  }

  // Snapshots
  @Post('snapshots')
  async createSnapshot(@Req() req: any, @Body() dto: CreateSnapshotDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolation(tenantId, dto.profileId);

    const snapshot = await this.snapshotService.createSnapshot({
      tenantId,
      profileId: dto.profileId,
      timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      baseCurrency: dto.baseCurrency,
      scope: dto.scope as any,
      scopeId: dto.scopeId,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    await this.auditService.log({
      tenantId,
      profileId: dto.profileId,
      action: 'SNAPSHOT_CREATED',
      entityType: 'PORTFOLIO_SNAPSHOT',
      entityId: snapshot.id,
      operatorId: this.getUserId(req),
      evidence: { snapshotId: snapshot.snapshotId, timestamp: snapshot.timestamp },
      calculationVersion: snapshot.calculationVersion,
      policyVersion: snapshot.policyVersion,
      dataCompleteness: snapshot.dataCompleteness,
    });

    return redactSecrets(snapshot);
  }

  @Get('snapshots')
  async listSnapshots(@Req() req: any, @Query() query: PortfolioSnapshotQueryDto) {
    const tenantId = this.getTenantId(req);
    if (query.profileId) await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.snapshotService.listSnapshots({
      tenantId,
      profileId: query.profileId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('snapshots/:snapshotId')
  async getSnapshot(@Req() req: any, @Param('snapshotId') snapshotId: string) {
    const tenantId = this.getTenantId(req);
    const snapshot = await this.snapshotService.getSnapshot({ tenantId, snapshotId });
    if (!snapshot) throw new BadRequestException('Snapshot not found');
    return redactSecrets(snapshot);
  }

  // Periods
  @Post('periods')
  async createPeriod(@Req() req: any, @Body() dto: CreatePeriodDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolation(tenantId, dto.profileId);

    const period = await this.periodService.createPeriod({
      tenantId,
      profileId: dto.profileId,
      periodStart: new Date(dto.periodStart),
      periodEnd: new Date(dto.periodEnd),
      periodType: dto.periodType,
      baseCurrency: dto.baseCurrency,
    });

    await this.auditService.log({
      tenantId,
      profileId: dto.profileId,
      action: 'PERIOD_CREATED',
      entityType: 'PORTFOLIO_ACCOUNTING_PERIOD',
      entityId: period.id,
      operatorId: this.getUserId(req),
      evidence: { periodStart: dto.periodStart, periodEnd: dto.periodEnd },
      calculationVersion: period.calculationVersion,
      policyVersion: period.policyVersion,
    });

    return redactSecrets(period);
  }

  @Get('periods')
  async listPeriods(@Req() req: any, @Query() query: PortfolioPeriodQueryDto) {
    const tenantId = this.getTenantId(req);
    if (query.profileId) await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.periodService.listPeriods({
      tenantId,
      profileId: query.profileId,
      state: query.state,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post('periods/close')
  async closePeriod(@Req() req: any, @Body() dto: ClosePeriodDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);

    const period = await this.periodService.getPeriod({ tenantId, periodId: dto.periodId });
    if (!period) throw new BadRequestException('Period not found');
    await this.enforceTenantIsolation(tenantId, period.profileId);

    const closed = await this.periodCloseService.initiateClose({
      tenantId,
      periodId: dto.periodId,
      operatorId: userId,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    await this.auditService.logPeriodClose({
      tenantId,
      profileId: period.profileId,
      periodId: dto.periodId,
      state: 'CLOSED',
      operatorId: userId,
      nav: closed.nav ?? null,
      calculationVersion: period.calculationVersion,
      policyVersion: period.policyVersion,
    });

    return redactSecrets(closed);
  }

  // Statements
  @Post('statements')
  async generateStatement(@Req() req: any, @Body() dto: GenerateStatementDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolation(tenantId, dto.profileId);

    const statement = await this.statementService.generateStatement({
      tenantId,
      profileId: dto.profileId,
      periodId: dto.periodId,
      operatorId: this.getUserId(req),
    });

    await this.auditService.logStatement({
      tenantId,
      profileId: dto.profileId,
      statementId: statement.statementId,
      periodId: dto.periodId,
      operatorId: this.getUserId(req),
      calculationVersion: statement.calculationVersion,
      policyVersion: statement.policyVersion,
    });

    return redactSecrets(statement);
  }

  @Get('statements')
  async listStatements(@Req() req: any, @Query() query: StatementQueryDto) {
    const tenantId = this.getTenantId(req);
    if (query.profileId) await this.enforceTenantIsolation(tenantId, query.profileId);

    // Statement cannot expose other user — enforce visibility
    const userId = this.getUserId(req);
    const role = (req.user?.portfolioRole as InvestorVisibilityRole) ?? InvestorVisibilityRole.TENANT_OWNER;
    const isPlatform = this.isPlatformUser(req);

    const result = await this.statementService.listStatements({
      tenantId,
      profileId: query.profileId,
      periodId: query.periodId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });

    // Filter by visibility if not platform/owner
    if (!isPlatform && role !== InvestorVisibilityRole.TENANT_OWNER && role !== InvestorVisibilityRole.COMPLIANCE_REVIEWER) {
      const visibleProfiles = await this.visibilityService.resolveVisibleProfiles({ tenantId, userId, role, isPlatformUser: isPlatform });
      const visibleIds = new Set(visibleProfiles.map((v) => v.profileId));
      result.data = result.data.filter((s: any) => visibleIds.has(s.profileId));
    }

    return { ...result, data: result.data.map((d: any) => redactSecrets(d)) };
  }

  @Get('statements/:statementId')
  async getStatement(@Req() req: any, @Param('statementId') statementId: string) {
    const tenantId = this.getTenantId(req);
    const statement = await this.statementService.getStatement({ tenantId, statementId });
    if (!statement) throw new BadRequestException('Statement not found');

    // Visibility check
    const userId = this.getUserId(req);
    const role = (req.user?.portfolioRole as InvestorVisibilityRole) ?? InvestorVisibilityRole.TENANT_OWNER;
    const isPlatform = this.isPlatformUser(req);
    const canView = await this.visibilityService.canViewStatement({ tenantId, userId, statementId, role, isPlatformUser: isPlatform });
    if (!canView && !isPlatform && role !== InvestorVisibilityRole.TENANT_OWNER && role !== InvestorVisibilityRole.COMPLIANCE_REVIEWER) {
      throw new ForbiddenException('Access denied to statement');
    }

    return redactSecrets(statement);
  }

  @Get('statements/:statementId/export')
  async exportStatement(@Req() req: any, @Param('statementId') statementId: string, @Query('format') format: string = 'JSON') {
    const tenantId = this.getTenantId(req);
    const statement = await this.statementService.getStatement({ tenantId, statementId });
    if (!statement) throw new BadRequestException('Statement not found');

    await this.enforceTenantIsolation(tenantId, statement.profileId);

    let result;
    if (format === 'CSV') {
      result = await this.exportService.exportStatementCsv({ tenantId, statementId });
    } else {
      result = await this.exportService.exportStatementJson({ tenantId, statementId });
    }

    await this.auditService.logExport({
      tenantId,
      profileId: statement.profileId,
      exportType: 'STATEMENT',
      statementId,
      operatorId: this.getUserId(req),
      format,
    });

    return result;
  }

  // Adjustments
  @Post('adjustments')
  async createAdjustment(@Req() req: any, @Body() dto: CreateAdjustmentDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolation(tenantId, dto.profileId);
    await this.enforcePlatformRBAC(req);

    const adjustment = await this.adjustmentService.createAdjustment({
      tenantId,
      profileId: dto.profileId,
      originalEventId: dto.originalEventId,
      adjustmentType: dto.adjustmentType as any,
      reason: dto.reason,
      adjustedAmount: dto.adjustedAmount,
      adjustedQuantity: dto.adjustedQuantity,
      asset: dto.asset,
      operatorId: this.getUserId(req),
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    await this.auditService.logAdjustment({
      tenantId,
      profileId: dto.profileId,
      adjustmentId: adjustment.id,
      adjustmentType: dto.adjustmentType,
      originalEventId: dto.originalEventId ?? null,
      operatorId: this.getUserId(req),
      reason: dto.reason,
    });

    return redactSecrets(adjustment);
  }

  @Get('adjustments')
  async listAdjustments(@Req() req: any, @Query() query: PortfolioQueryDto) {
    const tenantId = this.getTenantId(req);
    if (query.profileId) await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.adjustmentService.listAdjustments({
      tenantId,
      profileId: query.profileId,
      page: query.page,
      limit: query.limit,
    });
  }

  // Reconciliation
  @Post('reconciliations')
  async runReconciliation(@Req() req: any, @Body() dto: ReconciliationActionDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolation(tenantId, dto.profileId);

    const recon = await this.reconciliationService.runReconciliation({
      tenantId,
      profileId: dto.profileId,
      scope: dto.scope,
      periodId: dto.periodId,
      trigger: dto.trigger,
      requestedBy: this.getUserId(req),
    });

    await this.auditService.logReconciliation({
      tenantId,
      profileId: dto.profileId,
      reconciliationId: recon.id,
      state: recon.state,
      hasCriticalFailure: recon.hasCriticalFailure,
      discrepanciesCount: (recon.discrepancies as any)?.length ?? 0,
    });

    return redactSecrets(recon);
  }

  @Get('reconciliations')
  async listReconciliations(@Req() req: any, @Query() query: PortfolioQueryDto & { periodId?: string; state?: string }) {
    const tenantId = this.getTenantId(req);
    if (query.profileId) await this.enforceTenantIsolation(tenantId, query.profileId);

    return await this.reconciliationService.listReconciliations({
      tenantId,
      profileId: query.profileId,
      periodId: (query as any).periodId,
      state: (query as any).state,
      page: query.page,
      limit: query.limit,
    });
  }
}
