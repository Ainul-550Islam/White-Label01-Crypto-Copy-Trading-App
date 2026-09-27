import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/storage/device_identity.dart';
import '../../../core/storage/token_storage.dart';
import '../domain/auth_models.dart';

/// All authentication I/O.
///
/// The repository owns token persistence so no other layer ever handles a raw
/// token. Callers receive domain objects and exceptions, never HTTP details.
class AuthRepository {
  AuthRepository({
    required ApiClient apiClient,
    required TokenStorage tokenStorage,
    required DeviceIdentity deviceIdentity,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _tokenStorage = tokenStorage,
        _deviceIdentity = deviceIdentity,
        _logger = logger;

  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;
  final DeviceIdentity _deviceIdentity;
  final AppLogger _logger;

  Future<LoginOutcome> login({required String email, required String password}) async {
    final String deviceId = await _deviceIdentity.deviceId();

    final Map<String, Object?> payload = await _apiClient.post<Map<String, Object?>>(
      ApiEndpoints.login,
      authenticated: false,
      body: <String, Object?>{
        'email': email.trim().toLowerCase(),
        'password': password,
        'deviceId': deviceId,
        'platform': 'ios',
      },
      parser: _asMap,
    );

    if (payload['twoFactorRequired'] == true) {
      final Object? methods = payload['methods'];

      return LoginNeedsTwoFactor(
        challengeToken: payload['challengeToken'] as String? ?? '',
        methods: methods is List ? methods.whereType<String>().toList(growable: false) : const <String>['TOTP'],
      );
    }

    final AuthUser user = await _persistSession(payload);
    _logger.info('auth.login_succeeded');
    return LoginSucceeded(user);
  }

  Future<AuthUser> verifyTwoFactor({
    required String challengeToken,
    required String code,
    required String method,
  }) async {
    final String deviceId = await _deviceIdentity.deviceId();

    final Map<String, Object?> payload = await _apiClient.post<Map<String, Object?>>(
      ApiEndpoints.verifyTwoFactor,
      authenticated: false,
      body: <String, Object?>{
        'challengeToken': challengeToken,
        'code': code.trim(),
        'method': method,
        'deviceId': deviceId,
      },
      parser: _asMap,
    );

    final AuthUser user = await _persistSession(payload);
    _logger.info('auth.two_factor_verified');
    return user;
  }

  Future<AuthUser> register({
    required String email,
    required String password,
    required bool acceptedTerms,
    String? firstName,
    String? lastName,
  }) async {
    final String deviceId = await _deviceIdentity.deviceId();

    final Map<String, Object?> payload = await _apiClient.post<Map<String, Object?>>(
      ApiEndpoints.register,
      authenticated: false,
      body: <String, Object?>{
        'email': email.trim().toLowerCase(),
        'password': password,
        'acceptedTerms': acceptedTerms,
        if (firstName != null && firstName.isNotEmpty) 'firstName': firstName,
        if (lastName != null && lastName.isNotEmpty) 'lastName': lastName,
        'deviceId': deviceId,
        'platform': 'ios',
      },
      parser: _asMap,
    );

    return _persistSession(payload);
  }

  /// Returns the current user, or null when there is no usable session.
  Future<AuthUser?> restoreSession() async {
    final AuthTokens? tokens = await _tokenStorage.read();

    if (tokens == null || tokens.isRefreshExpired) {
      // Nothing to restore; make sure no stale material is left behind.
      await _tokenStorage.clear();
      return null;
    }

    try {
      return await currentUser();
    } on AppException catch (error) {
      if (error.isAuthFailure) {
        await _tokenStorage.clear();
        return null;
      }
      rethrow;
    }
  }

  Future<AuthUser> currentUser() async {
    final Map<String, Object?> payload = await _apiClient.get<Map<String, Object?>>(
      ApiEndpoints.me,
      parser: _asMap,
    );

    return AuthUser.fromJson(payload);
  }

  Future<void> logout({bool allDevices = false}) async {
    try {
      await _apiClient.post<Object?>(
        ApiEndpoints.logout,
        body: <String, Object?>{'allDevices': allDevices},
        parser: (Object? data) => data,
      );
    } on AppException catch (error) {
      // Local sign-out must succeed even when the network call does not.
      _logger.warning('auth.logout_request_failed', context: <String, Object?>{'code': error.code.name});
    } finally {
      await _tokenStorage.clear();
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _apiClient.post<Object?>(
      ApiEndpoints.changePassword,
      body: <String, Object?>{
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      },
      parser: (Object? data) => data,
    );

    // The API revokes every other session on a password change; the local one
    // is rotated server-side, so the safest client behaviour is a clean start.
    await _tokenStorage.clear();
  }

  Future<AuthUser> _persistSession(Map<String, Object?> payload) async {
    final Object? tokensNode = payload['tokens'];
    final Object? userNode = payload['user'];

    if (tokensNode is! Map || userNode is! Map) {
      throw const AppException(
        code: AppErrorCode.unknown,
        message: 'The server returned an unexpected sign-in response.',
      );
    }

    final Object? accessToken = tokensNode['accessToken'];
    final Object? refreshToken = tokensNode['refreshToken'];

    if (accessToken is! String || refreshToken is! String) {
      throw const AppException(
        code: AppErrorCode.unknown,
        message: 'The server returned an unexpected sign-in response.',
      );
    }

    final DateTime now = DateTime.now().toUtc();
    final Object? expiresIn = tokensNode['expiresIn'];
    final Object? refreshExpiresIn = tokensNode['refreshExpiresIn'];

    await _tokenStorage.write(
      AuthTokens(
        accessToken: accessToken,
        refreshToken: refreshToken,
        accessExpiresAt: now.add(Duration(seconds: expiresIn is int ? expiresIn : 900)),
        refreshExpiresAt: now.add(
          Duration(seconds: refreshExpiresIn is int ? refreshExpiresIn : 2592000),
        ),
      ),
    );

    return AuthUser.fromJson(Map<String, Object?>.from(userNode));
  }

  Map<String, Object?> _asMap(Object? data) {
    if (data is Map) {
      return Map<String, Object?>.from(data);
    }

    throw const AppException(
      code: AppErrorCode.unknown,
      message: 'The server returned an unexpected response.',
    );
  }
}
