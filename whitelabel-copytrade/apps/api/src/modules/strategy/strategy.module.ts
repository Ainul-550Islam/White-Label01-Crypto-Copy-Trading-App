import { Module } from '@nestjs/common';

import { StrategyCatalogService } from './strategy-catalog.service';
import { StrategyInstancesService } from './strategy-instances.service';
import { StrategyIncidentsService } from './strategy-incidents.service';
import { StrategyMetricsService } from './strategy-metrics.service';
import { BacktestService } from './backtest.service';
import { PaperSessionsService } from './paper-sessions.service';
import { StrategyController } from './strategy.controller';
import { StrategySimulationController } from './strategy-simulation.controller';

/**
 * The strategy layer's control and read surface.
 *
 * Not `@Global()` and with no `exports`, for the same reason as the execution
 * module: nothing else in the API should be reaching into strategy state, and
 * a global module invites exactly that. If another module ever needs one of
 * these services, adding an explicit import is the moment at which someone
 * asks whether it should.
 *
 * Note what this module does not provide: no strategy engine, no feature
 * engine, no simulator, no adapter, no risk engine. Those live in the strategy
 * worker and in `wlct_trading`. This module records what an operator wants and
 * reads back what the worker recorded. There is no code path from an HTTP
 * request to a strategy tick, which is what keeps request latency out of the
 * data plane and keeps the data plane's failure modes out of the API.
 */
@Module({
  controllers: [StrategyController, StrategySimulationController],
  providers: [
    StrategyCatalogService,
    StrategyInstancesService,
    StrategyIncidentsService,
    StrategyMetricsService,
    BacktestService,
    PaperSessionsService,
  ],
})
export class StrategyModule {}
