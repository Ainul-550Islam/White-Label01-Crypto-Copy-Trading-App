import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/core/error/app_exception.dart';
import 'package:wlct_mobile/core/logging/app_logger.dart';
import 'package:wlct_mobile/features/auth/domain/auth_models.dart';
import 'package:wlct_mobile/features/auth/presentation/auth_state.dart';

void main() {
  group('AuthState', () {
    test('starts in the initialising state', () {
      const AuthState state = AuthState.initial();

      expect(state.status, AuthStatus.initialising);
      expect(state.isAuthenticated, isFalse);
      expect(state.user, isNull);
    });

    test('clearError removes the error without touching the user', () {
      const AuthUser user = AuthUser(
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'operator@example.test',
        status: UserStatus.active,
        twoFactorEnabled: true,
        roles: <String>['TENANT_ADMIN'],
        permissions: <String>['user:read'],
      );

      const AuthState state = AuthState(
        status: AuthStatus.authenticated,
        user: user,
        error: AppException(code: AppErrorCode.network, message: 'offline'),
      );

      final AuthState cleared = state.copyWith(clearError: true);

      expect(cleared.error, isNull);
      expect(cleared.user, user);
      expect(cleared.isAuthenticated, isTrue);
    });

    test('clearChallenge drops the challenge token and its methods', () {
      const AuthState state = AuthState(
        status: AuthStatus.awaitingTwoFactor,
        challengeToken: 'challenge-token',
        twoFactorMethods: <String>['TOTP'],
      );

      final AuthState cleared = state.copyWith(clearChallenge: true);

      expect(cleared.challengeToken, isNull);
      expect(cleared.twoFactorMethods, isEmpty);
    });
  });

  group('AuthUser.can', () {
    const AuthUser user = AuthUser(
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'trader@example.test',
      status: UserStatus.active,
      twoFactorEnabled: false,
      roles: <String>['TRADER'],
      permissions: <String>['order:read', 'strategy:*'],
    );

    test('matches an exact permission', () {
      expect(user.can('order:read'), isTrue);
    });

    test('matches a resource wildcard', () {
      expect(user.can('strategy:manage'), isTrue);
    });

    test('denies anything not granted', () {
      expect(user.can('tenant:manage'), isFalse);
    });
  });

  group('AppLogger.redact', () {
    test('masks credential-like keys at every depth', () {
      final Map<String, Object?> redacted = AppLogger.redact(<String, Object?>{
        'email': 'user@example.test',
        'password': 'super-secret',
        'tokens': <String, Object?>{'accessToken': 'jwt', 'refreshToken': 'jwt'},
        'apiSecret': 'exchange-secret',
      });

      expect(redacted['email'], 'user@example.test');
      expect(redacted['password'], '[REDACTED]');
      expect(redacted['apiSecret'], '[REDACTED]');
      expect(
        (redacted['tokens']! as Map<String, Object?>)['accessToken'],
        '[REDACTED]',
      );
    });
  });

  group('AppErrorCode.fromApiCode', () {
    test('maps known API codes', () {
      expect(AppErrorCode.fromApiCode('VALIDATION_ERROR', 400), AppErrorCode.validation);
      expect(AppErrorCode.fromApiCode('ACCOUNT_LOCKED', 423), AppErrorCode.accountLocked);
      expect(AppErrorCode.fromApiCode('RATE_LIMIT_EXCEEDED', 429), AppErrorCode.rateLimited);
    });

    test('falls back to the status code', () {
      expect(AppErrorCode.fromApiCode(null, 503), AppErrorCode.server);
      expect(AppErrorCode.fromApiCode('SOMETHING_NEW', 403), AppErrorCode.forbidden);
    });
  });
}
