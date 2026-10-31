// # Responsibility: pins venue status parsing, the unverified/unknown distinction, and the exact read route — a status screen that renders an unconfirmed venue as operational is the failure this test exists to prevent.
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/features/venue_status/data/venue_status_repository.dart';
import 'package:wlct_mobile/features/venue_status/domain/venue_status_models.dart';

import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('reads the venues envelope and keeps verified=false distinct from operational', () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(<String, Object?>{
        'venues': <Object?>[
          <String, Object?>{
            'venue': 'BINANCE',
            'state': 'OPERATIONAL',
            'verified': true,
            'since': '2026-10-01T08:00:00.000Z',
            'checkedAt': '2026-10-30T09:15:00.000Z',
            'source': 'feed',
          },
          <String, Object?>{
            'venue': 'OKX',
            'state': 'OPERATIONAL',
            'verified': false,
            'source': 'cache',
          },
          <String, Object?>{
            'venue': 'KRAKEN',
            'state': 'MAINTENANCE',
            'verified': true,
            'reason': 'MANUAL_OVERRIDE',
            'source': 'OVERRIDE',
            'override': <String, Object?>{
              'venue': 'KRAKEN',
              'state': 'MAINTENANCE',
              'reason': 'Exchange announced a planned upgrade',
              'setBy': 'operator-1',
              'setAt': '2026-10-30T04:00:00.000Z',
              'expiresAt': '2026-10-30T12:00:00.000Z',
              'revokedAt': null,
            },
          },
          <String, Object?>{'venue': 'COINBASE', 'state': 'OUTAGE', 'verified': true, 'override': null},
          <String, Object?>{'venue': 'DERIBIT'},
        ],
      }),
    );
    final VenueStatusRepository repo = VenueStatusRepository(apiClient: h.api);

    final List<VenueStatus> statuses = await repo.fetchStatuses();

    expect(h.transport.requests.map((r) => r.uri.path).toList(), <String>['/api/v1/venues/status']);
    expect(h.transport.requests.single.method, 'GET');
    expect(statuses, hasLength(5));

    expect(statuses[0].venue, 'BINANCE');
    expect(statuses[0].verified, isTrue);
    expect(statuses[0].isUsable, isTrue);
    expect(statuses[0].since, isNotNull);
    expect(statuses[0].checkedAt, isNotNull);

    // The row the platform could not confirm: the state string says OPERATIONAL,
    // the API says it is unverified, and `verified` is what the screen must honour.
    expect(statuses[1].venue, 'OKX');
    expect(statuses[1].state, VenueStates.operational);
    expect(statuses[1].verified, isFalse);

    expect(statuses[2].blocksTrading, isTrue);
    expect(statuses[2].isOverridden, isTrue);
    expect(statuses[2].override!.reason, 'Exchange announced a planned upgrade');
    expect(statuses[2].override!.setBy, 'operator-1');
    expect(statuses[2].override!.expiresAt, isNotNull);
    expect(statuses[2].override!.revokedAt, isNull);
    expect(statuses[2].source, 'OVERRIDE');
    expect(statuses[3].blocksTrading, isTrue);
    // A null override is "no human set this", which is not the same as a revoked one.
    expect(statuses[3].isOverridden, isFalse);
    expect(statuses[3].override, isNull);

    // A row with no state at all is UNKNOWN, and UNKNOWN never counts as usable.
    expect(statuses[4].venue, 'DERIBIT');
    expect(statuses[4].state, VenueStates.unknown);
    expect(statuses[4].verified, isFalse);
    expect(statuses[4].isUsable, isFalse);
    expect(statuses[4].blocksTrading, isFalse);
    expect(statuses[4].isOverridden, isFalse);
  });

  test('a top-level venue array is accepted, and neither shape invents a venue', () async {
    final HttpHarness list = HttpHarness(
      (options) => FixtureResponse.ok(<Object?>[
        <String, Object?>{'venue': 'BINANCE', 'state': 'OPERATIONAL', 'verified': true, 'override': null},
      ]),
    );
    final List<VenueStatus> rows = await VenueStatusRepository(apiClient: list.api).fetchStatuses();
    expect(rows, hasLength(1));
    expect(rows.single.venue, 'BINANCE');

    final HttpHarness empty = HttpHarness((options) => FixtureResponse.ok(<String, Object?>{}));
    expect(await VenueStatusRepository(apiClient: empty.api).fetchStatuses(), isEmpty);

    final HttpHarness nullBody = HttpHarness((options) => FixtureResponse.ok(null));
    expect(await VenueStatusRepository(apiClient: nullBody.api).fetchStatuses(), isEmpty);
  });

  test('a 503 from the venue service surfaces as an error, not as an empty healthy list', () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.error(503, 'VENUE_STATUS_UNAVAILABLE', 'Venue status is temporarily unavailable.'),
    );
    await expectLater(
      VenueStatusRepository(apiClient: h.api).fetchStatuses(),
      throwsA(
        isA<AppException>()
            .having((AppException e) => e.code, 'code', AppErrorCode.server)
            .having((AppException e) => e.message, 'message', contains('unavailable')),
      ),
    );
  });

  test('state classification is total: every state is either usable, blocking, or unknown', () {
    for (final String state in <String>[
      VenueStates.operational,
      VenueStates.degraded,
      VenueStates.maintenance,
      VenueStates.outage,
      VenueStates.unknown,
      'SOMETHING_NEW',
    ]) {
      final bool usable = VenueStates.isUsable(state);
      final bool blocking = VenueStates.blocksTrading(state);
      expect(usable && blocking, isFalse, reason: '$state cannot both work and block');
      if (state == VenueStates.unknown || state == 'SOMETHING_NEW') {
        expect(usable, isFalse, reason: 'an unknown state is never usable');
      }
    }
  });
}
