// # Responsibility: the immutable sign-in alert model — one recorded security event on the signed-in user's own account, with the severity and type the API reported and no acknowledgement state the phone cannot actually change.
import 'package:equatable/equatable.dart';

import '../../../core/network/json_read.dart';

/// Security-event types the API records. Kept as strings so a new type renders as
/// itself rather than crashing; the list is used only for the filter chips.
class SecurityEventTypes {
  const SecurityEventTypes._();

  static const String loginSuccess = 'LOGIN_SUCCESS';
  static const String loginFailure = 'LOGIN_FAILURE';
  static const String newDevice = 'NEW_DEVICE_LOGIN';
  static const String suspiciousLogin = 'SUSPICIOUS_LOGIN';
  static const String passwordChange = 'PASSWORD_CHANGED';

  static const List<String> all = <String>[
    loginSuccess,
    loginFailure,
    newDevice,
    suspiciousLogin,
    passwordChange,
  ];
}

/// One security event about the caller.
///
/// The API's `SecurityEvent` row is the source: `GET /v1/security/events` returns
/// `{ data, total, page, limit }` and the controller scopes it to the caller's
/// tenant. There is no acknowledge endpoint for a customer in this API, so this
/// model carries no `acknowledged` field: inventing one would put an "acknowledge"
/// button on the screen that cannot work.
class LoginAlert extends Equatable {
  const LoginAlert({
    required this.id,
    required this.type,
    required this.severity,
    required this.createdAt,
    this.userId,
    this.ipHash,
    this.deviceId,
    this.userAgent,
    this.status,
  });

  factory LoginAlert.fromJson(Map<String, Object?> json) {
    return LoginAlert(
      id: JsonRead.strOr(json, 'id', ''),
      type: JsonRead.strOr(json, 'type', 'UNKNOWN'),
      severity: JsonRead.strOr(json, 'severity', 'LOW'),
      createdAt: JsonRead.date(json, 'createdAt'),
      userId: JsonRead.str(json, 'userId'),
      ipHash: JsonRead.str(json, 'ipHash'),
      deviceId: JsonRead.str(json, 'deviceId'),
      userAgent: JsonRead.str(json, 'userAgent'),
      status: JsonRead.str(json, 'status'),
    );
  }

  final String id;
  final String type;
  final String severity;
  final DateTime? createdAt;
  final String? userId;

  /// A hash, never an address: the API does not return the raw IP.
  final String? ipHash;
  final String? deviceId;
  final String? userAgent;
  final String? status;

  /// A sign-in that the platform itself flagged. This is what the screen leads with.
  bool get isSuspicious => type == SecurityEventTypes.suspiciousLogin;
  bool get isNewDevice => type == SecurityEventTypes.newDevice;
  bool get isHighSeverity => severity == 'HIGH' || severity == 'CRITICAL';

  @override
  List<Object?> get props => <Object?>[id, type, severity, createdAt, userId, ipHash, deviceId, userAgent, status];
}
