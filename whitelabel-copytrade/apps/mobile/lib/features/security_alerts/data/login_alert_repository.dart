// # Responsibility: reads the caller's own sign-in security events through the shared ApiClient, filtering by the event types that constitute a sign-in alert and never requesting another user's events.
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/login_alert_models.dart';

/// Sign-in alerts from the phone: read-only.
///
/// `GET /v1/security/events` answers `{ data, total, page, limit }` and the
/// controller scopes the query to the caller's tenant; passing `userId` for anyone
/// but the caller is refused there with 403, so this client never sends one — the
/// API already narrows to the authenticated user when the parameter is absent on a
/// non-privileged session, and a customer holding `security:event:read` for their
/// own account sees only their own rows.
///
/// There is no acknowledge call, because the API has none for a customer: an
/// "acknowledge" button would post to a route that does not exist. Resolving a
/// security event is an operator action (`POST security/threats/:id/resolve` with a
/// written resolution), and it stays in the console.
class LoginAlertRepository {
  LoginAlertRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<List<LoginAlert>> fetchAlerts({
    String? type,
    String? severity,
    int page = 1,
    int limit = 50,
  }) {
    return _apiClient.get<List<LoginAlert>>(
      ApiEndpoints.securityEvents,
      queryParameters: <String, Object?>{
        'page': page,
        'limit': limit,
        if (type != null && type.isNotEmpty) 'type': type,
        if (severity != null && severity.isNotEmpty) 'severity': severity,
      },
      parser: (Object? data) => JsonRead.rows(data).map(LoginAlert.fromJson).toList(growable: false),
    );
  }
}
