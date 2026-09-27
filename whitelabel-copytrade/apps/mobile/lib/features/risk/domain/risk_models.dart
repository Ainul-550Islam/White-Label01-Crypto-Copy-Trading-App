import 'package:equatable/equatable.dart';

/// Read-only risk view models.
///
/// The mobile client is a **viewer** for the risk layer, and this file is
/// written so that staying that way is easy: every model is a plain value
/// object parsed from the API's risk views, and there is no command-shaped
/// model here that could be serialised back to the API as an attempt to
/// engage, clear or reconfigure anything. Controls over switches live in
/// the admin console, behind the permissions this client is not granted;
/// the API enforces that boundary independently of anything on a phone.
///
/// Money and versions stay as [String]s exactly as the server emits them
/// (the API's BigInt-as-string discipline). Parsing them into `double` to
/// render is how a UI starts disagreeing with the ledger.
///
/// A snapshot mirror that has not been captured for an account renders as
/// an explicit absence - never as zeros.

String _requiredString(Object? value, {String fallback = ''}) {
  return value is String && value.isNotEmpty ? value : fallback;
}

int _intOrZero(Object? value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value) ?? 0;
  }
  return 0;
}

bool _boolOrFalse(Object? value) => value is bool && value;

DateTime? _dateTime(Object? value) {
  if (value is String && value.isNotEmpty) {
    return DateTime.tryParse(value)?.toLocal();
  }
  return null;
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value.whereType<String>().toList(growable: false);
  }
  return const <String>[];
}

Map<String, Object?> _asMap(Object? value) {
  if (value is Map) {
    return value.map<String, Object?>(
      (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
    );
  }
  return const <String, Object?>{};
}

/// The deployment's posture, as mirrored by the API (NOT a live venue read).
///
/// `refreshOutpacesStaleness` is the field a careful reader stops on: when
/// it is false the deployment's refresh cadence cannot keep mirrors inside
/// the staleness budget, and the engine will deny on freshness - a config
/// fault, stated plainly, not a trading signal.
class RiskMirrorStatus extends Equatable {
  const RiskMirrorStatus({
    required this.engineEnabled,
    required this.failClosed,
    required this.maxRiskStateAgeMs,
    required this.snapshotRefreshMs,
    required this.refreshOutpacesStaleness,
    required this.engagedSwitchCount,
    required this.triggeredProtectionCount,
    required this.staleAccountIds,
    required this.mirrors,
    required this.criticalEvents24h,
    required this.note,
  });

  factory RiskMirrorStatus.fromJson(Map<String, Object?> json) {
    final List<Map<String, Object?>> mirrors =
        (json['latestSnapshotPerAccount'] is List)
            ? (json['latestSnapshotPerAccount'] as List)
                .whereType<Map<Object?, Object?>>()
                .map(_asMap)
                .toList(growable: false)
            : const <Map<String, Object?>>[];
    final Map<String, Object?> severity = _asMap(json['eventsLast24hBySeverity']);
    final Set<String> staleIds = _stringList(json['staleAccounts']).toSet();

    return RiskMirrorStatus(
      engineEnabled: _boolOrFalse(json['engineEnabled']),
      failClosed: _boolOrFalse(json['failClosed']),
      maxRiskStateAgeMs: _intOrZero(json['maxRiskStateAgeMs']),
      snapshotRefreshMs: _intOrZero(json['snapshotRefreshMs']),
      refreshOutpacesStaleness: _boolOrFalse(json['refreshOutpacesStaleness']),
      engagedSwitchCount: _intOrZero(json['engagedSwitchCount']),
      triggeredProtectionCount: _intOrZero(json['triggeredProtectionCount']),
      staleAccountIds: _stringList(json['staleAccounts']),
      mirrors: mirrors
          .map((Map<String, Object?> row) =>
              RiskAccountMirror.fromJson(row, staleIds: staleIds))
          .toList(growable: false),
      criticalEvents24h:
          _intOrZero(severity['CRITICAL']) + _intOrZero(severity['HIGH']),
      note: _requiredString(json['note']),
    );
  }

  final bool engineEnabled;
  final bool failClosed;
  final int maxRiskStateAgeMs;
  final int snapshotRefreshMs;
  final bool refreshOutpacesStaleness;
  final int engagedSwitchCount;
  final int triggeredProtectionCount;
  final List<String> staleAccountIds;
  final List<RiskAccountMirror> mirrors;
  final int criticalEvents24h;
  final String note;

  int get staleMirrorCount => staleAccountIds.length;

  @override
  List<Object?> get props => <Object?>[
        engineEnabled,
        failClosed,
        maxRiskStateAgeMs,
        snapshotRefreshMs,
        refreshOutpacesStaleness,
        engagedSwitchCount,
        triggeredProtectionCount,
        staleAccountIds,
        mirrors,
        criticalEvents24h,
        note,
      ];
}

/// One account's newest synced snapshot metadata.
class RiskAccountMirror extends Equatable {
  const RiskAccountMirror({
    required this.accountId,
    required this.snapshotVersion,
    required this.capturedAt,
    required this.stale,
    required this.equity,
    required this.grossNotional,
    required this.netDailyPnl,
    required this.openOrderCount,
    required this.isSimulated,
    required this.staleSources,
  });

  factory RiskAccountMirror.fromJson(
    Map<String, Object?> json, {
    Set<String> staleIds = const <String>{},
  }) {
    final DateTime? capturedAt = _dateTime(json['capturedAt']);
    return RiskAccountMirror(
      accountId: _requiredString(json['accountId'], fallback: '?'),
      snapshotVersion: _requiredString(json['snapshotVersion'], fallback: '?'),
      capturedAt: capturedAt,
      // Stale when the status feed names this account OR when the captured
      // instant is missing: an untimeable mirror cannot claim freshness.
      stale: staleIds.contains(_requiredString(json['accountId'])) ||
          capturedAt == null,
      equity: _optionalString(json['equity']),
      grossNotional: _optionalString(json['accountGrossNotional']),
      netDailyPnl: _optionalString(json['netDailyPnl']),
      openOrderCount: json['openOrderCount'] == null
          ? null
          : _intOrZero(json['openOrderCount']),
      isSimulated: _boolOrFalse(json['isSimulated']),
      staleSources: _stringList(json['staleSources']),
    );
  }

  final String accountId;
  final String snapshotVersion;
  final DateTime? capturedAt;
  final bool stale;
  final String? equity;
  final String? grossNotional;
  final String? netDailyPnl;
  final int? openOrderCount;
  final bool isSimulated;
  final List<String> staleSources;

  @override
  List<Object?> get props => <Object?>[
        accountId,
        snapshotVersion,
        capturedAt,
        stale,
        equity,
        grossNotional,
        netDailyPnl,
        openOrderCount,
        isSimulated,
        staleSources,
      ];
}

/// A kill switch visible to the caller's organisation, with lifecycle.
class RiskSwitchInfo extends Equatable {
  const RiskSwitchInfo({
    required this.id,
    required this.scope,
    required this.target,
    required this.isEngaged,
    required this.status,
    required this.requiresExplicitClear,
    required this.triggeredByRule,
    required this.reason,
    required this.engagedAt,
  });

  factory RiskSwitchInfo.fromJson(Map<String, Object?> json) {
    return RiskSwitchInfo(
      id: _requiredString(json['id'], fallback: '?'),
      scope: _requiredString(json['scope'], fallback: '?'),
      target: _optionalString(json['target']),
      isEngaged: _boolOrFalse(json['isEngaged']),
      status: _requiredString(json['status'], fallback: 'UNKNOWN'),
      requiresExplicitClear: _boolOrFalse(json['requiresExplicitClear']),
      triggeredByRule: _optionalString(json['triggeredByRule']),
      reason: _optionalString(json['reason']),
      engagedAt: _dateTime(json['engagedAt']),
    );
  }

  final String id;
  final String scope;
  final String? target;
  final bool isEngaged;
  final String status;
  final bool requiresExplicitClear;
  final String? triggeredByRule;
  final String? reason;
  final DateTime? engagedAt;

  /// A protection the ENGINE pulled, as opposed to a manual halt.
  bool get isTriggeredProtection =>
      isEngaged && (status == 'TRIGGERED' || status == 'ACKNOWLEDGED');

  @override
  List<Object?> get props => <Object?>[
        id,
        scope,
        target,
        isEngaged,
        status,
        requiresExplicitClear,
        triggeredByRule,
        reason,
        engagedAt,
      ];
}

/// One recorded risk decision / protection event.
class RiskEventInfo extends Equatable {
  const RiskEventInfo({
    required this.id,
    required this.createdAt,
    required this.eventType,
    required this.severity,
    required this.message,
    required this.ruleId,
    required this.scope,
    required this.isSimulated,
  });

  factory RiskEventInfo.fromJson(Map<String, Object?> json) {
    return RiskEventInfo(
      id: _requiredString(json['id'], fallback: '?'),
      createdAt: _dateTime(json['createdAt']),
      eventType: _requiredString(json['eventType'], fallback: 'EVENT'),
      severity: _requiredString(json['severity'], fallback: 'INFO'),
      message: _requiredString(json['message']),
      ruleId: _optionalString(json['ruleId']),
      scope: _optionalString(json['scope']),
      isSimulated: _boolOrFalse(json['isSimulated']),
    );
  }

  final String id;
  final DateTime? createdAt;
  final String eventType;
  final String severity;
  final String message;
  final String? ruleId;
  final String? scope;
  final bool isSimulated;

  bool get isSevere => severity == 'CRITICAL' || severity == 'HIGH';

  @override
  List<Object?> get props => <Object?>[
        id,
        createdAt,
        eventType,
        severity,
        message,
        ruleId,
        scope,
        isSimulated,
      ];
}

String? _optionalString(Object? value) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  return null;
}
