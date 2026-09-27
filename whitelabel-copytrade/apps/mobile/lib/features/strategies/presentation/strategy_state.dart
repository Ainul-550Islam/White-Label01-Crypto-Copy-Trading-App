import 'package:equatable/equatable.dart';

import '../../../core/error/app_exception.dart';
import '../domain/strategy_models.dart';

/// Loading state of the strategy viewer.
enum StrategyViewStatus { initial, loading, ready, failed }

/// Immutable state for the read-only strategy screen.
///
/// The four panels load in parallel and are held together here. A partial
/// failure keeps whatever did load: an operator checking on a degraded
/// instance should not lose the whole screen because the backtest list timed
/// out.
class StrategyViewState extends Equatable {
  const StrategyViewState({
    required this.status,
    this.overview,
    this.instances = const <StrategyInstanceSummary>[],
    this.paperSessions = const <PaperSessionSummary>[],
    this.backtests = const <BacktestSummary>[],
    this.error,
    this.isRefreshing = false,
    this.degradedPanels = const <String>[],
  });

  const StrategyViewState.initial() : this(status: StrategyViewStatus.initial);

  final StrategyViewStatus status;
  final StrategyOverview? overview;
  final List<StrategyInstanceSummary> instances;
  final List<PaperSessionSummary> paperSessions;
  final List<BacktestSummary> backtests;

  /// Set only when nothing at all could be loaded.
  final AppException? error;

  final bool isRefreshing;

  /// Human-readable names of panels that failed while others succeeded.
  final List<String> degradedPanels;

  bool get hasAnyData =>
      overview != null ||
      instances.isNotEmpty ||
      paperSessions.isNotEmpty ||
      backtests.isNotEmpty;

  bool get isDegraded => degradedPanels.isNotEmpty;

  /// Instances an operator should look at first.
  List<StrategyInstanceSummary> get attentionInstances => instances
      .where((StrategyInstanceSummary instance) => instance.health.needsAttention)
      .toList(growable: false);

  StrategyViewState copyWith({
    StrategyViewStatus? status,
    StrategyOverview? overview,
    List<StrategyInstanceSummary>? instances,
    List<PaperSessionSummary>? paperSessions,
    List<BacktestSummary>? backtests,
    AppException? error,
    bool? isRefreshing,
    List<String>? degradedPanels,
    bool clearError = false,
  }) {
    return StrategyViewState(
      status: status ?? this.status,
      overview: overview ?? this.overview,
      instances: instances ?? this.instances,
      paperSessions: paperSessions ?? this.paperSessions,
      backtests: backtests ?? this.backtests,
      error: clearError ? null : (error ?? this.error),
      isRefreshing: isRefreshing ?? this.isRefreshing,
      degradedPanels: degradedPanels ?? this.degradedPanels,
    );
  }

  @override
  List<Object?> get props => <Object?>[
        status,
        overview,
        instances,
        paperSessions,
        backtests,
        error,
        isRefreshing,
        degradedPanels,
      ];
}
