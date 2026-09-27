import 'package:equatable/equatable.dart';

import '../../../core/error/app_exception.dart';
import '../domain/risk_models.dart';

/// Loading state of the risk viewer.
enum RiskViewStatus { initial, loading, ready, failed }

/// Immutable state for the read-only risk screen.
///
/// The three panels load in parallel and a partial failure keeps whatever
/// did load: the moment someone opens this screen is a moment something is
/// already wrong somewhere, and blanking the parts that answered would
/// hide that. Only a total failure surfaces as a page-level error.
class RiskViewState extends Equatable {
  const RiskViewState({
    required this.status,
    this.mirror,
    this.switches = const <RiskSwitchInfo>[],
    this.events = const <RiskEventInfo>[],
    this.error,
    this.isRefreshing = false,
    this.degradedPanels = const <String>[],
  });

  const RiskViewState.initial() : this(status: RiskViewStatus.initial);

  final RiskViewStatus status;
  final RiskMirrorStatus? mirror;
  final List<RiskSwitchInfo> switches;
  final List<RiskEventInfo> events;

  /// Set only when nothing at all could be loaded.
  final AppException? error;

  final bool isRefreshing;

  /// Human-readable names of panels that failed while others succeeded.
  final List<String> degradedPanels;

  bool get hasAnyData =>
      mirror != null || switches.isNotEmpty || events.isNotEmpty;

  bool get isDegraded => degradedPanels.isNotEmpty;

  /// Only engaged switches matter on a phone: an idle row is for the
  /// console's history tables, and scrolling past it adds noise here.
  List<RiskSwitchInfo> get engagedSwitches => switches
      .where((RiskSwitchInfo row) => row.isEngaged)
      .toList(growable: false);

  List<RiskSwitchInfo> get triggeredSwitches => switches
      .where((RiskSwitchInfo row) => row.isTriggeredProtection)
      .toList(growable: false);

  List<RiskEventInfo> get severeEvents => events
      .where((RiskEventInfo event) => event.isSevere)
      .toList(growable: false);

  RiskViewState copyWith({
    RiskViewStatus? status,
    RiskMirrorStatus? mirror,
    List<RiskSwitchInfo>? switches,
    List<RiskEventInfo>? events,
    AppException? error,
    bool? isRefreshing,
    List<String>? degradedPanels,
    bool clearError = false,
  }) {
    return RiskViewState(
      status: status ?? this.status,
      mirror: mirror ?? this.mirror,
      switches: switches ?? this.switches,
      events: events ?? this.events,
      error: clearError ? null : (error ?? this.error),
      isRefreshing: isRefreshing ?? this.isRefreshing,
      degradedPanels: degradedPanels ?? this.degradedPanels,
    );
  }

  @override
  List<Object?> get props => <Object?>[
        status,
        mirror,
        switches,
        events,
        error,
        isRefreshing,
        degradedPanels,
      ];
}
