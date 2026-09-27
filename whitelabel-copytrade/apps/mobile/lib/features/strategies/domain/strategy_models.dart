import 'package:equatable/equatable.dart';

/// Read-only strategy view models.
///
/// The mobile client is a **viewer** for the strategy layer. It can see what
/// instances exist, whether they are healthy, and what the simulator produced.
/// It cannot create, enable, disable or configure anything, and there is no
/// model here that could be serialised back to the API as a command.
///
/// Every number that arrives as a Decimal on the server is kept as a [String].
/// Parsing money into a `double` to render it is how a UI starts disagreeing
/// with the ledger; formatting is a display concern and happens in the widget.
///
/// A metric the server withheld for insufficient observations arrives as
/// `null`. `null` is rendered as "insufficient data", never as `0`.

/// Lifecycle state of an instance, as reported by the API.
enum StrategyInstanceStatus {
  idle,
  starting,
  running,
  paused,
  stopped,
  errored,
  unknown;

  static StrategyInstanceStatus fromApi(String? value) {
    switch (value) {
      case 'IDLE':
        return StrategyInstanceStatus.idle;
      case 'STARTING':
        return StrategyInstanceStatus.starting;
      case 'RUNNING':
        return StrategyInstanceStatus.running;
      case 'PAUSED':
        return StrategyInstanceStatus.paused;
      case 'STOPPED':
        return StrategyInstanceStatus.stopped;
      case 'ERROR':
      case 'ERRORED':
        return StrategyInstanceStatus.errored;
      default:
        return StrategyInstanceStatus.unknown;
    }
  }
}

/// Operational health, reported separately from [StrategyInstanceStatus].
///
/// An instance can be enabled and unhealthy at the same time; collapsing the
/// two into one badge hides exactly the case an operator needs to see.
enum StrategyHealth {
  unknown,
  healthy,
  degraded,
  unhealthy,
  quarantined;

  static StrategyHealth fromApi(String? value) {
    switch (value) {
      case 'HEALTHY':
        return StrategyHealth.healthy;
      case 'DEGRADED':
        return StrategyHealth.degraded;
      case 'UNHEALTHY':
        return StrategyHealth.unhealthy;
      case 'QUARANTINED':
        return StrategyHealth.quarantined;
      default:
        return StrategyHealth.unknown;
    }
  }

  bool get needsAttention =>
      this == StrategyHealth.degraded ||
      this == StrategyHealth.unhealthy ||
      this == StrategyHealth.quarantined;
}

/// Status of a simulated run (backtest or paper session).
enum SimulationStatus {
  queued,
  running,
  completed,
  stopped,
  failed,
  cancelled,
  unknown;

  static SimulationStatus fromApi(String? value) {
    switch (value) {
      case 'QUEUED':
        return SimulationStatus.queued;
      case 'STARTING':
      case 'RUNNING':
        return SimulationStatus.running;
      case 'COMPLETED':
        return SimulationStatus.completed;
      case 'STOPPED':
        return SimulationStatus.stopped;
      case 'FAILED':
        return SimulationStatus.failed;
      case 'CANCELLED':
        return SimulationStatus.cancelled;
      default:
        return SimulationStatus.unknown;
    }
  }
}

String? _optionalString(Object? value) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  return null;
}

String _requiredString(Object? value, {String fallback = ''}) {
  return value is String && value.isNotEmpty ? value : fallback;
}

int _intOrZero(Object? value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value) ?? 0;
  }
  return 0;
}

bool _boolOrFalse(Object? value) => value is bool && value;

DateTime? _dateTime(Object? value) {
  if (value is String && value.isNotEmpty) {
    return DateTime.tryParse(value)?.toLocal();
  }
  return null;
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value.whereType<String>().toList(growable: false);
  }
  return const <String>[];
}

Map<String, Object?> _asMap(Object? value) {
  if (value is Map) {
    return value.map<String, Object?>(
      (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
    );
  }
  return const <String, Object?>{};
}

/// A strategy instance belonging to the caller's organisation.
class StrategyInstanceSummary extends Equatable {
  const StrategyInstanceSummary({
    required this.id,
    required this.name,
    required this.kind,
    required this.version,
    required this.status,
    required this.health,
    required this.enabled,
    required this.venue,
    required this.symbols,
    required this.consecutiveErrors,
    this.lastHeartbeatAt,
    this.lastErrorCode,
    this.quarantineReason,
  });

  factory StrategyInstanceSummary.fromJson(Map<String, Object?> json) {
    return StrategyInstanceSummary(
      id: _requiredString(json['id']),
      name: _requiredString(json['name'], fallback: 'Unnamed strategy'),
      kind: _requiredString(json['kind'], fallback: 'UNKNOWN'),
      version: _requiredString(json['version'], fallback: '0.0.0'),
      status: StrategyInstanceStatus.fromApi(json['status'] as String?),
      health: StrategyHealth.fromApi(json['health'] as String?),
      enabled: _boolOrFalse(json['enabled']),
      venue: _requiredString(json['venue'], fallback: 'UNKNOWN'),
      symbols: _stringList(json['symbols']),
      consecutiveErrors: _intOrZero(json['consecutiveErrors']),
      lastHeartbeatAt: _dateTime(json['lastHeartbeatAt']),
      lastErrorCode: _optionalString(json['lastErrorCode']),
      quarantineReason: _optionalString(json['quarantineReason']),
    );
  }

  final String id;
  final String name;
  final String kind;
  final String version;
  final StrategyInstanceStatus status;
  final StrategyHealth health;
  final bool enabled;
  final String venue;
  final List<String> symbols;
  final int consecutiveErrors;
  final DateTime? lastHeartbeatAt;
  final String? lastErrorCode;
  final String? quarantineReason;

  bool get isQuarantined => health == StrategyHealth.quarantined;

  @override
  List<Object?> get props => <Object?>[
        id,
        name,
        kind,
        version,
        status,
        health,
        enabled,
        venue,
        symbols,
        consecutiveErrors,
        lastHeartbeatAt,
        lastErrorCode,
        quarantineReason,
      ];
}

/// A paper-trading session. Every fill behind these numbers is simulated.
class PaperSessionSummary extends Equatable {
  const PaperSessionSummary({
    required this.id,
    required this.sessionIdentifier,
    required this.status,
    required this.strategyKey,
    required this.symbol,
    required this.initialCapital,
    required this.realisedPnl,
    required this.feesPaid,
    required this.simulatedOrders,
    required this.simulatedFills,
    required this.riskRejections,
    required this.isSimulated,
    required this.startedAt,
    this.currentEquity,
    this.unrealisedPnl,
    this.maxDrawdown,
    this.stoppedAt,
  });

  factory PaperSessionSummary.fromJson(Map<String, Object?> json) {
    return PaperSessionSummary(
      id: _requiredString(json['id']),
      sessionIdentifier: _requiredString(json['sessionIdentifier']),
      status: SimulationStatus.fromApi(json['status'] as String?),
      strategyKey: _requiredString(json['strategyKey'], fallback: 'UNKNOWN'),
      symbol: _requiredString(json['symbol'], fallback: '—'),
      initialCapital: _requiredString(json['initialCapital'], fallback: '0'),
      realisedPnl: _requiredString(json['realisedPnl'], fallback: '0'),
      feesPaid: _requiredString(json['feesPaid'], fallback: '0'),
      simulatedOrders: _intOrZero(json['simulatedOrders']),
      simulatedFills: _intOrZero(json['simulatedFills']),
      riskRejections: _intOrZero(json['riskRejections']),
      // Defaults to true. If the label is ever missing from a payload the safe
      // reading is "simulated", not "real".
      isSimulated: json['isSimulated'] is bool ? json['isSimulated']! as bool : true,
      startedAt: _dateTime(json['startedAt']),
      currentEquity: _optionalString(json['currentEquity']),
      unrealisedPnl: _optionalString(json['unrealisedPnl']),
      maxDrawdown: _optionalString(json['maxDrawdown']),
      stoppedAt: _dateTime(json['stoppedAt']),
    );
  }

  final String id;
  final String sessionIdentifier;
  final SimulationStatus status;
  final String strategyKey;
  final String symbol;
  final String initialCapital;
  final String realisedPnl;
  final String feesPaid;
  final int simulatedOrders;
  final int simulatedFills;
  final int riskRejections;
  final bool isSimulated;
  final DateTime? startedAt;
  final String? currentEquity;
  final String? unrealisedPnl;
  final String? maxDrawdown;
  final DateTime? stoppedAt;

  @override
  List<Object?> get props => <Object?>[
        id,
        sessionIdentifier,
        status,
        strategyKey,
        symbol,
        initialCapital,
        realisedPnl,
        feesPaid,
        simulatedOrders,
        simulatedFills,
        riskRejections,
        isSimulated,
        startedAt,
        currentEquity,
        unrealisedPnl,
        maxDrawdown,
        stoppedAt,
      ];
}

/// A completed or in-flight backtest, flattened for a phone-sized card.
class BacktestSummary extends Equatable {
  const BacktestSummary({
    required this.id,
    required this.runIdentifier,
    required this.status,
    required this.strategyKey,
    required this.strategyVersion,
    required this.symbol,
    required this.totalTrades,
    required this.hasSufficientObservations,
    required this.isReproducible,
    required this.queuedAt,
    this.netPnl,
    this.totalReturnPercent,
    this.maxDrawdownPercent,
    this.winRate,
    this.sharpeRatio,
    this.completedAt,
  });

  factory BacktestSummary.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> result = _asMap(json['result']);

    return BacktestSummary(
      id: _requiredString(json['id']),
      runIdentifier: _requiredString(json['runIdentifier']),
      status: SimulationStatus.fromApi(json['status'] as String?),
      strategyKey: _requiredString(json['strategyKey'], fallback: 'UNKNOWN'),
      strategyVersion: _requiredString(json['strategyVersion'], fallback: '0.0.0'),
      symbol: _requiredString(json['symbol'], fallback: '—'),
      totalTrades: _intOrZero(result['totalTrades']),
      hasSufficientObservations: _boolOrFalse(result['hasSufficientObservations']),
      isReproducible: _boolOrFalse(json['isReproducible']),
      queuedAt: _dateTime(json['queuedAt']),
      netPnl: _optionalString(result['netPnl']),
      totalReturnPercent: _optionalString(result['totalReturnPercent']),
      maxDrawdownPercent: _optionalString(result['maxDrawdownPercent']),
      winRate: _optionalString(result['winRate']),
      sharpeRatio: _optionalString(result['sharpeRatio']),
      completedAt: _dateTime(json['completedAt']),
    );
  }

  final String id;
  final String runIdentifier;
  final SimulationStatus status;
  final String strategyKey;
  final String strategyVersion;
  final String symbol;
  final int totalTrades;

  /// False when the run had too few observations for risk-adjusted metrics.
  /// The affected fields arrive as `null` and must not be shown as zero.
  final bool hasSufficientObservations;

  final bool isReproducible;
  final DateTime? queuedAt;
  final String? netPnl;
  final String? totalReturnPercent;
  final String? maxDrawdownPercent;
  final String? winRate;
  final String? sharpeRatio;
  final DateTime? completedAt;

  @override
  List<Object?> get props => <Object?>[
        id,
        runIdentifier,
        status,
        strategyKey,
        strategyVersion,
        symbol,
        totalTrades,
        hasSufficientObservations,
        isReproducible,
        queuedAt,
        netPnl,
        totalReturnPercent,
        maxDrawdownPercent,
        winRate,
        sharpeRatio,
        completedAt,
      ];
}

/// Counters and the platform's current strategy configuration.
class StrategyOverview extends Equatable {
  const StrategyOverview({
    required this.totalInstances,
    required this.enabledInstances,
    required this.runningInstances,
    required this.quarantinedInstances,
    required this.unhealthyInstances,
    required this.openIncidents,
    required this.criticalIncidents,
    required this.runningPaperSessions,
    required this.queuedBacktests,
    required this.strategyEngineEnabled,
    required this.paperTradingEnabled,
    required this.backtestEnabled,
    required this.tradingMode,
    required this.liveExecutionReachable,
    required this.latencyNote,
    required this.disclaimer,
  });

  factory StrategyOverview.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> instances = _asMap(json['instances']);
    final Map<String, Object?> incidents = _asMap(json['incidents']);
    final Map<String, Object?> sessions = _asMap(json['paperSessions']);
    final Map<String, Object?> backtests = _asMap(json['backtests']);
    final Map<String, Object?> configuration = _asMap(json['configuration']);

    return StrategyOverview(
      totalInstances: _intOrZero(instances['total']),
      enabledInstances: _intOrZero(instances['enabled']),
      runningInstances: _intOrZero(instances['running']),
      quarantinedInstances: _intOrZero(instances['quarantined']),
      unhealthyInstances: _intOrZero(instances['unhealthy']),
      openIncidents: _intOrZero(incidents['open']),
      criticalIncidents: _intOrZero(incidents['critical']),
      runningPaperSessions: _intOrZero(sessions['running']),
      queuedBacktests: _intOrZero(backtests['queued']),
      strategyEngineEnabled: _boolOrFalse(configuration['strategyEngineEnabled']),
      paperTradingEnabled: _boolOrFalse(configuration['paperTradingEnabled']),
      backtestEnabled: _boolOrFalse(configuration['backtestEnabled']),
      tradingMode: _requiredString(configuration['tradingMode'], fallback: 'UNKNOWN'),
      liveExecutionReachable: _boolOrFalse(configuration['liveExecutionReachable']),
      latencyNote: _requiredString(json['latencyNote']),
      disclaimer: _requiredString(json['disclaimer']),
    );
  }

  final int totalInstances;
  final int enabledInstances;
  final int runningInstances;
  final int quarantinedInstances;
  final int unhealthyInstances;
  final int openIncidents;
  final int criticalIncidents;
  final int runningPaperSessions;
  final int queuedBacktests;
  final bool strategyEngineEnabled;
  final bool paperTradingEnabled;
  final bool backtestEnabled;
  final String tradingMode;

  /// Whether a signal could, in this deployment, become a real order.
  final bool liveExecutionReachable;

  final String latencyNote;
  final String disclaimer;

  @override
  List<Object?> get props => <Object?>[
        totalInstances,
        enabledInstances,
        runningInstances,
        quarantinedInstances,
        unhealthyInstances,
        openIncidents,
        criticalIncidents,
        runningPaperSessions,
        queuedBacktests,
        strategyEngineEnabled,
        paperTradingEnabled,
        backtestEnabled,
        tradingMode,
        liveExecutionReachable,
        latencyNote,
        disclaimer,
      ];
}
