import { Module } from '@nestjs/common';

import { DatasetRegistryService } from './dataset-registry.service';
import { DatasetIngestionService } from './dataset-ingestion.service';
import { DatasetLifecycleService } from './dataset-lifecycle.service';
import { DatasetsController } from './datasets.controller';

/**
 * The historical dataset registry and its job dispatch (Part 7).
 *
 * Not `@Global()`, no `exports`, for the same reason as StrategyModule:
 * nothing else in the API should be reaching into dataset state, and a module
 * that exports nothing makes "who else depends on datasets?" answerable by
 * reading the import graph rather than grepping for a service name.
 *
 * Note what this module does NOT provide: no storage client, no fetcher, no
 * parser, no validator, no replay reader. All of that lives in
 * `wlct_trading.datasets` and runs in the dataset worker. This module records
 * what an operator asked for and reads back what the worker registered - the
 * same division that keeps the strategy API from becoming a trading engine,
 * applied to data instead of orders.
 *
 * The one hard boundary restated at the module level because a module comment
 * is where the next developer actually looks: no service here can reach a
 * venue, an adapter, an order route, or the live/paper execution path.
 * Historical datasets feed BACKTEST. Only. By construction, and by the
 * datasets-safety spec that asserts it.
 */
@Module({
  controllers: [DatasetsController],
  providers: [DatasetRegistryService, DatasetIngestionService, DatasetLifecycleService],
})
export class DatasetsModule {}
