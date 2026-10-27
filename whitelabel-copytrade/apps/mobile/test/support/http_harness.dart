import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:wlct_mobile/core/config/app_config.dart';
import 'package:wlct_mobile/core/config/app_environment.dart';
import 'package:wlct_mobile/core/logging/app_logger.dart';
import 'package:wlct_mobile/core/network/api_client.dart';
import 'package:wlct_mobile/core/network/auth_interceptor.dart';
import 'package:wlct_mobile/core/storage/device_identity.dart';
import 'package:wlct_mobile/core/storage/secure_storage.dart';
import 'package:wlct_mobile/core/storage/token_storage.dart';

/// Only the network adapter is substituted; the Dio client, interceptors,
/// repositories and controllers under test are the production classes.
/// The secure-storage plugin's own in-memory test channel substitutes for the
/// unavailable device Keychain, while TokenStorage remains the real class.
class FixtureResponse {
  const FixtureResponse(this.status, this.body);
  factory FixtureResponse.ok(Object? data) =>
      FixtureResponse(200, <String, Object?>{'success': true, 'data': data});
  factory FixtureResponse.error(
    int status,
    String code,
    String message, {
    List<Object?>? details,
  }) =>
      FixtureResponse(status, <String, Object?>{
        'success': false,
        'error': <String, Object?>{
          'code': code,
          'message': message,
          if (details != null) 'details': details,
        },
      });
  final int status;
  final Object? body;
}

class CapturedRequest {
  CapturedRequest(RequestOptions options)
      : method = options.method,
        uri = options.uri,
        headers = Map<String, Object?>.from(options.headers),
        data = options.data is String
            ? _decode(options.data as String)
            : options.data;
  final String method;
  final Uri uri;
  final Map<String, Object?> headers;
  final Object? data;
  static Object? _decode(String value) {
    try {
      return jsonDecode(value);
    } on FormatException {
      return value;
    }
  }
}

class FixtureAdapter implements HttpClientAdapter {
  FixtureAdapter(this.handler);
  final FutureOr<FixtureResponse> Function(RequestOptions) handler;
  final List<CapturedRequest> requests = <CapturedRequest>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(CapturedRequest(options));
    final FixtureResponse response = await handler(options);
    return ResponseBody.fromString(
      jsonEncode(response.body),
      response.status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class HttpHarness {
  HttpHarness(
    FutureOr<FixtureResponse> Function(RequestOptions) handler, {
    Future<void> Function(Duration)? waitBeforeRetry,
  }) {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    transport = FixtureAdapter(handler);
    secure = SecureStorage();
    tokens = TokenStorage(secure);
    device = DeviceIdentity(secure);
    logger = AppLogger(AppEnvironment.production);
    final Dio refresh = Dio(BaseOptions(baseUrl: config.versionedBaseUrl));
    refresh.httpClientAdapter = transport;
    final AuthInterceptor auth = AuthInterceptor(
      config: config,
      tokenStorage: tokens,
      deviceIdentity: device,
      logger: logger,
      refreshClient: refresh,
      onSessionExpired: () async {
        expiredCount++;
      },
    );
    api = ApiClient(
      config: config,
      authInterceptor: auth,
      logger: logger,
      waitBeforeRetry: waitBeforeRetry,
    );
    api.raw.httpClientAdapter = transport;
  }
  static const AppConfig config = AppConfig(
    environment: AppEnvironment.production,
    apiBaseUrl: 'https://api.example.test/api',
    apiVersion: 'v1',
    tenantSlug: 'tenant-a',
    websocketUrl: 'https://api.example.test',
    connectTimeout: Duration(seconds: 5),
    receiveTimeout: Duration(seconds: 5),
    enableNetworkLogging: false,
  );
  late final FixtureAdapter transport;
  late final SecureStorage secure;
  late final TokenStorage tokens;
  late final DeviceIdentity device;
  late final AppLogger logger;
  late final ApiClient api;
  int expiredCount = 0;
}

Map<String, Object?> session({
  String access = 'access-1',
  String refresh = 'refresh-1',
}) =>
    <String, Object?>{
      'tokens': <String, Object?>{
        'accessToken': access,
        'refreshToken': refresh,
        'expiresIn': 900,
        'refreshExpiresIn': 3600,
      },
      'user': <String, Object?>{
        'id': 'user-1',
        'tenantId': 'tenant-a',
        'email': 'user@example.test',
        'status': 'ACTIVE',
        'twoFactorEnabled': true,
        'roles': <Object?>[],
        'permissions': <String>['risk:read'],
      },
    };
