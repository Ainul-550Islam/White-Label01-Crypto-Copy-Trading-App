// # Responsibility: pins the sign-in alert read path — the caller's own events only, the filter reaching the query string, and the absence of any write the API does not offer.
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/features/security_alerts/data/login_alert_repository.dart';
import 'package:wlct_mobile/features/security_alerts/domain/login_alert_models.dart';

import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const Map<String, Object?> page = <String, Object?>{
    'data': <Object?>[
      <String, Object?>{
        'id': 'evt-1',
        'type': 'SUSPICIOUS_LOGIN',
        'severity': 'HIGH',
        'createdAt': '2026-10-29T22:41:00.000Z',
        'userId': 'user-1',
        'ipHash': 'sha256:abc',
        'deviceId': 'device-9',
        'userAgent': 'Firefox/128',
      },
      <String, Object?>{
        'id': 'evt-2',
        'type': 'LOGIN_SUCCESS',
        'severity': 'LOW',
        'createdAt': '2026-10-30T07:02:00.000Z',
        'userId': 'user-1',
      },
    ],
    'total': 2,
    'page': 1,
    'limit': 50,
  };

  test('reads the caller\'s own events and classifies severity without inventing fields', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(page));
    final List<LoginAlert> alerts = await LoginAlertRepository(apiClient: h.api).fetchAlerts();

    expect(h.transport.requests.single.uri.path, '/api/v1/security/events');
    expect(h.transport.requests.single.method, 'GET');

    expect(alerts, hasLength(2));
    expect(alerts[0].id, 'evt-1');
    expect(alerts[0].type, SecurityEventTypes.suspiciousLogin);
    expect(alerts[0].isSuspicious, isTrue);
    expect(alerts[0].isHighSeverity, isTrue);
    expect(alerts[0].createdAt, isNotNull);
    expect(alerts[0].ipHash, 'sha256:abc');
    expect(alerts[0].deviceId, 'device-9');

    expect(alerts[1].isSuspicious, isFalse);
    expect(alerts[1].isHighSeverity, isFalse);
    expect(alerts[1].deviceId, isNull);
  });

  test('sends paging and the chosen type, and never sends another user id', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(page));
    await LoginAlertRepository(apiClient: h.api).fetchAlerts(type: SecurityEventTypes.loginFailure);

    final Uri uri = h.transport.requests.single.uri;
    expect(uri.queryParameters['type'], 'LOGIN_FAILURE');
    expect(uri.queryParameters['page'], '1');
    expect(uri.queryParameters['limit'], '50');
    // Scoping is the API's job (tenantId + caller). Sending a userId from the phone
    // would be a permission probe, and the controller refuses it with 403 anyway.
    expect(uri.queryParameters.containsKey('userId'), isFalse);
  });

  test('an empty type omits the filter rather than sending type=', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(page));
    await LoginAlertRepository(apiClient: h.api).fetchAlerts(type: '');
    expect(h.transport.requests.single.uri.queryParameters.containsKey('type'), isFalse);
  });

  test('a bare array is accepted and a missing envelope degrades to an empty list', () async {
    final HttpHarness array = HttpHarness((options) => FixtureResponse.ok(<Object?>[
      <String, Object?>{'id': 'evt-3', 'type': 'NEW_DEVICE_LOGIN', 'severity': 'MEDIUM'},
    ]));
    final List<LoginAlert> rows = await LoginAlertRepository(apiClient: array.api).fetchAlerts();
    expect(rows.single.isNewDevice, isTrue);
    expect(rows.single.createdAt, isNull);

    final HttpHarness nothing = HttpHarness((options) => FixtureResponse.ok(<String, Object?>{'total': 0}));
    expect(await LoginAlertRepository(apiClient: nothing.api).fetchAlerts(), isEmpty);
  });

  test('permission denial propagates as a forbidden domain error', () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.error(403, 'FORBIDDEN', 'You do not have permission to do that.'),
    );
    await expectLater(
      LoginAlertRepository(apiClient: h.api).fetchAlerts(),
      throwsA(
        isA<AppException>()
            .having((AppException e) => e.code, 'code', AppErrorCode.forbidden)
            .having((AppException e) => e.message, 'message', contains('permission')),
      ),
    );
  });
}
