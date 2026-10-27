import '../../../core/error/app_exception.dart';
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
      parser: (Object? data) {
        final Map<String, Object?> row = _requiredMap(data);
        if (row['engineEnabled'] is! bool ||
            row['failClosed'] is! bool ||
            row['refreshOutpacesStaleness'] is! bool ||
            !_nonNegativeInt(row['maxRiskStateAgeMs']) ||
            !_nonNegativeInt(row['snapshotRefreshMs']) ||
            !_nonNegativeInt(row['engagedSwitchCount']) ||
            !_nonNegativeInt(row['triggeredProtectionCount']) ||
            !_stringList(row['staleAccounts']) ||
            row['latestSnapshotPerAccount'] is! List ||
            row['eventsLast24hBySeverity'] is! Map) {
          throw _unexpected;
        }
        final List<Object?> snapshots =
            row['latestSnapshotPerAccount'] as List<Object?>;
        for (final Object? item in snapshots) {
          final Map<String, Object?> snapshot = _requiredMap(item);
          if (!_nonEmptyString(snapshot['accountId']) ||
              !_nonEmptyString(snapshot['snapshotVersion']) ||
              !_nonEmptyString(snapshot['capturedAt']) ||
              snapshot['isSimulated'] is! bool ||
              !_nonNegativeInt(snapshot['openOrderCount']) ||
              !_stringList(snapshot['staleSources'])) {
            throw _unexpected;
          }
        }
        final Map<String, Object?> severity =
            _requiredMap(row['eventsLast24hBySeverity']);
        if (severity.values.any((Object? value) => !_nonNegativeInt(value))) {
          throw _unexpected;
        }
        return RiskMirrorStatus.fromJson(row);
      },
    );

    _logger.debug('risk.status_loaded');
    return status;
  }

  /// Engaged kill switches visible to the organisation. The API bounds the
  /// list at 100; the status count exposes possible truncation. A malformed
  /// response is unavailable evidence, never an empty/healthy result.
  Future<List<RiskSwitchInfo>> fetchSwitches() async {
    final List<RiskSwitchInfo> switches =
        await _apiClient.get<List<RiskSwitchInfo>>(
      ApiEndpoints.riskKillSwitches,
      queryParameters: <String, Object?>{'engagedOnly': true},
      parser: (Object? data) {
        if (data is! List) throw _unexpected;
        return data.map((Object? value) {
          final Map<String, Object?> row = _requiredMap(value);
          if (!_nonEmptyString(row['id']) ||
              !_nonEmptyString(row['scope']) ||
              row['isEngaged'] != true ||
              !_nonEmptyString(row['status']) ||
              row['requiresExplicitClear'] is! bool) {
            throw _unexpected;
          }
          return RiskSwitchInfo.fromJson(row);
        }).toList(growable: false);
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
        final Map<String, Object?> map = _requiredMap(data);
        final Object? items = map['items'];
        if (items is! List) throw _unexpected;
        return items.map((Object? value) {
          final Map<String, Object?> row = _requiredMap(value);
          if (!_nonEmptyString(row['id']) ||
              !_nonEmptyString(row['eventType']) ||
              !_nonEmptyString(row['severity']) ||
              row['message'] is! String ||
              row['isSimulated'] != false ||
              !_nonEmptyString(row['createdAt'])) {
            throw _unexpected;
          }
          return RiskEventInfo.fromJson(row);
        }).toList(growable: false);
      },
    );
  }

  static const AppException _unexpected = AppException(
    code: AppErrorCode.unknown,
    message: 'The server returned an unexpected response.',
  );

  static bool _nonEmptyString(Object? value) =>
      value is String && value.isNotEmpty;
  static bool _nonNegativeInt(Object? value) => value is int && value >= 0;
  static bool _stringList(Object? value) =>
      value is List && value.every((Object? item) => item is String);

  static Map<String, Object?> _requiredMap(Object? value) {
    if (value is! Map) throw _unexpected;
    return value.map<String, Object?>(
      (Object? key, Object? item) =>
          MapEntry<String, Object?>(key.toString(), item),
    );
  }
}
