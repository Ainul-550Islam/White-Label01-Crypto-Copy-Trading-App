import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../domain/risk_models.dart';

/// Read-only access to the risk layer.
///
/// This repository exposes GET requests and nothing else, and that is
/// load-bearing: the mobile client is a viewer. Engaging or clearing a
/// switch requires a written reason and, for a triggered protection, a
/// typed confirmation phrase - an interaction shape the admin console
/// carries and a phone deliberately does not. There is no method here that
/// could PUT a limit or POST a halt even if a build were tampered with;
/// the API separately requires `risk:read` and refuses every write this
/// role cannot make.
///
/// Everything served through here is mirrored state, timestamped as such.
/// The screen never presents these numbers as a live venue read, because
/// the API does not perform one for this route.
class RiskRepository {
  RiskRepository({
    required ApiClient apiClient,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  /// The deployment posture: engine config, mirror freshness, active halts.
  Future<RiskMirrorStatus> fetchStatus() async {
    final RiskMirrorStatus status = await _apiClient.get<RiskMirrorStatus>(
      ApiEndpoints.riskStatus,
      parser: (Object? data) => RiskMirrorStatus.fromJson(_asMap(data)),
    );

    _logger.debug('risk.status_loaded');
    return status;
  }

  /// All kill switches visible to the organisation. The endpoint answers
  /// with a bare array (bounded server-side); a malformed payload degrades
  /// to empty rather than throwing - a viewer screen that shows "nothing"
  /// beats one that crashes, and the admin console is where truth is chased.
  Future<List<RiskSwitchInfo>> fetchSwitches() async {
    final List<RiskSwitchInfo> switches =
        await _apiClient.get<List<RiskSwitchInfo>>(
      ApiEndpoints.riskKillSwitches,
      parser: (Object? data) {
        if (data is! List) {
          return const <RiskSwitchInfo>[];
        }
        return data
            .whereType<Map<Object?, Object?>>()
            .map((Map<Object?, Object?> row) =>
                RiskSwitchInfo.fromJson(_asMap(row)))
            .toList(growable: false);
      },
    );

    return switches;
  }

  /// The newest risk events, live-path only (simulated rows are filtered
  /// server-side unless explicitly requested, and this client never
  /// requests them into the same feed).
  Future<List<RiskEventInfo>> fetchEvents({int limit = 25}) async {
    return _apiClient.get<List<RiskEventInfo>>(
      ApiEndpoints.riskEvents,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) {
        final Map<String, Object?> map = _asMap(data);
        final Object? items = map['items'];
        if (items is! List) {
          return const <RiskEventInfo>[];
        }
        return items
            .whereType<Map<Object?, Object?>>()
            .map((Map<Object?, Object?> row) =>
                RiskEventInfo.fromJson(_asMap(row)))
            .toList(growable: false);
      },
    );
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
