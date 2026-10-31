// # Responsibility: the immutable data-export request model — the state a privacy request is in, why it may be blocked, and the one-time download token with the instant it expires, parsed without inventing a state or an expiry.
import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

/// `PrivacyRequestState` values the API can answer with.
///
/// `BLOCKED_BY_RETENTION` and `BLOCKED_BY_LEGAL_HOLD` are outcomes, not failures:
/// the platform is required to keep the data, and a customer who is told otherwise
/// would keep asking. The screen names them explicitly.
class DataExportStates {
  const DataExportStates._();

  static const String received = 'RECEIVED';
  static const String identityRequired = 'IDENTITY_VERIFICATION_REQUIRED';
  static const String underReview = 'UNDER_REVIEW';
  static const String inProgress = 'IN_PROGRESS';
  static const String blockedByRetention = 'BLOCKED_BY_RETENTION';
  static const String blockedByLegalHold = 'BLOCKED_BY_LEGAL_HOLD';
  static const String ready = 'READY';
  static const String completed = 'COMPLETED';
  static const String rejected = 'REJECTED';
  static const String cancelled = 'CANCELLED';

  /// Waiting on a human, not on the platform.
  static bool needsCustomerAction(String state) =>
      state == identityRequired || state == received;

  /// Finished without producing a file, for a reason the customer must be told.
  static bool isBlocked(String state) =>
      state == blockedByRetention || state == blockedByLegalHold || state == rejected;

  /// True when a download token can be minted: an export exists and is usable.
  static bool canDownload(String state) => state == ready || state == completed;
}

/// One privacy request about the caller.
class DataExportRequest extends Equatable {
  const DataExportRequest({
    required this.id,
    required this.requestType,
    required this.state,
    required this.jurisdiction,
    this.requestedAt,
    this.verifiedAt,
    this.completedAt,
    this.blockedReason,
    this.retentionBlock = false,
    this.legalHoldBlock = false,
    this.correlationId,
  });

  factory DataExportRequest.fromJson(Map<String, Object?> json) {
    return DataExportRequest(
      id: JsonRead.strOr(json, 'id', ''),
      requestType: JsonRead.strOr(json, 'requestType', 'EXPORT'),
      state: JsonRead.strOr(json, 'state', 'RECEIVED'),
      jurisdiction: JsonRead.strOr(json, 'jurisdiction', ''),
      requestedAt: JsonRead.date(json, 'requestedAt'),
      verifiedAt: JsonRead.date(json, 'verifiedAt'),
      completedAt: JsonRead.date(json, 'completedAt'),
      blockedReason: JsonRead.str(json, 'blockedReason'),
      retentionBlock: JsonRead.boolean(json, 'retentionBlock'),
      legalHoldBlock: JsonRead.boolean(json, 'legalHoldBlock'),
      correlationId: JsonRead.str(json, 'correlationId'),
    );
  }

  final String id;

  /// ACCESS, EXPORT, DELETION, ... The phone only creates ACCESS and EXPORT; a
  /// deletion request carries `DATA_DELETION_REQUEST` step-up and stays in the web
  /// app.
  final String requestType;
  final String state;
  final String jurisdiction;
  final DateTime? requestedAt;
  final DateTime? verifiedAt;
  final DateTime? completedAt;

  /// Why the request cannot proceed, when the platform knows.
  final String? blockedReason;
  final bool retentionBlock;
  final bool legalHoldBlock;
  final String? correlationId;

  bool get canDownload => DataExportStates.canDownload(state);
  bool get needsCustomerAction => DataExportStates.needsCustomerAction(state);
  bool get isBlocked => DataExportStates.isBlocked(state);

  @override
  List<Object?> get props => <Object?>[
        id,
        requestType,
        state,
        jurisdiction,
        requestedAt,
        verifiedAt,
        completedAt,
        blockedReason,
        retentionBlock,
        legalHoldBlock,
        correlationId,
      ];
}

/// The one-time download token and the instant it stops working.
///
/// The expiry is part of the model because a token without one is a link the screen
/// would offer forever. `expiresAt` is null only when the API did not send a parseable
/// instant, and the screen then refuses to promise the link still works.
class DataExportDownload extends Equatable {
  const DataExportDownload({required this.token, required this.expiresAt});

  factory DataExportDownload.fromJson(Map<String, Object?> json) => DataExportDownload(
        token: JsonRead.strOr(json, 'token', ''),
        expiresAt: JsonRead.date(json, 'expiresAt'),
      );

  final String token;
  final DateTime? expiresAt;

  bool get isValid => token.isNotEmpty && expiresAt != null && expiresAt!.isAfter(DateTime.now());

  @override
  List<Object?> get props => <Object?>[token, expiresAt];
}

/// The pair of identifiers one export request needs, generated in one place.
///
/// `DataAccessRequestDto` validates `idempotencyKey` as 16-255 characters and
/// `correlationId` as 8-255, and a retried tap must reuse the key rather than mint
/// a second request. Building the pair here — instead of at the call site — is what
/// keeps a short key from reaching the API as a 422 the customer cannot act on.
class ExportRequestIdentifiers extends Equatable {
  const ExportRequestIdentifiers({required this.idempotencyKey, required this.correlationId});

  /// `mobile-export-<microseconds>` and `mobile-<key>`, both well inside the bounds.
  factory ExportRequestIdentifiers.generate(DateTime now) {
    final String key = 'mobile-export-${now.microsecondsSinceEpoch}';
    return ExportRequestIdentifiers(idempotencyKey: key, correlationId: 'mobile-$key');
  }

  final String idempotencyKey;
  final String correlationId;

  /// Mirrors the DTO's own limits so a test can prove the generated pair passes.
  bool get isValid =>
      idempotencyKey.length >= 16 &&
      idempotencyKey.length <= 255 &&
      correlationId.length >= 8 &&
      correlationId.length <= 255;

  @override
  List<Object?> get props => <Object?>[idempotencyKey, correlationId];
}
