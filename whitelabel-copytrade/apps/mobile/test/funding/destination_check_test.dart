import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/storage/token_storage.dart';
import 'package:wlct_mobile/features/funding/data/funding_repository.dart';
import 'package:wlct_mobile/features/funding/domain/withdrawal_destination_check.dart';
import 'package:wlct_mobile/features/funding/presentation/withdrawal_destination_check_dialog.dart';
import 'package:wlct_mobile/l10n/app_localizations.dart';

import '../support/http_harness.dart';

const String address = '0x1111111111111111111111111111111111111111';

AuthTokens tokens() {
  final DateTime now = DateTime.now().toUtc();
  return AuthTokens(
    accessToken: 'access',
    refreshToken: 'refresh',
    accessExpiresAt: now.add(const Duration(minutes: 10)),
    refreshExpiresAt: now.add(const Duration(hours: 2)),
  );
}

FundingRepository repository(HttpHarness harness) => FundingRepository(
      apiClient: harness.api,
      logger: harness.logger,
    );

Widget dialog(FundingRepository repo, {Locale locale = const Locale('en')}) =>
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: WithdrawalDestinationCheckDialog(repository: repo)),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
      'an unlisted address is rejected through the real client and dialog, without a withdrawal',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness(
      (_) => FixtureResponse.ok(<String, Object?>{
        'network': 'ETHEREUM',
        'decision': 'DENY',
        'code': 'DESTINATION_NOT_ALLOWLISTED',
        'destinationId': null,
        'activatesAt': null,
      }),
    );
    await h.tokens.write(tokens());
    await tester.pumpWidget(dialog(repository(h)));
    await tester.enterText(find.byType(TextFormField), address);
    await tester.tap(find.text('Check allowlist'));
    await tester.pumpAndSettle();
    expect(
        find.text(
            'This is not an active approved destination for this network.',),
        findsOneWidget,);
    expect(find.textContaining('does not create a withdrawal'), findsOneWidget);
    expect(h.transport.requests, hasLength(1));
    final CapturedRequest request = h.transport.requests.single;
    expect(request.method, 'POST');
    expect(request.uri.path,
        '/api/v1/client-lifecycle/withdrawal-destination-check',);
    expect(request.data,
        <String, Object?>{'network': 'ETHEREUM', 'address': address},);
    expect(request.headers['Idempotency-Key'], isNotEmpty);
    expect(request.uri.toString(), isNot(contains(address)));
  });

  testWidgets(
      'an allowlisted result is explicitly provisional and disappears when the input changes',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness(
      (_) => FixtureResponse.ok(<String, Object?>{
        'network': 'ETHEREUM',
        'decision': 'ALLOW',
        'code': 'ALLOW',
        'destinationId': 'destination-1',
        'activatesAt': null,
      }),
    );
    await h.tokens.write(tokens());
    await tester.pumpWidget(dialog(repository(h)));
    await tester.enterText(find.byType(TextFormField), address);
    await tester.tap(find.text('Check allowlist'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Other withdrawal conditions still apply'),
        findsOneWidget,);
    await tester.enterText(find.byType(TextFormField),
        '0x2222222222222222222222222222222222222222',);
    await tester.pump();
    expect(find.textContaining('Other withdrawal conditions still apply'),
        findsNothing,);
  });

  testWidgets(
      'invalid input is not transmitted and backend errors remain generic',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness((_) =>
        FixtureResponse.error(403, 'FORBIDDEN', 'private backend details'),);
    await h.tokens.write(tokens());
    await tester.pumpWidget(dialog(repository(h)));
    await tester.enterText(find.byType(TextFormField), 'short');
    await tester.tap(find.text('Check allowlist'));
    await tester.pumpAndSettle();
    expect(find.text('Enter an address between 16 and 128 characters.'),
        findsOneWidget,);
    expect(h.transport.requests, isEmpty);
    await tester.enterText(find.byType(TextFormField), address);
    await tester.tap(find.text('Check allowlist'));
    await tester.pumpAndSettle();
    expect(find.textContaining('could not be checked'), findsOneWidget);
    expect(find.textContaining('private backend details'), findsNothing);
  });

  testWidgets('pending destinations are displayed in Bengali',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness(
      (_) => FixtureResponse.ok(<String, Object?>{
        'network': 'ETHEREUM',
        'decision': 'DENY',
        'code': 'DESTINATION_PENDING_ACTIVATION',
        'destinationId': 'destination-1',
        'activatesAt': '2026-12-01T00:00:00.000Z',
      }),
    );
    await h.tokens.write(tokens());
    await tester.pumpWidget(dialog(repository(h), locale: const Locale('bn')));
    await tester.enterText(find.byType(TextFormField), address);
    await tester.tap(find.text('অনুমোদিত তালিকা যাচাই'));
    await tester.pumpAndSettle();
    expect(
        find.text(
            'এই গন্তব্য সক্রিয় হওয়ার অপেক্ষায় আছে এবং এখন ব্যবহার করা যাবে না।',),
        findsOneWidget,);
  });

  test('contradictory, mismatched or malformed responses never become approval',
      () {
    for (final Object? invalid in <Object?>[
      null,
      <String, Object?>{
        'network': 'SOLANA',
        'decision': 'ALLOW',
        'code': 'ALLOW',
        'destinationId': 'id',
      },
      <String, Object?>{
        'network': 'ETHEREUM',
        'decision': 'DENY',
        'code': 'ALLOW',
        'destinationId': 'id',
      },
      <String, Object?>{
        'network': 'ETHEREUM',
        'decision': 'ALLOW',
        'code': 'ALLOW',
        'destinationId': null,
      },
      <String, Object?>{
        'network': 'ETHEREUM',
        'decision': 'DENY',
        'code': 'DESTINATION_PENDING_ACTIVATION',
      },
    ]) {
      expect(() => WithdrawalDestinationCheck.fromJson(invalid, 'ETHEREUM'),
          throwsFormatException,);
    }
  });
}
