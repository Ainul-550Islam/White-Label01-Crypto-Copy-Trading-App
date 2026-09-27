import 'dart:async';

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../logging/app_logger.dart';
import '../storage/device_identity.dart';
import '../storage/token_storage.dart';

/// Attaches credentials and transparently refreshes an expired session.
///
/// Design notes:
///  * Refresh is serialised through a single [Completer]. Without it, a screen
///    firing three parallel requests would trigger three refreshes, and the
///    API's reuse detection would revoke the entire token family and sign the
///    user out.
///  * The refresh call uses a bare Dio instance so it cannot recurse back
///    through this interceptor.
///  * On unrecoverable failure the session is cleared and [onSessionExpired]
///    fires exactly once, letting the router send the user to the sign-in
///    screen.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required AppConfig config,
    required TokenStorage tokenStorage,
    required DeviceIdentity deviceIdentity,
    required AppLogger logger,
    required Future<void> Function() onSessionExpired,
    Dio? refreshClient,
  })  : _config = config,
        _tokenStorage = tokenStorage,
        _deviceIdentity = deviceIdentity,
        _logger = logger,
        _onSessionExpired = onSessionExpired,
        _refreshClient = refreshClient ??
            Dio(
              BaseOptions(
                baseUrl: config.versionedBaseUrl,
                connectTimeout: config.connectTimeout,
                receiveTimeout: config.receiveTimeout,
                headers: <String, String>{'x-tenant-slug': config.tenantSlug},
              ),
            );

  static const String _skipAuthKey = 'skipAuth';

  /// Marks a request as unauthenticated (sign-in, registration, refresh).
  static Options unauthenticated([Options? options]) {
    final Options base = options ?? Options();
    return base.copyWith(extra: <String, Object?>{...?base.extra, _skipAuthKey: true});
  }

  final AppConfig _config;
  final TokenStorage _tokenStorage;
  final DeviceIdentity _deviceIdentity;
  final AppLogger _logger;
  final Future<void> Function() _onSessionExpired;
  final Dio _refreshClient;

  Completer<AuthTokens?>? _refreshInFlight;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    options.headers['x-tenant-slug'] = _config.tenantSlug;

    if (options.extra[_skipAuthKey] == true) {
      handler.next(options);
      return;
    }

    AuthTokens? tokens = await _tokenStorage.read();

    if (tokens == null) {
      handler.next(options);
      return;
    }

    if (tokens.isAccessExpired) {
      // Refresh before spending a round trip on a request that will 401.
      tokens = await _refreshTokens(tokens);
    }

    if (tokens != null) {
      options.headers['authorization'] = 'Bearer ${tokens.accessToken}';
    }

    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final RequestOptions request = err.requestOptions;
    final bool isAuthError = err.response?.statusCode == 401;
    final bool alreadyRetried = request.extra['retried'] == true;
    final bool skipsAuth = request.extra[_skipAuthKey] == true;

    if (!isAuthError || alreadyRetried || skipsAuth) {
      handler.next(err);
      return;
    }

    final AuthTokens? current = await _tokenStorage.read();

    if (current == null) {
      handler.next(err);
      return;
    }

    final AuthTokens? refreshed = await _refreshTokens(current);

    if (refreshed == null) {
      handler.next(err);
      return;
    }

    request.extra['retried'] = true;
    request.headers['authorization'] = 'Bearer ${refreshed.accessToken}';

    try {
      final Response<dynamic> response = await _refreshClient.fetch<dynamic>(request);
      handler.resolve(response);
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }

  Future<AuthTokens?> _refreshTokens(AuthTokens current) async {
    final Completer<AuthTokens?>? inFlight = _refreshInFlight;

    if (inFlight != null) {
      return inFlight.future;
    }

    final Completer<AuthTokens?> completer = Completer<AuthTokens?>();
    _refreshInFlight = completer;

    try {
      if (current.isRefreshExpired) {
        _logger.info('auth.refresh_token_expired');
        await _expireSession();
        completer.complete(null);
        return null;
      }

      final String deviceId = await _deviceIdentity.deviceId();

      final Response<dynamic> response = await _refreshClient.post<dynamic>(
        '/auth/refresh',
        data: <String, Object?>{
          'refreshToken': current.refreshToken,
          'deviceId': deviceId,
        },
      );

      final AuthTokens? tokens = _parseTokens(response.data);

      if (tokens == null) {
        await _expireSession();
        completer.complete(null);
        return null;
      }

      await _tokenStorage.write(tokens);
      _logger.debug('auth.session_refreshed');
      completer.complete(tokens);
      return tokens;
    } on DioException catch (error) {
      // A 401 here means the family was revoked - reuse detected, or the user
      // signed out elsewhere. Either way the session is gone for good.
      _logger.warning(
        'auth.refresh_failed',
        context: <String, Object?>{'status': error.response?.statusCode},
      );
      await _expireSession();
      completer.complete(null);
      return null;
    } finally {
      _refreshInFlight = null;
    }
  }

  Future<void> _expireSession() async {
    await _tokenStorage.clear();
    await _onSessionExpired();
  }

  AuthTokens? _parseTokens(Object? body) {
    if (body is! Map) {
      return null;
    }

    final Object? data = body['data'] ?? body;
    if (data is! Map) {
      return null;
    }

    final Object? tokens = data['tokens'];
    if (tokens is! Map) {
      return null;
    }

    final Object? accessToken = tokens['accessToken'];
    final Object? refreshToken = tokens['refreshToken'];
    final Object? expiresIn = tokens['expiresIn'];
    final Object? refreshExpiresIn = tokens['refreshExpiresIn'];

    if (accessToken is! String || refreshToken is! String) {
      return null;
    }

    final DateTime now = DateTime.now().toUtc();

    return AuthTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
      accessExpiresAt: now.add(Duration(seconds: expiresIn is int ? expiresIn : 900)),
      refreshExpiresAt: now.add(
        Duration(seconds: refreshExpiresIn is int ? refreshExpiresIn : 2592000),
      ),
    );
  }
}
