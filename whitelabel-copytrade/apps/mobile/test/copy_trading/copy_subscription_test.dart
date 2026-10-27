import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/features/copy_trading/data/copy_trading_repository.dart';
import 'package:wlct_mobile/features/copy_trading/domain/copy_models.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const SubscribeRequest request = SubscribeRequest(
    traderId: 'trader',
    strategyId: 'strategy',
    allocationMode: 'FIXED',
    allocationAmount: '100.00000001',
    followerAccountId: 'account',
    idempotencyKey: 'same-intent',
  );
  test('subscribe, pause, resume and stop call the real repository routes',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(<String, Object?>{
        'id': 'subscription',
        'state': 'ACTIVE',
        'allocationAmount': '100.00000001',
      }),
    );
    final CopyTradingRepository repo =
        CopyTradingRepository(apiClient: h.api, logger: h.logger);
    final CopySubscriptionSummary result = await repo.subscribe(request);
    await repo.pause(result.id);
    await repo.resume(result.id);
    await repo.stop(result.id);
    expect(result.allocationAmount, '100.00000001');
    expect(h.transport.requests.map((r) => r.uri.path).toList(), <String>[
      '/api/v1/copy-trading/subscriptions',
      '/api/v1/copy-trading/subscriptions/subscription/pause',
      '/api/v1/copy-trading/subscriptions/subscription/resume',
      '/api/v1/copy-trading/subscriptions/subscription/stop',
    ]);
    expect(
      (h.transport.requests.first.data as Map)['idempotencyKey'],
      'same-intent',
    );
  });

  test(
      'manual retry retains the same subscription intent key; errors are mapped',
      () async {
    int calls = 0;
    final HttpHarness h = HttpHarness(
      (options) => ++calls == 1
          ? FixtureResponse.error(503, 'SERVICE_UNAVAILABLE', 'Unavailable')
          : FixtureResponse.ok(
              <String, Object?>{'id': 'subscription', 'state': 'ACTIVE'},
            ),
    );
    final CopyTradingRepository repo =
        CopyTradingRepository(apiClient: h.api, logger: h.logger);
    await expectLater(
      repo.subscribe(request),
      throwsA(
        isA<AppException>().having((e) => e.statusCode, 'status', 503),
      ),
    );
    expect((await repo.subscribe(request)).id, 'subscription');
    expect(
      h.transport.requests
          .map((r) => (r.data as Map)['idempotencyKey'])
          .toList(),
      <String>['same-intent', 'same-intent'],
    );
  });

  test('invalid amount is rejected before any network request', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(null));
    final CopyTradingRepository repo =
        CopyTradingRepository(apiClient: h.api, logger: h.logger);
    const SubscribeRequest bad = SubscribeRequest(
      traderId: 't',
      strategyId: 's',
      allocationMode: 'FIXED',
      allocationAmount: '1e3',
      followerAccountId: 'a',
      idempotencyKey: 'k',
    );
    await expectLater(repo.subscribe(bad), throwsArgumentError);
    expect(h.transport.requests, isEmpty);
  });
}
