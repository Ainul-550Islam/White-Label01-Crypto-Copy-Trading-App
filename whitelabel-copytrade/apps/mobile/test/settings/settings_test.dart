import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/di/providers.dart';
import 'package:wlct_mobile/app.dart';
import 'package:wlct_mobile/features/auth/presentation/auth_state.dart';
import 'package:wlct_mobile/features/settings/settings_screen.dart';
import 'package:wlct_mobile/features/settings/security_screen.dart';
import 'package:wlct_mobile/features/settings/preferences_form.dart';
import 'package:wlct_mobile/features/settings/data/user_preferences_repository.dart';
import 'package:wlct_mobile/l10n/app_localizations.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
      'settings shows the real authenticated user and sign-out clears storage',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness(
      (options) => options.path == '/auth/login'
          ? FixtureResponse.ok(session())
          : FixtureResponse.ok(null),
    );
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        apiClientProvider.overrideWithValue(h.api),
        tokenStorageProvider.overrideWithValue(h.tokens),
        deviceIdentityProvider.overrideWithValue(h.device),
        appLoggerProvider.overrideWithValue(h.logger),
      ],
    );
    addTearDown(container.dispose);
    await tester.runAsync(() async {
      await container
          .read(authControllerProvider.notifier)
          .signIn(email: 'user@example.test', password: 'password');
    });
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: SettingsScreen(),
        ),
      ),
    );
    expect(find.text('user@example.test'), findsOneWidget);
    expect(find.text('Security'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(
      container.read(authControllerProvider).status,
      AuthStatus.unauthenticated,
    );
    final stored = await tester.runAsync(h.tokens.read);
    expect(stored, isNull);
    expect(h.transport.requests.last.uri.path, '/api/v1/auth/logout');
  });

  testWidgets(
      'security overview reports real posture without placeholder API routes',
      (WidgetTester tester) async {
    final HttpHarness h =
        HttpHarness((options) => FixtureResponse.ok(session()));
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        apiClientProvider.overrideWithValue(h.api),
        tokenStorageProvider.overrideWithValue(h.tokens),
        deviceIdentityProvider.overrideWithValue(h.device),
        appLoggerProvider.overrideWithValue(h.logger),
      ],
    );
    addTearDown(container.dispose);
    await tester.runAsync(
      () => container.read(authControllerProvider.notifier).signIn(
            email: 'user@example.test',
            password: 'password',
          ),
    );
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: SecurityScreen(),
        ),
      ),
    );
    expect(find.text('Two-factor authentication is on'), findsOneWidget);
    expect(
      find.textContaining('Manage your active devices and password'),
      findsOneWidget,
    );
    expect(find.textContaining('/v1/auth/'), findsNothing);
  });

  test(
      'locale, currency, time zone and date format persist through the backend contract',
      () async {
    Map<String, Object?> stored = <String, Object?>{
      'locale': 'en',
      'displayCurrency': 'USD',
      'timezone': 'UTC',
      'dateFormat': 'ISO',
    };
    final HttpHarness h = HttpHarness((options) {
      if (options.method == 'PUT') {
        final Object? raw = options.data is String
            ? jsonDecode(options.data as String)
            : options.data;
        stored = Map<String, Object?>.from(raw as Map);
      }
      return FixtureResponse.ok(stored);
    });
    final UserPreferencesRepository repo = UserPreferencesRepository(h.api);
    expect((await repo.fetch()).timezone, 'UTC');
    const UserPreferences edited = UserPreferences(
      locale: 'bn',
      displayCurrency: 'BDT',
      timezone: 'Asia/Dhaka',
      dateFormat: 'DMY',
    );
    await repo.save(edited, idempotencyKey: 'settings-intent-123');
    final UserPreferences reloaded = await repo.fetch();
    expect(reloaded.toJson(), edited.toJson());
    final CapturedRequest update = h.transport.requests[1];
    expect(update.method, 'PUT');
    expect(update.uri.path, '/api/v1/users/me/preferences');
    expect(update.headers['Idempotency-Key'], 'settings-intent-123');
  });

  testWidgets(
      'preferences form validates a required time zone before any write',
      (WidgetTester tester) async {
    final HttpHarness h =
        HttpHarness((options) => FixtureResponse.ok(<String, Object?>{}));
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[apiClientProvider.overrideWithValue(h.api)],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: SingleChildScrollView(
              child: PreferencesForm(
                initial: UserPreferences(
                  locale: 'en',
                  displayCurrency: 'USD',
                  timezone: 'UTC',
                  dateFormat: 'ISO',
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextFormField), '');
    await tester.ensureVisible(find.text('Save preferences'));
    await tester.tap(find.text('Save preferences'));
    await tester.pumpAndSettle();
    expect(find.text('Enter a time zone'), findsOneWidget);
    expect(h.transport.requests, isEmpty);
  });

  testWidgets('editing preferences sends the selected values and an intent key',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness((options) {
      final Object? value = options.data is String
          ? jsonDecode(options.data as String)
          : options.data;
      return FixtureResponse.ok(value);
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[apiClientProvider.overrideWithValue(h.api)],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: SingleChildScrollView(
              child: PreferencesForm(
                initial: UserPreferences(
                  locale: 'en',
                  displayCurrency: 'USD',
                  timezone: 'UTC',
                  dateFormat: 'ISO',
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('বাংলা').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('BDT').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'Asia/Dhaka');
    await tester
        .ensureVisible(find.byType(DropdownButtonFormField<String>).at(2));
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(2));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DMY').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Save preferences'));
    await tester.tap(find.text('Save preferences'));
    await tester.pumpAndSettle();
    final CapturedRequest request = h.transport.requests.single;
    expect(request.method, 'PUT');
    expect(request.uri.path, '/api/v1/users/me/preferences');
    expect(request.data, <String, Object?>{
      'locale': 'bn',
      'displayCurrency': 'BDT',
      'timezone': 'Asia/Dhaka',
      'dateFormat': 'DMY',
    });
    expect(request.headers['Idempotency-Key'], isNotEmpty);
  });

  testWidgets('all five locale catalogues load and Arabic is right-to-left',
      (WidgetTester tester) async {
    const Map<String, String> expected = <String, String>{
      'en': 'Risk',
      'bn': 'ঝুঁকি',
      'ar': 'المخاطر',
      'es': 'Riesgo',
      'tr': 'Risk',
    };
    for (final MapEntry<String, String> entry in expected.entries) {
      await tester.pumpWidget(
        MaterialApp(
          locale: Locale(entry.key),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (BuildContext context) =>
                Text(AppLocalizations.of(context).riskTitle),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(entry.value), findsOneWidget);
      final BuildContext textContext = tester.element(find.text(entry.value));
      expect(
        Directionality.of(textContext),
        entry.key == 'ar' ? TextDirection.rtl : TextDirection.ltr,
      );
      final UserPreferences value = UserPreferences.fromJson(<String, Object?>{
        'locale': entry.key,
        'displayCurrency': 'USD',
        'timezone': 'UTC',
        'dateFormat': 'ISO',
      });
      expect(value.locale, entry.key);
    }
  });

  testWidgets('the root app applies the authenticated user’s saved locale',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness(
      (options) => options.path == '/auth/login'
          ? FixtureResponse.ok(session())
          : FixtureResponse.ok(<String, Object?>{
              'locale': 'bn',
              'displayCurrency': 'BDT',
              'timezone': 'Asia/Dhaka',
              'dateFormat': 'DMY',
            }),
    );
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        apiClientProvider.overrideWithValue(h.api),
        tokenStorageProvider.overrideWithValue(h.tokens),
        deviceIdentityProvider.overrideWithValue(h.device),
        appLoggerProvider.overrideWithValue(h.logger),
      ],
    );
    addTearDown(container.dispose);
    await tester.runAsync(
      () => container
          .read(authControllerProvider.notifier)
          .signIn(email: 'user@example.test', password: 'password'),
    );
    await tester.runAsync(() => container.read(userPreferencesProvider.future));
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const WlctApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      tester.widget<MaterialApp>(find.byType(MaterialApp)).locale,
      const Locale('bn'),
    );
    expect(
      h.transport.requests.any(
        (request) => request.uri.path == '/api/v1/users/me/preferences',
      ),
      isTrue,
    );
  });
}
