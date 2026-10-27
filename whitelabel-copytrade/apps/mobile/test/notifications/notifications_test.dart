import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/features/notifications/data/notification_repository.dart';
import 'package:wlct_mobile/features/notifications/domain/notification_models.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('fetch unread notifications and mark one read over the real repository',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => options.method == 'GET'
          ? FixtureResponse.ok(<Object?>[
              <String, Object?>{
                'id': 'notice-1',
                'title': 'Status',
                'body': 'Updated',
                'readAt': null,
              }
            ])
          : FixtureResponse.ok(null),
    );
    final NotificationRepository repo =
        NotificationRepository(apiClient: h.api, logger: h.logger);
    final List<AppNotification> rows =
        await repo.fetchNotifications(unreadOnly: true);
    expect(rows.single.isRead, isFalse);
    expect(rows.single.title, 'Status');
    expect(
      h.transport.requests.first.uri.queryParameters['unreadOnly'],
      'true',
    );
    await repo.markRead(rows.single.id);
    expect(h.transport.requests.last.method, 'PATCH');
    expect(
      h.transport.requests.last.uri.path,
      '/api/v1/notifications/notice-1/read',
    );
  });

  test('channel preference updates serialize the server contract', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(null));
    final NotificationRepository repo =
        NotificationRepository(apiClient: h.api, logger: h.logger);
    await repo.updatePreferences(<NotificationPreference>[
      const NotificationPreference(
        category: 'billing',
        channel: 'EMAIL',
        enabled: false,
      ),
    ]);
    expect(h.transport.requests.single.data, <String, Object?>{
      'preferences': <Object?>[
        <String, Object?>{
          'category': 'billing',
          'channel': 'EMAIL',
          'enabled': false,
        }
      ],
    });
    expect(
      h.transport.requests.single.uri.path,
      '/api/v1/notifications/preferences',
    );
  });
}
