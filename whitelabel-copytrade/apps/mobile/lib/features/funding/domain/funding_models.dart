import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

/// An account the signed-in customer owns (client-lifecycle `accounts`).
///
/// The API filters the list to the caller's own accounts; the flags below are
/// the backend's, the app never infers a capability itself.
class FundingAccountSummary extends Equatable {
  const FundingAccountSummary({
    required this.id,
    required this.accountType,
    required this.state,
    required this.isFundingEnabled,
    required this.isWithdrawalEnabled,
    this.displayName,
  });

  factory FundingAccountSummary.fromJson(Map<String, Object?> json) => FundingAccountSummary(
        id: JsonRead.strOr(json, 'id', ''),
        accountType: JsonRead.strOr(json, 'accountType', 'ACCOUNT'),
        state: JsonRead.strOr(json, 'state', 'UNKNOWN'),
        isFundingEnabled: JsonRead.boolean(json, 'isFundingEnabled'),
        isWithdrawalEnabled: JsonRead.boolean(json, 'isWithdrawalEnabled'),
        displayName: JsonRead.str(json, 'displayName'),
      );

  final String id;
  final String accountType;
  final String state;
  final bool isFundingEnabled;
  final bool isWithdrawalEnabled;
  final String? displayName;

  String get label {
    final String name = displayName ?? '';
    if (name.isNotEmpty) {
      return name;
    }
    final String shortId = id.length > 8 ? id.substring(0, 8) : id;
    return '${accountType.replaceAll('_', ' ').toLowerCase()} $shortId';
  }

  /// Only an active account with deposits enabled accepts a deposit request.
  bool get canDeposit => state == 'ACTIVE' && isFundingEnabled;

  @override
  List<Object?> get props => <Object?>[id, accountType, state, isFundingEnabled, isWithdrawalEnabled, displayName];
}

enum FundingDirection { deposit, withdrawal }

/// A deposit (`funding`) or withdrawal request as the backend holds it.
///
/// `requestedAmount` is what the customer asked for; only `confirmedAmount`
/// with state CONFIRMED means money moved. Amounts stay decimal strings.
class FundingRequestSummary extends Equatable {
  const FundingRequestSummary({
    required this.id,
    required this.direction,
    required this.accountId,
    required this.state,
    required this.requestedAmount,
    required this.currency,
    this.confirmedAmount,
    this.failureReason,
    this.requestedAt,
  });

  factory FundingRequestSummary.fromJson(Map<String, Object?> json, FundingDirection direction) => FundingRequestSummary(
        id: JsonRead.strOr(json, 'id', ''),
        direction: direction,
        accountId: JsonRead.strOr(json, 'accountId', ''),
        state: JsonRead.strOr(json, 'state', 'UNKNOWN'),
        requestedAmount: JsonRead.strOr(json, 'requestedAmount', '0'),
        currency: JsonRead.strOr(json, 'currency', ''),
        confirmedAmount: JsonRead.str(json, 'confirmedAmount'),
        failureReason: JsonRead.str(json, 'failureReason'),
        requestedAt: JsonRead.date(json, 'requestedAt') ?? JsonRead.date(json, 'createdAt'),
      );

  static const Set<String> openStates = <String>{'REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'SUBMITTED'};

  final String id;
  final FundingDirection direction;
  final String accountId;
  final String state;
  final String requestedAmount;
  final String currency;
  final String? confirmedAmount;
  final String? failureReason;
  final DateTime? requestedAt;

  /// Still in review/processing: pending does not mean completed.
  bool get isOpen => openStates.contains(state);

  bool get isConfirmed => state == 'CONFIRMED';

  @override
  List<Object?> get props => <Object?>[id, direction, accountId, state, requestedAmount, currency, confirmedAmount, failureReason, requestedAt];
}

/// Client-side pre-checks mirroring the API contract (the API stays authoritative).
class FundingInput {
  const FundingInput._();

  static final RegExp _decimal = RegExp(r'^\d+(\.\d+)?$');
  static final RegExp _nonZeroDigit = RegExp(r'[1-9]');
  static final RegExp _currency = RegExp(r'^[A-Z0-9]{2,10}$');

  /// A plain decimal string greater than zero (no sign, exponent or grouping).
  static bool isPositiveAmount(String value) => _decimal.hasMatch(value) && _nonZeroDigit.hasMatch(value);

  static bool isCurrencyCode(String value) => _currency.hasMatch(value);
}

/// Deposits and withdrawals interleaved newest first.
List<FundingRequestSummary> mergeFundingHistory(List<FundingRequestSummary> deposits, List<FundingRequestSummary> withdrawals, {int limit = 50}) {
  final List<FundingRequestSummary> all = <FundingRequestSummary>[...deposits, ...withdrawals];
  all.sort((FundingRequestSummary a, FundingRequestSummary b) {
    final DateTime? at = a.requestedAt;
    final DateTime? bt = b.requestedAt;
    if (at == null && bt == null) return 0;
    if (at == null) return 1;
    if (bt == null) return -1;
    return bt.compareTo(at);
  });
  return all.length > limit ? all.sublist(0, limit) : all;
}
