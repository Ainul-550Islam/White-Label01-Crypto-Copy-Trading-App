import 'package:equatable/equatable.dart';

/// Account lifecycle state as reported by the API.
enum UserStatus {
  pendingVerification,
  active,
  suspended,
  locked,
  deactivated,
  unknown;

  static UserStatus fromApi(String? value) {
    switch (value) {
      case 'PENDING_VERIFICATION':
        return UserStatus.pendingVerification;
      case 'ACTIVE':
        return UserStatus.active;
      case 'SUSPENDED':
        return UserStatus.suspended;
      case 'LOCKED':
        return UserStatus.locked;
      case 'DEACTIVATED':
        return UserStatus.deactivated;
      default:
        return UserStatus.unknown;
    }
  }
}

/// The signed-in user.
///
/// Mirrors the API's `UserDto` minus anything the client has no business
/// holding. Permissions are carried for UI gating only - the API re-checks
/// every one of them on every request.
class AuthUser extends Equatable {
  const AuthUser({
    required this.id,
    required this.tenantId,
    required this.email,
    required this.status,
    required this.twoFactorEnabled,
    required this.roles,
    required this.permissions,
    this.displayName,
    this.avatarUrl,
    this.locale = 'en',
  });

  final String id;
  final String tenantId;
  final String email;
  final UserStatus status;
  final bool twoFactorEnabled;
  final List<String> roles;
  final List<String> permissions;
  final String? displayName;
  final String? avatarUrl;
  final String locale;

  bool get isActive => status == UserStatus.active;

  /// Supports exact matches and the wildcard forms the API issues.
  bool can(String permission) {
    if (permissions.contains('*') || permissions.contains(permission)) {
      return true;
    }

    final int separator = permission.indexOf(':');
    if (separator <= 0) {
      return false;
    }

    return permissions.contains('${permission.substring(0, separator)}:*');
  }

  static AuthUser fromJson(Map<String, Object?> json) {
    final Object? profile = json['profile'];
    final Object? roles = json['roles'];
    final Object? permissions = json['permissions'];

    return AuthUser(
      id: json['id'] as String? ?? '',
      tenantId: json['tenantId'] as String? ?? '',
      email: json['email'] as String? ?? '',
      status: UserStatus.fromApi(json['status'] as String?),
      twoFactorEnabled: json['twoFactorEnabled'] as bool? ?? false,
      roles: roles is List
          ? roles
              .whereType<Map<Object?, Object?>>()
              .map((Map<Object?, Object?> role) => role['key'] as String? ?? '')
              .where((String key) => key.isNotEmpty)
              .toList(growable: false)
          : const <String>[],
      permissions: permissions is List
          ? permissions.whereType<String>().toList(growable: false)
          : const <String>[],
      displayName: profile is Map<Object?, Object?> ? profile['displayName'] as String? : null,
      avatarUrl: profile is Map<Object?, Object?> ? profile['avatarUrl'] as String? : null,
      locale: profile is Map<Object?, Object?>
          ? (profile['locale'] as String? ?? 'en')
          : 'en',
    );
  }

  @override
  List<Object?> get props => <Object?>[id, tenantId, email, status, twoFactorEnabled, roles, permissions];
}

/// Outcome of a sign-in attempt: either a session, or a 2FA challenge.
sealed class LoginOutcome {
  const LoginOutcome();
}

class LoginSucceeded extends LoginOutcome {
  const LoginSucceeded(this.user);

  final AuthUser user;
}

class LoginNeedsTwoFactor extends LoginOutcome {
  const LoginNeedsTwoFactor({required this.challengeToken, required this.methods});

  /// Held in memory only, for the seconds the challenge screen is open.
  final String challengeToken;
  final List<String> methods;
}
