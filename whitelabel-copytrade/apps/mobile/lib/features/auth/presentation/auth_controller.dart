import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../data/auth_repository.dart';
import '../domain/auth_models.dart';
import 'auth_state.dart';

/// Owns the authentication lifecycle.
///
/// Every method funnels failures through [AppException] so the UI renders a
/// safe message and never an exception string. The controller holds no tokens:
/// persistence is entirely the repository's job.
class AuthController extends StateNotifier<AuthState> {
  AuthController({required AuthRepository repository, required AppLogger logger})
      : _repository = repository,
        _logger = logger,
        super(const AuthState.initial());

  final AuthRepository _repository;
  final AppLogger _logger;

  /// Called once at startup and again whenever the session is invalidated.
  Future<void> restore() async {
    try {
      final AuthUser? user = await _repository.restoreSession();

      state = user == null
          ? const AuthState(status: AuthStatus.unauthenticated)
          : AuthState(status: AuthStatus.authenticated, user: user);
    } on AppException catch (error) {
      _logger.warning('auth.restore_failed', context: <String, Object?>{'code': error.code.name});
      state = AuthState(status: AuthStatus.unauthenticated, error: error);
    }
  }

  Future<void> signIn({required String email, required String password}) async {
    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      final LoginOutcome outcome = await _repository.login(email: email, password: password);

      switch (outcome) {
        case LoginSucceeded(user: final AuthUser user):
          state = AuthState(status: AuthStatus.authenticated, user: user);
        case LoginNeedsTwoFactor(
            challengeToken: final String token,
            methods: final List<String> methods,
          ):
          state = AuthState(
            status: AuthStatus.awaitingTwoFactor,
            challengeToken: token,
            twoFactorMethods: methods,
          );
      }
    } on AppException catch (error) {
      state = state.copyWith(isSubmitting: false, error: error);
    }
  }

  Future<void> submitTwoFactor({required String code, String method = 'TOTP'}) async {
    final String? challengeToken = state.challengeToken;

    if (challengeToken == null) {
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        error: const AppException(
          code: AppErrorCode.unauthorized,
          message: 'The challenge expired. Please sign in again.',
        ),
        isSubmitting: false,
        clearChallenge: true,
      );
      return;
    }

    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      final AuthUser user = await _repository.verifyTwoFactor(
        challengeToken: challengeToken,
        code: code,
        method: method,
      );

      state = AuthState(status: AuthStatus.authenticated, user: user);
    } on AppException catch (error) {
      state = state.copyWith(isSubmitting: false, error: error);
    }
  }

  Future<void> register({
    required String email,
    required String password,
    required bool acceptedTerms,
    String? firstName,
    String? lastName,
  }) async {
    state = state.copyWith(isSubmitting: true, clearError: true);

    try {
      final AuthUser user = await _repository.register(
        email: email,
        password: password,
        acceptedTerms: acceptedTerms,
        firstName: firstName,
        lastName: lastName,
      );

      state = AuthState(status: AuthStatus.authenticated, user: user);
    } on AppException catch (error) {
      state = state.copyWith(isSubmitting: false, error: error);
    }
  }

  Future<void> signOut({bool allDevices = false}) async {
    state = state.copyWith(isSubmitting: true, clearError: true);
    await _repository.logout(allDevices: allDevices);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Invoked by the network layer when a refresh fails irrecoverably.
  void onSessionExpired() {
    if (state.status == AuthStatus.unauthenticated) {
      return;
    }

    _logger.info('auth.session_expired');

    state = const AuthState(
      status: AuthStatus.unauthenticated,
      error: AppException(
        code: AppErrorCode.unauthorized,
        message: 'Your session has expired. Please sign in again.',
      ),
    );
  }

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  void cancelTwoFactor() {
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}
