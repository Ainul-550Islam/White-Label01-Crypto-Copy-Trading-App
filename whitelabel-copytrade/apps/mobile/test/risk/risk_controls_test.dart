import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/di/providers.dart';
import 'package:wlct_mobile/features/risk/data/risk_repository.dart';
import 'package:wlct_mobile/features/risk/presentation/risk_screen.dart';
import 'package:wlct_mobile/l10n/app_localizations.dart';
import 'package:wlct_mobile/features/risk/presentation/risk_controller.dart';
import 'package:wlct_mobile/features/risk/presentation/risk_state.dart';
import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'controller exposes engaged protections and stale mirrors without write calls',
      () async {
    final HttpHarness h = HttpHarness((options) {
      if (options.path.endsWith('/status')) {
        return FixtureResponse.ok(<String, Object?>{
          'engineEnabled': true,
          'failClosed': true,
          'maxRiskStateAgeMs': 120000,
          'snapshotRefreshMs': 60000,
          'refreshOutpacesStaleness': true,
          'engagedSwitchCount': 1,
          'triggeredProtectionCount': 1,
          'staleAccounts': <String>['account'],
          'eventsLast24hBySeverity': <String, Object?>{'EMERGENCY': 1},
          'latestSnapshotPerAccount': <Object?>[
            <String, Object?>{
              'accountId': 'account',
              'equity': '123.450000',
              'snapshotVersion': '1',
              'capturedAt': '2026-01-01T00:00:00Z',
              'isSimulated': false,
              'openOrderCount': 0,
              'staleSources': <String>[],
            },
          ],
        });
      }
      if (options.path.endsWith('/kill-switches')) {
        return FixtureResponse.ok(<Object?>[
          <String, Object?>{
            'id': 'engaged',
            'scope': 'ACCOUNT',
            'isEngaged': true,
            'status': 'TRIGGERED',
            'requiresExplicitClear': true,
          },
        ]);
      }
      return FixtureResponse.ok(<String, Object?>{'items': <Object?>[]});
    });
    final RiskController controller = RiskController(
      repository: RiskRepository(apiClient: h.api, logger: h.logger),
      logger: h.logger,
    );
    await controller.load();
    expect(controller.state.status, RiskViewStatus.ready);
    expect(controller.state.engagedSwitches.single.id, 'engaged');
    expect(
      controller.state.triggeredSwitches.single.requiresExplicitClear,
      isTrue,
    );
    expect(controller.state.mirror?.mirrors.single.equity, '123.450000');
    expect(controller.state.mirror?.mirrors.single.stale, isTrue);
    expect(controller.state.mirror?.criticalEvents24h, 1);
    expect(
      h.transport.requests
          .singleWhere((request) => request.uri.path.endsWith('/kill-switches'))
          .uri
          .queryParameters['engagedOnly'],
      'true',
    );
    expect(
      h.transport.requests.every((request) => request.method == 'GET'),
      isTrue,
    );
    controller.dispose();
  });

  testWidgets(
      'malformed switch evidence is unavailable, never a healthy empty state',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness((options) {
      if (options.path.endsWith('/status')) {
        return FixtureResponse.ok(<String, Object?>{
          'engineEnabled': true,
          'failClosed': true,
          'maxRiskStateAgeMs': 120000,
          'snapshotRefreshMs': 60000,
          'refreshOutpacesStaleness': true,
          'engagedSwitchCount': 1,
          'triggeredProtectionCount': 1,
          'staleAccounts': <String>[],
          'latestSnapshotPerAccount': <Object?>[],
          'eventsLast24hBySeverity': <String, Object?>{},
        });
      }
      if (options.path.endsWith('/kill-switches')) {
        return FixtureResponse.ok(<Object?>[
          <String, Object?>{
            'id': 'x',
            'scope': 'ACCOUNT',
            'status': 'TRIGGERED',
          },
        ]);
      }
      return FixtureResponse.ok(<String, Object?>{'items': <Object?>[]});
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          apiClientProvider.overrideWithValue(h.api),
          appLoggerProvider.overrideWithValue(h.logger),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: RiskScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('This risk panel is unavailable. Pull down to try again.'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.text('This risk panel is unavailable. Pull down to try again.'),
      findsOneWidget,
    );
    expect(
      find.text('Nothing is halted. The absence of rows is health here.'),
      findsNothing,
    );
  });

  testWidgets('a truncated engaged-switch list is explicitly marked incomplete',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness((options) {
      if (options.path.endsWith('/status')) {
        return FixtureResponse.ok(<String, Object?>{
          'engineEnabled': true,
          'failClosed': true,
          'maxRiskStateAgeMs': 120000,
          'snapshotRefreshMs': 60000,
          'refreshOutpacesStaleness': true,
          'engagedSwitchCount': 2,
          'triggeredProtectionCount': 0,
          'staleAccounts': <String>[],
          'latestSnapshotPerAccount': <Object?>[],
          'eventsLast24hBySeverity': <String, Object?>{},
        });
      }
      if (options.path.endsWith('/kill-switches')) {
        return FixtureResponse.ok(<Object?>[
          <String, Object?>{
            'id': 'only-visible-switch',
            'scope': 'ACCOUNT',
            'isEngaged': true,
            'status': 'TRIGGERED',
            'requiresExplicitClear': true,
          },
        ]);
      }
      return FixtureResponse.ok(<String, Object?>{'items': <Object?>[]});
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          apiClientProvider.overrideWithValue(h.api),
          appLoggerProvider.overrideWithValue(h.logger),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: RiskScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('The halt count and list may be incomplete or out of sync. Refresh to check.'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.text('The halt count and list may be incomplete or out of sync. Refresh to check.'),
      findsOneWidget,
    );
  });

  test('all failed refresh panels remain marked unavailable even with cached data', () async {
    bool fail = false;
    final HttpHarness h = HttpHarness((options) {
      if (fail) return FixtureResponse.error(503, 'UNAVAILABLE', 'Private service error');
      if (options.path.endsWith('/status')) {
        return FixtureResponse.ok(<String, Object?>{
          'engineEnabled': true,
          'failClosed': true,
          'maxRiskStateAgeMs': 120000,
          'snapshotRefreshMs': 60000,
          'refreshOutpacesStaleness': true,
          'engagedSwitchCount': 0,
          'triggeredProtectionCount': 0,
          'staleAccounts': <String>[],
          'latestSnapshotPerAccount': <Object?>[],
          'eventsLast24hBySeverity': <String, Object?>{},
        });
      }
      if (options.path.endsWith('/kill-switches')) return FixtureResponse.ok(<Object?>[]);
      return FixtureResponse.ok(<String, Object?>{'items': <Object?>[]});
    });
    final RiskController controller = RiskController(
      repository: RiskRepository(apiClient: h.api, logger: h.logger),
      logger: h.logger,
    );
    await controller.load();
    fail = true;
    await controller.refresh();
    expect(controller.state.status, RiskViewStatus.failed);
    expect(controller.state.mirror, isNotNull);
    expect(
      controller.state.degradedPanels.toSet(),
      <String>{'status', 'switches', 'events'},
    );
    controller.dispose();
  });

  test('partial failure retains the accessible risk panels', () async {
    final HttpHarness h = HttpHarness(
      (options) => options.path.endsWith('/events')
          ? FixtureResponse.error(403, 'FORBIDDEN', 'Not available')
          : FixtureResponse.ok(
              options.path.endsWith('/kill-switches')
                  ? <Object?>[]
                  : <String, Object?>{
                      'engineEnabled': true,
                      'failClosed': true,
                      'maxRiskStateAgeMs': 120000,
                      'snapshotRefreshMs': 60000,
                      'refreshOutpacesStaleness': true,
                      'engagedSwitchCount': 0,
                      'triggeredProtectionCount': 0,
                      'staleAccounts': <String>[],
                      'latestSnapshotPerAccount': <Object?>[],
                      'eventsLast24hBySeverity': <String, Object?>{},
                    },
            ),
    );
    final RiskController controller = RiskController(
      repository: RiskRepository(apiClient: h.api, logger: h.logger),
      logger: h.logger,
    );
    await controller.load();
    expect(controller.state.status, RiskViewStatus.ready);
    expect(controller.state.degradedPanels, contains('events'));
    expect(controller.state.mirror?.engineEnabled, isTrue);
    controller.dispose();
  });
}
