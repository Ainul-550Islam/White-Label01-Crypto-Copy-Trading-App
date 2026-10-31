// # Responsibility: pins that fee rates stay decimal strings end to end and that the percentage shown is produced by shifting digits, never by multiplying by 100 as a double.
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/features/fee_schedule/data/fee_schedule_repository.dart';
import 'package:wlct_mobile/features/fee_schedule/domain/fee_schedule_models.dart';

import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const Map<String, Object?> schedule = <String, Object?>{
    'version': 4,
    'managementFeeRate': '0.0025',
    'profitShareRate': '0.20',
    'currency': 'USDT',
    'source': 'tenant_override',
    'effectiveFrom': '2026-09-01T00:00:00.000Z',
    'effectiveUntil': null,
    'versions': <Object?>[
      <String, Object?>{
        'version': 4,
        'managementFeeRate': '0.0025',
        'profitShareRate': '0.20',
        'currency': 'USDT',
        'effectiveFrom': '2026-09-01T00:00:00.000Z',
      },
      <String, Object?>{
        'version': 3,
        'managementFeeRate': '0.0100',
        'profitShareRate': '0.15',
        'currency': 'USDT',
        'effectiveFrom': '2026-06-01T00:00:00.000Z',
        'effectiveUntil': '2026-09-01T00:00:00.000Z',
      },
    ],
  };

  test('reads the public schedule without authentication and keeps rates as strings', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(schedule));
    final FeeSchedule fee = await FeeScheduleRepository(apiClient: h.api).fetchEffectiveSchedule();

    final CapturedRequest sent = h.transport.requests.single;
    expect(sent.method, 'GET');
    expect(sent.uri.path, '/api/v1/public/fee-schedule');
    // Pricing is public: no bearer token is required or attached for this call.
    expect(sent.headers.containsKey('Authorization'), isFalse);

    expect(fee.version, 4);
    expect(fee.managementFeeRate, '0.0025');
    expect(fee.profitShareRate, '0.20');
    expect(fee.currency, 'USDT');
    expect(fee.source, 'tenant_override');
    expect(fee.isTenantOverride, isTrue);
    expect(fee.effectiveFrom, isNotNull);
    expect(fee.effectiveUntil, isNull);

    expect(fee.versions, hasLength(2));
    expect(fee.versions[1].managementFeeRate, '0.0100');
    expect(fee.versions[1].effectiveUntil, isNotNull);
  });

  test('the published rate is never parsed into a number', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(schedule));
    final FeeSchedule fee = await FeeScheduleRepository(apiClient: h.api).fetchEffectiveSchedule();

    // 0.0025 as a double is 0.002499999999999999946717673975726057434081...; the
    // model must hand the screen the exact string, and the string must survive
    // untouched — no trailing-zero stripping, no rounding.
    expect(fee.managementFeeRate, isA<String>());
    expect(fee.managementFeeRate.length, 6);
    expect(fee.managementFeeRate, '0.0025');
    expect(fee.managementFeeRate, isNot('0.0025'.replaceAll('0', '')));
  });

  test('formatting shifts digits instead of multiplying', () {
    const Map<String, String> cases = <String, String>{
      '0.0025': '0.25 %',
      '0.20': '20 %',
      '0.2': '20 %',
      '0.15': '15 %',
      '1': '100 %',
      '1.00': '100 %',
      '0.0001': '0.01 %',
      '0.125': '12.5 %',
      '0': '0 %',
      '0.0100': '1 %',
      '12.5': '1250 %',
    };
    cases.forEach((String rate, String expected) {
      expect(formatRatePercent(rate), expected, reason: rate);
    });
  });

  test('a non-decimal rate is shown as sent rather than guessed at', () {
    for (final String rate in <String>['', 'n/a', '-0.5', '1e-4', '.5', '00.5']) {
      expect(formatRatePercent(rate), rate, reason: rate);
    }
  });

  test('the model has no double-typed money field', () {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(schedule));
    // Compile-time proof: these are String, so a `double` never enters the path.
    final FeeSchedule fee = FeeSchedule.fromJson(schedule);
    expect(fee.managementFeeRate, isA<String>());
    expect(fee.profitShareRate, isA<String>());
    expect(fee.versions.every((FeeScheduleVersion v) => v.managementFeeRate is String), isTrue);
    expect(h.transport.requests, isEmpty); // parsing alone touches no network
  });

  test('a missing schedule degrades to empty strings, not to a zero fee', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(<String, Object?>{}));
    final FeeSchedule fee = await FeeScheduleRepository(apiClient: h.api).fetchEffectiveSchedule();
    expect(fee.managementFeeRate, '');
    expect(fee.profitShareRate, '');
    expect(fee.version, 0);
    expect(fee.versions, isEmpty);
    // An absent rate is not shown as "0 %", which would read as free.
    expect(formatRatePercent(fee.managementFeeRate), '');
  });

  test('a 404 for an unpublished schedule is a not-found error, not an empty schedule', () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.error(404, 'NOT_FOUND', 'No fee schedule is published'),
    );
    await expectLater(
      FeeScheduleRepository(apiClient: h.api).fetchEffectiveSchedule(),
      throwsA(
        isA<AppException>()
            .having((AppException e) => e.code, 'code', AppErrorCode.notFound)
            .having((AppException e) => e.message, 'message', contains('fee schedule')),
      ),
    );
  });
}
