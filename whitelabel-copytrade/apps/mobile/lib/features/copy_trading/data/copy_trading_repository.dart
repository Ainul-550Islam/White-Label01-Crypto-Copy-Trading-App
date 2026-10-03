import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/copy_models.dart';

/// Follower-side copy trading: discover traders, subscribe, pause / resume /
/// stop, and see what was copied. Every order is placed by the server-side
/// copy pipeline (risk checked, OMS routed); nothing here submits an order.
class CopyTradingRepository {
  CopyTradingRepository({required ApiClient apiClient, required AppLogger logger})
      : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  Future<List<RankedTrader>> fetchRankings({String sortBy = 'score', String? search}) {
    return _apiClient.get<List<RankedTrader>>(
      ApiEndpoints.copyRankings,
      queryParameters: <String, Object?>{'sortBy': sortBy, 'page': 1, 'limit': 50, if (search != null && search.isNotEmpty) 'search': search},
      parser: (Object? data) => JsonRead.rows(data).map(RankedTrader.fromJson).toList(growable: false),
    );
  }

  Future<List<TraderStrategySummary>> fetchTraderStrategies(String traderId) {
    return _apiClient.get<List<TraderStrategySummary>>(
      ApiEndpoints.copyTraderStrategies(traderId),
      parser: (Object? data) => JsonRead.rows(data).map(TraderStrategySummary.fromJson).toList(growable: false),
    );
  }

  Future<List<CopySubscriptionSummary>> fetchMySubscriptions() {
    return _apiClient.get<List<CopySubscriptionSummary>>(
      ApiEndpoints.copyMySubscriptions,
      queryParameters: <String, Object?>{'page': 1, 'limit': 100},
      parser: (Object? data) => JsonRead.rows(data).map(CopySubscriptionSummary.fromJson).toList(growable: false),
    );
  }

  Future<List<CopyExecutionSummary>> fetchExecutions({int limit = 50}) {
    return _apiClient.get<List<CopyExecutionSummary>>(
      ApiEndpoints.copyExecutions,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) => JsonRead.rows(data).map(CopyExecutionSummary.fromJson).toList(growable: false),
    );
  }

  Future<CopySubscriptionSummary> subscribe(SubscribeRequest request) async {
    final String? problem = request.validate();
    if (problem != null) {
      throw ArgumentError(problem);
    }
    final CopySubscriptionSummary created = await _apiClient.post<CopySubscriptionSummary>(
      ApiEndpoints.copySubscriptions,
      body: request.toJson(),
      parser: (Object? data) => CopySubscriptionSummary.fromJson(JsonRead.map(data)),
    );
    _logger.debug('copy.subscribed', context: <String, Object?>{'mode': request.allocationMode});
    return created;
  }

  Future<void> pause(String subscriptionId) => _action(subscriptionId, 'pause');

  Future<void> resume(String subscriptionId) => _action(subscriptionId, 'resume');

  /// Stop copying. Open positions are NOT closed by this - the API stops new
  /// copies only, and the screen says so before confirming.
  Future<void> stop(String subscriptionId) => _action(subscriptionId, 'stop');

  Future<void> _action(String subscriptionId, String action) async {
    await _apiClient.post<Object?>(ApiEndpoints.copySubscriptionAction(subscriptionId, action));
    _logger.debug('copy.subscription_$action');
  }
}
