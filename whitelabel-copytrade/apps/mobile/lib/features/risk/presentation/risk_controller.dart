import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../data/risk_repository.dart';
import '../domain/risk_models.dart';
import 'risk_state.dart';

/// Drives the read-only risk screen.
///
/// Like the strategy controller, this class exposes exactly two operations -
/// [load] and [refresh] - and no mutation, deliberately: "acknowledge" and
/// "clear" are API routes behind permissions this client is not granted, and
/// a phone must never become the place where a triggered protection is
/// disarmed between notifications. If this controller ever grows a third
/// public method, stop and re-read the Part 8 brief.
class RiskController extends StateNotifier<RiskViewState> {
  RiskController({required RiskRepository repository, required AppLogger logger})
      : _repository = repository,
        _logger = logger,
        super(const RiskViewState.initial());

  final RiskRepository _repository;
  final AppLogger _logger;

  Future<void> load() => _fetch(isRefresh: false);

  Future<void> refresh() => _fetch(isRefresh: true);

  Future<void> _fetch({required bool isRefresh}) async {
    if (state.isRefreshing) {
      return;
    }

    state = state.copyWith(
      status: isRefresh ? state.status : RiskViewStatus.loading,
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
          'risk.panel_failed',
          context: <String, Object?>{'panel': panel, 'code': error.code.name},
        );
        return null;
      }
    }

    final List<Object?> results = await Future.wait<Object?>(<Future<Object?>>[
      attempt<RiskMirrorStatus>('status', _repository.fetchStatus),
      attempt<List<RiskSwitchInfo>>('switches', _repository.fetchSwitches),
      attempt<List<RiskEventInfo>>('events', _repository.fetchEvents),
    ]);

    final RiskMirrorStatus? mirror = results[0] as RiskMirrorStatus?;
    final List<RiskSwitchInfo>? switches = results[1] as List<RiskSwitchInfo>?;
    final List<RiskEventInfo>? events = results[2] as List<RiskEventInfo>?;

    final bool everythingFailed = degraded.length == results.length;

    if (everythingFailed) {
      state = state.copyWith(
        status: RiskViewStatus.failed,
        isRefreshing: false,
        error: lastFailure,
        degradedPanels: const <String>[],
      );
      return;
    }

    state = RiskViewState(
      status: RiskViewStatus.ready,
      // A panel that failed keeps its previous content rather than blanking.
      mirror: mirror ?? state.mirror,
      switches: switches ?? state.switches,
      events: events ?? state.events,
      isRefreshing: false,
      degradedPanels: List<String>.unmodifiable(degraded),
    );
  }
}
