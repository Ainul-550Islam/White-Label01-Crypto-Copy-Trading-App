import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/di/providers.dart';
import 'package:wlct_mobile/core/storage/secure_storage.dart';
import 'package:wlct_mobile/features/auth/data/auth_repository.dart';
import 'package:wlct_mobile/features/auth/domain/auth_models.dart';
import 'package:wlct_mobile/features/auth/presentation/auth_controller.dart';
import 'package:wlct_mobile/features/auth/presentation/auth_state.dart';
import 'package:wlct_mobile/features/risk/data/copy_budget_repository.dart';
import 'package:wlct_mobile/features/risk/domain/copy_budget.dart';
import 'package:wlct_mobile/features/risk/presentation/copy_budget_card.dart';
import 'package:wlct_mobile/l10n/app_localizations.dart';

import '../support/http_harness.dart';

Map<String, Object?> budget(String? cap) => <String, Object?>{
      'tenantId': 'tenant-1',
      'userId': 'user-1',
      'currency': 'USDT',
      'tenantCeiling': null,
      'exposureStatus': 'ALLOCATION_ESTIMATE',
      'maxActiveExposure': cap,
      'effectiveCap': cap,
      'committed': '40.000000000001',
      'remaining': cap == null ? null : '50',
    };

class MemorySecureStorage extends SecureStorage {
  final Map<String, String> values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

AuthUser budgetUser(String tenant, String id) => AuthUser(
      id: id,
      tenantId: tenant,
      email: '$id@example.test',
      status: UserStatus.active,
      twoFactorEnabled: true,
      roles: const <String>[],
      permissions: const <String>[],
    );

class SwitchableAuthController extends AuthController {
  SwitchableAuthController(HttpHarness h, AuthUser user)
      : super(
          repository: AuthRepository(
            apiClient: h.api,
            tokenStorage: h.tokens,
            deviceIdentity: h.device,
            logger: h.logger,
          ),
          logger: h.logger,
        ) {
    switchUser(user);
  }

  void switchUser(AuthUser user) {
    state = AuthState(status: AuthStatus.authenticated, user: user);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('decimal input remains exact and accepts Bengali and Arabic digit forms',
      () {
    expect(normaliseBudgetInput(' ১২৩.৪৫ '), '123.45');
    expect(normaliseBudgetInput('٩٠٫٢٥'), '90.25');
    expect(isValidBudgetReduction('10000000000000000'), isFalse);
    expect(isValidBudgetReduction('0.0000000000001'), isFalse);
    expect(isValidBudgetReduction('1e3'), isFalse);
    expect(isValidBudgetReduction('-1'), isFalse);
    expect(
      compareBudgetDecimals(
        '1234567890123456.000000000001',
        '1234567890123456.000000000002',
      ),
      lessThan(0),
    );
  });

  test('repository rejects malformed evidence and does not invent a budget',
      () async {
    final HttpHarness h = HttpHarness(
      (_) => FixtureResponse.ok(<String, Object?>{
        'currency': 'USDT',
        'maxActiveExposure': 0,
        'effectiveCap': null,
        'committed': '0',
        'remaining': null,
      }),
    );
    await expectLater(CopyBudgetRepository(h.api).fetch(), throwsA(anything));
    expect(h.transport.requests.single.method, 'GET');
  });

  test(
      'uncertain or mismatched reductions retain one idempotency key for retry',
      () async {
    int calls = 0;
    final HttpHarness h = HttpHarness((_) {
      calls++;
      if (calls == 1) {
        return FixtureResponse.error(503, 'UNAVAILABLE', 'private detail');
      }
      if (calls == 2) return FixtureResponse.ok(budget('99'));
      return FixtureResponse.ok(budget('90'));
    });
    final CopyBudgetRepository repo = CopyBudgetRepository(h.api);
    await expectLater(
      repo.reduce(maximum: '90', currency: 'USDT'),
      throwsA(anything),
    );
    await expectLater(
      repo.reduce(maximum: '90', currency: 'USDT'),
      throwsA(anything),
    );
    expect(
      (await repo.reduce(maximum: '90', currency: 'USDT')).personalCap,
      '90',
    );
    final List<CapturedRequest> sent = h.transport.requests;
    expect(
      sent.every(
        (r) =>
            r.method == 'POST' &&
            r.uri.path.endsWith('/copy-trading/budget/reduce'),
      ),
      isTrue,
    );
    expect(sent.first.headers['Idempotency-Key'], isNotEmpty);
    expect(sent.map((r) => r.headers['Idempotency-Key']).toSet(), hasLength(1));
    expect(
      sent.first.data,
      <String, Object?>{'maxActiveExposure': '90', 'currency': 'USDT'},
    );
  });

  test('a process restart reuses the stored key for the same owner and intent',
      () async {
    int count = 0;
    final HttpHarness h = HttpHarness((_) {
      count++;
      return count == 1
          ? FixtureResponse.error(503, 'UNAVAILABLE', 'private detail')
          : FixtureResponse.ok(budget('90'));
    });
    final MemorySecureStorage storage = MemorySecureStorage();
    final first = CopyBudgetRepository(
      h.api,
      tenantId: 'tenant-1',
      userId: 'user-1',
      storage: storage,
    );
    await expectLater(
      first.reduce(maximum: '90', currency: 'USDT'),
      throwsA(anything),
    );
    expect(storage.values, isNotEmpty);
    final afterRestart = CopyBudgetRepository(
      h.api,
      tenantId: 'tenant-1',
      userId: 'user-1',
      storage: storage,
    );
    await afterRestart.reduce(maximum: '90', currency: 'USDT');
    expect(
      h.transport.requests[0].headers['Idempotency-Key'],
      h.transport.requests[1].headers['Idempotency-Key'],
    );
    expect(storage.values, isEmpty);
  });

  testWidgets('limit form validates and submits only an exact reduction',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(
        options.method == 'GET' ? budget('100') : budget('90.25'),
      ),
    );
    final auth = SwitchableAuthController(h, budgetUser('tenant-1', 'user-1'));
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          apiClientProvider.overrideWithValue(h.api),
          authControllerProvider.overrideWith((ref) => auth),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: SingleChildScrollView(child: CopyBudgetCard())),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Current effective limit: 100 USDT'), findsOneWidget);
    expect(
      find.text(
        'Copy orders with a configured budget are blocked until live exposure and order reservations can be verified.',
      ),
      findsOneWidget,
    );
    final Finder field = find.byType(TextFormField);
    await tester.enterText(field, '-1');
    await tester.tap(find.text('Reduce limit'));
    await tester.pumpAndSettle();
    expect(
      find.text('Enter a non-negative amount with up to 12 decimal places.'),
      findsOneWidget,
    );
    await tester.enterText(field, '100.000000000001');
    await tester.tap(find.text('Reduce limit'));
    await tester.pumpAndSettle();
    expect(
      find.text('The new limit cannot exceed the current effective limit.'),
      findsOneWidget,
    );
    expect(h.transport.requests.where((r) => r.method == 'POST'), isEmpty);
    await tester.enterText(field, '٩٠٫٢٥');
    await tester.tap(find.text('Reduce limit'));
    await tester.pumpAndSettle();
    final CapturedRequest sent =
        h.transport.requests.singleWhere((r) => r.method == 'POST');
    expect(
      sent.data,
      <String, Object?>{'maxActiveExposure': '90.25', 'currency': 'USDT'},
    );
    expect(sent.headers['Idempotency-Key'], isNotEmpty);
    expect(
      find.text(
        'The reduction is recorded. The current limit is shown above.',
      ),
      findsOneWidget,
    );
    expect(find.text('Current effective limit: 90.25 USDT'), findsOneWidget);
  });

  testWidgets('does not request or display another owner without a session',
      (WidgetTester tester) async {
    final h = HttpHarness((_) => FixtureResponse.ok(budget('100')));
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[apiClientProvider.overrideWithValue(h.api)],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: CopyBudgetCard()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(h.transport.requests, isEmpty);
    expect(find.text('Current effective limit: 100 USDT'), findsNothing);
  });

  testWidgets(
      'late budget read from a previous account cannot replace the new account',
      (WidgetTester tester) async {
    final old = Completer<FixtureResponse>();
    int reads = 0;
    final h = HttpHarness((_) {
      reads++;
      return reads == 1
          ? old.future
          : FixtureResponse.ok(
              <String, Object?>{
                ...budget('200'),
                'tenantId': 'tenant-2',
                'userId': 'user-2',
              },
            );
    });
    final auth = SwitchableAuthController(h, budgetUser('tenant-1', 'user-1'));
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          apiClientProvider.overrideWithValue(h.api),
          authControllerProvider.overrideWith((ref) => auth),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: SingleChildScrollView(child: CopyBudgetCard())),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));
    expect(reads, 1);
    auth.switchUser(budgetUser('tenant-2', 'user-2'));
    await tester.pumpAndSettle();
    expect(find.text('Current effective limit: 200 USDT'), findsOneWidget);
    old.complete(FixtureResponse.ok(budget('100')));
    await tester.pumpAndSettle();
    expect(find.text('Current effective limit: 200 USDT'), findsOneWidget);
    expect(find.text('Current effective limit: 100 USDT'), findsNothing);
  });

  testWidgets('late reduction confirmation cannot update a different account',
      (WidgetTester tester) async {
    final oldSave = Completer<FixtureResponse>();
    int reads = 0;
    final h = HttpHarness((options) {
      if (options.method == 'POST') return oldSave.future;
      reads++;
      return FixtureResponse.ok(
        reads == 1
            ? budget('100')
            : <String, Object?>{
                ...budget('200'),
                'tenantId': 'tenant-2',
                'userId': 'user-2',
              },
      );
    });
    final auth = SwitchableAuthController(h, budgetUser('tenant-1', 'user-1'));
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          apiClientProvider.overrideWithValue(h.api),
          authControllerProvider.overrideWith((ref) => auth),
          secureStorageProvider.overrideWithValue(MemorySecureStorage()),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: SingleChildScrollView(child: CopyBudgetCard())),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), '90');
    await tester.tap(find.text('Reduce limit'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(
      h.transport.requests.where((request) => request.method == 'POST'),
      hasLength(1),
    );
    auth.switchUser(budgetUser('tenant-2', 'user-2'));
    await tester.pumpAndSettle();
    expect(find.text('Current effective limit: 200 USDT'), findsOneWidget);
    oldSave.complete(FixtureResponse.ok(budget('90')));
    await tester.pumpAndSettle();
    expect(find.text('Current effective limit: 200 USDT'), findsOneWidget);
    expect(find.text('Current effective limit: 90 USDT'), findsNothing);
    expect(
      find.text(
        'The reduction is recorded. The current limit is shown above.',
      ),
      findsNothing,
    );
  });
}
