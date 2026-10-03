import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/json_read.dart';
import '../domain/notification_models.dart';

/// In-app notifications: list, unread count, mark read, mark all read and
/// channel preferences. Titles/bodies are never logged (they can carry
/// account detail); only ids and counts are.
class NotificationRepository {
  NotificationRepository({required ApiClient apiClient, required AppLogger logger})
      : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  Future<List<AppNotification>> fetchNotifications({bool unreadOnly = false, int limit = 50}) {
    return _apiClient.get<List<AppNotification>>(
      ApiEndpoints.notifications,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit, if (unreadOnly) 'unreadOnly': true},
      parser: (Object? data) => JsonRead.rows(data).map(AppNotification.fromJson).toList(growable: false),
    );
  }

  Future<int> fetchUnreadCount() {
    return _apiClient.get<int>(
      ApiEndpoints.notificationUnreadCount,
      parser: (Object? data) => JsonRead.integer(JsonRead.map(data), 'unread'),
    );
  }

  Future<void> markRead(String id) async {
    await _apiClient.patch<Object?>(ApiEndpoints.markNotificationRead(id));
  }

  Future<void> markAllRead() async {
    await _apiClient.post<Object?>(ApiEndpoints.notificationsReadAll);
    _logger.debug('notifications.all_read');
  }

  Future<List<NotificationPreference>> fetchPreferences() {
    return _apiClient.get<List<NotificationPreference>>(
      ApiEndpoints.notificationPreferences,
      parser: (Object? data) {
        final Object? rows = data is Map ? (data['preferences'] ?? data) : data;
        return JsonRead.rows(rows).map(NotificationPreference.fromJson).toList(growable: false);
      },
    );
  }

  Future<void> updatePreferences(List<NotificationPreference> preferences) async {
    await _apiClient.patch<Object?>(
      ApiEndpoints.notificationPreferences,
      body: <String, Object?>{'preferences': preferences.map((NotificationPreference p) => p.toJson()).toList()},
    );
  }
}
