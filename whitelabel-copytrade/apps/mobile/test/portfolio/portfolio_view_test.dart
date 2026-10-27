import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/di/providers.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/features/portfolio/data/portfolio_repository.dart';
import 'package:wlct_mobile/features/portfolio/domain/portfolio_models.dart';
import 'package:wlct_mobile/features/portfolio/presentation/portfolio_screen.dart';
import 'package:wlct_mobile/l10n/app_localizations.dart';
import '../support/http_harness.dart';

Widget screen(HttpHarness h) => ProviderScope(
      overrides: <Override>[
        apiClientProvider.overrideWithValue(h.api),
        appLoggerProvider.overrideWithValue(h.logger),
      ],
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: PortfolioScreen(),
      ),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const PortfolioProfile profile =
      PortfolioProfile(id: 'profile', scope: 'CLIENT', baseCurrency: 'USD');
  test('overview preserves precise decimal strings and flags partial errors',
      () async {
    final HttpHarness h = HttpHarness((options) {
      if (options.path.endsWith('/holdings')) {
        return FixtureResponse.ok(<String, Object?>{
          'holdings': <Object?>[
            <String, Object?>{
              'asset': 'BTC',
              'quantity': '0.123456789123456789',
              'costBasis': '9007199254740993.01',
            }
          ],
        });
      }
      if (options.path.endsWith('/nav')) {
        return FixtureResponse.error(503, 'SERVICE_UNAVAILABLE', 'Unavailable');
      }
      return FixtureResponse.ok(<String, Object?>{'pnl': '-0.00000001'});
    });
    final PortfolioRepository repo =
        PortfolioRepository(apiClient: h.api, logger: h.logger);
    final PortfolioOverview result = await repo.fetchOverview(profile);
    expect(result.holdings.single.quantity, '0.123456789123456789');
    expect(result.holdings.single.costBasis, '9007199254740993.01');
    expect(result.pnl.entries.single.value, '-0.00000001');
    expect(result.degraded, contains('nav'));
    expect(result.nav.isEmpty, isTrue);
    expect(
      h.transport.requests.every(
        (request) => request.uri.queryParameters['profileId'] == 'profile',
      ),
      isTrue,
    );
  });

  test('all three failed panels produce an error rather than empty success',
      () async {
    final HttpHarness h = HttpHarness(
      (options) =>
          FixtureResponse.error(503, 'SERVICE_UNAVAILABLE', 'Unavailable'),
    );
    final PortfolioRepository repo =
        PortfolioRepository(apiClient: h.api, logger: h.logger);
    await expectLater(
      repo.fetchOverview(profile),
      throwsA(
        isA<AppException>()
            .having((e) => e.message, 'message', contains('unavailable')),
      ),
    );
  });

  testWidgets('portfolio screen shows loading and then its real empty state',
      (WidgetTester tester) async {
    final Completer<FixtureResponse> response = Completer<FixtureResponse>();
    final HttpHarness h = HttpHarness((options) => response.future);
    await tester.pumpWidget(screen(h));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    response.complete(FixtureResponse.ok(<Object?>[]));
    await tester.pumpAndSettle();
    expect(
      find.text('No portfolio has been set up for your account yet.'),
      findsOneWidget,
    );
  });

  testWidgets('portfolio screen exposes a retryable error',
      (WidgetTester tester) async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.error(
        403,
        'FORBIDDEN',
        'You do not have permission to do that.',
      ),
    );
    await tester.pumpWidget(screen(h));
    await tester.pumpAndSettle();
    expect(find.text('You do not have permission to do that.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(h.transport.requests, hasLength(2));
  });
}
