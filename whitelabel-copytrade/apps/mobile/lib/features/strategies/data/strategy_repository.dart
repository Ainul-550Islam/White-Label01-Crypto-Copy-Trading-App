import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../domain/strategy_models.dart';

/// Read-only access to the strategy layer.
///
/// This repository exposes GET requests and nothing else. There is no method
/// here to enable an instance, start a session, submit a backtest or change a
/// parameter, and that is deliberate: those operations require a written
/// reason, a permission the mobile client is not granted, and - for anything
/// touching live mode - a typed confirmation phrase. A phone in a pocket is
/// the wrong place for a control that arms a trading strategy.
///
/// The API enforces the same boundary independently. Even if a build of this
/// app tried to POST, the caller's role would have to carry
/// `strategy_instance:enable`, which the mobile role does not.
class StrategyRepository {
  StrategyRepository({
    required ApiClient apiClient,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  /// Platform counters plus the configuration flags that decide what the
  /// strategy layer is allowed to reach.
  Future<StrategyOverview> fetchOverview() async {
    final StrategyOverview overview = await _apiClient.get<StrategyOverview>(
      ApiEndpoints.strategyMetrics,
      parser: (Object? data) => StrategyOverview.fromJson(_asMap(data)),
    );

    _logger.debug('strategy.overview_loaded');
    return overview;
  }

  Future<List<StrategyInstanceSummary>> fetchInstances({int limit = 25}) async {
    return _apiClient.get<List<StrategyInstanceSummary>>(
      ApiEndpoints.strategyInstances,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) => _items(data)
          .map(StrategyInstanceSummary.fromJson)
          .toList(growable: false),
    );
  }

  Future<List<PaperSessionSummary>> fetchPaperSessions({int limit = 10}) async {
    return _apiClient.get<List<PaperSessionSummary>>(
      ApiEndpoints.paperSessions,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) =>
          _items(data).map(PaperSessionSummary.fromJson).toList(growable: false),
    );
  }

  Future<List<BacktestSummary>> fetchBacktests({int limit = 10}) async {
    return _apiClient.get<List<BacktestSummary>>(
      ApiEndpoints.backtests,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) =>
          _items(data).map(BacktestSummary.fromJson).toList(growable: false),
    );
  }

  /// Extracts `items` from the API's paginated envelope.
  ///
  /// A malformed page yields an empty list rather than throwing: a viewer
  /// screen showing "nothing to display" is better than one that crashes.
  static List<Map<String, Object?>> _items(Object? data) {
    final Map<String, Object?> map = _asMap(data);
    final Object? items = map['items'];

    if (items is! List) {
      return const <Map<String, Object?>>[];
    }

    return items
        .whereType<Map<Object?, Object?>>()
        .map(_asMap)
        .toList(growable: false);
  }

  static Map<String, Object?> _asMap(Object? value) {
    if (value is Map) {
      return value.map<String, Object?>(
        (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
      );
    }
    return const <String, Object?>{};
  }
}
