import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/di/feature_providers.dart';
import 'package:wlct_mobile/features/funding/presentation/funding_screen.dart';
import 'package:wlct_mobile/l10n/app_localizations.dart';
import 'package:wlct_mobile/features/funding/data/funding_repository.dart';
import 'package:wlct_mobile/features/funding/domain/funding_models.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const FundingAccountSummary account = FundingAccountSummary(
    id: 'acct',
    accountType: 'CASH',
    state: 'ACTIVE',
    isFundingEnabled: true,
    isWithdrawalEnabled: false,
  );
  test(
      'request deposit preserves decimal strings and does not claim confirmation',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(<String, Object?>{
        'id': 'request',
        'accountId': 'acct',
        'state': 'REQUESTED',
        'requestedAmount': '123456789.00000001',
        'currency': 'USD',
      }),
    );
    final FundingRepository repo =
        FundingRepository(apiClient: h.api, logger: h.logger);
    final FundingRequestSummary result = await repo.requestDeposit(
      account: account,
      amount: ' 123456789.00000001 ',
      currency: 'usd',
      externalReference: 'bank-ref',
    );
    expect(result.requestedAmount, '123456789.00000001');
    expect(result.isOpen, isTrue);
    expect(result.isConfirmed, isFalse);
    expect(
      (h.transport.requests.single.data as Map)['requestedAmount'],
      '123456789.00000001',
    );
    expect((h.transport.requests.single.data as Map)['currency'], 'USD');
    expect((h.transport.requests.single.data as Map)['externalReference'],
        'bank-ref',);
  });

  test(
      'uncertain deposit retries reuse the same mutation key until a matching acknowledgement',
      () async {
    int calls = 0;
    final HttpHarness h = HttpHarness((_) {
      calls++;
      if (calls == 1) {
        return FixtureResponse.error(503, 'UNAVAILABLE', 'backend detail');
      }
      return FixtureResponse.ok(<String, Object?>{
        'id': 'request',
        'accountId': 'acct',
        'state': 'REQUESTED',
        'requestedAmount': '1.25000001',
        'currency': 'USD',
      });
    });
    final FundingRepository repo =
        FundingRepository(apiClient: h.api, logger: h.logger);
    await expectLater(
        repo.requestDeposit(
            account: account,
            amount: '1.25000001',
            currency: 'USD',
            externalReference: 'bank-ref',),
        throwsA(anything),);
    expect(
        (await repo.requestDeposit(
                account: account,
                amount: '1.25000001',
                currency: 'USD',
                externalReference: 'bank-ref',))
            .id,
        'request',);
    expect(h.transport.requests[0].headers['Idempotency-Key'], isNotEmpty);
    expect(h.transport.requests[1].headers['Idempotency-Key'],
        h.transport.requests[0].headers['Idempotency-Key'],);
  });

  test(
      'malformed deposit acknowledgement is not success and keeps the key for retry',
      () async {
    int calls = 0;
    final HttpHarness h = HttpHarness((_) {
      calls++;
      return FixtureResponse.ok(<String, Object?>{
        'id': 'request',
        'accountId': 'acct',
        'state': 'REQUESTED',
        'requestedAmount': calls == 1 ? '2' : '1',
        'currency': 'USD',
      });
    });
    final FundingRepository repo =
        FundingRepository(apiClient: h.api, logger: h.logger);
    await expectLater(
        repo.requestDeposit(
            account: account,
            amount: '1',
            currency: 'USD',
            externalReference: 'bank-ref',),
        throwsFormatException,);
    expect(
        (await repo.requestDeposit(
                account: account,
                amount: '1',
                currency: 'USD',
                externalReference: 'bank-ref',))
            .requestedAmount,
        '1',);
    expect(h.transport.requests[1].headers['Idempotency-Key'],
        h.transport.requests[0].headers['Idempotency-Key'],);
  });

  test('invalid amount or disabled account is rejected locally', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(null));
    final FundingRepository repo =
        FundingRepository(apiClient: h.api, logger: h.logger);
    const FundingAccountSummary disabled = FundingAccountSummary(
      id: 'acct',
      accountType: 'CASH',
      state: 'SUSPENDED',
      isFundingEnabled: true,
      isWithdrawalEnabled: false,
    );
    await expectLater(
      repo.requestDeposit(
          account: account,
          amount: '0.00',
          currency: 'USD',
          externalReference: 'bank-ref',),
      throwsArgumentError,
    );
    await expectLater(
      repo.requestDeposit(
          account: disabled,
          amount: '1',
          currency: 'USD',
          externalReference: 'bank-ref',),
      throwsArgumentError,
    );
    await expectLater(
      repo.requestDeposit(
          account: account,
          amount: '1',
          currency: 'USD',
          externalReference: '  ',),
      throwsArgumentError,
    );
    expect(h.transport.requests, isEmpty);
  });

  testWidgets(
      'deposit form requires a reference before submitting through the real repository',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness((options) {
      if (options.path.endsWith('/accounts')) {
        return FixtureResponse.ok(<String, Object?>{
          'data': <Object?>[
            <String, Object?>{
              'id': 'acct',
              'accountType': 'CASH',
              'state': 'ACTIVE',
              'isFundingEnabled': true,
              'isWithdrawalEnabled': false,
            }
          ],
        });
      }
      if (options.method == 'POST' && options.path.endsWith('/funding')) {
        return FixtureResponse.ok(<String, Object?>{
          'id': 'request',
          'accountId': 'acct',
          'state': 'REQUESTED',
          'requestedAmount': '1.25',
          'currency': 'USDT',
        });
      }
      return FixtureResponse.ok(<String, Object?>{'data': <Object?>[]});
    });
    final FundingRepository repo =
        FundingRepository(apiClient: h.api, logger: h.logger);
    await tester.pumpWidget(ProviderScope(
      overrides: <Override>[fundingRepositoryProvider.overrideWithValue(repo)],
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: FundingScreen(),
      ),
    ),);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Deposit').first);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).at(0), '1.25');
    expect(find.text('Transfer reference (required)'), findsOneWidget);
    await tester.tap(find.text('Request deposit').last);
    await tester.pumpAndSettle();
    expect(find.text('Enter your transfer reference.'), findsOneWidget);
    expect(h.transport.requests.where((r) => r.method == 'POST'), isEmpty);
    await tester.enterText(find.byType(TextFormField).at(2), 'bank-ref');
    await tester.tap(find.text('Request deposit').last);
    await tester.pumpAndSettle();
    final CapturedRequest request =
        h.transport.requests.firstWhere((r) => r.method == 'POST');
    expect((request.data as Map)['externalReference'], 'bank-ref');
    expect(request.headers['Idempotency-Key'], isNotEmpty);
    expect(find.text('Deposit request submitted'), findsOneWidget);
  });

  test('history merges real deposit and withdrawal reads newest first',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => options.path.endsWith('/withdrawals')
          ? FixtureResponse.ok(<Object?>[
              <String, Object?>{
                'id': 'w',
                'requestedAt': '2026-10-02T00:00:00Z',
                'requestedAmount': '2',
                'state': 'REQUESTED',
              }
            ])
          : FixtureResponse.ok(<Object?>[
              <String, Object?>{
                'id': 'd',
                'requestedAt': '2026-10-01T00:00:00Z',
                'requestedAmount': '1',
                'state': 'CONFIRMED',
              }
            ]),
    );
    final FundingRepository repo =
        FundingRepository(apiClient: h.api, logger: h.logger);
    final List<FundingRequestSummary> history = await repo.fetchHistory();
    expect(history.map((r) => r.id), <String>['w', 'd']);
    expect(history.first.direction, FundingDirection.withdrawal);
    expect(history.last.isConfirmed, isTrue);
    expect(h.transport.requests.every((r) => r.method == 'GET'), isTrue);
  });
}
