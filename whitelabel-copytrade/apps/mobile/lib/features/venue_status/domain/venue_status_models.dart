// # Responsibility: the immutable customer-facing venue status model — one venue's operational state, why it is in it, and when that answer was last checked, parsed without inventing a state the API did not send.
import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

/// The operational states `VenueOperationalState` can report.
///
/// Kept as plain strings rather than a Dart enum so a state the server adds later
/// renders as itself instead of crashing the screen. UNKNOWN is the absence of
/// evidence and is never inferred from a missing field as "operational": a missing
/// state means the phone cannot say, and the screen says that.
class VenueStates {
  const VenueStates._();

  static const String operational = 'OPERATIONAL';
  static const String degraded = 'DEGRADED';
  static const String maintenance = 'MAINTENANCE';
  static const String outage = 'OUTAGE';
  static const String unknown = 'UNKNOWN';

  /// True when orders at this venue are expected to work right now.
  static bool isUsable(String state) => state == operational || state == degraded;

  /// True when the customer must be told before they try to trade.
  static bool blocksTrading(String state) => state == maintenance || state == outage;
}

/// An operator override in force at a venue.
///
/// The API sends `null` when no override is active (`revokedAt` ones are dropped
/// before the view is built), so a non-null instance always means "a human set this
/// and the venue's own feed does not get the last word".
class VenueStatusOverride extends Equatable {
  const VenueStatusOverride({
    required this.state,
    required this.reason,
    this.venue,
    this.setBy,
    this.setAt,
    this.expiresAt,
    this.revokedAt,
  });

  factory VenueStatusOverride.fromJson(Map<String, Object?> json) => VenueStatusOverride(
        state: JsonRead.strOr(json, 'state', VenueStates.unknown),
        reason: JsonRead.strOr(json, 'reason', ''),
        venue: JsonRead.str(json, 'venue'),
        setBy: JsonRead.str(json, 'setBy'),
        setAt: JsonRead.date(json, 'setAt'),
        expiresAt: JsonRead.date(json, 'expiresAt'),
        revokedAt: JsonRead.date(json, 'revokedAt'),
      );

  final String state;
  final String reason;
  final String? venue;
  final String? setBy;
  final DateTime? setAt;
  final DateTime? expiresAt;
  final DateTime? revokedAt;

  @override
  List<Object?> get props => <Object?>[state, reason, venue, setBy, setAt, expiresAt, revokedAt];
}

/// One venue's status row.
///
/// `verified` is the API's own statement about whether the state rests on any
/// first-party evidence; the screen shows an unverified row as tentative rather than
/// dropping it, because "we cannot confirm" is exactly what a customer needs to know
/// when an order is being refused.
class VenueStatus extends Equatable {
  const VenueStatus({
    required this.venue,
    required this.state,
    required this.verified,
    this.reason,
    this.since,
    this.messageCode,
    this.message,
    this.source,
    this.override,
    this.checkedAt,
  });

  factory VenueStatus.fromJson(Map<String, Object?> json) {
    final Object? rawOverride = json['override'];
    return VenueStatus(
      venue: JsonRead.strOr(json, 'venue', 'UNKNOWN'),
      state: JsonRead.strOr(json, 'state', VenueStates.unknown),
      verified: JsonRead.boolean(json, 'verified'),
      reason: JsonRead.str(json, 'reason'),
      since: JsonRead.date(json, 'since'),
      messageCode: JsonRead.str(json, 'messageCode'),
      message: JsonRead.str(json, 'message'),
      source: JsonRead.str(json, 'source'),
      override: rawOverride is Map ? VenueStatusOverride.fromJson(JsonRead.map(rawOverride)) : null,
      checkedAt: JsonRead.date(json, 'checkedAt'),
    );
  }

  final String venue;
  final String state;

  /// Whether the state rests on evidence. False is not "operational".
  final bool verified;

  /// A stable reason code (`FEED_REPORTS_OUTAGE`, `MANUAL_OVERRIDE`, ...). Shown as a
  /// code beside the sentence, never substituted for it.
  final String? reason;

  /// When the venue entered this state, as far as the winning source knows.
  final DateTime? since;

  /// The i18n key the API suggests, when it has one.
  final String? messageCode;

  /// A ready sentence from the API, if it sent one.
  final String? message;

  /// Which input decided the answer: OVERRIDE, FEED, ACCOUNT_HEALTH or NONE.
  final String? source;

  /// The override in force, or null when the venue's own signal decides.
  final VenueStatusOverride? override;

  /// When the platform last checked.
  final DateTime? checkedAt;

  bool get isUsable => VenueStates.isUsable(state);
  bool get blocksTrading => VenueStates.blocksTrading(state);

  /// A human set this state and it has not been revoked or expired.
  bool get isOverridden => override != null;

  @override
  List<Object?> get props => <Object?>[venue, state, verified, reason, since, messageCode, message, source, override, checkedAt];
}
