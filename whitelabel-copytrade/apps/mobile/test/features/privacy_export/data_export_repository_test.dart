// # Responsibility: pins the data-export flow — EXPORT is the only type the phone creates, the idempotency key is sent as both header and body, the two BLOCKED states are outcomes and not failures, and a download token is only minted for a ready export.
import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/features/privacy_export/data/data_export_repository.dart';
import 'package:wlct_mobile/features/privacy_export/domain/data_export_models.dart';

import '../support/http_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Map<String, Object?> request({
    String id = 'req-1',
    String type = 'EXPORT',
    String state = 'RECEIVED',
    Map<String, Object?> extra = const <String, Object?>{},
  }) =>
      <String, Object?>{
        'id': id,
        'requestType': type,
        'state': state,
        'jurisdiction': 'BD',
        'requestedAt': '2026-10-30T05:00:00.000Z',
        'createdBy': 'user-1',
        ...extra,
      };

  test('create sends EXPORT with the idempotency key in the header and the body', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(request()));
    final DataExportRequest created = await DataExportRepository(apiClient: h.api).createExportRequest(
      jurisdiction: 'BD',
      idempotencyKey: 'key-0000000000001',
      correlationId: 'corr-1',
    );

    final CapturedRequest sent = h.transport.requests.single;
    expect(sent.method, 'POST');
    expect(sent.uri.path, '/api/v1/privacy/requests');
    expect(sent.headers['Idempotency-Key'], 'key-0000000000001');

    final Map<Object?, Object?> body = sent.data! as Map<Object?, Object?>;
    expect(body['requestType'], 'EXPORT');
    expect(body['jurisdiction'], 'BD');
    expect(body['idempotencyKey'], 'key-0000000000001');
    expect(body['correlationId'], 'corr-1');
    // Deletion is step-up protected and must never be reachable from the phone.
    expect(body['requestType'], isNot('DELETION'));
    expect(created.id, 'req-1');
    expect(created.state, 'RECEIVED');
    expect(created.needsCustomerAction, isTrue);
  });

  test('an optional reason is sent only when it is not blank', () async {
    final HttpHarness withReason = HttpHarness((options) => FixtureResponse.ok(request()));
    await DataExportRepository(apiClient: withReason.api).createExportRequest(
      jurisdiction: 'BD',
      idempotencyKey: 'key-0000000000002',
      correlationId: 'corr-2',
      reason: 'Annual review',
    );
    expect((withReason.transport.requests.single.data! as Map<Object?, Object?>)['reason'], 'Annual review');

    final HttpHarness blank = HttpHarness((options) => FixtureResponse.ok(request()));
    await DataExportRepository(apiClient: blank.api).createExportRequest(
      jurisdiction: 'BD',
      idempotencyKey: 'key-0000000000003',
      correlationId: 'corr-3',
      reason: '   ',
    );
    expect((blank.transport.requests.single.data! as Map<Object?, Object?>).containsKey('reason'), isFalse);
  });

  test('list and single read use the self-service routes', () async {
    final HttpHarness list = HttpHarness((options) => FixtureResponse.ok(<Object?>[request(), request(id: 'req-2', state: 'READY')]));
    final List<DataExportRequest> rows = await DataExportRepository(apiClient: list.api).fetchRequests();
    expect(list.transport.requests.single.uri.path, '/api/v1/privacy/requests');
    expect(rows, hasLength(2));
    expect(rows[0].canDownload, isFalse);
    expect(rows[1].canDownload, isTrue);

    final HttpHarness single = HttpHarness((options) => FixtureResponse.ok(request(id: 'req-9')));
    final DataExportRequest one = await DataExportRepository(apiClient: single.api).getRequest('req-9');
    expect(single.transport.requests.single.uri.path, '/api/v1/privacy/requests/req-9');
    expect(single.transport.requests.single.method, 'GET');
    expect(one.id, 'req-9');
  });

  test('the two BLOCKED states are outcomes with a reason, not errors', () async {
    final HttpHarness h = HttpHarness((options) => FixtureResponse.ok(<Object?>[
      request(id: 'r-1', state: 'BLOCKED_BY_RETENTION', extra: <String, Object?>{'retentionBlock': true}),
      request(
        id: 'r-2',
        state: 'BLOCKED_BY_LEGAL_HOLD',
        extra: <String, Object?>{'legalHoldBlock': true, 'blockedReason': 'Open dispute'},
      ),
    ]));
    final List<DataExportRequest> rows = await DataExportRepository(apiClient: h.api).fetchRequests();

    expect(rows[0].isBlocked, isTrue);
    expect(rows[0].retentionBlock, isTrue);
    expect(rows[0].canDownload, isFalse);
    expect(rows[1].isBlocked, isTrue);
    expect(rows[1].legalHoldBlock, isTrue);
    expect(rows[1].blockedReason, 'Open dispute');
    // Neither blocked row offers a link, and neither is silently shown as "pending".
    expect(rows.any((DataExportRequest r) => r.canDownload), isFalse);
    expect(rows[0].needsCustomerAction, isFalse);
  });

  test('a download token carries its expiry, and an unreadable expiry stays unreadable', () async {
    final HttpHarness ok = HttpHarness(
      (options) => FixtureResponse.ok(<String, Object?>{
        'token': 'tok-abc',
        'expiresAt': DateTime.now().add(const Duration(minutes: 5)).toUtc().toIso8601String(),
      }),
    );
    final DataExportDownload download =
        await DataExportRepository(apiClient: ok.api).issueDownloadToken('req-1');
    expect(ok.transport.requests.single.method, 'POST');
    expect(ok.transport.requests.single.uri.path, '/api/v1/privacy/requests/req-1/download-token');
    expect(download.token, 'tok-abc');
    expect(download.expiresAt, isNotNull);
    expect(download.isValid, isTrue);

    final HttpHarness noExpiry = HttpHarness(
      (options) => FixtureResponse.ok(<String, Object?>{'token': 'tok-xyz'}),
    );
    final DataExportDownload unreadable =
        await DataExportRepository(apiClient: noExpiry.api).issueDownloadToken('req-1');
    expect(unreadable.expiresAt, isNull);
    // A token with no readable expiry is never treated as valid.
    expect(unreadable.isValid, isFalse);
  });

  test('a token that has already expired is not valid', () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.ok(<String, Object?>{
        'token': 'tok-old',
        'expiresAt': DateTime.now().subtract(const Duration(minutes: 1)).toUtc().toIso8601String(),
      }),
    );
    final DataExportDownload expired = await DataExportRepository(apiClient: h.api).issueDownloadToken('req-1');
    expect(expired.isValid, isFalse);
  });

  test('a request belonging to someone else is a 404, and the error is not softened', () async {
    final HttpHarness h = HttpHarness(
      (options) => FixtureResponse.error(404, 'NOT_FOUND', 'Privacy request not found'),
    );
    await expectLater(
      DataExportRepository(apiClient: h.api).getRequest('someone-elses'),
      throwsA(
        isA<AppException>()
            .having((AppException e) => e.code, 'code', AppErrorCode.notFound)
            .having((AppException e) => e.message, 'message', contains('not found')),
      ),
    );
  });

  test('the generated identifiers satisfy the DTO bounds and are not reused', () {
    final ExportRequestIdentifiers first =
        ExportRequestIdentifiers.generate(DateTime.utc(2026, 10, 30, 5, 0, 0));
    final ExportRequestIdentifiers second =
        ExportRequestIdentifiers.generate(DateTime.utc(2026, 10, 30, 5, 0, 1));

    // The DTO is @MinLength(16) on the key and @MinLength(8) on the correlation id.
    expect(first.idempotencyKey.length, greaterThanOrEqualTo(16));
    expect(first.correlationId.length, greaterThanOrEqualTo(8));
    expect(first.isValid, isTrue);
    expect(second.isValid, isTrue);
    expect(first.idempotencyKey, isNot(second.idempotencyKey));
    expect(first.correlationId, contains('mobile-'));
  });

  test('state helpers are total over the enum the API can return', () {
    const Map<String, bool> downloadable = <String, bool>{
      'READY': true,
      'COMPLETED': true,
      'RECEIVED': false,
      'IDENTITY_VERIFICATION_REQUIRED': false,
      'UNDER_REVIEW': false,
      'IN_PROGRESS': false,
      'BLOCKED_BY_RETENTION': false,
      'BLOCKED_BY_LEGAL_HOLD': false,
      'REJECTED': false,
      'CANCELLED': false,
    };
    downloadable.forEach((String state, bool expected) {
      expect(DataExportStates.canDownload(state), expected, reason: state);
    });

    expect(DataExportStates.isBlocked('BLOCKED_BY_RETENTION'), isTrue);
    expect(DataExportStates.isBlocked('BLOCKED_BY_LEGAL_HOLD'), isTrue);
    expect(DataExportStates.isBlocked('REJECTED'), isTrue);
    expect(DataExportStates.isBlocked('IN_PROGRESS'), isFalse);
    expect(DataExportStates.needsCustomerAction('IDENTITY_VERIFICATION_REQUIRED'), isTrue);
    expect(DataExportStates.needsCustomerAction('IN_PROGRESS'), isFalse);
  });
}
