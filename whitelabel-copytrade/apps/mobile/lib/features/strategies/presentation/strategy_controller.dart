import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../data/strategy_repository.dart';
import '../domain/strategy_models.dart';
import 'strategy_state.dart';

/// Drives the read-only strategy screen.
///
/// The controller exposes exactly two operations - [load] and [refresh] - and
/// no mutation. Adding one here would be the first step towards a trading
/// control on a phone, so the class is kept deliberately inert.
///
/// Panels are fetched concurrently and failures are isolated per panel. Only
/// a total failure surfaces as a page-level error.
class StrategyController extends StateNotifier<StrategyViewState> {
  StrategyController({required StrategyRepository repository, required AppLogger logger})
      : _repository = repository,
        _logger = logger,
        super(const StrategyViewState.initial());

  final StrategyRepository _repository;
  final AppLogger _logger;

  Future<void> load() => _fetch(isRefresh: false);

  Future<void> refresh() => _fetch(isRefresh: true);

  Future<void> _fetch({required bool isRefresh}) async {
    if (state.isRefreshing) {
      return;
    }

    state = state.copyWith(
      status: isRefresh ? state.status : StrategyViewStatus.loading,
      isRefreshing: true,
      clearError: true,
    );

    final List<String> degraded = <String>[];
    AppException? lastFailure;

    Future<T?> attempt<T>(String panel, Future<T> Function() operation) async {
      try {
        return await operation();
      } on AppException catch (error) {
        degraded.add(panel);
        lastFailure = error;
        // Panel name and error code only. Never the payload: it can carry
        // organisation-identifying detail into device logs.
        _logger.warning(
          'strategy.panel_failed',
          context: <String, Object?>{'panel': panel, 'code': error.code.name},
        );
        return null;
      }
    }

    final List<Object?> results = await Future.wait<Object?>(<Future<Object?>>[
      attempt<StrategyOverview>('overview', _repository.fetchOverview),
      attempt<List<StrategyInstanceSummary>>('instances', _repository.fetchInstances),
      attempt<List<PaperSessionSummary>>('paperSessions', _repository.fetchPaperSessions),
      attempt<List<BacktestSummary>>('backtests', _repository.fetchBacktests),
    ]);

    final StrategyOverview? overview = results[0] as StrategyOverview?;
    final List<StrategyInstanceSummary>? instances =
        results[1] as List<StrategyInstanceSummary>?;
    final List<PaperSessionSummary>? sessions = results[2] as List<PaperSessionSummary>?;
    final List<BacktestSummary>? backtests = results[3] as List<BacktestSummary>?;

    final bool everythingFailed = degraded.length == results.length;

    if (everythingFailed) {
      state = state.copyWith(
        status: StrategyViewStatus.failed,
        isRefreshing: false,
        error: lastFailure,
        degradedPanels: const <String>[],
      );
      return;
    }

    state = StrategyViewState(
      status: StrategyViewStatus.ready,
      // A panel that failed keeps its previous content rather than blanking.
      overview: overview ?? state.overview,
      instances: instances ?? state.instances,
      paperSessions: sessions ?? state.paperSessions,
      backtests: backtests ?? state.backtests,
      isRefreshing: false,
      degradedPanels: List<String>.unmodifiable(degraded),
    );
  }
}
