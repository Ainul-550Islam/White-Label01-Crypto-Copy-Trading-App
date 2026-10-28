import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/features/funding/data/deposit_address_repository.dart';
import 'package:wlct_mobile/features/funding/domain/funding_models.dart';
import 'package:wlct_mobile/features/funding/presentation/deposit_address_screen.dart';
import 'package:wlct_mobile/l10n/app_localizations.dart';
import '../support/http_harness.dart';

const String requestId = '20000000-0000-4000-8000-000000000001';
const String accountId = '20000000-0000-4000-8000-000000000002';
const String ethAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const Map<String, Object?> asset = <String, Object?>{
  'assetId': 'ETH',
  'networkId': 'ethereum',
  'currency': 'ETH',
  'networkName': 'Ethereum',
  'tokenStandard': null,
  'contractAddress': null,
};
const Map<String, Object?> view = <String, Object?>{
  'fundingRequestId': requestId,
  'accountId': accountId,
  'assetId': 'ETH',
  'networkId': 'ethereum',
  'currency': 'ETH',
  'address': ethAddress,
  'status': 'ADDRESS_VERIFIED',
  'settlementStatus': 'NOT_CONFIRMED',
  'monitoringStatus': 'NOT_CONNECTED',
  'verifiedAt': '2026-10-27T00:00:00Z',
};
const FundingRequestSummary request = FundingRequestSummary(
  id: requestId,
  direction: FundingDirection.deposit,
  accountId: accountId,
  state: 'REQUESTED',
  requestedAmount: '1.00000001',
  currency: 'ETH',
);

Map<String, Object?> proof() => <String, Object?>{
      'proofId': 'test-proof',
      'action': 'CUSTODY_ADDRESS_ISSUE',
      'method': 'PASSWORD',
      'expiresAt': DateTime.now()
          .add(const Duration(minutes: 2))
          .toUtc()
          .toIso8601String(),
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'real repository retrieves scoped choices and validates the address identity',
      () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(
        options.path.endsWith('/assets') ? <Object?>[asset] : view,
      ),
    );
    final DepositAddressRepository repo =
        DepositAddressRepository(apiClient: h.api);
    final List<DepositAssetOption> options = await repo.listAssets(requestId);
    expect(options, hasLength(1));
    expect(
      (await repo.getAddress(requestId, accountId, options.single)).address,
      ethAddress,
    );
    expect(
      h.transport.requests[0].uri.path,
      endsWith(
        '/client-lifecycle/funding/$requestId/deposit-address/assets',
      ),
    );
    expect(
      h.transport.requests[1].uri.queryParameters,
      <String, String>{'assetId': 'ETH', 'networkId': 'ethereum'},
    );
    expect(
      h.transport.requests
          .every((item) => !item.uri.path.contains('/custody/')),
      isTrue,
    );
  });

  test(
      'a retry obtains a fresh action-bound proof but retains the same issue key',
      () async {
    int issueCalls = 0;
    final HttpHarness h = HttpHarness((options) {
      if (options.path.endsWith('/auth/step-up')) {
        return FixtureResponse.ok(proof());
      }
      issueCalls++;
      return issueCalls == 1
          ? FixtureResponse.error(
              503,
              'SERVICE_UNAVAILABLE',
              'PRIVATE BACKEND DETAIL',
            )
          : FixtureResponse.ok(view);
    });
    final DepositAddressRepository repo =
        DepositAddressRepository(apiClient: h.api);
    final DepositAssetOption choice = DepositAssetOption.parse(asset);
    await expectLater(
      repo.verifyAndIssue(
        requestId,
        accountId,
        choice,
        DepositVerificationMethod.password,
        'SYNTHETIC-password',
      ),
      throwsA(anything),
    );
    expect(
      (await repo.verifyAndIssue(
        requestId,
        accountId,
        choice,
        DepositVerificationMethod.password,
        'SYNTHETIC-password',
      ))
          .address,
      ethAddress,
    );
    final List<CapturedRequest> issued = h.transport.requests
        .where((item) => item.uri.path.endsWith('/deposit-address'))
        .toList();
    expect(issued, hasLength(2));
    expect(issued.first.headers['Idempotency-Key'], isNotEmpty);
    expect(
      issued.last.headers['Idempotency-Key'],
      issued.first.headers['Idempotency-Key'],
    );
    final List<CapturedRequest> verifications = h.transport.requests
        .where((item) => item.uri.path.endsWith('/auth/step-up'))
        .toList();
    expect(verifications, hasLength(2));
    expect(
      (verifications.first.data as Map)['action'],
      'CUSTODY_ADDRESS_ISSUE',
    );
  });

  test('rejects incorrect provider, owner, settlement and monitoring evidence',
      () async {
    for (final Map<String, Object?> invalid in <Map<String, Object?>>[
      <String, Object?>{...view, 'accountId': 'other'},
      <String, Object?>{...view, 'networkId': 'testnet'},
      <String, Object?>{
        ...view,
        'address': '0x0000000000000000000000000000000000000000',
      },
      <String, Object?>{...view, 'settlementStatus': 'CONFIRMED'},
      <String, Object?>{...view, 'monitoringStatus': 'CONNECTED'},
    ]) {
      final HttpHarness h = HttpHarness((_) => FixtureResponse.ok(invalid));
      final DepositAddressRepository repo =
          DepositAddressRepository(apiClient: h.api);
      await expectLater(
        repo.getAddress(
          requestId,
          accountId,
          DepositAssetOption.parse(asset),
        ),
        throwsFormatException,
      );
    }
  });

  test('invalid or expired proof never submits a provider issuance', () async {
    for (final Map<String, Object?> bad in <Map<String, Object?>>[
      <String, Object?>{...proof(), 'action': 'PAYOUT_CREATE'},
      <String, Object?>{...proof(), 'expiresAt': '2000-01-01T00:00:00Z'},
      <String, Object?>{...proof(), 'method': 'TOTP'},
    ]) {
      final HttpHarness h = HttpHarness((_) => FixtureResponse.ok(bad));
      final DepositAddressRepository repo =
          DepositAddressRepository(apiClient: h.api);
      await expectLater(
        repo.verifyAndIssue(
          requestId,
          accountId,
          DepositAssetOption.parse(asset),
          DepositVerificationMethod.password,
          'SYNTHETIC-password',
        ),
        throwsFormatException,
      );
      expect(h.transport.requests, hasLength(1));
      expect(h.transport.requests.single.uri.path, endsWith('/auth/step-up'));
    }
  });

  testWidgets(
      'Arabic address and warning are RTL, with an LTR address and real clipboard call',
      (WidgetTester tester) async {
    String? copied;
    final TestDefaultBinaryMessenger messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemChannels.platform,
        (MethodCall call) async {
      if (call.method == 'Clipboard.setData') {
        copied = (call.arguments as Map)['text'] as String?;
      }
      return null;
    });
    addTearDown(() =>
        messenger.setMockMethodCallHandler(SystemChannels.platform, null),);
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(
        options.path.endsWith('/assets') ? <Object?>[asset] : view,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: DepositAddressScreen(
          request: request,
          repository: DepositAddressRepository(apiClient: h.api),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.textContaining('المراقبة التلقائية للإيداع والقيد غير متصلة'),
      findsOneWidget,
    );
    expect(
      Directionality.of(tester.element(find.byType(DepositAddressScreen))),
      TextDirection.rtl,
    );
    await tester.tap(find.byType(DropdownButtonFormField<DepositAssetOption>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ETH · Ethereum · ETH').last);
    await tester.pumpAndSettle();
    expect(
      tester.widget<SelectableText>(find.byType(SelectableText)).textDirection,
      TextDirection.ltr,
    );
    await tester.ensureVisible(find.text('نسخ العنوان'));
    await tester.tap(find.text('نسخ العنوان'));
    await tester.pumpAndSettle();
    expect(find.text('تم نسخ العنوان.'), findsOneWidget);
    expect(copied, ethAddress);
  });

  testWidgets(
      'presents the explicit monitoring warning, verifies, and never renders a raw failure',
      (WidgetTester tester) async {
    int issueCalls = 0;
    final HttpHarness h = HttpHarness((options) {
      if (options.path.endsWith('/assets')) {
        return FixtureResponse.ok(<Object?>[asset]);
      }
      if (options.path.endsWith('/auth/step-up')) {
        return FixtureResponse.ok(proof());
      }
      if (options.method == 'GET') {
        return FixtureResponse.error(404, 'NOT_FOUND', 'no address');
      }
      issueCalls++;
      return issueCalls == 1
          ? FixtureResponse.error(
              503,
              'SERVICE_UNAVAILABLE',
              'PRIVATE BACKEND DETAIL',
            )
          : FixtureResponse.ok(view);
    });
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: DepositAddressScreen(
          request: request,
          repository: DepositAddressRepository(apiClient: h.api),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.textContaining(
        'Automatic deposit monitoring and credit are not connected',
      ),
      findsOneWidget,
    );
    await tester.tap(find.byType(DropdownButtonFormField<DepositAssetOption>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ETH · Ethereum · ETH').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Verify identity and issue address'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'SYNTHETIC-password');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Verify and continue'));
    await tester.tap(find.text('Verify and continue'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Verification or issuance could not be confirmed'),
      findsOneWidget,
    );
    expect(find.text('PRIVATE BACKEND DETAIL'), findsNothing);
    await tester.enterText(find.byType(TextField), 'SYNTHETIC-password');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Verify and continue'));
    await tester.pumpAndSettle();
    expect(find.text(ethAddress), findsOneWidget);
    expect(find.textContaining('does not confirm a transfer'), findsOneWidget);
  });
}
