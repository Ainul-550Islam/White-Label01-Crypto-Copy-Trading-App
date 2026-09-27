import 'package:equatable/equatable.dart';

import '../../../core/error/app_exception.dart';
import '../domain/auth_models.dart';

/// Where the session is, as far as the UI is concerned.
enum AuthStatus {
  /// Startup: the stored session has not been checked yet.
  initialising,

  unauthenticated,

  /// Password accepted, waiting on the second factor.
  awaitingTwoFactor,

  authenticated,
}

/// Immutable authentication state.
class AuthState extends Equatable {
  const AuthState({
    required this.status,
    this.user,
    this.error,
    this.isSubmitting = false,
    this.challengeToken,
    this.twoFactorMethods = const <String>[],
  });

  const AuthState.initial() : this(status: AuthStatus.initialising);

  final AuthStatus status;
  final AuthUser? user;
  final AppException? error;
  final bool isSubmitting;

  /// Kept in memory only and cleared as soon as the challenge resolves.
  final String? challengeToken;
  final List<String> twoFactorMethods;

  bool get isAuthenticated => status == AuthStatus.authenticated && user != null;

  AuthState copyWith({
    AuthStatus? status,
    AuthUser? user,
    AppException? error,
    bool? isSubmitting,
    String? challengeToken,
    List<String>? twoFactorMethods,
    bool clearError = false,
    bool clearUser = false,
    bool clearChallenge = false,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: clearUser ? null : (user ?? this.user),
      error: clearError ? null : (error ?? this.error),
      isSubmitting: isSubmitting ?? this.isSubmitting,
      challengeToken: clearChallenge ? null : (challengeToken ?? this.challengeToken),
      twoFactorMethods: clearChallenge ? const <String>[] : (twoFactorMethods ?? this.twoFactorMethods),
    );
  }

  @override
  List<Object?> get props =>
      <Object?>[status, user, error, isSubmitting, challengeToken, twoFactorMethods];
}
