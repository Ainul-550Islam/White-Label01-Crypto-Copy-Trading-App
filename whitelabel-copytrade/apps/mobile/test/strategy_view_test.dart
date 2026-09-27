import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/features/strategies/domain/strategy_models.dart';
import 'package:wlct_mobile/features/strategies/presentation/strategy_state.dart';

/// Safety and parsing tests for the mobile strategy viewer.
///
/// The first group is the important one: it asserts, from the source itself,
/// that the mobile client has no write path into the strategy layer. A unit
/// test cannot prove the absence of a capability by calling it, so it reads
/// the repository and fails if a mutating verb ever appears.
void main() {
  group('mobile strategy layer is read-only', () {
    final File repository =
        File('lib/features/strategies/data/strategy_repository.dart');

    test('the repository source exists where the test expects it', () {
      expect(
        repository.existsSync(),
        isTrue,
        reason: 'Run these tests from apps/mobile so the relative path resolves.',
      );
    });

    test('the repository issues no POST, PATCH, PUT or DELETE', () {
      final String source = repository.readAsStringSync();

      expect(source.contains('_apiClient.post'), isFalse);
      expect(source.contains('_apiClient.patch'), isFalse);
      expect(source.contains('_apiClient.put'), isFalse);
      expect(source.contains('_apiClient.delete'), isFalse);
    });

    test('the repository names no enable, disable, start or stop operation', () {
      final String source = repository.readAsStringSync().toLowerCase();

      for (final String forbidden in <String>[
        'future<void> enable',
        'future<void> disable',
        'startsession',
        'stopsession',
        'submitbacktest',
      ]) {
        expect(source.contains(forbidden), isFalse, reason: forbidden);
      }
    });

    test('the controller exposes only load and refresh', () {
      final String source =
          File('lib/features/strategies/presentation/strategy_controller.dart')
              .readAsStringSync();

      expect(source.contains('Future<void> load()'), isTrue);
      expect(source.contains('Future<void> refresh()'), isTrue);
      expect(source.contains('Future<void> enable'), isFalse);
      expect(source.contains('Future<void> disable'), isFalse);
    });
  });

  group('StrategyOverview', () {
    test('reads the execution boundary and the flags', () {
      final StrategyOverview overview =
          StrategyOverview.fromJson(const <String, Object?>{
        'instances': <String, Object?>{
          'total': 3,
          'enabled': 2,
          'running': 1,
          'quarantined': 1,
          'unhealthy': 0,
        },
        'incidents': <String, Object?>{'open': 2, 'critical': 1},
        'paperSessions': <String, Object?>{'running': 1},
        'backtests': <String, Object?>{'queued': 4},
        'configuration': <String, Object?>{
          'strategyEngineEnabled': true,
          'paperTradingEnabled': true,
          'backtestEnabled': false,
          'tradingMode': 'PAPER',
          'liveExecutionReachable': false,
        },
        'latencyNote': 'Not a guarantee.',
        'disclaimer': 'SIMULATED.',
      });

      expect(overview.totalInstances, 3);
      expect(overview.quarantinedInstances, 1);
      expect(overview.criticalIncidents, 1);
      expect(overview.tradingMode, 'PAPER');
      expect(overview.liveExecutionReachable, isFalse);
      expect(overview.backtestEnabled, isFalse);
    });

    test('a malformed payload degrades to zeros rather than throwing', () {
      final StrategyOverview overview =
          StrategyOverview.fromJson(const <String, Object?>{});

      expect(overview.totalInstances, 0);
      expect(overview.liveExecutionReachable, isFalse);
      expect(overview.tradingMode, 'UNKNOWN');
    });
  });

  group('PaperSessionSummary', () {
    test('keeps decimals as strings and reads the simulated label', () {
      final PaperSessionSummary session =
          PaperSessionSummary.fromJson(const <String, Object?>{
        'id': 'session-1',
        'sessionIdentifier': 'paper-000000000001',
        'status': 'RUNNING',
        'strategyKey': 'DETERMINISTIC_IMBALANCE_V1',
        'symbol': 'BTC-USDT',
        'initialCapital': '10000.000000',
        'realisedPnl': '-12.500000',
        'feesPaid': '3.250000',
        'currentEquity': '9987.500000',
        'simulatedOrders': 4,
        'simulatedFills': 3,
        'riskRejections': 1,
        'isSimulated': true,
        'startedAt': '2026-09-07T10:00:00.000Z',
      });

      expect(session.status, SimulationStatus.running);
      expect(session.realisedPnl, '-12.500000');
      expect(session.currentEquity, '9987.500000');
      expect(session.isSimulated, isTrue);
    });

    test('treats a missing simulated label as simulated', () {
      final PaperSessionSummary session =
          PaperSessionSummary.fromJson(const <String, Object?>{
        'id': 'session-2',
        'sessionIdentifier': 'paper-000000000002',
        'status': 'STOPPED',
      });

      expect(session.isSimulated, isTrue);
    });
  });

  group('BacktestSummary', () {
    test('withheld metrics stay null rather than becoming zero', () {
      final BacktestSummary backtest =
          BacktestSummary.fromJson(const <String, Object?>{
        'id': 'backtest-1',
        'runIdentifier': 'bt-000000000000000000000001',
        'status': 'COMPLETED',
        'strategyKey': 'DETERMINISTIC_IMBALANCE_V1',
        'strategyVersion': '1.0.0',
        'symbol': 'BTC-USDT',
        'isReproducible': true,
        'queuedAt': '2026-09-07T09:00:00.000Z',
        'result': <String, Object?>{
          'netPnl': '15.250000',
          'totalTrades': 4,
          'winRate': null,
          'sharpeRatio': null,
          'hasSufficientObservations': false,
        },
      });

      expect(backtest.netPnl, '15.250000');
      expect(backtest.totalTrades, 4);
      expect(backtest.winRate, isNull);
      expect(backtest.sharpeRatio, isNull);
      expect(backtest.hasSufficientObservations, isFalse);
    });
  });

  group('StrategyViewState', () {
    test('surfaces the instances that need attention', () {
      const StrategyInstanceSummary healthy = StrategyInstanceSummary(
        id: 'a',
        name: 'Healthy',
        kind: 'DETERMINISTIC_IMBALANCE_V1',
        version: '1.0.0',
        status: StrategyInstanceStatus.running,
        health: StrategyHealth.healthy,
        enabled: true,
        venue: 'BINANCE',
        symbols: <String>['BTC-USDT'],
        consecutiveErrors: 0,
      );

      const StrategyInstanceSummary quarantined = StrategyInstanceSummary(
        id: 'b',
        name: 'Quarantined',
        kind: 'DETERMINISTIC_IMBALANCE_V1',
        version: '1.0.0',
        status: StrategyInstanceStatus.stopped,
        health: StrategyHealth.quarantined,
        enabled: false,
        venue: 'BINANCE',
        symbols: <String>['ETH-USDT'],
        consecutiveErrors: 5,
      );

      const StrategyViewState state = StrategyViewState(
        status: StrategyViewStatus.ready,
        instances: <StrategyInstanceSummary>[healthy, quarantined],
      );

      expect(state.attentionInstances, <StrategyInstanceSummary>[quarantined]);
      expect(state.hasAnyData, isTrue);
      expect(state.isDegraded, isFalse);
    });

    test('a partial failure is degraded, not failed', () {
      const StrategyViewState state = StrategyViewState(
        status: StrategyViewStatus.ready,
        degradedPanels: <String>['backtests'],
      );

      expect(state.isDegraded, isTrue);
      expect(state.status, StrategyViewStatus.ready);
    });
  });
}
