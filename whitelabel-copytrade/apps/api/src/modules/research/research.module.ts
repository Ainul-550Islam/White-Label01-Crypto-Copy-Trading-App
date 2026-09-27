import { Module, forwardRef } from '@nestjs/common';
import { ResearchController } from './research.controller';
import { ResearchRepository } from './research-repository';
import { BacktestRepository } from './backtest-repository';
import { PaperTradingRepository } from './paper-trading-repository';
import { ResearchPolicyService } from './research-policy.service';
import { StrategyVersionService } from './strategy-version.service';
import { MarketDataProviderFactory } from './market-data-provider.factory';
import { MarketDataService } from './market-data-service';
import { DatasetValidationService } from './dataset-validation.service';
import { BacktestConfigService } from './backtest-config.service';
import { BacktestEngineService } from './backtest-engine.service';
import { BacktestExecutionModelService } from './backtest-execution-model.service';
import { BacktestPortfolioService } from './backtest-portfolio.service';
import { BacktestMetricsService } from './backtest-metrics.service';
import { EquityCurveService } from './equity-curve.service';
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
import { ResearchAuditService } from './research-audit.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { StrategyModule } from '../strategy/strategy.module';
import { RiskModule } from '../risk/risk.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { CopyTradingModule } from '../copy-trading/copy-trading.module';

/**
 * NestJS wiring for all research, backtest, paper, signal, repository, provider, audit, DTO, and integration dependencies.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ExchangesModule),
    forwardRef(() => StrategyModule),
    forwardRef(() => RiskModule),
    forwardRef(() => ComplianceModule),
    forwardRef(() => CopyTradingModule),
  ],
  controllers: [ResearchController],
  providers: [
    ResearchRepository,
    BacktestRepository,
    PaperTradingRepository,
    ResearchPolicyService,
    StrategyVersionService,
    MarketDataProviderFactory,
    MarketDataService,
    DatasetValidationService,
    BacktestConfigService,
    BacktestEngineService,
    BacktestExecutionModelService,
    BacktestPortfolioService,
    BacktestMetricsService,
    EquityCurveService,
    WalkForwardService,
    MonteCarloService,
    ParameterSweepService,
    StrategyBenchmarkService,
    PaperTradingService,
    PaperOrderService,
    PaperPerformanceService,
    SignalService,
    SignalFilterService,
    ResearchPromotionService,
    ResearchAuditService,
  ],
  exports: [
    ResearchRepository,
    BacktestRepository,
    PaperTradingRepository,
    ResearchPolicyService,
    StrategyVersionService,
    MarketDataProviderFactory,
    MarketDataService,
    DatasetValidationService,
    BacktestConfigService,
    BacktestEngineService,
    BacktestExecutionModelService,
    BacktestPortfolioService,
    BacktestMetricsService,
    EquityCurveService,
    WalkForwardService,
    MonteCarloService,
    ParameterSweepService,
    StrategyBenchmarkService,
    PaperTradingService,
    PaperOrderService,
    PaperPerformanceService,
    SignalService,
    SignalFilterService,
    ResearchPromotionService,
    ResearchAuditService,
  ],
})
export class ResearchModule {}
