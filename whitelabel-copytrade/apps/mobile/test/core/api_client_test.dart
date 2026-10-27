import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/core/storage/token_storage.dart';
import '../support/http_harness.dart';

AuthTokens tokens({bool expired = false}) {
  final DateTime now = DateTime.now().toUtc();
  return AuthTokens(
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    accessExpiresAt: now.add(Duration(minutes: expired ? -1 : 10)),
    refreshExpiresAt: now.add(const Duration(hours: 2)),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('base URL, tenant, auth and success envelope use production client',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(<String, Object?>{'value': '42'}),
    );
    await h.tokens.write(tokens());
    final Map<String, Object?> result =
        await h.api.get<Map<String, Object?>>('/test');
    expect(result['value'], '42');
    final CapturedRequest request = h.transport.requests.single;
    expect(request.uri.toString(), 'https://api.example.test/api/v1/test');
    expect(request.headers['x-tenant-slug'], 'tenant-a');
    expect(request.headers['authorization'], 'Bearer old-access');
  });

  test(
      '401 refreshes once and retries the original request with rotated tokens',
      () async {
    final HttpHarness h = HttpHarness((options) {
      if (options.path == '/auth/refresh') {
        return FixtureResponse.ok(
          session(access: 'new-access', refresh: 'new-refresh'),
        );
      }
      if (options.headers['authorization'] == 'Bearer old-access') {
        return FixtureResponse.error(401, 'UNAUTHORIZED', 'Expired');
      }
      return FixtureResponse.ok(<String, Object?>{'allowed': true});
    });
    await h.tokens.write(tokens());
    final Map<String, Object?> result =
        await h.api.get<Map<String, Object?>>('/protected');
    expect(result['allowed'], isTrue);
    expect(
        h.transport.requests.map((request) => request.uri.path).toList(),
        <String>[
          '/api/v1/protected',
          '/api/v1/auth/refresh',
          '/api/v1/protected',
        ]);
    expect(
      h.transport.requests.last.headers['authorization'],
      'Bearer new-access',
    );
    expect((await h.tokens.read())?.refreshToken, 'new-refresh');
  });

  test('failed refresh clears the session and notifies once', () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.error(401, 'UNAUTHORIZED', 'Expired'),
    );
    await h.tokens.write(tokens());
    await expectLater(
      h.api.get<Object?>('/protected'),
      throwsA(
        isA<AppException>()
            .having((e) => e.code, 'code', AppErrorCode.unauthorized),
      ),
    );
    expect(
      h.transport.requests
          .where((request) => request.uri.path.endsWith('/auth/refresh')),
      hasLength(1),
    );
    expect(await h.tokens.read(), isNull);
    expect(h.expiredCount, 1);
  });

  test(
      'error envelope retains safe code and field errors without retrying a 422',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.error(
        422,
        'VALIDATION_ERROR',
        'Invalid amount',
        details: <Object?>[
          <String, Object?>{'field': 'amount', 'message': 'Required'},
        ],
      ),
    );
    await expectLater(
      h.api.post<Object?>('/test', body: <String, String>{}),
      throwsA(
        isA<AppException>()
            .having((e) => e.code, 'code', AppErrorCode.validation)
            .having((e) => e.fieldErrors.single.field, 'field', 'amount'),
      ),
    );
    expect(h.transport.requests, hasLength(1));
  });

  test('a service failure is surfaced after bounded safe-read retries',
      () async {
    final HttpHarness h = HttpHarness(
      (options) =>
          FixtureResponse.error(503, 'SERVICE_UNAVAILABLE', 'Unavailable'),
    );
    await expectLater(
      h.api.get<Object?>('/test'),
      throwsA(
        isA<AppException>().having((e) => e.statusCode, 'status', 503),
      ),
    );
    expect(h.transport.requests, hasLength(3));
  });

  test('safe reads retry transient 503s and preserve the request', () async {
    int attempts = 0;
    final List<Duration> delays = <Duration>[];
    final HttpHarness h = HttpHarness(
      (options) {
        attempts++;
        return attempts < 3
            ? FixtureResponse.error(503, 'SERVICE_UNAVAILABLE', 'Unavailable')
            : FixtureResponse.ok(<String, Object?>{'value': 'recovered'});
      },
      waitBeforeRetry: (duration) async {
        delays.add(duration);
      },
    );
    final Map<String, Object?> result =
        await h.api.get<Map<String, Object?>>('/test');
    expect(result['value'], 'recovered');
    expect(h.transport.requests, hasLength(3));
    expect(delays, <Duration>[
      const Duration(milliseconds: 200),
      const Duration(milliseconds: 400),
    ]);
    expect(
      h.transport.requests
          .every((r) => r.method == 'GET' && r.uri.path.endsWith('/test')),
      isTrue,
    );
  });

  test('mutations are never automatically retried on transient failure',
      () async {
    final HttpHarness h = HttpHarness(
      (options) =>
          FixtureResponse.error(503, 'SERVICE_UNAVAILABLE', 'Unavailable'),
    );
    await expectLater(
      h.api.post<Object?>('/test', body: <String, String>{}),
      throwsA(isA<AppException>()),
    );
    expect(h.transport.requests, hasLength(1));
  });
}
